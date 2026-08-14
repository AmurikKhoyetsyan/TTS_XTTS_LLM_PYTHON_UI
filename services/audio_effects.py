"""
Comprehensive audio post-processing via FFmpeg.

Entry point: process_audio(input_path, output_path, effects, output_format, sample_rate, mp3_bitrate)

effects dict keys (all optional, defaults = no change):
    volume_db           float   -20..+20 dB     (0 = no change)
    normalize           bool    True = apply loudnorm
    target_lufs         float   -16/-14/-12/-10 (-14)
    bass_db             float   -12..+12 dB     (0)
    treble_db           float   -12..+12 dB     (0)
    eq                  list[5] -12..+12 dB per band [60,250,1k,4k,12k Hz]
    pitch_semitones     float   -12..+12        (0)
    reverb              dict    {enabled, room_size 0-100, wet 0-100, dry 0-100, decay 0-5}
    echo                dict    {enabled, delay_ms 50-1000, decay 0-0.9}
    fade_in             float   seconds 0-5     (0)
    fade_out            float   seconds 0-5     (0)
    remove_silence      bool
    silence_threshold_db float  -60..-30        (-40)
    min_silence_duration float  0.1-2.0 sec     (0.3)
    add_silence_before  float   seconds         (0)
    add_silence_after   float   seconds         (0)
"""

from __future__ import annotations
import os
import shutil
import subprocess
import math

# Built-in XTTS generation presets (xtts params only, no audio effects)
BUILTIN_XTTS_PRESETS = {
    "Natural": {
        "speed": 1.0, "temperature": 0.65, "repetition_penalty": 2.0,
        "top_p": 0.8, "top_k": 50, "length_penalty": 1.0,
    },
    "Narrator": {
        "speed": 0.9, "temperature": 0.55, "repetition_penalty": 2.5,
        "top_p": 0.75, "top_k": 40, "length_penalty": 1.2,
    },
    "Cinematic": {
        "speed": 0.95, "temperature": 0.75, "repetition_penalty": 1.8,
        "top_p": 0.88, "top_k": 60, "length_penalty": 0.9,
    },
    "Fast": {
        "speed": 1.3, "temperature": 0.60, "repetition_penalty": 2.0,
        "top_p": 0.8, "top_k": 50, "length_penalty": 1.0,
    },
    "Stable": {
        "speed": 1.0, "temperature": 0.4, "repetition_penalty": 3.0,
        "top_p": 0.7, "top_k": 30, "length_penalty": 1.5,
    },
}

# Built-in reverb presets (room_size, wet, dry, decay)
REVERB_PRESETS = {
    "Small Room": {"room_size": 20, "wet": 15, "dry": 85, "decay": 0.5},
    "Room":       {"room_size": 40, "wet": 25, "dry": 75, "decay": 1.2},
    "Hall":       {"room_size": 65, "wet": 40, "dry": 60, "decay": 2.0},
    "Large Hall": {"room_size": 85, "wet": 55, "dry": 45, "decay": 3.5},
    "Cinematic":  {"room_size": 100, "wet": 70, "dry": 30, "decay": 5.0},
}

# Built-in echo presets (delay_ms, decay)
ECHO_PRESETS = {
    "Short":     {"delay_ms": 100, "decay": 0.2},
    "Medium":    {"delay_ms": 300, "decay": 0.35},
    "Long":      {"delay_ms": 600, "decay": 0.45},
    "Cinematic": {"delay_ms": 800, "decay": 0.6},
}


# ─── FFmpeg helpers ───────────────────────────────────────────────────────────

def _find_ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if path is None:
        raise RuntimeError(
            "FFmpeg не найден. Убедитесь, что ffmpeg.exe находится в папке ffmpeg/ "
            "рядом с app.py или добавлен в PATH."
        )
    return path


def _find_ffprobe() -> str | None:
    return shutil.which("ffprobe")


def _get_sample_rate(path: str, default: int = 24000) -> int:
    ffprobe = _find_ffprobe()
    if not ffprobe:
        return default
    try:
        r = subprocess.run(
            [ffprobe, "-v", "error",
             "-select_streams", "a:0",
             "-show_entries", "stream=sample_rate",
             "-of", "default=noprint_wrappers=1:nokey=1",
             path],
            capture_output=True, text=True, timeout=15,
        )
        s = r.stdout.strip()
        if s.isdigit():
            return int(s)
    except Exception:
        pass
    return default


