import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .core import config
from .core.limits import BodyLimitMiddleware
from .core.observability import setup_logging, setup_sentry
from .core.db import SessionLocal
from .core.migrations import run_migrations
from .routers import admin, auth, checklists, entries, images, library, news_calendar, settings, twofactor
from .routers.checklists import sync_checklists
from .routers.library import sync_library

setup_logging()
setup_sentry()
config.check_production()  # in production, refuse to start with unsafe settings (default secret key, localhost CORS, SQLite)


@asynccontextmanager
async def lifespan(_: FastAPI):
    run_migrations()  # a failure here stops the start-up on purpose: never serve with a half-upgraded schema
    try:
        with SessionLocal() as db:
            sync_library(db)  # the PDFs in the library folder become the Learning books
    except Exception:
        logging.getLogger("tradeguard.library").exception("Could not load the library folder; the app starts without it")
    try:
        with SessionLocal() as db:
            sync_checklists(db)  # data/checklists.json becomes the Learning checklists
    except Exception:
        logging.getLogger("tradeguard.checklists").exception("Could not load the checklists; the app starts without them")
    yield


# The interactive API docs are only for development; in production they just advertise the API's shape.
app = FastAPI(
    title="Trade Guard API", lifespan=lifespan,
    docs_url=None if config.IS_PRODUCTION else "/docs",
    redoc_url=None if config.IS_PRODUCTION else "/redoc",
    openapi_url=None if config.IS_PRODUCTION else "/openapi.json",
)
app.add_middleware(BodyLimitMiddleware)  # first, so it sits closest to the routes and its 413 still gets CORS and security headers
if config.TRUSTED_HOSTS:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=config.TRUSTED_HOSTS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,  # the refresh cookie travels with the auth calls when the web app is on another domain
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)

# Sent on every response. HSTS and the CSP are production-only: HSTS is meaningless over plain http, and the CSP would
# block the Swagger UI that development exposes at /docs.
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}
if config.IS_PRODUCTION:
    SECURITY_HEADERS["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    SECURITY_HEADERS["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    for name, value in SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    if request.url.path.startswith("/api/auth/"):  # tokens and account state must never sit in a shared or browser cache
        response.headers.setdefault("Cache-Control", "no-store")
    return response


app.include_router(admin.router)
app.include_router(library.router)
app.include_router(checklists.router)
app.include_router(images.router)
app.include_router(news_calendar.router)
app.include_router(auth.router)
app.include_router(twofactor.router)
app.include_router(settings.router)
app.include_router(entries.router)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    # The default handler echoes the rejected value back. That breaks for NaN (not valid JSON, so a 500)
    # and would send a submitted password back in the response.
    detail = [{"type": e["type"], "loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()]
    return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, content={"detail": detail})


@app.get("/api/health")
def health():
    return {"ok": True}
