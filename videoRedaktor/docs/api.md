# API Reference

All endpoints are served at `http://127.0.0.1:7861`. All JSON bodies use UTF-8.  
Export endpoints return `text/event-stream` (SSE).

---

## Image Video Editor

Base prefix: `/api/imgvid`

### Media Upload

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/imgvid/images` | Upload image (JPG / PNG / WebP / BMP) |
| `GET` | `/api/imgvid/images/{name}` | Serve uploaded image |
| `DELETE` | `/api/imgvid/images/{name}` | Delete uploaded image |
| `POST` | `/api/imgvid/clips` | Upload video clip; returns `{ name, url, thumb_url, duration }` |
| `GET` | `/api/imgvid/clips/{name}` | Serve uploaded clip |
| `GET` | `/api/imgvid/thumbs/{name}` | Serve clip thumbnail |
| `POST` | `/api/imgvid/audio` | Upload audio track |
| `GET` | `/api/imgvid/audio/{name}` | Serve audio track |
| `POST` | `/api/imgvid/extract-audio` | Extract audio from video clip as WAV |

**Upload image response:**
```json
{ "name": "uuid.jpg", "url": "/api/imgvid/images/uuid.jpg", "original": "photo.jpg" }
```

**Upload clip response:**
```json
{ "name": "uuid.mp4", "url": "/api/imgvid/clips/uuid.mp4", "thumb_url": "/api/imgvid/thumbs/uuid.jpg", "original": "clip.mp4", "duration": 12.5 }
```

**Extract audio body:**
```json
{ "file": "uuid.mp4" }
```

---

### Projects

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/imgvid/projects` | List projects (excludes templates) |
| `POST` | `/api/imgvid/projects` | Create or overwrite a project |
| `GET` | `/api/imgvid/projects/{pid}` | Get full project JSON |
| `PUT` | `/api/imgvid/projects/{pid}` | Full replacement update |
| `PATCH` | `/api/imgvid/projects/{pid}` | Rename project `{ "name": "..." }` |
| `DELETE` | `/api/imgvid/projects/{pid}` | Delete project |
| `POST` | `/api/imgvid/projects/{pid}/save-as-template` | Copy project as template |
| `GET` | `/api/imgvid/projects/{pid}/pack` | Download `.project` archive |

**POST/PUT body (`ProjectBody`):**
```json
{
  "id": "optional-existing-id",
  "name": "My Project",
  "slides": [...],
  "audio": [...],
  "subtitles": [...],
  "pip": [...],
  "trackOrder": ["video", "audio", "subtitle", "pip"],
  "export_settings": {},
  "is_template": false,
  "canvasCrop": null
}
```

**List response:**
```json
{
  "projects": [
    {
      "id": "abc123",
      "name": "My Project",
      "created_at": "2026-01-15T10:00:00",
      "updated_at": "2026-01-15T11:30:00",
      "slide_count": 5,
      "total_duration": 25.0,
      "is_template": false
    }
  ]
}
```

---

### Templates

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/imgvid/templates` | List all templates |
| `GET` | `/api/imgvid/templates/{tid}` | Get full template JSON |
| `PUT` | `/api/imgvid/templates/{tid}` | Update template |
| `DELETE` | `/api/imgvid/templates/{tid}` | Delete template |
| `PATCH` | `/api/imgvid/templates/{tid}/rename` | Rename template `{ "name": "..." }` |
| `POST` | `/api/imgvid/templates/{tid}/duplicate` | Duplicate template |

---

### Project Files (`.project` format)

`.project` files are ZIP archives containing `project.json` plus embedded media files.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/imgvid/projects/{pid}/pack` | Download `.project` as attachment |
| `POST` | `/api/imgvid/project/unpack` | Upload and unpack a `.project` file |
| `POST` | `/api/imgvid/project/save-to-path` | Save `.project` to a server-side path |
| `GET` | `/api/imgvid/project/browse` | Browse a directory for `.project` files |
| `POST` | `/api/imgvid/project/load-from-path` | Load `.project` from a server-side path |

**save-to-path body:**
```json
{ "pid": "abc123", "dir": "C:\\Users\\user\\Videos", "filename": "my-project.project" }
```

