import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    initPwa, detectIos, detectDisplayMode, isLocalhost, parseSwFlags,
    IOS_HINT_KEY, CACHE_PREFIX, DEFAULT_UPDATE_SAFE_STATES,
    installView, INSTALL_TEXT, INSTALLED_KEY, INSTALL_CHECK_MS,
    pointerVerb, updateToastText, FULLSCREEN_GESTURE_TEXT,
} from '../../js/pwa.js';

// --- Fakes ------------------------------------------------------------------
function target(extra = {}) {
    const handlers = {};
    return Object.assign({
        handlers,
        addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
        removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter((h) => h !== fn); },
        dispatch(type, ev = {}) { for (const h of [...(handlers[type] || [])]) h(ev); },
        count(type) { return (handlers[type] || []).length; },
    }, extra);
}

const flush = () => new Promise((r) => setImmediate(r));

const UA = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    ipadOld: 'Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.0 Mobile/15E148 Safari/604.1',
    ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36',
};

function makeWorker(state = 'installing') {
    const w = target({ state, messages: [] });
    w.postMessage = (m) => w.messages.push(m);
    w.setState = (s) => { w.state = s; w.dispatch('statechange'); };
    return w;
}

function makeEnv({
    href = 'https://d57udy.github.io/SpaceAdventure/',
    ua = UA.android, maxTouchPoints = 0, platform = 'Linux armv8l', standalone,
    media = {}, sw = true, controller = true, regInit = {}, storage = {},
    fullscreenEnabled = true, webkitOnly = false, orientation = true,
} = {}) {
    const url = new URL(href);
    const calls = { reload: 0, register: [], update: 0, unregister: 0, lock: [], unlock: 0, requestFs: [], exitFs: 0, intervals: [] };
    const store = new Map(Object.entries(storage));
    const win = target({
        location: { href: url.href, search: url.search, hostname: url.hostname, reload() { calls.reload++; } },
        matchMedia: (q) => ({ matches: !!media[q] }),
        localStorage: {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: (k) => store.delete(k),
        },
        setInterval(fn, ms) { calls.intervals.push({ fn, ms }); return calls.intervals.length; },
        clearInterval() {},
        screen: orientation ? {
            orientation: {
                type: 'landscape-primary',
                lock(t) { calls.lock.push(t); return Promise.resolve(); },
                unlock() { calls.unlock++; },
            },
        } : {},
        caches: null,
    });
    const cacheNames = new Set(['space-adventure-sa-aaa', 'space-adventure-sa-bbb', 'someone-else']);
    win.caches = {
        keys: async () => [...cacheNames],
        delete: async (k) => cacheNames.delete(k),
    };

    const doc = target({ visibilityState: 'visible', fullscreenElement: null, webkitFullscreenElement: null });
    const html = {};
    doc.documentElement = html;
    if (webkitOnly) {
        doc.webkitFullscreenEnabled = fullscreenEnabled;
        html.webkitRequestFullscreen = () => { calls.requestFs.push('webkit'); doc.webkitFullscreenElement = html; };
        doc.webkitExitFullscreen = () => { calls.exitFs++; doc.webkitFullscreenElement = null; };
    } else {
        doc.fullscreenEnabled = fullscreenEnabled;
        html.requestFullscreen = (opts) => { calls.requestFs.push(opts); doc.fullscreenElement = html; return Promise.resolve(); };
        doc.exitFullscreen = () => { calls.exitFs++; doc.fullscreenElement = null; return Promise.resolve(); };
    }

    const reg = target({
        scope: new URL('./', url).href, waiting: null, installing: null, active: {},
        update() { calls.update++; return Promise.resolve(); },
        unregister() { calls.unregister++; return Promise.resolve(true); },
        ...regInit,
    });
    const otherReg = { scope: 'https://d57udy.github.io/OtherRepo/', unregister() { calls.otherUnregister = (calls.otherUnregister || 0) + 1; return Promise.resolve(true); } };
    const serviceWorker = sw ? target({
        controller: controller ? {} : null,
        register(u, opts) { calls.register.push({ u, opts }); return Promise.resolve(reg); },
        getRegistrations: async () => [reg, otherReg],
    }) : undefined;
    const nav = { userAgent: ua, maxTouchPoints, platform, standalone, serviceWorker };
    return { win, doc, nav, reg, calls, store, cacheNames, html };
}

