# API Reference

All endpoints are served at `http://127.0.0.1:7860`. All JSON bodies use UTF-8.  
Synthesis endpoints return `text/event-stream` (SSE).

---

## Voices

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/voices/windows` | List Windows SAPI voices |
| `GET` | `/api/voices/saved` | List saved voice profiles |
| `GET` | `/api/voices/saved/{name}/audio` | Download saved voice WAV |
| `POST` | `/api/voices/saved` | Upload and save a voice profile |
| `PUT` | `/api/voices/saved/{name}` | Rename saved voice |
| `DELETE` | `/api/voices/saved/{name}` | Delete saved voice |

---

## Synthesis (SSE streams)

All synthesis endpoints return `text/event-stream`.

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/synthesize/windows` | JSON | Windows SAPI synthesis |
| `POST` | `/api/synthesize/xtts` | multipart | XTTS voice cloning + synthesis |
| `POST` | `/api/synthesize/saved` | JSON | Saved voice synthesis |

**Windows body**
```json
{ "text": "Привет мир", "voice": "HKEY_LOCAL_MACHINE\\...", "rate": 0, "volume": 1.0 }
```

**XTTS multipart fields**
- `audio` — WAV/MP3 reference sample (10–30 s)
- `text` — text to synthesise
- `language` — language code (`ru`, `en`, `de`, `fr`, `es`, `it`, `pl`, `uk`)

**Saved voice body**
```json
{ "text": "Привет мир", "voice": "my-voice", "language": "ru" }
```

**SSE frame format**
```
event: progress
data: {"value": 0.45, "desc": "Синтез слова 5/10"}

event: done
data: {"audio_url": "/api/history/<name>/audio", "filename": "<name>", "status": "✓ Готово"}

event: error
data: {"status": "❌ Ошибка: ..."}
```

---

## Audio History

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/history` | List generated audio files |
| `GET` | `/api/history/{name}/audio` | Download audio file |
| `PUT` | `/api/history/{name}` | Rename audio file |
| `DELETE` | `/api/history/{name}` | Delete audio file |

---

## Subtitles

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/subtitles` | List SRT files |
| `POST` | `/api/subtitles` | Save SRT file |
| `GET` | `/api/subtitles/{name}` | Get SRT content |
| `GET` | `/api/subtitles/{name}/vtt` | Convert SRT → WebVTT |
| `PUT` | `/api/subtitles/{name}` | Rename SRT file |
| `DELETE` | `/api/subtitles/{name}` | Delete SRT file |

**POST body**
```json
{ "name": "my-subtitles", "content": "1\n00:00:01,000 --> 00:00:04,000\nПривет мир\n" }
```

---

## Transcription (SSE)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/transcribe/audio` | multipart: `file`, `language` | Transcribe audio → SRT (Whisper) |
| `POST` | `/api/transcribe/video` | multipart: `file`, `language` | Extract audio from video → SRT (Whisper) |

---

## XTTS

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/xtts/status` | XTTS install status + supported languages |
