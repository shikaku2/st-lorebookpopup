import { extension_settings } from '../../../extensions.js';
import { eventSource, event_types } from '../../../events.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { Popup, POPUP_TYPE } from '../../../popup.js';

const EXT_NAME = 'lorebookpopup';
const MAX_ACTIVATIONS = 10;
const PREVIEW_LEN = 120;

const defaultSettings = { enabled: true, logging: true, clickable: true, filterConstant: true, logQdrant: true };

// Ring buffer of last MAX_ACTIVATIONS activations, newest first.
// Each: { time: Date, entries: [{world, title, content}] }
let logActivations = [];

// Ring buffer of last MAX_ACTIVATIONS qdrant retrievals, newest first.
// Each: { time: Date, memoriesText: string }
let qdrantLogActivations = [];

function loadSettings() {
    extension_settings[EXT_NAME] = Object.assign({}, defaultSettings, extension_settings[EXT_NAME]);
}

function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTime(date) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function isQdrantInstalled() {
    return localStorage.getItem('qdrant-memory') !== null;
}

function tryWrapQdrantInterceptor() {
    if (!isQdrantInstalled()) return;
    const original = globalThis.qdrantMemoryInterceptor;
    if (!original || original._lbWrapped) return;

    globalThis.qdrantMemoryInterceptor = async (chat, contextSize, abort, type) => {
        const snapshot = chat.slice();
        await original(chat, contextSize, abort, type);

        if (!extension_settings[EXT_NAME].logQdrant) return;

        const added = chat.filter(m => !snapshot.includes(m));
        const memEntry = added.find(m => m.is_system && typeof m.mes === 'string' && m.mes.includes('[Past chat memories]'));
        if (!memEntry) return;

        const activation = { time: new Date(), memoriesText: memEntry.mes };
        qdrantLogActivations.unshift(activation);
        if (qdrantLogActivations.length > MAX_ACTIVATIONS) qdrantLogActivations.length = MAX_ACTIVATIONS;
        renderQdrantLog();
    };
    globalThis.qdrantMemoryInterceptor._lbWrapped = true;
    console.log(`[${EXT_NAME}] Wrapped qdrant memory interceptor`);
}

function parseQdrantMemories(text) {
    if (!text) return [];
    return text.split('\n')
        .filter(l => l.trimStart().startsWith('•'))
        .map(l => l.replace(/^[\s•]+/, '').trim());
}

function mapEntry(e) {
    return {
        world: e.world ?? 'Unknown Book',
        title: e.comment || e.key?.[0] || `Entry #${e.uid}`,
        content: typeof e.content === 'string' ? e.content : '',
    };
}

function showActivationModal(activation, qdrantActivation = null) {
    if (!activation) return;

    const container = document.createElement('div');
    container.className = 'lbpopup-modal-container';

    const headerHtml = `<div class="lbpopup-modal-header">${activation.entries.length} lorebook entr${activation.entries.length !== 1 ? 'ies' : 'y'} inserted at ${formatTime(activation.time)}</div>`;

    const entriesHtml = activation.entries.map((e, i) => `
<div class="lbpopup-modal-entry">
    <div class="lbpopup-entry-header">
        <span class="lbpopup-entry-num">${i + 1}</span>
        <span class="lbpopup-entry-title">${escapeHtml(e.title)}</span>
        <span class="lbpopup-entry-book">${escapeHtml(e.world)}</span>
    </div>
    <div class="lbpopup-modal-entry-content">${escapeHtml(e.content) || '<em class="lbpopup-empty">No content</em>'}</div>
</div>`).join('');

    let qdrantHtml = '';
    if (qdrantActivation) {
        const memories = parseQdrantMemories(qdrantActivation.memoriesText);
        const memoriesHtml = memories.length
            ? memories.map((m, i) => `
<div class="lbpopup-modal-entry">
    <div class="lbpopup-entry-header">
        <span class="lbpopup-entry-num">${i + 1}</span>
        <span class="lbpopup-entry-title lbpopup-qdrant-memory-text">${escapeHtml(m)}</span>
    </div>
</div>`).join('')
            : `<div class="lbpopup-empty">No memory text parsed.</div>`;

        qdrantHtml = `
<div class="lbpopup-qdrant-section">
    <div class="lbpopup-modal-header lbpopup-qdrant-header">Qdrant memories retrieved at ${formatTime(qdrantActivation.time)}</div>
    ${memoriesHtml}
</div>`;
    }

    container.innerHTML = headerHtml + entriesHtml + qdrantHtml;

    new Popup(container, POPUP_TYPE.DISPLAY, '', {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    }).show();
}