function start(env, opts = {}) {
    return initPwa({ doc: env.doc, win: env.win, nav: env.nav, ...opts });
}

// --- Pure helpers -----------------------------------------------------------
test('detectIos: iPhone, old iPad, iPadOS desktop UA; not Mac or Android', () => {
    assert.equal(detectIos({ userAgent: UA.iphone }), true);
    assert.equal(detectIos({ userAgent: UA.ipadOld }), true);
    assert.equal(detectIos({ userAgent: UA.ipadDesktop, platform: 'MacIntel', maxTouchPoints: 5 }), true);
    assert.equal(detectIos({ userAgent: UA.mac, platform: 'MacIntel', maxTouchPoints: 0 }), false);
    assert.equal(detectIos({ userAgent: UA.android, maxTouchPoints: 5 }), false);
    assert.equal(detectIos(undefined), false);
});

test('detectDisplayMode', () => {
    const w = (m) => ({ matchMedia: (q) => ({ matches: !!m[q] }) });
    assert.equal(detectDisplayMode(w({}), {}, {}), 'browser');
    assert.equal(detectDisplayMode(w({}), { standalone: true }, {}), 'standalone');
    assert.equal(detectDisplayMode(w({ '(display-mode: standalone)': true }), {}, {}), 'standalone');
    assert.equal(detectDisplayMode(w({ '(display-mode: fullscreen)': true }), {}, {}), 'fullscreen');
    assert.equal(detectDisplayMode(w({ '(display-mode: minimal-ui)': true }), {}, {}), 'minimal-ui');
    // Browser tab in Fullscreen API mode is still a browser tab.
    assert.equal(detectDisplayMode(w({ '(display-mode: fullscreen)': true }), {}, { fullscreenElement: {} }), 'browser');
    assert.equal(detectDisplayMode({}, {}, {}), 'browser', 'no matchMedia');
});

test('isLocalhost and parseSwFlags', () => {
    for (const h of ['localhost', '127.0.0.1', '[::1]', 'app.localhost']) assert.equal(isLocalhost(h), true, h);
    assert.equal(isLocalhost('d57udy.github.io'), false);
    assert.deepEqual(parseSwFlags(''), { nosw: false, forceSw: false });
    assert.deepEqual(parseSwFlags('?nosw'), { nosw: true, forceSw: false });
    assert.deepEqual(parseSwFlags('?sw=1'), { nosw: false, forceSw: true });
});

// --- Registration -----------------------------------------------------------
test('registers sw.js relative with updateViaCache none on a real host', async () => {
    const env = makeEnv();
    const pwa = start(env);
    await pwa.ready;
    assert.deepEqual(env.calls.register, [{ u: 'sw.js', opts: { updateViaCache: 'none' } }]);
    const s = pwa.getPwaState();
    assert.equal(s.swRegistered, true);
    assert.equal(s.swScope, 'https://d57udy.github.io/SpaceAdventure/');
    assert.equal(s.swControlled, true);
});

test('skips registration on localhost unless ?sw=1', async () => {
    const env = makeEnv({ href: 'http://localhost:8080/' });
    const pwa = start(env);
    await pwa.ready;
    assert.equal(env.calls.register.length, 0);
    assert.equal(pwa.getPwaState().swStatus, 'skipped-localhost');

    const env2 = makeEnv({ href: 'http://localhost:8080/?sw=1' });
    await start(env2).ready;
    assert.equal(env2.calls.register.length, 1);
});

test('no serviceWorker support: nothing breaks', async () => {
    const env = makeEnv({ sw: false });
    const pwa = start(env);
    await pwa.ready;
    const s = pwa.getPwaState();
    assert.equal(s.swSupported, false);
    assert.equal(s.swControlled, false);
    assert.equal(pwa.applyUpdate(), false);
    assert.equal(await pwa.checkForUpdate(), false);
});

