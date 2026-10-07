import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createUfoSystem, aimCone3d, hitChance2d, randomInCone, ufoInterval, ufoAccuracy, scaleFor, UFO3D,
} from '../../js/3d/ufo3d.js';
import { mulberry32 } from '../../js/rng.js';
import { vLen, vDot, vSub, vCross, vNorm, vScale, vAdd } from '../../js/3d/math3d.js';
import { nearestDelta } from '../../js/3d/world3d.js';
import { Difficulty } from '../../js/difficulty.js';

const SIZE = 3200;
const RANGE = 1440;
const CENTRE = [1600, 1600, 1600];

function sys(opts = {}) {
    return createUfoSystem({ rand: mulberry32(opts.seed ?? 7), size: SIZE, range: RANGE, ...opts });
}
function step(s, seconds, world, dt = 1 / 60) {
    const events = [];
    for (let t = 0; t < seconds - 1e-9; t += dt) events.push(...s.update(dt, world));
    return events;
}

test('2D rules: interval, accuracy, scale', () => {
    assert.equal(ufoInterval({ spawnMultiplier: 1, spawnMod: 1, level: 1 }), 15 * 0.95);
    assert.equal(ufoInterval({ spawnMultiplier: 1.5, spawnMod: 2, level: 20 }), 15 * 1.5 * 2 * 0.5, 'level factor floors at 0.5');
    assert.equal(ufoAccuracy(0.8, 1.3), 1);
    assert.equal(ufoAccuracy(0.8, 0.5), 0.4);
    assert.equal(scaleFor(720), 1);
    assert.equal(scaleFor(1440), 2);
    assert.equal(UFO3D.speed, 100);
    assert.equal(UFO3D.score, 200);
    assert.equal(UFO3D.bulletSpeed, 350);
});

test('spawn: one at a time, after the 2D interval, at the edge of the view, path within half the view distance', () => {
    const s = sys({ difficulty: 'medium', level: 1 });
    const first = s.state.spawnTimer;
    const base = ufoInterval({ spawnMultiplier: 1, spawnMod: 1, level: 1 });
    assert.ok(first >= base * 0.75 - 1e-9 && first <= base * 1.25 + 1e-9);
    const ship = { pos: CENTRE, alive: true };
    const ev = step(s, first + 0.05, { ship });
    assert.equal(ev.filter(e => e.type === 'ufoSpawn').length, 1);
    assert.equal(s.ufos.length, 1);
    const u = s.ufos[0];
    assert.ok(Math.abs(vLen(u.vel) - 100) < 1e-6, 'speed 100');
    // Closest approach of the straight line to the ship
    const d = nearestDelta(u.pos, CENTRE, SIZE);
    const dir = vNorm(u.vel);
    const along = vDot(d, dir);
    assert.ok(along > 0, 'heading toward the ship side');
    const perp = vLen(vSub(d, vScale(dir, along)));
    assert.ok(perp <= RANGE * 0.5 + 1e-6, `passes within half the view distance (${perp.toFixed(0)})`);
    // No second one while it is there
    step(s, 40, { ship });
    assert.ok(s.ufos.length <= 1);
});

test('spawn positions: every UFO starts at the view distance', () => {
    for (let seed = 1; seed <= 20; seed++) {
        const s = sys({ seed });
        step(s, 25, { ship: { pos: CENTRE, alive: false } });
        assert.equal(s.ufos.length, 0, 'no UFO while the ship waits to respawn');
        step(s, 25, { ship: { pos: CENTRE, alive: true } });
        assert.equal(s.ufos.length, 1);
        // It moved a bit since spawning; it started at RANGE
        const d = vLen(nearestDelta(CENTRE, s.ufos[0].pos, SIZE));
        assert.ok(d <= RANGE + 100 * 25 + 1);
    }
});

test('difficulty and adaptive modifiers change the timing', () => {
    const avg = (opts) => {
        let sum = 0;
        for (let seed = 1; seed <= 200; seed++) sum += sys({ seed, ...opts }).state.spawnTimer;
        return sum / 200;
    };
    const easy = avg({ difficulty: 'easy' });
    const hard = avg({ difficulty: 'hard' });
    assert.ok(easy > hard * 1.8, `${easy} vs ${hard}`);
    assert.ok(avg({ dda: { ufoSpawnMod: 2 } }) > avg({}) * 1.8);
    assert.ok(avg({ level: 10 }) < avg({ level: 1 }) * 0.6);
    assert.equal(sys({ difficulty: Difficulty.HARD }).state.difficulty, Difficulty.HARD);
});

