// Time Attack vs Ghost (plan 05 §4.6, MP-6): seeded world threading and ghost helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { mulberry32, courseSeed, levelSeed } = await import('../../js/rng.js');
const { randomRange } = await import('../../js/utils.js');
const { Asteroid, createAsteroidField } = await import('../../js/asteroid.js');
const { PowerUp, PowerUpType } = await import('../../js/powerup.js');
const { UFO } = await import('../../js/ufo.js');
const { Boss } = await import('../../js/boss.js');
const { GhostRecorder, GhostPlayer, decodeGhost, ghostStorageKey } = await import('../../js/ghost.js');
const { ghostKeysForUser } = await import('../../js/mpRecords.js');
const TA = await import('../../js/timeAttack.js');

const W = 1200;
const H = 1200;
const FIELD = { count: 13, worldWidth: W, worldHeight: H, clearRadius: 300, greenProbability: 0.6, speedMultiplier: 1 };

function layout(field) {
    return field.asteroids.map(a => ({
        x: a.x, y: a.y, velX: a.velX, velY: a.velY, type: a.type, radius: a.radius,
        rotationSpeed: a.rotationSpeed, shape: a.shapeVertices.map(v => [v.x, v.y]),
    }));
}

/** Run fn with Math.random replaced by a counter-checking stub; returns [result, calls]. */
function countingMathRandom(fn) {
    const real = Math.random;
    let calls = 0;
    Math.random = () => { calls++; return real(); };
    try { return [fn(), calls]; } finally { Math.random = real; }
}

// --- rng threading ---

test('randomRange: optional generator; Math.random when omitted or null', () => {
    const r = () => 0.25;
    assert.equal(randomRange(10, 20, r), 12.5);
    const real = Math.random;
    Math.random = () => 0.5;
    try {
        assert.equal(randomRange(10, 20), 15);
        assert.equal(randomRange(10, 20, null), 15);
    } finally { Math.random = real; }
});

test('same seed gives the same level layout (positions, drift, type, size, spin, shape) across two runs', () => {
    const seed = levelSeed(courseSeed(3, 'medium'), 1);
    const a = createAsteroidField({ ...FIELD, avoid: [{ x: W / 2, y: H / 2 }], rng: mulberry32(seed) });
    const b = createAsteroidField({ ...FIELD, avoid: [{ x: W / 2, y: H / 2 }], rng: mulberry32(seed) });
    assert.equal(a.asteroids.length, 13);
    assert.deepEqual(layout(a), layout(b));
    assert.equal(a.greenCount, b.greenCount);
    const c = createAsteroidField({ ...FIELD, avoid: [{ x: W / 2, y: H / 2 }], rng: mulberry32(levelSeed(courseSeed(4, 'medium'), 1)) });
    assert.notDeepEqual(layout(a).map(l => [l.x, l.y]), layout(c).map(l => [l.x, l.y]));
});

test('seeded layout draws nothing from Math.random except the cosmetic glow phase', () => {
    const [, calls] = countingMathRandom(() =>
        createAsteroidField({ ...FIELD, avoid: [{ x: W / 2, y: H / 2 }], rng: mulberry32(1) }));
    assert.equal(calls, 13); // one pulse phase per asteroid
});

test('seeded layout stays aligned wherever the ship is; asteroids keep clear of it', () => {
    const seed = levelSeed(courseSeed(1, 'hard'), 2);
    const centre = createAsteroidField({ ...FIELD, avoid: [{ x: W / 2, y: H / 2 }], rng: mulberry32(seed) });
    const corner = createAsteroidField({ ...FIELD, avoid: [{ x: 100, y: 100 }], rng: mulberry32(seed) });
    // same draws: types, sizes and drift match even if a few positions moved away from the ship
    assert.deepEqual(layout(centre).map(l => [l.type, l.radius, l.velX, l.velY]),
        layout(corner).map(l => [l.type, l.radius, l.velX, l.velY]));
    // A position near the ship moves half a world away, so none end up close to it
    const near = corner.asteroids.filter(a => {
        const dx = Math.min(Math.abs(a.x - 100), W - Math.abs(a.x - 100));
        const dy = Math.min(Math.abs(a.y - 100), H - Math.abs(a.y - 100));
        return Math.hypot(dx, dy) < 300;
    });
    assert.equal(near.length, 0);
});

