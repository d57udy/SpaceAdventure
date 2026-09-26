import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    SAUCER_STRENGTHS, STRENGTH_ORDER, SAUCER_RULES, strengthOf, cycleStrength, saucerTarget, steerVector,
    angleBetween, aimAssist, stepGun, farEdgePoint,
} from '../../js/saucer.js';
import { MODES } from '../../js/modes.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `expected ${b}, got ${a}`);
const DEG = Math.PI / 180;

test('normal strength matches the mode config (plan §4.5)', () => {
    const cfg = MODES.saucer.saucer;
    assert.equal(SAUCER_STRENGTHS.normal.speed, cfg.speed);
    assert.equal(SAUCER_STRENGTHS.normal.fireCooldown, cfg.fireCooldown);
    assert.equal(SAUCER_RULES.aimAssistDeg, cfg.aimAssistDeg);
    assert.equal(SAUCER_RULES.respawnDelay, cfg.respawnDelay);
    assert.equal(SAUCER_RULES.killPoints, cfg.killPoints);
    // Weaker saucers are slower and fire less often
    const [w, n, s] = STRENGTH_ORDER.map((id) => SAUCER_STRENGTHS[id]);
    assert.ok(w.speed < n.speed && n.speed < s.speed);
    assert.ok(w.fireCooldown > n.fireCooldown && n.fireCooldown > s.fireCooldown);
});

test('strength lookup and cycling', () => {
    assert.equal(strengthOf('strong').id, 'strong');
    assert.equal(strengthOf('bogus').id, 'normal');
    assert.equal(cycleStrength('normal', 1), 'strong');
    assert.equal(cycleStrength('strong', 1), 'weak');
    assert.equal(cycleStrength('weak', -1), 'strong');
    assert.equal(cycleStrength('normal', -1), 'weak');
});

test('target score by difficulty, with an override', () => {
    const t = MODES.saucer.target;
    assert.equal(saucerTarget(t, 'easy'), 1800);
    assert.equal(saucerTarget(t, 'medium'), 2500);
    assert.equal(saucerTarget(t, 'hard'), 3500);
    assert.equal(saucerTarget(t, 'unknown'), 2500);
    assert.equal(saucerTarget(t, 'hard', 50), 50);
    assert.equal(saucerTarget(t, 'hard', 0), 3500, 'zero is not a target');
});

test('steerVector: keys give absolute 8-way directions, a stick wins', () => {
    assert.deepEqual(steerVector({}), { x: 0, y: 0, active: false });
    assert.deepEqual(steerVector({ up: true }), { x: 0, y: -1, active: true });
    assert.deepEqual(steerVector({ left: true }), { x: -1, y: 0, active: true });
    assert.deepEqual(steerVector({ left: true, right: true }), { x: 0, y: 0, active: false }, 'opposites cancel');
    const d = steerVector({ down: true, right: true });
    near(d.x, Math.SQRT1_2);
    near(d.y, Math.SQRT1_2);
    const s = steerVector({ up: true }, { active: true, angle: Math.PI, magnitude: 0.5 });
    near(s.x, -0.5);
    near(s.y, 0);
    assert.equal(s.active, true);
    assert.deepEqual(steerVector({ up: true }, { active: false, angle: 0, magnitude: 0 }), { x: 0, y: -1, active: true });
    near(steerVector({}, { active: true, angle: 0, magnitude: 3 }).x, 1, 1e-9);
});

test('angleBetween wraps to (-PI, PI]', () => {
    near(angleBetween(0, Math.PI / 2), Math.PI / 2);
    near(angleBetween(170 * DEG, -170 * DEG), 20 * DEG);
    near(angleBetween(-170 * DEG, 170 * DEG), -20 * DEG);
    near(angleBetween(0, Math.PI), Math.PI);
});

test('aimAssist snaps to the target closest in angle within ±30°', () => {
    const W = 1000, H = 1000;
    // Heading right; a green at 20° and the pilot at 10°: the pilot wins (closer in angle)
    const green = { x: 100 + Math.cos(20 * DEG) * 200, y: 100 + Math.sin(20 * DEG) * 200 };
    const pilot = { x: 100 + Math.cos(10 * DEG) * 300, y: 100 + Math.sin(10 * DEG) * 300 };
    const a = aimAssist(100, 100, 0, [green, pilot], W, H);
    assert.equal(a.target, pilot);
    near(a.angle, 10 * DEG, 1e-9);
    // Outside the cone: straight along the heading
    const off = { x: 100 + Math.cos(40 * DEG) * 200, y: 100 + Math.sin(40 * DEG) * 200 };
    const b = aimAssist(100, 100, 0, [off], W, H);
    assert.equal(b.target, null);
    near(b.angle, 0);
    // Exactly at the edge counts
    const edge = { x: 100 + Math.cos(-30 * DEG) * 100, y: 100 + Math.sin(-30 * DEG) * 100 };
    assert.equal(aimAssist(100, 100, 0, [edge], W, H).target, edge);
    // A smaller cone
    assert.equal(aimAssist(100, 100, 0, [green], W, H, 15).target, null);
    // Equal angles: the nearer one
    const far = { x: 600, y: 100 }, closer = { x: 300, y: 100 };
    assert.equal(aimAssist(100, 100, 0, [far, closer], W, H).target, closer);
    // Ignores empty entries and a target on top of the saucer
    assert.equal(aimAssist(100, 100, 0, [null, { x: 100, y: 100 }], W, H).target, null);
});

