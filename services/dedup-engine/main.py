"""
eBug Deduplication Engine

Consumes `bug.created` events from NATS JetStream, generates vector embeddings
from bug content, and queries Pinecone/Milvus for similar existing bugs.

If similarity > threshold → marks as duplicate and links to canonical bug.
If unique → stores new embedding and publishes `bug.classified`.
"""

import asyncio
import json
import logging
import os
import signal
from dataclasses import dataclass
from typing import Optional

import nats
from nats.aio.msg import Msg
from nats.js import JetStreamContext

# ─────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────

@dataclass
class Config:
    nats_url: str = os.getenv("NATS_URL", "nats://localhost:4222")
    database_url: str = os.getenv("DATABASE_URL", "postgres://ebug:ebug@localhost:5432/ebug")
    vector_db_url: str = os.getenv("VECTOR_DB_URL", "http://localhost:19530")  # Milvus default
    vector_db_type: str = os.getenv("VECTOR_DB_TYPE", "milvus")  # "milvus" or "pinecone"
    pinecone_api_key: str = os.getenv("PINECONE_API_KEY", "")
    pinecone_index: str = os.getenv("PINECONE_INDEX", "ebug-bugs")
    embedding_model: str = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    similarity_threshold: float = float(os.getenv("SIMILARITY_THRESHOLD", "0.92"))
    collection_name: str = "bug_embeddings"
    embedding_dim: int = 1536


# ─────────────────────────────────────────────
# Embedding Generator
# ─────────────────────────────────────────────

class EmbeddingGenerator:
    """Generates vector embeddings from bug report content."""

    def __init__(self, config: Config):
        self.config = config
        self.logger = logging.getLogger("embedding")

    def build_embedding_text(self, bug: dict) -> str:
        """Construct the text to embed from bug fields."""
        parts = []
        
        if bug.get("title"):
            parts.append(f"Title: {bug['title']}")
        if bug.get("description"):
            parts.append(f"Description: {bug['description']}")
        if bug.get("stack_trace"):
            # Truncate stack trace to most relevant frames
            trace_lines = bug["stack_trace"].split("\n")[:10]
            parts.append(f"Stack Trace: {chr(10).join(trace_lines)}")
        if bug.get("file_path"):
            parts.append(f"File: {bug['file_path']}")
        if bug.get("code_snippet"):
            parts.append(f"Code: {bug['code_snippet'][:500]}")
        
        return "\n".join(parts)

    async def generate(self, text: str) -> list[float]:
        """
        Generate embedding vector from text.
        
        In production, this calls OpenAI's embedding API or a self-hosted model.
        For development, returns a deterministic hash-based pseudo-embedding.
        """
        if self.config.openai_api_key:
            return await self._openai_embed(text)
        else:
            return self._hash_embed(text)

    async def _openai_embed(self, text: str) -> list[float]:
        """Call OpenAI embedding API."""
        import httpx

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://api.openai.com/v1/embeddings",
                headers={"Authorization": f"Bearer {self.config.openai_api_key}"},
                json={
                    "model": self.config.embedding_model,
                    "input": text[:8000],  # Token limit safety
                },
                timeout=30.0,
            )
            resp.raise_for_status()
            data = resp.json()
            return data["data"][0]["embedding"]

    def _hash_embed(self, text: str) -> list[float]:
        """Deterministic pseudo-embedding for development (no API key needed)."""
        import hashlib

        h = hashlib.sha512(text.encode()).hexdigest()
        # Generate dim-length vector from hash
        vector = []
        for i in range(0, min(len(h), self.config.embedding_dim * 2), 2):
            val = int(h[i:i+2], 16) / 255.0 - 0.5
            vector.append(val)
        # Pad if needed
        while len(vector) < self.config.embedding_dim:
            vector.append(0.0)
        return vector[:self.config.embedding_dim]


# ─────────────────────────────────────────────
# Vector Store — Real Milvus Implementation
# ─────────────────────────────────────────────

