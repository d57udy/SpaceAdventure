import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPerfMonitor, PERF3D, createContextLossTracker, CONTEXT3D, CONTEXT_MESSAGES } from '../../js/3d/perf3d.js';

// Feed `seconds` of frames at `fps`, with the renderer's scale from scaleAt(time)
function run(m, fps, seconds, { scale = () => 1, minScale = 0.5, start = 0 } = {}) {
    const dt = 1 / fps;
    let t = start;
    let d;
    const out = [];
    for (let i = 0; i < Math.round(seconds * fps); i++) {
        t += dt;
        d = m.frame(dt, { renderScale: scale(t), minScale });
        out.push(d);
    }
    return { last: d, all: out, t };
}

test('a fast device: measuring, then ok after the window', () => {
    const m = createPerfMonitor();
    assert.equal(m.decision, 'measuring');
    const a = run(m, 60, 5);
    assert.equal(a.last, 'measuring');
    assert.equal(m.final, false);
    const b = run(m, 60, 6);
    assert.equal(b.last, 'ok');
    assert.equal(m.final, true);
    assert.ok(Math.abs(m.fps - 60) < 1);
    // Final: later slow frames change nothing
    run(m, 10, 5);
    assert.equal(m.decision, 'ok');
});

test('slow at full scale: lower-resolution; the scale drop fixes it: ok', () => {
    const m = createPerfMonitor();
    const a = run(m, 35, 4, { scale: () => 1 });
    assert.equal(a.last, 'lower-resolution');
    assert.ok(a.all.includes('lower-resolution'));
    // The renderer is at its lowest scale and now draws 50 fps
    const b = run(m, 50, 8, { scale: () => 0.5 });
    assert.equal(b.last, 'ok');
});

test('still below 30 fps at the lowest scale for 2 s: offer 2D (once)', () => {
    const m = createPerfMonitor();
    run(m, 20, 3, { scale: () => 1 });
    assert.equal(m.decision, 'lower-resolution');
    const b = run(m, 20, 1.5, { scale: () => 0.5 });
    assert.notEqual(b.last, 'offer-2d', 'not before the hold time');
    const c = run(m, 20, 1, { scale: () => 0.5 });
    assert.equal(c.last, 'offer-2d');
    assert.equal(m.final, true);
});

test('between 30 and 45 fps at the lowest scale is accepted', () => {
    const m = createPerfMonitor();
    const r = run(m, 38, 12, { scale: () => 0.5 });
    assert.equal(r.last, 'ok');
    assert.equal(r.all.includes('offer-2d'), false);
});

test('warm-up and long frames are ignored', () => {
    const m = createPerfMonitor();
    // A slow start (shader compiles) inside the warm-up doesn't count
    run(m, 5, PERF3D.warmup - 0.3, { scale: () => 0.5 });
    assert.equal(m.decision, 'measuring');
    m.frame(5); // tab was hidden
    m.frame(-1);
    m.frame(NaN);
    assert.equal(m.snapshot().time < PERF3D.warmup, true);
    const r = run(m, 60, 11);
    assert.equal(r.last, 'ok');
});

test('decline: stay in 3D, no more offers; reset starts over', () => {
    const m = createPerfMonitor();
    run(m, 20, 6, { scale: () => 0.5 });
    assert.equal(m.decision, 'offer-2d');
    m.decline();
    assert.equal(m.decision, 'ok');
    assert.equal(m.final, true);
    m.reset();
    assert.equal(m.decision, 'measuring');
    assert.equal(m.final, false);
    assert.equal(m.fps, 0);
});

test('options override the thresholds', () => {
    const m = createPerfMonitor({ windowSeconds: 3 });
    const r = run(m, 60, 3.2);
    assert.equal(r.last, 'ok');
});

test('context loss: pause, restore rebuilds and keeps playing', () => {
    const c = createContextLossTracker();
    assert.equal(c.isLost, false);
    assert.deepEqual(c.lost(10), { pause: true, message: CONTEXT_MESSAGES.lost });
    assert.equal(c.isLost, true);
    assert.equal(c.tick(11), null);
    assert.deepEqual(c.restored(11.5), { rebuild: true });
    assert.equal(c.isLost, false);
    assert.equal(c.tick(100), null);
    assert.deepEqual(c.restored(101), { rebuild: false }, 'nothing to restore');
});

test('context loss: no restore after 10 s of visible time: ask once (Retry waits again); a hidden tab does not count', () => {
    assert.equal(CONTEXT3D.restoreWait, 10);
    const c = createContextLossTracker();
    c.lost(0);
    for (let t = 1; t < CONTEXT3D.restoreWait; t++) assert.equal(c.tick(t), null);
    assert.deepEqual(c.tick(CONTEXT3D.restoreWait), { ask: true, message: CONTEXT_MESSAGES.stuck });
    assert.equal(c.tick(CONTEXT3D.restoreWait + 1), null, 'asked once');
    assert.equal(c.gaveUp, false, 'never gives up by itself on one loss');
    c.retry();
    assert.equal(c.tick(CONTEXT3D.restoreWait + 5), null);
    assert.equal(c.tick(2 * CONTEXT3D.restoreWait + 1).ask, true, 'Retry: another full wait');
    assert.deepEqual(c.restored(30), { rebuild: true });
    // Hidden (backgrounded) time doesn't count toward the wait
    const h = createContextLossTracker();
    h.lost(0);
    assert.equal(h.tick(60, { visible: false }), null);
    assert.equal(h.snapshot().waited, 0);
    assert.equal(h.tick(65), null);
    assert.equal(h.tick(70).ask, true);
});

test('context loss: lost 3 times within a minute: back to 2D once', () => {
    const d = createContextLossTracker();
    for (let i = 0; i < CONTEXT3D.maxLosses; i++) {
        d.lost(i * 10);
        d.restored(i * 10 + 1);
        if (i < CONTEXT3D.maxLosses - 1) assert.equal(d.tick(i * 10 + 2), null);
    }
    assert.equal(d.tick(25).fallback, true);
    // Losses spread over more than the window don't add up
    const e = createContextLossTracker();
    for (let i = 0; i < 5; i++) { e.lost(i * 100); e.restored(i * 100 + 1); assert.equal(e.tick(i * 100 + 2), null); }
    assert.equal(e.snapshot().losses, 1);
});