**browse query parameter:** `?path=C:\Users\user\Videos`

**load-from-path body:**
```json
{ "file_path": "C:\\Users\\user\\Videos\\my-project.project" }
```

---

### Export

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/imgvid/export` | Start SSE-streamed video export |
| `POST` | `/api/imgvid/export-audio` | Start SSE-streamed audio-only export |
| `POST` | `/api/imgvid/cancel-export` | Cancel the active export |
| `GET` | `/api/imgvid/output/{name}` | Download exported file |

**Video export — multipart form fields:**

| Field | Values | Description |
|-------|--------|-------------|
| `project_json` | JSON string | Full project object |
| `output_format` | `mp4` `mov` `mkv` `m4v` `avi` `webm` `ogv` `flv` `wmv` `mpeg` `gif` | Container format |
| `codec` | `h264` `h265` `vp9` `vp8` `av1` `prores` `mpeg4` `` | Video codec (`""` = auto from format) |
| `resolution` | `1280x720` `1920x1080` `2560x1440` `3840x2160` `WxH` | Output resolution |
| `fps` | `24` `25` `30` `60` | Frames per second |
| `quality` | `vlow` `low` `medium` `high` `vhigh` `max` `lossless` | Quality preset (maps to CRF) |
| `audio_codec` | `aac` `mp3` `opus` `vorbis` `pcm` | Audio encoder |
| `audio_bitrate` | `128k` `192k` `320k` | Audio bitrate |
| `canvas_crop` | `x,y,w,h` | Optional canvas crop (pixels) |

**SSE event stream format:**
```
event: progress
data: {"value": 0.45, "desc": "Рендеринг: 0:10/0:24"}

event: done
data: {"video_url": "/api/imgvid/output/imgvid_20260115_103045.mp4", "filename": "imgvid_20260115_103045.mp4"}

event: error
data: {"status": "❌ FFmpeg вернул код 1"}