function isAlwaysOnOnly(e) {
    // constant=true, vectorized=false/unset → purely always-on, no dynamic selection
    return e.constant === true && !e.vectorized;
}

function onWorldInfoActivated(entries) {
    const s = extension_settings[EXT_NAME];
    if (!s.enabled || !entries?.length) return;

    const visible = s.filterConstant ? entries.filter(e => !isAlwaysOnOnly(e)) : entries;
    if (!visible.length) return;

    const activation = { time: new Date(), entries: visible.map(mapEntry) };

    const toastrOpts = { positionClass: 'toast-bottom-right' };
    if (s.clickable) {
        toastrOpts.timeOut = 5000;
        toastrOpts.onclick = () => showActivationModal(activation, qdrantLogActivations[0] ?? null);
    } else {
        toastrOpts.timeOut = 3000;
    }

    toastr.info(
        `Lorebook Entries Inserted: ${visible.length}`,
        s.clickable ? 'Click to view' : '',
        toastrOpts,
    );

    if (!s.logging) return;

    logActivations.unshift(activation);
    if (logActivations.length > MAX_ACTIVATIONS) logActivations.length = MAX_ACTIVATIONS;

    renderLog();
}

function renderLog() {
    const el = document.getElementById('lbpopup-log');
    if (!el) return;

    if (!logActivations.length) {
        el.innerHTML = '<div class="lbpopup-empty">No entries inserted yet.</div>';
        return;
    }

    el.innerHTML = logActivations.map((act, ai) => {
        const label = ai === 0 ? 'Latest' : `#${logActivations.length - ai}`;
        const entriesHtml = act.entries.map((e, i) => {
            const preview = e.content.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LEN);
            const hasMore = e.content.trim().length > PREVIEW_LEN;
            return `
<div class="lbpopup-entry">
    <div class="lbpopup-entry-header">
        <span class="lbpopup-entry-num">${i + 1}</span>
        <span class="lbpopup-entry-title">${escapeHtml(e.title)}</span>
        <span class="lbpopup-entry-book">${escapeHtml(e.world)}</span>
    </div>
    <div class="lbpopup-entry-preview">${escapeHtml(preview)}${hasMore ? '…' : ''}</div>
</div>`;
        }).join('');

        return `
<div class="lbpopup-activation">
    <div class="lbpopup-activation-header">
        <span class="lbpopup-activation-label">${label}</span>
        <span class="lbpopup-activation-count">${act.entries.length} entr${act.entries.length !== 1 ? 'ies' : 'y'}</span>
        <span class="lbpopup-activation-time">${formatTime(act.time)}</span>
        <button class="lbpopup-view-btn menu_button" data-ai="${ai}">View</button>
    </div>
    ${entriesHtml}
</div>`;
    }).join('');

    el.querySelectorAll('.lbpopup-view-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            showActivationModal(logActivations[parseInt(btn.dataset.ai, 10)]);
        });
    });
}

function renderQdrantLog() {
    const el = document.getElementById('lbpopup-qdrant-log');
    if (!el) return;

    if (!qdrantLogActivations.length) {
        el.innerHTML = '<div class="lbpopup-empty">No memories retrieved yet.</div>';
        return;
    }

    el.innerHTML = qdrantLogActivations.map((act, ai) => {
        const label = ai === 0 ? 'Latest' : `#${qdrantLogActivations.length - ai}`;
        const memories = parseQdrantMemories(act.memoriesText);
        const memoriesHtml = memories.map((m, i) => `
<div class="lbpopup-entry">
    <div class="lbpopup-entry-header">
        <span class="lbpopup-entry-num">${i + 1}</span>
        <span class="lbpopup-entry-title lbpopup-qdrant-memory-text">${escapeHtml(m)}</span>
    </div>
</div>`).join('');

        return `
<div class="lbpopup-activation">
    <div class="lbpopup-activation-header">
        <span class="lbpopup-activation-label">${label}</span>
        <span class="lbpopup-activation-count">${memories.length} memor${memories.length !== 1 ? 'ies' : 'y'}</span>
        <span class="lbpopup-activation-time">${formatTime(act.time)}</span>
    </div>
    ${memoriesHtml}
</div>`;
    }).join('');
}

