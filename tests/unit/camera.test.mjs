import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
    axisCover, chooseCentreAxis, requiredZoom, frameTargets, createCamera,
    unwrapNear, unwrapTargets, zoomFloor, leashBox, applyLeash, leashEntity, clampToBox, boxSpawnGrid,
} = await import('../../js/camera.js');
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

test('zoom eases out for 4 players and back to 1 for 2', () => {
    const cam = createCamera({ singleInstant: false });
    const four = [0, 1, 2, 3].map(i => ({ id: `p${i}`, x: i * W / 4, y: i * H / 4 }));
    // Continuous tracking anchors them at 0, W/4, W/2 and -W/4 around a centre at 0; start the
    // camera on their midpoint so only the zoom moves.
    cam.reset(W / 8, H / 8, view);
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

// --- Continuous tracking, zoom and the soft edge (simultaneous modes, 2026-09-28) ---

const inView = (cam, x, y, v) => {
    const sx = Math.abs(wrapDelta(x - cam.cx, v.worldWidth)) * cam.zoom;
    const sy = Math.abs(wrapDelta(y - cam.cy, v.worldHeight)) * cam.zoom;
    return sx <= v.width / 2 && sy <= v.height / 2;
};
const wrapW = (v, size) => ((v % size) + size) % size;

test('leashBox: visible half-extent at the minimum zoom minus the margin', () => {
    assert.equal(zoomFloor(view), 0.75);
    const b = leashBox(100, 200, view);
    close(b.halfW, V / 1.5 - 25); close(b.halfH, V / 1.5 - 25);
    close(b.left, 100 - b.halfW); close(b.top, 200 - b.halfH);
    close(b.width, 2 * b.halfW);
    // Always inside half a world, so every point has exactly one image in the box
    assert.ok(b.halfW < W / 2 && b.halfH < H / 2);
    // A narrow world raises the floor: world 1.2 x view -> floor 1/1.2
    const narrow = { width: 600, height: 600, worldWidth: 720, worldHeight: 720 };
    close(zoomFloor(narrow), 600 / 720);
    close(leashBox(0, 0, narrow).halfW, 360 - 25);
});

test('applyLeash hard: clamps onto the edge and removes only the outward velocity', () => {
    const box = leashBox(0, 0, view);
    const h = box.halfW;
    let r = applyLeash({ x: h + 30, y: 10, vx: 400, vy: -50 }, box);
    assert.equal(r.x, h); assert.equal(r.vx, 0); assert.equal(r.vy, -50);
    assert.equal(r.pressing, true); assert.deepEqual(r.edges, ['right']);
    // Already heading back in: position clamped, velocity kept
    r = applyLeash({ x: -h - 5, y: 0, vx: 100, vy: 0 }, box);
    assert.equal(r.x, -h); assert.equal(r.vx, 100); assert.deepEqual(r.edges, ['left']);
    // Corner: both axes
    r = applyLeash({ x: h + 1, y: -h - 1, vx: 10, vy: -10 }, box);
    assert.deepEqual(r.edges, ['right', 'top']);
    assert.equal(r.vx, 0); assert.equal(r.vy, 0);
    // Inside: untouched
    r = applyLeash({ x: h - 1, y: 0, vx: 999, vy: 0 }, box);
    assert.deepEqual(r, { x: h - 1, y: 0, vx: 999, vy: 0, pressing: false, edges: [] });
});

test('applyLeash soft: damps outward velocity, springs back, stretches at most 20 px', () => {
    const box = leashBox(0, 0, view);
    const h = box.halfW;
    // Keep thrusting outward (300 px/s^2) against the soft edge for 3 s
    let s = { x: h - 50, y: 0, vx: 600, vy: 0 };
    let maxOver = 0, pressed = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 180; i++) {
        s.vx += 300 * dt;
        s.x += s.vx * dt;
        const r = applyLeash(s, box, { soft: true, dt });
        if (r.pressing) pressed++;
        s = r;
        maxOver = Math.max(maxOver, s.x - h);
    }
    assert.ok(maxOver <= 20 + 1e-9, `over ${maxOver}`);
    assert.ok(maxOver > 0, 'soft edge gives a little');
    assert.ok(pressed > 60, `pressed ${pressed}`);
    // One step past the edge: outward speed cut hard and turned toward the box
    const one = applyLeash({ x: h + 10, y: 0, vx: 500, vy: 0 }, box, { soft: true, dt });
    assert.ok(one.vx < 500 * 0.7, `vx ${one.vx}`);
    assert.equal(one.x, h + 10); // within the overshoot: position kept (elastic)
    // Let go: the spring brings it back inside
    s = { x: h + 20, y: 0, vx: 0, vy: 0 };
    for (let i = 0; i < 60; i++) {
        s = applyLeash(s, box, { soft: true, dt });
        s.x += s.vx * dt;
    }
    assert.ok(s.x <= h + 1, `back to ${s.x}`);
});

test('leashEntity works in world coordinates across the world edge', () => {
    const box = leashBox(20, H / 2, view); // centre near the left world edge
    const e = { x: wrapW(20 + box.halfW + 40, W), y: H / 2, velX: 300, velY: 0 };
    const r = leashEntity(e, box, W, H);
    assert.equal(r.pressing, true); assert.deepEqual(r.edges, ['right']);
    close(e.x, wrapW(20 + box.halfW, W)); assert.equal(e.velX, 0);
    const f = { x: wrapW(20 - box.halfW - 40, W), y: H / 2, velX: -300, velY: 5 };
    leashEntity(f, box, W, H);
    close(f.x, wrapW(20 - box.halfW, W)); assert.equal(f.velX, 0); assert.equal(f.velY, 5);
    assert.ok(f.x >= 0 && f.x < W);
});

test('clampToBox and boxSpawnGrid stay inside the box', () => {
    const box = leashBox(10, 10, view);
    const p = clampToBox(W / 2 + 10, 10, box, W, H, 30);
    close(Math.abs(wrapDelta(p.x - 10, W)), box.halfW - 30);
    const grid = boxSpawnGrid(box, W, H, 4, 4, 40);
    assert.equal(grid.length, 16);
    for (const g of grid) {
        assert.ok(Math.abs(wrapDelta(g.x - 10, W)) <= box.halfW - 40 + 1e-9);
        assert.ok(Math.abs(wrapDelta(g.y - 10, H)) <= box.halfH - 40 + 1e-9);
        assert.ok(g.x >= 0 && g.x < W && g.y >= 0 && g.y < H);
    }
    // Corners included: the furthest spot from a ship at the centre is near the box corner
    close(Math.abs(wrapDelta(grid[0].x - 10, W)), box.halfW - 40);
    close(Math.abs(wrapDelta(grid[15].y - 10, H)), box.halfH - 40);
});

test('unwrapTargets: continuous tracks, re-anchor on a big jump and on reappearing', () => {
    const tracks = new Map();
    let u = unwrapTargets(tracks, [{ id: 'a', x: 10, y: 10 }, { id: 'b', x: W - 10, y: 10 }], 0, 0, W, H);
    assert.deepEqual(u.map(t => t.ux), [10, -10]);
    // a flies right round the world in steps: its unwrapped x keeps growing
    let x = 10;
    for (let i = 0; i < 200; i++) {
        x = wrapW(x + 20, W);
        u = unwrapTargets(tracks, [{ id: 'a', x, y: 10 }, { id: 'b', x: W - 10, y: 10 }], 0, 0, W, H);
    }
    close(u[0].ux, 10 + 4000, 1e-6);
    close(u[1].ux, -10);
    // Hyperspace: a jump of more than a quarter world re-anchors near the reference
    u = unwrapTargets(tracks, [{ id: 'a', x: wrapW(x + W / 3, W), y: 10 }, { id: 'b', x: W - 10, y: 10 }], 4000, 0, W, H);
    close(u[0].ux, unwrapNear(wrapW(x + W / 3, W), 4000, W));
    assert.ok(Math.abs(u[0].ux - 4000) <= W / 2);
    // Gone for a frame (respawn): anchored afresh
    unwrapTargets(tracks, [{ id: 'b', x: W - 10, y: 10 }], 0, 0, W, H);
    assert.equal(tracks.has('a'), false);
    u = unwrapTargets(tracks, [{ id: 'a', x: 30, y: 10 }, { id: 'b', x: W - 10, y: 10 }], 0, 0, W, H);
    close(u[0].ux, 30);
});

test('continuous camera: no jump when ships drift past half a world apart (no leash)', () => {
    const cam = createCamera({ singleInstant: false });
    const a = { id: 'p1', x: W / 2, y: H / 2 }, b = { id: 'p2', x: W / 2, y: H / 2 };
    cam.reset(W / 2, H / 2, view);
    const dt = 1 / 60, speed = 300;
    let prev = cam.cx, maxStep = 0;
    // a flies right 3 laps of the world while b stays: the old camera flipped at half a world
    for (let i = 0; i < Math.ceil(3 * W / (speed * dt)); i++) {
        a.x = wrapW(a.x + speed * dt, W);
        cam.update([a, b], dt, view);
        maxStep = Math.max(maxStep, Math.abs(wrapDelta(cam.cx - prev, W)));
        prev = cam.cx;
        assert.ok(cam.cx >= 0 && cam.cx < W, `cx normalised ${cam.cx}`);
        assert.ok(cam.zoom >= 0.75 && cam.zoom <= 1);
    }
    assert.ok(maxStep <= speed * dt / 2 + 1e-6, `max step ${maxStep}`);
    // The centre went with a (half a's distance), not back and forth
    close(cam.tracks.get('p1').ux - cam.tracks.get('p2').ux, 3 * W, 1e-6);
    assert.equal(cam.zoom, 0.75);
});

test('continuous camera: one ship circling the world alone scrolls smoothly across the edge', () => {
    const cam = createCamera({ singleInstant: false });
    cam.reset(W - 50, H / 2, view);
    const s = { id: 'p1', x: W - 50, y: H / 2 };
    const dt = 1 / 60, speed = 500;
    let prev = cam.cx, maxStep = 0, parallax0 = cam.parallaxX;
    const frames = Math.ceil(2 * W / (speed * dt));
    for (let i = 0; i < frames; i++) {
        s.x = wrapW(s.x + speed * dt, W);
        cam.update([s], dt, view);
        maxStep = Math.max(maxStep, Math.abs(wrapDelta(cam.cx - prev, W)));
        prev = cam.cx;
        assert.ok(inView(cam, s.x, s.y, view));
    }
    assert.ok(maxStep <= speed * dt + 1e-6, `max step ${maxStep}`);
    assert.equal(cam.zoom, 1);
    // Starfield moved with the ship (smoothly, no world-sized jump)
    assert.ok(Math.abs(cam.parallaxX - parallax0 - frames * speed * dt) < 100, `parallax ${cam.parallaxX}`);
});

// Seeded random flight: ships steer randomly (speed <= vmax), wrap, and are leashed to the
// camera's box before each camera update, as in main.js.
function simulate({ seed, count, vmax, frames = 2000, dt = 1 / 60, soft = false }) {
    const rnd = mulberry32(seed);
    const cam = createCamera({ singleInstant: false });
    const ships = Array.from({ length: count }, (_, i) => {
        const a = rnd() * Math.PI * 2;
        return { id: `p${i}`, x: W / 2 + (i - (count - 1) / 2) * 60, y: H / 2, velX: Math.cos(a) * vmax, velY: Math.sin(a) * vmax, heading: a };
    });
    cam.reset(W / 2, H / 2, view);
    let prevX = cam.cx, prevY = cam.cy;
    const res = { maxStep: 0, outOfView: 0, pressed: 0, minZoom: 1, maxZoom: 0, maxSep: 0 };
    for (let f = 0; f < frames; f++) {
        for (const s of ships) {
            s.heading += (rnd() - 0.5) * 0.3;
            const sp = vmax * (0.5 + 0.5 * rnd());
            s.velX = Math.cos(s.heading) * sp;
            s.velY = Math.sin(s.heading) * sp;
            s.x = wrapW(s.x + s.velX * dt, W);
            s.y = wrapW(s.y + s.velY * dt, H);
        }
        const box = cam.leashBox(view);
        for (const s of ships) if (leashEntity(s, box, W, H, { soft, dt }).pressing) res.pressed++;
        cam.update(ships, dt, view);
        const step = Math.hypot(wrapDelta(cam.cx - prevX, W), wrapDelta(cam.cy - prevY, H));
        res.maxStep = Math.max(res.maxStep, Math.abs(wrapDelta(cam.cx - prevX, W)), Math.abs(wrapDelta(cam.cy - prevY, H)));
        res.maxStepEuclid = Math.max(res.maxStepEuclid || 0, step);
        prevX = cam.cx; prevY = cam.cy;
        for (const s of ships) if (!inView(cam, s.x, s.y, view)) res.outOfView++;
        res.minZoom = Math.min(res.minZoom, cam.zoom);
        res.maxZoom = Math.max(res.maxZoom, cam.zoom);
        for (const s of ships) for (const t of ships) {
            res.maxSep = Math.max(res.maxSep, Math.abs(cam.tracks.get(s.id).ux - cam.tracks.get(t.id).ux));
        }
    }
    return res;
}

for (const [count, seed] of [[2, 1], [2, 2], [3, 3], [4, 4]]) {
    test(`2000 random frames, ${count} ships, hard leash: no centre jump, everyone in view`, () => {
        const vmax = 900, dt = 1 / 60;
        const r = simulate({ seed, count, vmax, dt });
        assert.ok(r.maxStep <= vmax * dt + 1e-6, `max step ${r.maxStep} > ${vmax * dt}`);
        assert.equal(r.outOfView, 0);
        assert.ok(r.pressed > 0, 'the random flight reached the edge');
        assert.ok(r.minZoom >= 0.75 - 1e-12 && r.maxZoom <= 1);
        const box = leashBox(0, 0, view);
        assert.ok(r.maxSep <= 2 * box.halfW + vmax * dt + 1e-6, `separation ${r.maxSep}`);
    });
}

test('2000 random frames at 30 fps, 2 ships, soft leash: small steps, everyone in view', () => {
    const vmax = 700, dt = 1 / 30;
    const r = simulate({ seed: 9, count: 2, vmax, dt, soft: true });
    assert.ok(r.maxStep <= vmax * dt + 1e-6, `max step ${r.maxStep}`);
    assert.equal(r.outOfView, 0);
    assert.ok(r.pressed > 0);
});

test('continuous camera re-anchors after hyperspace and eases the zoom', () => {
    const cam = createCamera({ singleInstant: false });
    cam.reset(W / 2, H / 2, view);
    const a = { id: 'p1', x: W / 2 - 50, y: H / 2 }, b = { id: 'p2', x: W / 2 + 50, y: H / 2 };
    for (let i = 0; i < 60; i++) cam.update([a, b], 1 / 60, view);
    close(cam.cx, W / 2, 1e-6);
    // a hyperspaces into the leash box, 400 px right of the centre
    a.x = W / 2 + 400;
    const z0 = cam.zoom;
    cam.update([a, b], 1 / 60, view);
    close(cam.tracks.get('p1').ux, unwrapNear(W / 2 + 400, W / 2, W), 1e-9);
    assert.ok(Math.abs(cam.zoom - z0) < 0.1, `zoom popped ${z0} -> ${cam.zoom}`);
    for (let i = 0; i < 180; i++) cam.update([a, b], 1 / 60, view);
    close(cam.cx, W / 2 + 225, 1e-3);
    assert.ok(inView(cam, a.x, a.y, view) && inView(cam, b.x, b.y, view));
    // A landing across the world edge from the centre is anchored to the near image
    a.x = wrapW(cam.cx + 300, W); b.x = wrapW(cam.cx - 300, W);
    cam.update([a, b], 1 / 60, view);
    assert.ok(Math.abs(cam.tracks.get('p1').ux - cam.cx) < 320);
});

test('previewZoom frames extra points around the current centre', () => {
    const cam = createCamera({ singleInstant: false });
    cam.reset(W / 2, H / 2, view);
    const ships = [{ id: 'a', x: W / 2 - 100, y: H / 2 }, { id: 'b', x: W / 2 + 100, y: H / 2 }];
    cam.update(ships, 1 / 60, view);
    assert.equal(cam.previewZoom(ships, view), 1);
    const far = [...ships, { x: W / 2 + 500, y: H / 2 }];
    assert.ok(cam.previewZoom(far, view) < 1);
    const wrapped = [...ships, { x: wrapW(W / 2 - 500, W), y: H / 2 }];
    close(cam.previewZoom(wrapped, view), cam.previewZoom(far, view), 1e-9);
});

test('singleInstant camera ignores continuous mode for one target; continuous flag', () => {
    const single = createCamera();
    single.reset(100, 100, view);
    single.update([{ x: 120, y: 90 }], 1 / 60, view);
    assert.equal(single.continuous, false);
    assert.equal(single.cx, 120);
    const multi = createCamera({ singleInstant: false });
    multi.reset(100, 100, view);
    multi.update([{ id: 'p1', x: 120, y: 90 }], 1 / 60, view);
    assert.equal(multi.continuous, true);
    assert.ok(multi.cx > 100 && multi.cx < 120);
});