event: cancelled
data: {"status": "Export cancelled by user"}
```

**Audio export — multipart form fields:**

| Field | Values | Description |
|-------|--------|-------------|
| `project_json` | JSON string | Project object (only `audio` array is used) |
| `audio_format` | `mp3` `wav` `flac` `aac` `ogg` `m4a` `opus` | Output audio format |

---

## Data Schemas

### Slide object

```json
{
  "id": "abc123",
  "type": "image",
  "file": "uuid.jpg",
  "fileUrl": "/api/imgvid/images/uuid.jpg",
  "original": "photo.jpg",
  "duration": 5.0,
  "transition": { "type": "fade", "duration": 0.5 },
  "effects": [{ "type": "brightness", "value": 20 }],
  "startEffect": { "type": "fade-in", "duration": 0.5 },
  "endEffect": { "type": "none", "duration": 0.5 },
  "continuousEffect": { "type": "ken-burns-in", "intensity": 30 },
  "effectSpeed": 1.0,
  "imgScale": 100,
  "imgOffsetX": 0,
  "imgOffsetY": 0,
  "crop": { "x": 0, "y": 0, "w": 100, "h": 100 },
  "frameX": 0, "frameY": 0, "frameW": 100, "frameH": 100,
  "speed": 1.0,
  "trimIn": 0
}
```

`type` is `"image"` or `"video"`. For video clips, `file` points to `clips/`.

**Supported transition types:** `none`, `fade`, `crossfade`, `dissolve`, `fadeblack`, `fadewhite`, `slideleft`, `slideright`, `slideup`, `slidedown`, `wipeleft`, `wiperight`, `wipeup`, `wipedown`, `circlecrop`, `pixelize`, `zoomin`, `hblur`, `fadegrays`, `radial`, `hlslice`, `hrslice`, `vuslice`, `vdslice`

**Supported effect types:** `brightness`, `contrast`, `saturation`, `exposure`, `gamma`, `temperature`, `blur`, `sharpen`, `grayscale`, `sepia`, `vignette`, `filmgrain`, `noise`, `invert`, `vintage`, `noir`

**Supported start/end effect types:** `none`, `fade-in` / `fade-out`, `zoom-in`, `zoom-out`, `slide-left`, `slide-right`, `slide-up`, `slide-down`, `blur-in` / `blur-out`, `rotate-in` / `rotate-out`, `flip-h-in` / `flip-h-out`, `reveal-center` / `hide-center`, `bounce-in` / `bounce-out`, `pop` / `pop-out`, `elastic-in` / `elastic-out`, `flip-v-in` / `flip-v-out`

**Supported continuous effect types:** `none`, `ken-burns-in`, `ken-burns-out`, `ken-burns-lr`, `ken-burns-rl`, `pulse`, `shake`, `float`, `zoom-breathe`, `rotate-slow`, `wiggle`, `drift`, `heartbeat`, `swing`, `spin-fast`

---

### Audio track object

```json
{
  "id": "def456",
  "file": "uuid.mp3",
  "fileUrl": "/api/imgvid/audio/uuid.mp3",
  "original": "music.mp3",
  "volume": 1.0,
  "fadeIn": 0,
  "fadeOut": 2.0,
  "startOffset": 5.0,
  "trimIn": 0,
  "duration": 30.0,
  "originalDuration": 120.0,
  "speed": 1.0,
  "soundEffects": [
    { "type": "echo", "delay": 500, "decay": 0.5 },
    { "type": "pitch", "semitones": 2 }
  ]
}
```

**Supported sound effect types:** `echo`, `reverb`, `bassboost`, `treble`, `compressor`, `phone`, `radio`, `lowpass`, `highpass`, `chorus`, `flanger`, `distortion`, `noise`, `pitch`

---

### Subtitle object

```json
{
  "id": "ghi789",
  "text": "Hello world",
  "start": 1.0,
  "end": 4.0,
  "x": 50,
  "y": 88,
  "w": 0,
  "h": 0,
  "fontFamily": "Arial",
  "fontSize": 40,
  "color": "#ffffff",
  "bold": false,
  "italic": false,
  "underline": false,
  "outline": 2,
  "outlineColor": "#000000",
  "shadow": 1,
  "shadowColor": "#000000",
  "bgColor": "#000000",
  "bgOpacity": 0,
  "bgPadX": 12,
  "bgPadY": 6,
  "rotation": 0,
  "align": "center",
  "animation": "fade-in",
  "animDuration": 0.6,
  "karaokeEnable": false,
  "karaokeColor": "#ffdd00",
  "karaokeMode": "word",
  "karaokeTypewriterWord": false,
  "karaokeHighlight": false,
  "karaokeShowOnly": false,
  "karaokeZoomWord": false
}
```

`animation` options: `""` / `"fade-in"` / `"fade-out"` / `"slide-up"` / `"slide-down"` / `"typewriter"` / `"zoom-in"`

---

### PIP (picture-in-picture) object

```json
{
  "id": "pip001",
  "file": "uuid.jpg",
  "fileUrl": "/api/imgvid/images/uuid.jpg",
  "type": "image",
  "x": 10,
  "y": 10,
  "w": 30,
  "h": 20,
  "opacity": 1.0,
  "startTime": 0,
  "endTime": 5.0,
  "order": 0,
  "speed": 1.0,
  "trimIn": 0,
  "effectSpeed": 1.0,
  "effects": [],
  "startEffect": { "type": "none", "duration": 0.5 },
  "endEffect": { "type": "none", "duration": 0.5 },
  "continuousEffect": { "type": "none", "intensity": 30 }
}
```

---

### Project object (top-level)

```json
{
  "id": "abc123",
  "name": "My Project",
  "created_at": "2026-01-15T10:00:00",
  "updated_at": "2026-01-15T11:30:00",
  "slides": [...],
  "audio": [...],
  "subtitles": [...],
  "pip": [...],
  "trackOrder": ["video", "audio", "subtitle", "pip"],
  "export_settings": {
    "format": "mp4",
    "codec": "h264",
    "resolution": "1920x1080",
    "fps": "30",
    "quality": "high",
    "audioCodec": "aac",
    "audioBitrate": "192k"
  },
  "is_template": false,
  "canvasCrop": null
}
```

`canvasCrop` when set: `{ "x": 0, "y": 0, "w": 1080, "h": 1080 }` (pixels in output resolution)

`trackOrder` controls which layer renders on top: lower index = higher visual layer. Default order puts subtitle above PIP.
