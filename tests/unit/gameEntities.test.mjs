import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { Entity } = await import('../../js/entity.js');
const { Bullet } = await import('../../js/bullet.js');
const { Asteroid } = await import('../../js/asteroid.js');
const { PowerUp, PowerUpType } = await import('../../js/powerup.js');

afterEach(() => { Entity.worldWidth = 0; Entity.worldHeight = 0; });

// --- Bullet ---
test('Bullet: constructor and speed constants', () => {
    const b = new Bullet(1, 2, 3, 4);
    assert.equal(b.radius, 2);
    assert.equal(b.isPlayerBullet, true);
    assert.equal(new Bullet(0, 0, 0, 0, false).isPlayerBullet, false);
    assert.equal(Bullet.PLAYER_SPEED, 500);
    assert.equal(Bullet.UFO_SPEED, 350);
    assert.ok(b instanceof Entity);
});

test('Bullet: moves and expires after its lifetime', () => {
    const b = new Bullet(0, 0, 100, 0);
    b.update(1.0, 800, 600);
    assert.equal(b.x, 100);
    assert.equal(b.isAlive, true);
    b.update(0.19, 800, 600);
    assert.equal(b.isAlive, true);
    b.update(0.02, 800, 600); // total 1.21 > 1.2
    assert.equal(b.isAlive, false);
});

test('Bullet: is not killed at canvas edges (infinite world)', () => {
    const b = new Bullet(0, 0, 10000, 0);
    b.update(0.1, 800, 600);
    assert.equal(b.x, 1000);
    assert.equal(b.isAlive, true);
});

test('Bullet: destroy marks dead and can be called repeatedly', () => {
    const b = new Bullet(0, 0, 0, 0);
    b.destroy();
    b.destroy();
    assert.equal(b.isAlive, false);
});

// --- Asteroid ---
const { Sizes, Types } = Asteroid;

test('Asteroid: explicit type, size, velocity and score value', () => {
    const g = new Asteroid(0, 0, Sizes.LARGE, { x: 1, y: 2 }, 1, Types.GREEN);
    assert.equal(g.radius, 40);
    assert.equal(g.velX, 1);
    assert.equal(g.velY, 2);
    assert.equal(g.scoreValue, 100);
    assert.equal(g.isGreen(), true);
    assert.equal(g.isRed(), false);
    const r = new Asteroid(0, 0, Sizes.SMALL, null, 1, Types.RED);
    assert.equal(r.scoreValue, 0);
    assert.equal(r.isRed(), true);
    assert.equal(r.shapeVertices.length, Sizes.SMALL.points);
});

test('Asteroid: random velocity speed = base * multiplier * size multiplier', () => {
    const a = new Asteroid(0, 0, Sizes.MEDIUM, null, 2, Types.RED);
    const speed = Math.hypot(a.velX, a.velY);
    assert.ok(Math.abs(speed - 30 * 2 * 1.5) < 1e-9, `speed ${speed}`);
});

test('Asteroid: random type is 60/40 green/red based on Math.random', (t) => {
    t.mock.method(Math, 'random', () => 0.59);
    assert.equal(new Asteroid(0, 0).type, Types.GREEN);
    Math.random.mock.mockImplementation(() => 0.6);
    assert.equal(new Asteroid(0, 0).type, Types.RED);
});

test('Asteroid: shape vertices lie within [0.6r, r]', () => {
    const a = new Asteroid(0, 0, Sizes.LARGE, null, 1, Types.RED);
    for (const v of a.shapeVertices) {
        const d = Math.hypot(v.x, v.y);
        assert.ok(d <= 40 + 1e-9 && d >= 40 * 0.6 - 1e-9, `vertex dist ${d}`);
    }
});

test('Asteroid.split: red LARGE -> two red MEDIUM children', () => {
    const a = new Asteroid(10, 20, Sizes.LARGE, { x: 5, y: 5 }, 1, Types.RED);
    const arr = [];
    const kids = a.split(arr);
    assert.equal(kids.length, 2);
    assert.deepEqual(arr, kids);
    for (const k of kids) {
        assert.equal(k.sizeInfo, Sizes.MEDIUM);
        assert.equal(k.radius, 30);
        assert.equal(k.type, Types.RED);
        assert.equal(k.x, 10);
        assert.equal(k.y, 20);
        assert.equal(k.isAlive, true);
    }
    assert.equal(a.isAlive, false);
});

test('Asteroid.split: red MEDIUM -> two red SMALL children', (t) => {
    // Force Math.random high so a missing type would randomly be RED anyway? no: force GREEN range
    // to prove the child type is explicitly RED, not random.
    const a = new Asteroid(0, 0, Sizes.MEDIUM, { x: 0, y: 0 }, 1, Types.RED);
    t.mock.method(Math, 'random', () => 0.1);
    const kids = a.split([]);
    assert.equal(kids.length, 2);
    assert.ok(kids.every(k => k.sizeInfo === Sizes.SMALL && k.type === Types.RED));
});