def _get_duration(path: str) -> float:
    """Return audio duration in seconds via ffprobe, or 0.0 on failure."""
    ffprobe = _find_ffprobe()
    if not ffprobe:
        return 0.0
    try:
        r = subprocess.run(
            [ffprobe, "-v", "error",
             "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1",
             path],
            capture_output=True, text=True, timeout=15,
        )
        s = r.stdout.strip()
        return float(s)
    except Exception:
        return 0.0


def _atempo_chain(factor: float) -> list[str]:
    """Split an atempo value outside [0.5, 2.0] into chained atempo filters."""
    filters = []
    remaining = factor
    while remaining > 2.0:
        filters.append("atempo=2.0")
        remaining /= 2.0
    while remaining < 0.5:
        filters.append("atempo=0.5")
        remaining *= 2.0
    if abs(remaining - 1.0) > 1e-5:
        filters.append(f"atempo={remaining:.6f}")
    return filters


def _safe_remove(path: str) -> None:
    try:
        if os.path.exists(path):
            os.unlink(path)
    except OSError:
        pass


# ─── Filter chain builder ─────────────────────────────────────────────────────

def _build_filter_chain(effects: dict, sr: int, duration: float) -> list[str]:
    filters: list[str] = []
    e = effects or {}

    # 1. Add silence before
    sil_before = float(e.get("add_silence_before", 0) or 0)
    if sil_before > 0.001:
        ms = int(round(sil_before * 1000))
        filters.append(f"adelay={ms}:all=1")

    # 2. Remove silence
    if e.get("remove_silence"):
        thr_db = float(e.get("silence_threshold_db", -40) or -40)
        min_dur = float(e.get("min_silence_duration", 0.3) or 0.3)
        filters.append(
            f"silenceremove=stop_periods=-1"
            f":stop_duration={min_dur:.3f}"
            f":stop_threshold={thr_db:.1f}dB"
        )

    # 3. Pitch shift (semitones), duration-preserving
    pitch = float(e.get("pitch_semitones", 0) or 0)
    if abs(pitch) > 0.01:
        factor = 2.0 ** (pitch / 12.0)   # frequency multiplier
        new_sr = int(round(sr * factor))
        tempo_factor = 1.0 / factor       # compensate duration change
        filters.append(f"asetrate={new_sr}")
        filters.append(f"aresample={sr}")
        filters.extend(_atempo_chain(tempo_factor))

    # 4. Bass shelving
    bass = float(e.get("bass_db", 0) or 0)
    if abs(bass) > 0.001:
        filters.append(f"bass=g={bass:.2f}")

    # 5. Treble shelving
    treble = float(e.get("treble_db", 0) or 0)
    if abs(treble) > 0.001:
        filters.append(f"treble=g={treble:.2f}")

    # 6. 5-band parametric EQ
    eq_bands = e.get("eq") or [0, 0, 0, 0, 0]
    eq_freqs = [60, 250, 1000, 4000, 12000]
    for freq, gain in zip(eq_freqs, eq_bands):
        gain = float(gain or 0)
        if abs(gain) > 0.001:
            filters.append(f"equalizer=f={freq}:width_type=o:width=1.0:g={gain:.2f}")

    # 7. Volume (dB)
    vol_db = float(e.get("volume_db", 0) or 0)
    if abs(vol_db) > 0.001:
        filters.append(f"volume={vol_db:.2f}dB")

    # 8. Loudness normalization (EBU R128)
    if e.get("normalize"):
        lufs = float(e.get("target_lufs", -14) or -14)
        filters.append(f"loudnorm=I={lufs:.0f}:LRA=7:TP=-2")

    # 9. Reverb (via multi-tap aecho)
    reverb = e.get("reverb") or {}
    if reverb.get("enabled"):
        room = float(reverb.get("room_size", 50) or 50) / 100.0   # 0-1
        wet  = float(reverb.get("wet",  30) or 30)  / 100.0       # 0-1
        dry  = float(reverb.get("dry",  70) or 70)  / 100.0       # 0-1
        dec  = float(reverb.get("decay", 1.5) or 1.5)             # 0-5 sec

        base_ms = int(20 + room * 130)        # 20-150 ms first tap
        d2 = int(base_ms * 1.5)
        d3 = int(base_ms * 2.3)

        decay_val = min(0.90, 0.10 + (dec / 5.0) * 0.80)  # 0.10-0.90
        d2_dec = round(decay_val * 0.70, 3)
        d3_dec = round(decay_val * 0.50, 3)
        decay_val = round(decay_val, 3)

        in_gain  = round(min(1.0, 0.5 + dry  * 0.5), 3)   # 0.5-1.0
        out_gain = round(min(0.8, wet * 0.80), 3)          # 0.0-0.8

        delays_str = f"{base_ms}|{d2}|{d3}"
        decays_str = f"{decay_val}|{d2_dec}|{d3_dec}"
        filters.append(f"aecho={in_gain}:{out_gain}:{delays_str}:{decays_str}")

    # 10. Echo
    echo = e.get("echo") or {}
    if echo.get("enabled"):
        delay_ms  = int(float(echo.get("delay_ms", 200) or 200))
        echo_dec  = float(echo.get("decay", 0.3) or 0.3)
        filters.append(f"aecho=0.8:0.50:{delay_ms}:{echo_dec:.3f}")

    # 11. Fade in
    fade_in = float(e.get("fade_in", 0) or 0)
    if fade_in > 0.001:
        filters.append(f"afade=t=in:st=0:d={fade_in:.3f}")

    # 12. Fade out (use original duration as estimate)
    fade_out = float(e.get("fade_out", 0) or 0)
    if fade_out > 0.001 and duration > fade_out:
        start = round(duration - fade_out, 3)
        filters.append(f"afade=t=out:st={start}:d={fade_out:.3f}")

    # 13. Add silence after
    sil_after = float(e.get("add_silence_after", 0) or 0)
    if sil_after > 0.001:
        filters.append(f"apad=pad_dur={sil_after:.3f}")

    return filters


