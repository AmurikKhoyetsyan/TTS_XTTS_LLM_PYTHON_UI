import { getJSON, putJSON, del } from '../api.js';
import { AudioPlayer } from '../audio-player.js';
import { ICONS } from '../icons.js';
import { toast } from '../toast.js';
import { events } from '../events.js';
import { openConfirm, openPrompt } from '../modal.js';
import { skeletonRows } from '../loader.js';
import { log } from '../logger.js';

export async function init() {

    // ── Section switching ─────────────────────────────────────────────────────
    const typeBtns = document.querySelectorAll('.hist-type-btn');
    typeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            typeBtns.forEach(b => b.classList.toggle('active', b === btn));
            const type = btn.dataset.htype;
            document.querySelectorAll('.hist-section').forEach(s => {
                s.hidden = (s.id !== `hist-section-${type}`);
            });
        });
    });

    // ── Audio ─────────────────────────────────────────────────────────────────
    const listEl = document.getElementById('hist-list');
    const refreshBtn = document.getElementById('hist-refresh');
    const player = new AudioPlayer(document.querySelector('[data-player="hist"]'));

    let activeName = null;
    let isPlaying = false;

    player.on('play',  () => { isPlaying = true;  _syncPlayIcons(); });
    player.on('pause', () => { isPlaying = false; _syncPlayIcons(); });
    player.on('ended', () => { isPlaying = false; _syncPlayIcons(); });

    function _syncPlayIcons() {
        listEl.querySelectorAll('.hist-row').forEach(row => {
            const btn = row.querySelector('[data-action="play"]');
            if (!btn) return;
            const active = row.dataset.file === activeName && isPlaying;
            btn.innerHTML = active ? ICONS.pause : ICONS.play;
            btn.title     = active ? 'Пауза' : 'Воспроизвести';
        });
    }

    function renderAudio(files) {
        if (!files.length) {
            listEl.innerHTML = '<div class="hist-empty">Нет аудиозаписей</div>';
            return;
        }
        listEl.innerHTML = files.map(name => {
            const isActive = name === activeName;
            const icon  = isActive && isPlaying ? ICONS.pause : ICONS.play;
            const title = isActive && isPlaying ? 'Пауза' : 'Воспроизвести';
            return `
            <div class="hist-row${isActive ? ' active' : ''}" data-file="${ea(name)}">
                <span class="hist-name" title="${ea(name)}">${eh(name)}</span>
                <div class="hist-btns">
                    <button class="hist-btn accent" data-action="play"     title="${title}">${icon}</button>
                    <button class="hist-btn"        data-action="rename"   title="Переименовать">${ICONS.edit}</button>
                    <button class="hist-btn"        data-action="download" title="Скачать">${ICONS.download}</button>
                    <button class="hist-btn danger" data-action="delete"   title="Удалить">${ICONS.trash}</button>
                </div>
            </div>`;
        }).join('');
        _applySearch();
    }

    async function refreshAudio() {
        skeletonRows(listEl, 4);
        try {
            const data = await getJSON('/api/history');
            renderAudio(data.files);
        } catch (e) {
            listEl.innerHTML = '<div class="hist-empty">Ошибка загрузки</div>';
            toast(e.message, 'err');
        }
    }

    listEl.addEventListener('click', async (e) => {
        const btn = e.target.closest('.hist-btn[data-action]');
        if (!btn) return;
        const row    = btn.closest('.hist-row');
        const name   = row.dataset.file;
        const action = btn.dataset.action;
        const url    = `/api/history/${encodeURIComponent(name)}/audio`;

        if (action === 'play') {
            if (activeName === name) {
                isPlaying ? player.pause() : player.play();
            } else {
                activeName = name;
                listEl.querySelectorAll('.hist-row').forEach(r =>
                    r.classList.toggle('active', r.dataset.file === name));
                player.setSource(url, name);
                player.play();
            }
            return;
        }
        if (action === 'download') {
            const a = Object.assign(document.createElement('a'), { href: url, download: name });
            document.body.appendChild(a); a.click(); a.remove();
            return;
        }
        if (action === 'rename') {
            const stem = name.endsWith('.wav') ? name.slice(0, -4) : name;
            const newName = await openPrompt({ title: 'Переименовать аудио', initial: stem });
            if (!newName) return;
            try {
                const r = await putJSON(`/api/history/${encodeURIComponent(name)}`, { new_name: newName });
                toast(r.status, 'ok');
                log('Аудио переименовано: ' + name + ' → ' + r.new_name, 'done');
                if (activeName === name) {
                    activeName = r.new_name;
                    player.setSource(`/api/history/${encodeURIComponent(r.new_name)}/audio`, r.new_name);
                }
                await refreshAudio();
            } catch (e2) { toast(e2.message, 'err'); }
            return;
        }
        if (action === 'delete') {
            const ok = await openConfirm({ title: 'Удалить аудио', message: `Удалить «${name}»?`, confirmLabel: 'Удалить' });
            if (!ok) return;
            try {
                const r = await del(`/api/history/${encodeURIComponent(name)}`);
                toast(r.status, 'ok');
                log('Аудио удалено: ' + name, 'done');
                if (activeName === name) { activeName = null; isPlaying = false; player.setSource(null); }
                await refreshAudio();
            } catch (e2) { toast(e2.message, 'err'); }
            return;
        }
    });

    // ── Subtitles ─────────────────────────────────────────────────────────────
    const srtListEl       = document.getElementById('hist-srt-list');
    const srtPreviewBlock = document.getElementById('hist-srt-preview-block');
    const srtPreviewLabel = document.getElementById('hist-srt-preview-label');
    const srtPreviewPre   = document.getElementById('hist-srt-preview-content');
    const srtPreviewDl    = document.getElementById('hist-srt-preview-dl');
    const srtRestoreBtn   = document.getElementById('hist-srt-restore-btn');
    let   srtPreviewName  = null;
    let   srtPreviewText  = null;

    function renderSRT(files) {
        if (!files.length) {
            srtListEl.innerHTML = '<div class="hist-empty">Нет сохранённых субтитров</div>';
            return;
        }
        srtListEl.innerHTML = files.map(name => `
            <div class="hist-row" data-file="${ea(name)}">
                <span class="hist-name" title="${ea(name)}">${eh(name)}</span>
                <div class="hist-btns">
                    <button class="hist-btn accent" data-action="open"     title="Предпросмотр">${ICONS.eye}</button>
                    <button class="hist-btn"        data-action="download" title="Скачать">${ICONS.download}</button>
                    <button class="hist-btn"        data-action="rename"   title="Переименовать">${ICONS.edit}</button>
                    <button class="hist-btn danger" data-action="delete"   title="Удалить">${ICONS.trash}</button>
                </div>
            </div>`).join('');
        _applySearch();
    }

    async function refreshSRT() {
        skeletonRows(srtListEl, 3);
        try {
            const data = await getJSON('/api/subtitles');
            renderSRT(data.files);
        } catch (_) {
            srtListEl.innerHTML = '<div class="hist-empty">Ошибка загрузки</div>';
        }
    }

    srtListEl.addEventListener('click', async (e) => {
        const btn = e.target.closest('.hist-btn[data-action]');
        if (!btn) return;
        const row    = btn.closest('.hist-row');
        const name   = row.dataset.file;
        const action = btn.dataset.action;

        if (action === 'open') {
            try {
                const r = await getJSON(`/api/subtitles/${encodeURIComponent(name)}`);
                srtPreviewName = name;
                srtPreviewText = r.content;
                if (srtPreviewLabel) srtPreviewLabel.textContent = name;
                if (srtPreviewPre)   srtPreviewPre.textContent  = r.content;
                if (srtPreviewDl) {
                    const blob = new Blob([r.content], { type: 'text/plain' });
                    if (srtPreviewDl._blobUrl) URL.revokeObjectURL(srtPreviewDl._blobUrl);
                    srtPreviewDl._blobUrl = URL.createObjectURL(blob);
                    srtPreviewDl.href     = srtPreviewDl._blobUrl;
                    srtPreviewDl.download = name;
                }
                if (srtPreviewBlock) srtPreviewBlock.hidden = false;
                srtListEl.querySelectorAll('.hist-row').forEach(r2 =>
                    r2.classList.toggle('active', r2.dataset.file === name));
            } catch (e2) { toast(e2.message, 'err'); }
            return;
        }
        if (action === 'download') {
            try {
                const r = await getJSON(`/api/subtitles/${encodeURIComponent(name)}`);
                const blob = new Blob([r.content], { type: 'text/plain' });
                const url  = URL.createObjectURL(blob);
                const a = Object.assign(document.createElement('a'), { href: url, download: name });
                document.body.appendChild(a); a.click(); a.remove();
                URL.revokeObjectURL(url);
            } catch (e2) { toast(e2.message, 'err'); }
            return;
        }
        if (action === 'rename') {
            const stem = name.endsWith('.srt') ? name.slice(0, -4) : name;
            const newName = await openPrompt({ title: 'Переименовать субтитр', initial: stem });
            if (!newName) return;
            try {
                const r = await putJSON(`/api/subtitles/${encodeURIComponent(name)}`, { new_name: newName });
                toast(r.status, 'ok');
                log('Субтитр переименован: ' + name + ' → ' + r.new_name, 'done');
                await refreshSRT();
            } catch (e2) { toast(e2.message, 'err'); }
            return;
        }
        if (action === 'delete') {
            const ok = await openConfirm({ title: 'Удалить субтитр', message: `Удалить «${name}»?`, confirmLabel: 'Удалить' });
            if (!ok) return;
            try {
                const r = await del(`/api/subtitles/${encodeURIComponent(name)}`);
                toast(r.status, 'ok');
                log('Субтитр удалён: ' + name, 'done');
                await refreshSRT();
            } catch (e2) { toast(e2.message, 'err'); }
            return;
        }
    });

    srtRestoreBtn && srtRestoreBtn.addEventListener('click', () => {
        if (!srtPreviewText) return;
        events.dispatchEvent(new CustomEvent('srt-restore', {
            detail: { content: srtPreviewText, filename: srtPreviewName },
        }));
        toast('Субтитры восстановлены в редактор', 'ok');
    });

    // ── Search ────────────────────────────────────────────────────────────────
    const searchEl = document.getElementById('hist-search');

    function _applySearch() {
        const q = (searchEl?.value || '').trim().toLowerCase();
        const activeSection = document.querySelector('.hist-section:not([hidden])');
        if (!activeSection) return;
        activeSection.querySelectorAll('.hist-list').forEach(list => {
            list.querySelectorAll('.hist-row').forEach(row => {
                const name = (row.querySelector('.hist-name')?.textContent || '').toLowerCase();
                row.style.display = (!q || name.includes(q)) ? '' : 'none';
            });
        });
    }

    searchEl?.addEventListener('input', _applySearch);

    typeBtns.forEach(btn => btn.addEventListener('click', () => {
        if (searchEl?.value) setTimeout(_applySearch, 50);
    }));

    // ── Refresh button ────────────────────────────────────────────────────────
    refreshBtn.addEventListener('click', () => {
        const active = document.querySelector('.hist-type-btn.active');
        const type = active ? active.dataset.htype : 'audio';
        if (type === 'audio')          refreshAudio();
        else if (type === 'subtitles') refreshSRT();
    });

    events.addEventListener('history-changed',   refreshAudio);
    events.addEventListener('subtitles-changed', refreshSRT);

    await Promise.all([refreshAudio(), refreshSRT()]);
}

function eh(s) {
    return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function ea(s) {
    return eh(s).replace(/"/g, '&quot;');
}
