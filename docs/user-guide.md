# User Guide

## Starting the app

Double-click **`run.bat`**, or from a terminal:

```bash
python app.py
```

The browser opens automatically at **http://127.0.0.1:7860**. Stop with `Ctrl+C`.

---

## Audio Player

The audio player appears after synthesis (Windows Voices, Cloning, Saved Voices tabs) and in the History tab. Controls:

- **Waveform** — click or drag anywhere on the waveform to seek. Hover shows a time tooltip.
- **Seekbar** — the orange-filled range slider below the waveform. Drag to seek; stays in sync with the waveform.
- **Timestamps** — current position and total duration.
- **Skip ±5 s** — skip back or forward 5 seconds.
- **Speed** — cycle through 0.5×, 0.75×, 1×, 1.25×, 1.5×, 2×.
- **Download** — save the audio file.

---

## Tab: Windows Voices

Synthesises text using built-in Windows SAPI voices (Irina, Pavel, Zira, David, …).

1. Select a voice from the dropdown.
2. Adjust **Rate** (speed) and **Volume** sliders.
3. Enter text in the text area.
4. Click **Синтезировать** — progress streams in real time.
5. The result appears as an audio player. Use **История** tab to manage saved files.

**Generate subtitles** — after synthesis a subtitle panel appears; set split mode and max characters, then click **Скачать** to get an SRT.

> If the dropdown is empty, run `add_voices_admin.bat` as administrator and restart the app.

---

## Tab: Клонирование (XTTS v2)

Zero-shot voice cloning from a 10–30 second reference audio.

1. Upload a reference WAV or MP3 (drag-and-drop or click the upload zone).
2. Select the **language** of the text you will synthesise.
3. Enter text and click **Клонировать + Синтезировать**.
4. Optionally click **Сохранить голос** to save the profile for reuse.

The XTTS v2 model (~1.8 GB) downloads on first use. GPU (NVIDIA CUDA) dramatically speeds synthesis; CPU fallback works but is slow.

---

## Tab: Мои голоса

Library of saved voice profiles created in the Cloning tab.

- Select a profile from the list, enter text, click **Синтезировать**.
- **Rename** or **Delete** voices using the icons in the list.
- Changes fire a `voices-changed` event so the Cloning tab refreshes automatically.

---

## Tab: Субтитры

SRT subtitle editor with Whisper transcription.

1. **Transcribe** — upload audio; Whisper generates a draft SRT.
2. **Edit** — add, remove, or adjust subtitle blocks (start/end time, text).
3. **Save** — give it a name; saved as a versioned file.
4. **Load** — pick any saved SRT from the dropdown in История → Субтитры.

---

## Tab: История

File browser with two sections (select in the top bar). Use the **Поиск…** input in the toolbar to filter by name in real time.

| Section | Contents |
|---------|----------|
| **Аудио** | Generated TTS audio files. Play, download, rename, delete. |
| **Субтитры** | Saved SRT files. Preview, restore to editor, download, rename, delete. |

---

## Troubleshooting

**No voices in Windows Voices dropdown**  
Run `add_voices_admin.bat` as administrator, then restart the app.

**Cloning tab shows "XTTS not installed"**  
Run `install.bat` — it checks and installs XTTS automatically. The model (~1.8 GB) downloads on first use.

**Whisper transcription is slow**  
Whisper uses CPU if no CUDA GPU is detected. A NVIDIA GPU with CUDA dramatically speeds it up.

**Port 7860 already in use**  
Change the port at the bottom of `app.py`:
```python
uvicorn.run(app, host="127.0.0.1", port=7861, ...)
```

**Old JS/CSS still loading after a code change**  
The server sends `Cache-Control: no-store` for all JS and CSS. Do a hard refresh: `Ctrl + Shift + R`.
