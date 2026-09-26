import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    BUMP, bumpShips, bumpPairKey, tickBumpCooldowns, countField, planFieldRefill, findFieldSpawn, versusStartPoint,
    modeOption, formatOption, cycleValue, roundOptionsFor, roundClock, TIMER_FLASH_SECONDS,
} from '../../js/versus.js';
import { MODES } from '../../js/modes.js';
import { wrapDelta } from '../../js/utils.js';

const W = 1080;
const H = 1080;
const ship = (x, y, velX = 0, velY = 0) => ({ x, y, velX, velY, radius: 15 });
const momentum = (r) => ({ x: r.a.velX + r.b.velX, y: r.a.velY + r.b.velY });
const energy = (r) => (r.a.velX ** 2 + r.a.velY ** 2 + r.b.velX ** 2 + r.b.velY ** 2) / 2;

test('bump: ships apart do not bump', () => {
    assert.equal(bumpShips(ship(100, 100), ship(131, 100), W, H), null);
    assert.equal(bumpShips(ship(100, 100), ship(130, 100), W, H), null); // exactly touching
});

test('bump: head-on keeps momentum, reverses with restitution 0.9 and separates the ships', () => {
    const a = ship(100, 100, 100, 0);
    const b = ship(125, 100, -100, 0);
    const r = bumpShips(a, b, W, H);
    assert.ok(r);
    assert.equal(BUMP.restitution, 0.9);
    assert.ok(Math.abs(momentum(r).x) < 1e-9 && Math.abs(momentum(r).y) < 1e-9);
    assert.ok(Math.abs(r.a.velX - -90) < 1e-9, `a.velX ${r.a.velX}`);
    assert.ok(Math.abs(r.b.velX - 90) < 1e-9);
    // Energy after = e² × before for a head-on bump of equal masses
    assert.ok(Math.abs(energy(r) - 0.81 * 10000) < 1e-6);
    assert.ok(Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y) >= 30);
    // Inputs untouched
    assert.equal(a.velX, 100);
    assert.equal(b.x, 125);
});

test('bump: one moving ship hits a still one (1D): velocities nearly swap', () => {
    const r = bumpShips(ship(100, 100, 200, 0), ship(128, 100), W, H);
    assert.ok(Math.abs(r.a.velX - 10) < 1e-9); // 200 × (1 - 0.9) / 2
    assert.ok(Math.abs(r.b.velX - 190) < 1e-9);
    assert.ok(Math.abs(r.a.velY) < 1e-9 && Math.abs(r.b.velY) < 1e-9);
});

test('bump: glancing hit only changes the velocity along the normal', () => {
    const r = bumpShips(ship(100, 100, 0, 100), ship(120, 120), W, H);
    const n = Math.SQRT1_2;
    // Tangential component (along (1,-1)/√2) of each ship unchanged
    const tan = (v) => (v.velX - v.velY) * n;
    assert.ok(Math.abs(tan(r.a) - tan({ velX: 0, velY: 100 })) < 1e-9);
    assert.ok(Math.abs(tan(r.b)) < 1e-9);
    assert.ok(Math.abs(momentum(r).y - 100) < 1e-9 && Math.abs(momentum(r).x) < 1e-9);
});

test('bump: wrap-aware across the world edge', () => {
    const r = bumpShips(ship(5, 500, -100, 0), ship(W - 10, 500, 0, 0), W, H);
    assert.ok(r, 'ships 15 px apart across the edge touch');
    // a (moving left) hits b just across the left edge: b takes almost all of a's speed
    assert.ok(Math.abs(r.a.velX - -5) < 1e-9 && Math.abs(r.b.velX - -95) < 1e-9, `${r.a.velX} ${r.b.velX}`);
    assert.ok(Math.abs(wrapDelta(r.b.x - r.a.x, W)) >= 30);
    for (const v of [r.a.x, r.b.x]) assert.ok(v >= 0 && v < W);
});

test('bump: overlapping ships that are not closing (a jump) are pushed apart', () => {
    const r = bumpShips(ship(200, 200), ship(210, 200), W, H);
    assert.ok(r);
    assert.ok(r.b.velX - r.a.velX >= 2 * BUMP.minPushSpeed - 1e-9);
    const same = bumpShips(ship(200, 200), ship(200, 200), W, H);
    assert.ok(same && same.b.velX > same.a.velX, 'exactly on top: pushed along x');
});

