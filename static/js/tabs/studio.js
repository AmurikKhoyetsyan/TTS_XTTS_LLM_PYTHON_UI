/**
 * Studio tab — Voice & Audio Controls
 *
 * Pipeline: Text → XTTS v2 → Original WAV → FFmpeg → Processed WAV
 *
 * Design principle: DOM is fully constructed and appended BEFORE any
 * getElementById / querySelector / event wiring, to avoid null refs.
 */

import { getJSON, postJSON, synthesizeStream } from '../api.js';
import { AudioPlayer } from '../audio-player.js';
import { audioManager } from '../audio-manager.js';
import { log, progress as logProgress } from '../logger.js';
import { toast } from '../toast.js';
import { events } from '../events.js';
import { FileUpload } from '../file-upload.js';

// ─── Defaults ─────────────────────────────────────────────────────────────────

const XTTS_DEF = {
    speed: 1.0, temperature: 0.65, repetition_penalty: 2.0,
    top_p: 0.8, top_k: 50, length_penalty: 1.0,
};

const FX_DEF = {
    volume_db: 0, normalize: false, target_lufs: -14,
    bass_db: 0, treble_db: 0, eq: [0, 0, 0, 0, 0],
    pitch_semitones: 0,
    reverb: { enabled: false, room_size: 50, wet: 30, dry: 70, decay: 1.5 },
    echo:   { enabled: false, delay_ms: 200, decay: 0.3 },
    fade_in: 0, fade_out: 0,
    remove_silence: false, silence_threshold_db: -40, min_silence_duration: 0.3,
    add_silence_before: 0, add_silence_after: 0,
};

// ─── Module state ─────────────────────────────────────────────────────────────

let _upload      = null;
let _origPlayer  = null;
let _procPlayer  = null;
let _origFilename = null;

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

const q = id => document.getElementById(id);

function setSlider(id, value) {
    const inp = q(id);
    if (!inp) return;
    inp.value = value;
    inp.dispatchEvent(new Event('input'));
}

function setStatus(id, cls, text) {
    const e = q(id);
    if (!e) return;
    e.className = 'studio-status' + (cls ? ' ' + cls : '');
    e.textContent = text;
}

const fmtDb   = v => { const n = parseFloat(v); return (n >= 0 ? '+' : '') + n.toFixed(1) + ' dB'; };
const fmtSemi = v => { const n = parseFloat(v); return (n > 0 ? '+' : '') + n.toFixed(0) + ' пт'; };
const fmtSec  = v => parseFloat(v).toFixed(1) + ' с';
const fmtMs   = v => parseInt(v) + ' мс';

// ─── HTML building helpers ────────────────────────────────────────────────────

function sliderRow(label, id, min, max, step, value, fmtFn) {
    return `
        <div class="ctrl-row">
            <span class="ctrl-label">${label}</span>
            <input type="range" id="st-${id}" min="${min}" max="${max}" step="${step}" value="${value}">
            <span class="ctrl-val" id="st-${id}-val">${fmtFn(value)}</span>
        </div>`;
}

function card(id, title, bodyHtml, collapsed = false) {
    return `
        <div class="studio-card${collapsed ? ' collapsed' : ''}" id="card-${id}">
            <div class="studio-card-hdr">
                <h3>${title}</h3>
                <span class="studio-card-arrow">▼</span>
            </div>
            <div class="studio-card-body">${bodyHtml}</div>
        </div>`;
}

const divider = () => `<div class="studio-divider"></div>`;
const sectionTitle = t => `<div class="st-sect-title">${t}</div>`;

// ─── Full HTML template ────────────────────────────────────────────────────────

