"""
Audio post-processing API + Presets + Projects management.

POST /api/process-audio      — apply FFmpeg effects to a generated WAV
GET  /api/presets             — list builtin + user presets
POST /api/presets             — save user preset
DELETE /api/presets/{name}    — delete user preset
GET  /api/projects            — list user projects
POST /api/projects            — save project
GET  /api/projects/{name}     — load project
DELETE /api/projects/{name}   — delete project
GET  /api/ffmpeg-status       — FFmpeg availability check
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.log import app_log
from services.audio_effects import (
    process_audio,
    check_ffmpeg,
    BUILTIN_XTTS_PRESETS,
    REVERB_PRESETS,
    ECHO_PRESETS,
)

router = APIRouter(prefix="/api", tags=["audio_processing"])

# ─── Paths ────────────────────────────────────────────────────────────────────

_BASE    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_AUDIO   = os.path.join(_BASE, ".outputs", "audio")
_PRESETS = os.path.join(_BASE, ".outputs", "presets")
_PROJECTS = os.path.join(_BASE, ".outputs", "projects")

for _d in (_AUDIO, _PRESETS, _PROJECTS):
    os.makedirs(_d, exist_ok=True)



# ─── Helpers ──────────────────────────────────────────────────────────────────

def _safe_name(name: str) -> str:
    """Strip path separators and keep alphanumerics/spaces/hyphens/underscores."""
    return re.sub(r"[^\w\s\-]", "", name, flags=re.UNICODE).strip()[:120]


def _preset_path(name: str) -> str:
    return os.path.join(_PRESETS, _safe_name(name) + ".json")


def _project_path(name: str) -> str:
    return os.path.join(_PROJECTS, _safe_name(name) + ".json")


# ─── Pydantic models ──────────────────────────────────────────────────────────

class ReverbConfig(BaseModel):
    enabled: bool = False
    room_size: float = 50
    wet: float = 30
    dry: float = 70
    decay: float = 1.5


class EchoConfig(BaseModel):
    enabled: bool = False
    delay_ms: float = 200
    decay: float = 0.3


class EffectsConfig(BaseModel):
    volume_db: float = 0.0
    normalize: bool = False
    target_lufs: float = -14.0
    bass_db: float = 0.0
    treble_db: float = 0.0
    eq: list[float] = [0, 0, 0, 0, 0]
    pitch_semitones: float = 0.0
    reverb: ReverbConfig = ReverbConfig()
    echo: EchoConfig = EchoConfig()
    fade_in: float = 0.0
    fade_out: float = 0.0
    remove_silence: bool = False
    silence_threshold_db: float = -40.0
    min_silence_duration: float = 0.3
    add_silence_before: float = 0.0
    add_silence_after: float = 0.0


class OutputConfig(BaseModel):
    format: str = "wav"       # 'wav' or 'mp3'
    sample_rate: int = 24000
    mp3_bitrate: int = 192


class AudioProcessBody(BaseModel):
    filename: str
    effects: EffectsConfig = EffectsConfig()
    output: OutputConfig = OutputConfig()


class PresetData(BaseModel):
    xtts: dict[str, Any] = {}
    effects: dict[str, Any] = {}
    output: dict[str, Any] = {}


class SavePresetBody(BaseModel):
    name: str
    data: PresetData


class ProjectData(BaseModel):
    text: str = ""
    language: str = "Русский"
    voice: str = ""              # saved voice name or ""
    xtts: dict[str, Any] = {}
    effects: dict[str, Any] = {}
    output: dict[str, Any] = {}


class SaveProjectBody(BaseModel):
    name: str
    data: ProjectData


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/ffmpeg-status")
async def ffmpeg_status():
    return check_ffmpeg()


@router.post("/process-audio")
async def process_audio_endpoint(body: AudioProcessBody):
    """Apply FFmpeg effects to an existing audio file. Returns new file info."""
    ffinfo = check_ffmpeg()
    if not ffinfo["available"]:
        raise HTTPException(503, "FFmpeg не найден. Убедитесь, что ffmpeg.exe есть в папке ffmpeg/")

    # Locate source file
    src = os.path.join(_AUDIO, os.path.basename(body.filename))
    if not os.path.isfile(src):
        raise HTTPException(404, f"Файл не найден: {body.filename}")

    # Build output filename
    ts = time.strftime("%Y-%m-%d_%H-%M-%S")
    ext = "mp3" if body.output.format == "mp3" else "wav"
    out_name = f"audio-{ts}-processed.{ext}"
    out_path = os.path.join(_AUDIO, out_name)

    # Serialize effects to plain dict for the processing function
    effects_dict = body.effects.model_dump()

    app_log(
        f"Audio processing: {body.filename} → {out_name} | "
        f"effects: {body.effects.model_dump(exclude_defaults=True)}",
        "INFO", "AudioFX",
    )

    def _run():
        process_audio(
            src, out_path,
            effects=effects_dict,
            output_format=body.output.format,
            sample_rate=body.output.sample_rate,
            mp3_bitrate=body.output.mp3_bitrate,
        )

    try:
        await asyncio.to_thread(_run)
    except RuntimeError as e:
        app_log(f"Audio processing error: {e}", "ERROR", "AudioFX")
        raise HTTPException(500, str(e))

    return {
        "filename": out_name,
        "audio_url": f"/api/history/{out_name}/audio",
        "status": "✓ Обработка завершена",
    }


# ─── Presets ──────────────────────────────────────────────────────────────────

@router.get("/presets")
async def list_presets():
    presets = []

    # Built-in XTTS presets
    for name, xtts_data in BUILTIN_XTTS_PRESETS.items():
        presets.append({
            "name": name,
            "builtin": True,
            "data": {"xtts": xtts_data, "effects": {}, "output": {}},
        })

    # User presets from disk
    if os.path.isdir(_PRESETS):
        for fname in sorted(os.listdir(_PRESETS)):
            if not fname.endswith(".json"):
                continue
            path = os.path.join(_PRESETS, fname)
            try:
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
                presets.append({
                    "name": data.get("name", fname[:-5]),
                    "builtin": False,
                    "data": data.get("data", {}),
                })
            except Exception:
                pass

    return {
        "presets": presets,
        "reverb_presets": REVERB_PRESETS,
        "echo_presets": ECHO_PRESETS,
    }


@router.post("/presets")
async def save_preset(body: SavePresetBody):
    name = _safe_name(body.name)
    if not name:
        raise HTTPException(400, "Недопустимое имя пресета")
    path = _preset_path(name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"name": name, "data": body.data.model_dump()}, f, ensure_ascii=False, indent=2)
    return {"status": f"✓ Пресет «{name}» сохранён"}


@router.delete("/presets/{name}")
async def delete_preset(name: str):
    path = _preset_path(name)
    if not os.path.isfile(path):
        raise HTTPException(404, f"Пресет «{name}» не найден")
    os.unlink(path)
    return {"status": f"✓ Пресет «{name}» удалён"}


# ─── Projects ─────────────────────────────────────────────────────────────────

@router.get("/projects")
async def list_projects():
    projects = []
    if os.path.isdir(_PROJECTS):
        for fname in sorted(os.listdir(_PROJECTS), reverse=True):
            if fname.endswith(".json"):
                projects.append(fname[:-5])
    return {"projects": projects}


@router.post("/projects")
async def save_project(body: SaveProjectBody):
    name = _safe_name(body.name)
    if not name:
        raise HTTPException(400, "Недопустимое имя проекта")
    path = _project_path(name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"name": name, "data": body.data.model_dump()}, f, ensure_ascii=False, indent=2)
    return {"status": f"✓ Проект «{name}» сохранён"}


@router.get("/projects/{name}")
async def load_project(name: str):
    path = _project_path(name)
    if not os.path.isfile(path):
        raise HTTPException(404, f"Проект «{name}» не найден")
    with open(path, encoding="utf-8") as f:
        payload = json.load(f)
    return payload


@router.delete("/projects/{name}")
async def delete_project(name: str):
    path = _project_path(name)
    if not os.path.isfile(path):
        raise HTTPException(404, f"Проект «{name}» не найден")
    os.unlink(path)
    return {"status": f"✓ Проект «{name}» удалён"}
