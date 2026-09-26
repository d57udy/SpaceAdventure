import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    GhostRecorder, GhostPlayer, encodeGhost, decodeGhost, decode, bytesToBase64, base64ToBytes,
    ghostStorageKey, SAMPLE_INTERVAL_MS, GHOST_VERSION,
} from '../../js/ghost.js';

const W = 1035; // 1.5 x 690 view
const H = 1035;
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} expected ${b}, got ${a}`);
const angDiff = (a, b) => {
    let d = (a - b) % (2 * Math.PI);
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d);
};

function recordRun(ms, frameMs = 16, fn) {
    const rec = new GhostRecorder({ worldWidth: W, worldHeight: H, viewSize: 690 });
    for (let t = 0; t <= ms; t += frameMs) {
        const s = fn(t);
        rec.update(frameMs, s.ship, s.score);
    }
    return rec;
}

test('samples every 100 ms of accumulated game time, independent of frame rate', () => {
    const a = recordRun(1000, 16, (t) => ({ ship: { x: t / 10, y: 50, rotation: 0 }, score: 0 }));
    const b = recordRun(1000, 33, (t) => ({ ship: { x: t / 10, y: 50, rotation: 0 }, score: 0 }));
    near(a.sampleCount, 11, 1);
    near(b.sampleCount, 11, 1);
    const rec = new GhostRecorder({ worldWidth: W, worldHeight: H });
    for (let i = 0; i < 5; i++) rec.update(10, { x: 1, y: 1, rotation: 0 }, 0);
    assert.equal(rec.sampleCount, 1, 'only the t=0 sample within the first 50 ms');
    rec.update(60, { x: 1, y: 1, rotation: 0 }, 0);
    assert.equal(rec.sampleCount, 2);
});

test('encode/decode round trip keeps position, rotation, flags and score track', () => {
    const rec = new GhostRecorder({ worldWidth: W, worldHeight: H, viewSize: 690 });
    const states = [];
    for (let i = 0; i < 30; i++) {
        const ship = {
            x: (i * 37.3) % W, y: (i * 91.7) % H, rotation: (i * 0.7) % (2 * Math.PI),
            thrusting: i % 3 === 0, alive: i % 7 !== 6,
        };
        states.push(ship);
        // dt is the time since the previous frame, ship is the state now (t = i * 100 ms)
        rec.update(i === 0 ? 0 : SAMPLE_INTERVAL_MS, ship, i * 10);
    }
    const enc = rec.encode();
    assert.equal(enc.v, GHOST_VERSION);
    assert.equal(enc.viewSize, 690);
    assert.equal(typeof enc.data, 'string');
    assert.equal(enc.score, 290);
    // Survives a trip through JSON (as in localStorage)
    const dec = decodeGhost(JSON.stringify(enc));
    assert.ok(dec);
    assert.equal(dec.sampleCount, rec.sampleCount);
    assert.equal(dec.durationMs, enc.durationMs);
    const player = new GhostPlayer(dec, { worldWidth: W, worldHeight: H });
    for (let i = 0; i < 30; i++) {
        const s = player.sampleAt(i * SAMPLE_INTERVAL_MS);
        near(s.x, states[i].x, W / 65536 + 1e-9, `x[${i}]`);
        near(s.y, states[i].y, H / 65536 + 1e-9, `y[${i}]`);
        assert.ok(angDiff(s.rotation, states[i].rotation) <= Math.PI / 256 + 1e-9, `rot[${i}]`);
        assert.equal(s.thrusting, states[i].thrusting, `thrust[${i}]`);
        assert.equal(s.alive, states[i].alive, `alive[${i}]`);
    }
    assert.equal(player.scoreAt(0), 0);
    assert.equal(player.scoreAt(1000), 100);
    assert.equal(player.scoreAt(2500), 200);
});

test('interpolates between samples', () => {
    const enc = encodeGhost({ samples: [toF(100), toF(100), 0, 2, toF(200), toF(300), 0, 2], viewSize: 690 });
    const p = new GhostPlayer(decode(enc), { worldWidth: W, worldHeight: H });
    const mid = p.sampleAt(50);
    near(mid.x, 150, 0.1);
    near(mid.y, 200, 0.1);
    assert.equal(p.sampleAt(100).done, true);
    near(p.sampleAt(9999).x, 200, 0.1, 'clamped to the end');
});

function toF(px, size = W) { return Math.round((px / size) * 65536) & 0xFFFF; }

test('interpolation across the world edge takes the short way', () => {
    // x goes from W-10 to 10 (wrapped): the midpoint is at the edge, not the middle
    const enc = encodeGhost({ samples: [toF(W - 10), toF(500), 0, 2, toF(10), toF(500), 0, 2] });
    const p = new GhostPlayer(decodeGhost(enc), { worldWidth: W, worldHeight: H });
    const mid = p.sampleAt(50);
    assert.ok(mid.x < 1 || mid.x > W - 1, `midpoint near the edge, got ${mid.x}`);
    const q = p.sampleAt(25);
    near(q.x, W - 5, 0.2);
    // y across the top edge too
    const enc2 = encodeGhost({ samples: [toF(500), toF(4), 0, 2, toF(500), toF(H - 4), 0, 2] });
    const p2 = new GhostPlayer(decodeGhost(enc2), { worldWidth: W, worldHeight: H });
    near(p2.sampleAt(25).y, 2, 0.2);
});

test('rotation interpolates the short way round', () => {
    const r = (rad) => Math.round((rad / (2 * Math.PI)) * 256) & 0xFF;
    const enc = encodeGhost({ samples: [0, 0, r(0.1), 2, 0, 0, r(2 * Math.PI - 0.1), 2] });
    const p = new GhostPlayer(decodeGhost(enc), { worldWidth: W, worldHeight: H });
    assert.ok(angDiff(p.sampleAt(50).rotation, 0) < 0.03);
});

test('hyperspace jumps and dead samples snap instead of gliding', () => {
    const enc = encodeGhost({ samples: [toF(100), toF(100), 0, 2, toF(600), toF(600), 0, 2] });
    const p = new GhostPlayer(decodeGhost(enc), { worldWidth: W, worldHeight: H });
    near(p.sampleAt(50).x, 100, 0.1);
    const enc2 = encodeGhost({ samples: [toF(100), toF(100), 0, 0, toF(110), toF(100), 0, 2] });
    const p2 = new GhostPlayer(decodeGhost(enc2), { worldWidth: W, worldHeight: H });
    assert.equal(p2.sampleAt(50).alive, false);
    near(p2.sampleAt(50).x, 100, 0.1);
});

test('plays back scaled to a different world size', () => {
    const enc = encodeGhost({ samples: [toF(W / 2), toF(H / 4), 0, 2], worldWidth: W, worldHeight: H });
    const p = new GhostPlayer(decodeGhost(enc), { worldWidth: 500, worldHeight: 400 });
    const s = p.sampleAt(0);
    near(s.x, 250, 0.1);
    near(s.y, 100, 0.1);
});

test('a 3-minute trace is under 16 KB of base64', () => {
    const rec = recordRun(180000, 16.7, (t) => ({
        ship: { x: (t * 0.37) % W, y: (t * 0.21) % H, rotation: t / 500, thrusting: (t | 0) % 700 < 300, alive: true },
        score: Math.floor(t / 10),
    }));
    const enc = rec.encode();
    const size = JSON.stringify(enc).length;
    assert.ok(rec.sampleCount >= 1800, `samples ${rec.sampleCount}`);
    assert.ok(enc.data.length < 16 * 1024, `data ${enc.data.length}`);
    assert.ok(size < 16 * 1024, `stored ${size}`);
    near(enc.durationMs, 180000, 200);
    const dec = decodeGhost(enc);
    assert.ok(dec);
    assert.equal(dec.scores.length, 181);
});

test('corrupt data returns null', () => {
    const good = encodeGhost({ samples: [1, 2, 3, 2, 4, 5, 6, 2], scores: [0] });
    assert.ok(decodeGhost(good));
    const bad = [
        null, undefined, 42, '', 'not json', '{}', '[]',
        { ...good, v: 99 },
        { ...good, data: 123 },
        { ...good, data: '!!!notbase64!!!' },
        { ...good, data: good.data.slice(0, -4) },          // truncated
        { ...good, data: good.data + 'AAAA' },              // trailing bytes
        { ...good, data: bytesToBase64(new Uint8Array([0x58, 0x48, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 2])) }, // bad magic
        { ...good, data: bytesToBase64(new Uint8Array([0x47, 0x48, 1, 0, 0, 0, 0, 0])) },  // no samples
        { ...good, data: bytesToBase64(new Uint8Array([0x47, 0x48, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0xF0])) }, // bad flags
    ];
    for (const b of bad) assert.equal(decodeGhost(b), null, JSON.stringify(b));
    assert.throws(() => new GhostPlayer(null));
});

test('base64 helpers round trip', () => {
    const bytes = new Uint8Array(70000).map((_, i) => (i * 31) & 0xFF);
    assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
});

test('ghost storage key follows plan §6', () => {
    assert.equal(ghostStorageKey('alice', 3, 'Medium'), 'spaceAdventure_ghost_v1_ALICE_3_medium');
});