function buildHTML() {
    // ── VOICE ──
    const voiceBody = `
        <div class="compact-row" style="margin-bottom:10px">
            <label><input type="radio" name="st-vmode" value="upload" checked> Загрузить образец</label>
            <label><input type="radio" name="st-vmode" value="saved"> Сохранённый голос</label>
        </div>
        <div id="st-upload-wrap"></div>
        <div id="st-saved-wrap" style="display:none">
            <select id="st-saved-sel" class="studio-select" style="width:100%;margin-bottom:6px">
                <option value="">— Нет сохранённых голосов —</option>
            </select>
        </div>
        <div class="compact-row">
            <label>Язык</label>
            <select id="st-lang" class="studio-select" style="flex:1">
                <option value="Русский">Русский</option>
                <option value="English">English</option>
                <option value="Deutsch">Deutsch</option>
                <option value="Français">Français</option>
                <option value="Español">Español</option>
                <option value="Italiano">Italiano</option>
                <option value="Polski">Polski</option>
                <option value="Українська">Українська</option>
            </select>
        </div>`;

    // ── TEXT ──
    const textBody = `
        <textarea id="st-text" rows="5" placeholder="Введите текст для синтеза…"
            class="studio-input" style="width:100%;box-sizing:border-box;resize:vertical;line-height:1.5;font-size:13px"></textarea>`;

    // ── XTTS PARAMS ──
    const xttsBody = `
        <div class="preset-row">
            <label>Пресет</label>
            <select id="st-xtts-preset" class="studio-select"><option value="">— Выбрать пресет —</option></select>
            <button class="studio-reset" id="st-xtts-reset">Сбросить</button>
        </div>
        ${sliderRow('Speed',       'speed', 0.5, 2.0, 0.05, 1.0,  v => parseFloat(v).toFixed(2) + 'x')}
        ${sliderRow('Temperature', 'temp',  0.1, 1.5, 0.05, 0.65, v => parseFloat(v).toFixed(2))}
        ${sliderRow('Repetition',  'rep',   1.0, 5.0, 0.1,  2.0,  v => parseFloat(v).toFixed(1))}
        ${sliderRow('Top P',       'topp',  0.1, 1.0, 0.05, 0.8,  v => parseFloat(v).toFixed(2))}
        ${sliderRow('Top K',       'topk',  1,   100, 1,    50,   v => parseInt(v))}
        ${sliderRow('Length Pen.', 'lenp',  0.5, 2.0, 0.05, 1.0,  v => parseFloat(v).toFixed(2))}`;

    // ── EFFECTS ──
    const eqBands = [
        { label: '60 Hz',  id: 'eq0' },
        { label: '250 Hz', id: 'eq1' },
        { label: '1 kHz',  id: 'eq2' },
        { label: '4 kHz',  id: 'eq3' },
        { label: '12 kHz', id: 'eq4' },
    ].map(b => `
        <div class="eq-band">
            <span class="eq-band-val" id="st-${b.id}-val">0</span>
            <input type="range" class="eq-slider" id="st-${b.id}" min="-12" max="12" step="0.5" value="0" orient="vertical">
            <span class="eq-band-label">${b.label}</span>
        </div>`).join('');

    const fxBody = `
        ${sectionTitle('Громкость')}
        ${sliderRow('Volume', 'vol', -20, 20, 0.5, 0, fmtDb)}
        <div class="ctrl-toggle-row" style="margin-top:4px">
            <label><input type="checkbox" id="st-norm"> Нормализация (EBU R128)</label>
            <select id="st-lufs" class="studio-select">
                <option value="-16">-16 LUFS</option>
                <option value="-14" selected>-14 LUFS</option>
                <option value="-12">-12 LUFS</option>
                <option value="-10">-10 LUFS</option>
            </select>
        </div>
        ${divider()}
        ${sectionTitle('Тональность')}
        ${sliderRow('Pitch', 'pitch', -12, 12, 1, 0, fmtSemi)}
        ${divider()}
        ${sectionTitle('Тембр')}
        ${sliderRow('Bass',   'bass',   -12, 12, 0.5, 0, fmtDb)}
        ${sliderRow('Treble', 'treble', -12, 12, 0.5, 0, fmtDb)}
        ${divider()}
        ${sectionTitle('Эквалайзер (5 полос)')}
        <div class="eq-wrap">${eqBands}</div>
        ${divider()}
        ${sectionTitle('Реверберация')}
        <div class="ctrl-toggle-row">
            <label><input type="checkbox" id="st-rev-en"> Включить</label>
            <select id="st-rev-preset" class="studio-select">
                <option value="">— Пресет —</option>
            </select>
        </div>
        <div class="ctrl-indent">
            ${sliderRow('Room Size', 'revroom', 0,  100, 1,   50,  v => parseInt(v) + '%')}
            ${sliderRow('Wet',       'revwet',  0,  100, 1,   30,  v => parseInt(v) + '%')}
            ${sliderRow('Dry',       'revdry',  0,  100, 1,   70,  v => parseInt(v) + '%')}
            ${sliderRow('Decay',     'revdec',  0,  5,   0.1, 1.5, fmtSec)}
        </div>
        ${divider()}
        ${sectionTitle('Эхо')}
        <div class="ctrl-toggle-row">
            <label><input type="checkbox" id="st-echo-en"> Включить</label>
            <select id="st-echo-preset" class="studio-select">
                <option value="">— Пресет —</option>
            </select>
        </div>
        <div class="ctrl-indent">
            ${sliderRow('Задержка',  'echodel', 50,  1000, 10,   200, fmtMs)}
            ${sliderRow('Затухание', 'echodec', 0,   0.9,  0.05, 0.3, v => parseFloat(v).toFixed(2))}
        </div>
        ${divider()}
        ${sectionTitle('Фейды')}
        ${sliderRow('Fade In',  'fadein',  0, 5, 0.1, 0, fmtSec)}
        ${sliderRow('Fade Out', 'fadeout', 0, 5, 0.1, 0, fmtSec)}
        ${divider()}
        ${sectionTitle('Тишина')}
        <div class="ctrl-toggle-row">
            <label><input type="checkbox" id="st-sil-rm"> Убрать тишину</label>
        </div>
        <div class="ctrl-indent">
            <div class="compact-row">
                <label>Порог</label>
                <select id="st-sil-thr" class="studio-select">
                    <option value="-60">-60 dB</option>
                    <option value="-50">-50 dB</option>
                    <option value="-40" selected>-40 dB</option>
                    <option value="-30">-30 dB</option>
                </select>
            </div>
            ${sliderRow('Мин. длит.', 'silmin', 0.1, 2.0, 0.1, 0.3, fmtSec)}
        </div>
        <div class="st-sect-title" style="margin-top:8px">Добавить тишину</div>
        ${sliderRow('До',    'silbefore', 0, 3, 0.1, 0, fmtSec)}
        ${sliderRow('После', 'silafter',  0, 3, 0.1, 0, fmtSec)}`;

    // ── OUTPUT ──
    const outputBody = `
        <div class="compact-row">
            <label>Формат</label>
            <select id="st-fmt" class="studio-select">
                <option value="wav" selected>WAV</option>
                <option value="mp3">MP3</option>
            </select>
        </div>
        <div class="compact-row">
            <label>Sample Rate</label>
            <select id="st-sr" class="studio-select">
                <option value="24000" selected>24 kHz (XTTS default)</option>
                <option value="44100">44.1 kHz</option>
                <option value="48000">48 kHz</option>
            </select>
        </div>
        <div class="compact-row" id="st-mp3-row" style="display:none">
            <label>MP3 Bitrate</label>
            <select id="st-br" class="studio-select">
                <option value="128">128 kbps</option>
                <option value="192" selected>192 kbps</option>
                <option value="256">256 kbps</option>
                <option value="320">320 kbps</option>
            </select>
        </div>`;

    // ── PREVIEW ──
    const previewBody = `
        <div class="studio-preview-grid">
            <div>
                <div class="studio-preview-label">Оригинал (XTTS v2)</div>
                <div class="audio-player" id="st-player-orig"></div>
                <a id="st-dl-orig" class="btn" style="display:none;width:100%;text-align:center;margin-top:6px;box-sizing:border-box" download>↓ Скачать оригинал</a>
            </div>
            <div>
                <div class="studio-preview-label">Обработанный (FFmpeg)</div>
                <div class="audio-player" id="st-player-proc"></div>
                <a id="st-dl-proc" class="btn" style="display:none;width:100%;text-align:center;margin-top:6px;box-sizing:border-box" download>↓ Скачать обработанный</a>
            </div>
        </div>`;

    // ── PROJECT ──
    const projBody = `
        <div class="st-sect-title">Пресеты</div>
        <div class="studio-mgr-row">
            <input type="text" id="st-preset-name" class="studio-input" placeholder="Имя пресета…">
            <button class="btn" id="st-preset-save">Сохранить пресет</button>
        </div>
        <div class="studio-divider"></div>
        <div class="st-sect-title">Проект</div>
        <div class="studio-mgr-row">
            <input type="text" id="st-proj-name" class="studio-input" placeholder="Имя проекта…">
            <button class="btn btn-primary" id="st-proj-save">Сохранить</button>
        </div>
        <div style="margin-bottom:6px">
            <button class="btn" id="st-proj-load-btn" style="width:100%">↓ Загрузить проект</button>
        </div>
        <div id="st-proj-load-wrap" style="display:none;margin-top:4px">
            <div class="studio-mgr-row">
                <select id="st-proj-sel" class="studio-select" style="flex:1">
                    <option value="">— Выберите проект —</option>
                </select>
                <button class="btn" id="st-proj-load">Загрузить</button>
            </div>
        </div>
        <div class="studio-status" id="st-proj-status"></div>`;

    return `
        <!-- Pipeline indicator -->
        <div class="studio-pipeline">
            <span class="studio-pipeline-step" id="pipe-xtts">XTTS v2</span>
            <span class="studio-pipeline-arrow">→</span>
            <span class="studio-pipeline-step" id="pipe-wav">WAV</span>
            <span class="studio-pipeline-arrow">→</span>
            <span class="studio-pipeline-step" id="pipe-ffmpeg">FFmpeg</span>
            <span class="studio-pipeline-arrow">→</span>
            <span class="studio-pipeline-step" id="pipe-final">Результат</span>
        </div>

        <div class="studio-layout">
            <!-- LEFT COLUMN -->
            <div>
                ${card('voice', 'ГОЛОС', voiceBody)}
                ${card('text',  'ТЕКСТ', textBody)}
                ${card('xtts',  'ПАРАМЕТРЫ XTTS v2', xttsBody)}
                <div style="display:flex;gap:8px;margin-bottom:8px">
                    <button class="btn btn-primary" id="st-generate" style="flex:1">Синтезировать</button>
                </div>
                <div class="studio-status" id="st-gen-status"></div>
            </div>

            <!-- RIGHT COLUMN -->
            <div>
                ${card('fx', 'ПОСТОБРАБОТКА (FFmpeg)', fxBody)}
                ${card('output', 'ВЫВОД', outputBody, true)}
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
                    <button class="btn btn-primary" id="st-apply" style="flex:1">Применить эффекты</button>
                    <button class="btn" id="st-reset-fx">Сбросить эффекты</button>
                </div>
                <div class="studio-status" id="st-fx-status"></div>
            </div>
        </div>

        <!-- PREVIEW — full width -->
        <div style="margin-top:16px">
            ${card('preview', 'ПРЕДПРОСМОТР', previewBody)}
        </div>

        <!-- PROJECT — full width -->
        <div>
            ${card('project', 'ПРЕСЕТЫ И ПРОЕКТ', projBody, true)}
        </div>`;
}

