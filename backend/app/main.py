import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .core import config
from .core.db import Base, SessionLocal, engine
from .core.migrations import ensure_columns
from .routers import admin, auth, entries, images, library, news_calendar, settings
from .routers.library import sync_library


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    ensure_columns(engine)
    try:
        with SessionLocal() as db:
            sync_library(db)  # the PDFs in the library folder become the Learning books
    except Exception:
        logging.getLogger("tradeguard.library").exception("Could not load the library folder; the app starts without it")
    yield


app = FastAPI(title="Trade Guard API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(admin.router)
app.include_router(library.router)
app.include_router(images.router)
app.include_router(news_calendar.router)
app.include_router(auth.router)
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