test('firing: 2D timing, only within the view distance, bullets at 350 for 3 s', () => {
    const s = sys({ seed: 3 });
    // Place a UFO by hand 500 ahead, still
    s.state.ufos.push({ id: 'x', kind: 'ufo', pos: vAdd(CENTRE, [0, 0, -500]), vel: [0, 0, 0], radius: 15, alive: true, fireTimer: 1, farTime: 0, shots: 0, score: 200 });
    s.state.spawnTimer = 1e9;
    const ship = { pos: CENTRE, alive: true };
    let ev = step(s, 0.95, { ship });
    assert.equal(ev.filter(e => e.type === 'ufoShoot').length, 0);
    ev = step(s, 0.1, { ship });
    const shots = ev.filter(e => e.type === 'ufoShoot');
    assert.equal(shots.length, 1);
    assert.equal(shots[0].target, 'ship');
    const b = s.bullets[0];
    assert.ok(Math.abs(vLen(b.vel) - 350) < 1e-6);
    assert.ok(b.life <= 3 && b.life > 2.8);
    // Next shot after 2 s x 0.8 .. 1.2
    const u = s.ufos[0];
    assert.ok(u.fireTimer >= 1.6 - 0.02 && u.fireTimer <= 2.4);
    // Bullets expire after 3 s
    step(s, 3.1, { ship: { pos: CENTRE, alive: false } });
    assert.ok(!s.bullets.some(x => x.id === b.id));
    // Beyond the view distance: no shots
    const far = sys({ seed: 4 });
    far.state.spawnTimer = 1e9;
    far.state.ufos.push({ id: 'f', kind: 'ufo', pos: vAdd(CENTRE, [0, 0, -(RANGE + 50)]), vel: [0, 0, 0], radius: 15, alive: true, fireTimer: 0.01, farTime: 0, shots: 0, score: 200 });
    assert.equal(step(far, 5, { ship }).filter(e => e.type === 'ufoShoot').length, 0);
});

test('about 30 % of shots go at a nearby green; greens beyond the scaled 400 px radius are ignored', () => {
    const s = sys({ seed: 11 });
    s.state.spawnTimer = 1e9;
    const upos = vAdd(CENTRE, [0, 0, -400]);
    s.state.ufos.push({ id: 'g', kind: 'ufo', pos: upos, vel: [0, 0, 0], radius: 15, alive: true, fireTimer: 0, farTime: 0, shots: 0, score: 200 });
    const greenNear = { id: 'n', kind: 'green', pos: vAdd(upos, [300, 0, 0]), radius: 16 };
    const ship = { pos: CENTRE, alive: true };
    let toGreen = 0, total = 0;
    for (let i = 0; i < 600; i++) {
        s.state.ufos[0].fireTimer = 0;
        for (const e of s.update(1 / 60, { ship, greens: [greenNear] })) {
            if (e.type === 'ufoShoot') { total++; if (e.target === 'green') toGreen++; }
        }
    }
    assert.ok(total > 500);
    const share = toGreen / total;
    assert.ok(share > 0.25 && share < 0.35, `share ${share}`);
    // Radius: 400 x scale (2 at Far) = 800
    const t = sys({ seed: 12 });
    t.state.spawnTimer = 1e9;
    t.state.ufos.push({ id: 'h', kind: 'ufo', pos: upos, vel: [0, 0, 0], radius: 15, alive: true, fireTimer: 0, farTime: 0, shots: 0, score: 200 });
    const greenFar = { id: 'f', kind: 'green', pos: vAdd(upos, [810, 0, 0]), radius: 16 };
    let green = 0;
    for (let i = 0; i < 200; i++) {
        t.state.ufos[0].fireTimer = 0;
        for (const e of t.update(1 / 60, { ship, greens: [greenFar] })) if (e.target === 'green') green++;
    }
    assert.equal(green, 0);
});

