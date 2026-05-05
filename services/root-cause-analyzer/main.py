"""
eBug Root Cause Analyzer Service

Consumes `bug.scored` events from NATS JetStream, performs root cause analysis
using LLM (with RAG from similar historical bugs) or pattern matching fallback,
updates PostgreSQL, and publishes `bug.triaged` — completing the AI triage pipeline.

Architecture Position (Final Stage):
  bug.created → [Dedup] → bug.classified → [Severity] → bug.scored → [THIS] → bug.triaged
"""

import asyncio
import json
import logging
import os
import signal
from typing import Optional

import nats
from nats.aio.msg import Msg
from nats.js import JetStreamContext

from llm_client import LLMClient
from prompts import render_prompt, pattern_match_analysis


# ─────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────

class Config:
    nats_url: str = os.getenv("NATS_URL", "nats://localhost:4222")
    database_url: str = os.getenv("DATABASE_URL", "postgres://ebug:ebug@localhost:5432/ebug")
    vector_db_url: str = os.getenv("VECTOR_DB_URL", "http://localhost:19530")
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    # Only analyze bugs above this severity threshold
    min_severity_for_llm: str = os.getenv("MIN_SEVERITY_FOR_LLM", "medium")
    # Max concurrent LLM calls
    max_concurrent_analyses: int = int(os.getenv("MAX_CONCURRENT_ANALYSES", "3"))


# ─────────────────────────────────────────────
# Database / RAG Repository
# ─────────────────────────────────────────────

class BugRepository:
    """Database operations for root cause analysis updates and RAG retrieval."""

    def __init__(self, database_url: str):
        self.database_url = database_url
        self.pool = None
        self.logger = logging.getLogger("repository")

    async def init(self):
        try:
            import asyncpg
            self.pool = await asyncpg.create_pool(self.database_url, min_size=2, max_size=10)
            self.logger.info("Database connection pool initialized")
        except Exception as e:
            self.logger.warning(f"Database not available: {e}")

    async def get_bug(self, bug_id: str) -> Optional[dict]:
        if not self.pool:
            return None
        row = await self.pool.fetchrow("SELECT * FROM bug_reports WHERE id = $1", bug_id)
        return dict(row) if row else None

    async def get_similar_resolved_bugs(self, category: str, org_id: str, limit: int = 5) -> list[dict]:
        """
        RAG: Retrieve similar resolved bugs for context injection into the LLM prompt.
        In production, this would use vector similarity from Milvus/Pinecone.
        For now, we use category + status matching as a proxy.
        """
        if not self.pool:
            return []

        rows = await self.pool.fetch(
            """
            SELECT id, external_id, title, severity, category, 
                   root_cause_suggestion, status, stack_trace
            FROM bug_reports
            WHERE org_id = $1
              AND category = $2
              AND status IN ('resolved', 'closed')
              AND root_cause_suggestion IS NOT NULL
            ORDER BY updated_at DESC
            LIMIT $3
            """,
            org_id, category, limit,
        )
        return [dict(r) for r in rows]

    async def update_root_cause(self, bug_id: str, analysis: dict):
        """Store the root cause analysis result."""
        if not self.pool:
            self.logger.warning(f"No DB — skipping RCA update for {bug_id}")
            return

        suggestion = analysis.get("root_cause", "")
        if analysis.get("suggested_fix"):
            suggestion += f"\n\nSuggested Fix: {analysis['suggested_fix']}"

        await self.pool.execute(
            """
            UPDATE bug_reports
            SET root_cause_suggestion = $2,
                status = CASE WHEN status IN ('open', 'triaged') THEN 'triaged' ELSE status END,
                updated_at = NOW()
            WHERE id = $1
            """,
            bug_id, suggestion,
        )

    async def record_activity(self, bug_id: str, analysis: dict):
        if not self.pool:
            return
        await self.pool.execute(
            """
            INSERT INTO bug_activity (bug_id, actor_type, action, new_value)
            VALUES ($1, 'ai', 'root_cause_analyzed', $2::jsonb)
            """,
            bug_id, json.dumps({
                "root_cause": analysis.get("root_cause", ""),
                "confidence": analysis.get("confidence", 0),
                "source": analysis.get("source", "unknown"),
            }),
        )

    async def close(self):
        if self.pool:
            await self.pool.close()


# ─────────────────────────────────────────────
# Root Cause Analyzer Service
# ─────────────────────────────────────────────