// ─── Wire sliders (must run AFTER DOM is in document) ─────────────────────────

function wireSliders() {
    // Generic: sync slider value → display span
    document.querySelectorAll('[data-panel="studio"] input[type="range"]').forEach(inp => {
        const val = q(inp.id + '-val');
        if (!val) return;
        // The display function is encoded as a data attribute by the sliderRow template.
        // We can't easily pass functions through HTML, so we handle known IDs:
        inp.addEventListener('input', () => {
            // val span already wired by inline handler, but in case not set in HTML
        });
    });
}

// Because sliderRow() builds HTML strings, the "input" event listener logic is
// in a separate function that runs after DOM is appended:
function wireAllSliderDisplays() {
    const sliders = [
        ['st-speed',    v => parseFloat(v).toFixed(2) + 'x'],
        ['st-temp',     v => parseFloat(v).toFixed(2)],
        ['st-rep',      v => parseFloat(v).toFixed(1)],
        ['st-topp',     v => parseFloat(v).toFixed(2)],
        ['st-topk',     v => parseInt(v).toString()],
        ['st-lenp',     v => parseFloat(v).toFixed(2)],
        ['st-vol',      fmtDb],
        ['st-pitch',    fmtSemi],
        ['st-bass',     fmtDb],
        ['st-treble',   fmtDb],
        ['st-eq0',      v => { const n = parseFloat(v); return (n >= 0 ? '+' : '') + n.toFixed(1); }],
        ['st-eq1',      v => { const n = parseFloat(v); return (n >= 0 ? '+' : '') + n.toFixed(1); }],
        ['st-eq2',      v => { const n = parseFloat(v); return (n >= 0 ? '+' : '') + n.toFixed(1); }],
        ['st-eq3',      v => { const n = parseFloat(v); return (n >= 0 ? '+' : '') + n.toFixed(1); }],
        ['st-eq4',      v => { const n = parseFloat(v); return (n >= 0 ? '+' : '') + n.toFixed(1); }],
        ['st-revroom',  v => parseInt(v) + '%'],
        ['st-revwet',   v => parseInt(v) + '%'],
        ['st-revdry',   v => parseInt(v) + '%'],
        ['st-revdec',   fmtSec],
        ['st-echodel',  fmtMs],
        ['st-echodec',  v => parseFloat(v).toFixed(2)],
        ['st-fadein',   fmtSec],
        ['st-fadeout',  fmtSec],
        ['st-silmin',   fmtSec],
        ['st-silbefore',fmtSec],
        ['st-silafter', fmtSec],
    ];
    sliders.forEach(([id, fmt]) => {
        const inp = q(id);
        const val = q(id + '-val');
        if (!inp || !val) return;
        val.textContent = fmt(inp.value);
        inp.addEventListener('input', () => { val.textContent = fmt(inp.value); });
    });
}

