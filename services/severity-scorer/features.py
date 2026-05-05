"""
Feature extraction utilities for bug report classification.

Transforms raw bug report fields into numerical feature vectors
for the severity scoring ML model.
"""

import re
from dataclasses import dataclass

import numpy as np


# ─────────────────────────────────────────────
# Keyword Dictionaries (Weighted Signals)
# ─────────────────────────────────────────────

CRITICAL_KEYWORDS = {
    "segfault": 5, "segmentation fault": 5, "sigsegv": 5,
    "out of memory": 5, "oom": 5, "heap overflow": 5,
    "stack overflow": 4, "buffer overflow": 5,
    "data loss": 5, "data corruption": 5, "corrupted": 4,
    "security vulnerability": 5, "sql injection": 5, "xss": 4,
    "remote code execution": 5, "rce": 5, "privilege escalation": 5,
    "authentication bypass": 5, "unauthorized access": 5,
    "crash": 4, "fatal": 4, "panic": 4, "unrecoverable": 4,
    "deadlock": 4, "infinite loop": 3, "hang": 3,
    "production down": 5, "service outage": 5, "p0": 5,
}

HIGH_KEYWORDS = {
    "null pointer": 3, "nullptr": 3, "nullreferenceexception": 3,
    "type error": 2, "typeerror": 2, "attributeerror": 2,
    "index out of range": 3, "indexerror": 3,
    "memory leak": 3, "resource leak": 3,
    "race condition": 3, "thread safety": 3,
    "timeout": 2, "connection refused": 2, "connection reset": 2,
    "500 error": 3, "internal server error": 3,
    "data integrity": 3, "inconsistent state": 3,
    "regression": 3, "broken": 2, "failure": 2,
}

MEDIUM_KEYWORDS = {
    "warning": 1, "deprecated": 1, "slow": 2,
    "performance": 2, "latency": 2, "high cpu": 2,
    "incorrect": 2, "wrong": 1, "unexpected": 2,
    "missing": 1, "not found": 1, "404": 1,
    "validation": 1, "parsing error": 2,
    "flaky": 2, "intermittent": 2, "sometimes": 1,
}

LOW_KEYWORDS = {
    "typo": 1, "cosmetic": 1, "alignment": 1,
    "color": 1, "font": 1, "spacing": 1, "padding": 1,
    "tooltip": 1, "placeholder": 1, "label": 1,
    "documentation": 1, "readme": 1, "comment": 1,
    "suggestion": 1, "improvement": 1, "enhancement": 1,
    "refactor": 1, "cleanup": 1, "style": 1,
}

# Stack trace patterns that indicate severity
CRITICAL_EXCEPTIONS = {
    "OutOfMemoryError", "StackOverflowError", "SegmentationFault",
    "SystemExit", "KernelPanic", "FatalError",
    "AccessViolation", "HeapCorruption",
}

HIGH_EXCEPTIONS = {
    "NullPointerException", "NullReferenceException", "TypeError",
    "AttributeError", "IndexError", "KeyError",
    "ConcurrentModificationException", "DeadlockException",
    "ConnectionError", "TimeoutError", "SocketException",
}


@dataclass
class BugFeatures:
    """Extracted feature vector from a bug report."""
    # Keyword scores (0-1 normalized)
    critical_keyword_score: float
    high_keyword_score: float
    medium_keyword_score: float
    low_keyword_score: float

    # Stack trace signals
    has_stack_trace: bool
    stack_trace_depth: int
    has_critical_exception: bool
    has_high_exception: bool

    # Content signals
    title_length: int
    description_length: int
    has_code_snippet: bool
    has_file_path: bool

    # Error pattern signals
    error_count_in_trace: int
    has_production_env: bool
    has_test_env: bool

    # Category hints
    is_crash: bool
    is_security: bool
    is_performance: bool
    is_ui: bool

    def to_vector(self) -> np.ndarray:
        """Convert to numpy array for ML model input."""
        return np.array([
            self.critical_keyword_score,
            self.high_keyword_score,
            self.medium_keyword_score,
            self.low_keyword_score,
            float(self.has_stack_trace),
            min(self.stack_trace_depth / 50.0, 1.0),  # Normalize depth
            float(self.has_critical_exception),
            float(self.has_high_exception),
            min(self.title_length / 200.0, 1.0),
            min(self.description_length / 2000.0, 1.0),
            float(self.has_code_snippet),
            float(self.has_file_path),
            min(self.error_count_in_trace / 10.0, 1.0),
            float(self.has_production_env),
            float(self.has_test_env),
            float(self.is_crash),
            float(self.is_security),
            float(self.is_performance),
            float(self.is_ui),
        ], dtype=np.float32)


def extract_features(bug: dict) -> BugFeatures:
    """Extract ML features from a raw bug report dictionary."""
    title = (bug.get("title") or "").lower()
    description = (bug.get("description") or "").lower()
    stack_trace = bug.get("stack_trace") or ""
    combined_text = f"{title} {description} {stack_trace.lower()}"

    # Keyword scoring
    critical_score = _keyword_score(combined_text, CRITICAL_KEYWORDS)
    high_score = _keyword_score(combined_text, HIGH_KEYWORDS)
    medium_score = _keyword_score(combined_text, MEDIUM_KEYWORDS)
    low_score = _keyword_score(combined_text, LOW_KEYWORDS)

    # Stack trace analysis
    trace_lines = stack_trace.strip().split("\n") if stack_trace.strip() else []
    trace_depth = len(trace_lines)
    
    has_critical_exc = any(exc in stack_trace for exc in CRITICAL_EXCEPTIONS)
    has_high_exc = any(exc in stack_trace for exc in HIGH_EXCEPTIONS)

    # Error count in trace
    error_count = len(re.findall(r'\b(error|exception|fault|panic)\b', stack_trace, re.IGNORECASE))

    # Environment detection
    env = bug.get("environment") or {}
    env_str = str(env).lower()
    has_prod = any(k in env_str for k in ["production", "prod", "live"])
    has_test = any(k in env_str for k in ["test", "staging", "dev", "development"])

    # Category detection
    category_hint = (bug.get("category_hint") or "").lower()
    is_crash = "crash" in combined_text or category_hint == "crash"
    is_security = any(k in combined_text for k in ["security", "vulnerability", "injection", "xss", "csrf"])
    is_perf = any(k in combined_text for k in ["slow", "performance", "latency", "timeout", "memory leak"])
    is_ui = any(k in combined_text for k in ["ui", "button", "layout", "css", "font", "color", "display"])

    return BugFeatures(
        critical_keyword_score=critical_score,
        high_keyword_score=high_score,
        medium_keyword_score=medium_score,
        low_keyword_score=low_score,
        has_stack_trace=bool(stack_trace.strip()),
        stack_trace_depth=trace_depth,
        has_critical_exception=has_critical_exc,
        has_high_exception=has_high_exc,
        title_length=len(bug.get("title") or ""),
        description_length=len(bug.get("description") or ""),
        has_code_snippet=bool(bug.get("code_snippet")),
        has_file_path=bool(bug.get("file_path")),
        error_count_in_trace=error_count,
        has_production_env=has_prod,
        has_test_env=has_test,
        is_crash=is_crash,
        is_security=is_security,
        is_performance=is_perf,
        is_ui=is_ui,
    )


def _keyword_score(text: str, keywords: dict[str, int]) -> float:
    """Calculate normalized keyword match score."""
    total = 0
    max_possible = sum(keywords.values())
    for keyword, weight in keywords.items():
        if keyword in text:
            total += weight
    return min(total / max(max_possible * 0.3, 1), 1.0)  # Normalize with 30% threshold
