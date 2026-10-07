// Hyperspace in the 3D game (docs/plans/07-3d-game.md §2.8), the 2D rules of
// js/player.js hyperspace(): a 5 s cooldown after a jump that worked, a 10 % chance the jump
// destroys the ship, the ship stops (velocity 0), and landing inside a rock or UFO destroys it.
// Pure and DOM-free; random numbers are injected (js/rng.js).
//
// 3D translation: 2D lands anywhere at random and can materialise inside a rock (a 2D
// screen is crowded). The plan asks for a point clear of rocks, so the destination comes from
// world3d spawnPoint with a clearance; the "materialised inside something" check still runs on
// the chosen point (spawnPoint falls back to its best try when nothing is clear), so the
// 2D risk rule stays. The rolls keep the 2D order: self-destruct first, then the destination.

import { vLen } from './math3d.js';
import { nearestDelta, spawnPoint } from './world3d.js';

export const HYPERSPACE3D = Object.freeze({
    cooldown: 5,             // 2D HYPERSPACE_COOLDOWN
    selfDestructChance: 0.1, // 2D HYPERSPACE_SELF_DESTRUCT_CHANCE
    clearance: 120,          // destination at least this far from every rock and UFO
    shipRadius: 9,
});

/** Cooldown state: { cooldown } seconds left. */
export function createHyperspace() {
    return { cooldown: 0, jumps: 0, failures: 0 };
}

export const hyperspaceReady = (h) => h.cooldown <= 0;

/** Count the cooldown down (every step). */
export function tickHyperspace(h, dt) {
    if (h.cooldown > 0) h.cooldown = Math.max(0, h.cooldown - dt);
}

/**
 * Try a jump.
 * @param {object} h - createHyperspace() state
 * @param {object} o - { rand, size, shipPos, obstacles: [{ pos, radius }] (rocks and UFOs) }
 * @returns {{ result: 'notReady' } | { result: 'selfDestruct' } | { result: 'materialised', pos, into }
 *   | { result: 'ok', pos }} pos: where the ship is now (set it and zero its velocity);
 *   'selfDestruct' and 'materialised' cost a life (2D: the ship is destroyed, the jump happened).
 */
export function tryHyperspace(h, { rand, size, shipPos, obstacles = [], shipRadius = HYPERSPACE3D.shipRadius }) {
    if (!hyperspaceReady(h)) return { result: 'notReady' };
    h.jumps++;
    if (rand() < HYPERSPACE3D.selfDestructChance) {
        h.failures++;
        return { result: 'selfDestruct', pos: shipPos.slice() };
    }
    const avoid = obstacles.map(o => o.pos);
    const pos = spawnPoint(rand, size, avoid, HYPERSPACE3D.clearance);
    const into = obstacles.find(o => vLen(nearestDelta(pos, o.pos, size)) <= (o.radius || 0) + shipRadius);
    if (into) {
        h.failures++;
        return { result: 'materialised', pos, into };
    }
    h.cooldown = HYPERSPACE3D.cooldown; // 2D: the cooldown starts after a jump the ship survived
    return { result: 'ok', pos };
}
