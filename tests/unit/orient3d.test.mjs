// Screen orientation helpers for the 3D game (js/3d/orient3d.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canLockOrientation, rotateHint, prefersReducedMotion, createOrientationLock } from '../../js/3d/orient3d.js';

function fakeWin({ standalone = false, reduced = false, ua = 'Android', lockOk = true } = {}) {
    const calls = [];
    return {
        calls,
        navigator: { userAgent: ua, maxTouchPoints: 5 },
        matchMedia: (q) => ({ matches: (standalone && /display-mode: standalone/.test(q)) || (reduced && /reduced-motion/.test(q)) }),
        screen: {
            orientation: {
                lock: (o) => { calls.push(['lock', o]); return lockOk ? Promise.resolve() : Promise.reject(new Error('no')); },
                unlock: () => calls.push(['unlock']),
            },
        },
    };
}

test('lock only in full screen or as an installed app; unlock when leaving', async () => {
    const tab = fakeWin();
    assert.equal(canLockOrientation(tab, {}), false, 'a plain browser tab');
    assert.equal(await createOrientationLock({ win: tab, doc: {} }).lock(), false);
    assert.deepEqual(tab.calls, []);
    const app = fakeWin({ standalone: true });
    const l = createOrientationLock({ win: app, doc: {} });
    assert.equal(await l.lock(), true);
    assert.equal(l.locked, true);
    l.unlock();
    l.unlock();
    assert.deepEqual(app.calls, [['lock', 'landscape'], ['unlock']]);
    const fs = fakeWin({ lockOk: false });
    assert.equal(canLockOrientation(fs, { fullscreenElement: {} }), true);
    assert.equal(await createOrientationLock({ win: fs, doc: { fullscreenElement: {} } }).lock(), false, 'refused: no throw');
    assert.equal(canLockOrientation({ screen: {} }, {}), false, 'no Screen Orientation API');
});

test('the rotate hint names the iPhone; reduced motion follows the system setting', () => {
    assert.match(rotateHint(fakeWin({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })), /iPhone sideways/);
    assert.equal(rotateHint(fakeWin()), 'Landscape recommended');
    assert.equal(prefersReducedMotion(fakeWin({ reduced: true })), true);
    assert.equal(prefersReducedMotion(fakeWin()), false);
    assert.equal(prefersReducedMotion({}), false);
});
