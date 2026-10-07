// Rules of the 3D game (docs/plans/07-3d-game.md §2): difficulty, level contents, incoming
// rock timing, crystal sizes and scores, lives, respawn and level timing. Pure and DOM-free.
//
// The 3D game follows the 2D rules (owner decision 2026-10-08): the Easy / Medium / Hard
// numbers, crystal scores, combos, the extra-life score and the 2 s respawn delay with 3 s
// of protection are the 2D values. What differs is where the danger comes from (§2.1): most
// red rocks sit in clusters with the crystals, and some arrive during the level as incoming
// rocks aimed at the ship. Each level is a fixed set of rocks; it ends when none is left.
//
// The adaptive difficulty (2D DynamicDifficulty, js/difficulty.js) is passed in as a plain
// `dda` object with its modifier fields; anything missing counts as 1 (no adjustment).

/** Easy / Medium / Hard: the 2D table (js/main.js Difficulty) plus the 3D incoming-rock timing. */
export const DIFFICULTY_3D = Object.freeze({
    easy: Object.freeze({
        id: 'easy', name: 'Easy', asteroidSpeedMultiplier: 0.8, ufoSpawnMultiplier: 1.5, ufoAccuracy: 0.6,
        startingLives: 4, scoreMultiplier: 0.75, incomingInterval: 8.5,
    }),
    medium: Object.freeze({
        id: 'medium', name: 'Medium', asteroidSpeedMultiplier: 1.0, ufoSpawnMultiplier: 1.0, ufoAccuracy: 0.8,
        startingLives: 3, scoreMultiplier: 1.0, incomingInterval: 5.5,
    }),
    hard: Object.freeze({
        id: 'hard', name: 'Hard', asteroidSpeedMultiplier: 1.2, ufoSpawnMultiplier: 0.7, ufoAccuracy: 0.95,
        startingLives: 2, scoreMultiplier: 1.5, incomingInterval: 4,
    }),
});
export const DEFAULT_DIFFICULTY_3D = 'medium';

/** The 2D DynamicDifficulty modifier fields, all neutral. */
export const NEUTRAL_DDA = Object.freeze({
    asteroidSpeedMod: 1, ufoSpawnMod: 1, ufoAccuracyMod: 1, powerUpSpawnMod: 1, greenRatioMod: 1, extraLifeThresholdMod: 1,
});

/** A full modifier set from a partial (or missing) one. */
export function ddaOf(dda) {
    const out = { ...NEUTRAL_DDA };
    if (dda) for (const k of Object.keys(NEUTRAL_DDA)) if (Number.isFinite(dda[k])) out[k] = dda[k];
    return out;
}

export function difficultyOf(id) {
    return DIFFICULTY_3D[id] || DIFFICULTY_3D[DEFAULT_DIFFICULTY_3D];
}

export const RULES3D = Object.freeze({
    extraLifeScore: 10000,     // 2D EXTRA_LIFE_SCORE
    respawnDelay: 2,           // 2D RESPAWN_DELAY: seconds without a ship after losing a life
    respawnInvulnerable: 3,    // 2D: protection after a respawn
    levelInvulnerable: 3,      // protection while a new level's field appears around the ship
    shieldGrace: 1,            // 2D: protection after a shield absorbs a hit
    respawnPush: 150,          // rocks this close to a respawning ship are pushed out
    bannerSeconds: 2.5,        // "LEVEL N" banner
    lastRocks: 5,              // at or below this many rocks left, all are on the radar and get arrows
    bossEvery: 2,              // 2D BOSS_LEVEL_INTERVAL (the boss itself comes in Phase 3)
    bossFieldShare: 0.4,       // 2D: 40 % of the rocks on a boss level
    maxIncomingInFlight: 4,
    incomingMinInterval: 3,
    incomingPerLevel: 0.4,     // seconds less between incoming rocks per level
    incomingHoldAfterRespawn: 3,
    incomingCone: 35,          // degrees: half angle of the cone around the ship's motion they come from
    incomingStill: 40,         // below this ship speed they come from any direction
    incomingSpeed: [130, 190], // level 1, before the difficulty and adaptive multipliers
    incomingSpeedPerLevel: 0.04,
    incomingMiss: 1.75,        // aim offset: uniform in a disc of this × (rock + ship radius): about a third would hit a ship that holds its course
});

