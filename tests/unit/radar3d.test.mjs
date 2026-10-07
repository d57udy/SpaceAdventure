// Two-circle radar (js/3d/radar3d.js): projection, range filtering, threats, edge marker, layout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    RADAR, radarPoint, toLocal, buildRadar, isThreat, edgeMarker, onScreen, radarLayout, verticalFov,
} from '../../js/3d/radar3d.js';
import { qIdentity, qFromAxisAngle, DEG } from '../../js/3d/math3d.js';
import * as radar3d from '../../js/3d/radar3d.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const SIZE = 3200, RANGE = 1440;
const C = [1600, 1600, 1600]; // ship in the middle of the cube
const ship = (q = qIdentity(), vel = [0, 0, 0]) => ({ pos: C, q, vel });
const at = (dx, dy, dz) => [C[0] + dx, C[1] + dy, C[2] + dz];
let nid = 1;
const rock = (kind, pos, vel = [0, 0, 0], radius = 42) => ({ id: nid++, kind, pos, vel, radius });

test('dead ahead: front centre; 90° right: front rim on the right', () => {
    let p = radarPoint([0, 0, -500]);
    assert.deepEqual([p.hemi, p.x, p.y], ['front', 0, 0]);
    p = radarPoint([500, 0, 0]);
    assert.equal(p.hemi, 'front');
    assert.ok(near(p.x, 1) && near(p.y, 0));
    // 45° up: halfway to the rim, straight up
    p = radarPoint([0, 300, -300]);
    assert.equal(p.hemi, 'front');
    assert.ok(near(p.x, 0) && near(p.y, 0.5));
});

test('directly behind: rear centre; behind-right stays on the right (mirrored)', () => {
    let p = radarPoint([0, 0, 400]);
    assert.deepEqual([p.hemi, p.x, p.y], ['rear', 0, 0]);
    p = radarPoint([300, 0, 300]); // 45° off the tail, to the right
    assert.equal(p.hemi, 'rear');
    assert.ok(p.x > 0 && near(p.x, 0.5), `x ${p.x}`);
    p = radarPoint([-200, 100, 600]);
    assert.ok(p.x < 0 && p.y > 0, 'behind, left and up');
});

test('the ship frame: turning and rolling move the dots', () => {
    const target = at(0, 0, -800); // straight ahead in world terms
    // Ship yawed 90° left: the target is now on the right rim
    let local = toLocal(C, qFromAxisAngle([0, 1, 0], 90 * DEG), target, SIZE);
    let p = radarPoint(local);
    assert.ok(near(p.x, 1, 1e-6) && near(p.y, 0, 1e-6), JSON.stringify(p));
    // Ship rolled 90° (about its nose axis): an object above the ship (world up, ahead) moves sideways
    const above = at(0, 400, -400);
    p = radarPoint(toLocal(C, qIdentity(), above, SIZE));
    assert.ok(near(p.x, 0, 1e-6) && near(p.y, 0.5, 1e-6));
    const rolled = qFromAxisAngle([0, 0, 1], 90 * DEG); // ship's right axis now points to world up
    p = radarPoint(toLocal(C, rolled, above, SIZE));
    assert.ok(near(p.x, 0.5, 1e-6) && near(p.y, 0, 1e-6), JSON.stringify(p));
    // Across the wrap seam: the nearest image counts
    p = radarPoint(toLocal([10, 1600, 1600], qIdentity(), [3150, 1600, 1600], SIZE));
    assert.ok(near(p.x, -1, 1e-6), 'just left across the seam');
});