// ─── Wire collapsible cards ───────────────────────────────────────────────────

function wireCards() {
    document.querySelectorAll('[data-panel="studio"] .studio-card-hdr').forEach(hdr => {
        hdr.addEventListener('click', () => hdr.closest('.studio-card').classList.toggle('collapsed'));
    });
}

// ─── Wire voice section ───────────────────────────────────────────────────────

function wireVoice() {
    _upload = new FileUpload(q('st-upload-wrap'), {
        accept: 'audio/*',
        label: 'Перетащи аудио или нажми',
        hint:  'WAV, MP3, OGG — 10–30 секунд',
    });

    document.querySelectorAll('[name="st-vmode"]').forEach(r => {
        r.addEventListener('change', () => {
            const mode = document.querySelector('[name="st-vmode"]:checked').value;
            q('st-upload-wrap').style.display = mode === 'upload' ? '' : 'none';
            q('st-saved-wrap').style.display  = mode === 'saved'  ? '' : 'none';
        });
    });

    // Load saved voices
    getJSON('/api/voices/saved').then(data => {
        const sel = q('st-saved-sel');
        if (sel && data.voices && data.voices.length) {
            sel.innerHTML = data.voices.map(v => `<option value="${v}">${v}</option>`).join('');
        }
    }).catch(() => {});

    events.addEventListener('voices-changed', () => {
        getJSON('/api/voices/saved').then(data => {
            const sel = q('st-saved-sel');
            if (sel) {
                sel.innerHTML = (data.voices || []).map(v => `<option value="${v}">${v}</option>`).join('')
                    || '<option value="">— Нет голосов —</option>';
            }
        }).catch(() => {});
    });
}

