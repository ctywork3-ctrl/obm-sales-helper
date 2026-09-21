import secrets

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.config import settings

CSRF_COOKIE = "csrf_token"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS", "TRACE"}


def _generate_token() -> str:
    return secrets.token_hex(32)


class CSRFMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method in SAFE_METHODS:
            response = await call_next(request)
            if not request.cookies.get(CSRF_COOKIE):
                token = _generate_token()
                response.set_cookie(
                    CSRF_COOKIE, token,
                    httponly=False, samesite="lax",
                    secure=request.url.scheme == "https",
                )
            return response

        # Verify CSRF on state-changing requests
        origin = request.headers.get("origin", "")
        referer = request.headers.get("referer", "")

        configured_origins = settings.ALLOWED_ORIGINS
        origin_valid = "*" in configured_origins
        if not origin_valid:
            origin_valid = any(
                origin.startswith(safe) or referer.startswith(safe)
                for safe in configured_origins
            )

        if not origin_valid:
            # Allow same-site requests from same host
            host = request.headers.get("host", "")
            if origin and not any(origin.startswith(s) for s in [f"http://{host}", f"https://{host}"]):
                return Response(
                    content='{"detail":"CSRF validation failed: invalid origin"}',
                    status_code=403,
                    media_type="application/json",
                )

        # Verify CSRF token
        cookie_token = request.cookies.get(CSRF_COOKIE, "")
        header_token = request.headers.get("x-csrf-token", "")
        form_token = ""

        content_type = request.headers.get("content-type", "")
        if "application/x-www-form-urlencoded" in content_type:
            body = await request.body()
            form_token = body.decode("utf-8", errors="ignore").split("csrf_token=")[-1].split("&")[0]

        csrf_token = header_token or form_token
        if not csrf_token or not cookie_token or not secrets.compare_digest(cookie_token, csrf_token):
            return Response(
                content='{"detail":"CSRF validation failed"}',
                status_code=403,
                media_type="application/json",
            )

        return await call_next(request)