test('Asteroid.split: red SMALL and any GREEN produce no children', () => {
    for (const [size, type] of [[Sizes.SMALL, Types.RED], [Sizes.LARGE, Types.GREEN], [Sizes.SMALL, Types.GREEN]]) {
        const a = new Asteroid(0, 0, size, { x: 0, y: 0 }, 1, type);
        const arr = [];
        assert.deepEqual(a.split(arr), []);
        assert.equal(arr.length, 0);
        assert.equal(a.isAlive, false);
    }
});

test('Asteroid.split: dead asteroid returns [] and does not play sound', () => {
    const a = new Asteroid(0, 0, Sizes.LARGE, { x: 0, y: 0 }, 1, Types.RED);
    a.destroy();
    let played = 0;
    const arr = [];
    assert.deepEqual(a.split(arr, { playAsteroidExplosion: () => played++ }), []);
    assert.equal(arr.length, 0);
    assert.equal(played, 0);
});

test('Asteroid.split: plays explosion sound with size info', () => {
    const a = new Asteroid(0, 0, Sizes.MEDIUM, { x: 0, y: 0 }, 1, Types.GREEN);
    const calls = [];
    a.split([], { playAsteroidExplosion: (s) => calls.push(s) });
    assert.deepEqual(calls, [Sizes.MEDIUM]);
});

test('Asteroid.updateInfinite: moves/rotates alive asteroids, skips dead ones', () => {
    const a = new Asteroid(0, 0, Sizes.SMALL, { x: 10, y: -10 }, 1, Types.GREEN);
    a.rotationSpeed = 1;
    const pulse = a.pulseTimer;
    a.updateInfinite(2);
    assert.deepEqual([a.x, a.y, a.rotation], [20, -20, 2]);
    assert.equal(a.pulseTimer, pulse + 4);
    a.destroy();
    a.updateInfinite(2);
    assert.deepEqual([a.x, a.y], [20, -20]);
});

// --- PowerUp ---
const ALL_TYPES = Object.values(PowerUpType);

test('PowerUpType entries are well-formed with unique ids', () => {
    const ids = new Set();
    for (const t of ALL_TYPES) {
        assert.equal(typeof t.id, 'string');
        assert.equal(typeof t.name, 'string');
        assert.match(t.color, /^#[0-9A-F]{6}$/i);
        assert.ok(t.duration >= 0);
        assert.ok(t.symbol.length > 0);
        ids.add(t.id);
    }
    assert.equal(ids.size, ALL_TYPES.length);
});

test('PowerUp: random type is always a valid PowerUpType (incl. Math.random edges)', (t) => {
    for (let i = 0; i < 200; i++) assert.ok(ALL_TYPES.includes(new PowerUp(0, 0).type));
    t.mock.method(Math, 'random', () => 0);
    assert.equal(new PowerUp(0, 0).type, ALL_TYPES[0]);
    Math.random.mock.mockImplementation(() => 0.9999999);
    assert.equal(new PowerUp(0, 0).type, ALL_TYPES[ALL_TYPES.length - 1]);
});

test('PowerUp.getRandomType: weighted buckets map to expected types', (t) => {
    const cases = [
        [0, PowerUpType.EXTRA_LIFE], [0.049, PowerUpType.EXTRA_LIFE],
        [0.05, PowerUpType.SHIELD], [0.149, PowerUpType.SHIELD],
        [0.15, PowerUpType.TRIPLE_SHOT], [0.3, PowerUpType.RAPID_FIRE],
        [0.5, PowerUpType.SPEED_BOOST], [0.7, PowerUpType.MAGNET],
        [0.85, PowerUpType.SCORE_MULTIPLIER], [0.9999, PowerUpType.SCORE_MULTIPLIER],
    ];
    const m = t.mock.method(Math, 'random', () => 0);
    for (const [r, expected] of cases) {
        m.mock.mockImplementation(() => r);
        assert.equal(PowerUp.getRandomType(), expected, `rand=${r}`);
    }
    m.mock.restore();
    for (let i = 0; i < 200; i++) assert.ok(ALL_TYPES.includes(PowerUp.getRandomType()));
});

test('PowerUp: spawnType and spawnRandom', () => {
    const p = PowerUp.spawnType(5, 6, PowerUpType.SHIELD);
    assert.equal(p.type, PowerUpType.SHIELD);
    assert.deepEqual([p.x, p.y, p.radius], [5, 6, 12]);
    for (let i = 0; i < 100; i++) {
        const r = PowerUp.spawnRandom(1000, 800, 50);
        assert.ok(r.x >= 50 && r.x < 950 && r.y >= 50 && r.y < 750);
        assert.ok(ALL_TYPES.includes(r.type));
    }
});

test('PowerUp: expires after 15 seconds and does not move', () => {
    const p = new PowerUp(1, 1, PowerUpType.MAGNET);
    p.velX = 100;
    p.update(14.9);
    assert.equal(p.isAlive, true);
    assert.equal(p.x, 1);
    p.update(0.1);
    assert.equal(p.isAlive, false);
});