// ─── Wire XTTS presets ────────────────────────────────────────────────────────

function wireXtts() {
    q('st-xtts-preset') && q('st-xtts-preset').addEventListener('change', e => {
        const opt = e.target.options[e.target.selectedIndex];
        if (opt && opt._presetData && opt._presetData.xtts) applyXttsValues(opt._presetData.xtts);
    });
    q('st-xtts-reset') && q('st-xtts-reset').addEventListener('click', () => {
        applyXttsValues(XTTS_DEF);
        if (q('st-xtts-preset')) q('st-xtts-preset').value = '';
    });
}

function applyXttsValues(v) {
    setSlider('st-speed', v.speed              ?? XTTS_DEF.speed);
    setSlider('st-temp',  v.temperature        ?? XTTS_DEF.temperature);
    setSlider('st-rep',   v.repetition_penalty ?? XTTS_DEF.repetition_penalty);
    setSlider('st-topp',  v.top_p              ?? XTTS_DEF.top_p);
    setSlider('st-topk',  v.top_k              ?? XTTS_DEF.top_k);
    setSlider('st-lenp',  v.length_penalty     ?? XTTS_DEF.length_penalty);
}

function getXttsValues() {
    return {
        speed:              parseFloat(q('st-speed')?.value ?? 1.0),
        temperature:        parseFloat(q('st-temp')?.value  ?? 0.65),
        repetition_penalty: parseFloat(q('st-rep')?.value   ?? 2.0),
        top_p:              parseFloat(q('st-topp')?.value  ?? 0.8),
        top_k:              parseInt  (q('st-topk')?.value  ?? 50),
        length_penalty:     parseFloat(q('st-lenp')?.value  ?? 1.0),
    };
}

// ─── Wire effects presets ─────────────────────────────────────────────────────

function wireFxPresets() {
    q('st-rev-preset') && q('st-rev-preset').addEventListener('change', e => {
        const opt = e.target.options[e.target.selectedIndex];
        if (!opt || !opt._presetData) return;
        const p = opt._presetData;
        setSlider('st-revroom', p.room_size);
        setSlider('st-revwet',  p.wet);
        setSlider('st-revdry',  p.dry);
        setSlider('st-revdec',  p.decay);
        e.target.value = '';
    });

    q('st-echo-preset') && q('st-echo-preset').addEventListener('change', e => {
        const opt = e.target.options[e.target.selectedIndex];
        if (!opt || !opt._presetData) return;
        const p = opt._presetData;
        setSlider('st-echodel', p.delay_ms);
        setSlider('st-echodec', p.decay);
        e.target.value = '';
    });
}

// ─── Wire output section ──────────────────────────────────────────────────────

function wireOutput() {
    q('st-fmt') && q('st-fmt').addEventListener('change', () => {
        const mp3Row = q('st-mp3-row');
        if (mp3Row) mp3Row.style.display = q('st-fmt').value === 'mp3' ? '' : 'none';
    });
}

// ─── Wire generate button ─────────────────────────────────────────────────────

function setPipe(step) {
    ['xtts','wav','ffmpeg','final'].forEach(s => {
        const e = q('pipe-' + s);
        if (e) e.classList.toggle('active', s === step);
    });
}

