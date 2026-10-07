import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPowerUps, POWERUP3D, TIMED_POWERUPS, POWERUP_TYPES, randomType, magnetAccel, shotDirections } from '../../js/3d/powerup3d.js';
import { mulberry32 } from '../../js/rng.js';
import { qIdentity, vDot, vLen, vAdd } from '../../js/3d/math3d.js';
import { nearestDelta } from '../../js/3d/world3d.js';

const SIZE = 3200, RANGE = 1440, C = [1600, 1600, 1600];
const make = (o = {}) => createPowerUps({ rand: mulberry32(o.seed ?? 1), size: SIZE, range: RANGE, ...o });
const ship = (pos = C) => ({ pos, alive: true, radius: 9 });

test('the 7 2D types, chances and durations', () => {
    assert.deepEqual(Object.keys(POWERUP_TYPES).sort(), ['extra_life', 'magnet', 'rapid_fire', 'score_multiplier', 'shield', 'speed_boost', 'triple_shot']);
    assert.equal(POWERUP_TYPES.shield.duration, 6);
    assert.equal(POWERUP_TYPES.score_multiplier.duration, 12);
    const rand = mulberry32(3);
    const n = 20000, count = {};
    for (let i = 0; i < n; i++) { const t = randomType(rand).id; count[t] = (count[t] || 0) + 1; }
    const expect = { extra_life: 0.05, shield: 0.1, triple_shot: 0.15, rapid_fire: 0.2, speed_boost: 0.2, magnet: 0.15, score_multiplier: 0.15 };
    for (const [k, p] of Object.entries(expect)) assert.ok(Math.abs(count[k] / n - p) < 0.012, `${k} ${count[k] / n}`);
});

test('30 % drop on a destroyed red or UFO; boss drops always', () => {
    const p = make({ seed: 9 });
    let drops = 0;
    for (let i = 0; i < 5000; i++) if (p.onDestroyed(C)) drops++;
    assert.ok(Math.abs(drops / 5000 - 0.3) < 0.02);
    const q = make();
    assert.ok(q.dropAt(C));
    assert.equal(q.dropAt(C, 'shield').type, 'shield');
    assert.equal(q.pickups.length, 2);
});

test('timed spawn every 20 s x powerUpSpawnMod, within the view distance, only while the ship is alive', () => {
    const p = make();
    let ev = [];
    for (let t = 0; t < 19.9; t += 0.1) ev.push(...p.update(0.1, { ship: ship() }));
    assert.equal(ev.filter(e => e.type === 'powerUpSpawn').length, 0);
    for (let t = 0; t < 0.3; t += 0.1) ev.push(...p.update(0.1, { ship: { ...ship(), pos: C } }));
    const sp = ev.filter(e => e.type === 'powerUpSpawn');
    assert.equal(sp.length, 1);
    const d = vLen(nearestDelta(C, p.pickups[0].pos, SIZE));
    assert.ok(d >= RANGE * 0.3 - 1e-6 && d <= RANGE * 0.7 + 1e-6);
    const fast = make({ dda: { powerUpSpawnMod: 0.5 } });
    assert.equal(fast.state.timer, 10);
    const dead = make();
    for (let t = 0; t < 30; t += 0.1) dead.update(0.1, { ship: { pos: C, alive: false } });
    assert.equal(dead.pickups.length, 0);
});

test('pickup by the ship sphere; lifetime 15 s with a 3 s blink', () => {
    const p = make();
    const near = p.dropAt(vAdd(C, [0, 0, -(9 + POWERUP3D.radius + POWERUP3D.pickupBonus - 1)]), 'rapid_fire');
    const far = p.dropAt(vAdd(C, [0, 0, -300]), 'magnet');
    const ev = p.update(0.01, { ship: ship() });
    const got = ev.find(e => e.type === 'powerUp');
    assert.equal(got.id, near.id);
    assert.equal(got.kind, 'rapid_fire');
    assert.ok(Math.abs(got.seconds - 8) < 1e-9);
    assert.equal(p.active('rapid_fire'), true);
    assert.equal(p.pickups.length, 1);
    for (let t = 0; t < 12.5; t += 0.5) p.update(0.5, { ship: { pos: [100, 100, 100], alive: true } });
    assert.equal(p.blinking(far), true);
    const ev2 = [];
    for (let t = 0; t < 3; t += 0.5) ev2.push(...p.update(0.5, { ship: { pos: [100, 100, 100], alive: true } }));
    assert.ok(ev2.some(e => e.type === 'powerUpExpired' && e.id === far.id));
});