test('aim cone: same hit chance as 2D at the same screen-equivalent distance (Monte Carlo, seeded)', () => {
    const rand = mulberry32(2026);
    const scale = scaleFor(RANGE);
    const N = 40000;
    for (const accuracy of [0.6, 0.8, 0.95]) {
        for (const d3 of [150, 400, 900]) {
            const d2 = d3 / scale;
            // 2D: uniform angle in ±(1-a)π, hit within asin(15/d2)
            const theta2 = (1 - accuracy) * Math.PI;
            const alpha2 = Math.asin(Math.min(1, UFO3D.shipRadius2d / d2));
            let hit2 = 0;
            for (let i = 0; i < N; i++) if (Math.abs((rand() * 2 - 1) * theta2) <= alpha2) hit2++;
            // 3D: uniform in the cone around the target direction; hit when the ray passes within 9
            const theta3 = aimCone3d(accuracy, d3, { scale });
            const dir = [0, 0, -1];
            let hit3 = 0;
            for (let i = 0; i < N; i++) {
                const v = randomInCone(rand, dir, theta3);
                // Ray from the UFO toward a sphere of radius 9 at distance d3 on -z
                const c = [0, 0, -d3];
                const along = vDot(c, v);
                const miss = vLen(vSub(c, vScale(v, along)));
                if (along > 0 && miss <= UFO3D.shipRadius3d) hit3++;
            }
            const p2 = hit2 / N, p3 = hit3 / N, expect = hitChance2d(accuracy, d2);
            assert.ok(Math.abs(p2 - expect) < 0.01, `2D sim ${p2} vs ${expect}`);
            const tol = Math.max(0.01, 0.08 * expect);
            assert.ok(Math.abs(p3 - p2) < tol, `a=${accuracy} d3=${d3}: 3D ${p3.toFixed(4)} vs 2D ${p2.toFixed(4)}`);
        }
    }
});

test('aim cone: the naive 2D angle as a 3D cone would hit far less (why the cone is derived)', () => {
    const d3 = 400, scale = 2, a = 0.8;
    const naive = (1 - a) * Math.PI;
    const alpha3 = Math.asin(9 / d3);
    const pNaive = (1 - Math.cos(alpha3)) / (1 - Math.cos(naive));
    assert.ok(pNaive < hitChance2d(a, d3 / scale) / 20);
    assert.ok(aimCone3d(a, d3, { scale }) < naive);
    // Perfect accuracy or point-blank: a cone no wider than the target
    assert.ok(Math.abs(aimCone3d(1, 400, { scale }) - alpha3) < 1e-12);
    assert.ok(Math.abs(aimCone3d(0.8, 5, { scale }) - Math.PI / 2) < 1e-9, 'inside the ship radius: everything hits');
});

test('randomInCone stays within the cone and is unit length', () => {
    const rand = mulberry32(5);
    const dir = vNorm([1, 2, 3]);
    for (let i = 0; i < 2000; i++) {
        const v = randomInCone(rand, dir, 0.3);
        assert.ok(Math.abs(vLen(v) - 1) < 1e-9);
        assert.ok(Math.acos(Math.min(1, vDot(v, dir))) <= 0.3 + 1e-9);
    }
    const x = randomInCone(rand, [1, 0, 0], 0.1);
    assert.ok(vDot(x, [1, 0, 0]) > Math.cos(0.1) - 1e-9);
});

test('UFO bullets: swept hits on the ship and rocks; invulnerable ship is safe', () => {
    const s = sys({ seed: 9 });
    s.state.spawnTimer = 1e9;
    const b = { id: 'b', hostile: true, pos: vAdd(CENTRE, [0, 0, -20]), prev: vAdd(CENTRE, [0, 0, -20]), vel: [0, 0, 350], life: 3, radius: 3 };
    s.state.bullets.push(b);
    s.update(1 / 10, { ship: { pos: CENTRE, alive: true } }); // moves 35 through the ship
    const hits = s.collideBullets({ ship: { pos: CENTRE, alive: true, radius: 9 } });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].hit, 'ship');
    assert.equal(s.bullets.length, 0);
    const b2 = { ...b, id: 'b2', pos: vAdd(CENTRE, [0, 0, -20]), prev: vAdd(CENTRE, [0, 0, -20]) };
    s.state.bullets.push(b2);
    s.update(1 / 10, {});
    assert.equal(s.collideBullets({ ship: { pos: CENTRE, alive: true, invulnerable: 1 } }).length, 0);
    const b3 = { ...b, id: 'b3', pos: vAdd(CENTRE, [0, 0, -100]), prev: vAdd(CENTRE, [0, 0, -100]) };
    s.state.bullets = [b3];
    s.update(1 / 5, {});
    const rock = { id: 'r', kind: 'green', pos: vAdd(CENTRE, [0, 0, -50]), radius: 16 };
    const h = s.collideBullets({ ship: { pos: CENTRE, alive: true }, rocks: [rock] });
    assert.equal(h[0].hit, rock, 'the rock in front is hit first');
});

