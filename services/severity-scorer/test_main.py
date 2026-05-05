"""
Severity Scorer — Unit Tests
"""

import pytest
from model import SeverityModel, SEVERITY_MAP
from features import extract_features, BugFeatures


class TestFeatureExtraction:
    def test_critical_bug(self):
        bug = {
            "title": "FATAL: Segmentation fault in production",
            "description": "Process crashed with SIGSEGV",
            "stack_trace": "SIGSEGV at 0x0000\n  at main()\n  at _start()",
            "file_path": "/src/core/engine.cpp",
            "environment": {"env": "production"},
        }
        features = extract_features(bug)
        assert features.has_critical_exception is True
        assert features.has_stack_trace is True
        assert features.critical_keyword_score > 0

    def test_low_severity_bug(self):
        bug = {
            "title": "Button color slightly off",
            "description": "The submit button uses wrong shade of blue",
        }
        features = extract_features(bug)
        assert features.has_critical_exception is False
        assert features.has_stack_trace is False

    def test_security_bug(self):
        bug = {
            "title": "SQL Injection vulnerability in login",
            "description": "User input is not sanitized, allowing SQL injection",
        }
        features = extract_features(bug)
        assert features.is_security is True

    def test_feature_vector_length(self):
        bug = {"title": "Test bug", "description": "Test"}
        features = extract_features(bug)
        vector = features.to_vector()
        assert len(vector) == 19  # 19 features in the vector


class TestSeverityModel:
    def setup_method(self):
        self.model = SeverityModel()

    def test_critical_crash(self):
        bug = {
            "title": "FATAL CRASH in production",
            "description": "Application segfault on startup",
            "stack_trace": "SIGSEGV\n  at main()\n  at init()",
            "environment": {"env": "production"},
        }
        severity, confidence = self.model.predict(bug)
        assert severity in ("critical", "high")
        assert confidence > 0.7

    def test_low_ui_bug(self):
        bug = {
            "title": "Button alignment issue",
            "description": "CSS layout problem with submit button",
        }
        severity, confidence = self.model.predict(bug)
        assert severity in ("low", "info", "medium")
        assert confidence > 0

    def test_security_vulnerability(self):
        bug = {
            "title": "XSS vulnerability in user profile",
            "description": "Stored XSS through avatar URL field",
        }
        severity, confidence = self.model.predict(bug)
        assert severity in ("critical", "high")

    def test_returns_valid_severity(self):
        bug = {"title": "Some generic bug", "description": "Something broke"}
        severity, confidence = self.model.predict(bug)
        assert severity in SEVERITY_MAP.values()
        assert 0.0 <= confidence <= 1.0


class TestCategoryClassification:
    def test_import(self):
        from main import classify_category
        assert callable(classify_category)

    def test_crash_category(self):
        from main import classify_category
        bug = {"title": "Fatal crash", "description": "segfault panic"}
        assert classify_category(bug) == "crash"

    def test_security_category(self):
        from main import classify_category
        bug = {"title": "SQL injection vulnerability"}
        assert classify_category(bug) == "security"

    def test_perf_category(self):
        from main import classify_category
        bug = {"title": "Slow API response", "description": "High latency on /api/users"}
        assert classify_category(bug) == "perf"

    def test_default_logic(self):
        from main import classify_category
        bug = {"title": "Unknown issue", "description": "Something weird"}
        assert classify_category(bug) == "logic"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
