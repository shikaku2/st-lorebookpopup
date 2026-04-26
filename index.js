import { extension_settings } from '../../../extensions.js';
import { eventSource, event_types } from '../../../events.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { Popup, POPUP_TYPE } from '../../../popup.js';

const EXT_NAME = 'lorebookpopup';
const MAX_ACTIVATIONS = 10;
const PREVIEW_LEN = 120;

const defaultSettings = { enabled: true, logging: true, clickable: true, filterConstant: true };

// Ring buffer of last MAX_ACTIVATIONS activations, newest first.
// Each: { time: Date, entries: [{world, title, content}] }
let logActivations = [];

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

function mapEntry(e) {
    return {
        world: e.world ?? 'Unknown Book',
        title: e.comment || e.key?.[0] || `Entry #${e.uid}`,
        content: typeof e.content === 'string' ? e.content : '',
    };
}

function showActivationModal(activation) {
    if (!activation) return;

    const container = document.createElement('div');
    container.className = 'lbpopup-modal-container';

    const headerHtml = `<div class="lbpopup-modal-header">${activation.entries.length} entr${activation.entries.length !== 1 ? 'ies' : 'y'} inserted at ${formatTime(activation.time)}</div>`;

    const entriesHtml = activation.entries.map((e, i) => `
<div class="lbpopup-modal-entry">
    <div class="lbpopup-entry-header">
        <span class="lbpopup-entry-num">${i + 1}</span>
        <span class="lbpopup-entry-title">${escapeHtml(e.title)}</span>
        <span class="lbpopup-entry-book">${escapeHtml(e.world)}</span>
    </div>
    <div class="lbpopup-modal-entry-content">${escapeHtml(e.content) || '<em class="lbpopup-empty">No content</em>'}</div>
</div>`).join('');

    container.innerHTML = headerHtml + entriesHtml;

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
        toastrOpts.onclick = () => showActivationModal(activation);
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
            <div class="lbpopup-log-label">
                <span>Last ${MAX_ACTIVATIONS} insertions</span>
                <button id="lbpopup-view-latest" class="menu_button lbpopup-view-latest-btn">View Latest</button>
            </div>
            <div id="lbpopup-log" class="lbpopup-log">
                <div class="lbpopup-empty">No entries inserted yet.</div>
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
        if (logActivations.length) showActivationModal(logActivations[0]);
    });
}

jQuery(async () => {
    loadSettings();
    initUI();
    eventSource.on(event_types.WORLD_INFO_ACTIVATED, onWorldInfoActivated);
    console.log(`[${EXT_NAME}] Loaded`);
});
