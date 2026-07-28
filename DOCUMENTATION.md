# TTS Studio — Полная документация

> Локальный офлайн-инструмент для синтеза речи, клонирования голоса, транскрипции и редактирования субтитров.

---

## Содержание

1. [Быстрый старт](#1-быстрый-старт)
2. [Архитектура](#2-архитектура)
3. [Вкладки — руководство пользователя](#3-вкладки--руководство-пользователя)
   - 3.1 [Windows голоса](#31-windows-голоса)
   - 3.2 [Клонирование (XTTS v2)](#32-клонирование-xtts-v2)
   - 3.3 [Мои голоса](#33-мои-голоса)
   - 3.4 [История](#34-история)
   - 3.5 [Субтитры](#35-субтитры)
4. [API Reference](#4-api-reference)
5. [Структура файлов проекта](#5-структура-файлов-проекта)
6. [Зависимости](#6-зависимости)
7. [Разработка](#7-разработка)

---

## 1. Быстрый старт

### Требования

| Компонент | Минимум |
|---|---|
| Python | 3.10+ |
| ОС | Windows 10/11 (основная), Linux/macOS (частичная поддержка) |
| VRAM | 4 GB+ для XTTS v2 (опционально) |

### Установка

```bash
# 1. Установить зависимости
pip install -r requirements.txt

# 2. (Опционально) XTTS v2 — клонирование голоса
install_xtts.bat

# 3. (Опционально) Дополнительные OneCore-голоса Windows
add_voices_admin.bat   # требует запуска от администратора
```

### Запуск

```bash
python app.py
# Сервер стартует на http://127.0.0.1:7860 и открывается в браузере
```

---

## 2. Архитектура

```
app.py
├── middleware/no_cache.py        # Отключает кэш для JS/CSS
├── routers/
│   ├── voices.py          /api/voices        — Windows и сохранённые голоса
│   ├── synthesis.py       /api/synthesize    — SSE-синтез (Windows, XTTS, Saved)
│   ├── xtts.py            /api/xtts          — Статус установки XTTS
│   ├── history.py         /api/history       — Браузер аудиофайлов
│   ├── subtitles.py       /api/subtitles     — CRUD для SRT-файлов
│   └── transcribe.py      /api/transcribe    — Whisper транскрипция
├── services/
│   ├── tts_windows.py     — pyttsx3 / SAPI5 синтез
│   ├── tts_xtts.py        — Coqui XTTS v2 синтез
│   └── sse.py             — SSE-стриминг (поток прогресса)
├── core/
│   ├── audio.py           — WAV ввод/вывод; `save_named_audio()` → `.outputs/audio/`
│   ├── history_manager.py — Управление аудиофайлами в `.outputs/audio/`
│   ├── voice_manager.py   — Управление профилями голосов
│   ├── log.py             — Логирование в stdout + `.outputs/logs/YYYY-MM-DD.log`
│   └── schemas.py         — Pydantic-модели
└── static/
    ├── index.html         — SPA (одна страница, 5 вкладок)
    ├── css/
    └── js/
        ├── app.js              — Вход, ленивая инициализация вкладок
        ├── api.js              — fetch-хелперы + SSE-парсер
        ├── audio-player.js     — плеер с waveform, seekbar, drag-to-scrub
        ├── wave-renderer.js    — canvas-рендерер waveform
        ├── loader.js           — withLoader() / makeSkeleton()
        ├── audio-manager.js    — синглтон: один плеер в момент времени
        ├── custom-select.js    — dropdown-компонент
        ├── file-upload.js      — drag-and-drop загрузка файла
        ├── events.js           — EventTarget-шина (voices-changed, history-changed)
        ├── icons.js            — SVG-иконки
        ├── logger.js           — плавающая панель прогресса
        ├── modal.js            — openConfirm() / openPrompt()
        ├── tabs.js             — переключение вкладок
        ├── toast.js            — уведомления
        └── tabs/
            ├── windows.js      — Windows TTS
            ├── cloning.js      — XTTS клонирование
            ├── saved.js        — сохранённые голоса
            ├── history.js      — История (браузер файлов)
            └── subtitles.js    — редактор субтитров + Whisper
```

### SSE-поток (стриминг синтеза)

Все эндпоинты синтеза возвращают `text/event-stream`. Формат кадров:

```
event: progress
data: {"value": 0.45, "desc": "Синтез слова 5/10"}

event: done
data: {"audio_url": "/api/history/audio-2024-07-10_12-00-00.wav/audio",
       "filename": "audio-2024-07-10_12-00-00.wav",
       "status": "✓ Готово — 3.2 сек"}

event: error
data: {"status": "❌ Ошибка: голос не найден"}
```

### Ленивая инициализация вкладок

При загрузке страницы инициализируется только вкладка **Windows голоса**. Остальные вкладки инициализируются при первом клике и запоминаются в `Set ready`.

---

## 3. Вкладки — руководство пользователя

### Аудиоплеер (общий для всех вкладок)

| Элемент | Описание |
|---|---|
| Waveform | Кликните или перетащите для перемотки; при наведении — всплывающая подсказка со временем |
| Seekbar | Оранжевая полоса под waveform |
| Временны́е метки | Текущая позиция и общая длительность |
| Skip ±5 с | Перемотка назад/вперёд на 5 секунд |
| Скорость | Цикл по 0.5×, 0.75×, 1×, 1.25×, 1.5×, 2× |
| Скачать | Сохранить WAV-файл |

---

### 3.1 Windows голоса

Синтез речи через системные SAPI5-голоса Windows (pyttsx3).

| Элемент | Описание |
|---|---|
| Выбор голоса | Выпадающий список всех SAPI5-голосов; русские голоса идут первыми |
| Скорость | 50–350 слов/мин |
| Громкость | 0–100% |
| Текст | Многострочное текстовое поле |
| Кнопка «Синтез» | Запускает генерацию; прогресс в Logger-панели |

**После синтеза:**
- Появляется аудиоплеер с результатом
- Автоматически обновляется раздел **История → Аудио**
- Можно сгенерировать субтитры к озвученному тексту

---

### 3.2 Клонирование (XTTS v2)

Синтез речи с клонированием голоса по аудиообразцу (Coqui XTTS v2, ~2 GB модель).

> **Требование:** XTTS v2 должен быть установлен (`install_xtts.bat`).

**Шаги:**

1. Загрузить образец голоса (WAV/MP3, **10–30 секунд**, чистая речь)
2. Выбрать язык синтеза
3. Ввести текст
4. Нажать «Синтез»

**Поддерживаемые языки:** ru, en, de, fr, es, it, pl, uk

**Сохранение голоса:** образец можно сохранить как профиль (кнопка «Сохранить голос»). Доступен во вкладке **Мои голоса**.

---

### 3.3 Мои голоса

Управление сохранёнными голосовыми профилями.

- Просмотр и предпрослушивание голосов
- Переименование / удаление
- Синтез текста с выбранным голосом и языком
- Автоматическое обновление при изменениях (событие `voices-changed`)

---

### 3.4 История

Централизованный браузер созданных материалов. Два раздела (переключение кнопками).

**Поиск** — строка «Поиск…» фильтрует список активного раздела по имени файла.

#### Аудио
- Список синтезированных WAV-файлов (новые сверху)
- Встроенный плеер, переименование, удаление
- Обновляется автоматически после каждого синтеза

#### Субтитры
- Список сохранённых SRT-файлов
- Предпросмотр содержимого
- Загрузить в редактор субтитров (кнопка «Восстановить в редактор»)
- Скачать как `.srt`

---

### 3.5 Субтитры

Редактор SRT-файлов с поддержкой автоматической транскрипции через Whisper.

#### Редактор

- Ввод текста и ручное редактирование SRT-блоков
- Параметры авторазбивки:
  - Режим: по предложению / по строке / авто
  - Максимальное количество символов на блок
- Сохранение как `.srt` файл (POST `/api/subtitles`)

#### Транскрипция (Whisper)

> `openai-whisper` устанавливается автоматически из `requirements.txt`. При первом запуске скачивается модель `base` (~140 MB).

1. Загрузить аудиофайл
2. Выбрать язык (ru / en / uk / de / fr / es / zh / ja)
3. Нажать «Распознать речь»
4. Результат автоматически заполняет редактор субтитров

---

## 4. API Reference

### Базовый URL

```
http://127.0.0.1:7860
```

### 4.1 Голоса

#### `GET /api/voices/windows`
```json
{ "voices": ["Irina", "Pavel", "..."], "default": "Irina" }
```

#### `GET /api/voices/saved`
```json
{ "voices": ["Голос1"], "urls": { "Голос1": "/api/voices/saved/Голос1/audio" } }
```

#### `POST /api/voices/saved`
```
Form: audio=<file>, name=<str>
```

#### `PUT /api/voices/saved/{name}`
```json
Body: { "new_name": "НовоеИмя" }
```

#### `DELETE /api/voices/saved/{name}`

---

### 4.2 Синтез (SSE)

#### `POST /api/synthesize/windows`
```json
{ "text": "Привет!", "voice": "Irina", "rate": 200, "volume": 100 }
```

#### `POST /api/synthesize/xtts`
```
Form: audio=<file>, text=<str>, language=<str>
```

#### `POST /api/synthesize/saved`
```json
{ "text": "Текст", "voice": "ИмяПрофиля", "language": "ru" }
```

---

### 4.3 XTTS

#### `GET /api/xtts/status`
```json
{ "status": "XTTS v2 установлен", "languages": { "Русский": "ru", ... } }
```

---

### 4.4 История аудио

#### `GET /api/history`
```json
{ "files": ["audio-2024-07-10_12-00-00.wav"] }
```

#### `GET /api/history/{name}/audio` — стриминг WAV (Range-запросы).
#### `PUT /api/history/{name}` — `{ "new_name": "новое-имя.wav" }`
#### `DELETE /api/history/{name}`

---

### 4.5 Субтитры (SRT)

#### `GET /api/subtitles`
```json
{ "files": ["project.srt"] }
```

#### `GET /api/subtitles/{name}`
```json
{ "name": "project.srt", "content": "1\n00:00:00,000 --> ...\n" }
```

#### `POST /api/subtitles`
```json
{ "name": "project", "content": "1\n00:00:00,000 --> 00:00:03,000\nТекст\n" }
```

#### `PUT /api/subtitles/{name}` / `DELETE /api/subtitles/{name}`

---

### 4.6 Транскрипция (Whisper, SSE)

#### `POST /api/transcribe/audio`
```
Form: file=<audio_file>, language=<str>
SSE done: { "srt": "1\n00:00:00,000 --> ...\n" }
```

---

## 5. Структура файлов проекта

```
tts/
├── app.py
├── requirements.txt
├── README.md
├── DOCUMENTATION.md
├── CLAUDE.md
├── install.bat / run.bat / add_voices_admin.bat / install_xtts.bat
│
├── docs/
│   ├── architecture.md
│   ├── api.md
│   ├── user-guide.md
│   └── developer-guide.md
│
├── routers/
│   ├── voices.py
│   ├── synthesis.py
│   ├── xtts.py
│   ├── history.py
│   ├── subtitles.py
│   └── transcribe.py
│
├── services/
│   ├── tts_windows.py
│   ├── tts_xtts.py
│   └── sse.py
│
├── core/
│   ├── audio.py
│   ├── history_manager.py
│   ├── voice_manager.py
│   ├── log.py
│   └── schemas.py
│
├── middleware/
│   └── no_cache.py
│
├── static/
│   ├── index.html
│   ├── css/
│   └── js/
│       ├── app.js
│       ├── api.js
│       ├── audio-manager.js
│       ├── audio-player.js
│       ├── wave-renderer.js
│       ├── custom-select.js
│       ├── events.js
│       ├── file-upload.js
│       ├── icons.js
│       ├── loader.js
│       ├── logger.js
│       ├── modal.js
│       ├── tabs.js
│       ├── toast.js
│       └── tabs/
│           ├── windows.js
│           ├── cloning.js
│           ├── saved.js
│           ├── history.js
│           └── subtitles.js
│
├── saved_voices/            # XTTS голосовые образцы (.wav)
└── .outputs/
    ├── audio/               # Синтезированные WAV-файлы
    ├── subtitle/            # SRT-файлы
    ├── logs/                # Серверные логи (YYYY-MM-DD.log)
    └── temp/                # Временные файлы (аудио для транскрипции)
```

---

## 6. Зависимости

### Обязательные

| Пакет | Назначение |
|---|---|
| `fastapi >= 0.110` | Web-фреймворк |
| `uvicorn[standard] >= 0.27` | ASGI-сервер |
| `python-multipart >= 0.0.9` | Парсинг form-data |
| `pyttsx3 >= 2.90` | Windows SAPI5 TTS |
| `soundfile >= 0.12.0` | WAV ввод/вывод |
| `numpy >= 1.22.0` | Аудиомассивы |
| `openai-whisper >= 20230314` | Транскрипция речи — первый запуск скачивает модель `base` (~140 MB) |

### Опциональные (XTTS v2)

| Пакет | Назначение |
|---|---|
| `TTS` (Coqui) | Клонирование голоса |
| `torch` | Зависимость TTS (GPU опционально) |

---

## 7. Разработка

### Запуск

```bash
python app.py
# hot-reload отсутствует; перезапускать вручную после изменений бэкенда
```

Фронтенд перезагружается при обновлении страницы (`NoCacheStaticMiddleware` отключает кэш JS/CSS).

### Добавление нового роутера

1. Создать `routers/my_router.py` с `router = APIRouter()`
2. Добавить в `app.py`:
   ```python
   from routers.my_router import router as my_router
   app.include_router(my_router, prefix="/api/my-feature")
   ```

### SSE-эндпоинт (шаблон)

```python
from services.sse import run_synth_stream
from fastapi.responses import StreamingResponse

@router.post("/my-synthesis")
async def my_synthesis(body: MyBody):
    def core_fn(text, progress=None):
        if progress: progress(0.5, "Половина готова")
        return result

    return StreamingResponse(
        run_synth_stream(core_fn, (body.text,)),
        media_type="text/event-stream"
    )
```

### Кросс-вкладочные события

```js
import { events } from '../events.js';

events.dispatchEvent(new CustomEvent('history-changed'));
events.addEventListener('history-changed', () => loadAudioList());
```

Доступные события: `voices-changed`, `history-changed`, `subtitles-changed`.

### Логирование

```python
from core.log import app_log

app_log("Синтез завершён", level="INFO", source="Windows")
```

Логи пишутся в stdout и в `.outputs/logs/YYYY-MM-DD.log`.

---

*Документация актуальна для текущей ветки. Обновлено: 2026-07-28.*
