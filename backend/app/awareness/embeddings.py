"""Embeddings for semantic search and near-duplicate detection.

Gemini embeddings when a key is set (gemini-embedding-2, falling back to gemini-embedding-001;
text-embedding-004 was shut down in January 2026). Without a key, a local hashing embedder keeps
search working. Vectors are compared only within the same model.
For more than ~100k items, move vectors to Postgres + pgvector.
"""
from __future__ import annotations

import hashlib
import re

import numpy as np

from .base import log

WORD_RE = re.compile(r"[a-z0-9]+")


class HashingEmbedder:
    """Offline fallback: hashed word unigrams and bigrams, L2-normalized."""

    name = "hashing-512"
    dim = 512

    def embed(self, texts: list[str], kind: str = "document") -> np.ndarray:
        out = np.zeros((len(texts), self.dim), dtype=np.float32)
        for row, text in enumerate(texts):
            words = WORD_RE.findall((text or "").lower())
            grams = words + [f"{a} {b}" for a, b in zip(words, words[1:])]
            for g in grams:
                h = int(hashlib.md5(g.encode()).hexdigest()[:8], 16)
                out[row, h % self.dim] += 1.0 if (h >> 31) & 1 else -1.0
        return _normalize(out)

    async def aembed(self, texts: list[str], kind: str = "document") -> np.ndarray:
        return self.embed(texts, kind)


class GeminiEmbedder:
    def __init__(self, settings):
        from google import genai

        self.client = genai.Client(api_key=settings.gemini_api_key)
        self.models = [settings.gemini_embedding_model, settings.gemini_embedding_fallback]
        self.dim = settings.embedding_dim
        self.name = self.models[0]

    def _format(self, texts: list[str], kind: str, model: str):
        if model.startswith("gemini-embedding-2"):
            # gemini-embedding-2 takes the task as a text prefix instead of task_type
            if kind == "query":
                return [f"task: search result | query: {t}" for t in texts], None
            return [f"title: none | text: {t}" for t in texts], None
        return texts, ("RETRIEVAL_QUERY" if kind == "query" else "RETRIEVAL_DOCUMENT")

    async def aembed(self, texts: list[str], kind: str = "document") -> np.ndarray:
        from google.genai import types

        last_error = None
        for model in self.models:
            contents, task_type = self._format(texts, kind, model)
            config = types.EmbedContentConfig(output_dimensionality=self.dim, task_type=task_type)
            try:
                vectors = []
                for start in range(0, len(contents), 100):
                    result = await self.client.aio.models.embed_content(
                        model=model, contents=contents[start : start + 100], config=config
                    )
                    vectors.extend(e.values for e in result.embeddings)
                self.name = model
                return _normalize(np.array(vectors, dtype=np.float32))
            except Exception as exc:
                last_error = exc
                log.warning("embedding model %s failed: %s", model, str(exc)[:160])
        raise RuntimeError(f"all Gemini embedding models failed: {last_error}")


def _normalize(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return matrix / norms


def get_embedder(settings):
    if settings.gemini_api_key:
        try:
            return GeminiEmbedder(settings)
        except Exception as exc:
            log.warning("Gemini embeddings unavailable: %s", exc)
    return HashingEmbedder()


def to_bytes(vector: np.ndarray) -> bytes:
    return np.asarray(vector, dtype=np.float32).tobytes()


def from_bytes(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype=np.float32)
