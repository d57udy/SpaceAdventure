import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    initPwa, detectIos, detectDisplayMode, isLocalhost, parseSwFlags,
    IOS_HINT_KEY, CACHE_PREFIX,
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
    for (const s of ['playing', 'prompt_user']) {
        gs = s;
        assert.equal(pwa.shouldShowUpdateToast(), false, s);
        assert.equal(pwa.getPwaState().updateToastVisible, false, s);
    }
    for (const s of ['menu', 'paused', 'game_over', 'high_scores']) {
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

test('toggleFullscreen: documentElement with navigationUI hide, locks and unlocks orientation', async () => {
    const env = makeEnv();
    const pwa = start(env, { register: false });
    assert.equal(await pwa.toggleFullscreen(), true);
    assert.deepEqual(env.calls.requestFs, [{ navigationUI: 'hide' }]);
    assert.equal(env.doc.fullscreenElement, env.html);
    assert.deepEqual(env.calls.lock, ['landscape-primary']);
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
        'iosHintVisible', 'fullscreenSupported', 'fullscreenButtonVisible', 'fullscreen']) {
        assert.ok(k in s, k);
    }
});
