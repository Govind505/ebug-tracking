"""
ML Scoring Model for Bug Severity Classification.

Uses a hybrid approach:
1. Rule-based scoring for high-confidence signals (critical exceptions, security keywords)
2. Gradient Boosted classifier trained on historical bug data
3. Confidence calibration to produce reliable probability scores

The model outputs both a severity label and a confidence score (0.0-1.0).
"""

import logging
import os
from pathlib import Path
from typing import Optional

import numpy as np

try:
    from sklearn.ensemble import GradientBoostingClassifier
    from sklearn.calibration import CalibratedClassifierCV
    import joblib
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False

from features import BugFeatures, extract_features

logger = logging.getLogger("scorer.model")

# Severity levels mapped to integers for ML
SEVERITY_MAP = {
    0: "info",
    1: "low",
    2: "medium",
    3: "high",
    4: "critical",
}
SEVERITY_REVERSE = {v: k for k, v in SEVERITY_MAP.items()}


class SeverityModel:
    """
    Hybrid rule-based + ML severity classifier.
    
    The rule engine handles obvious cases (crashes, security vulns).
    The ML model handles ambiguous cases with probability output.
    """

    def __init__(self, model_path: Optional[str] = None):
        self.model = None
        self.model_path = model_path or os.getenv("MODEL_PATH", "models/severity_model.pkl")
        self._load_model()

    def predict(self, bug: dict) -> tuple[str, float]:
        """
        Predict severity for a bug report.
        
        Returns: (severity_label, confidence_score)
        """
        features = extract_features(bug)

        # Phase 1: Rule-based override for high-confidence signals
        rule_result = self._rule_engine(features, bug)
        if rule_result:
            return rule_result

        # Phase 2: ML model prediction
        if self.model:
            return self._ml_predict(features)

        # Phase 3: Heuristic fallback (no trained model available)
        return self._heuristic_predict(features)

    def _rule_engine(self, features: BugFeatures, bug: dict) -> Optional[tuple[str, float]]:
        """
        Rule-based severity for high-confidence patterns.
        Returns None if no rule matches confidently.
        """
        # Critical: production crash with critical exception
        if features.has_critical_exception and features.has_production_env:
            return ("critical", 0.98)

        # Critical: security vulnerability
        if features.is_security and features.critical_keyword_score > 0.3:
            return ("critical", 0.95)

        # Critical: overwhelming critical keywords
        if features.critical_keyword_score > 0.5:
            return ("critical", 0.90)

        # High: crash without production env or critical exceptions in general
        if features.has_critical_exception:
            return ("high", 0.88)

        # High: production error with high exception
        if features.has_high_exception and features.has_production_env:
            return ("high", 0.85)

        # Low: pure UI/cosmetic issue with no stack trace
        if features.is_ui and not features.has_stack_trace and features.low_keyword_score > 0.3:
            return ("low", 0.85)

        # Info: enhancement/suggestion with no error signals
        if (features.low_keyword_score > 0.2 
            and not features.has_stack_trace 
            and features.critical_keyword_score == 0 
            and features.high_keyword_score == 0):
            return ("info", 0.80)

        return None  # Fall through to ML/heuristic

    def _ml_predict(self, features: BugFeatures) -> tuple[str, float]:
        """Predict using trained sklearn model."""
        vector = features.to_vector().reshape(1, -1)
        
        prediction = self.model.predict(vector)[0]
        probabilities = self.model.predict_proba(vector)[0]
        confidence = float(np.max(probabilities))

        severity = SEVERITY_MAP.get(prediction, "medium")
        return (severity, confidence)

    def _heuristic_predict(self, features: BugFeatures) -> tuple[str, float]:
        """
        Weighted heuristic scoring when no ML model is available.
        Computes a weighted severity score from feature signals.
        """
        score = 0.0

        # Keyword contributions (major signal)
        score += features.critical_keyword_score * 4.0
        score += features.high_keyword_score * 3.0
        score += features.medium_keyword_score * 2.0
        score += features.low_keyword_score * 0.5

        # Stack trace signals
        if features.has_stack_trace:
            score += 0.5
        if features.has_critical_exception:
            score += 2.0
        if features.has_high_exception:
            score += 1.5
        score += min(features.stack_trace_depth / 30.0, 1.0) * 0.5

        # Environment signals
        if features.has_production_env:
            score *= 1.3  # Boost for production
        if features.has_test_env:
            score *= 0.8  # Reduce for test/dev

        # Category signals
        if features.is_security:
            score += 1.5
        if features.is_crash:
            score += 1.0

        # Error density
        score += min(features.error_count_in_trace / 5.0, 1.0) * 0.5

        # Map score to severity
        if score >= 6.0:
            severity = "critical"
        elif score >= 4.0:
            severity = "high"
        elif score >= 2.0:
            severity = "medium"
        elif score >= 0.8:
            severity = "low"
        else:
            severity = "info"

        # Confidence is lower for heuristic (we're less sure)
        confidence = min(0.60 + score * 0.05, 0.85)

        return (severity, round(confidence, 3))

    def _load_model(self):
        """Load pre-trained model from disk if available."""
        if not HAS_SKLEARN:
            logger.warning("scikit-learn not installed, using heuristic scoring only")
            return

        path = Path(self.model_path)
        if path.exists():
            try:
                self.model = joblib.load(path)
                logger.info(f"Loaded severity model from {path}")
            except Exception as e:
                logger.error(f"Failed to load model: {e}")
        else:
            logger.info("No pre-trained model found, using heuristic scoring")

    def train(self, bugs: list[dict], labels: list[str]) -> dict:
        """
        Train the severity model on labeled bug data.
        
        Args:
            bugs: List of raw bug report dicts
            labels: Corresponding severity labels ("info", "low", "medium", "high", "critical")
        
        Returns: Training metrics dict
        """
        if not HAS_SKLEARN:
            raise RuntimeError("scikit-learn required for training")

        logger.info(f"Training severity model on {len(bugs)} samples")

        # Extract features
        X = np.array([extract_features(bug).to_vector() for bug in bugs])
        y = np.array([SEVERITY_REVERSE[label] for label in labels])

        # Train gradient boosted classifier with calibration
        base_model = GradientBoostingClassifier(
            n_estimators=200,
            max_depth=5,
            learning_rate=0.1,
            min_samples_split=10,
            random_state=42,
        )
        self.model = CalibratedClassifierCV(base_model, cv=5, method="isotonic")
        self.model.fit(X, y)

        # Save model
        path = Path(self.model_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(self.model, path)
        logger.info(f"Model saved to {path}")

        # Compute accuracy
        predictions = self.model.predict(X)
        accuracy = float(np.mean(predictions == y))

        return {
            "samples": len(bugs),
            "accuracy": round(accuracy, 4),
            "model_path": str(path),
        }
