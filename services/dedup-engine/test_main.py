"""
Dedup Engine — Unit Tests
"""

import json
import pytest
import hashlib
from unittest.mock import AsyncMock, MagicMock, patch
from main import Config, EmbeddingGenerator, DedupEngine


class TestConfig:
    def test_default_values(self):
        config = Config()
        assert config.similarity_threshold == 0.92
        assert config.collection_name == "bug_embeddings"
        assert config.embedding_dim == 1536

    def test_vector_db_type(self):
        config = Config()
        assert config.vector_db_type in ("milvus", "pinecone")


class TestEmbeddingGenerator:
    def setup_method(self):
        self.config = Config()
        self.generator = EmbeddingGenerator(self.config)

    def test_build_embedding_text(self):
        bug = {
            "title": "NullPointerException in UserService",
            "description": "Crash when user is None",
            "stack_trace": "at UserService.getUser()\nat Handler.handle()",
            "file_path": "/src/services/user.py",
            "code_snippet": "user = get_user(id)",
        }
        text = self.generator.build_embedding_text(bug)
        assert "NullPointerException" in text
        assert "UserService" in text
        assert "/src/services/user.py" in text

    def test_build_embedding_text_minimal(self):
        bug = {"title": "Simple bug"}
        text = self.generator.build_embedding_text(bug)
        assert "Simple bug" in text

    def test_hash_embed_deterministic(self):
        text = "Test bug report"
        v1 = self.generator._hash_embed(text)
        v2 = self.generator._hash_embed(text)
        assert v1 == v2

    def test_hash_embed_dimension(self):
        text = "Test embedding"
        vector = self.generator._hash_embed(text)
        assert len(vector) == self.config.embedding_dim

    def test_hash_embed_different_texts_differ(self):
        v1 = self.generator._hash_embed("Bug one")
        v2 = self.generator._hash_embed("Bug two completely different")
        assert v1 != v2


class TestDedupEngineUnit:
    def test_config_threshold(self):
        config = Config()
        config.similarity_threshold = 0.95
        engine = DedupEngine(config)
        assert engine.config.similarity_threshold == 0.95

    def test_metrics_initial(self):
        config = Config()
        engine = DedupEngine(config)
        assert engine.total_processed == 0
        assert engine.duplicates_found == 0
        assert engine.unique_bugs == 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