test('?nosw kill switch unregisters this app only and deletes only own caches', async () => {
    const env = makeEnv({ href: 'https://d57udy.github.io/SpaceAdventure/?nosw' });
    const pwa = start(env);
    await pwa.ready;
    assert.equal(env.calls.register.length, 0);
    assert.equal(env.calls.unregister, 1);
    assert.equal(env.calls.otherUnregister, undefined, 'other repo on the shared origin untouched');
    assert.deepEqual([...env.cacheNames], ['someone-else']);
    assert.ok([...env.cacheNames].every((k) => !k.startsWith(CACHE_PREFIX)));
    assert.equal(pwa.getPwaState().swStatus, 'disabled');
});

test('registration failure is reported, not thrown', async () => {
    const env = makeEnv();
    env.nav.serviceWorker.register = () => Promise.reject(new Error('SecurityError'));
    const pwa = start(env);
    await pwa.ready;
    assert.equal(pwa.getPwaState().swStatus, 'error');
});

// --- Update checks and update-ready -----------------------------------------
test('checks for updates on visibility and every 60 minutes', async () => {
    const env = makeEnv();
    const pwa = start(env);
    await pwa.ready;
    assert.equal(env.calls.intervals.length, 1);
    assert.equal(env.calls.intervals[0].ms, 60 * 60 * 1000);
    env.calls.intervals[0].fn();
    env.doc.visibilityState = 'hidden';
    env.doc.dispatch('visibilitychange');
    env.doc.visibilityState = 'visible';
    env.doc.dispatch('visibilitychange');
    await flush();
    assert.equal(env.calls.update, 2);
    pwa.destroy();
    assert.equal(env.doc.count('visibilitychange'), 0);
});

test('a waiting worker at load (with a controller) is an update', async () => {
    const waiting = makeWorker('installed');
    const env = makeEnv({ regInit: { waiting } });
    const pwa = start(env);
    let fired = 0;
    pwa.onUpdateReady(() => fired++);
    await pwa.ready;
    assert.equal(fired, 1);
    assert.equal(pwa.getPwaState().updateReady, true);
    let late = 0;
    pwa.onUpdateReady(() => late++);
    assert.equal(late, 1, 'late subscribers are told immediately');
});

test('a worker that finishes installing later is an update; first install is not', async () => {
    const env = makeEnv();
    const pwa = start(env);
    await pwa.ready;
    const w = makeWorker();
    env.reg.installing = w;
    env.reg.dispatch('updatefound');
    assert.equal(pwa.getPwaState().updateReady, false);
    w.setState('installed');
    assert.equal(pwa.getPwaState().updateReady, true);

    const env2 = makeEnv({ controller: false });
    const pwa2 = start(env2);
    await pwa2.ready;
    const w2 = makeWorker();
    env2.reg.installing = w2;
    env2.reg.dispatch('updatefound');
    w2.setState('installed');
    assert.equal(pwa2.getPwaState().updateReady, false, 'first install, nothing to update');
    env2.nav.serviceWorker.dispatch('controllerchange');
    assert.equal(env2.calls.reload, 0, 'clients.claim on first visit must not reload');
});

test('update toast only outside play', async () => {
    let gs = 'playing';
    const env = makeEnv({ regInit: { waiting: makeWorker('installed') } });
    const pwa = start(env, { getState: () => gs });
    await pwa.ready;
    // Not while paused either: the reload would lose the paused run
    for (const s of ['playing', 'prompt_user', 'paused']) {
        gs = s;
        assert.equal(pwa.shouldShowUpdateToast(), false, s);
        assert.equal(pwa.getPwaState().updateToastVisible, false, s);
    }
    assert.equal(DEFAULT_UPDATE_SAFE_STATES.includes('paused'), false);
    for (const s of ['menu', 'game_over', 'high_scores']) {
        gs = s;
        assert.equal(pwa.shouldShowUpdateToast(), true, s);
    }
});