class VectorStore:
    """Production-ready vector store backed by Milvus for similarity search."""

    def __init__(self, config: Config):
        self.config = config
        self.logger = logging.getLogger("vector_store")
        self._initialized = False
        self._collection = None

    async def init(self):
        """Initialize the Milvus connection and ensure collection exists."""
        self.logger.info(f"Initializing vector store: {self.config.vector_db_type}")

        try:
            from pymilvus import (
                connections, utility, Collection,
                FieldSchema, CollectionSchema, DataType,
            )

            # Connect to Milvus
            connections.connect(
                alias="default",
                host=self.config.vector_db_url.replace("http://", "").split(":")[0],
                port=self.config.vector_db_url.split(":")[-1],
            )

            # Create collection if it doesn't exist
            if not utility.has_collection(self.config.collection_name):
                fields = [
                    FieldSchema(name="id", dtype=DataType.VARCHAR, is_primary=True, max_length=128),
                    FieldSchema(name="bug_id", dtype=DataType.VARCHAR, max_length=64),
                    FieldSchema(name="org_id", dtype=DataType.VARCHAR, max_length=64),
                    FieldSchema(name="category", dtype=DataType.VARCHAR, max_length=32),
                    FieldSchema(name="severity", dtype=DataType.VARCHAR, max_length=16),
                    FieldSchema(name="file_path", dtype=DataType.VARCHAR, max_length=512),
                    FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=self.config.embedding_dim),
                ]
                schema = CollectionSchema(fields=fields, description="Bug report embeddings")
                self._collection = Collection(name=self.config.collection_name, schema=schema)
                self.logger.info(f"Created Milvus collection: {self.config.collection_name}")

                # Create IVF_FLAT index for fast similarity search
                index_params = {
                    "metric_type": "COSINE",
                    "index_type": "IVF_FLAT",
                    "params": {"nlist": 128},
                }
                self._collection.create_index(field_name="embedding", index_params=index_params)
                self.logger.info("Created embedding index (IVF_FLAT / COSINE)")
            else:
                self._collection = Collection(name=self.config.collection_name)

            # Load collection into memory for search
            self._collection.load()
            self._initialized = True
            self.logger.info("Milvus vector store initialized and loaded")

        except ImportError:
            self.logger.warning("pymilvus not installed — running in stub mode (no dedup)")
            self._initialized = True
        except Exception as e:
            self.logger.warning(f"Milvus not available: {e} — running in stub mode")
            self._initialized = True

    async def search_similar(
        self, embedding: list[float], org_id: str, top_k: int = 5
    ) -> list[dict]:
        """
        Search for similar bugs by embedding vector.
        Returns list of {bug_id, score} dicts.
        """
        if not self._initialized:
            await self.init()

        if not self._collection:
            return []

        try:
            search_params = {"metric_type": "COSINE", "params": {"nprobe": 16}}

            results = self._collection.search(
                data=[embedding],
                anns_field="embedding",
                param=search_params,
                limit=top_k,
                expr=f'org_id == "{org_id}"',
                output_fields=["bug_id", "category", "severity"],
            )

            matches = []
            for hits in results:
                for hit in hits:
                    matches.append({
                        "bug_id": hit.entity.get("bug_id"),
                        "score": hit.score,
                        "category": hit.entity.get("category"),
                        "severity": hit.entity.get("severity"),
                    })

            self.logger.debug(f"Found {len(matches)} similar bugs in org {org_id}")
            return matches

        except Exception as e:
            self.logger.error(f"Milvus search failed: {e}")
            return []

    async def store_embedding(
        self, bug_id: str, org_id: str, embedding: list[float], metadata: dict
    ) -> str:
        """Store a bug's embedding in the vector database."""
        if not self._initialized:
            await self.init()

        embedding_id = f"emb_{bug_id}"

        if not self._collection:
            self.logger.debug(f"No collection — skipping store for {bug_id}")
            return embedding_id

        try:
            data = [
                [embedding_id],                              # id
                [bug_id],                                    # bug_id
                [org_id],                                    # org_id
                [metadata.get("category", "")[:32]],         # category
                [metadata.get("severity", "")[:16]],         # severity
                [metadata.get("file_path", "")[:512]],       # file_path
                [embedding],                                 # embedding vector
            ]
            self._collection.insert(data)
            self._collection.flush()
            self.logger.debug(f"Stored embedding {embedding_id} for bug {bug_id}")
        except Exception as e:
            self.logger.error(f"Failed to store embedding: {e}")

        return embedding_id


# ─────────────────────────────────────────────
# Database Operations
# ─────────────────────────────────────────────

class DedupRepository:
    """PostgreSQL operations for dedup status updates."""

    def __init__(self, database_url: str):
        self.database_url = database_url
        self.pool = None
        self.logger = logging.getLogger("dedup_repo")

    async def init(self):
        try:
            import asyncpg
            self.pool = await asyncpg.create_pool(self.database_url, min_size=2, max_size=10)
            self.logger.info("Database connection pool created")
        except Exception as e:
            self.logger.warning(f"Database not available: {e}")

    async def mark_duplicate(self, bug_id: str, canonical_id: str, similarity_score: float):
        """Mark a bug as duplicate and link to its canonical bug."""
        if not self.pool:
            return
        await self.pool.execute(
            """
            UPDATE bug_reports
            SET is_duplicate = TRUE,
                canonical_id = $2,
                similarity_score = $3,
                status = 'closed',
                updated_at = NOW()
            WHERE id = $1
            """,
            bug_id, canonical_id, similarity_score,
        )
        self.logger.info(f"Marked bug {bug_id} as duplicate of {canonical_id}")

    async def store_embedding_id(self, bug_id: str, embedding_id: str):
        """Store the embedding reference on the bug record."""
        if not self.pool:
            return
        await self.pool.execute(
            "UPDATE bug_reports SET embedding_id = $2, updated_at = NOW() WHERE id = $1",
            bug_id, embedding_id,
        )

    async def close(self):
        if self.pool:
            await self.pool.close()