function wireGenerate() {
    q('st-generate') && q('st-generate').addEventListener('click', async () => {
        const text = q('st-text')?.value?.trim();
        if (!text) { toast('Введите текст', 'warn'); return; }

        const mode = document.querySelector('[name="st-vmode"]:checked')?.value;
        const xtts = getXttsValues();
        let opts, url;

        if (mode === 'upload') {
            const f = _upload?.file;
            if (!f) { toast('Загрузите аудио-образец', 'warn'); return; }
            const fd = new FormData();
            fd.append('audio', f);
            fd.append('text', text);
            fd.append('language', q('st-lang')?.value ?? 'Русский');
            fd.append('speed',              xtts.speed);
            fd.append('temperature',        xtts.temperature);
            fd.append('repetition_penalty', xtts.repetition_penalty);
            fd.append('top_p',              xtts.top_p);
            fd.append('top_k',              xtts.top_k);
            fd.append('length_penalty',     xtts.length_penalty);
            opts = { method: 'POST', body: fd };
            url  = '/api/synthesize/xtts';
        } else {
            const voice = q('st-saved-sel')?.value;
            if (!voice) { toast('Выберите голос', 'warn'); return; }
            opts = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, voice, language: q('st-lang')?.value ?? 'Русский', ...xtts }),
            };
            url = '/api/synthesize/saved';
        }

        const btn = q('st-generate');
        btn.disabled = true;
        audioManager.stopAll();
        if (_origPlayer) _origPlayer.setLoading(true);
        setStatus('st-gen-status', 'busy', '[0%] Запуск синтеза…');
        setPipe('xtts');
        logProgress.start('Синтез XTTS v2…');

        try {
            await synthesizeStream(url, opts, {
                progress: (val, desc) => {
                    const pct = Math.round(val * 100);
                    setStatus('st-gen-status', 'busy', `[${pct}%] ${desc}`);
                    logProgress.update(val, desc);
                    log(`⚙ ${desc} (${pct}%)`, 'gen');
                },
                done: (data) => {
                    _origFilename = data.filename;
                    setStatus('st-gen-status', 'ok', data.status);
                    if (_origPlayer) { _origPlayer.setSource(data.audio_url, data.filename); _origPlayer.setLoading(false); }
                    const dl = q('st-dl-orig');
                    if (dl) { dl.href = data.audio_url; dl.download = data.filename; dl.style.display = ''; }
                    logProgress.finish(true);
                    toast(data.status, 'ok');
                    log(data.status, 'done');
                    events.dispatchEvent(new CustomEvent('history-changed'));
                    setPipe('wav');
                },
                error: (msg) => {
                    setStatus('st-gen-status', 'err', msg);
                    logProgress.finish(false);
                    toast(msg, 'err');
                    if (_origPlayer) _origPlayer.setLoading(false);
                    setPipe(null);
                },
            });
        } catch (e) {
            setStatus('st-gen-status', 'err', '❌ ' + e.message);
            logProgress.finish(false);
            if (_origPlayer) _origPlayer.setLoading(false);
            setPipe(null);
        } finally { btn.disabled = false; }
    });
}

// ─── Wire apply effects ────────────────────────────────────────────────────────

function wireApplyFx() {
    q('st-apply') && q('st-apply').addEventListener('click', async () => {
        if (!_origFilename) { toast('Сначала синтезируйте аудио', 'warn'); return; }
        const btn = q('st-apply');
        btn.disabled = true;
        setStatus('st-fx-status', 'busy', 'Обработка аудио (FFmpeg)…');
        setPipe('ffmpeg');
        if (_procPlayer) _procPlayer.setLoading(true);

        try {
            const result = await postJSON('/api/process-audio', {
                filename: _origFilename,
                effects:  getFxValues(),
                output:   getOutputValues(),
            });
            setStatus('st-fx-status', 'ok', result.status);
            if (_procPlayer) { _procPlayer.setSource(result.audio_url, result.filename); _procPlayer.setLoading(false); }
            const dl = q('st-dl-proc');
            if (dl) { dl.href = result.audio_url; dl.download = result.filename; dl.style.display = ''; }
            toast(result.status, 'ok');
            log(result.status, 'done');
            events.dispatchEvent(new CustomEvent('history-changed'));
            setPipe('final');
        } catch (e) {
            const msg = '❌ ' + e.message;
            setStatus('st-fx-status', 'err', msg);
            toast(msg, 'err');
            if (_procPlayer) _procPlayer.setLoading(false);
            setPipe('wav');
        } finally { btn.disabled = false; }
    });

    q('st-reset-fx') && q('st-reset-fx').addEventListener('click', () => {
        applyFxValues(FX_DEF);
        setStatus('st-fx-status', '', '');
        toast('Эффекты сброшены', 'info');
    });
}

// ─── Get/apply values ─────────────────────────────────────────────────────────

function getFxValues() {
    const eq = ['eq0','eq1','eq2','eq3','eq4'].map(id => parseFloat(q('st-' + id)?.value ?? 0));
    return {
        volume_db:            parseFloat(q('st-vol')?.value    ?? 0),
        normalize:            q('st-norm')?.checked            ?? false,
        target_lufs:          parseFloat(q('st-lufs')?.value   ?? -14),
        bass_db:              parseFloat(q('st-bass')?.value   ?? 0),
        treble_db:            parseFloat(q('st-treble')?.value ?? 0),
        eq,
        pitch_semitones:      parseFloat(q('st-pitch')?.value  ?? 0),
        reverb: {
            enabled:   q('st-rev-en')?.checked ?? false,
            room_size: parseFloat(q('st-revroom')?.value ?? 50),
            wet:       parseFloat(q('st-revwet')?.value  ?? 30),
            dry:       parseFloat(q('st-revdry')?.value  ?? 70),
            decay:     parseFloat(q('st-revdec')?.value  ?? 1.5),
        },
        echo: {
            enabled:  q('st-echo-en')?.checked  ?? false,
            delay_ms: parseFloat(q('st-echodel')?.value ?? 200),
            decay:    parseFloat(q('st-echodec')?.value  ?? 0.3),
        },
        fade_in:              parseFloat(q('st-fadein')?.value    ?? 0),
        fade_out:             parseFloat(q('st-fadeout')?.value   ?? 0),
        remove_silence:       q('st-sil-rm')?.checked             ?? false,
        silence_threshold_db: parseFloat(q('st-sil-thr')?.value  ?? -40),
        min_silence_duration: parseFloat(q('st-silmin')?.value   ?? 0.3),
        add_silence_before:   parseFloat(q('st-silbefore')?.value ?? 0),
        add_silence_after:    parseFloat(q('st-silafter')?.value  ?? 0),
    };
}

