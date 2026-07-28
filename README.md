# TTS Studio — Text-to-Speech & Voice Cloning (Windows)

> **Offline speech synthesis · neural voice cloning · subtitle editor**  
> Runs 100% locally. No API keys. No cloud.

[![Python](https://img.shields.io/badge/Python-3.10+-blue)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688)](https://fastapi.tiangolo.com/)
[![XTTS v2](https://img.shields.io/badge/Voice%20Cloning-XTTS%20v2-green)](https://github.com/coqui-ai/TTS)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-blue)](https://www.microsoft.com/windows)

---

## Documentation

| Document | Description |
|----------|-------------|
| [User Guide](docs/user-guide.md) | How to use each tab — TTS, cloning, subtitles, history |
| [Architecture](docs/architecture.md) | Backend routers, service packages, frontend modules, SSE pipeline |
| [API Reference](docs/api.md) | All endpoints, request/response schemas |
| [Developer Guide](docs/developer-guide.md) | Adding routes, tabs; SSE pattern |

---

## What is this?

A local **text-to-speech web app** with five tabs, served by **FastAPI** and a hand-written **HTML / CSS / ES-module** frontend — no React, no Gradio, no external UI framework.

| Tab | What it does |
|-----|-------------|
| **Windows голоса** | TTS with Windows SAPI / OneCore built-in voices |
| **Клонирование (XTTS v2)** | Zero-shot neural voice cloning from a 10–30 s audio sample |
| **Мои голоса** | Library of saved voice profiles — synthesise without re-uploading |
| **Субтитры** | SRT subtitle editor with Whisper transcription |
| **История** | File browser for audio and subtitles — with live search |

---

## Features

- **Windows TTS** — SAPI5 / OneCore voices, adjustable rate and volume, optional SRT generation
- **XTTS v2 voice cloning** — Coqui neural TTS, 8 languages, GPU-accelerated (CPU fallback)
- **Whisper transcription** — speech-to-text from audio files; auto-populates the subtitle editor
- **Custom audio player** — waveform drag-to-scrub, synchronized seekbar with progress fill, skip ±5 s, speed 0.5×–2×, download
- **SSE streaming** — real-time synthesis progress in the browser

---

## Requirements

| Component | Version |
|-----------|---------|
| OS | Windows 10 / 11 |
| Python | 3.10+ |
| GPU | NVIDIA CUDA (optional — speeds up XTTS and Whisper) |
| Disk | ~700 MB base (includes Whisper model) · ~4 GB with XTTS v2 model |

> **Note:** `openai-whisper` is included in `requirements.txt` and installed automatically. The Whisper `base` model (~140 MB) is downloaded on first use.

---

## Installation

### 1. Clone or download

```
git clone https://github.com/AmurKhoyetsyan/tts.git
cd tts
```

### 2. Run the installer

Double-click **`install.bat`**. It will:
- Find Python automatically (PATH → py launcher → common install paths)
- Install all packages from `requirements.txt`
- Check if XTTS v2 is installed — installs it if not, skips if already present

### 3. (Optional) Unlock additional Windows voices

Windows hides OneCore voices (Irina, Pavel, …) from SAPI by default.  
Run **once as administrator**:

```
add_voices_admin.bat
```

Restart the app after running — new voices appear in the dropdown.

---

## Running

Double-click **`run.bat`**, or:

```bash
python app.py
```

The server starts at **http://127.0.0.1:7860** and opens the browser automatically.  
Stop with `Ctrl+C`.

---

## Project Structure

```
tts/
├── app.py                            # FastAPI entry point, middleware, router mounting
├── requirements.txt
├── install.bat / run.bat / add_voices_admin.bat / install_xtts.bat
├── README.md                         # This file
├── DOCUMENTATION.md                  # Full Russian-language reference documentation
│
├── docs/
│   ├── architecture.md               # Backend routers, services, frontend modules
│   ├── api.md                        # All API endpoints and data schemas
│   ├── user-guide.md                 # Per-tab usage guide
│   └── developer-guide.md            # Adding routes, tabs, SSE patterns
│
├── routers/
│   ├── voices.py                     # /api/voices — voice list, saved voices CRUD
│   ├── synthesis.py                  # /api/synthesize — SSE TTS streams
│   ├── xtts.py                       # /api/xtts — XTTS install status
│   ├── history.py                    # /api/history — audio file browser
│   ├── subtitles.py                  # /api/subtitles — SRT file CRUD
│   └── transcribe.py                 # /api/transcribe — Whisper transcription
│
├── core/
│   ├── audio.py                      # WAV I/O, save_named_audio()
│   ├── history_manager.py            # Audio file history
│   ├── voice_manager.py              # Saved voice profiles CRUD
│   ├── log.py                        # app_log(), print_progress()
│   └── schemas.py                    # Shared Pydantic models
│
├── services/
│   ├── tts_windows.py                # SAPI5/OneCore synthesis
│   ├── tts_xtts.py                   # Coqui XTTS v2 cloning + synthesis
│   └── sse.py                        # run_synth_stream(), sse_frame()
│
├── middleware/
│   └── no_cache.py                   # Cache-Control headers for /static/js/ and /static/css/
│
└── static/
    ├── index.html                    # Single page, 5 tabs + modals
    ├── css/
    └── js/
        ├── app.js                    # Entry — lazy tab init
        ├── api.js                    # Fetch helpers + SSE ReadableStream parser
        ├── audio-manager.js          # Singleton: one AudioPlayer plays at a time
        ├── audio-player.js           # Waveform drag-to-scrub, seekbar, play/download
        ├── wave-renderer.js          # Canvas waveform renderer
        ├── custom-select.js          # Custom dropdown component
        ├── file-upload.js            # Drag-and-drop file upload component
        ├── loader.js                 # withLoader() spinner + makeSkeleton()
        ├── events.js                 # Cross-tab EventTarget bus
        ├── icons.js                  # Inline SVG strings (single source of truth)
        ├── logger.js                 # Floating draggable progress panel
        ├── modal.js                  # openConfirm() / openPrompt() promise-based modals
        ├── tabs.js                   # Tab switching
        ├── toast.js                  # Transient notifications
        └── tabs/
            ├── windows.js            # Windows SAPI5 TTS
            ├── cloning.js            # XTTS v2 voice cloning
            ├── saved.js              # Saved voices library
            ├── subtitles.js          # SRT editor + Whisper
            └── history.js            # Audio/subtitle file browser
```

Full module descriptions → [Architecture](docs/architecture.md)  
All API endpoints → [API Reference](docs/api.md)

---

## Supported Languages (XTTS v2 + Whisper)

Russian · English · German · French · Spanish · Italian · Polish · Ukrainian

---

## License

MIT — free to use, modify, and distribute.