test('unseeded layout (single-player) still uses Math.random and re-rolls near the ship', () => {
    const real = Math.random;
    const seq = [0.5, 0.5, /* too close: re-roll */ 0.1, 0.1, 0.1, 0.9, /* asteroid ctor */ 0.5, 0.2, 0.3, 0.1];
    let i = 0;
    Math.random = () => (i < seq.length ? seq[i++] : 0.3);
    try {
        const f = createAsteroidField({ ...FIELD, count: 1, avoid: [{ x: W / 2, y: H / 2 }] });
        assert.equal(f.asteroids[0].x, 120);
        assert.equal(f.asteroids[0].y, 120);
        assert.equal(f.asteroids[0].radius, 40); // sizeRoll 0.1 -> LARGE
        assert.equal(f.asteroids[0].type, 'red'); // 0.9 >= 0.6
    } finally { Math.random = real; }
});

test('Asteroid: rng controls spin, type, shape and drift; the default path is unchanged', () => {
    const a = new Asteroid(10, 20, Asteroid.Sizes.LARGE, null, 1, null, mulberry32(7));
    const b = new Asteroid(10, 20, Asteroid.Sizes.LARGE, null, 1, null, mulberry32(7));
    assert.equal(a.type, b.type);
    assert.equal(a.rotationSpeed, b.rotationSpeed);
    assert.deepEqual(a.shapeVertices, b.shapeVertices);
    assert.equal(a.velX, b.velX);
    const [, calls] = countingMathRandom(() => new Asteroid(0, 0, Asteroid.Sizes.MEDIUM, null, 1, 'red'));
    assert.ok(calls > 5, 'unseeded asteroids use Math.random');
});

test('PowerUp.spawnRandom and getRandomType: same seed, same position and type', () => {
    const p1 = PowerUp.spawnRandom(W, H, 50, mulberry32(99));
    const p2 = PowerUp.spawnRandom(W, H, 50, mulberry32(99));
    assert.equal(p1.x, p2.x);
    assert.equal(p1.y, p2.y);
    assert.equal(p1.type, p2.type);
    assert.ok(p1.x >= 50 && p1.x <= W - 50);
    assert.equal(PowerUp.getRandomType(() => 0.01), PowerUpType.EXTRA_LIFE);
    assert.equal(PowerUp.getRandomType(() => 0.99), PowerUpType.SCORE_MULTIPLIER);
    const seq = (seed) => { const r = mulberry32(seed); return Array.from({ length: 20 }, () => PowerUp.getRandomType(r).id); };
    assert.deepEqual(seq(5), seq(5));
});

test('UFO: seeded heading and first shot delay', () => {
    const a = new UFO(800, 800, 400, 400, mulberry32(3));
    const b = new UFO(800, 800, 400, 400, mulberry32(3));
    assert.equal(a.velX, b.velX);
    assert.equal(a.velY, b.velY);
    assert.equal(a.fireTimer, b.fireTimer);
});

test('Boss: movement targets follow boss.rng when set', () => {
    const run = () => {
        const boss = new Boss(0, 0, 1);
        boss.rng = mulberry32(11);
        boss.targetOffsetX = null;
        try { boss.updateFighting(0.016, 800, 800, { x: 0, y: 0, isAlive: true }, [], null); } catch { /* attacks may need more state */ }
        return [boss.targetOffsetX, boss.targetOffsetY];
    };
    const [x1, y1] = run();
    const [x2, y2] = run();
    assert.equal(x1, x2);
    assert.equal(y1, y2);
    assert.ok(Number.isFinite(x1));
});

