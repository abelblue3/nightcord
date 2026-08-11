from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    secret_key: str
    access_token_expire_minutes: int = 1440
    allowed_email_domains: str = ".edu"
    cors_origins: str = "http://localhost:3000"
    resend_api_key: str = ""
    email_from: str = "nightcord <onboarding@resend.dev>"
    frontend_url: str = "http://localhost:5173"
    google_client_id: str = ""

    @property
    def allowed_email_domain_list(self) -> list[str]:
        return [d.strip() for d in self.allowed_email_domains.split(",") if d.strip()]

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    class Config:
        env_file = ".env"


settings = Settings()
