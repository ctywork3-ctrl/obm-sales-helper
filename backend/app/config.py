import os


class Settings:
    DATABASE_URL: str = os.environ.get("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/obm_sales")
    SECRET_KEY: str = os.environ.get("SECRET_KEY", "change-me-in-production-use-a-real-secret-key")
    UPLOAD_DIR: str = os.environ.get("UPLOAD_DIR", "uploads")
    MAX_UPLOAD_SIZE: int = int(os.environ.get("MAX_UPLOAD_SIZE", "10485760"))
    SESSION_EXPIRE_MINUTES: int = int(os.environ.get("SESSION_EXPIRE_MINUTES", "480"))

    @property
    def ALLOWED_ORIGINS(self) -> list[str]:
        raw = os.environ.get("ALLOWED_ORIGINS", "")
        if not raw:
            return ["*"]
        import json
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return parsed
        except (json.JSONDecodeError, ValueError):
            pass
        return [o.strip() for o in raw.split(",") if o.strip()]


settings = Settings()