# ─── Main entry point ─────────────────────────────────────────────────────────

def process_audio(
    input_path: str,
    output_path: str,
    effects: dict | None = None,
    output_format: str = "wav",
    sample_rate: int | None = None,
    mp3_bitrate: int = 192,
) -> None:
    """
    Apply audio effects to input_path and write result to output_path.

    output_format: 'wav' or 'mp3'
    sample_rate  : target sample rate; None = keep original
    mp3_bitrate  : kbps when output_format='mp3'

    Raises RuntimeError if FFmpeg is not found or processing fails.
    """
    ffmpeg = _find_ffmpeg()
    if effects is None:
        effects = {}

    src_sr   = _get_sample_rate(input_path)
    duration = _get_duration(input_path)
    out_sr   = sample_rate if sample_rate else src_sr

    filters = _build_filter_chain(effects, src_sr, duration)
    filter_str = ",".join(filters) if filters else "anull"

    # Temp file — safe even when input_path == output_path
    tmp_out = output_path + ".pp_tmp"
    if output_format == "mp3":
        tmp_out += ".mp3"
    else:
        tmp_out += ".wav"

    if output_format == "mp3":
        codec_args = ["-c:a", "libmp3lame", "-b:a", f"{mp3_bitrate}k", "-q:a", "2"]
    else:
        codec_args = ["-c:a", "pcm_s16le"]

    cmd = [
        ffmpeg, "-y",
        "-i", input_path,
        "-af", filter_str,
        "-ar", str(out_sr),
        *codec_args,
        tmp_out,
    ]

    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=300, shell=False)
    except subprocess.TimeoutExpired:
        _safe_remove(tmp_out)
        raise RuntimeError("FFmpeg: превышено время ожидания (300 сек)")

    if r.returncode != 0:
        _safe_remove(tmp_out)
        raise RuntimeError(
            f"FFmpeg завершился с ошибкой (код {r.returncode}):\n{r.stderr[-3000:]}"
        )

    if os.path.exists(output_path):
        os.unlink(output_path)
    os.replace(tmp_out, output_path)


def check_ffmpeg() -> dict:
    """Return {available: bool, path: str|None, version: str|None}."""
    path = shutil.which("ffmpeg")
    if not path:
        return {"available": False, "path": None, "version": None}
    try:
        r = subprocess.run([path, "-version"], capture_output=True, text=True, timeout=10)
        ver_line = r.stdout.splitlines()[0] if r.stdout else ""
        return {"available": True, "path": path, "version": ver_line}
    except Exception:
        return {"available": True, "path": path, "version": None}