test('effects: durations x upgrade, end events, factors', () => {
    const p = make({ durationMult: 1.4 });
    assert.ok(Math.abs(p.activate('magnet').seconds - 14) < 1e-9);
    assert.deepEqual(p.activate('extra_life'), { type: 'extra_life', extraLife: true, seconds: 0 });
    assert.equal(p.activate('nope').seconds, 0);
    assert.equal(p.fireIntervalMult(), 1);
    p.activate('rapid_fire'); p.activate('speed_boost'); p.activate('score_multiplier');
    assert.equal(p.fireIntervalMult(), 0.4);
    assert.equal(p.speedMult(), 1.6);
    assert.equal(p.scoreMult(), 2);
    const ev = [];
    for (let t = 0; t < 12; t += 0.5) ev.push(...p.update(0.5, {}));
    assert.ok(ev.some(e => e.type === 'effectEnd' && e.kind === 'rapid_fire'));
    assert.equal(p.speedMult(), 1);
    assert.equal(p.scoreMult(), 2, '2x lasts 12 s x 1.4 = 16.8 s');
    for (let t = 0; t < 5; t += 0.5) p.update(0.5, {});
    assert.equal(p.scoreMult(), 1);
});

test('shield absorbs exactly one hit', () => {
    const p = make();
    assert.equal(p.consumeShield(), false);
    p.activate('shield');
    assert.equal(p.consumeShield(), true);
    assert.equal(p.consumeShield(), false);
    assert.equal(p.active('shield'), false);
});

test('triple shot: 3 bullets 3 degrees apart', () => {
    assert.equal(shotDirections(qIdentity()).length, 1);
    const d = shotDirections(qIdentity(), true);
    assert.equal(d.length, 3);
    for (const v of d.slice(1)) assert.ok(Math.abs(Math.acos(vDot(v, d[0])) - 3 * Math.PI / 180) < 1e-9);
    const p = make();
    assert.equal(p.shotDirections(qIdentity()).length, 1);
    p.activate('triple_shot');
    assert.equal(p.shotDirections(qIdentity()).length, 3);
});

test('magnet: the 2D pull scaled to the view distance; pulls greens only', () => {
    const S = RANGE / 720;
    assert.equal(magnetAccel(10, RANGE), 0, 'inside the minimum');
    assert.equal(magnetAccel(300 * S + 1, RANGE), 0, 'outside the radius');
    assert.ok(Math.abs(magnetAccel(200, RANGE) - 100 * S * S / 200) < 1e-12);
    const p = make();
    p.activate('magnet');
    const green = { kind: 'green', pos: vAdd(C, [0, 0, -200]), vel: [0, 0, 0] };
    const red = { kind: 'red', pos: vAdd(C, [0, 0, -200]), vel: [0, 0, 0] };
    p.update(1, { ship: ship(), rocks: [green, red] });
    assert.ok(green.vel[2] > 0, 'toward the ship');
    assert.deepEqual(red.vel, [0, 0, 0]);
});

test('reset and clearPickups; seeded runs repeat', () => {
    const p = make();
    p.dropAt(C); p.activate('shield');
    p.clearPickups();
    assert.equal(p.pickups.length, 0);
    assert.equal(p.active('shield'), true, 'effects stay on a new level');
    p.reset();
    for (const k of TIMED_POWERUPS) assert.equal(p.effects[k], 0);
    const run = (seed) => { const x = make({ seed }); for (let i = 0; i < 100; i++) { x.onDestroyed(C); x.update(0.5, { ship: ship([10, 10, 10]) }); } return JSON.stringify(x.snapshot()); };
    assert.equal(run(4), run(4));
});
