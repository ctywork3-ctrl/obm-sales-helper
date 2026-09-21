import time
from collections import defaultdict
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

# Exact paths -> (max requests, window seconds).
RATE_LIMITS = {
    "/api/auth/login": (5, 60),
    "/api/store/auth/login": (5, 60),
    "/api/store/auth/register": (3, 300),
}

# Path PREFIXES -> (max requests, window seconds). Needed because a rate limit on
# a path that carries a value ("/api/warranty/check/<serial>") can never be
# expressed as an exact match - every serial is a different URL. The prefix is
# what protects the endpoint from being walked with guessed serials.
RATE_LIMIT_PREFIXES = {
    "/api/public/warranty/": (20, 60),
}

_ip_requests = defaultdict(list)


def _limit_for(path: str) -> tuple[int, int] | None:
    if path in RATE_LIMITS:
        return RATE_LIMITS[path]
    for prefix, limits in RATE_LIMIT_PREFIXES.items():
        if path.startswith(prefix):
            return limits
    return None


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        client_ip = request.client.host if request.client else "unknown"

        limits = _limit_for(path)
        if limits is None:
            return await call_next(request)

        max_requests, window = limits
        now = time.time()
        # For a prefix rule, bucket the whole prefix rather than each URL, or the
        # limit resets every time the attacker changes the serial.
        bucket = path
        if path not in RATE_LIMITS:
            for prefix in RATE_LIMIT_PREFIXES:
                if path.startswith(prefix):
                    bucket = prefix
                    break
        key = f"{client_ip}:{bucket}"
        _ip_requests[key] = [t for t in _ip_requests[key] if now - t < window]
        _ip_requests[key].append(now)

        if len(_ip_requests[key]) > max_requests:
            return Response(
                content='{"detail":"Too many requests. Please try again later."}',
                status_code=429,
                media_type="application/json",
                headers={"Retry-After": str(window)},
            )

        return await call_next(request)
