import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoss3d, BOSS3D, weakPointPlan, sphereDirections, bossLevelOf } from '../../js/3d/boss3d.js';
import { mulberry32 } from '../../js/rng.js';
import { vLen, vSub, vAdd, vScale, vDot, vNorm } from '../../js/3d/math3d.js';
import { nearestDelta } from '../../js/3d/world3d.js';

const SIZE = 3200;
const SHIP = [1600, 1600, 1600];
const make = (level = 2, seed = 1) => createBoss3d({ rand: mulberry32(seed), size: SIZE, level, shipPos: SHIP, shipForward: [0, 0, -1] });
function run(b, seconds, ship = { pos: SHIP, alive: true }, dt = 1 / 60) {
    const ev = [];
    for (let t = 0; t < seconds - 1e-9; t += dt) ev.push(...b.update(dt, { ship }));
    return ev;
}
// A bullet fired straight at a weak point from outside along its normal
function shotAt(b, w, dist = 100) {
    const p = b.weakPointPos(w), n = b.weakPointNormal(w);
    const p0 = vAdd(p, vScale(n, dist));
    return { p0, move: vScale(n, -(dist + 10)) };
}

test('2D numbers: health, score, cooldown, speed; at least 4 outer weak points', () => {
    assert.equal(bossLevelOf(2), 1);
    assert.equal(bossLevelOf(6), 3);
    const p1 = weakPointPlan(1);
    assert.deepEqual([p1.outer, p1.outerHealth, p1.coreHealth, p1.score, p1.moveSpeed], [4, 25, 50, 1500, 55]);
    assert.ok(Math.abs(p1.attackCooldown - 1.9) < 1e-9);
    assert.equal(weakPointPlan(4).outer, 5, '3 + floor(L/2) once that is more than 4');
    assert.equal(weakPointPlan(20).attackCooldown, 1);
    const d = sphereDirections(4);
    for (const v of d) assert.ok(Math.abs(vLen(v) - 1) < 1e-9);
    // Spread out: no two closer than 90 degrees
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) assert.ok(vDot(d[i], d[j]) < 0.1);
});

test('enters ahead of the ship, invulnerable for 3 s with a 2 s warning, then fights', () => {
    const b = make();
    const d = nearestDelta(SHIP, b.state.pos, SIZE);
    assert.ok(Math.abs(vLen(d) - BOSS3D.spawnDistance) < 1e-6);
    assert.ok(d[2] < 0, 'ahead (-z)');
    assert.equal(b.phase, 'entering');
    assert.equal(b.warning, true);
    const w = b.state.weakPoints[0];
    const s = shotAt(b, w);
    const hit = b.hitTest(s.p0, s.move);
    assert.equal(hit.type, 'weakPoint');
    assert.deepEqual(b.damage(hit), [], 'no damage while entering');
    run(b, 2.1);
    assert.equal(b.warning, false);
    const ev = run(b, 1);
    assert.ok(ev.some(e => e.type === 'bossFight'));
    assert.equal(b.vulnerable, true);
});

test('weak points only from their outward side; body hits are absorbed', () => {
    const b = make();
    run(b, 3.05);
    const w = b.state.weakPoints[0];
    const s = shotAt(b, w);
    assert.equal(b.hitTest(s.p0, s.move).type, 'weakPoint');
    // From the inside going out: not a weak point hit (and it starts inside the body)
    const p = b.weakPointPos(w), n = b.weakPointNormal(w);
    const inside = b.hitTest(vSub(p, vScale(n, 60)), vScale(n, 80));
    assert.notEqual(inside && inside.type, 'weakPoint');
    // From the opposite side of the body: the body is hit first, absorbed
    const far = vSub(b.state.pos, vScale(n, 400));
    const through = b.hitTest(far, vScale(n, 800));
    assert.equal(through.type, 'body');
    assert.deepEqual(b.damage(through), []);
    // A clean miss
    assert.equal(b.hitTest(vAdd(b.state.pos, [0, 1000, 0]), [100, 0, 0]), null);
});

test('destroying the weak points: 200 points + 20 credits each, an escort each; then the core; defeat pays 20 %', () => {
    const b = make(2);
    run(b, 3.05);
    const plan = weakPointPlan(1);
    let destroyed = 0, escorts = 0;
    for (const w of b.state.weakPoints) {
        // Core not damageable yet
        const bodyHit = b.hitTest(vAdd(b.state.pos, [0, 0, 400]), [0, 0, -300]);
        if (bodyHit && bodyHit.type !== 'weakPoint') assert.equal(bodyHit.type, 'body');
        for (let i = 0; i < Math.ceil(plan.outerHealth / BOSS3D.damage); i++) {
            const s = shotAt(b, w);
            for (const e of b.damage(b.hitTest(s.p0, s.move))) {
                if (e.type === 'weakPointDestroyed') { destroyed++; assert.equal(e.points, 200); assert.equal(e.credits, 20); }
                if (e.type === 'escort') escorts++;
            }
        }
        assert.equal(w.destroyed, true);
    }
    assert.equal(destroyed, plan.outer);
    assert.equal(escorts, plan.outer);
    // Now the body is the core
    const coreHit = b.hitTest(vAdd(b.state.pos, [0, 0, 400]), [0, 0, -300]);
    assert.equal(coreHit.type, 'core');
    let defeated = null;
    for (let i = 0; i < 10 && !defeated; i++) defeated = b.damage(coreHit).find(e => e.type === 'bossDefeated');
    assert.ok(defeated);
    assert.equal(defeated.points, 1500);
    assert.equal(defeated.credits, 300);
    assert.equal(defeated.drops.length, 3);
    assert.equal(b.health, 0);
    assert.equal(b.phase, 'defeated');
    assert.equal(b.vulnerable, false);
    const ev = run(b, 2.1);
    assert.ok(ev.some(e => e.type === 'bossGone'));
    assert.equal(b.alive, false);
    assert.equal(b.hitTest(SHIP, [0, 0, -2000]), null);
});

