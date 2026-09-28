// Screen Wake Lock wrapper (js/wakeLock.js) with a fake navigator.wakeLock and document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWakeLock } from '../../js/wakeLock.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

function fakes({ reject = false, throwOnRequest = false, throwOnRelease = false } = {}) {
    const doc = {
        visibilityState: 'visible',
        listeners: [],
        addEventListener(type, fn) { if (type === 'visibilitychange') this.listeners.push(fn); },
        setVisible(v) {
            this.visibilityState = v ? 'visible' : 'hidden';
            if (!v) for (const s of sentinels) if (!s.released) s.browserRelease();
            for (const fn of this.listeners) fn();
        },
    };
    const sentinels = [];
    const nav = {
        wakeLock: {
            request(type) {
                if (throwOnRequest) throw new Error('TypeError');
                assert.equal(type, 'screen');
                if (reject) return Promise.reject(new Error('NotAllowedError'));
                const s = {
                    released: false,
                    listeners: [],
                    addEventListener(t, fn) { if (t === 'release') this.listeners.push(fn); },
                    release() {
                        if (throwOnRelease) throw new Error('boom');
                        this.released = true;
                        this.listeners.forEach((fn) => fn());
                        return Promise.resolve();
                    },
                    browserRelease() { this.released = true; this.listeners.forEach((fn) => fn()); },
                };
                sentinels.push(s);
                return Promise.resolve(s);
            },
        },
    };
    return { nav, doc, sentinels };
}

test('without the API: sync is a no-op', () => {
    const wl = createWakeLock({ navigator: {}, document: { visibilityState: 'visible' } });
    assert.doesNotThrow(() => { wl.sync(true); wl.sync(false); });
    assert.equal(wl.snapshot().supported, false);
    const wl2 = createWakeLock({ navigator: undefined, document: undefined });
    assert.doesNotThrow(() => wl2.sync(true));
});

test('requests once while wanted, releases when not', async () => {
    const { nav, doc, sentinels } = fakes();
    const wl = createWakeLock({ navigator: nav, document: doc });
    wl.sync(true);
    wl.sync(true); // pending: no second request
    await tick();
    wl.sync(true); // held: no second request
    assert.equal(sentinels.length, 1);
    assert.equal(wl.snapshot().held, true);
    wl.sync(false);
    assert.equal(sentinels[0].released, true);
    assert.equal(wl.snapshot().held, false);
    assert.equal(wl.snapshot().releases, 1);
    wl.sync(false);
    assert.equal(wl.snapshot().releases, 1);
});

test('re-requested when the page becomes visible again while still wanted', async () => {
    const { nav, doc, sentinels } = fakes();
    const wl = createWakeLock({ navigator: nav, document: doc });
    wl.sync(true);
    await tick();
    doc.setVisible(false); // the browser drops the lock
    assert.equal(wl.snapshot().held, false);
    wl.sync(true); // hidden: no request
    assert.equal(sentinels.length, 1);
    doc.setVisible(true);
    await tick();
    assert.equal(sentinels.length, 2);
    assert.equal(wl.snapshot().held, true);
});

test('not re-requested on return when no longer wanted', async () => {
    const { nav, doc, sentinels } = fakes();
    const wl = createWakeLock({ navigator: nav, document: doc });
    wl.sync(true);
    await tick();
    wl.sync(false);
    doc.setVisible(false);
    doc.setVisible(true);
    await tick();
    assert.equal(sentinels.length, 1);
});

test('a lock granted after it stopped being wanted is released at once', async () => {
    const { nav, doc, sentinels } = fakes();
    const wl = createWakeLock({ navigator: nav, document: doc });
    wl.sync(true);
    wl.sync(false); // before the promise settles
    await tick();
    assert.equal(sentinels[0].released, true);
    assert.equal(wl.snapshot().held, false);
});

test('rejected or throwing requests never throw and are not retried every frame', async () => {
    const { nav, doc } = fakes({ reject: true });
    const wl = createWakeLock({ navigator: nav, document: doc });
    wl.sync(true);
    await tick();
    wl.sync(true);
    wl.sync(true);
    await tick();
    assert.equal(wl.snapshot().requests, 1);
    assert.equal(wl.snapshot().errors, 1);
    wl.sync(false);
    wl.sync(true); // a new start retries
    await tick();
    assert.equal(wl.snapshot().requests, 2);

    const t = fakes({ throwOnRequest: true });
    const wl2 = createWakeLock({ navigator: t.nav, document: t.doc });
    assert.doesNotThrow(() => wl2.sync(true));
    assert.equal(wl2.snapshot().errors, 1);
});

test('a throwing release is swallowed', async () => {
    const { nav, doc } = fakes({ throwOnRelease: true });
    const wl = createWakeLock({ navigator: nav, document: doc });
    wl.sync(true);
    await tick();
    assert.doesNotThrow(() => wl.sync(false));
    assert.equal(wl.snapshot().held, false);
});
