import sys
import asyncio

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import os
import threading
import time
import webbrowser

_BASE = os.path.dirname(os.path.abspath(__file__))
_FFMPEG_DIR = os.path.join(_BASE, "ffmpeg")
if os.path.isdir(_FFMPEG_DIR):
    os.environ["PATH"] = _FFMPEG_DIR + os.pathsep + os.environ.get("PATH", "")

from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from middleware.no_cache import NoCacheStaticMiddleware
from routers import image_video as imgvid_router
from core.log import server_log, app_log

BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

@asynccontextmanager
async def lifespan(app: FastAPI):
    if sys.platform.startswith("win"):
        loop = asyncio.get_event_loop()
        def _exception_handler(loop, context):
            exc = context.get("exception")
            msg = context.get("message", "")
            if isinstance(exc, (ConnectionResetError, OSError)) and "_ProactorBasePipeTransport" in msg:
                return
            loop.default_exception_handler(context)
        loop.set_exception_handler(_exception_handler)
    yield

app = FastAPI(title="Video Editor", lifespan=lifespan)
app.add_middleware(NoCacheStaticMiddleware)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.include_router(imgvid_router.router)

@app.get("/")
async def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

@app.post("/api/log")
async def client_log(request: Request):
    """Receive log messages from the frontend logger and write to server log."""
    try:
        body = await request.json()
        msg = str(body.get("msg", ""))
        level = str(body.get("level", "info")).upper() or "INFO"
        if level not in ("INFO", "WARNING", "WARN", "ERROR", "ERR", "DEBUG", "DONE", "OK"):
            level = "INFO"
        app_log(msg, level, "Client")
    except Exception:
        pass
    return {"ok": True}

if __name__ == "__main__":
    import uvicorn
    def _open_browser():
        time.sleep(1.0)
        try:
            webbrowser.open("http://127.0.0.1:7861/")
        except Exception:
            pass
    threading.Thread(target=_open_browser, daemon=True).start()
    server_log("Server started")
    app_log("Application started", "INFO", "Server")
    try:
        uvicorn.run(app, host="127.0.0.1", port=7861, log_level="info", access_log=False)
    except KeyboardInterrupt:
        pass
