// PWA support for Space Adventure: service worker registration and updates,
// install prompt, iOS "Add to Home Screen" hint, display-mode detection and
// fullscreen / orientation helpers.
//
// This module creates no DOM. main.js owns the app bar, toast and hint UI and
// reads everything through the controller returned by initPwa(). All browser
// objects are injected (doc, win, nav) so the logic is unit tested with fakes.

export const CACHE_PREFIX = 'space-adventure-';
export const IOS_HINT_KEY = 'spaceAdventure_a2hsHintDismissed';
export const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

// Game states in which it is safe to show the update toast / apply an update.
// Never during play (or while typing a name).
// Not 'paused': applying an update reloads the page and a paused run would be lost.
export const DEFAULT_UPDATE_SAFE_STATES = [
    'menu', 'game_over', 'high_scores',
    'achievements', 'upgrades', 'help', 'settings',
];

const noop = () => {};

// --- Pure helpers (exported for tests) -------------------------------------

export function isLocalhost(hostname = '') {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' ||
        hostname === '::1' || hostname.endsWith('.localhost');
}

/** `?nosw` kill switch and `?sw=1` opt-in on localhost. */
export function parseSwFlags(search = '') {
    const params = new URLSearchParams(search);
    return {
        nosw: params.has('nosw'),
        forceSw: params.get('sw') === '1',
    };
}

/** iPhone/iPod/iPad, including iPadOS 13+ which reports a Mac user agent. */
export function detectIos(nav) {
    if (!nav) return false;
    const ua = nav.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    const macLike = /Macintosh/.test(ua) || nav.platform === 'MacIntel';
    return macLike && (nav.maxTouchPoints || 0) > 1;
}

function mediaMatches(win, query) {
    try {
        return !!(win && typeof win.matchMedia === 'function' && win.matchMedia(query).matches);
    } catch {
        return false;
    }
}

function fullscreenElement(doc) {
    return (doc && (doc.fullscreenElement || doc.webkitFullscreenElement)) || null;
}

/**
 * 'fullscreen' | 'standalone' | 'minimal-ui' | 'browser'.
 * Chrome also matches (display-mode: fullscreen) while a browser tab uses the
 * Fullscreen API, so that case is not reported as an installed app.
 */
export function detectDisplayMode(win, nav, doc) {
    if (nav && nav.standalone === true) return 'standalone';
    if (mediaMatches(win, '(display-mode: fullscreen)') && !fullscreenElement(doc)) return 'fullscreen';
    if (mediaMatches(win, '(display-mode: standalone)')) return 'standalone';
    if (mediaMatches(win, '(display-mode: minimal-ui)')) return 'minimal-ui';
    return 'browser';
}

// --- Controller ------------------------------------------------------------

/**
 * @param {object} opts
 * @param {() => string} [opts.getState]   current game state (GameState value)
 * @param {() => void}   [opts.onBeforeReload] save credits etc. before an update reload
 * @param {Document} [opts.doc]
 * @param {Window}   [opts.win]
 * @param {Navigator} [opts.nav]
 * @param {string}   [opts.swUrl]          default 'sw.js' (relative, sub-path safe)
 * @param {number}   [opts.updateIntervalMs]
 * @param {string[]} [opts.updateSafeStates]
 * @param {boolean}  [opts.register]       false skips registration entirely
 */