function initUI() {
    const html = `
<div id="${EXT_NAME}-panel">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Lorebook Popup</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <label class="checkbox_label">
                <input id="lbpopup-enabled" type="checkbox" />
                <span>Enable toast notifications</span>
            </label>
            <label class="checkbox_label">
                <input id="lbpopup-clickable" type="checkbox" />
                <span>Click toast to view injected prompts</span>
            </label>
            <label class="checkbox_label">
                <input id="lbpopup-logging" type="checkbox" />
                <span>Log inserted entries</span>
            </label>
            <label class="checkbox_label">
                <input id="lbpopup-filter-constant" type="checkbox" />
                <span>Hide always-on entries (show vectorized ones)</span>
            </label>
            <div id="lbpopup-qdrant-row" class="lbpopup-qdrant-row" style="display:none">
                <label class="checkbox_label">
                    <input id="lbpopup-log-qdrant" type="checkbox" />
                    <span>Log Qdrant Memory retrievals</span>
                </label>
            </div>
            <div class="lbpopup-log-label">
                <span>Last ${MAX_ACTIVATIONS} lorebook insertions</span>
                <button id="lbpopup-view-latest" class="menu_button lbpopup-view-latest-btn">View Latest</button>
            </div>
            <div id="lbpopup-log" class="lbpopup-log">
                <div class="lbpopup-empty">No entries inserted yet.</div>
            </div>
            <div id="lbpopup-qdrant-log-section" style="display:none">
                <div class="lbpopup-log-label lbpopup-qdrant-log-label">
                    <span>Last ${MAX_ACTIVATIONS} Qdrant retrievals</span>
                </div>
                <div id="lbpopup-qdrant-log" class="lbpopup-log">
                    <div class="lbpopup-empty">No memories retrieved yet.</div>
                </div>
            </div>
        </div>
    </div>
</div>`;

    $('#extensions_settings').append(html);

    const s = extension_settings[EXT_NAME];

    $('#lbpopup-enabled').prop('checked', s.enabled).on('change', function () {
        extension_settings[EXT_NAME].enabled = !!$(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#lbpopup-clickable').prop('checked', s.clickable).on('change', function () {
        extension_settings[EXT_NAME].clickable = !!$(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#lbpopup-logging').prop('checked', s.logging).on('change', function () {
        extension_settings[EXT_NAME].logging = !!$(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#lbpopup-filter-constant').prop('checked', s.filterConstant).on('change', function () {
        extension_settings[EXT_NAME].filterConstant = !!$(this).prop('checked');
        saveSettingsDebounced();
    });

    document.getElementById('lbpopup-view-latest').addEventListener('click', () => {
        if (logActivations.length) showActivationModal(logActivations[0], qdrantLogActivations[0] ?? null);
    });

    function applyQdrantUIVisibility() {
        const installed = isQdrantInstalled();
        $('#lbpopup-qdrant-row').toggle(installed);
        $('#lbpopup-qdrant-log-section').toggle(installed && extension_settings[EXT_NAME].logQdrant);
    }

    $('#lbpopup-log-qdrant').prop('checked', s.logQdrant).on('change', function () {
        extension_settings[EXT_NAME].logQdrant = !!$(this).prop('checked');
        saveSettingsDebounced();
        applyQdrantUIVisibility();
    });

    applyQdrantUIVisibility();
}

jQuery(async () => {
    loadSettings();
    initUI();
    eventSource.on(event_types.WORLD_INFO_ACTIVATED, onWorldInfoActivated);
    // Wrap qdrant interceptor after other extensions have had time to initialize
    setTimeout(tryWrapQdrantInterceptor, 1500);
    console.log(`[${EXT_NAME}] Loaded`);
});
