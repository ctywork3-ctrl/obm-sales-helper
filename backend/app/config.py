import os
from pathlib import Path

# Load backend/.env before anything reads os.environ.
#
# This was missing, which meant the documented rule "secrets live only in
# backend/.env" was not actually true: the file was read by nobody, and every
# setting silently fell back to the placeholder defaults here (so the running app
# used SECRET_KEY="change-me-in-production-..." and ALLOWED_ORIGINS=["*"] while
# .env said otherwise). Loading it makes the file mean what it says.
#
# Values already present in the real environment still win, so a shell export or
# a container's env vars override the file, which is what you want.
try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:  # pragma: no cover - dotenv is a declared dependency
    pass


class Settings:
    DATABASE_URL: str = os.environ.get("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/obm_sales")
    SECRET_KEY: str = os.environ.get("SECRET_KEY", "change-me-in-production-use-a-real-secret-key")
    UPLOAD_DIR: str = os.environ.get("UPLOAD_DIR", "uploads")
    PRIVATE_UPLOAD_DIR: str = os.environ.get("PRIVATE_UPLOAD_DIR", "private_uploads")
    MAX_UPLOAD_SIZE: int = int(os.environ.get("MAX_UPLOAD_SIZE", "10485760"))
    SESSION_EXPIRE_MINUTES: int = int(os.environ.get("SESSION_EXPIRE_MINUTES", "480"))

    HITPAY_API_KEY: str = os.environ.get("HITPAY_API_KEY", "")
    HITPAY_API_SECRET: str = os.environ.get("HITPAY_API_SECRET", "")
    HITPAY_WEBHOOK_SECRET: str = os.environ.get("HITPAY_WEBHOOK_SECRET", "")
    HITPAY_MERCHANT_ID: str = os.environ.get("HITPAY_MERCHANT_ID", "")
    HITPAY_API_URL: str = os.environ.get("HITPAY_API_URL", "https://api.hitpay.me/v1")
    STOREFRONT_URL: str = os.environ.get("STOREFRONT_URL", "http://localhost:3000")
    BACKEND_URL: str = os.environ.get("BACKEND_URL", "http://localhost:8001")
    STORE_SESSION_EXPIRE_DAYS: int = int(os.environ.get("STORE_SESSION_EXPIRE_DAYS", "30"))

    # AI document reading (OpenAI-compatible /chat/completions endpoint).
    # Keys are loaded from the environment only — never hardcoded.
    AI_BASE_URL: str = os.environ.get("AI_BASE_URL", "")
    AI_API_KEY: str = os.environ.get("AI_API_KEY", "")
    AI_MODEL: str = os.environ.get("AI_MODEL", "")

    # Direct read of OBM's Firebird database, so purchase orders do not have to
    # be exported to CSV by hand. Read-only: the app never writes to OBM.
    #
    # ISQL is the isql.exe inside the OBM installation. Driving that rather than
    # a Python driver avoids a 32/64-bit client mismatch (OBM ships a 32-bit
    # fbclient) and keeps working across Firebird versions.
    # Credentials default to a stock OBM install; override in .env.
    OBM_FIREBIRD_ISQL: str = os.environ.get(
        "OBM_FIREBIRD_ISQL",
        r"C:\Program Files (x86)\Firebird\Firebird_2_5\bin\isql.exe",
    )
    OBM_FIREBIRD_DATABASE: str = os.environ.get("OBM_FIREBIRD_DATABASE", "")
    OBM_FIREBIRD_USER: str = os.environ.get("OBM_FIREBIRD_USER", "SYSDBA")
    OBM_FIREBIRD_PASSWORD: str = os.environ.get("OBM_FIREBIRD_PASSWORD", "masterkey")
    OBM_FIREBIRD_TIMEOUT: int = int(os.environ.get("OBM_FIREBIRD_TIMEOUT", "90"))

    # The public warranty page. OFF by default: the business decided managers and
    # sales checking internally is enough, so the endpoint is not exposed unless
    # someone deliberately turns it on.
    PUBLIC_WARRANTY_ENABLED: bool = (
        os.environ.get("PUBLIC_WARRANTY_ENABLED", "false").strip().lower()
        in ("1", "true", "yes", "on")
    )

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