test('aimAssist is wrap-aware: a target across the world edge', () => {
    const W = 1000, H = 800;
    // Saucer near the right edge heading right; the target is just past the seam at x = 30
    const t = { x: 30, y: 400 };
    const a = aimAssist(950, 400, 0, [t], W, H);
    assert.equal(a.target, t);
    near(a.angle, 0);
    // Heading left, the same target is 920 px away the long way: it is behind (180°), not in the cone
    assert.equal(aimAssist(950, 400, Math.PI, [t], W, H).target, null);
});

test('stepGun: fires at most once per cooldown', () => {
    let g = { cooldown: 0 };
    const shots = [];
    for (let i = 0; i < 150; i++) { // 2.5 s at 60 fps, fire held
        g = stepGun(g, 1 / 60, true, 1);
        if (g.fired) shots.push(i);
    }
    assert.equal(shots.length, 3); // at 0 s, 1 s and 2 s
    assert.equal(shots[0], 0);
    assert.ok(shots[1] >= 59 && shots[1] <= 61);
    // Not firing: the cooldown still runs down, no shot
    let h = stepGun({ cooldown: 0.5 }, 0.2, false, 1);
    assert.equal(h.fired, false);
    near(h.cooldown, 0.3);
    h = stepGun(h, 0.5, false, 1);
    assert.equal(h.cooldown, 0);
    assert.equal(stepGun(h, 0.01, true, 0.7).cooldown, 0.7);
    assert.equal(stepGun(null, 0.01, true, 1).fired, true);
});

test('farEdgePoint: on the view edge, on the far side from the pilot', () => {
    const W = 1200, H = 1200;
    // Pilot left of the centre: the saucer appears at the right edge
    let p = farEdgePoint(600, 600, { x: 500, y: 600 }, 400, 400, W, H, 40);
    near(p.x, 960);
    near(p.y, 600);
    // Pilot below and right: top-left, clamped to the inset rectangle
    p = farEdgePoint(600, 600, { x: 700, y: 700 }, 400, 400, W, H, 40);
    near(p.x, 240);
    near(p.y, 240);
    // Pilot at the centre: the top edge
    p = farEdgePoint(600, 600, { x: 600, y: 600 }, 400, 300, W, H, 40);
    near(p.x, 600);
    near(p.y, 340);
    // No pilot: to the right
    p = farEdgePoint(600, 600, null, 400, 400, W, H, 40);
    near(p.x, 960);
    // Wrapped into the world, and wrap-aware across the seam
    p = farEdgePoint(1150, 100, { x: 50, y: 100 }, 400, 400, W, H, 40); // pilot 100 px right (across the seam)
    near(p.x, (1150 - 360 + W) % W);
    near(p.y, 100);
    p = farEdgePoint(1150, 100, { x: 1000, y: 100 }, 400, 400, W, H, 40); // pilot left: right edge, past the seam
    near(p.x, (1150 + 360) % W);
});

test('controlled UFO: steer sets velocity and turret heading, no AI shots, cooldown and protection', async () => {
    const { UFO } = await import('../../js/ufo.js');
    const { Entity } = await import('../../js/entity.js');
    Entity.worldWidth = 1200; Entity.worldHeight = 1200;
    const log = console.log; console.log = () => {};
    try {
        const u = new UFO(800, 800, 600, 600);
        u.x = 300; u.y = 300;
        u.makeControlled({ speed: 150, fireCooldown: 1, colour: '#FF9F1C', heading: Math.PI, invulnerability: 2 });
        assert.equal(u.controlled, true);
        assert.equal(u.isInvulnerable, true);
        assert.deepEqual([u.velX, u.velY], [0, 0], 'waits for input');
        u.steer(0, -1);
        near(u.velX, 0, 1e-9);
        near(u.velY, -150);
        near(u.heading, -Math.PI / 2);
        u.steer(0.5, 0); // half stick
        near(u.velX, 75);
        near(u.heading, 0);
        u.steer(0, 0); // let go: stops, turret keeps pointing
        assert.deepEqual([u.velX, u.velY], [0, 0]);
        near(u.heading, 0);
        // No AI firing, however long it lives; protection wears off after 2 s
        const bullets = [];
        for (let i = 0; i < 180; i++) u.update(1 / 60, 800, 800, { x: 320, y: 300, isAlive: true }, bullets, null, null, [], 0, 0);
        assert.equal(bullets.length, 0);
        assert.equal(u.isInvulnerable, false);
        // tryFire: one enemy bullet along the aim, then the cooldown blocks
        const b = u.tryFire(bullets, Math.PI / 2);
        assert.ok(b);
        assert.equal(b.isPlayerBullet, false);
        assert.equal(b.fromSaucer, true);
        near(b.velY, 350);
        near(b.y, 300 + u.radius);
        assert.equal(u.tryFire(bullets), null);
        for (let i = 0; i < 59; i++) u.update(1 / 60, 800, 800, null, bullets, null, null, [], 0, 0);
        assert.equal(u.tryFire(bullets), null, 'still cooling down after 59 frames');
        u.update(2 / 60, 800, 800, null, bullets, null, null, [], 0, 0);
        assert.ok(u.tryFire(bullets), 'ready after 1 s');
        assert.equal(bullets.length, 2);
        assert.equal(u.shots, 2);
        u.destroy(null);
        assert.equal(u.tryFire(bullets), null, 'a destroyed saucer never fires');
    } finally {
        console.log = log;
    }
});
