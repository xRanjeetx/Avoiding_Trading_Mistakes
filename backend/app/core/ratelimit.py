"""In-memory sliding-window rate limiter for the auth endpoints.

Counts live in this process only, so they reset when the server restarts or sleeps and are not shared between several
instances. For one small instance that is enough to stop password guessing and email flooding; with more instances,
move the counters to Redis."""
import threading
import time
from collections import deque

from fastapi import Depends, HTTPException, Request, status

from . import config

_SWEEP_EVERY = 300  # seconds between clean-ups of keys nobody has used for an hour
_KEEP = 3600


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()
        self._last_sweep = time.monotonic()

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()

    def _recent(self, key: str, window: int, now: float) -> deque[float]:
        hits = self._hits.setdefault(key, deque())
        while hits and now - hits[0] >= window:
            hits.popleft()
        return hits

    def _sweep(self, now: float) -> None:
        if now - self._last_sweep < _SWEEP_EVERY:
            return
        self._last_sweep = now
        for key in [k for k, h in self._hits.items() if not h or now - h[-1] >= _KEEP]:
            del self._hits[key]

    def blocked(self, key: str, limit: int, window: int) -> int:
        """Seconds to wait before `key` may act again, or 0. Records nothing."""
        if not config.RATE_LIMIT_ENABLED:
            return 0
        now = time.monotonic()
        with self._lock:
            hits = self._recent(key, window, now)
            return int(window - (now - hits[0])) + 1 if len(hits) >= limit else 0

    def record(self, key: str, window: int) -> None:
        if not config.RATE_LIMIT_ENABLED:
            return
        now = time.monotonic()
        with self._lock:
            self._sweep(now)
            self._recent(key, window, now).append(now)

    def hit(self, key: str, limit: int, window: int) -> int:
        """Counts one attempt. Returns 0 if allowed, else the seconds to wait (and the attempt is not counted)."""
        wait = self.blocked(key, limit, window)
        if not wait:
            self.record(key, window)
        return wait

    def clear(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)


limiter = RateLimiter()


def client_ip(request: Request) -> str:
    """The caller's address. X-Forwarded-For is only believed for the number of proxies we know are in front of us
    (config.PROXY_HOPS), counted from the right, because anything further left is written by the client."""
    hops = config.PROXY_HOPS
    if hops > 0:
        parts = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
        if len(parts) >= hops:
            return parts[-hops]
    return request.client.host if request.client else "unknown"


def too_many(wait: int) -> HTTPException:
    minutes = max(1, -(-wait // 60))
    return HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS, f"Too many attempts. Try again in {minutes} minute{'s' if minutes > 1 else ''}.",
        {"Retry-After": str(wait)},
    )


def ip_limit(name: str, limit: int, window: int):
    """Route dependency: at most `limit` calls per `window` seconds from one address."""
    def check(request: Request) -> None:
        wait = limiter.hit(f"{name}:ip:{client_ip(request)}", limit, window)
        if wait:
            raise too_many(wait)
    return Depends(check)
