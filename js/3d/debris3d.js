// Explosion debris for the 3D game (docs/plans/07-3d-game.md Phase 2): small fragments
// thrown out when a rock splits or is destroyed, in the rock type's palette colour. A fixed
// pool (no allocation while playing; the oldest piece is reused when it is full), short
// life. Pure and DOM-free: render3d.js draws the pool with one InstancedMesh.

export const DEBRIS3D = Object.freeze({
    max: 240,                 // pieces at once (plan 07 §5: at most 400 particles with the sparkles)
    life: 0.6,                // s
    speed: [40, 150],         // units/s, plus the rock's own velocity
    counts: Object.freeze({ large: 16, medium: 11, small: 7, crystal: 8 }),
    sizes: Object.freeze({ large: 4.5, medium: 3.5, small: 2.6, crystal: 2.4 }),
});

/** '#RRGGBB' -> [r, g, b] in 0..1 (white for anything else). */
export function hexToRgb01(hex) {
    if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return [1, 1, 1];
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Pieces for a rock size ('large' | 'medium' | 'small' | 'crystal'). */
export function debrisCount(size) {
    return DEBRIS3D.counts[size] || DEBRIS3D.counts.small;
}

/**
 * @param {object} [o]
 * @param {number} [o.max]
 * @param {() => number} [o.rand] - 0..1 (seeded in render3d.js: the look never depends on Math.random)
 */
export function createDebrisPool({ max = DEBRIS3D.max, rand = Math.random } = {}) {
    const slots = [];
    for (let i = 0; i < max; i++) {
        slots.push({ pos: [0, 0, 0], vel: [0, 0, 0], axis: [0, 1, 0], angle: 0, spin: 0, life: 0, max: 1, scale: 1, color: [1, 1, 1] });
    }
    let n = 0;      // active pieces are slots[0 .. n)
    let next = 0;   // when full: the slot reused next (round robin, roughly the oldest)

    function unit() {
        const z = rand() * 2 - 1, t = rand() * Math.PI * 2, s = Math.sqrt(1 - z * z);
        return [s * Math.cos(t), z, s * Math.sin(t)];
    }

    return {
        get count() { return n; },
        get capacity() { return max; },
        /**
         * Throw out pieces at `pos` (world). o: { size, color: '#RRGGBB' or [r,g,b], vel: the rock's velocity }
         * @returns {number} pieces added
         */
        spawn(pos, { size = 'small', color = '#FFFFFF', vel = [0, 0, 0] } = {}) {
            const rgb = Array.isArray(color) ? color : hexToRgb01(color);
            const k = debrisCount(size);
            const sc = DEBRIS3D.sizes[size] || DEBRIS3D.sizes.small;
            for (let i = 0; i < k; i++) {
                let p;
                if (n < max) p = slots[n++];
                else { p = slots[next]; next = (next + 1) % max; }
                const d = unit();
                const sp = DEBRIS3D.speed[0] + rand() * (DEBRIS3D.speed[1] - DEBRIS3D.speed[0]);
                p.pos[0] = pos[0]; p.pos[1] = pos[1]; p.pos[2] = pos[2];
                p.vel[0] = vel[0] + d[0] * sp; p.vel[1] = vel[1] + d[1] * sp; p.vel[2] = vel[2] + d[2] * sp;
                const a = unit();
                p.axis[0] = a[0]; p.axis[1] = a[1]; p.axis[2] = a[2];
                p.angle = rand() * Math.PI * 2;
                p.spin = (rand() * 2 - 1) * 12;
                p.max = DEBRIS3D.life * (0.7 + rand() * 0.3);
                p.life = p.max;
                p.scale = sc * (0.6 + rand() * 0.8);
                p.color[0] = rgb[0]; p.color[1] = rgb[1]; p.color[2] = rgb[2];
            }
            return k;
        },
        /** Age and move every piece; dead ones are swapped out of the active range. */
        step(dt) {
            if (!(dt > 0)) return;
            for (let i = n - 1; i >= 0; i--) {
                const p = slots[i];
                p.life -= dt;
                if (p.life <= 0) {
                    n--;
                    slots[i] = slots[n];
                    slots[n] = p;
                    continue;
                }
                p.pos[0] += p.vel[0] * dt; p.pos[1] += p.vel[1] * dt; p.pos[2] += p.vel[2] * dt;
                p.angle += p.spin * dt;
            }
            if (next >= n) next = 0;
        },
        /** fn(piece, fade 0..1) for every active piece. */
        forEach(fn) {
            for (let i = 0; i < n; i++) fn(slots[i], slots[i].life / slots[i].max);
        },
        clear() { n = 0; next = 0; },
    };
}
