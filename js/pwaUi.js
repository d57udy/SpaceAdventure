// DOM for the installable app (Item 3): app bar (Full screen, Install, Open the
// app, iOS "Add to Home Screen"), the install notice, the iOS hint, the update toast, the in-game Full screen
// toggle, the Settings-row Full screen overlay and the F key.
//
// All logic lives in js/pwa.js (unit tested); this module only builds buttons
// and shows or hides them. Fullscreen and install need a real user gesture, so
// every button is a DOM `.app-btn` with a `click` listener (never a canvas tap,
// never a `data-action` touch button: InputHandler cancels those touchstarts).

import { INSTALL_TEXT, pointerVerb, updateToastText, FULLSCREEN_GESTURE_TEXT } from './pwa.js';

const FS_KEY_STATES = new Set([
    'menu', 'paused', 'game_over', 'high_scores', 'achievements', 'upgrades',
    'help', 'settings', 'tutorial_ask',
]);

const ICON_EXPAND = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const ICON_SHRINK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';

function el(tag, attrs = {}, text = '') {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text) node.textContent = text;
    return node;
}

/**
 * @param {ReturnType<import('./pwa.js').initPwa>} pwa
 * @param {object} opts
 * @param {() => string} opts.getState  current GameState value
 * @param {(text: string) => void} [opts.notify]  short in-game message (canvas toast)
 */
