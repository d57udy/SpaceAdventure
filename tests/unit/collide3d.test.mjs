import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spheresOverlap, segmentSphereT, sweptHit } from '../../js/3d/collide3d.js';

const S = 1000;

test('sphere overlap, also across the seam', () => {
    assert.ok(spheresOverlap([0, 0, 0], 5, [9, 0, 0], 5, S));
    assert.ok(!spheresOverlap([0, 0, 0], 5, [11, 0, 0], 5, S));
    assert.ok(spheresOverlap([2, 500, 500], 5, [995, 500, 500], 5, S), 'wraps');
});

test('segment vs sphere: first contact time', () => {
    assert.equal(segmentSphereT([0, 0, 0], [0, 0, -100], [0, 0, -50], 10), 0.4);
    assert.equal(segmentSphereT([0, 0, 0], [0, 0, -100], [0, 20, -50], 10), -1, 'misses');
    assert.equal(segmentSphereT([0, 0, 0], [0, 0, 100], [0, 0, -50], 10), -1, 'moving away');
    assert.equal(segmentSphereT([0, 0, -50], [0, 0, -1], [0, 0, -50], 10), 0, 'starts inside');
    assert.equal(segmentSphereT([0, 0, 0], [0, 0, -10], [0, 0, -50], 10), -1, 'not reached yet');
});

test('a fast bullet never tunnels through a small rock', () => {
    const speed = 900, dt = 1 / 60;
    const rock = [0, 0, -300];
    const r = 13; // small rock
    let pos = [0, 3, 7];
    let hit = false;
    for (let i = 0; i < 60 && !hit; i++) {
        const move = [0, 0, -speed * dt];
        if (sweptHit(pos, move, rock, r, S) >= 0) hit = true;
        pos = [pos[0], pos[1], pos[2] + move[2]];
    }
    assert.ok(hit);
    // A naive end-of-step point test can miss a thin target at this speed
    const thin = 4;
    let naive = false;
    pos = [0, 0, 0];
    for (let i = 0; i < 60; i++) {
        pos = [0, 0, pos[2] - speed * dt];
        if (Math.abs(pos[2] - -308) <= thin) naive = true;
    }
    assert.equal(naive, false, 'the point test tunnels');
    assert.ok([...Array(60).keys()].some((i) => sweptHit([0, 0, -i * 15], [0, 0, -15], [0, 0, -308], thin, S) >= 0));
});

test('swept hit across the seam', () => {
    const t = sweptHit([995, 500, 500], [15, 0, 0], [6, 500, 500], 5, S);
    assert.ok(t > 0 && t < 1, `t=${t}`);
});
