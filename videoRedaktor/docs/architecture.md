# Architecture

## Overview

`videoRedaktor` is a single-page FastAPI application. The backend serves a REST API under `/api/imgvid/` and the frontend is plain ES modules served as static files.

```
videoRedaktor/
  app.py                   — FastAPI entry point, port 7861
  requirements.txt
  routers/
    image_video.py         — APIRouter aggregator (mounts sub-routers)
    imgvid/
      __init__.py
      ffmpeg_utils.py      — FFmpeg binary resolution, transition/effect maps, ffprobe helpers, thumbnail extraction
      ass_writer.py        — ASS subtitle generator with karaoke word-timing and per-subtitle animations
      codec_selector.py    — Maps human codec names to FFmpeg encoder argument lists; CRF quality scaling
      audio_processor.py   — 14 sound effects (sfx_filter), per-track filter chains, multi-track amix
      filter_builder.py    — Assembles filter_complex: scale, slide effects, xfade transitions, PIP overlays, subtitle filter
      project_ops.py       — Pack/unpack .project ZIP archives; rewrites fileUrl fields on import
      routes/
        __init__.py
        media.py           — Image, video clip, audio upload/serve routes
        projects.py        — Project CRUD routes
        templates.py       — Template CRUD routes
        project_files.py   — .project archive pack/unpack/browse/load routes
        export.py          — SSE-streamed video export, audio export, audio extraction
  core/
    log.py                 — app_log(), server_log(), print_progress() — writes to stdout and .outputs/logs/
    schemas.py             — Pydantic models (RenameBody, SaveSRTBody)
  middleware/
    no_cache.py            — Pure-ASGI no-cache middleware for /static/js/ and /static/css/ responses
  static/
    index.html             — Single page — imgvid section + modals + logger
    css/                   — base, tabs, forms, audio, modal, logger, custom-select, file-upload, loader, image-video, exp-modal
    js/
      app.js               — Entry point — imports logger, tabs, initialises the editor
      api.js               — fetch helpers (getJSON, postJSON, putJSON, del, uploadForm, synthesizeStream)
      audio-manager.js     — Singleton: only one AudioPlayer plays at a time
      audio-player.js      — Custom audio wrapper with waveform drag-to-scrub, seekbar
      wave-renderer.js     — Canvas waveform renderer used by AudioPlayer
      custom-select.js     — Dropdown component with optional action icons
      file-upload.js       — Drag-and-drop single-file upload component
      loader.js            — withLoader() spinner overlay + makeSkeleton() helpers
      events.js            — Cross-tab EventTarget bus
      icons.js             — Inline SVG strings (single source of truth)
      logger.js            — Floating draggable panel + progress bar
      modal.js             — Promise-based openConfirm() / openPrompt()
      tabs.js              — Stub (single-tab app)
      toast.js             — Transient notifications (info/ok/warn/err)
      tabs/
        image-video.js     — Editor tab: full image/video editor UI init and coordination
      imgvid/
        constants.js       — TRANSITIONS (22), EFFECTS_DEF, FONTS, ANIMS, START_EFFECTS, END_EFFECTS
        state.js           — Shared state object S, undo stack, audio element pool, syncAudio()
        utils.js           — uid, eh, fmt, fmtShort, totalDur, clipAtTime, buildCSSFilter, snap
        waveform.js        — drawWaveform() with cached peaks, probeAudioDuration()
        props.js           — Property panels: slide / audio / subtitle / PIP
        timeline.js        — Timeline render, drag-drop, resize, snap, context menus
        playback.js        — togglePlay, seek, updateTransportUI, applyZoom, updatePreviewSize
        pip.js             — Picture-in-Picture overlay management and controls
        preview-render.js  — Canvas renderer: images, video frames, crop/scale/effects/subtitle overlays
        media-list.js      — Media browser: list clips and audio tracks, handle delete
        exp-modal.js       — Export dialog UI: format / resolution / fps / quality / codec / SSE progress
        export.js          — Thin stubs wrapping exp-modal
        preview.js         — Preview zoom helper stubs
```

---

## Backend: API Router

`routers/image_video.py` mounts all sub-routers under the `/api/imgvid` prefix:

```python
router = APIRouter(prefix="/api/imgvid", tags=["imgvid"])
router.include_router(media.router)
router.include_router(projects.router)
router.include_router(templates.router)
router.include_router(project_files.router)
router.include_router(export.router)
```

---

## Backend: Service Modules

### `ffmpeg_utils.py`

- Resolves FFmpeg/FFprobe binaries (PATH or local `ffmpeg/` folder)
- Defines `_XFADE` (22 xfade transition names) and `_EFFECTS` (16 colour/filter effects)
- `_probe_duration_clip(path)` — ffprobe duration query
- `_extract_thumb(video_path, thumb_path)` — extract first frame thumbnail
- `_compute_video_dur(slides)` — sum of all clip durations
- `_start_effect_filters(type, dur, clip_dur, w, h)` — per-clip entry animation filter chains
- `_end_effect_filters(type, dur, clip_dur, w, h)` — per-clip exit animation filter chains
- `_continuous_effect_filters(type, intensity, dur, w, h, fps, clip_type, speed)` — Ken Burns, pulse, shake, float, zoom-breathe, rotate-slow, wiggle, drift, heartbeat, swing, spin-fast