function applyFxValues(v) {
    setSlider('st-vol',     v.volume_db ?? 0);
    if (q('st-norm'))  q('st-norm').checked  = v.normalize ?? false;
    if (q('st-lufs') && v.target_lufs !== undefined) q('st-lufs').value = v.target_lufs;
    setSlider('st-bass',    v.bass_db    ?? 0);
    setSlider('st-treble',  v.treble_db  ?? 0);
    if (v.eq) ['eq0','eq1','eq2','eq3','eq4'].forEach((id, i) => setSlider('st-' + id, v.eq[i] ?? 0));
    setSlider('st-pitch',   v.pitch_semitones ?? 0);
    if (v.reverb) {
        if (q('st-rev-en')) q('st-rev-en').checked = v.reverb.enabled ?? false;
        setSlider('st-revroom', v.reverb.room_size ?? 50);
        setSlider('st-revwet',  v.reverb.wet  ?? 30);
        setSlider('st-revdry',  v.reverb.dry  ?? 70);
        setSlider('st-revdec',  v.reverb.decay ?? 1.5);
    }
    if (v.echo) {
        if (q('st-echo-en')) q('st-echo-en').checked = v.echo.enabled ?? false;
        setSlider('st-echodel', v.echo.delay_ms ?? 200);
        setSlider('st-echodec', v.echo.decay    ?? 0.3);
    }
    setSlider('st-fadein',    v.fade_in    ?? 0);
    setSlider('st-fadeout',   v.fade_out   ?? 0);
    if (q('st-sil-rm'))  q('st-sil-rm').checked = v.remove_silence ?? false;
    if (q('st-sil-thr') && v.silence_threshold_db !== undefined) q('st-sil-thr').value = v.silence_threshold_db;
    setSlider('st-silmin',    v.min_silence_duration ?? 0.3);
    setSlider('st-silbefore', v.add_silence_before   ?? 0);
    setSlider('st-silafter',  v.add_silence_after    ?? 0);
}

function getOutputValues() {
    return {
        format:      q('st-fmt')?.value ?? 'wav',
        sample_rate: parseInt(q('st-sr')?.value  ?? 24000),
        mp3_bitrate: parseInt(q('st-br')?.value  ?? 192),
    };
}

// ─── Wire project / preset management ─────────────────────────────────────────

