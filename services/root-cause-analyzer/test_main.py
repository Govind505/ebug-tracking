"""
Root Cause Analyzer — Unit Tests
"""

import pytest
from prompts import render_prompt, pattern_match_analysis, KNOWN_PATTERNS
from llm_client import LLMClient


class TestPromptRendering:
    def test_basic_prompt(self):
        bug = {
            "title": "NullPointerException",
            "description": "Crash at line 42",
            "severity": "high",
            "severity_score": 0.85,
            "category": "crash",
        }
        prompt = render_prompt(bug)
        assert "NullPointerException" in prompt
        assert "high" in prompt
        assert "JSON" in prompt  # Should request JSON output

    def test_prompt_with_stack_trace(self):
        bug = {
            "title": "Error",
            "stack_trace": "at foo.bar()\nat main()",
            "severity": "medium",
            "severity_score": 0.5,
            "category": "logic",
        }
        prompt = render_prompt(bug)
        assert "foo.bar()" in prompt

    def test_prompt_with_similar_bugs(self):
        bug = {"title": "Bug", "severity": "low", "severity_score": 0.3, "category": "ui"}
        similar = [
            {"external_id": "EBUG-001", "title": "Similar bug", "severity": "low",
             "root_cause_suggestion": "CSS issue", "status": "resolved"},
        ]
        prompt = render_prompt(bug, similar)
        assert "EBUG-001" in prompt
        assert "Similar bug" in prompt


class TestPatternMatching:
    def test_null_pointer(self):
        bug = {
            "title": "NullPointerException in UserService",
            "description": "",
            "stack_trace": "java.lang.NullPointerException at UserService.getUser()",
        }
        result = pattern_match_analysis(bug)
        assert result is not None
        assert "null" in result["root_cause"].lower() or "Null" in result["root_cause"]
        assert result["source"] == "pattern_match"

    def test_timeout(self):
        bug = {
            "title": "Request timeout",
            "description": "API call deadline exceeded",
            "stack_trace": "TimeoutError: 30s timeout",
        }
        result = pattern_match_analysis(bug)
        assert result is not None
        assert result["confidence"] > 0

    def test_no_match(self):
        bug = {
            "title": "Generic issue",
            "description": "Something happened",
            "stack_trace": "",
        }
        result = pattern_match_analysis(bug)
        # May or may not match, but should not crash
        assert result is None or isinstance(result, dict)

    def test_all_patterns_have_required_fields(self):
        for pattern in KNOWN_PATTERNS:
            assert "pattern" in pattern
            assert "root_cause" in pattern
            assert "suggested_fix" in pattern
            assert "confidence" in pattern
            assert isinstance(pattern["pattern"], list)
            assert 0 <= pattern["confidence"] <= 1


class TestLLMClient:
    def test_unavailable_without_key(self):
        import os
        old = os.environ.get("LLM_API_KEY")
        os.environ.pop("LLM_API_KEY", None)
        os.environ.pop("OPENAI_API_KEY", None)
        client = LLMClient()
        assert client.is_available is False
        if old:
            os.environ["LLM_API_KEY"] = old

    def test_parse_valid_json(self):
        client = LLMClient()
        result = client._parse_response('{"root_cause": "memory leak", "confidence": 0.8}')
        assert result is not None
        assert result["root_cause"] == "memory leak"
        assert result["source"] == "llm"

    def test_parse_json_in_markdown(self):
        client = LLMClient()
        content = '```json\n{"root_cause": "null ref", "confidence": 0.7}\n```'
        result = client._parse_response(content)
        assert result is not None
        assert "null ref" in result["root_cause"]

    def test_parse_invalid_json(self):
        client = LLMClient()
        result = client._parse_response("This is not JSON at all")
        assert result is None

    def test_validate_clamps_confidence(self):
        client = LLMClient()
        result = client._validate_result({"confidence": 5.0})
        assert result["confidence"] == 1.0

        result = client._validate_result({"confidence": -1.0})
        assert result["confidence"] == 0.0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