### `ass_writer.py`

- `_write_ass(subs, path, width, height)` — generate ASS subtitle file
- Supports: custom font/size/color/bold/italic/underline, outline/shadow, background box, per-subtitle positioning (x%, y%), text alignment (left/center/right), rotation
- Animations: fade-in, fade-out, slide-up, slide-down, zoom-in, typewriter (character-by-character)
- Karaoke: word-by-word or cumulative highlight; typewriter-per-word; zoom word; highlight marker; show-only-active-word

### `codec_selector.py`

- `resolve_codec_name(codec, format)` — maps user codec name to FFmpeg encoder
- `select_video_codec(codec, crf, format)` — returns FFmpeg video codec argument list
- `select_audio_codec(codec, bitrate, has_audio)` — returns FFmpeg audio codec argument list
- Supported video codecs: H.264, H.265, VP9, VP8, AV1, ProRes, Theora, WMV2, MPEG-2, MPEG-4, GIF

### `audio_processor.py`

- `sfx_filter(type, params)` — returns FFmpeg audio filter string for one sound effect
  - Supported: echo, reverb, bassboost, treble, compressor, phone, radio, lowpass, highpass, chorus, flanger, distortion, noise (gate), pitch
- `build_audio_filter(track, input_idx, out_label, total_dur)` — per-track filter chain (volume, trim, speed, fade in/out, sound effects, start offset)
- `build_audio_chain(valid_audio, start_idx, total_dur)` — multi-track mix using amix

### `filter_builder.py`

- `build_scale_filter(w, h, fps)` — standard scale/pad/format filter
- `build_slide_filter(i, slide, fps, w, h)` — full per-slide filter including crop, scale, effects, start/end effects, frame positioning
- `build_transition_filters_fps(slides, filter_parts, fps)` — xfade / concat transition chain
- `build_pip_filters(valid_pip, start_idx, base_label, w, h, total_dur, fps)` — PIP overlay layers
- `build_subtitle_filter(subs, tmp_dir, w, h)` — write ASS file and return subtitles= filter string

### `project_ops.py`

- `_make_project_buf(project)` — pack project JSON + media files into a ZIP buffer
- `_extract_project_zip(zf)` — unpack .project archive and restore media files
- `_finalize_project(project)` — assign UUID, write project JSON to disk

---

## Export Pipeline

`routes/export.py::export_video()` runs in a background thread:

1. Validates slides, resolution, format, and checks all files exist
2. Resolves PIP layers to file paths
3. Builds `-i` input list (images with `-loop 1 -t`, video clips with `-t`, audio tracks, PIP inputs)
4. Builds per-slide video filters via `filter_builder`
5. Applies canvas crop if set
6. Applies PIP overlays and subtitle filter (order controlled by `trackOrder`)
7. Builds audio filter chain via `audio_processor`
8. Selects codec via `codec_selector`
9. Runs FFmpeg subprocess with the assembled `-filter_complex`
10. Streams progress back via SSE frames (`event: progress`, `event: done`, `event: error`, `event: cancelled`)

---

## Output Directories

```
.outputs/
  imgvid/
    images/      — uploaded images (UUID filenames)
    clips/       — uploaded video clips
    audio/       — uploaded audio tracks
    thumbs/      — video clip thumbnails
    output/      — exported video and audio files
    projects/    — project JSON files ({id}.json)
    templates/   — template JSON files ({id}.json)
  saved_projects/  — .project archives saved to disk
  logs/            — server log files (YYYY-MM-DD.log)
```

---

## Middleware

`middleware/no_cache.py` — pure ASGI middleware that adds `no-cache` headers to all `/static/js/` and `/static/css/` responses. Uses the raw ASGI interface (not `BaseHTTPMiddleware`) to avoid `CancelledError` noise on shutdown.

---

## Frontend State

`static/js/imgvid/state.js` exports a single shared state object `S`:

```js
S = {
  slides: [],        // video/image clips
  audio: [],         // audio tracks
  subtitles: [],     // subtitle objects
  pip: [],           // PIP layers
  trackOrder: [...], // visual layer order
  exportSettings: {}, 
  canvasCrop: null,
  currentIndex: -1,  // selected slide index
  selectedAudioId: null,
  selectedSubId: null,
  selectedPipId: null,
  playing: false,
  currentTime: 0,
  zoom: 1,           // timeline zoom
  previewZoom: 'fit',
  undoStack: [],
  redoStack: [],
}
```

Undo/redo is implemented via snapshot cloning of the `S` object on every mutating action.