test('createSeededWorld: stable rand function, reseeded per level; same course gives the same stream', () => {
    const w1 = TA.createSeededWorld(2, 'Medium');
    const w2 = TA.createSeededWorld(2, 'medium');
    assert.equal(w1.seed, courseSeed(2, 'medium'));
    const f = w1.rand;
    const a = [f(), f(), f()];
    assert.deepEqual([w2.rand(), w2.rand(), w2.rand()], a);
    w1.reseed(3);
    assert.equal(w1.rand, f, 'the function handed out stays valid across levels');
    const l3 = [f(), f()];
    const fresh = mulberry32(levelSeed(courseSeed(2, 'medium'), 3));
    assert.deepEqual(l3, [fresh(), fresh()]);
    w1.reseed(1);
    assert.deepEqual([f(), f(), f()], a, 'a level always restarts its stream');
    assert.notEqual(TA.createSeededWorld(2, 'hard').seed, w1.seed);
});

// --- ghost helpers ---

test('courses: clamp and step with wrap-around', () => {
    assert.equal(TA.clampCourse(0), 1);
    assert.equal(TA.clampCourse(11), 10);
    assert.equal(TA.clampCourse('x'), 1);
    assert.equal(TA.stepCourse(10, 1), 1);
    assert.equal(TA.stepCourse(1, -1), 10);
    assert.equal(TA.stepCourse(4, 1), 5);
});

test('ghost keys: parse, filter by course and difficulty; reset filtering keeps other users', () => {
    const keys = [
        ghostStorageKey('bob', 3, 'Medium'),
        ghostStorageKey('ALICE', 3, 'medium'),
        ghostStorageKey('BOB', 3, 'hard'),
        ghostStorageKey('BOB', 13, 'medium'),
        'spaceAdventure_mp_history_v1',
        'asteroids_upgrades_BOB',
    ];
    assert.deepEqual(TA.parseGhostKey(keys[0]), { owner: 'BOB', course: 3, difficulty: 'medium' });
    assert.equal(TA.parseGhostKey('nope'), null);
    assert.deepEqual(TA.ghostKeysForCourse(keys, 3, 'MEDIUM'), [keys[0], keys[1]]);
    assert.deepEqual(ghostKeysForUser(keys, 'bob'), [keys[0], keys[2], keys[3]]);
});

function recordRun(score, { viewSize = 800, owner = 'BOB', date = 1 } = {}) {
    const rec = new GhostRecorder({ worldWidth: W, worldHeight: H, viewSize });
    for (let t = 0; t <= 3000; t += 50) rec.update(50, { x: 100 + t / 10, y: 200, rotation: 0, thrusting: true }, Math.floor(score * t / 3000));
    return TA.makeGhostRecord(rec.encode(), { owner, course: 3, difficulty: 'Medium', date });
}

test('makeGhostRecord / isGhostRecord / isBetterRun', () => {
    const r = recordRun(500);
    assert.equal(r.owner, 'BOB');
    assert.equal(r.course, 3);
    assert.equal(r.difficulty, 'medium');
    assert.equal(r.viewSize, 800);
    assert.ok(TA.isGhostRecord(r));
    assert.ok(TA.isGhostRecord(JSON.parse(JSON.stringify(r))));
    assert.equal(TA.isGhostRecord({ v: 1 }), false);
    assert.equal(TA.isGhostRecord(null), false);
    assert.equal(TA.isBetterRun(10, null), true, 'the first run is always kept');
    assert.equal(TA.isBetterRun(0, null), true);
    assert.equal(TA.isBetterRun(600, r), true);
    assert.equal(TA.isBetterRun(500, r), false, 'a tie keeps the older run');
    assert.equal(TA.isBetterRun(400, r), false);
    assert.ok(decodeGhost(JSON.stringify(r)), 'the stored record still decodes');
});