# ─────────────────────────────────────────────
# Deduplication Engine
# ─────────────────────────────────────────────

class DedupEngine:
    """Core deduplication logic — the brain of the dedup service."""

    def __init__(self, config: Config):
        self.config = config
        self.embedder = EmbeddingGenerator(config)
        self.vector_store = VectorStore(config)
        self.repo = DedupRepository(config.database_url)
        self.logger = logging.getLogger("dedup_engine")
        self.nc: Optional[nats.NATS] = None
        self.js: Optional[JetStreamContext] = None

        # Metrics
        self.total_processed = 0
        self.duplicates_found = 0
        self.unique_bugs = 0

    async def start(self):
        """Connect to NATS and start consuming events."""
        self.logger.info("Starting dedup engine...")

        # Connect to NATS
        self.nc = await nats.connect(self.config.nats_url)
        self.js = self.nc.jetstream()
        
        # Initialize vector store and database
        await self.vector_store.init()
        await self.repo.init()

        # Subscribe to bug.created events
        sub = await self.js.subscribe(
            "bug.created",
            queue="dedup-workers",
            durable="dedup-engine",
            manual_ack=True,
        )

        self.logger.info("Dedup engine started, consuming bug.created events")

        async for msg in sub.messages:
            try:
                await self.process_bug(msg)
            except Exception as e:
                self.logger.error(f"Error processing bug: {e}", exc_info=True)
                await msg.nak()

    async def process_bug(self, msg: Msg):
        """Process a single bug.created event."""
        bug = json.loads(msg.data)
        bug_id = bug.get("id", "unknown")
        org_id = bug.get("org_id", "")

        self.logger.info(f"Processing bug {bug_id} for deduplication")

        # Step 1: Generate embedding
        embed_text = self.embedder.build_embedding_text(bug)
        embedding = await self.embedder.generate(embed_text)

        # Step 2: Search for similar bugs
        similar = await self.vector_store.search_similar(embedding, org_id)

        # Step 3: Check for duplicates
        duplicates = [
            s for s in similar
            if s.get("score", 0) >= self.config.similarity_threshold
        ]

        if duplicates:
            # Mark as duplicate
            canonical = duplicates[0]
            self.logger.info(
                f"Bug {bug_id} is duplicate of {canonical['bug_id']} "
                f"(score: {canonical['score']:.3f})"
            )

            # Update database
            await self.repo.mark_duplicate(
                bug_id, canonical["bug_id"], canonical["score"]
            )

            dedup_event = {
                "bug_id": bug_id,
                "canonical_id": canonical["bug_id"],
                "similarity_score": canonical["score"],
                "is_duplicate": True,
            }

            await self.js.publish(
                "bug.deduplicated",
                json.dumps(dedup_event).encode(),
            )
            self.duplicates_found += 1
        else:
            # Store new embedding and classify
            embedding_id = await self.vector_store.store_embedding(
                bug_id, org_id, embedding,
                metadata={
                    "category": bug.get("category_hint", ""),
                    "severity": bug.get("severity_hint", ""),
                    "file_path": bug.get("file_path", ""),
                },
            )

            # Update database with embedding reference
            await self.repo.store_embedding_id(bug_id, embedding_id)

            classify_event = {
                "bug_id": bug_id,
                "embedding_id": embedding_id,
                "is_duplicate": False,
            }

            await self.js.publish(
                "bug.classified",
                json.dumps(classify_event).encode(),
            )

            self.unique_bugs += 1
            self.logger.info(f"Bug {bug_id} classified as unique, embedding stored")

        self.total_processed += 1
        await msg.ack()

    async def shutdown(self):
        """Graceful shutdown."""
        await self.repo.close()
        if self.nc:
            await self.nc.close()
        self.logger.info(
            f"Dedup engine shut down. Total: {self.total_processed} | "
            f"Duplicates: {self.duplicates_found} | Unique: {self.unique_bugs}"
        )


# ─────────────────────────────────────────────
# Entrypoint
# ─────────────────────────────────────────────

async def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    config = Config()
    engine = DedupEngine(config)

    loop = asyncio.get_event_loop()
    stop_event = asyncio.Event()

    def signal_handler():
        stop_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, signal_handler)

    try:
        await engine.start()
    except asyncio.CancelledError:
        pass
    finally:
        await engine.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
