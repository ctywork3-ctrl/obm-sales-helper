from typing import Annotated
from pydantic import BeforeValidator
from pydantic_settings import BaseSettings
import json


def _parse_origins(v):
    if isinstance(v, list):
        return v
    if isinstance(v, str):
        v = v.strip()
        if not v:
            return ["*"]
        try:
            parsed = json.loads(v)
            if isinstance(parsed, list):
                return parsed
        except (json.JSONDecodeError, ValueError):
            pass
        return [origin.strip() for origin in v.split(",") if origin.strip()]
    return ["*"]


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/obm_sales"
    SECRET_KEY: str = "change-me-in-production-use-a-real-secret-key"
    ALLOWED_ORIGINS: Annotated[list[str], BeforeValidator(_parse_origins)] = ["http://localhost:3000", "http://localhost:5173"]
    UPLOAD_DIR: str = "uploads"
    MAX_UPLOAD_SIZE: int = 10 * 1024 * 1024  # 10MB
    SESSION_EXPIRE_MINUTES: int = 480  # 8 hours

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
    }


settings = Settings()
