"""
eBug Severity Scorer Service

Consumes `bug.classified` events from NATS JetStream, runs the severity
scoring model (rule-based + ML hybrid), updates PostgreSQL with the
predicted severity, and publishes `bug.scored` for downstream consumers.

Architecture Position:
  bug.created → [Dedup Engine] → bug.classified → [THIS SERVICE] → bug.scored → [Root Cause Analyzer]
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

from model import SeverityModel
from features import extract_features


# ─────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────

class Config:
    nats_url: str = os.getenv("NATS_URL", "nats://localhost:4222")
    database_url: str = os.getenv("DATABASE_URL", "postgres://ebug:ebug@localhost:5432/ebug")
    model_path: str = os.getenv("MODEL_PATH", "models/severity_model.pkl")
    log_level: str = os.getenv("LOG_LEVEL", "INFO")


# ─────────────────────────────────────────────
# Database Operations
# ─────────────────────────────────────────────

class BugRepository:
    """PostgreSQL operations for bug severity updates."""

    def __init__(self, database_url: str):
        self.database_url = database_url
        self.pool = None
        self.logger = logging.getLogger("repository")

    async def init(self):
        """Initialize connection pool."""
        try:
            import asyncpg
            self.pool = await asyncpg.create_pool(self.database_url, min_size=2, max_size=10)
            self.logger.info("Database connection pool created")
        except Exception as e:
            self.logger.warning(f"Database not available: {e}. Running in standalone mode.")

    async def get_bug(self, bug_id: str) -> Optional[dict]:
        """Fetch full bug report by ID."""
        if not self.pool:
            return None
        row = await self.pool.fetchrow(
            "SELECT * FROM bug_reports WHERE id = $1", bug_id
        )
        return dict(row) if row else None

    async def update_severity(
        self, bug_id: str, severity: str, severity_score: float, category: str
    ):
        """Update bug with AI-predicted severity and category."""
        if not self.pool:
            self.logger.warning(f"No DB pool — skipping update for {bug_id}")
            return

        await self.pool.execute(
            """
            UPDATE bug_reports
            SET severity = $2,
                severity_score = $3,
                category = $4,
                status = CASE WHEN status = 'open' THEN 'triaged' ELSE status END,
                updated_at = NOW()
            WHERE id = $1
            """,
            bug_id, severity, severity_score, category,
        )
        self.logger.info(f"Updated bug {bug_id}: severity={severity}, score={severity_score:.3f}")

    async def record_activity(self, bug_id: str, action: str, old_value: str, new_value: str):
        """Record an activity log entry for the AI action."""
        if not self.pool:
            return
        await self.pool.execute(
            """
            INSERT INTO bug_activity (bug_id, actor_type, action, old_value, new_value)
            VALUES ($1, 'ai', $2, $3::jsonb, $4::jsonb)
            """,
            bug_id, action,
            json.dumps({"value": old_value}),
            json.dumps({"value": new_value}),
        )

    async def close(self):
        if self.pool:
            await self.pool.close()


# ─────────────────────────────────────────────
# Category Classifier
# ─────────────────────────────────────────────

def classify_category(bug: dict) -> str:
    """
    Classify bug into a category based on content analysis.
    Categories: crash, perf, logic, ui, security, dependency
    """
    text = f"{bug.get('title', '')} {bug.get('description', '')} {bug.get('stack_trace', '')}".lower()

    # Priority-ordered category rules
    if any(k in text for k in ["segfault", "crash", "fatal", "panic", "sigsegv", "abort"]):
        return "crash"

    if any(k in text for k in ["vulnerability", "injection", "xss", "csrf", "auth bypass", "rce"]):
        return "security"

    if any(k in text for k in ["slow", "latency", "timeout", "memory leak", "cpu", "performance"]):
        return "perf"

    if any(k in text for k in ["button", "layout", "css", "render", "display", "ui", "visual", "font"]):
        return "ui"

    if any(k in text for k in ["dependency", "package", "version", "npm", "pip", "module not found"]):
        return "dependency"

    return "logic"  # Default category


# ─────────────────────────────────────────────
# Severity Scorer Service
# ─────────────────────────────────────────────

class SeverityScorerService:
    """Main service that consumes events, scores bugs, and publishes results."""

    def __init__(self, config: Config):
        self.config = config
        self.model = SeverityModel(config.model_path)
        self.repo = BugRepository(config.database_url)
        self.logger = logging.getLogger("severity_scorer")
        self.nc: Optional[nats.NATS] = None
        self.js: Optional[JetStreamContext] = None

        # Metrics
        self.bugs_scored = 0
        self.severity_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}

    async def start(self):
        """Connect to NATS, initialize DB, and start consuming."""
        self.logger.info("Starting severity scorer service...")

        # Connect to NATS
        self.nc = await nats.connect(self.config.nats_url)
        self.js = self.nc.jetstream()

        # Initialize database
        await self.repo.init()

        # Subscribe to bug.classified events (output from dedup engine)
        sub = await self.js.subscribe(
            "bug.classified",
            queue="severity-workers",
            durable="severity-scorer",
            manual_ack=True,
        )

        # Also subscribe to direct scoring requests
        direct_sub = await self.js.subscribe(
            "bug.score.request",
            queue="severity-workers",
            durable="severity-scorer-direct",
            manual_ack=True,
        )

        self.logger.info("Severity scorer started, listening on bug.classified + bug.score.request")

        # Process messages
        async def consume(sub_iter):
            async for msg in sub_iter.messages:
                try:
                    await self.process_message(msg)
                except Exception as e:
                    self.logger.error(f"Error processing message: {e}", exc_info=True)
                    await msg.nak()

        # Run both consumers concurrently
        await asyncio.gather(
            consume(sub),
            consume(direct_sub),
        )

    async def process_message(self, msg: Msg):
        """Score a single bug's severity."""
        data = json.loads(msg.data)
        bug_id = data.get("bug_id", "")

        # Get full bug data (from message or database)
        bug = data if "title" in data else None
        if not bug:
            bug = await self.repo.get_bug(bug_id)
        if not bug:
            self.logger.warning(f"Bug {bug_id} not found, skipping")
            await msg.ack()
            return

        self.logger.info(f"Scoring bug {bug_id}: \"{bug.get('title', '')[:60]}\"")

        # Run severity model
        severity, confidence = self.model.predict(bug)

        # Classify category
        category = classify_category(bug)

        # Update database
        await self.repo.update_severity(bug_id, severity, confidence, category)
        await self.repo.record_activity(
            bug_id, "severity_scored",
            old_value="unscored",
            new_value=f"{severity} ({confidence:.2f})",
        )

        # Publish scored event for downstream (Root Cause Analyzer)
        scored_event = {
            "bug_id": bug_id,
            "severity": severity,
            "severity_score": round(confidence, 4),
            "category": category,
            "model_version": "hybrid-v1",
            "features_used": 19,  # Number of features in vector
        }

        await self.js.publish(
            "bug.scored",
            json.dumps(scored_event).encode(),
        )

        # Update metrics
        self.bugs_scored += 1
        self.severity_counts[severity] = self.severity_counts.get(severity, 0) + 1

        self.logger.info(
            f"Bug {bug_id} scored: severity={severity} confidence={confidence:.3f} "
            f"category={category} (total scored: {self.bugs_scored})"
        )

        await msg.ack()

    async def get_metrics(self) -> dict:
        """Return service metrics."""
        return {
            "bugs_scored": self.bugs_scored,
            "severity_distribution": self.severity_counts,
        }

    async def shutdown(self):
        """Graceful shutdown."""
        await self.repo.close()
        if self.nc:
            await self.nc.close()
        self.logger.info(
            f"Severity scorer shut down. Total scored: {self.bugs_scored}. "
            f"Distribution: {self.severity_counts}"
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
            self.wfile.write(b'{"status":"ok","service":"severity-scorer"}')
        else:
            self.send_response(404)
            self.end_headers()
    def log_message(self, format, *args):
        pass  # Suppress request logs

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

    service = SeverityScorerService(config)

    # Retry NATS connection with backoff
    while True:
        try:
            await service.start()
            break
        except Exception as e:
            logging.getLogger("severity_scorer").warning(
                f"NATS not available: {e}. Retrying in 30s..."
            )
            await asyncio.sleep(30)


if __name__ == "__main__":
    asyncio.run(main())
