import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../js/rng.js';
import {
    spawnLevel, createIncoming, spawnIncoming, steerIncoming, aimVelocity, incomingInFlight, pushRocksAway,
    randomInSphere, pickFromMix, clusterRadius, turnVelocity,
} from '../../js/3d/spawn3d.js';
import { levelPlan, RULES3D } from '../../js/3d/rules3d.js';
import { worldFor, wrappedDistance, nearestDelta, makeRock, wrapPos } from '../../js/3d/world3d.js';
import { vLen, vSub, vScale, vDot, vAdd, vNorm } from '../../js/3d/math3d.js';
import { createSim, stepSim } from '../../js/3d/sim3d.js';

const world = worldFor('far');
const ship = [world.size / 2, world.size / 2, world.size / 2];
const ids = () => { let i = 1; return () => i++; };

test('a level field: plan counts, away from the ship, inside the cube', () => {
    const plan = levelPlan(3);
    const { rocks, clusters } = spawnLevel(mulberry32(1), plan, { size: world.size, shipPos: ship, nextId: ids() });
    const per = plan.clusterRocks.large + plan.clusterRocks.medium + plan.clusterRocks.small;
    assert.equal(rocks.filter((r) => r.kind === 'red').length, plan.clusters * per + plan.scattered);
    assert.equal(rocks.filter((r) => r.kind === 'green').length, plan.greens);
    assert.equal(clusters.length, plan.clusters);
    for (const r of rocks) {
        assert.ok(wrappedDistance(ship, r.pos, world.size) >= world.spawnClearance - 1e-6);
        for (const c of r.pos) assert.ok(c >= 0 && c < world.size);
    }
    assert.equal(new Set(rocks.map((r) => r.id)).size, rocks.length, 'unique ids');
});

test('clusters: members close together, drifting as one, most crystals inside', () => {
    const plan = levelPlan(1);
    const { rocks, clusters } = spawnLevel(mulberry32(2), plan, { size: world.size, shipPos: ship, nextId: ids() });
    for (const c of clusters) {
        const members = rocks.filter((r) => r.cluster === c.id);
        assert.ok(members.length >= plan.clusterRocks.large + plan.clusterRocks.medium + plan.clusterRocks.small);
        for (const m of members) assert.ok(wrappedDistance(c.centre, m.pos, world.size) <= c.radius + 1e-6);
        // Velocities differ only a little from the cluster's common drift
        const mean = vScale(members.reduce((t, m) => vAdd(t, m.vel), [0, 0, 0]), 1 / members.length);
        for (const m of members) assert.ok(vLen(vSub(m.vel, mean)) < 7, 'together');
    }
    const inside = rocks.filter((r) => r.kind === 'green' && r.cluster).length;
    assert.equal(inside, Math.round(plan.greens * plan.clusterGreenShare));
    // Clusters are apart from each other
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
        assert.ok(wrappedDistance(clusters[i].centre, clusters[j].centre, world.size) > clusters[i].radius + clusters[j].radius);
    }
    assert.ok(clusterRadius(10) > clusterRadius(2));
});

test('helpers: points in a sphere, weighted mix', () => {
    const rand = mulberry32(3);
    for (let i = 0; i < 200; i++) assert.ok(vLen(randomInSphere(rand, 50)) <= 50 + 1e-9);
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 2000; i++) counts[pickFromMix(rand, [['a', 0.8], ['b', 0.2]])]++;
    assert.ok(counts.a > 1400 && counts.b > 250, JSON.stringify(counts));
});

test('aim: a rock on the computed velocity meets a moving ship (plus the miss offset)', () => {
    const pos = [ship[0] + 900, ship[1] + 200, ship[2] - 300];
    const shipVel = [0, 0, -150];
    const miss = [0, 30, 0];
    const v = aimVelocity(pos, 160, ship, shipVel, world.size, miss);
    assert.ok(Math.abs(vLen(v) - 160) < 1e-9);
    // Simulate both straight: the closest approach is about |miss|
    let best = Infinity;
    for (let t = 0; t < 20; t += 0.01) {
        const r = vAdd(pos, vScale(v, t)), sh = vAdd(ship, vScale(shipVel, t));
        best = Math.min(best, vLen(vSub(r, sh)));
    }
    assert.ok(Math.abs(best - 30) < 3, `closest ${best}`);
});

