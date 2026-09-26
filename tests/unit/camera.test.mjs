import { test } from 'node:test';
import assert from 'node:assert/strict';

const { axisCover, chooseCentreAxis, requiredZoom, frameTargets, createCamera } = await import('../../js/camera.js');
const { wrapDelta } = await import('../../js/utils.js');

function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const viewFor = V => ({ width: V, height: V, worldWidth: 1.5 * V, worldHeight: 1.5 * V });
const close = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, msg ?? `${a} != ${b}`);
const V = 690, view = viewFor(V), W = view.worldWidth, H = view.worldHeight;

test('midpoint of 2 points', () => {
    const f = frameTargets([{ x: 100, y: 200 }, { x: 300, y: 400 }], view);
    close(f.cx, 200); close(f.cy, 300);
    close(f.spanX, 200); close(f.spanY, 200);
    assert.equal(f.zoom, 1);
});

test('midpoint of 2 points across the world edge', () => {
    const f = frameTargets([{ x: 20, y: 10 }, { x: W - 40, y: H - 30 }], view);
    close(f.cx, W - 10); close(f.cy, H - 10);
    close(f.spanX, 60); close(f.spanY, 40);
});

test('axisCover: single point and empty', () => {
    assert.deepEqual(axisCover([123], 1000), { centre: 123, span: 0 });
    assert.equal(axisCover([], 1000), null);
    assert.deepEqual(axisCover([1100], 1000), { centre: 100, span: 0 });
});

test('3 evenly spaced points', () => {
    const c = axisCover([0, W / 3, 2 * W / 3], W);
    close(c.span, 2 * W / 3, 1e-9);
    const f = frameTargets([{ x: 0, y: 0 }, { x: W / 3, y: H / 3 }, { x: 2 * W / 3, y: 2 * H / 3 }], view);
    assert.ok(f.zoom < 1 && f.zoom >= 0.75, `zoom ${f.zoom}`);
    close(f.zoom, V / (2 * W / 3 + 50), 1e-9);
});

test('flip hysteresis in both directions', () => {
    const hyst = 0.04 * W; // 41.4
    // points 0 and W/2 - 10: best cover centred at W/4 - 5
    let r = chooseCentreAxis([0, W / 2 - 10], W, null);
    close(r.centre, W / 4 - 5);
    const first = r.centre;
    // move past half-world by less than the hysteresis: keep current
    r = chooseCentreAxis([0, W / 2 + 10], W, first, hyst);
    assert.equal(r.flipped, false);
    close(r.centre, W / 4 + 5);
    // further: the other midpoint is better by more than 4%: flip
    r = chooseCentreAxis([0, W / 2 + 30], W, r.centre, hyst);
    assert.equal(r.flipped, true);
    close(r.centre, (W / 2 + 30 + (W / 2 - 30) / 2) % W);
    const second = r.centre;
    // coming back a little: stay on the new side
    r = chooseCentreAxis([0, W / 2 - 10], W, second, hyst);
    assert.equal(r.flipped, false);
    close(r.centre, 3 * W / 4 - 5);
    // coming back further: flip back
    r = chooseCentreAxis([0, W / 2 - 30], W, r.centre, hyst);
    assert.equal(r.flipped, true);
    close(r.centre, W / 4 - 15);
});

for (const Vs of [337, 690, 1024]) {
    test(`fit property: 10,000 seeded pairs at V=${Vs}`, () => {
        const v = viewFor(Vs);
        const rnd = mulberry32(Vs * 7919);
        const limit = 0.5 * Vs - 25;
        for (let i = 0; i < 10000; i++) {
            const pts = [
                { x: rnd() * v.worldWidth, y: rnd() * v.worldHeight },
                { x: rnd() * v.worldWidth, y: rnd() * v.worldHeight }
            ];
            // Half the runs start from a random previous centre so hysteresis is exercised.
            const prev = i % 2 ? { x: rnd() * v.worldWidth, y: rnd() * v.worldHeight } : null;
            const f = frameTargets(pts, v, prev);
            assert.equal(f.zoom, 1);
            for (const p of pts) {
                const dx = Math.abs(wrapDelta(p.x - f.cx, v.worldWidth));
                const dy = Math.abs(wrapDelta(p.y - f.cy, v.worldHeight));
                assert.ok(dx <= limit && dy <= limit, `pair ${i}: ${dx}, ${dy} > ${limit}`);
            }
        }
    });
}

