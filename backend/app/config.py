from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    allowed_email_domains: str = ".edu"
    cors_origins: str = "http://localhost:3000"
    # Clerk (sign-up, sign-in, email verification). The secret key calls
    # Clerk's Backend API; the JWT key is the instance's public key (PEM, from
    # Dashboard -> API keys), used to verify session tokens without a network
    # call. A single-line value with literal "\n"s is accepted, since some
    # hosts can't store multi-line variables.
    clerk_secret_key: str = ""
    clerk_jwt_key: str = ""
    clerk_api_url: str = "https://api.clerk.com/v1"
    campus_time_api_url: str = "https://campus-time.replit.app"
    sentry_dsn: str = ""
    # Secure by default: a deploy that forgets to set ENVIRONMENT must not get
    # the dev-only gate bypass or public API docs.
    environment: str = "production"
    canary_bypass_token: str = ""

    @property
    def allowed_email_domain_list(self) -> list[str]:
        return [d.strip() for d in self.allowed_email_domains.split(",") if d.strip()]

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def clerk_jwt_public_key(self) -> str:
        return self.clerk_jwt_key.replace("\\n", "\n").strip()

    class Config:
        env_file = ".env"
        # Removing a setting shouldn't be a hard crash just because the
        # platform (Railway) or a local .env still has the now-unused env
        # var set -- ignore anything the app doesn't declare rather than
        # forbidding it.
        extra = "ignore"


settings = Settings()