test('spawnIncoming: out of sight, from ahead of a moving ship, sized by the mix, aimed near the ship', () => {
    const plan = levelPlan(1);
    const inc = createIncoming(plan);
    const rand = mulberry32(4);
    const next = ids();
    const shipVel = [0, 0, -200];
    for (let i = 0; i < 40; i++) {
        const r = spawnIncoming(rand, inc, { shipPos: ship, shipVel, size: world.size, distance: world.cullDistance, nextId: next });
        const d = nearestDelta(ship, r.pos, world.size);
        assert.ok(Math.abs(vLen(d) - world.cullDistance) < 1e-6);
        // Inside the cone around the motion (-z)
        const cos = vDot(d, [0, 0, -1]) / vLen(d);
        assert.ok(cos >= Math.cos(RULES3D.incomingCone * Math.PI / 180) - 1e-9, `cone ${cos}`);
        assert.ok(['large', 'medium', 'small'].includes(r.size));
        assert.equal(r.kind, 'red');
        assert.ok(r.incoming && !r.incoming.locked);
        assert.ok(vDot(r.vel, vScale(d, -1)) > 0, 'heading in');
    }
    // A still ship: from any direction
    const r = spawnIncoming(rand, inc, { shipPos: ship, shipVel: [0, 0, 0], size: world.size, distance: 1000, nextId: next });
    assert.ok(Math.abs(wrappedDistance(ship, r.pos, world.size) - 1000) < 1e-6);
});

test('steerIncoming: re-aims in the fog, homes in once visible, flies straight in the final approach, stops counting after passing', () => {
    const rand = mulberry32(5);
    const inc = createIncoming(levelPlan(1));
    const r = spawnIncoming(rand, inc, { shipPos: ship, shipVel: [0, 0, 0], size: world.size, distance: 1200, nextId: ids() });
    // The ship moves away sideways: while far, the rock turns to follow
    const v0 = r.vel.slice();
    assert.equal(steerIncoming(r, vAdd(ship, [200, 0, 0]), [50, 0, 0], world.size, world.fogNear, 1 / 60), true);
    assert.notDeepEqual(r.vel, v0, 're-aimed');
    assert.equal(r.incoming.homing, false);
    // Visible: homing, not locked
    r.pos = vAdd(ship, vScale(r.vel, -400 / vLen(r.vel)));
    assert.equal(steerIncoming(r, ship, [0, 0, 0], world.size, world.fogNear, 1 / 60), true);
    assert.equal(r.incoming.homing, true);
    assert.equal(r.incoming.locked, false);
    // Final approach: locked, velocity kept whatever the ship does
    r.pos = vAdd(ship, vScale(r.vel, -(RULES3D.incomingFinal - 10) / vLen(r.vel)));
    const vLocked = r.vel.slice();
    assert.equal(steerIncoming(r, ship, [0, 0, 0], world.size, world.fogNear, 1 / 60), true);
    assert.equal(r.incoming.locked, true);
    steerIncoming(r, vAdd(ship, [100, 0, 0]), [80, 0, 0], world.size, world.fogNear, 1 / 60);
    assert.deepEqual(r.vel, vLocked, 'straight in the final approach');
    // Past the ship: an ordinary rock
    r.pos = vAdd(ship, vScale(r.vel, 1));
    assert.equal(steerIncoming(r, ship, [0, 0, 0], world.size, world.fogNear, 1 / 60), false);
    assert.equal(r.incoming, null);
    assert.equal(incomingInFlight([r]), 0);
});

test('turnVelocity: turns at most the given angle, keeps the speed, handles a reversal', () => {
    const v = [0, 0, -150];
    const t = turnVelocity(v, [1, 0, 0], 0.1);
    assert.ok(Math.abs(vLen(t) - 150) < 1e-9);
    assert.ok(Math.abs(Math.acos(vDot(vNorm(t), [0, 0, -1])) - 0.1) < 1e-9);
    assert.ok(t[0] > 0, 'toward the wanted side');
    assert.deepEqual(turnVelocity(v, [0, 0, -1], 0.1), v, 'already there');
    const back = turnVelocity(v, [0, 0, 1], 0.2);
    assert.ok(Math.abs(vLen(back) - 150) < 1e-9 && Math.abs(Math.acos(vDot(vNorm(back), [0, 0, -1])) - 0.2) < 1e-9);
});

/** An incoming rock `dist` ahead of a ship at `ship`, heading straight at it, homing at `turnDeg` per second. */
function homingRock(dist, turnDeg, speed = 160) {
    const rock = makeRock({ id: 1, kind: 'red', size: 'small', pos: vAdd(ship, [0, 0, -dist]), vel: [0, 0, speed], rand: mulberry32(1) });
    rock.incoming = { speed, miss: [0, 0, 0], turnRate: turnDeg * Math.PI / 180, homing: true, locked: false, since: 0 };
    return rock;
}