test('4-player zoom >= 0.8 at V=690 and never below the minimum', () => {
    const even = [0, 1, 2, 3].map(i => ({ x: i * W / 4, y: i * H / 4 }));
    const fe = frameTargets(even, view);
    assert.ok(fe.zoom >= 0.8, `even zoom ${fe.zoom}`);
    const rnd = mulberry32(42);
    for (let i = 0; i < 2000; i++) {
        const pts = [0, 1, 2, 3].map(() => ({ x: rnd() * W, y: rnd() * H }));
        const f = frameTargets(pts, view);
        assert.ok(f.zoom >= 0.8 && f.zoom <= 1, `zoom ${f.zoom}`);
    }
    for (const Vs of [120, 200, 337]) {
        assert.ok(requiredZoom(10000, 10000, viewFor(Vs)) >= 0.75);
    }
    assert.equal(requiredZoom(10000, 10000, { width: 100, height: 100, worldWidth: 0, worldHeight: 0 }), 0.75);
});

// Today's Camera from main.js, parameterised by world size.
function legacyCamera(WW, WH) {
    return {
        x: 0, y: 0, parallaxX: 0, parallaxY: 0, lastShipX: null, lastShipY: null,
        update(shipX, shipY, cw, ch) {
            if (this.lastShipX !== null) {
                let dx = shipX - this.lastShipX, dy = shipY - this.lastShipY;
                if (dx > WW / 2) dx -= WW; else if (dx < -WW / 2) dx += WW;
                if (dy > WH / 2) dy -= WH; else if (dy < -WH / 2) dy += WH;
                this.parallaxX += dx; this.parallaxY += dy;
            }
            this.lastShipX = shipX; this.lastShipY = shipY;
            this.x = shipX - cw / 2; this.y = shipY - ch / 2;
        },
        reset(sx, sy, cw, ch) {
            this.x = sx - cw / 2; this.y = sy - ch / 2;
            this.parallaxX = 0; this.parallaxY = 0; this.lastShipX = sx; this.lastShipY = sy;
        },
        worldToScreen(wx, wy) { return { x: wx - this.x, y: wy - this.y }; }
    };
}

test('one target matches today\'s camera exactly', () => {
    const v = { width: 800, height: 600, worldWidth: 1200, worldHeight: 900 };
    const old = legacyCamera(v.worldWidth, v.worldHeight);
    const cam = createCamera();
    old.reset(600, 450, v.width, v.height);
    cam.reset(600, 450, v);
    const rnd = mulberry32(7);
    let x = 600, y = 450;
    for (let i = 0; i < 3000; i++) {
        x += (rnd() - 0.5) * 40; y += (rnd() - 0.5) * 40;
        if (x < 0) x = v.worldWidth; if (x > v.worldWidth) x = 0;
        if (y < 0) y = v.worldHeight; if (y > v.worldHeight) y = 0;
        if (i % 500 === 250) { x = rnd() * v.worldWidth; y = rnd() * v.worldHeight; } // hyperspace
        old.update(x, y, v.width, v.height);
        cam.update([{ x, y }], 1 / 60, v);
        assert.equal(cam.x, old.x); assert.equal(cam.y, old.y);
        assert.equal(cam.parallaxX, old.parallaxX); assert.equal(cam.parallaxY, old.parallaxY);
        assert.equal(cam.zoom, 1);
        assert.deepEqual(cam.worldToScreen(100, 200), old.worldToScreen(100, 200));
    }
});