test('player bullets hit UFOs; ramming; destroy gives 200; nearest; far UFOs leave', () => {
    const s = sys({ seed: 1 });
    s.state.spawnTimer = 1e9;
    const u = { id: 'u', kind: 'ufo', pos: vAdd(CENTRE, [0, 0, -300]), vel: [0, 0, 0], radius: 15, alive: true, fireTimer: 99, farTime: 0, shots: 0, score: 200 };
    s.state.ufos.push(u);
    assert.equal(s.hitUfo(CENTRE, [0, 0, -400], 1), u);
    assert.equal(s.hitUfo(CENTRE, [0, 0, -200], 1), null);
    assert.equal(s.rammedBy(vAdd(CENTRE, [0, 0, -280])), u);
    assert.equal(s.rammedBy(CENTRE), null);
    assert.equal(s.nearest(CENTRE).ufo, u);
    assert.ok(Math.abs(s.nearest(CENTRE).dist - 300) < 1e-9);
    assert.equal(s.blocking, true);
    assert.deepEqual(s.destroy('u').score, 200);
    assert.equal(s.destroy('u'), null);
    assert.equal(s.blocking, false);
    // A UFO far away for 8 s leaves
    s.state.ufos.push({ ...u, id: 'far', alive: true, pos: vAdd(CENTRE, [0, 0, -(RANGE + 100)]), vel: [0, 0, 0], farTime: 0 });
    const ev = step(s, 8.1, { ship: { pos: CENTRE, alive: true } });
    assert.ok(ev.some(e => e.type === 'ufoLeft'));
    assert.equal(s.ufos.length, 0);
});

test('wrap: a UFO crossing the cube face reappears on the other side', () => {
    const s = sys({ seed: 1 });
    s.state.spawnTimer = 1e9;
    s.state.ufos.push({ id: 'w', kind: 'ufo', pos: [SIZE - 1, 10, 10], vel: [100, 0, 0], radius: 15, alive: true, fireTimer: 99, farTime: 0, shots: 0, score: 200 });
    s.update(0.1, { ship: { pos: [10, 10, 10], alive: true } });
    assert.ok(s.ufos[0].pos[0] < 20);
});

test('clear, configure, disable; seeded runs repeat exactly', () => {
    const s = sys({ seed: 1 });
    s.state.ufos.push({ id: 'z', pos: CENTRE, vel: [0, 0, 0], radius: 15, alive: true, fireTimer: 9, farTime: 0, shots: 0 });
    s.clear();
    assert.equal(s.ufos.length, 0);
    s.configure({ level: 5, dda: { ufoAccuracyMod: 0.5 } });
    assert.equal(s.accuracy, 0.4);
    s.setEnabled(false);
    step(s, 60, { ship: { pos: CENTRE, alive: true } });
    assert.equal(s.ufos.length, 0);
    const run = (seed) => {
        const x = sys({ seed });
        step(x, 40, { ship: { pos: CENTRE, alive: true } });
        return JSON.stringify(x.snapshot());
    };
    assert.equal(run(42), run(42));
    assert.notEqual(run(42), run(43));
});

test('cross products used for the cone basis are well defined near the axes', () => {
    const rand = mulberry32(1);
    for (const dir of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0]]) {
        const v = randomInCone(rand, dir, 0.2);
        assert.ok(Number.isFinite(v[0] + v[1] + v[2]));
        assert.ok(vLen(vCross(dir, v)) <= Math.sin(0.2) + 1e-9);
    }
});
