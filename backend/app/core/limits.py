"""Caps on how much data one request may carry, enforced while the body streams in (a missing or lying Content-Length
cannot get around it), so an oversized upload is cut off instead of being read into memory first."""
import json

from . import config

_TOO_BIG = json.dumps({"detail": "Request is too large"}).encode()


def limit_for(method: str, path: str) -> int:
    if method == "PUT" and "/images/" in path:
        return config.MAX_IMAGE_BYTES + 1024  # the image route gives the precise, friendlier error below this
    return config.MAX_BODY_BYTES


class BodyLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] in ("GET", "HEAD", "OPTIONS"):
            return await self.app(scope, receive, send)
        limit = limit_for(scope["method"], scope["path"])
        declared = dict(scope["headers"]).get(b"content-length", b"")
        if declared.isdigit() and int(declared) > limit:
            return await self._reject(send)

        seen = 0
        started = False

        async def counting_receive():
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > limit:
                    raise _TooLarge()
            return message

        async def tracking_send(message):
            nonlocal started
            started = started or message["type"] == "http.response.start"
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except _TooLarge:
            if not started:
                await self._reject(send)

    @staticmethod
    async def _reject(send):
        await send({"type": "http.response.start", "status": 413, "headers": [
            (b"content-type", b"application/json"), (b"content-length", str(len(_TOO_BIG)).encode()),
        ]})
        await send({"type": "http.response.body", "body": _TOO_BIG})


class _TooLarge(Exception):
    pass
