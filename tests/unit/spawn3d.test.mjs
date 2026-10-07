import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../js/rng.js';
import {
    spawnLevel, createIncoming, spawnIncoming, steerIncoming, aimVelocity, incomingInFlight, pushRocksAway,
    randomInSphere, pickFromMix, clusterRadius,
} from '../../js/3d/spawn3d.js';
import { levelPlan, RULES3D } from '../../js/3d/rules3d.js';
import { worldFor, wrappedDistance, nearestDelta, makeRock } from '../../js/3d/world3d.js';
import { vLen, vSub, vScale, vDot, vAdd } from '../../js/3d/math3d.js';

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

test('steerIncoming: re-aims in the fog, flies straight once visible, stops counting after passing', () => {
    const rand = mulberry32(5);
    const inc = createIncoming(levelPlan(1));
    const r = spawnIncoming(rand, inc, { shipPos: ship, shipVel: [0, 0, 0], size: world.size, distance: 1200, nextId: ids() });
    // The ship moves away sideways: while far, the rock turns to follow
    const v0 = r.vel.slice();
    assert.equal(steerIncoming(r, vAdd(ship, [200, 0, 0]), [50, 0, 0], world.size, world.fogNear), true);
    assert.notDeepEqual(r.vel, v0, 're-aimed');
    // Inside the lock distance: locked, velocity kept
    r.pos = vAdd(ship, vScale(vSub([0, 0, 0], r.vel), 300 / vLen(r.vel)));
    const vLocked = r.vel.slice();
    assert.equal(steerIncoming(r, ship, [0, 0, 0], world.size, world.fogNear), true);
    assert.equal(r.incoming.locked, true);
    steerIncoming(r, vAdd(ship, [100, 0, 0]), [80, 0, 0], world.size, world.fogNear);
    assert.deepEqual(r.vel, vLocked, 'straight once visible');
    // Past the ship: an ordinary rock
    r.pos = vAdd(ship, vScale(r.vel, 1));
    assert.equal(steerIncoming(r, ship, [0, 0, 0], world.size, world.fogNear), false);
    assert.equal(r.incoming, null);
    assert.equal(incomingInFlight([r]), 0);
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
