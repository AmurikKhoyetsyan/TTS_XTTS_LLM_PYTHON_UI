# Architecture

## Overview

TTS Studio is a local, offline web application. The backend is **FastAPI** (Python); the frontend is hand-written **HTML / CSS / ES modules** — no React, no Gradio, no bundler.

```
Browser  ←→  FastAPI (Uvicorn, port 7860)
                 │
                 ├── /static/*         served from static/
                 └── /api/*            6 APIRouter modules
```

---

## Backend

### Entry point — `app.py`

- Forces UTF-8 stdout/stderr (prevents Cyrillic crash on cp1251 consoles)
- Applies `middleware/no_cache.py` — pure ASGI middleware that adds `Cache-Control: no-store` to all `/static/js/` and `/static/css/` responses
- Mounts 6 `APIRouter` modules under `/api/*` and starts Uvicorn on port 7860
- Opens the browser automatically on startup

### Routers (`routers/`)

| File | Prefix | Responsibility |
|------|--------|----------------|
| `voices.py` | `/api/voices` | Windows SAPI voice list; saved voice profiles CRUD + WAV serve |
| `synthesis.py` | `/api/synthesize` | SSE synthesis streams (windows / xtts / saved) |
| `xtts.py` | `/api/xtts` | XTTS install status + language map |
| `history.py` | `/api/history` | Audio file browser: list / play / rename / delete |
| `subtitles.py` | `/api/subtitles` | SRT file CRUD |
| `transcribe.py` | `/api/transcribe` | Whisper speech-to-text transcription |

### Core (`core/`)

| File | Role |
|------|------|
| `audio.py` | WAV I/O; `save_named_audio()` writes to `.outputs/audio/` with timestamp filename |
| `history_manager.py` | List / load / rename / delete files in `.outputs/audio/` |
| `voice_manager.py` | Saved voices CRUD under `saved_voices/` |
| `log.py` | `app_log(msg, level, source)` — writes to stdout + `.outputs/logs/YYYY-MM-DD.log`; `print_progress()` — terminal progress bar |
| `schemas.py` | Pydantic shared models (`RenameBody`, `SaveSRTBody`) |

### Services (`services/`)

| File | Role |
|------|------|
| `tts_windows.py` | pyttsx3 (SAPI) synthesis. Russian voices sorted first, default Irina. Accepts `progress=None` callback. |
| `tts_xtts.py` | Coqui XTTS v2. Lazy-loads ~1.8 GB model on first call. Monkey-patches `torch.load` (weights_only=False) and `Xtts.load_checkpoint` (strict=False) for compatibility. |
| `sse.py` | `run_synth_stream(core_fn, args)` runs synthesis in a worker thread. Progress is pushed through a `queue.Queue` and yielded as SSE frames. `sse_frame(event, data)` formats a single frame. |

### SSE streaming pattern

```
POST /api/synthesize/*
  │
  └── worker thread: core_fn(*args, progress=callback)
        │   callback(value, desc) → queue.put(("progress", value, desc))
        └── async generator → yields SSE frames:

event: progress
data: {"value": 0.45, "desc": "Синтез слова 5/10"}

event: done
data: {"audio_url": "/api/history/<name>/audio", "filename": "<name>", "status": "✓ Готово"}

event: error
data: {"status": "❌ Ошибка: ..."}
```

---

## Frontend

### Entry point — `static/index.html`

Single-page HTML file containing all 5 tab panels plus modal markup. Loaded once; tab content is rendered by JS modules.

### Shared utilities (`static/js/`)

| File | Role |
|------|------|
| `app.js` | Entry — lazy tab init. Only Windows tab initialises on load; others init on first click. Tracked in a `ready` Set to prevent re-init. |
| `api.js` | `fetch` wrappers and `synthesizeStream()` — parses `event: ... / data: ...` frames from a `ReadableStream`. Handlers: `progress(value, desc)`, `done(payload)`, `error(msg)`. |
| `audio-manager.js` | Singleton that ensures exactly one `AudioPlayer` plays at a time. `subscribe(fn)` returns an unsubscribe function. |
| `audio-player.js` | Custom `<audio>` wrapper — waveform drag-to-scrub, seekbar with progress fill, skip ±5 s, speed presets, download. |
| `wave-renderer.js` | Canvas waveform renderer used by `AudioPlayer`. |
| `custom-select.js` | Dropdown component with optional action icons. |
| `file-upload.js` | Drag-and-drop single-file upload component. |
| `loader.js` | `withLoader()` spinner overlay + `makeSkeleton()` helpers. |
| `events.js` | Cross-tab `EventTarget` bus: `voices-changed`, `history-changed`, `subtitles-changed`. |
| `icons.js` | Inline SVG strings (single source of truth for all icons). |
| `logger.js` | Floating draggable progress panel + terminal progress bar. |
| `modal.js` | Promise-based `openConfirm()` / `openPrompt()`. Escape closes, Enter confirms. |
| `tabs.js` | Tab switching (calls `audioManager.stopAll()`). |
| `toast.js` | Transient notifications (info / ok / warn / err). |

### Tab modules (`static/js/tabs/`)

| File | Tab |
|------|-----|
| `windows.js` | Windows SAPI5 TTS + optional subtitle generation |
| `cloning.js` | XTTS v2 upload + voice save |
| `saved.js` | Saved voices library + synthesis |
| `subtitles.js` | SRT editor + Whisper transcription |
| `history.js` | Section switcher: audio / subtitles |

---

## Output directories

```
.outputs/
├── audio/           # Synthesised WAV files
├── subtitle/        # SRT files
├── logs/            # Server log files (YYYY-MM-DD.log)
└── temp/            # Temporary files (extracted audio for transcription)
```