export function initPwa({
    getState = () => 'menu',
    onBeforeReload = noop,
    doc = globalThis.document,
    win = globalThis.window,
    nav = globalThis.navigator,
    swUrl = 'sw.js',
    updateIntervalMs = UPDATE_INTERVAL_MS,
    updateSafeStates = DEFAULT_UPDATE_SAFE_STATES,
    register = true,
} = {}) {
    const sw = nav && nav.serviceWorker ? nav.serviceWorker : null;
    const location = (win && win.location) || { search: '', hostname: '' };
    const flags = parseSwFlags(location.search || '');
    const ios = detectIos(nav);

    const state = {
        swSupported: !!sw,
        swStatus: 'idle',          // idle | skipped-localhost | disabled | registering | registered | error
        swScope: null,
        registration: null,
        waitingWorker: null,
        updateReady: false,
        reloadRequested: false,
        reloaded: false,
        deferredPrompt: null,
        installed: false,
        iosHintDismissedNow: false,
        lastError: null,
    };

    const changeListeners = new Set();
    const updateListeners = new Set();
    const cleanups = [];

    function listen(target, type, fn) {
        if (!target || typeof target.addEventListener !== 'function') return;
        target.addEventListener(type, fn);
        cleanups.push(() => target.removeEventListener && target.removeEventListener(type, fn));
    }

    function emitChange() {
        for (const fn of [...changeListeners]) {
            try { fn(getPwaState()); } catch (e) { /* listener errors never break the app */ }
        }
    }

    function isSafeState() {
        let s;
        try { s = getState(); } catch { return false; }
        return updateSafeStates.includes(s);
    }

    // ---- Service worker -----------------------------------------------------

    function markUpdateReady(worker) {
        if (!worker) return;
        state.waitingWorker = worker;
        if (!state.updateReady) {
            state.updateReady = true;
            for (const fn of [...updateListeners]) {
                try { fn(); } catch { /* ignore */ }
            }
        }
        emitChange();
    }

    function trackInstalling(worker) {
        if (!worker || typeof worker.addEventListener !== 'function') return;
        const onState = () => {
            // A worker that finishes installing while another one controls the
            // page is an update. With no controller it is the first install.
            if (worker.state === 'installed' && sw.controller) markUpdateReady(worker);
        };
        worker.addEventListener('statechange', onState);
        cleanups.push(() => worker.removeEventListener && worker.removeEventListener('statechange', onState));
    }

    function checkForUpdate() {
        const reg = state.registration;
        if (!reg || typeof reg.update !== 'function') return Promise.resolve(false);
        return Promise.resolve()
            .then(() => reg.update())
            .then(() => true, () => false);
    }

    function appBaseUrl() {
        try { return new URL('./', location.href).href; } catch { return null; }
    }

    async function killSwitch() {
        state.swStatus = 'disabled';
        try {
            if (sw && typeof sw.getRegistrations === 'function') {
                // github.io is shared by every project of the account, so only
                // touch registrations inside this app's folder.
                const base = appBaseUrl();
                const regs = await sw.getRegistrations();
                await Promise.all(regs
                    .filter((r) => !base || !r.scope || r.scope.startsWith(base))
                    .map((r) => Promise.resolve(r.unregister()).catch(noop)));
            }
        } catch (e) { state.lastError = e; }
        try {
            const cacheStorage = win && win.caches;
            if (cacheStorage) {
                const keys = await cacheStorage.keys();
                await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => cacheStorage.delete(k)));
            }
        } catch (e) { state.lastError = e; }
        emitChange();
    }

    async function registerWorker() {
        state.swStatus = 'registering';
        let reg;
        try {
            reg = await sw.register(swUrl, { updateViaCache: 'none' });
        } catch (e) {
            state.swStatus = 'error';
            state.lastError = e;
            emitChange();
            return null;
        }
        state.registration = reg;
        state.swStatus = 'registered';
        state.swScope = reg.scope || null;

        if (reg.waiting && sw.controller) markUpdateReady(reg.waiting);
        if (reg.installing) trackInstalling(reg.installing);
        listen(reg, 'updatefound', () => trackInstalling(reg.installing));

        listen(doc, 'visibilitychange', () => {
            if (!doc.visibilityState || doc.visibilityState === 'visible') checkForUpdate();
        });
        if (win && typeof win.setInterval === 'function' && updateIntervalMs > 0) {
            const id = win.setInterval(checkForUpdate, updateIntervalMs);
            cleanups.push(() => win.clearInterval && win.clearInterval(id));
        }
        emitChange();
        return reg;
    }

    let ready = Promise.resolve(null);
    if (sw) {
        listen(sw, 'controllerchange', () => {
            if (state.reloadRequested && !state.reloaded) {
                state.reloaded = true;
                try { location.reload(); } catch { /* ignore */ }
            }
            emitChange();
        });
        if (!register) {
            state.swStatus = 'idle';
        } else if (flags.nosw) {
            ready = killSwitch().then(() => null);
        } else if (isLocalhost(location.hostname || '') && !flags.forceSw) {
            state.swStatus = 'skipped-localhost';
        } else {
            ready = registerWorker();
        }
    }

    /** Is an update waiting and is it safe to offer it right now? */
    function shouldShowUpdateToast() {
        return state.updateReady && !state.reloadRequested && isSafeState();
    }

    /**
     * Save, activate the waiting worker and reload once on controllerchange.
     * Refuses (returns false) during play or when nothing is waiting.
     */
    function applyUpdate({ force = false } = {}) {
        const worker = state.waitingWorker || (state.registration && state.registration.waiting);
        if (!worker || state.reloadRequested) return false;
        if (!force && !isSafeState()) return false;
        try { onBeforeReload(); } catch { /* saving must not block the update */ }
        state.reloadRequested = true;
        worker.postMessage({ type: 'SKIP_WAITING' });
        return true;
    }

    function onUpdateReady(fn) {
        updateListeners.add(fn);
        if (state.updateReady) {
            try { fn(); } catch { /* ignore */ }
        }
        return () => updateListeners.delete(fn);
    }

    function onChange(fn) {
        changeListeners.add(fn);
        return () => changeListeners.delete(fn);
    }

    // ---- Install prompt (Android / Chromium) --------------------------------

    listen(win, 'beforeinstallprompt', (event) => {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        state.deferredPrompt = event;
        emitChange();
    });
    listen(win, 'appinstalled', () => {
        state.deferredPrompt = null;
        state.installed = true;
        emitChange();
    });

    function canInstall() {
        return !!state.deferredPrompt && !isStandalone();
    }

    /** Must be called from a click handler. Resolves 'accepted' | 'dismissed' | 'unavailable'. */
    async function promptInstall() {
        const prompt = state.deferredPrompt;
        if (!prompt || typeof prompt.prompt !== 'function') return 'unavailable';
        state.deferredPrompt = null; // a prompt event can be used only once
        let outcome = 'dismissed';
        try {
            await prompt.prompt();
            const choice = prompt.userChoice ? await prompt.userChoice : null;
            if (choice && choice.outcome) outcome = choice.outcome;
        } catch {
            outcome = 'dismissed';
        }
        if (outcome === 'accepted') state.installed = true;
        emitChange();
        return outcome;
    }

    // ---- Display mode / iOS -------------------------------------------------

    function displayMode() {
        return detectDisplayMode(win, nav, doc);
    }

    function isStandalone() {
        return displayMode() !== 'browser';
    }

    function readHintDismissed() {
        if (state.iosHintDismissedNow) return true;
        try {
            return !!(win && win.localStorage && win.localStorage.getItem(IOS_HINT_KEY));
        } catch {
            return false;
        }
    }

    /** iOS/iPadOS browser tab, not installed, not dismissed, in the menu. */
    function shouldShowIosHint() {
        if (!ios || isStandalone() || readHintDismissed()) return false;
        let s;
        try { s = getState(); } catch { return false; }
        return s === 'menu';
    }

    function dismissIosHint() {
        state.iosHintDismissedNow = true;
        try {
            if (win && win.localStorage) win.localStorage.setItem(IOS_HINT_KEY, '1');
        } catch { /* private mode: remembered for this session only */ }
        emitChange();
    }

    // ---- Fullscreen and orientation -----------------------------------------

    function fullscreenSupported() {
        return !!(doc && (doc.fullscreenEnabled || doc.webkitFullscreenEnabled));
    }

    function isFullscreen() {
        return !!fullscreenElement(doc);
    }

    /** Hidden on iPhone (unsupported) and when running as an installed app. */
    function shouldShowFullscreenButton() {
        return fullscreenSupported() && !isStandalone();
    }

    function orientation() {
        return (win && win.screen && win.screen.orientation) || null;
    }

    function lockOrientation() {
        const o = orientation();
        if (!o || typeof o.lock !== 'function' || !o.type) return Promise.resolve(false);
        try {
            return Promise.resolve(o.lock(o.type)).then(() => true, () => false);
        } catch {
            return Promise.resolve(false);
        }
    }

    function unlockOrientation() {
        const o = orientation();
        if (!o || typeof o.unlock !== 'function') return;
        try { o.unlock(); } catch { /* ignore */ }
    }

    /**
     * Enter or leave fullscreen on <html> (not the canvas, so the HUD and touch
     * controls stay visible). Must be called synchronously from a user gesture.
     * Resolves to the new fullscreen state.
     */
    function toggleFullscreen() {
        if (isFullscreen()) {
            unlockOrientation();
            const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
            let p;
            try { p = exit ? exit.call(doc) : undefined; } catch { p = undefined; }
            return Promise.resolve(p).catch(noop).then(() => isFullscreen());
        }
        if (!fullscreenSupported()) return Promise.resolve(false);
        const el = doc.documentElement;
        let p;
        try {
            if (el.requestFullscreen) p = el.requestFullscreen({ navigationUI: 'hide' });
            else if (el.webkitRequestFullscreen) p = el.webkitRequestFullscreen();
        } catch {
            return Promise.resolve(false);
        }
        return Promise.resolve(p)
            .then(() => (isFullscreen() ? lockOrientation() : false), noop)
            .then(() => isFullscreen());
    }

    const onFullscreenChange = () => {
        if (!isFullscreen()) unlockOrientation();
        emitChange();
    };
    listen(doc, 'fullscreenchange', onFullscreenChange);
    listen(doc, 'webkitfullscreenchange', onFullscreenChange);

    // ---- Snapshot for the test hook -----------------------------------------

    function getPwaState() {
        return {
            swSupported: state.swSupported,
            swStatus: state.swStatus,
            swRegistered: state.swStatus === 'registered',
            swControlled: !!(sw && sw.controller),
            swScope: state.swScope,
            updateReady: state.updateReady,
            updateToastVisible: shouldShowUpdateToast(),
            reloadRequested: state.reloadRequested,
            displayMode: displayMode(),
            standalone: isStandalone(),
            installed: state.installed || isStandalone(),
            canInstall: canInstall(),
            isIos: ios,
            iosHintVisible: shouldShowIosHint(),
            fullscreenSupported: fullscreenSupported(),
            fullscreenButtonVisible: shouldShowFullscreenButton(),
            fullscreen: isFullscreen(),
        };
    }

    function destroy() {
        while (cleanups.length) {
            try { cleanups.pop()(); } catch { /* ignore */ }
        }
        changeListeners.clear();
        updateListeners.clear();
    }

    return {
        ready,
        getPwaState,
        onChange,
        // updates
        onUpdateReady,
        shouldShowUpdateToast,
        applyUpdate,
        checkForUpdate,
        // install
        canInstall,
        promptInstall,
        // display mode / iOS
        displayMode,
        isStandalone,
        isIos: () => ios,
        shouldShowIosHint,
        dismissIosHint,
        // fullscreen
        fullscreenSupported,
        isFullscreen,
        shouldShowFullscreenButton,
        toggleFullscreen,
        lockOrientation,
        unlockOrientation,
        destroy,
    };
}