function wireProject() {
    q('st-preset-save') && q('st-preset-save').addEventListener('click', async () => {
        const name = q('st-preset-name')?.value?.trim();
        if (!name) { toast('Введите имя пресета', 'warn'); return; }
        try {
            await postJSON('/api/presets', {
                name,
                data: { xtts: getXttsValues(), effects: getFxValues(), output: getOutputValues() },
            });
            toast(`Пресет «${name}» сохранён`, 'ok');
            q('st-preset-name').value = '';
            await reloadXttsPresetDropdown();
        } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
    });

    q('st-proj-save') && q('st-proj-save').addEventListener('click', async () => {
        const name = q('st-proj-name')?.value?.trim();
        if (!name) { toast('Введите имя проекта', 'warn'); return; }
        const mode = document.querySelector('[name="st-vmode"]:checked')?.value;
        try {
            await postJSON('/api/projects', {
                name,
                data: {
                    text:     q('st-text')?.value ?? '',
                    language: q('st-lang')?.value ?? 'Русский',
                    voice:    mode === 'saved' ? (q('st-saved-sel')?.value ?? '') : '',
                    xtts:     getXttsValues(),
                    effects:  getFxValues(),
                    output:   getOutputValues(),
                },
            });
            setStatus('st-proj-status', 'ok', `✓ Проект «${name}» сохранён`);
            toast(`Проект «${name}» сохранён`, 'ok');
        } catch (e) {
            setStatus('st-proj-status', 'err', '❌ ' + e.message);
            toast('Ошибка: ' + e.message, 'err');
        }
    });

    q('st-proj-load-btn') && q('st-proj-load-btn').addEventListener('click', async () => {
        const wrap = q('st-proj-load-wrap');
        const show = wrap.style.display === 'none';
        wrap.style.display = show ? '' : 'none';
        if (show) {
            const { projects } = await getJSON('/api/projects').catch(() => ({ projects: [] }));
            const sel = q('st-proj-sel');
            if (sel) {
                sel.innerHTML = '<option value="">— Выберите проект —</option>' +
                    (projects || []).map(p => `<option value="${p}">${p}</option>`).join('');
            }
        }
    });

    q('st-proj-load') && q('st-proj-load').addEventListener('click', async () => {
        const name = q('st-proj-sel')?.value;
        if (!name) { toast('Выберите проект', 'warn'); return; }
        try {
            const { data } = await getJSON(`/api/projects/${encodeURIComponent(name)}`);
            if (!data) throw new Error('Пустой проект');
            if (data.text)     { const t = q('st-text'); if (t) t.value = data.text; }
            if (data.language) { const l = q('st-lang'); if (l) l.value = data.language; }
            if (data.voice) {
                document.querySelectorAll('[name="st-vmode"]').forEach(r => r.checked = r.value === 'saved');
                q('st-upload-wrap') && (q('st-upload-wrap').style.display = 'none');
                q('st-saved-wrap')  && (q('st-saved-wrap').style.display  = '');
                const sel = q('st-saved-sel'); if (sel) sel.value = data.voice;
            }
            if (data.xtts)    applyXttsValues(data.xtts);
            if (data.effects) applyFxValues(data.effects);
            if (data.output)  {
                if (data.output.format && q('st-fmt')) { q('st-fmt').value = data.output.format; q('st-fmt').dispatchEvent(new Event('change')); }
                if (data.output.sample_rate && q('st-sr')) q('st-sr').value = data.output.sample_rate;
                if (data.output.mp3_bitrate && q('st-br')) q('st-br').value = data.output.mp3_bitrate;
            }
            toast(`Проект «${name}» загружен`, 'ok');
            setStatus('st-proj-status', 'ok', `✓ Проект «${name}» загружен`);
        } catch (e) { toast('Ошибка загрузки: ' + e.message, 'err'); }
    });
}

// ─── Load preset dropdowns from API ──────────────────────────────────────────

async function loadPresetDropdowns() {
    try {
        const data = await getJSON('/api/presets');

        const xttsSel = q('st-xtts-preset');
        if (xttsSel) {
            (data.presets || []).forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.name;
                opt.textContent = (p.builtin ? '' : '★ ') + p.name;
                opt._presetData = p.data;
                xttsSel.appendChild(opt);
            });
        }

        const revSel = q('st-rev-preset');
        if (revSel && data.reverb_presets) {
            Object.entries(data.reverb_presets).forEach(([name, vals]) => {
                const opt = document.createElement('option');
                opt.value = name; opt.textContent = name; opt._presetData = vals;
                revSel.appendChild(opt);
            });
        }

        const echoSel = q('st-echo-preset');
        if (echoSel && data.echo_presets) {
            Object.entries(data.echo_presets).forEach(([name, vals]) => {
                const opt = document.createElement('option');
                opt.value = name; opt.textContent = name; opt._presetData = vals;
                echoSel.appendChild(opt);
            });
        }
    } catch (e) {
        log('Ошибка загрузки пресетов: ' + e.message, 'err');
    }
}

async function reloadXttsPresetDropdown() {
    try {
        const data = await getJSON('/api/presets');
        const sel = q('st-xtts-preset');
        if (!sel) return;
        const first = sel.options[0];
        sel.innerHTML = '';
        sel.appendChild(first);
        (data.presets || []).forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = (p.builtin ? '' : '★ ') + p.name;
            opt._presetData = p.data;
            sel.appendChild(opt);
        });
    } catch (_) {}
}

// ─── MAIN INIT ─────────────────────────────────────────────────────────────────

export async function init() {
    const panel = document.querySelector('[data-panel="studio"]');

    // 1. Build and inject ALL HTML
    panel.innerHTML = buildHTML();

    // 2. Wire collapsible cards
    wireCards();

    // 3. Wire slider display updates
    wireAllSliderDisplays();

    // 4. Wire voice section (creates FileUpload after DOM is live)
    wireVoice();

    // 5. Wire XTTS params
    wireXtts();

    // 6. Wire fx presets
    wireFxPresets();

    // 7. Wire output format toggle
    wireOutput();

    // 8. Wire generate button
    wireGenerate();

    // 9. Wire apply effects button
    wireApplyFx();

    // 10. Wire project/preset management
    wireProject();

    // 11. Create audio players (DOM is live)
    _origPlayer = new AudioPlayer(q('st-player-orig'));
    _procPlayer = new AudioPlayer(q('st-player-proc'));

    // 12. Load preset data from API
    await loadPresetDropdowns();
}