test('bump cooldown: per pair key, order independent, expires', () => {
    assert.equal(bumpPairKey('p2', 'p1'), bumpPairKey('p1', 'p2'));
    const m = new Map([[bumpPairKey('p1', 'p2'), BUMP.cooldown]]);
    assert.equal(BUMP.cooldown, 0.25);
    tickBumpCooldowns(m, 0.2);
    assert.ok(m.has('p1|p2'));
    tickBumpCooldowns(m, 0.06);
    assert.equal(m.size, 0);
});

test('field refill planner: tops greens and reds up to the targets', () => {
    const field = { greens: 12, reds: 6 };
    const a = (type, isAlive = true) => ({ type, isAlive });
    const list = [a('green'), a('green'), a('red'), a('green', false), { type: 'red', isAlive: true, materialising: true }];
    assert.deepEqual(countField(list), { greens: 2, reds: 2 });
    assert.deepEqual(planFieldRefill(countField(list), field), { greens: 10, reds: 4 });
    assert.deepEqual(planFieldRefill({ greens: 15, reds: 6 }, field), { greens: 0, reds: 0 });
    assert.deepEqual(planFieldRefill({ greens: 0, reds: 0 }, field, 5), { greens: 5, reds: 0 });
    assert.deepEqual(planFieldRefill({ greens: 10, reds: 0 }, field, 5), { greens: 2, reds: 3 });
});

test('field spawn: at least the minimum distance from every ship, wrap-aware; null when impossible', () => {
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const ships = [{ x: 10, y: 10 }, { x: 540, y: 540 }];
    for (let i = 0; i < 200; i++) {
        const p = findFieldSpawn(ships, W, H, 250, rand);
        assert.ok(p);
        for (const s of ships) assert.ok(Math.hypot(wrapDelta(p.x - s.x, W), wrapDelta(p.y - s.y, H)) >= 250);
    }
    assert.equal(findFieldSpawn([{ x: 540, y: 540 }], W, H, 2000, rand), null);
});

test('versus start points: side by side, 0.3 world apart', () => {
    const a = versusStartPoint(0, 2, W, H);
    const b = versusStartPoint(1, 2, W, H);
    assert.equal(a.y, H / 2);
    assert.ok(Math.abs(b.x - a.x - 0.3 * W) < 1e-9);
    assert.ok(Math.abs((a.x + b.x) / 2 - W / 2) < 1e-9);
});

test('lobby options: Harvest round length, Duel kill target, others none', () => {
    const h = modeOption(MODES.harvest);
    assert.deepEqual(h, { key: 'roundSeconds', label: 'Round', values: [120, 180, 300], default: 180 });
    assert.equal(formatOption(h, 120), '2:00');
    const d = modeOption(MODES.duel);
    assert.deepEqual(d, { key: 'target', label: 'First to', values: [3, 5, 7, 10], default: 5 });
    assert.equal(formatOption(d, 7), '7 kills');
    assert.equal(modeOption(MODES.coop), null);
    assert.equal(modeOption(MODES.turns), null);
    assert.equal(cycleValue([120, 180, 300], 300, 1), 120);
    assert.equal(cycleValue([120, 180, 300], 120, -1), 300);
    assert.equal(cycleValue([3, 5], 9, 1), 3);
    assert.deepEqual(roundOptionsFor(MODES.harvest), { roundSeconds: 180 });
    assert.deepEqual(roundOptionsFor(MODES.harvest, { roundSeconds: 300 }), { roundSeconds: 300 });
    assert.deepEqual(roundOptionsFor(MODES.duel, { target: 11 }), { target: 5 });
    assert.deepEqual(roundOptionsFor(MODES.coop, { target: 3 }), {});
});

test('round clock: flashes in the last 10 s, overtime and sudden death', () => {
    assert.equal(roundClock(null), null);
    assert.equal(roundClock({ timeLeft: null, phase: 'normal' }), null);
    assert.deepEqual(roundClock({ timeLeft: 125.2, phase: 'normal' }, 0), { text: '2:06', label: null, urgent: false, flash: false });
    assert.equal(TIMER_FLASH_SECONDS, 10);
    const on = roundClock({ timeLeft: 9.5, phase: 'normal' }, 0.1);
    const off = roundClock({ timeLeft: 9.5, phase: 'normal' }, 0.6);
    assert.equal(on.urgent && on.flash, true);
    assert.equal(off.urgent && !off.flash, true);
    assert.equal(roundClock({ timeLeft: 0, phase: 'overtime', overtimeLeft: 14.2 }).text, '0:15');
    assert.equal(roundClock({ timeLeft: 0, phase: 'overtime', overtimeLeft: 14.2 }).label, 'OVERTIME');
    assert.equal(roundClock({ timeLeft: 0, phase: 'suddenDeath' }).text, 'SUDDEN DEATH');
});
