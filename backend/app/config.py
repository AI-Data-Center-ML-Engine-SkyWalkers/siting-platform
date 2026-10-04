"""Settings, read from environment variables or backend/.env."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "SitewellEco²"
    database_url: str = "sqlite:///./sitewelleco.db"
    cors_origins: str = "http://localhost:5173"
    user_agent: str = "SitewellEco2Bot/0.1 (sustainable data center siting research)"
    enable_scheduler: bool = False
    enable_jetstream: bool = False

    # AI
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-3.8-flash"
    gemini_embedding_model: str = "gemini-embedding-2"
    gemini_embedding_fallback: str = "gemini-embedding-001"
    embedding_dim: int = 768
    anthropic_api_key: str | None = None
    claude_model: str = "claude-haiku-4-5-20251001"
    analysis_batch_size: int = 8
    max_text_chars: int = 2500

    # Sources
    openstates_api_key: str | None = None
    legiscan_api_key: str | None = None
    mediacloud_api_key: str | None = None
    mediacloud_collections: str = "34412234"  # US National; add state & local collection ids
    bluesky_handle: str | None = None
    bluesky_app_password: str | None = None
    bluesky_pds: str = "https://bsky.social"
    jetstream_url: str = "wss://jetstream2.us-east.bsky.network/subscribe"
    reddit_client_id: str | None = None
    reddit_client_secret: str | None = None
    reddit_subreddits: str = ""
    mastodon_instance: str = "mastodon.social"
    legistar_clients: str = ""
    rss_feeds: str = ""
    enrich_article_text: bool = True
    enrich_max_per_run: int = 40

    # Scoring integration
    scoring_provider: str = "mock"  # mock | http | python
    ml_service_url: str | None = None
    ml_python_entrypoint: str | None = None

    # Community features and re-ranking
    rerank_beta_sentiment: float = 0.3
    rerank_beta_incentive: float = 0.1
    rerank_beta_restriction: float = 0.3
    half_life_days: float = 30.0

    # Alerts
    alert_webhook_url: str | None = None

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @staticmethod
    def csv(value: str | None) -> list[str]:
        return [v.strip() for v in (value or "").split(",") if v.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
