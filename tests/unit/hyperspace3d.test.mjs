import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHyperspace, tryHyperspace, tickHyperspace, hyperspaceReady, HYPERSPACE3D } from '../../js/3d/hyperspace3d.js';
import { mulberry32 } from '../../js/rng.js';
import { vLen } from '../../js/3d/math3d.js';
import { nearestDelta } from '../../js/3d/world3d.js';

const SIZE = 3200;
const C = [1600, 1600, 1600];
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

test('2D numbers: 5 s cooldown, 10 % self-destruct', () => {
    assert.equal(HYPERSPACE3D.cooldown, 5);
    assert.equal(HYPERSPACE3D.selfDestructChance, 0.1);
});

test('a jump lands clear of rocks, starts the cooldown; not ready until it runs out', () => {
    const h = createHyperspace();
    const rand = mulberry32(3);
    const rocks = Array.from({ length: 300 }, () => ({ pos: [rand() * SIZE, rand() * SIZE, rand() * SIZE], radius: 42 }));
    let r;
    do { r = tryHyperspace(createHyperspace(), { rand, size: SIZE, shipPos: C, obstacles: rocks }); } while (r.result !== 'ok');
    for (const o of rocks) assert.ok(vLen(nearestDelta(r.pos, o.pos, SIZE)) >= HYPERSPACE3D.clearance - 1e-6);
    const ok = tryHyperspace(h, { rand: seq(0.5, 0.1, 0.2, 0.3), size: SIZE, shipPos: C, obstacles: [] });
    assert.equal(ok.result, 'ok');
    assert.equal(hyperspaceReady(h), false);
    assert.equal(tryHyperspace(h, { rand, size: SIZE, shipPos: C }).result, 'notReady');
    tickHyperspace(h, 4.9);
    assert.equal(hyperspaceReady(h), false);
    tickHyperspace(h, 0.2);
    assert.equal(hyperspaceReady(h), true);
});

test('self-destruct about 10 % of jumps; no cooldown after a failed jump (as 2D)', () => {
    const rand = mulberry32(8);
    let bad = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) {
        const h = createHyperspace();
        const r = tryHyperspace(h, { rand, size: SIZE, shipPos: C });
        if (r.result === 'selfDestruct') { bad++; assert.equal(h.cooldown, 0); }
    }
    assert.ok(Math.abs(bad / n - 0.1) < 0.015, `${bad / n}`);
    assert.equal(tryHyperspace(createHyperspace(), { rand: seq(0.05), size: SIZE, shipPos: C }).result, 'selfDestruct');
});

test('nowhere clear: materialising inside a rock destroys the ship', () => {
    // One huge rock fills the world: spawnPoint falls back to its best try, which is inside it
    const h = createHyperspace();
    const r = tryHyperspace(h, { rand: mulberry32(1), size: 400, shipPos: [200, 200, 200], obstacles: [{ pos: [200, 200, 200], radius: 1000 }] });
    // The first roll may be the self-destruct; retry until the destination roll happens
    let res = r;
    for (let s = 2; res.result === 'selfDestruct'; s++) res = tryHyperspace(createHyperspace(), { rand: mulberry32(s), size: 400, shipPos: [200, 200, 200], obstacles: [{ pos: [200, 200, 200], radius: 1000 }] });
    assert.equal(res.result, 'materialised');
    assert.ok(res.into);
    assert.equal(h.failures >= 0, true);
});

// --- Regression test for docs/plans/07-review.md
import { clearPoint } from '../../js/3d/hyperspace3d.js';

test('review #4: the clearance is kept from each obstacle\'s edge (a big boss too)', () => {
    const boss = { kind: 'boss', pos: C, radius: 150 };
    // Draws that put the first try 130 from the boss centre: inside its radius + ship
    const first = [(C[0] + 130) / SIZE, C[1] / SIZE, C[2] / SIZE];
    const far = [0.1, 0.1, 0.1];
    const p = clearPoint(seq(...first, ...far), SIZE, [boss], HYPERSPACE3D.clearance);
    assert.ok(vLen(nearestDelta(C, p, SIZE)) - boss.radius >= HYPERSPACE3D.clearance, 'the second try, far from the boss');
    // A jump next to the boss never materialises inside it
    let inside = 0;
    for (let seed = 1; seed <= 400; seed++) {
        const rand = mulberry32(seed);
        const obstacles = [boss, ...Array.from({ length: 40 }, () => ({ pos: [rand() * SIZE, rand() * SIZE, rand() * SIZE], radius: 30 }))];
        const r = tryHyperspace(createHyperspace(), { rand, size: SIZE, shipPos: [0, 0, 0], obstacles });
        if (r.result === 'materialised' && r.into === boss) inside++;
    }
    assert.equal(inside, 0);
});
