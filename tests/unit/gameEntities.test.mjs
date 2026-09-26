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
    assert.equal(r.shapeVertices.length, Sizes.SMALL.points * 2); // star: tips + valleys
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

// --- Asteroid shapes (colour-blind friendly: shape carries the meaning) ---
const { Palettes } = await import('../../js/palette.js');
const dist = (v) => Math.hypot(v.x, v.y);

test('Asteroid: crystal (green) vertices all lie within [0.9r, r], 8-10 vertices', () => {
    for (const size of [Sizes.LARGE, Sizes.MEDIUM, Sizes.SMALL]) {
        for (let n = 0; n < 20; n++) {
            const a = new Asteroid(0, 0, size, null, 1, Types.GREEN);
            assert.ok(a.shapeVertices.length >= 8 && a.shapeVertices.length <= 10, `${a.shapeVertices.length}`);
            for (const v of a.shapeVertices) {
                const d = dist(v);
                assert.ok(d <= size.radius + 1e-9 && d >= size.radius * 0.9 - 1e-9, `crystal vertex ${d}`);
            }
        }
    }
});

test('Asteroid: spiky (red) vertices alternate tips >= 0.95r and valleys <= 0.72r, one tip at r', () => {
    for (const size of [Sizes.LARGE, Sizes.MEDIUM, Sizes.SMALL]) {
        for (let n = 0; n < 20; n++) {
            const a = new Asteroid(0, 0, size, null, 1, Types.RED);
            const r = size.radius;
            assert.equal(a.shapeVertices.length, size.points * 2);
            let atR = 0;
            a.shapeVertices.forEach((v, i) => {
                const d = dist(v);
                assert.ok(d <= r + 1e-9, `vertex beyond hitbox ${d}`);
                if (i % 2 === 0) assert.ok(d >= 0.95 * r - 1e-9, `tip ${d}`);
                else assert.ok(d <= 0.72 * r && d >= 0.55 * r - 1e-9, `valley ${d}`);
                if (Math.abs(d - r) < 1e-9) atR++;
            });
            assert.ok(atR >= 1, 'a tip reaches the full radius (danger never smaller than it looks)');
        }
    }
});

test('Asteroid: red split children are red and spiky', () => {
    const a = new Asteroid(0, 0, Sizes.LARGE, { x: 0, y: 0 }, 1, Types.RED);
    for (const k of a.split([])) {
        assert.equal(k.type, Types.RED);
        assert.equal(k.shapeVertices.length, Sizes.MEDIUM.points * 2);
        const ds = k.shapeVertices.map(dist);
        assert.ok(Math.min(...ds) <= 0.72 * k.radius);
    }
});

// Recording 2D context: logs calls and style assignments
function recordingCtx() {
    const calls = [];
    const styles = { strokeStyle: [], fillStyle: [] };
    const target = { calls, styles };
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return (...args) => { calls.push([prop, ...args]); };
        },
        set(t, prop, value) {
            if (prop in styles) styles[prop].push(value);
            calls.push(['set:' + String(prop), value]);
            return true;
        },
    });
}

test('Asteroid.drawIcon: crystal draws facet lines from the centre, hazard draws the X mark; no Math.random', (t) => {
    const rnd = t.mock.method(Math, 'random', () => { throw new Error('Math.random during rendering'); });
    const g = recordingCtx();
    Asteroid.drawIcon(g, Types.GREEN, 50, 60, 10, Palettes.STANDARD);
    // translate(50, 60) then facets start at the local origin
    assert.deepEqual(g.calls.find((c) => c[0] === 'translate'), ['translate', 50, 60]);
    const facetMoves = g.calls.filter((c) => c[0] === 'moveTo' && c[1] === 0 && c[2] === 0);
    assert.ok(facetMoves.length >= 4, `facets ${facetMoves.length}`);
    assert.ok(g.styles.strokeStyle.some((s) => s.startsWith('rgba(0, 255, 0')));

    const r = recordingCtx();
    Asteroid.drawIcon(r, Types.RED, 50, 60, 10, Palettes.STANDARD);
    assert.equal(r.calls.filter((c) => c[0] === 'moveTo' && c[1] === 0 && c[2] === 0).length, 0);
    const arcs = r.calls.filter((c) => c[0] === 'arc' && c[1] === 0 && c[2] === 0);
    assert.equal(arcs.length, 1, 'hazard mark circle');
    assert.ok(arcs[0][3] < 10);
    const crossLines = r.calls.filter((c) => c[0] === 'lineTo' && Math.abs(Math.abs(c[1]) - Math.abs(c[2])) < 1e-9 && c[1] !== 0);
    assert.ok(crossLines.length >= 2, 'X lines');
    assert.ok(r.styles.strokeStyle.includes('#CC0000'));
    assert.equal(rnd.mock.callCount(), 0);
});

test('Asteroid.draw uses the palette colours after a palette change', (t) => {
    const g = new Asteroid(0, 0, Sizes.LARGE, { x: 0, y: 0 }, 1, Types.GREEN);
    const r = new Asteroid(0, 0, Sizes.LARGE, { x: 0, y: 0 }, 1, Types.RED);
    const before = Asteroid.palette;
    try {
        Asteroid.palette = Palettes.COLOUR_SAFE;
        const c1 = recordingCtx();
        g.draw(c1);
        assert.ok(c1.styles.strokeStyle.some((s) => s.startsWith('rgba(61, 183, 255')), JSON.stringify(c1.styles.strokeStyle));
        assert.ok(!c1.styles.strokeStyle.some((s) => s.startsWith('rgba(0, 255, 0')));
        const c2 = recordingCtx();
        r.draw(c2);
        assert.ok(c2.styles.strokeStyle.includes(Palettes.COLOUR_SAFE.hazard));
        assert.ok(!c2.styles.strokeStyle.includes('#CC0000'));
        Asteroid.palette = Palettes.STANDARD;
        const c3 = recordingCtx();
        r.draw(c3);
        assert.ok(c3.styles.strokeStyle.includes('#CC0000'));
    } finally {
        Asteroid.palette = before;
    }
    // Draw does not call Math.random either
    const rnd = t.mock.method(Math, 'random', () => { throw new Error('random in draw'); });
    g.draw(recordingCtx());
    r.draw(recordingCtx());
    assert.equal(rnd.mock.callCount(), 0);
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
