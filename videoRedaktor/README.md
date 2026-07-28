# Video Editor

A standalone, offline image/video editor web application. Build slideshows and video projects from images and video clips, add subtitles, audio tracks, PIP layers, transitions, and visual effects — then export to MP4, WebM, GIF, and other formats via FFmpeg.

Extracted from the TTS project — this is the **Редактор** (Editor) tab as a self-contained app.

---

## Requirements

- Python 3.10+
- FFmpeg (must be in `PATH` or placed in the `ffmpeg/` folder alongside `app.py`)

## Setup

```bat
install.bat
```

Or manually:

```bash
pip install -r requirements.txt
```

## Run

```bat
run.bat
```

Or manually:

```bash
python app.py
```

The app starts on **http://127.0.0.1:7861** and opens a browser window automatically.

> Note: Port **7861** is used to avoid conflict with the TTS app on port 7860.

---

## FFmpeg

FFmpeg is required for video export, thumbnail generation, and audio processing.

**Option 1 — PATH**: Install FFmpeg and ensure `ffmpeg.exe` is in your system PATH.

**Option 2 — Local folder**: Place `ffmpeg.exe` and `ffprobe.exe` in a folder named `ffmpeg/` next to `app.py`:

```
videoRedaktor/
  ffmpeg/
    ffmpeg.exe
    ffprobe.exe
  app.py
  ...
```

The app will detect and use the local binaries automatically.

---

## Output directories

Created automatically at runtime under `.outputs/`:

```
.outputs/
  imgvid/
    images/     — uploaded images
    clips/      — uploaded video clips
    audio/      — uploaded audio tracks
    thumbs/     — video clip thumbnails
    output/     — exported videos and audio files
    projects/   — saved project JSON files
    templates/  — saved template JSON files
  saved_projects/  — .project archive saves
  logs/            — server log files (YYYY-MM-DD.log)
  temp/            — temporary files during export
```

---

## Features

- **Timeline editor** — multi-track: video clips, audio tracks, subtitles, PIP layers
- **22 transitions** — fade, dissolve, slide, wipe, zoom, pixelize, radial, and more
- **Visual effects** — brightness, contrast, saturation, blur, sharpen, grayscale, sepia, vignette, invert, film grain, and more
- **Start/end effects** — per-clip entry and exit animations (fade-in/out, zoom, slide, rotate, bounce, etc.)
- **Continuous effects** — Ken Burns, pulse, shake, float, zoom-breathe, drift, and more
- **Subtitles** — full styling (font, color, outline, shadow, background), positioning, animations, karaoke word-timing
- **Audio** — multiple tracks, volume, speed, fade in/out, trim, sound effects (echo, reverb, bass boost, pitch shift, etc.)
- **PIP** — picture-in-picture layers with opacity, positioning, effects
- **Canvas crop** — crop the output canvas to any region
- **Export** — MP4, MOV, MKV, WebM, AVI, GIF, OGV, FLV, WMV, MPEG; codecs H.264, H.265, VP9, AV1, ProRes, MPEG-4; audio-only export
- **Projects** — save/load JSON projects, export/import `.project` archives (ZIP with embedded media)
- **Templates** — save projects as reusable templates, apply templates with drag-and-drop slot filling

---

## Architecture

See `docs/architecture.md` for a full description of the backend and frontend modules.

See `docs/api.md` for the complete REST API reference.

See `docs/EDITOR.md` for the user guide.
