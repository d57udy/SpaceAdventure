import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, stepSim, drainEvents, simCounts, SIM, nextId } from '../../js/3d/sim3d.js';
import { makeRock, WORLD, worldFor, wrappedDistance } from '../../js/3d/world3d.js';
import { qIdentity, qFromAxisAngle, vLen } from '../../js/3d/math3d.js';

const run = (s, input, seconds) => { for (let i = 0; i < Math.round(seconds * 60); i++) stepSim(s, input); };

test('seeded: same seed gives the same layout and the same run', () => {
    const a = createSim({ seed: 5 }), b = createSim({ seed: 5 });
    assert.deepEqual(a.rocks.map((r) => r.pos), b.rocks.map((r) => r.pos));
    const input = { q: qFromAxisAngle([0, 1, 0], 0.3), thrust: true, fire: true };
    run(a, input, 3); run(b, input, 3);
    assert.deepEqual(a.ship.pos, b.ship.pos);
    assert.equal(a.score, b.score);
    assert.deepEqual(simCounts(a), simCounts(b));
    assert.notDeepEqual(createSim({ seed: 6 }).rocks[0].pos, a.rocks[0].pos);
    const c = simCounts(createSim({ seed: 1 }));
    assert.equal(c.green, WORLD.greens);
    assert.equal(c.red, WORLD.reds);
});

test('thrust moves the ship along its nose; drag slows it', () => {
    const s = createSim({ field: false });
    const start = s.ship.pos.slice();
    run(s, { q: qIdentity(), thrust: true }, 1);
    assert.ok(s.ship.vel[2] < -100, 'moving along -Z');
    assert.ok(s.ship.pos[2] < start[2] - 50);
    const v = vLen(s.ship.vel);
    run(s, { q: qIdentity() }, 1);
    assert.ok(vLen(s.ship.vel) < v);
    run(s, { q: qIdentity(), thrust: true }, 5);
    assert.ok(vLen(s.ship.vel) <= SIM.maxSpeed + 1e-9);
});

test('fly into a green crystal: collected, score up', () => {
    const s = createSim({ field: false });
    const [x, y, z] = s.ship.pos;
    s.rocks.push(makeRock({ id: nextId(s), kind: 'green', pos: [x, y, z - 120], rand: s.rand }));
    run(s, { q: qIdentity(), thrust: true }, 2);
    assert.equal(simCounts(s).green, 0);
    assert.equal(s.score, SIM.greenScore);
    assert.equal(s.stats.collected, 1);
    assert.ok(drainEvents(s).some((e) => e.type === 'collect'));
});

test('shoot a red: it splits into two, then the pieces into small ones', () => {
    const s = createSim({ field: false });
    const [x, y, z] = s.ship.pos;
    s.rocks.push(makeRock({ id: nextId(s), kind: 'red', size: 'large', pos: [x, y, z - 300], rand: s.rand }));
    s.ship.invulnerable = 99;
    // One shot
    stepSim(s, { q: qIdentity(), fire: true });
    assert.equal(simCounts(s).bullets, 1);
    run(s, { q: qIdentity() }, 0.5);
    const c = simCounts(s);
    assert.equal(c.red, 2, 'large → 2 medium');
    assert.ok(s.rocks.every((r) => r.size === 'medium'));
    assert.equal(s.score, 20);
    assert.equal(c.bullets, 0, 'the bullet is used up');
    const ev = drainEvents(s);
    assert.ok(ev.some((e) => e.type === 'split' && e.size === 'large' && e.pieces === 2));
});

test('collide with a red: lose a life, short invulnerability, then game over', () => {
    const s = createSim({ field: false });
    const place = () => {
        const [x, y, z] = s.ship.pos;
        s.rocks.push(makeRock({ id: nextId(s), kind: 'red', size: 'small', pos: [x, y, z - 5], rand: s.rand }));
    };
    place();
    stepSim(s, { q: qIdentity() });
    assert.equal(s.lives, SIM.lives - 1);
    assert.ok(s.ship.invulnerable > 0);
    assert.ok(drainEvents(s).some((e) => e.type === 'hit'));
    place();
    stepSim(s, { q: qIdentity() });
    assert.equal(s.lives, SIM.lives - 1, 'invulnerable right after a hit');
    s.rocks.length = 0;
    for (let i = s.lives; i > 0; i--) {
        s.ship.invulnerable = 0;
        place();
        stepSim(s, { q: qIdentity() });
    }
    assert.equal(s.lives, 0);
    assert.equal(s.over, true);
    assert.ok(drainEvents(s).some((e) => e.type === 'gameover'));
    const pos = s.ship.pos.slice();
    run(s, { q: qIdentity(), thrust: true, fire: true }, 1);
    assert.deepEqual(s.ship.pos, pos, 'no control after game over');
});

test('a seeded 30 s run keeps the field populated', () => {
    const s = createSim({ seed: 11 });
    let q = qIdentity();
    for (let i = 0; i < 30 * 60; i++) {
        if (i % 120 === 0) q = qFromAxisAngle([Math.sin(i), 1, Math.cos(i)], i * 0.01);
        stepSim(s, { q, thrust: i % 3 === 0, fire: true });
        drainEvents(s);
    }
    const c = simCounts(s);
    assert.ok(c.green >= SIM.minGreens && c.red >= SIM.minReds, JSON.stringify(c));
    assert.ok(s.stats.shots > 100);
});

test('view distance presets: world size, field, bullet range and out-of-sight refills', () => {
    for (const view of ['normal', 'far', 'veryfar']) {
        const w = worldFor(view);
        const s = createSim({ seed: 3, view });
        assert.equal(s.size, w.size, view);
        assert.equal(s.world.name, view);
        const c = simCounts(s);
        assert.equal(c.green, w.greens, view);
        assert.equal(c.red, w.reds, view);
        for (const r of s.rocks) for (const v of r.pos) assert.ok(v >= 0 && v < w.size);
        // A bullet lives long enough to reach the fog end
        stepSim(s, { q: qIdentity(), fire: true });
        assert.ok(Math.abs(s.bullets[0].life - (w.bulletLife - SIM.dt)) < 1e-9, view);
    }
    // Refills: drop below the minimum and new rocks appear beyond the cull distance
    const s = createSim({ seed: 4, view: 'far' });
    const keep = s.rocks.filter((r) => r.kind === 'red');
    s.rocks = keep;
    const before = new Set(s.rocks.map((r) => r.id));
    stepSim(s, { q: qIdentity() });
    const fresh = s.rocks.filter((r) => !before.has(r.id));
    assert.ok(fresh.length >= 1);
    for (const r of fresh) assert.ok(wrappedDistance(s.ship.pos, r.pos, s.size) >= s.world.refillClearance, 'out of sight');
});
