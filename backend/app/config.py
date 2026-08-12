from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    secret_key: str
    access_token_expire_minutes: int = 1440
    allowed_email_domains: str = ".edu"
    cors_origins: str = "http://localhost:3000"
    google_client_id: str = ""
    sentry_dsn: str = ""
    environment: str = "development"
    canary_bypass_token: str = ""
    login_max_failed_attempts: int = 5
    login_lockout_minutes: int = 15

    @property
    def allowed_email_domain_list(self) -> list[str]:
        return [d.strip() for d in self.allowed_email_domains.split(",") if d.strip()]

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    class Config:
        env_file = ".env"
        # Removing a setting shouldn't be a hard crash just because the
        # platform (Railway) or a local .env still has the now-unused env
        # var set -- ignore anything the app doesn't declare rather than
        # forbidding it.
        extra = "ignore"


settings = Settings()