test('applyUpdate saves, sends SKIP_WAITING and reloads exactly once', async () => {
    let gs = 'playing';
    let saved = 0;
    const waiting = makeWorker('installed');
    const env = makeEnv({ regInit: { waiting } });
    const pwa = start(env, { getState: () => gs, onBeforeReload: () => saved++ });
    await pwa.ready;

    assert.equal(pwa.applyUpdate(), false, 'refused during play');
    assert.equal(waiting.messages.length, 0);

    gs = 'menu';
    assert.equal(pwa.applyUpdate(), true);
    assert.equal(saved, 1);
    assert.deepEqual(waiting.messages, [{ type: 'SKIP_WAITING' }]);
    assert.equal(pwa.applyUpdate(), false, 'second tap ignored');
    assert.equal(pwa.shouldShowUpdateToast(), false, 'toast hides once applying');

    env.nav.serviceWorker.dispatch('controllerchange');
    env.nav.serviceWorker.dispatch('controllerchange');
    assert.equal(env.calls.reload, 1);
});

test('applyUpdate with nothing waiting does nothing', async () => {
    const env = makeEnv();
    const pwa = start(env);
    await pwa.ready;
    assert.equal(pwa.applyUpdate(), false);
});

test('onBeforeReload throwing does not block the update', async () => {
    const waiting = makeWorker('installed');
    const env = makeEnv({ regInit: { waiting } });
    const pwa = start(env, { onBeforeReload: () => { throw new Error('quota'); } });
    await pwa.ready;
    assert.equal(pwa.applyUpdate(), true);
    assert.equal(waiting.messages.length, 1);
});

// --- Install prompt ---------------------------------------------------------
test('beforeinstallprompt is captured; promptInstall prompts once; appinstalled hides it', async () => {
    const env = makeEnv();
    const pwa = start(env);
    let changes = 0;
    pwa.onChange(() => changes++);
    assert.equal(pwa.canInstall(), false);
    assert.equal(await pwa.promptInstall(), 'unavailable');

    let prevented = 0, prompted = 0;
    const ev = {
        preventDefault: () => prevented++,
        prompt: () => { prompted++; return Promise.resolve(); },
        userChoice: Promise.resolve({ outcome: 'dismissed' }),
    };
    env.win.dispatch('beforeinstallprompt', ev);
    assert.equal(prevented, 1);
    assert.equal(pwa.canInstall(), true);
    assert.equal(pwa.getPwaState().canInstall, true);
    assert.ok(changes >= 1);

    assert.equal(await pwa.promptInstall(), 'dismissed');
    assert.equal(prompted, 1);
    assert.equal(pwa.canInstall(), false, 'a prompt event is single use');

    env.win.dispatch('beforeinstallprompt', { ...ev, userChoice: Promise.resolve({ outcome: 'accepted' }) });
    assert.equal(await pwa.promptInstall(), 'accepted');
    assert.equal(pwa.getPwaState().installed, true);

    env.win.dispatch('beforeinstallprompt', ev);
    env.win.dispatch('appinstalled');
    assert.equal(pwa.canInstall(), false);
});

test('canInstall is false when already running installed', () => {
    const env = makeEnv({ media: { '(display-mode: standalone)': true } });
    const pwa = start(env, { register: false });
    env.win.dispatch('beforeinstallprompt', { preventDefault() {}, prompt() {} });
    assert.equal(pwa.canInstall(), false);
});

// --- Install feedback (Android: "it said installed but I can't find the app") ----

/** A beforeinstallprompt event whose prompt resolves with `outcome`. */
function promptEvent(outcome = 'accepted') {
    return {
        preventDefault() {},
        prompt() { return Promise.resolve(); },
        userChoice: Promise.resolve({ outcome }),
    };
}

