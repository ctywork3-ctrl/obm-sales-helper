import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import Base, engine
from app.api.router import api_router
from app.seed import seed_database
from app.database import async_session
from app.middleware.csrf import CSRFMiddleware
from app.middleware.rate_limit import RateLimitMiddleware


app = FastAPI(
    title="OBM Sales & Product Helper",
    description="Backend API for OBM Sales & Product Helper Web App",
    version="1.0.0",
)

app.add_middleware(CSRFMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")


@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    if os.environ.get("SEED_DEMO", "1") != "0":
        async with async_session() as db:
            await seed_database(db)


@app.get("/health")
async def health_check():
    try:
        from sqlalchemy import text
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return {"status": "healthy", "database": "ok"}
    except Exception as exc:  # pragma: no cover - surfaced in /health only
        return {"status": "degraded", "database": str(exc)}