test('range: everything within the view distance; beyond it only the nearest 3 crystals, dimmed', () => {
    const rocks = [
        rock('red', at(0, 0, -300)),
        rock('green', at(0, 0, 500)),
        rock('red', at(0, 0, -1500)), // beyond the range: hidden
        ...[1600, 1700, 1800, 1900, 2000].map((d) => rock('green', at(d * 0.6, 0, -d * 0.8))), // all beyond
    ];
    const r = buildRadar(ship(), rocks, { size: SIZE, range: RANGE });
    const all = [...r.front, ...r.rear];
    assert.equal(r.front.filter((b) => !b.beyond).length, 1);
    assert.equal(r.rear.length, 1);
    assert.equal(r.rear[0].type, 'crystal');
    assert.ok(near(r.front[0].x, 0) && near(r.front[0].y, 0), 'rock ahead at the centre');
    assert.ok(near(r.front.find((b) => b.type === 'rock').near, 1 - 300 / RANGE));
    assert.ok(!all.some((b) => b.type === 'rock' && b.dist > RANGE), 'far rocks hidden');
    const beyond = all.filter((b) => b.beyond);
    assert.equal(beyond.length, RADAR.beyondCrystals);
    assert.deepEqual(beyond.map((b) => Math.round(b.dist)).sort((a, b) => a - b), [1600, 1700, 1800]);
    for (const b of beyond) {
        assert.equal(b.near, 0);
        assert.ok(near(Math.hypot(b.rimX, b.rimY), 1), 'rim tick');
    }
    // A cap on the number of blips
    const many = Array.from({ length: 400 }, (_, i) => rock('red', at((i % 20) * 30 - 300, Math.floor(i / 20) * 30 - 300, -200)));
    const m = buildRadar(ship(), many, { size: SIZE, range: RANGE });
    assert.equal(m.front.length + m.rear.length, RADAR.maxBlips);
});

test('threat: a red rock closing within 25 % of the view distance flashes; others do not', () => {
    const ahead = [0, 0, -300];
    assert.equal(isThreat(ahead, [0, 0, 80], 42, RANGE), true, 'coming straight at us');
    assert.equal(isThreat(ahead, [0, 0, -80], 42, RANGE), false, 'moving away');
    assert.equal(isThreat(ahead, [0, 0, 0], 42, RANGE), false, 'not moving');
    assert.equal(isThreat([0, 0, -500], [0, 0, 200], 42, RANGE), false, 'beyond 25 % (360)');
    assert.equal(isThreat([300, 0, -300], [0, 0, 80], 42, RANGE), false, 'passing well to the side');
    assert.equal(isThreat([0, 0, -300], [0, 0, 20], 42, RANGE), false, 'too slow: closest approach after 6 s');
    // Through buildRadar: the ship flying at a still rock
    const r = buildRadar(ship(qIdentity(), [0, 0, -150]), [rock('red', at(0, 0, -300)), rock('green', at(0, 0, -200))],
        { size: SIZE, range: RANGE });
    assert.equal(r.front.find((b) => b.type === 'rock').threat, true);
    assert.equal(r.front.find((b) => b.type === 'crystal').threat, false, 'crystals are never threats');
});

test('edge marker: nearest crystal outside the view, only when no crystal is on screen', () => {
    const aspect = 892 / 412;
    assert.ok(onScreen([0, 0, -100], aspect));
    assert.ok(!onScreen([0, 0, 100], aspect));
    assert.ok(!onScreen([100, 0, -10], aspect), 'far to the side');
    const behindRight = rock('green', at(300, 0, 400));
    const farLeft = rock('green', at(-900, 0, 900));
    let m = edgeMarker(ship(), [behindRight, farLeft, rock('red', at(0, 0, -100))], { size: SIZE, range: RANGE, aspect });
    assert.equal(m.id, behindRight.id);
    assert.ok(near(m.angle, 0), 'turn right');
    assert.ok(near(m.dist, 500));
    // A crystal on screen: no marker
    m = edgeMarker(ship(), [behindRight, rock('green', at(0, 0, -600))], { size: SIZE, range: RANGE, aspect });
    assert.equal(m, null);
    // On screen but beyond the view distance (fogged out) does not count
    m = edgeMarker(ship(), [rock('green', at(0, 0, -1500))], { size: SIZE, range: RANGE, aspect });
    assert.ok(m && m.dist > RANGE);
    // Straight behind: point down
    m = edgeMarker(ship(), [rock('green', at(0, 0, 500))], { size: SIZE, range: RANGE, aspect });
    assert.ok(near(m.angle, -Math.PI / 2));
    assert.equal(edgeMarker(ship(), [], { size: SIZE, range: RANGE, aspect }), null);
});

