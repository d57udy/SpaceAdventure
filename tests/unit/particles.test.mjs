import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { Particles, ParticleShape } = await import('../../js/particles.js');

beforeEach(() => Particles.clear());

test('shatter emits 8-12 tumbling shards in the given colour', () => {
    for (const [asked, expected] of [[10, 10], [2, 8], [30, 12]]) {
        Particles.clear();
        Particles.shatter(5, 6, '#FF9500', asked);
        assert.equal(Particles.particles.length, expected);
        for (const p of Particles.particles) {
            assert.equal(p.shape, ParticleShape.SHARD);
            assert.equal(p.color, '#FF9500');
            assert.notEqual(p.spin, undefined);
        }
    }
});

test('collect emits round dots plus one expanding ring; countByShape reports them', () => {
    Particles.collect(0, 0, '#3DB7FF');
    assert.deepEqual(Particles.countByShape(), { dot: 12, shard: 0, ring: 1 });
});

test('update moves, spins and expires particles', () => {
    Particles.shatter(0, 0, '#FFF');
    const a0 = Particles.particles.map((p) => p.angle);
    Particles.update(0.1);
    assert.ok(Particles.particles.some((p, i) => p.angle !== a0[i]));
    Particles.update(1);
    assert.equal(Particles.particles.length, 0);
});

test('draw strokes shards and rings, fills dots', () => {
    const calls = [];
    const ctx = new Proxy({}, {
        get: (t, k) => (k in t ? t[k] : (...a) => calls.push(k)),
        set: (t, k, v) => { t[k] = v; return true; },
    });
    Particles.shatter(0, 0, '#F00', 8);
    Particles.draw(ctx, 0, 0);
    assert.equal(calls.filter((c) => c === 'stroke').length, 8);
    assert.equal(calls.filter((c) => c === 'fill').length, 0);
    calls.length = 0;
    Particles.clear();
    Particles.collect(0, 0);
    Particles.draw(ctx, 0, 0);
    assert.equal(calls.filter((c) => c === 'fill').length, 12);
    assert.equal(calls.filter((c) => c === 'stroke').length, 1);
});
