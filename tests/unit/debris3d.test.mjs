// Explosion debris pool (js/3d/debris3d.js): fixed size, short life, colour per rock type.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDebrisPool, debrisCount, hexToRgb01, DEBRIS3D } from '../../js/3d/debris3d.js';
import { mulberry32 } from '../../js/rng.js';

test('pieces per size, colours from palette hex', () => {
    assert.ok(debrisCount('large') > debrisCount('medium') && debrisCount('medium') > debrisCount('small'));
    assert.equal(debrisCount('nonsense'), debrisCount('small'));
    assert.deepEqual(hexToRgb01('#FF0000'), [1, 0, 0]);
    assert.deepEqual(hexToRgb01('bad'), [1, 1, 1]);
});

test('spawn, move, fade and die within the life; the pool never grows', () => {
    const pool = createDebrisPool({ rand: mulberry32(3) });
    assert.equal(pool.capacity, DEBRIS3D.max);
    const n = pool.spawn([0, 0, 0], { size: 'large', color: '#00FF00', vel: [10, 0, 0] });
    assert.equal(pool.count, n);
    let colors = 0;
    pool.forEach((p, fade) => { assert.equal(fade, 1); if (p.color[1] === 1 && p.color[0] === 0) colors++; });
    assert.equal(colors, n);
    pool.step(0.1);
    pool.forEach((p, fade) => { assert.ok(fade < 1 && fade > 0); assert.ok(Math.hypot(...p.pos) > 0); });
    for (let i = 0; i < 10; i++) pool.step(0.06);
    assert.equal(pool.count, 0, `gone after ${DEBRIS3D.life} s`);
    // Full: reuses slots instead of growing
    for (let i = 0; i < 100; i++) pool.spawn([0, 0, 0], { size: 'large' });
    assert.equal(pool.count, DEBRIS3D.max);
    pool.clear();
    assert.equal(pool.count, 0);
});