/** makeEnv plus a controllable setTimeout. */
function envWithTimers(opts) {
    const env = makeEnv(opts);
    env.timers = [];
    env.win.setTimeout = (fn, ms) => { env.timers.push({ fn, ms, cleared: false }); return env.timers.length; };
    env.win.clearTimeout = (id) => { if (env.timers[id - 1]) env.timers[id - 1].cleared = true; };
    env.runTimers = () => { for (const t of env.timers) if (!t.cleared) { t.cleared = true; t.fn(); } };
    return env;
}

test('installView: pure state table', () => {
    assert.deepEqual(installView({ standalone: true, canInstall: true, phase: 'installing', knownInstalled: true }),
        { button: null, notice: null }, 'inside the installed app: nothing');
    assert.deepEqual(installView({}), { button: null, notice: null }, 'nothing known: nothing');
    assert.deepEqual(installView({ canInstall: true }), { button: 'install', notice: null });
    assert.deepEqual(installView({ phase: 'installing', canInstall: true }), { button: null, notice: 'installing' });
    assert.deepEqual(installView({ phase: 'installed' }), { button: null, notice: 'installed' });
    assert.deepEqual(installView({ phase: 'check' }), { button: null, notice: 'check' });
    assert.deepEqual(installView({ phase: 'installed', noticeDismissed: true, knownInstalled: true }), { button: 'open-app', notice: null });
    assert.deepEqual(installView({ knownInstalled: true }), { button: 'open-app', notice: null });
    assert.deepEqual(installView({ knownInstalled: true, openAppHint: true }), { button: 'open-app', notice: 'openApp' });
    assert.deepEqual(installView({ phase: 'dismissed' }), { button: null, notice: 'dismissed' });
    assert.deepEqual(installView({ phase: 'dismissed', canInstall: true }), { button: 'install', notice: 'dismissed' });
    assert.deepEqual(installView({ phase: 'dismissed', noticeDismissed: true }), { button: null, notice: null });
    assert.deepEqual(installView({ knownInstalled: true, canInstall: true }), { button: 'install', notice: null },
        'the browser offering install wins over a stale memory');
});

test('install texts say where the app appears and use the full name', () => {
    assert.match(INSTALL_TEXT.installing, /^Installing…/);
    assert.match(INSTALL_TEXT.installing, /Space Adventure will appear on your home screen or in your app list/);
    assert.match(INSTALL_TEXT.installed, /^Installed\. Open Space Adventure from your home screen or app drawer/);
    for (const k of ['installed', 'check', 'openApp']) assert.match(INSTALL_TEXT[k], /search “Space Adventure”/, k);
    assert.match(INSTALL_TEXT.dismissed, /browser menu/);
    for (const t of Object.values(INSTALL_TEXT)) assert.doesNotMatch(t, /Space Adv\b/);
});

test('accepting the prompt shows "Installing…", then appinstalled shows "Installed" and remembers it', async () => {
    const env = envWithTimers();
    const pwa = start(env, { register: false });
    env.win.dispatch('beforeinstallprompt', promptEvent('accepted'));
    assert.equal(pwa.installView().button, 'install');

    assert.equal(await pwa.promptInstall(), 'accepted');
    assert.deepEqual(pwa.installView(), { button: null, notice: 'installing' }, 'never vanish without feedback');
    assert.equal(pwa.getPwaState().installPhase, 'installing');
    assert.equal(pwa.getPwaState().installNotice, 'installing');
    assert.equal(env.store.get(INSTALLED_KEY), '1');
    assert.equal(env.timers.length, 1);
    assert.equal(env.timers[0].ms, INSTALL_CHECK_MS);

    env.win.dispatch('appinstalled');
    assert.deepEqual(pwa.installView(), { button: null, notice: 'installed' });
    assert.equal(env.timers[0].cleared, true, 'no "check" message once installed');
    assert.equal(pwa.getPwaState().installedVia, 'appinstalled');

    pwa.dismissInstallNotice();
    assert.deepEqual(pwa.installView(), { button: 'open-app', notice: null });
    pwa.toggleOpenAppHint();
    assert.deepEqual(pwa.installView(), { button: 'open-app', notice: 'openApp' });
    pwa.toggleOpenAppHint();
    assert.equal(pwa.installView().notice, null);
});