test('attacks cycle spread (5 at 200), aimed (1 at 300), circle (8 + L at 150) from the nearest turret', () => {
    const b = make(2);
    run(b, 3.05);
    b.state.attackTimer = b.state.attackCooldown; // attack on the next step
    const patterns = [];
    for (let k = 0; k < 3; k++) {
        const before = b.state.bullets.length;
        const ev = b.update(1 / 60, { ship: { pos: SHIP, alive: true } });
        const shots = ev.filter(e => e.type === 'bossShoot');
        patterns.push([shots[0].pattern, shots.length]);
        const fresh = b.state.bullets.slice(before);
        const speed = vLen(fresh[0].vel);
        if (shots[0].pattern === 'spread') {
            assert.ok(Math.abs(speed - 200) < 1e-6);
            // All within 4.2 degrees of the direction to the ship
            const toShip = vNorm(nearestDelta(fresh[0].pos, SHIP, SIZE));
            for (const f of fresh) assert.ok(vDot(vNorm(f.vel), toShip) > Math.cos(4.5 * Math.PI / 180));
        }
        if (shots[0].pattern === 'aimed') assert.ok(Math.abs(speed - 300) < 1e-6);
        if (shots[0].pattern === 'circle') assert.ok(Math.abs(speed - 150) < 1e-6);
        b.state.attackTimer = b.state.attackCooldown;
    }
    assert.deepEqual(patterns.map(p => p[0]).sort(), ['aimed', 'circle', 'spread']);
    assert.deepEqual(patterns.find(p => p[0] === 'spread')[1], 5);
    assert.deepEqual(patterns.find(p => p[0] === 'aimed')[1], 1);
    assert.deepEqual(patterns.find(p => p[0] === 'circle')[1], 9);
});

test('boss bullets hit the ship (swept); invulnerable ship safe; touching the body', () => {
    const b = make();
    b.state.bullets.push({ id: 'x', pos: vAdd(SHIP, [0, 0, -15]), prev: vAdd(SHIP, [0, 0, -15]), vel: [0, 0, 300], life: 3, radius: 4 });
    b.update(0.1, { ship: { pos: SHIP, alive: true } });
    assert.equal(b.collideBullets({ ship: { pos: SHIP, alive: true, invulnerable: 1 } }).length, 0);
    assert.equal(b.collideBullets({ ship: { pos: SHIP, alive: true } }).length, 1);
    assert.equal(b.state.bullets.length, 0);
    assert.equal(b.touches(b.state.pos), true);
    assert.equal(b.touches(SHIP), false);
});

test('fighting: hovers 450 to 650 from the ship and spins; seeded runs repeat', () => {
    const b = make();
    const q0 = b.state.q.slice();
    run(b, 40);
    assert.notDeepEqual(b.state.q, q0);
    const d = vLen(nearestDelta(SHIP, b.state.pos, SIZE));
    assert.ok(d > 300 && d < 800, `distance ${d}`);
    const snap = (seed) => { const x = make(4, seed); run(x, 20); return JSON.stringify(x.snapshot()); };
    assert.equal(snap(5), snap(5));
});

// --- Regression tests for docs/plans/07-review.md
test('review #7: the boss records the weak point hit last and the firing turret (flash fades)', () => {
    const b = make();
    run(b, 3.05);
    const w = b.state.weakPoints[1];
    const s = shotAt(b, w);
    b.damage(b.hitTest(s.p0, s.move));
    assert.equal(b.state.lastHit, w.id);
    assert.equal(b.state.turretFlash, 0);
    let fired = false;
    for (let i = 0; i < 60 * 4 && !fired; i++) fired = b.update(1 / 60, { ship: { pos: SHIP, alive: true } }).some((e) => e.type === 'bossShoot');
    assert.ok(fired);
    assert.equal(b.state.turretFlash, 1);
    assert.ok(b.state.weakPoints.some((x) => !x.destroyed && x.dir.every((c, k) => c === b.state.turretDir[k])), 'a living weak point fired');
    run(b, 0.2);
    assert.ok(b.state.turretFlash < 1, 'fades');
});

test('review #11: a boss shot\'s last move before it expires is still tested', () => {
    const b = make();
    const ship = { pos: SHIP, alive: true, radius: 9 };
    b.state.bullets.push({ id: 'x', pos: [SHIP[0], SHIP[1], SHIP[2] - 15], prev: null, vel: [0, 0, 300], life: 1 / 60, radius: 4 });
    b.update(1 / 60, { ship: { pos: [0, 0, 0], alive: false } });
    assert.equal(b.collideBullets({ ship }).length, 1);
    b.state.bullets.push({ id: 'y', pos: [SHIP[0] + 400, SHIP[1], SHIP[2]], prev: null, vel: [0, 0, 300], life: 1 / 60, radius: 4 });
    b.update(1 / 60, { ship: { pos: [0, 0, 0], alive: false } });
    assert.equal(b.collideBullets({ ship }).length, 0);
    assert.equal(b.state.bullets.length, 0, 'expired after its last test');
});