export function createPwaUi(pwa, { getState, notify = () => {} }) {
    const body = document.body;
    let iosHintOpened = false; // reopened from the app bar this session

    // --- App bar (top right, outside play) ---
    const bar = el('div', { class: 'app-bar', id: 'app-bar' });
    const fsBtn = el('button', { type: 'button', class: 'app-btn', id: 'app-fullscreen-btn' }, 'Full screen');
    const installBtn = el('button', { type: 'button', class: 'app-btn', id: 'app-install-btn' }, 'Install');
    const openAppBtn = el('button', { type: 'button', class: 'app-btn', id: 'app-open-btn' }, 'Open the app');
    const a2hsBtn = el('button', { type: 'button', class: 'app-btn', id: 'app-a2hs-btn' }, 'Add to Home Screen');
    bar.append(fsBtn, installBtn, openAppBtn, a2hsBtn);

    // --- Bottom notices: iOS hint and update toast ---
    const notices = el('div', { class: 'app-notices', id: 'app-notices' });
    const hint = el('div', { class: 'ios-hint', id: 'ios-hint', role: 'note' });
    const hintText = el('p', { class: 'ios-hint-text' });
    hintText.append(
        el('strong', {}, 'Install: '),
        document.createTextNode('tap Share, then ‘Add to Home Screen’, then Add. ' +
            'Space Adventure then appears on your home screen (swipe to the last page if you don’t see it); open it from there.'),
        el('br'),
        el('span', { class: 'ios-hint-note' },
            'Scores and credits don’t carry over from Safari to the installed app (iOS keeps them separate).'),
    );
    const hintClose = el('button', { type: 'button', class: 'app-btn ios-hint-close', id: 'ios-hint-dismiss', 'aria-label': 'Dismiss' }, '✕');
    hint.append(hintText, hintClose);
    const toast = el('button', { type: 'button', class: 'app-btn update-toast', id: 'update-toast' },
        updateToastText(pointerVerb(window)));
    // Install progress / where to find the installed app (Android, desktop Chromium)
    const installNotice = el('div', { class: 'ios-hint install-notice', id: 'install-notice', role: 'status', 'aria-live': 'polite' });
    const installText = el('p', { class: 'ios-hint-text', id: 'install-notice-text' });
    const installClose = el('button', { type: 'button', class: 'app-btn ios-hint-close', id: 'install-notice-dismiss', 'aria-label': 'Dismiss' }, '✕');
    installNotice.append(installText, installClose);
    notices.append(installNotice, hint, toast);

    // --- In-game Full screen toggle, next to mute and pause (touch controls) ---
    const gameFsBtn = el('button', { type: 'button', class: 'app-btn game-fs-btn', id: 'game-fullscreen-btn', 'aria-label': 'Full screen' });
    gameFsBtn.innerHTML = ICON_EXPAND;
    const topCluster = document.querySelector('.touch-top');
    if (topCluster) topCluster.prepend(gameFsBtn);

    // --- Settings screen: transparent button laid over the "Full screen" row ---
    const settingsFsBtn = el('button', { type: 'button', class: 'app-btn settings-fs-btn', id: 'settings-fullscreen-btn', 'aria-label': 'Full screen' });
    const container = document.querySelector('.game-container') || body;
    container.append(settingsFsBtn);

    body.append(bar, notices);

    // Called synchronously from click / keydown so the browser sees the user gesture.
    function toggleFullscreen() {
        return pwa.toggleFullscreen();
    }

    // A button clicked with a mouse or finger gives focus back (event.detail > 0), so Space
    // and Enter reach the game again; a keyboard user (detail 0) keeps focus on it.
    function onClick(btn, fn) {
        btn.addEventListener('click', (e) => {
            if (e && e.detail > 0 && typeof btn.blur === 'function') btn.blur();
            fn(e);
        });
    }

    onClick(fsBtn, toggleFullscreen);
    onClick(gameFsBtn, toggleFullscreen);
    onClick(settingsFsBtn, toggleFullscreen);
    onClick(installBtn, () => { pwa.promptInstall().then(sync); });
    onClick(openAppBtn, () => { pwa.toggleOpenAppHint(); sync(); });
    onClick(installClose, () => { pwa.dismissInstallNotice(); sync(); });
    onClick(a2hsBtn, () => { iosHintOpened = !iosHintOpened; sync(); });
    onClick(hintClose, () => {
        iosHintOpened = false;
        pwa.dismissIosHint();
        sync();
    });
    onClick(toast, () => {
        if (pwa.applyUpdate()) toast.textContent = 'Updating…';
        sync();
    });

    // Desktop F key: outside play only (during play F is a fire key).
    window.addEventListener('keydown', (e) => {
        if (e.code !== 'KeyF' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (!FS_KEY_STATES.has(getState()) || !pwa.shouldShowFullscreenButton()) return;
        toggleFullscreen();
    });

    /**
     * Keyboard / controller "select" on the Settings row. Runs from the game loop,
     * which Chromium still accepts shortly after a key press; if the browser
     * refuses, say how to do it instead.
     */
    function toggleFromGame() {
        const wanted = !pwa.isFullscreen();
        pwa.toggleFullscreen().then((now) => {
            if (now !== wanted) notify(FULLSCREEN_GESTURE_TEXT);
        });
    }

    /** Lay the transparent overlay over the Settings row (logical canvas = CSS px). */
    function placeSettingsButton(x, y, w, h) {
        const s = settingsFsBtn.style;
        const v = [`${x}px`, `${y}px`, `${w}px`, `${h}px`];
        if (s.left !== v[0]) s.left = v[0];
        if (s.top !== v[1]) s.top = v[1];
        if (s.width !== v[2]) s.width = v[2];
        if (s.height !== v[3]) s.height = v[3];
    }

    function show(node, on) {
        if (node.hidden === !on) return;
        node.hidden = !on;
    }

    /** Show or hide everything for the current game state and PWA state. */
    function sync() {
        const state = getState();
        if (body.dataset.state !== state) body.dataset.state = state;
        const fsVisible = pwa.shouldShowFullscreenButton();
        const fullscreen = pwa.isFullscreen();
        body.classList.toggle('fs-available', fsVisible);
        body.classList.toggle('is-fullscreen', fullscreen);

        fsBtn.textContent = fullscreen ? 'Exit full screen' : 'Full screen';
        gameFsBtn.innerHTML = fullscreen ? ICON_SHRINK : ICON_EXPAND;
        gameFsBtn.setAttribute('aria-label', fullscreen ? 'Exit full screen' : 'Full screen');
        settingsFsBtn.setAttribute('aria-label', fullscreen ? 'Exit full screen' : 'Full screen');

        const iosTab = pwa.isIos() && !pwa.isStandalone();
        show(fsBtn, fsVisible);
        const install = pwa.installView();
        show(installBtn, install.button === 'install');
        show(openAppBtn, install.button === 'open-app');
        const noticeText = install.notice ? INSTALL_TEXT[install.notice] : '';
        if (installText.textContent !== noticeText) installText.textContent = noticeText;
        installNotice.dataset.kind = install.notice || '';
        show(installNotice, !!install.notice);
        show(a2hsBtn, iosTab);
        show(gameFsBtn, fsVisible);
        show(settingsFsBtn, fsVisible && state === 'settings');
        show(hint, (pwa.shouldShowIosHint() || (iosHintOpened && iosTab && state === 'menu')));
        show(toast, pwa.shouldShowUpdateToast() || (state !== 'playing' && pwa.getPwaState().reloadRequested));
    }

    pwa.onChange(sync);
    sync();

    return {
        sync,
        toggleFromGame,
        placeSettingsButton,
        /** What is on screen (for the test hook). */
        get state() {
            const visible = (node) => !node.hidden && node.getClientRects().length > 0;
            return {
                appBar: visible(bar),
                fullscreenButton: visible(fsBtn),
                installButton: visible(installBtn),
                openAppButton: visible(openAppBtn),
                installNotice: visible(installNotice),
                a2hsButton: visible(a2hsBtn),
                iosHint: visible(hint),
                updateToast: visible(toast),
                gameButton: visible(gameFsBtn),
                settingsButton: visible(settingsFsBtn),
            };
        },
    };
}
