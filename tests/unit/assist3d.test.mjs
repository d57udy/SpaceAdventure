// The 3D aids that follow the adaptive difficulty level (js/3d/assist3d.js, plan 07 §2.9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    ASSIST3D, ASSIST_LEVELS, assistFor, isTarget, interceptTime, aimPoint, aimAssist, crosshairTarget, leadPoint,
    projectLocal, crystalArrowOptions, TARGET3D,
} from '../../js/3d/assist3d.js';
import { edgeMarker } from '../../js/3d/radar3d.js';
import { qIdentity, qFromAxisAngle, vLen, vDot, vNorm, DEG } from '../../js/3d/math3d.js';

const SIZE = 3200;
const C = [1600, 1600, 1600];
const rock = (id, pos, o = {}) => ({ id, kind: 'red', pos, vel: [0, 0, 0], radius: 20, ...o });
/** A point `dist` ahead of C, `deg` degrees to the right. */
const off = (deg, dist = 500) => [C[0] + Math.sin(deg * DEG) * dist, C[1], C[2] - Math.cos(deg * DEG) * dist];
const angle = (a, b) => Math.acos(Math.min(1, vDot(vNorm(a), vNorm(b)))) / DEG;

test('the table of plan 07 §2.9', () => {
    assert.deepEqual(ASSIST_LEVELS, ['assisting', 'balanced', 'challenging']);
    assert.deepEqual(ASSIST_LEVELS.map((l) => ASSIST3D[l].aimDeg), [4, 2, 0]);
    assert.deepEqual(ASSIST_LEVELS.map((l) => ASSIST3D[l].lead), [true, true, false]);
    assert.deepEqual(ASSIST_LEVELS.map((l) => ASSIST3D[l].crystalArrow), ['always', 'offscreen', 'last']);
    assert.deepEqual(ASSIST_LEVELS.map((l) => ASSIST3D[l].threatTone), [true, true, false]);
    assert.deepEqual(ASSIST_LEVELS.map((l) => ASSIST3D[l].threatVibrate), [true, true, false]);
    assert.deepEqual(ASSIST_LEVELS.map((l) => ASSIST3D[l].pickupBonus), [0.5, 0, 0]);
    assert.equal(assistFor('nonsense'), ASSIST3D.balanced);
    assert.equal(assistFor('assisting').level, 'assisting');
});

test('targets: red rocks and hostile UFOs, never crystals', () => {
    assert.equal(isTarget(rock(1, C)), true);
    assert.equal(isTarget({ kind: 'green', pos: C }), false);
    assert.equal(isTarget({ kind: 'ufo', pos: C }), true);
    assert.equal(isTarget({ kind: 'ufo', pos: C, friendly: true }), false);
    assert.equal(isTarget({ kind: 'ufo', pos: C, alive: false }), false);
    assert.equal(isTarget(null), false);
});

test('intercept time: still, crossing and unreachable targets', () => {
    assert.ok(Math.abs(interceptTime([0, 0, -900], [0, 0, 0], 900) - 1) < 1e-9);
    // Crossing at 100/s 900 ahead: the meeting point is where both arrive together
    const d = [0, 0, -900], v = [100, 0, 0];
    const t = interceptTime(d, v, 900);
    const p = aimPoint(d, v, 900);
    assert.ok(Math.abs(vLen(p) - 900 * t) < 1e-6);
    assert.ok(p[0] > 0, 'aims ahead of it');
    // Faster than the bullet and moving away: never reached
    assert.equal(interceptTime([0, 0, -100], [0, 0, -2000], 900), null);
});