test('appinstalled before userChoice resolves keeps "Installed"', async () => {
    const env = envWithTimers();
    const pwa = start(env, { register: false });
    let resolveChoice;
    const ev = { preventDefault() {}, prompt: () => Promise.resolve(), userChoice: new Promise((r) => { resolveChoice = r; }) };
    env.win.dispatch('beforeinstallprompt', ev);
    const p = pwa.promptInstall();
    env.win.dispatch('appinstalled');
    resolveChoice({ outcome: 'accepted' });
    assert.equal(await p, 'accepted');
    assert.equal(pwa.installView().notice, 'installed');
    assert.equal(env.timers.length, 0);
});

test('no appinstalled after accepting: after a while say where to look and what to do', async () => {
    const env = envWithTimers();
    const pwa = start(env, { register: false });
    env.win.dispatch('beforeinstallprompt', promptEvent('accepted'));
    await pwa.promptInstall();
    let changes = 0;
    pwa.onChange(() => changes++);
    env.runTimers();
    assert.deepEqual(pwa.installView(), { button: null, notice: 'check' });
    assert.ok(changes >= 1, 'the UI is told');
    assert.match(INSTALL_TEXT.check, /Add to home screen/);
});

test('dismissing the prompt explains how to install later instead of silently hiding the button', async () => {
    const env = envWithTimers();
    const pwa = start(env, { register: false });
    env.win.dispatch('beforeinstallprompt', promptEvent('dismissed'));
    assert.equal(await pwa.promptInstall(), 'dismissed');
    assert.deepEqual(pwa.installView(), { button: null, notice: 'dismissed' });
    assert.equal(env.store.has(INSTALLED_KEY), false);
    // The browser offers install again later: the button comes back
    env.win.dispatch('beforeinstallprompt', promptEvent('accepted'));
    assert.equal(pwa.installView().button, 'install');
    pwa.dismissInstallNotice();
    assert.deepEqual(pwa.installView(), { button: 'install', notice: null });
});

test('running as the installed app (standalone or fullscreen): no install UI, and remembered', () => {
    for (const q of ['(display-mode: standalone)', '(display-mode: fullscreen)']) {
        const env = envWithTimers({ media: { [q]: true } });
        const pwa = start(env, { register: false });
        env.win.dispatch('beforeinstallprompt', promptEvent('accepted'));
        assert.deepEqual(pwa.installView(), { button: null, notice: null }, q);
        env.win.dispatch('appinstalled');
        assert.deepEqual(pwa.installView(), { button: null, notice: null }, q);
        assert.equal(env.store.get(INSTALLED_KEY), '1', 'the browser tab later offers "Open the app"');
    }
});

test('browser tab of an installed app: remembered install shows "Open the app" guidance', async () => {
    const env = envWithTimers({ storage: { [INSTALLED_KEY]: '1' } });
    const pwa = start(env, { register: false });
    await pwa.installDetected;
    assert.deepEqual(pwa.installView(), { button: 'open-app', notice: null });
    assert.equal(pwa.getPwaState().knownInstalled, true);
    assert.equal(pwa.getPwaState().installButton, 'open-app');
    // The user removed the app: Chrome offers install again, which clears the memory
    env.win.dispatch('beforeinstallprompt', promptEvent('accepted'));
    assert.deepEqual(pwa.installView(), { button: 'install', notice: null });
    assert.equal(env.store.has(INSTALLED_KEY), false);
});

test('getInstalledRelatedApps finds the installed web app', async () => {
    const env = envWithTimers();
    let asked = 0;
    env.nav.getInstalledRelatedApps = async () => { asked++; return [{ platform: 'webapp', url: new URL('manifest.webmanifest', env.win.location.href).href }]; };
    const pwa = start(env, { register: false });
    assert.equal(await pwa.installDetected, true);
    assert.equal(asked, 1);
    assert.deepEqual(pwa.installView(), { button: 'open-app', notice: null });
    assert.equal(pwa.getPwaState().installedVia, 'related-apps');
    assert.equal(env.store.get(INSTALLED_KEY), '1');
});

