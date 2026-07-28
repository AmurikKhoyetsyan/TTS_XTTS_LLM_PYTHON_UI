# Developer Guide

## Environment

| Requirement | Version |
|-------------|---------|
| OS | Windows 10 / 11 |
| Python | 3.10+ |
| GPU | NVIDIA CUDA (optional — speeds XTTS and Whisper) |

```bash
# Install dependencies
pip install -r requirements.txt

# Run the app (FastAPI on http://127.0.0.1:7860)
python app.py

# Register additional OneCore voices (requires admin)
add_voices_admin.bat
```

There is **no lint step, no test runner, and no build step**. The frontend is plain ES modules served directly by FastAPI's `StaticFiles`. Edit a `.js` file, hard-refresh the browser (`Ctrl+Shift+R`) — that's it.

> The no-cache middleware (`middleware/no_cache.py`) sends `Cache-Control: no-store` for all `/static/js/` and `/static/css/` responses, so a normal refresh usually suffices.

---

## Project layout

```
tts/
├── app.py                      # Entry point — mounts all routers
├── routers/
│   └── *.py                    # One APIRouter per feature area
├── core/                       # Shared utilities (audio, history, voice, log, schemas)
├── services/                   # TTS engines + SSE helper
├── middleware/                  # ASGI no-cache middleware
└── static/
    ├── index.html
    ├── css/
    └── js/
        ├── *.js                # Shared UI components
        └── tabs/               # One module per tab
```

For a full description of each module's responsibility, see [Architecture](architecture.md).

---

## Adding a new backend route

```python
# routers/my_feature.py
from fastapi import APIRouter
router = APIRouter(prefix="/api/my-feature", tags=["my-feature"])

@router.get("/hello")
async def hello():
    return {"message": "Hello"}
```

Mount it in `app.py`:

```python
from routers import my_feature
app.include_router(my_feature.router)
```

---

## Adding a new tab

### 1. Add the tab button and panel in `index.html`

```html
<!-- Tab button (inside .tabs nav) -->
<button class="tab" data-tab="my-tab">My Tab</button>

<!-- Tab panel (inside .app-main) -->
<section class="tab-panel" data-panel="my-tab">
  <!-- tab HTML here -->
</section>
```

### 2. Create the tab module

```javascript
// static/js/tabs/my-tab.js
export function init() {
  // set up DOM listeners here
}
```

### 3. Register in `app.js`

```javascript
import { init as initMyTab } from './tabs/my-tab.js';

const inits = {
  // existing tabs ...
  'my-tab': initMyTab,
};
```

Tabs initialise lazily — only on the first click. Keep `init()` idempotent (called once, guarded by the `ready` Set).

---

## SSE streaming pattern

Use this pattern for any long-running operation (synthesis, transcription):

### Backend

```python
from services.sse import run_synth_stream
from fastapi.responses import StreamingResponse

@router.post("/my-stream")
async def my_stream(text: str = Form(...)):
    def core(text, progress=None):
        if progress: progress(0.5, "Halfway done")
        return result

    return StreamingResponse(
        run_synth_stream(core, [text]),
        media_type="text/event-stream"
    )
```

### Frontend

```javascript
import { synthesizeStream } from '../api.js';

synthesizeStream('/api/my-feature/my-stream', { body: formData }, {
  progress(value, desc) { /* update progress bar */ },
  done(payload)        { /* payload.audio_url, payload.status */ },
  error(msg)           { /* show error */ },
});
```

---

## Output directories

All output is written under `.outputs/` (created automatically on first run):

```
.outputs/
├── audio/          # TTS WAV files
├── subtitle/       # SRT files
├── logs/           # Server log files (YYYY-MM-DD.log)
└── temp/           # Temporary files (extracted audio for transcription)
```

---

## Logging

```python
from core.log import app_log

app_log("Processing started", level="INFO", source="my_feature")
```

Logs are written to `.outputs/logs/YYYY-MM-DD.log` and to stdout simultaneously.