SEVERITY_ORDER = {"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}


class RootCauseAnalyzerService:
    """
    Analyzes bugs for root cause using:
    1. LLM (GPT-4 / Claude) with RAG context from similar historical bugs
    2. Pattern matching fallback when no LLM is configured
    """

    def __init__(self, config: Config):
        self.config = config
        self.llm = LLMClient()
        self.repo = BugRepository(config.database_url)
        self.logger = logging.getLogger("root_cause_analyzer")
        self.nc: Optional[nats.NATS] = None
        self.js: Optional[JetStreamContext] = None
        self.semaphore = asyncio.Semaphore(config.max_concurrent_analyses)

        # Metrics
        self.total_analyzed = 0
        self.llm_analyzed = 0
        self.pattern_analyzed = 0
        self.skipped = 0

    async def start(self):
        self.logger.info("Starting root cause analyzer...")
        self.logger.info(f"LLM available: {self.llm.is_available} (provider: {self.llm.provider})")

        self.nc = await nats.connect(self.config.nats_url)
        self.js = self.nc.jetstream()
        await self.repo.init()

        # Subscribe to bug.scored events (output from severity scorer)
        sub = await self.js.subscribe(
            "bug.scored",
            queue="rca-workers",
            durable="root-cause-analyzer",
            manual_ack=True,
        )

        self.logger.info("Root cause analyzer started, listening on bug.scored")

        async for msg in sub.messages:
            try:
                await self.process_message(msg)
            except Exception as e:
                self.logger.error(f"Error processing message: {e}", exc_info=True)
                await msg.nak()

    async def process_message(self, msg: Msg):
        """Process a single bug.scored event."""
        data = json.loads(msg.data)
        bug_id = data.get("bug_id", "")
        severity = data.get("severity", "medium")
        category = data.get("category", "logic")

        # Skip low-priority bugs for LLM analysis (save cost)
        min_level = SEVERITY_ORDER.get(self.config.min_severity_for_llm, 2)
        use_llm = SEVERITY_ORDER.get(severity, 2) >= min_level and self.llm.is_available

        # Get full bug data
        bug = await self.repo.get_bug(bug_id)
        if not bug:
            # If no DB, use the scored event data
            bug = data
        else:
            bug = dict(bug)
            bug["severity"] = severity
            bug["category"] = category

        self.logger.info(
            f"Analyzing bug {bug_id} (severity={severity}, category={category}, "
            f"method={'llm' if use_llm else 'pattern'})"
        )

        analysis = None

        if use_llm:
            async with self.semaphore:
                analysis = await self._llm_analyze(bug, category)
                if analysis:
                    self.llm_analyzed += 1

        # Fallback to pattern matching
        if not analysis:
            analysis = pattern_match_analysis(bug)
            if analysis:
                self.pattern_analyzed += 1

        # If no analysis possible, provide a generic response
        if not analysis:
            analysis = {
                "root_cause": "Automated analysis could not determine a specific root cause. Manual investigation recommended.",
                "suggested_fix": "Review the stack trace and code context for anomalies.",
                "affected_components": [],
                "confidence": 0.1,
                "additional_investigation": [
                    "Check recent code changes in the affected file",
                    "Review related test failures",
                    "Check dependency version changes",
                ],
                "source": "fallback",
            }
            self.skipped += 1

        # Persist analysis
        await self.repo.update_root_cause(bug_id, analysis)
        await self.repo.record_activity(bug_id, analysis)

        # Publish final triaged event — this completes the AI pipeline
        triaged_event = {
            "bug_id": bug_id,
            "severity": severity,
            "severity_score": data.get("severity_score", 0),
            "category": category,
            "root_cause": analysis["root_cause"],
            "suggested_fix": analysis.get("suggested_fix", ""),
            "confidence": analysis.get("confidence", 0),
            "analysis_source": analysis.get("source", "unknown"),
        }

        await self.js.publish("bug.triaged", json.dumps(triaged_event).encode())

        self.total_analyzed += 1
        self.logger.info(
            f"Bug {bug_id} triaged: source={analysis.get('source', '?')} "
            f"confidence={analysis.get('confidence', 0):.2f} "
            f"(total: {self.total_analyzed})"
        )

        await msg.ack()

    async def _llm_analyze(self, bug: dict, category: str) -> Optional[dict]:
        """Run LLM-based analysis with RAG context."""
        # RAG: Retrieve similar resolved bugs for context
        org_id = bug.get("org_id", "")
        similar_bugs = await self.repo.get_similar_resolved_bugs(category, org_id)

        # Render prompt with bug + historical context
        prompt = render_prompt(bug, similar_bugs)

        self.logger.debug(f"LLM prompt length: {len(prompt)} chars")

        # Call LLM
        result = await self.llm.analyze(prompt)
        if result:
            result["rag_context_count"] = len(similar_bugs)

        return result

    async def shutdown(self):
        await self.repo.close()
        if self.nc:
            await self.nc.close()
        self.logger.info(
            f"Root cause analyzer shut down. "
            f"Total: {self.total_analyzed} | LLM: {self.llm_analyzed} | "
            f"Pattern: {self.pattern_analyzed} | Skipped: {self.skipped}"
        )


# ─────────────────────────────────────────────
# HTTP Health Server (required by Render)
# ─────────────────────────────────────────────

import threading
from http.server import HTTPServer, BaseHTTPRequestHandler

class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok","service":"root-cause-analyzer"}')
        else:
            self.send_response(404)
            self.end_headers()
    def log_message(self, format, *args):
        pass

def start_health_server():
    port = int(os.getenv("PORT", "10000"))
    server = HTTPServer(("0.0.0.0", port), HealthHandler)
    logging.getLogger("health").info(f"Health server on port {port}")
    server.serve_forever()


# ─────────────────────────────────────────────
# Entrypoint
# ─────────────────────────────────────────────

async def main():
    config = Config()
    logging.basicConfig(
        level=getattr(logging, config.log_level),
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    # Start HTTP health server in background thread
    health_thread = threading.Thread(target=start_health_server, daemon=True)
    health_thread.start()

    service = RootCauseAnalyzerService(config)

    # Retry NATS connection with backoff
    while True:
        try:
            await service.start()
            break
        except Exception as e:
            logging.getLogger("root_cause_analyzer").warning(
                f"NATS not available: {e}. Retrying in 30s..."
            )
            await asyncio.sleep(30)


if __name__ == "__main__":
    asyncio.run(main())