test('homing: turns toward a moving ship within the turn-rate limit, speed unchanged', () => {
    const dt = 1 / 60, turn = 30;
    const shipVel = [120, 0, 0];
    let shipPos = ship.slice();
    const r = homingRock(500, turn);
    const straight = homingRock(500, 0); // a rock that never homes
    straight.incoming.locked = true;
    let best = Infinity, bestStraight = Infinity, turned = 0;
    for (let i = 0; i < 6 * 60; i++) {
        const before = r.vel.slice();
        if (r.incoming) steerIncoming(r, shipPos, shipVel, world.size, world.fogNear, dt);
        const a = Math.acos(Math.min(1, vDot(vNorm(before), vNorm(r.vel))));
        assert.ok(a <= turn * Math.PI / 180 * dt + 1e-9, `turned ${a} in one step`);
        assert.ok(Math.abs(vLen(r.vel) - 160) < 1e-9, 'speed kept');
        turned += a;
        for (const x of [r, straight]) x.pos = wrapPos(vAdd(x.pos, vScale(x.vel, dt)), world.size);
        shipPos = wrapPos(vAdd(shipPos, vScale(shipVel, dt)), world.size);
        best = Math.min(best, wrappedDistance(r.pos, shipPos, world.size));
        bestStraight = Math.min(bestStraight, wrappedDistance(straight.pos, shipPos, world.size));
    }
    assert.ok(turned > 0.1, `turned ${turned} rad in all`);
    assert.ok(best < bestStraight * 0.6, `homing passes at ${best.toFixed(0)}, straight at ${bestStraight.toFixed(0)}`);
});

test('homing: no steering in the final approach (distance or time) or once past the ship', () => {
    const dt = 1 / 60;
    // Within incomingFinal of the ship
    const near = homingRock(RULES3D.incomingFinal - 1, 30);
    const v1 = near.vel.slice();
    assert.equal(steerIncoming(near, ship, [200, 0, 0], world.size, world.fogNear, dt), true);
    assert.deepEqual(near.vel, v1);
    assert.equal(near.incoming.locked, true);
    // Farther, but closing fast: less than incomingFinalTime to the closest approach
    const fast = homingRock(300, 30, 400); // 0.75 s
    const v2 = fast.vel.slice();
    steerIncoming(fast, ship, [0, 0, 0], world.size, world.fogNear, dt);
    assert.deepEqual(fast.vel, v2);
    assert.equal(fast.incoming.locked, true);
    // Once locked it stays straight, even when the ship moves far off its line
    steerIncoming(fast, vAdd(ship, [0, 0, -100]), [0, 250, 0], world.size, world.fogNear, dt);
    assert.deepEqual(fast.vel, v2);
    // Past the ship (moving away): never steered, an ordinary rock
    const past = homingRock(200, 30);
    past.vel = [0, 0, -160];
    const v3 = past.vel.slice();
    assert.equal(steerIncoming(past, ship, [0, 0, 0], world.size, world.fogNear, dt), false);
    assert.deepEqual(past.vel, v3);
    assert.equal(past.incoming, null);
});

test('homing: the same seed and inputs give the same incoming rocks', () => {
    const run = () => {
        const s = createSim({ seed: 21, view: 'far', level: 3 });
        for (let i = 0; i < 40 * 60; i++) stepSim(s, { q: s.ship.q, thrust: i % 240 < 120 });
        return JSON.stringify(s.rocks.filter((r) => r.incoming).map((r) => [r.id, r.pos, r.vel, r.incoming]));
    };
    const a = run();
    assert.ok(a.length > 2, 'incoming rocks in flight');
    assert.equal(run(), a);
});

test('pushRocksAway: rocks inside the sphere move out to it, others stay', () => {
    const rand = mulberry32(6);
    const near = makeRock({ id: 1, kind: 'red', size: 'small', pos: vAdd(ship, [10, 0, 0]), rand });
    const far = makeRock({ id: 2, kind: 'red', size: 'small', pos: vAdd(ship, [500, 0, 0]), rand });
    const farPos = far.pos.slice();
    pushRocksAway([near, far], ship, 150, world.size);
    assert.ok(Math.abs(wrappedDistance(ship, near.pos, world.size) - (150 + near.radius)) < 1e-6);
    assert.deepEqual(far.pos, farPos);
});