test('getInstalledRelatedApps: empty, throwing or missing means not known installed', async () => {
    for (const impl of [async () => [], async () => { throw new Error('nope'); }, undefined]) {
        const env = envWithTimers();
        if (impl) env.nav.getInstalledRelatedApps = impl;
        const pwa = start(env, { register: false });
        assert.equal(await pwa.installDetected, false);
        assert.deepEqual(pwa.installView(), { button: null, notice: null });
    }
});

test('a throwing localStorage never breaks install feedback', async () => {
    const env = envWithTimers();
    env.win.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
    const pwa = start(env, { register: false });
    env.win.dispatch('beforeinstallprompt', promptEvent('accepted'));
    assert.equal(await pwa.promptInstall(), 'accepted');
    assert.equal(pwa.installView().notice, 'installing');
    env.win.dispatch('appinstalled');
    assert.equal(pwa.installView().notice, 'installed');
});

test('pointerVerb and update toast wording match the input device', () => {
    const w = (media) => ({ matchMedia: (q) => ({ matches: !!media[q] }) });
    assert.equal(pointerVerb(w({ '(any-pointer: coarse)': true })), 'tap');
    assert.equal(pointerVerb(w({ '(any-pointer: fine)': true })), 'click');
    assert.equal(pointerVerb(w({ '(any-pointer: fine)': true, '(any-pointer: coarse)': true })), 'click or tap');
    assert.equal(pointerVerb(null), 'click or tap');
    assert.equal(updateToastText('click'), 'New version available: click to update');
    assert.equal(updateToastText(), 'New version available: click or tap to update');
    assert.match(FULLSCREEN_GESTURE_TEXT, /click, a tap or the F key/);
});

// --- iOS hint ---------------------------------------------------------------
test('iOS hint: shown in the menu on iPhone and iPadOS tabs only', () => {
    let gs = 'menu';
    const cases = [
        [{ ua: UA.iphone }, true],
        [{ ua: UA.ipadDesktop, platform: 'MacIntel', maxTouchPoints: 5 }, true],
        [{ ua: UA.mac, platform: 'MacIntel', maxTouchPoints: 0 }, false],
        [{ ua: UA.android, maxTouchPoints: 5 }, false],
        [{ ua: UA.iphone, standalone: true }, false],
        [{ ua: UA.iphone, media: { '(display-mode: standalone)': true } }, false],
    ];
    for (const [opts, want] of cases) {
        const pwa = start(makeEnv(opts), { register: false, getState: () => gs });
        assert.equal(pwa.shouldShowIosHint(), want, JSON.stringify(opts));
    }
    const pwa = start(makeEnv({ ua: UA.iphone }), { register: false, getState: () => gs });
    for (const s of ['playing', 'paused', 'game_over', 'prompt_user']) {
        gs = s;
        assert.equal(pwa.shouldShowIosHint(), false, s);
    }
});

test('iOS hint dismissal is remembered in localStorage', () => {
    const env = makeEnv({ ua: UA.iphone });
    const pwa = start(env, { register: false });
    assert.equal(pwa.shouldShowIosHint(), true);
    pwa.dismissIosHint();
    assert.equal(pwa.shouldShowIosHint(), false);
    assert.equal(env.store.get(IOS_HINT_KEY), '1');
    assert.equal(IOS_HINT_KEY, 'spaceAdventure_a2hsHintDismissed');

    const again = start(makeEnv({ ua: UA.iphone, storage: { [IOS_HINT_KEY]: '1' } }), { register: false });
    assert.equal(again.shouldShowIosHint(), false);
});

test('iOS hint survives a throwing localStorage', () => {
    const env = makeEnv({ ua: UA.iphone });
    Object.defineProperty(env.win, 'localStorage', { get() { throw new Error('SecurityError'); } });
    const pwa = start(env, { register: false });
    assert.equal(pwa.shouldShowIosHint(), true);
    pwa.dismissIosHint();
    assert.equal(pwa.shouldShowIosHint(), false, 'remembered for the session');
});