test('aim assist bends a shot toward a target within the angle, never beyond', () => {
    const dir = [0, 0, -1];
    const base = { from: C, dir, size: SIZE, range: 900, bulletSpeed: 900 };
    const near = aimAssist({ ...base, targets: [rock(1, off(3))], maxAngle: 4 * DEG });
    assert.equal(near.id, 1);
    assert.ok(Math.abs(angle(near.dir, dir) - 3) < 1e-6, 'corrected onto the target');
    assert.equal(aimAssist({ ...base, targets: [rock(1, off(3))], maxAngle: 2 * DEG }).id, null, 'outside 2°');
    assert.equal(aimAssist({ ...base, targets: [rock(1, off(1))], maxAngle: 0 }).id, null, 'Challenging: off');
    // The best (smallest correction) of several; crystals and targets out of range ignored
    const many = aimAssist({
        ...base, maxAngle: 4 * DEG,
        targets: [rock(1, off(3.5)), rock(2, off(1.5)), { id: 3, kind: 'green', pos: off(0.5), radius: 16 }, rock(4, off(0.2, 2000))],
    });
    assert.equal(many.id, 2);
    assert.ok(many.angle <= 4 * DEG);
    // A moving target: the shot goes to the intercept point (ahead of it)
    const mover = aimAssist({ ...base, targets: [rock(5, off(0), { vel: [60, 0, 0] })], maxAngle: 4 * DEG });
    assert.equal(mover.id, 5);
    assert.ok(mover.dir[0] > 0);
    // Behind the ship: never
    assert.equal(aimAssist({ ...base, targets: [rock(6, [C[0], C[1], C[2] + 300])], maxAngle: 4 * DEG }).id, null);
});

test('crosshair target: nearest to the nose within 12° and the view distance; lead only when moving', () => {
    const ship = { pos: C, q: qIdentity(), vel: [0, 0, 0] };
    const o = { size: SIZE, range: 1400 };
    assert.equal(crosshairTarget(ship, [rock(1, off(20))], o), null);
    const t = crosshairTarget(ship, [rock(1, off(8)), rock(2, off(3, 800)), { id: 3, kind: 'green', pos: off(0) }], o);
    assert.equal(t.id, 2);
    assert.ok(Math.abs(t.angle / DEG - 3) < 1e-6);
    assert.ok(t.local[2] < 0, 'in front, ship frame');
    assert.equal(leadPoint(t, 900), null, 'a still target has no lead marker');
    const m = crosshairTarget(ship, [rock(4, off(0), { vel: [80, 0, 0] })], o);
    const lp = leadPoint(m, 900);
    assert.ok(lp && lp[0] > 0, 'lead in front of its motion');
    // The ship turned 90° left: the same rock is now off to the right, out of the bracket cone
    const turned = { ...ship, q: qFromAxisAngle([0, 1, 0], 90 * DEG) };
    assert.equal(crosshairTarget(turned, [rock(1, off(0))], o), null);
    assert.equal(TARGET3D.bracketDeg, 12);
});

test('projection: straight ahead is the screen centre, right is right, up is up, behind is null', () => {
    const c = projectLocal([0, 0, -100], 800, 400);
    assert.deepEqual([c.x, c.y], [400, 200]);
    const r = projectLocal([10, 10, -100], 800, 400);
    assert.ok(r.x > 400 && r.y < 200);
    assert.ok(projectLocal([0, 0, -50], 800, 400).scale > c.scale, 'nearer is bigger');
    assert.equal(projectLocal([0, 0, 10], 800, 400), null);
});

test('crystal arrow by level; Assisting points at the nearest crystal even with another one in view', () => {
    assert.deepEqual(crystalArrowOptions(ASSIST3D.assisting, false), { always: true });
    assert.deepEqual(crystalArrowOptions(ASSIST3D.balanced, false), { always: false });
    assert.equal(crystalArrowOptions(ASSIST3D.challenging, false), null);
    assert.equal(crystalArrowOptions(ASSIST3D.assisting, true), null, 'last few: their own arrows');
    const ship = { pos: C, q: qIdentity() };
    const rocks = [
        { id: 1, kind: 'green', pos: off(0, 900) },                 // in view, far
        { id: 2, kind: 'green', pos: [C[0], C[1], C[2] + 200] },    // behind, nearest
    ];
    const o = { size: SIZE, range: 1400, aspect: 2 };
    assert.equal(edgeMarker(ship, rocks, o), null, 'Balanced: a crystal is on screen');
    assert.equal(edgeMarker(ship, rocks, { ...o, always: true }).id, 2);
    assert.equal(edgeMarker(ship, [rocks[0]], { ...o, always: true }), null, 'the nearest is in view');
});