/**
 * Crystal sizes: the 2D green scores (js/asteroid.js greenScore), smaller radii for 3D.
 * Crystals don't split; shooting one destroys it with no points ("wasted"), as in 2D.
 */
export const CRYSTAL_SIZES = Object.freeze({
    large: Object.freeze({ radius: 22, score: 100 }),
    medium: Object.freeze({ radius: 16, score: 50 }),
    small: Object.freeze({ radius: 12, score: 25 }),
});
const CRYSTAL_MIX = [['large', 0.4], ['medium', 0.35], ['small', 0.25]];

export const isBossLevel = (level) => level > 0 && level % RULES3D.bossEvery === 0;

/**
 * What a level contains (the same for every view distance: a bigger cube only spreads it out).
 * @returns {{
 *   level, difficulty, speedMult, clusters: number, clusterRocks: {large, medium, small},
 *   scattered: number, greens: number, clusterGreenShare: number, crystalMix: Array,
 *   incoming: { count, interval, speed: [min, max], sizeMix }
 * }}
 */
export function levelPlan(level = 1, { difficulty = DEFAULT_DIFFICULTY_3D, dda = null, boss = false } = {}) {
    const L = Math.max(1, level | 0);
    const d = difficultyOf(difficulty);
    const m = ddaOf(dda);
    const speedMult = d.asteroidSpeedMultiplier * m.asteroidSpeedMod;
    const share = boss ? RULES3D.bossFieldShare : 1;
    const scale = (n) => Math.max(1, Math.round(n * share));
    const clusters = scale(3 + Math.floor((L - 1) / 2));
    const clusterRocks = { large: Math.floor((L - 1) / 3), medium: 2 + Math.floor((L - 1) / 2), small: 3 };
    const scattered = scale(3 + Math.floor((L - 1) / 2));
    // Green share: the 2D adaptive greenRatioMod (more crystals for a struggling player)
    const greens = scale(Math.round((14 + 2 * (L - 1)) * m.greenRatioMod));
    const interval = Math.max(RULES3D.incomingMinInterval, d.incomingInterval - RULES3D.incomingPerLevel * (L - 1));
    const sp = speedMult * (1 + RULES3D.incomingSpeedPerLevel * (L - 1));
    return {
        level: L,
        difficulty: d.id,
        speedMult,
        clusters,
        clusterRocks,
        scattered,
        greens,
        clusterGreenShare: 0.7,
        crystalMix: CRYSTAL_MIX,
        incoming: {
            count: scale(22 + 2 * (L - 1)),
            interval,
            speed: [RULES3D.incomingSpeed[0] * sp, RULES3D.incomingSpeed[1] * sp],
            sizeMix: [['large', 0.05], ['medium', 0.3], ['small', 0.65]],
        },
    };
}

/** Rocks a level starts with, counted the way the HUD counts them (incoming included). */
export function planRockCount(plan) {
    const perCluster = plan.clusterRocks.large + plan.clusterRocks.medium + plan.clusterRocks.small;
    return plan.clusters * perCluster + plan.scattered + plan.greens + plan.incoming.count;
}

/** Score for collecting a crystal: the 2D formula (size × difficulty, ×2 multiplier power-up, × combo, + streak). */
export function crystalScore(size, { difficulty = DEFAULT_DIFFICULTY_3D, multiplier = false, comboMultiplier = 1, streakBonus = 0 } = {}) {
    const base = (CRYSTAL_SIZES[size] || CRYSTAL_SIZES.large).score;
    let pts = Math.round(base * difficultyOf(difficulty).scoreMultiplier);
    if (multiplier) pts *= 2;
    pts *= comboMultiplier;
    return pts + streakBonus;
}

/** Next extra-life threshold after one was awarded (2D: +10000 × the adaptive modifier). */
export function nextExtraLife(current, dda = null) {
    return current + Math.round(RULES3D.extraLifeScore * ddaOf(dda).extraLifeThresholdMod);
}