test('pickBestGhost: highest score of any profile, ties to the earlier run, corrupt entries skipped', () => {
    const bob = { key: ghostStorageKey('BOB', 3, 'medium'), record: recordRun(500, { owner: 'BOB', date: 5 }) };
    const alice = { key: ghostStorageKey('ALICE', 3, 'medium'), record: recordRun(700, { owner: 'ALICE', date: 9 }) };
    const carol = { key: ghostStorageKey('CAROL', 3, 'medium'), record: recordRun(700, { owner: 'CAROL', date: 2 }) };
    assert.equal(TA.pickBestGhost([]), null);
    assert.equal(TA.pickBestGhost([bob, alice]).owner, 'ALICE');
    assert.equal(TA.pickBestGhost([bob, alice, carol]).owner, 'CAROL');
    assert.equal(TA.pickBestGhost([{ key: 'x', record: { junk: true } }, bob]).owner, 'BOB');
});

test('pace: delta, readout and GhostPlayer score lookup in game time', () => {
    const r = recordRun(300);
    const gp = new GhostPlayer(decodeGhost(r), { worldWidth: W, worldHeight: H });
    assert.equal(gp.scoreAt(0), 0);
    const at2s = gp.scoreAt(2000); // the score as recorded when game time reached 2 s
    assert.ok(at2s > 150 && at2s <= 200, String(at2s));
    assert.ok(gp.scoreAt(2000) > gp.scoreAt(1000));
    assert.equal(TA.paceDelta(at2s + 140, at2s), 140);
    assert.equal(TA.paceDelta(at2s - 80, at2s), -80);
    assert.equal(TA.formatPace(140), 'Ghost +140');
    assert.equal(TA.formatPace(-80), 'Ghost -80');
    assert.equal(TA.formatPace(0), 'Ghost ±0');
    const s = gp.sampleAt(1000);
    assert.ok(Math.abs(s.x - 200) < 10, String(s.x)); // sampled within one frame of 1 s
    assert.equal(s.alive, true);
});

test('screen size notice only beyond 10%; clock format; owner colour is stable', () => {
    assert.equal(TA.viewSizeDiffers(800, 800), false);
    assert.equal(TA.viewSizeDiffers(800, 870), false);
    assert.equal(TA.viewSizeDiffers(800, 900), true);
    assert.equal(TA.viewSizeDiffers(800, 700), true);
    assert.equal(TA.viewSizeDiffers(0, 700), false, 'unknown size: no notice');
    assert.equal(TA.formatClock(180), '3:00');
    assert.equal(TA.formatClock(65.2), '1:06');
    assert.equal(TA.formatClock(-3), '0:00');
    const colours = ['#a', '#b', '#c', '#d'];
    assert.equal(TA.ownerColour('bob', colours), TA.ownerColour('BOB', colours));
    assert.ok(colours.includes(TA.ownerColour('ALICE', colours)));
    assert.equal(TA.ownerColour('X', []), '#FFFFFF');
});

test('summarizeRun: banner and lines for new best, ghost beaten and no ghost', () => {
    const first = TA.summarizeRun({ score: 120, ghost: null, newBest: true, previousBest: null });
    assert.equal(first.banner, 'NEW BEST!');
    assert.equal(first.delta, null);
    assert.match(first.lines.join(' '), /No ghost yet/);
    const beat = TA.summarizeRun({ score: 900, ghost: { owner: 'ALICE', score: 760 }, newBest: false, previousBest: 1000 });
    assert.equal(beat.banner, 'GHOST BEATEN!');
    assert.equal(beat.delta, 140);
    assert.match(beat.lines[0], /ALICE.*beat by 140/);
    const lost = TA.summarizeRun({ score: 680, ghost: { owner: 'ALICE', score: 760 }, newBest: true, previousBest: 500 });
    assert.equal(lost.banner, 'NEW BEST!');
    assert.match(lost.lines.join(' '), /short by 80.*was 500/);
    assert.equal(TA.TIME_ATTACK.runSeconds, 180);
});