// --- Fullscreen -------------------------------------------------------------
test('fullscreen button hidden when unsupported (iPhone) or installed', () => {
    assert.equal(start(makeEnv(), { register: false }).shouldShowFullscreenButton(), true);
    assert.equal(start(makeEnv({ fullscreenEnabled: false, ua: UA.iphone }), { register: false }).shouldShowFullscreenButton(), false);
    assert.equal(start(makeEnv({ media: { '(display-mode: fullscreen)': true } }), { register: false }).shouldShowFullscreenButton(), false);
    assert.equal(start(makeEnv({ webkitOnly: true }), { register: false }).shouldShowFullscreenButton(), true);
});

test('toggleFullscreen: documentElement with navigationUI hide; never locks the orientation', async () => {
    const env = makeEnv();
    const pwa = start(env, { register: false });
    assert.equal(await pwa.toggleFullscreen(), true);
    assert.deepEqual(env.calls.requestFs, [{ navigationUI: 'hide' }]);
    assert.equal(env.doc.fullscreenElement, env.html);
    assert.deepEqual(env.calls.lock, [], 'rotation stays free (side-by-side multiplayer needs landscape)');
    assert.equal(pwa.isFullscreen(), true);
    assert.equal(pwa.getPwaState().displayMode, 'browser');

    assert.equal(await pwa.toggleFullscreen(), false);
    assert.equal(env.calls.exitFs, 1);
    assert.ok(env.calls.unlock >= 1);
});

test('toggleFullscreen: webkit fallback (older iPadOS)', async () => {
    const env = makeEnv({ webkitOnly: true });
    const pwa = start(env, { register: false });
    assert.equal(await pwa.toggleFullscreen(), true);
    assert.deepEqual(env.calls.requestFs, ['webkit']);
    assert.equal(await pwa.toggleFullscreen(), false);
    assert.equal(env.calls.exitFs, 1);
});

test('orientation lock rejection and missing screen.orientation are harmless', async () => {
    const env = makeEnv();
    env.win.screen.orientation.lock = () => Promise.reject(new Error('NotSupportedError'));
    const pwa = start(env, { register: false });
    assert.equal(await pwa.toggleFullscreen(), true);

    const env2 = makeEnv({ orientation: false });
    const pwa2 = start(env2, { register: false });
    assert.equal(await pwa2.toggleFullscreen(), true);
    assert.equal(await pwa2.toggleFullscreen(), false);
});

test('requestFullscreen rejection resolves false', async () => {
    const env = makeEnv();
    env.html.requestFullscreen = () => Promise.reject(new Error('not in a user gesture'));
    const pwa = start(env, { register: false });
    assert.equal(await pwa.toggleFullscreen(), false);
    assert.equal(env.calls.lock.length, 0);
});

test('leaving fullscreen via Esc (fullscreenchange) unlocks orientation and notifies', () => {
    const env = makeEnv();
    const pwa = start(env, { register: false });
    let last;
    pwa.onChange((s) => { last = s; });
    env.doc.fullscreenElement = env.html;
    env.doc.dispatch('fullscreenchange');
    assert.equal(last.fullscreen, true);
    env.doc.fullscreenElement = null;
    env.doc.dispatch('fullscreenchange');
    assert.equal(last.fullscreen, false);
    assert.equal(env.calls.unlock, 1);
});

test('getPwaState snapshot has the hook fields', async () => {
    const env = makeEnv();
    const pwa = start(env);
    await pwa.ready;
    const s = pwa.getPwaState();
    for (const k of ['swSupported', 'swStatus', 'swRegistered', 'swControlled', 'swScope', 'updateReady',
        'updateToastVisible', 'displayMode', 'standalone', 'installed', 'canInstall', 'isIos',
        'installPhase', 'knownInstalled', 'installedVia', 'installButton', 'installNotice',
        'iosHintVisible', 'fullscreenSupported', 'fullscreenButtonVisible', 'fullscreen']) {
        assert.ok(k in s, k);
    }
});