test('layout: stacked on the right edge, front on top, clear of the top bar and the right buttons', () => {
    const buttons = (w, h, roll) => [
        { x0: w - 200, x1: w - 116, y0: h - 100, y1: h - 16 },        // Thrust (Joystick mode)
        { x0: w - 100, x1: w - 16, y0: h - 100, y1: h - 16 },         // Fire
        ...(roll ? [
            { x0: w - 160, x1: w - 96, y0: h - 180, y1: h - 116 },    // roll buttons
            { x0: w - 80, x1: w - 16, y0: h - 180, y1: h - 116 },
        ] : []),
        { x0: w - 120, x1: w - 8, y0: 8, y1: 52 },                    // top bar (Pause)
    ];
    for (const roll of [false, true]) {
        for (const [w, h] of [[892, 412], [1280, 800], [412, 892], [740, 360], [915, 412]]) {
            const L = radarLayout(w, h, { rollButtons: roll });
            assert.ok(L.front.cy < L.rear.cy, 'front on top');
            assert.equal(L.front.cx, L.rear.cx, 'one column');
            assert.ok(L.front.cx > w * 0.75, `${w}x${h}: on the right`);
            assert.ok(L.rear.cy - L.front.cy >= 2 * L.r, 'circles do not overlap');
            for (const c of [L.front, L.rear]) {
                assert.ok(c.cy - L.r >= 0 && c.cx - L.r >= 0 && c.cx + L.r <= w, `${w}x${h}: on screen`);
                for (const b of buttons(w, h, roll)) {
                    const nx = Math.max(b.x0, Math.min(c.cx, b.x1)), ny = Math.max(b.y0, Math.min(c.cy, b.y1));
                    assert.ok(Math.hypot(c.cx - nx, c.cy - ny) > L.r, `${w}x${h} roll=${roll}: clear of a button`);
                }
            }
        }
    }
    assert.ok(radarLayout(1280, 800).r > radarLayout(892, 412).r, 'larger on desktop');
    const inset = radarLayout(892, 412, { insets: { top: 20, right: 30 } });
    assert.ok(inset.front.cx < radarLayout(892, 412).front.cx, 'respects the right inset');
    assert.ok(near(verticalFov(16 / 9), 2 * Math.atan(9 / 16) * 180 / Math.PI, 1e-9));
    assert.equal(verticalFov(0.46), 80, "tall screens capped");
});

test('last few rocks: every one on the radar at any distance, and an edge arrow for each off screen', () => {
    const { lastFew, remainingMarkers } = radar3d;
    assert.equal(lastFew(0), false);
    assert.equal(lastFew(RADAR.lastRocks), true);
    assert.equal(lastFew(RADAR.lastRocks + 1), false);
    const rocks = [
        rock('red', at(0, 0, -300)),       // in view
        rock('red', at(0, 0, 1500), [0, 0, 0], 13), // behind, beyond range
        rock('green', at(1500, 0, -200), [0, 0, 0], 16), // right, beyond range
    ];
    const plain = buildRadar(ship(), rocks, { size: SIZE, range: RANGE });
    assert.equal(plain.front.length + plain.rear.length, 2, 'normally: beyond-range reds are not shown');
    const all = buildRadar(ship(), rocks, { size: SIZE, range: RANGE, all: true });
    assert.equal(all.front.length + all.rear.length, 3);
    const behind = all.rear.find((b) => b.type === 'rock');
    assert.ok(behind && behind.last && !behind.beyond, 'shown at full strength');
    const m = remainingMarkers(ship(), rocks, { size: SIZE, range: RANGE, aspect: 16 / 9 });
    assert.deepEqual(m.map((x) => x.type).sort(), ['crystal', 'rock'], 'the one on screen needs no arrow');
    const right = m.find((x) => x.type === 'crystal');
    assert.ok(Math.abs(right.angle) < 0.2, 'turn right');
    assert.ok(right.dist > RANGE);
});

test('clusters beyond the view distance: a rim marker at the centre of their remaining rocks', () => {
    const { clusterCentres } = radar3d;
    const a = rock('red', at(0, 0, -2000)); a.cluster = 1;
    const b = rock('red', at(0, 100, -2000)); b.cluster = 1;
    const c = rock('red', at(0, 0, -400)); c.cluster = 2;
    const centres = clusterCentres(C, [a, b, c], 6000);
    assert.equal(centres.length, 2);
    const one = centres.find((x) => x.id === 1);
    assert.deepEqual(one.delta.map((v) => Math.round(v)), [0, 50, -2000]);
    assert.equal(one.count, 2);
    const r = buildRadar(ship(), [a, b, c], { size: 6000, range: RANGE, clusters: true });
    const marks = r.front.filter((x) => x.type === 'cluster');
    assert.equal(marks.length, 1, 'only the cluster beyond range');
    assert.equal(marks[0].id, 1);
    assert.equal(marks[0].beyond, true);
});
