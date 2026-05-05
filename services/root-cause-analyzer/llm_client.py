"""
LLM Client for Root Cause Analysis.

Supports multiple LLM providers:
- OpenAI GPT-4 / GPT-4o
- Anthropic Claude
- Self-hosted models via OpenAI-compatible APIs (vLLM, Ollama)

Falls back to pattern-matching when no LLM is configured.
"""

import json
import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger("llm_client")


class LLMClient:
    """Multi-provider LLM client for root cause analysis."""

    def __init__(self):
        self.provider = os.getenv("LLM_PROVIDER", "openai")  # openai, anthropic, custom
        self.api_key = os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY", "")
        self.model = os.getenv("LLM_MODEL", "gpt-4o")
        self.base_url = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
        self.max_tokens = int(os.getenv("LLM_MAX_TOKENS", "1024"))
        self.temperature = float(os.getenv("LLM_TEMPERATURE", "0.2"))
        self.timeout = float(os.getenv("LLM_TIMEOUT", "60"))

    @property
    def is_available(self) -> bool:
        return bool(self.api_key)

    async def analyze(self, prompt: str) -> Optional[dict]:
        """
        Send prompt to LLM and parse the JSON response.
        Returns parsed root cause analysis dict or None on failure.
        """
        if not self.is_available:
            logger.debug("No LLM API key configured, skipping")
            return None

        try:
            if self.provider == "anthropic":
                return await self._call_anthropic(prompt)
            else:
                return await self._call_openai(prompt)
        except Exception as e:
            logger.error(f"LLM call failed: {e}")
            return None

    async def _call_openai(self, prompt: str) -> Optional[dict]:
        """Call OpenAI-compatible API (works with vLLM, Ollama too)."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are an expert software debugging assistant. Always respond with valid JSON.",
                        },
                        {"role": "user", "content": prompt},
                    ],
                    "max_tokens": self.max_tokens,
                    "temperature": self.temperature,
                    "response_format": {"type": "json_object"},
                },
            )
            response.raise_for_status()
            data = response.json()

            content = data["choices"][0]["message"]["content"]
            return self._parse_response(content)

    async def _call_anthropic(self, prompt: str) -> Optional[dict]:
        """Call Anthropic Claude API."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": self.api_key,
                    "Content-Type": "application/json",
                    "anthropic-version": "2023-06-01",
                },
                json={
                    "model": self.model,
                    "max_tokens": self.max_tokens,
                    "temperature": self.temperature,
                    "system": "You are an expert software debugging assistant. Always respond with valid JSON.",
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            response.raise_for_status()
            data = response.json()

            content = data["content"][0]["text"]
            return self._parse_response(content)

    def _parse_response(self, content: str) -> Optional[dict]:
        """Extract and validate JSON from LLM response."""
        try:
            # Try direct JSON parse
            result = json.loads(content)
            return self._validate_result(result)
        except json.JSONDecodeError:
            pass

        # Try extracting JSON from markdown code block
        import re
        json_match = re.search(r'```(?:json)?\s*\n(.*?)\n```', content, re.DOTALL)
        if json_match:
            try:
                result = json.loads(json_match.group(1))
                return self._validate_result(result)
            except json.JSONDecodeError:
                pass

        logger.warning(f"Failed to parse LLM response as JSON: {content[:200]}")
        return None

    def _validate_result(self, result: dict) -> dict:
        """Ensure the result has expected fields with defaults."""
        return {
            "root_cause": result.get("root_cause", "Unable to determine root cause"),
            "suggested_fix": result.get("suggested_fix", "Further investigation required"),
            "affected_components": result.get("affected_components", []),
            "confidence": min(max(float(result.get("confidence", 0.5)), 0.0), 1.0),
            "additional_investigation": result.get("additional_investigation", []),
            "source": "llm",
        }