test('no points keeps the previous centre', () => {
    const cam = createCamera();
    cam.reset(300, 300, view);
    cam.update([{ x: 100, y: 200 }, { x: 300, y: 400 }], 1, view);
    const snap = { x: cam.x, y: cam.y, cx: cam.cx, cy: cam.cy, zoom: cam.zoom, px: cam.parallaxX };
    cam.update([], 0.5, view);
    assert.deepEqual({ x: cam.x, y: cam.y, cx: cam.cx, cy: cam.cy, zoom: cam.zoom, px: cam.parallaxX }, snap);
    const single = createCamera();
    single.reset(10, 20, view);
    single.update([], 1, view);
    assert.equal(single.cx, 10); assert.equal(single.cy, 20);
});

test('two targets: smoothing converges to the midpoint (0.12 s)', () => {
    const cam = createCamera();
    cam.reset(0, 0, view);
    const pts = [{ x: 100, y: 100 }, { x: 300, y: 300 }];
    cam.update(pts, 0.12, view);
    close(cam.cx, 200 * (1 - Math.exp(-1)), 1e-6);
    for (let i = 0; i < 120; i++) cam.update(pts, 1 / 60, view);
    close(cam.cx, 200, 1e-3); close(cam.cy, 200, 1e-3);
    close(cam.x, 200 - V / 2, 1e-3);
});

test('starfield ignores flips, and the flip glides over 0.2 s', () => {
    const cam = createCamera();
    const a = { x: 0, y: 100 }, b = { x: W / 2 - 10, y: 100 };
    cam.reset(W / 4 - 5, 100, view);
    for (let i = 0; i < 60; i++) cam.update([a, b], 1 / 60, view);
    close(cam.cx, W / 4 - 5, 1e-6);
    const p0 = cam.parallaxX;
    // Jump b past the hysteresis so the other midpoint wins; move a matching amount so the
    // cover span is the only thing that changes (no net centre movement on the new side).
    b.x = W / 2 + 60;
    cam.update([a, b], 1 / 60, view);
    const goal = (W / 2 + 60 + (W / 2 - 60) / 2) % W;
    close(cam.goalX, goal);
    // Camera did not jump in the first frame of the glide.
    assert.ok(Math.abs(wrapDelta(cam.cx - (W / 4 - 5), W)) < 40, `jumped to ${cam.cx}`);
    // Parallax moved only by the smoothed follow of the new goal, not by the flip.
    assert.ok(Math.abs(cam.parallaxX - p0) < 1, `parallax ${cam.parallaxX - p0}`);
    for (let i = 0; i < 12; i++) cam.update([a, b], 1 / 60, view); // 0.2 s total
    close(cam.cx, goal, 1e-6);
    assert.ok(Math.abs(cam.parallaxX - p0) < 1);
});

test('zoom eases out for 4 players and back to 1 for 2', () => {
    const cam = createCamera();
    cam.reset(0, 0, view);
    const four = [0, 1, 2, 3].map(i => ({ x: i * W / 4, y: i * H / 4 }));
    const target = frameTargets(four, view).zoom;
    for (let i = 0; i < 15; i++) cam.update(four, 1 / 60, view); // 0.25 s
    assert.ok(Math.abs(cam.zoom - target) < 0.01, `zoom ${cam.zoom} vs ${target}`);
    close(cam.x, cam.cx - V / (2 * cam.zoom));
    const s = cam.worldToScreen(cam.cx, cam.cy);
    close(s.x, V / 2); close(s.y, V / 2);
    const two = four.slice(0, 2);
    for (let i = 0; i < 24; i++) cam.update(two, 1 / 60, view); // 0.4 s
    assert.ok(Math.abs(cam.zoom - 1) < 0.01);
    for (let i = 0; i < 60; i++) cam.update(two, 1 / 60, view);
    assert.equal(cam.zoom, 1);
});
