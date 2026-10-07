// The 3D game simulation: ship physics, bullets, crystals, red rocks, levels, lives.
// Pure and seeded (js/rng.js mulberry32): the same seed and inputs give the same run, so
// unit tests, the balance harness (scripts/balance3d.mjs) and ?seed3d=N screenshots are
// repeatable. Fixed step (1/60 s), separate from rendering.
//
// Rules follow the 2D game (docs/plans/07-3d-game.md §2.5, owner decision 2026-10-08):
// - a level is a fixed set of rocks (rules3d.js levelPlan, spawn3d.js); it ends when no red
//   rock and no crystal is left (and nothing else blocks it: UFOs and the boss, later phases);
// - flying into a crystal collects it (2D score, combo, streak bonus); shooting one destroys
//   it with no points ("wasted"); shooting a red rock splits it (no points, as in 2D);
// - touching a red rock costs a life (the rock splits); a shield absorbs one hit and gives
//   1 s of protection; after a lost life the ship is gone for 2 s, then respawns where it
//   was with 3 s of protection and nearby rocks pushed out; extra life every 10000 points.
// - the adaptive difficulty (the 2D DynamicDifficulty, `adaptive`) is fed as 2D feeds it:
//   shots fired and hit, crystals spawned and collected, red rocks shot, deaths, score; its
//   modifiers apply (incoming rock speed, crystal share and rock speed of the next level,
//   the extra-life score; power-up and UFO modifiers are kept in s.dda for those systems)
//   and its level switches the aids (assist3d.js: aim assist, collection radius).
//
// The ship's orientation comes from the look model (look.js); the simulation only reads it.

import { mulberry32 } from '../rng.js';
import { Combo } from '../players.js';
import { vAdd, vScale, vLen, vSub, forwardOf, qIdentity, DEG } from './math3d.js';
import { worldFor, wrapPos, spawnField, splitRock, driftRocks, countRocks, nearestDelta } from './world3d.js';
import { spheresOverlap, sweptHit } from './collide3d.js';
import {
    RULES3D, levelPlan, planRockCount, difficultyOf, ddaOf, crystalScore, nextExtraLife, isBossLevel, DEFAULT_DIFFICULTY_3D,
} from './rules3d.js';
import { spawnLevel, createIncoming, spawnIncoming, steerIncoming, incomingInFlight, pushRocksAway } from './spawn3d.js';
import { assistFor, aimAssist, isTarget } from './assist3d.js';

export const SIM = Object.freeze({
    dt: 1 / 60,
    accel: 170,          // units/s² while thrusting
    maxSpeed: 260,
    drag: 0.35,          // fraction of speed lost per second when not thrusting
    bulletSpeed: 900,
    bulletLife: 0.85,    // seconds (range ~765, just past the fog) at the original 1600 cube; per world: worldFor()
    fireInterval: 0.14,  // seconds between shots while Fire is held
    shipRadius: 9,
    pickupBonus: 16,     // generous pickup radius for green crystals
});

/**
 * @param {object} [o]
 * @param {number} [o.seed]
 * @param {string} [o.view] - view distance preset (world3d VIEW_DISTANCES); omitted: the original 1600 cube
 * @param {number} [o.size] - world cube side (overrides the preset's)
 * @param {boolean} [o.field] - false: start with an empty world and no levels (tests place rocks themselves)
 * @param {string} [o.difficulty] - 'easy' | 'medium' | 'hard'
 * @param {number} [o.level] - starting level
 * @param {object} [o.dda] - fixed adaptive difficulty modifiers (rules3d.js NEUTRAL_DDA fields)
 * @param {object} [o.adaptive] - a live adaptive difficulty tracker (rules3d.js createAdaptive3d):
 *   the sim feeds it and follows its modifiers and level (overrides `dda`)
 * @param {string} [o.assist] - fixed aid level without a tracker ('assisting' | 'balanced' | 'challenging')
 * @param {number} [o.greens] / [o.reds] - field: a plain random field of these counts (no levels)
 */
export function createSim({
    seed = 1, view = null, size, field = true, difficulty = DEFAULT_DIFFICULTY_3D, level = 1, dda = null, greens, reds, lives,
    adaptive = null, assist = 'balanced',
} = {}) {
    const world = worldFor(view);
    if (size === undefined) size = world.size;
    const diff = difficultyOf(difficulty);
    const s = {
        world,
        seed,
        rand: mulberry32(seed),
        size,
        time: 0,
        difficulty: diff.id,
        dda: ddaOf(adaptive || dda),
        adaptive,
        assist: assistFor(adaptive ? adaptive.getAdjustmentLevel() : assist),
        ship: {
            pos: [size / 2, size / 2, size / 2], vel: [0, 0, 0], q: qIdentity(),
            invulnerable: 0, shield: 0, respawn: 0, alive: true,
        },
        rocks: [],
        bullets: [],
        clusters: [],
        ufos: [],              // later phases (Phase 2): hostile UFOs block the level end
        boss: null,            // Phase 3
        score: 0,
        lives: lives ?? diff.startingLives,
        nextExtraLife: RULES3D.extraLifeScore,
        level,
        levels: field && greens === undefined && reds === undefined,
        incoming: null,
        banner: null,          // { text, t } while the level banner shows
        combo: new Combo(),
        over: false,
        fireCooldown: 0,
        nextIdValue: 1,
        events: [],
        stats: { collected: 0, wasted: 0, splits: 0, redsShot: 0, hits: 0, shieldHits: 0, shots: 0, shotsHit: 0, assisted: 0, levels: 0, bestCombo: 0 },
    };
    if (s.levels) {
        startLevel(s, level);
    } else if (field) {
        s.rocks = spawnField(s.rand, {
            size, shipPos: s.ship.pos, greens: greens ?? world.greens, reds: reds ?? world.reds,
            clearance: world.spawnClearance, nextId: () => nextId(s),
        });
    }
    return s;
}

export function nextId(s) {
    return s.nextIdValue++;
}

function emit(s, type, data = {}) {
    s.events.push({ type, t: s.time, ...data });
    if (s.events.length > 200) s.events.splice(0, s.events.length - 200);
}

/**
 * Take (and clear) the events since the last call: 'fire', 'collect', 'wasted', 'split',
 * 'hit', 'shieldHit', 'respawn', 'extraLife', 'combo', 'comboLost', 'level', 'gameover'.
 */
export function drainEvents(s) {
    const e = s.events;
    s.events = [];
    return e;
}

/** A level's field around the ship, its incoming rocks, banner and a short protection. */
function startLevel(s, level) {
    s.level = level;
    const plan = levelPlan(level, { difficulty: s.difficulty, dda: s.dda, boss: isBossLevel(level) });
    const f = spawnLevel(s.rand, plan, { size: s.size, shipPos: s.ship.pos, nextId: () => nextId(s), clearance: s.world.spawnClearance });
    s.rocks = f.rocks;
    s.clusters = f.clusters;
    s.incoming = createIncoming(plan);
    s.plan = plan;
    s.banner = { text: `LEVEL ${level}`, t: RULES3D.bannerSeconds };
    if (s.adaptive) s.adaptive.trackGreenSpawned(plan.greens);
    if (level > 1) s.ship.invulnerable = Math.max(s.ship.invulnerable, RULES3D.levelInvulnerable);
    emit(s, 'level', { level, rocks: planRockCount(plan) });
}

/** Rocks left in the level: on the field plus incoming ones not sent yet. */
export function rocksLeft(s) {
    return s.rocks.length + (s.incoming ? s.incoming.left : 0);
}

/** Something other than rocks keeps the level going (UFOs: Phase 2, boss: Phase 3). */
export function levelBlocked(s) {
    return (s.ufos || []).some((u) => u.alive !== false && !u.friendly) || !!(s.boss && s.boss.alive !== false);
}

/** Hostile things a shot can be aimed at: red rocks and UFOs (assist3d.js isTarget). */
export function aimTargets(s) {
    return [...s.rocks.filter(isTarget), ...(s.ufos || []).filter(isTarget)];
}

function fire(s) {
    const f = forwardOf(s.ship.q);
    // Aim assist (assist3d.js): a small correction toward a target near the nose, at fire time
    const a = aimAssist({
        from: s.ship.pos, dir: f, shipVel: s.ship.vel, targets: s.assist.aimDeg > 0 ? aimTargets(s) : null, size: s.size,
        maxAngle: s.assist.aimDeg * DEG, range: s.world.bulletLife * SIM.bulletSpeed, bulletSpeed: SIM.bulletSpeed,
    });
    s.bullets.push({
        id: nextId(s),
        pos: wrapPos(vAdd(s.ship.pos, vScale(f, SIM.shipRadius + 4)), s.size),
        vel: vAdd(s.ship.vel, vScale(a.dir, SIM.bulletSpeed)),
        life: s.world.bulletLife,
    });
    s.stats.shots++;
    if (a.id !== null) s.stats.assisted++;
    if (s.adaptive) s.adaptive.trackShotFired();
    emit(s, 'fire', { assisted: a.id });
}

function removeRock(s, rock) {
    const i = s.rocks.indexOf(rock);
    if (i >= 0) s.rocks.splice(i, 1);
    return i >= 0;
}

function hitRed(s, rock, hitDir, byShip) {
    if (!removeRock(s, rock)) return;
    const pieces = splitRock(rock, s.rand, { hitDir, nextId: () => nextId(s) });
    for (const p of pieces) if (rock.cluster) p.cluster = rock.cluster;
    s.rocks.push(...pieces);
    s.stats.splits++;
    if (!byShip) {
        s.stats.redsShot++;
        if (s.adaptive) s.adaptive.trackRedDestroyed();
    }
    emit(s, 'split', { pos: rock.pos.slice(), size: rock.size, pieces: pieces.length, byShip: !!byShip, id: rock.id });
}

function addScore(s, pts) {
    s.score += pts;
    while (s.score >= s.nextExtraLife) {
        s.lives++;
        s.nextExtraLife = nextExtraLife(s.nextExtraLife, s.dda);
        emit(s, 'extraLife', { lives: s.lives });
    }
}

function collect(s, rock) {
    removeRock(s, rock);
    const r = s.combo.addCollection();
    const pts = crystalScore(rock.size, {
        difficulty: s.difficulty, multiplier: (s.ship.multiplier || 0) > 0, comboMultiplier: s.combo.multiplier, streakBonus: r.streakBonus,
    });
    s.stats.collected++;
    s.stats.bestCombo = Math.max(s.stats.bestCombo, s.combo.count);
    if (s.adaptive) s.adaptive.trackGreenCollected(s.combo.count);
    emit(s, 'collect', { pos: rock.pos.slice(), points: pts, size: rock.size, combo: s.combo.count, multiplier: s.combo.multiplier });
    if (r.milestone) emit(s, 'combo', { milestone: r.milestone, bonus: r.streakBonus });
    addScore(s, pts);
}

/** The ship touched something deadly. `from`: world vector ship → cause (damage direction). */
function shipHit(s, from) {
    const ship = s.ship;
    if (ship.shield > 0) {
        ship.shield = 0;
        ship.invulnerable = Math.max(ship.invulnerable, RULES3D.shieldGrace);
        s.stats.shieldHits++;
        emit(s, 'shieldHit', { from });
        return;
    }
    s.lives = Math.max(0, s.lives - 1);
    s.stats.hits++;
    if (s.adaptive) s.adaptive.onPlayerDeath(); // 2D: immediate adjustment on a lost life
    const lost = s.combo.break();
    if (lost.lost) emit(s, 'comboLost', { count: lost.count });
    emit(s, 'hit', { pos: ship.pos.slice(), lives: s.lives, from });
    ship.alive = false;
    ship.vel = [0, 0, 0];
    if (s.lives <= 0) {
        s.over = true;
        emit(s, 'gameover', { score: s.score, level: s.level });
    } else {
        ship.respawn = RULES3D.respawnDelay;
    }
}

function respawnShip(s) {
    const ship = s.ship;
    ship.alive = true;
    ship.respawn = 0;
    ship.invulnerable = RULES3D.respawnInvulnerable;
    pushRocksAway(s.rocks, ship.pos, RULES3D.respawnPush, s.size);
    if (s.incoming) s.incoming.timer = Math.max(s.incoming.timer, RULES3D.incomingHoldAfterRespawn);
    emit(s, 'respawn', { lives: s.lives });
}

/** Incoming rocks: send the next when due (at once when everything else is cleared), steer the hidden ones. */
function stepIncoming(s, dt) {
    const inc = s.incoming;
    if (!inc) return;
    const lock = s.world.fogNear; // fully visible from here: flies straight
    for (const r of s.rocks) if (r.incoming) steerIncoming(r, s.ship.pos, s.ship.vel, s.size, lock);
    if (inc.left <= 0 || !s.ship.alive) return;
    inc.timer -= dt;
    const others = s.rocks.length - incomingInFlight(s.rocks);
    if (others === 0 && inc.timer > 0) inc.timer = 0; // the rest of the level is cleared: no waiting
    if (inc.timer <= 0 && incomingInFlight(s.rocks) < RULES3D.maxIncomingInFlight) {
        s.rocks.push(spawnIncoming(s.rand, inc, {
            shipPos: s.ship.pos, shipVel: s.ship.vel, size: s.size, distance: s.world.cullDistance, nextId: () => nextId(s), time: s.time,
        }));
        inc.left--;
        inc.sent++;
        inc.timer = inc.interval;
        emit(s, 'incoming', { left: inc.left });
    }
}

/**
 * One fixed simulation step.
 * @param {object} s - from createSim()
 * @param {object} input - { q: ship orientation quaternion, thrust: bool, fire: bool }
 * @param {number} [dt]
 */
export function stepSim(s, input = {}, dt = SIM.dt) {
    s.time += dt;
    if (input.q) s.ship.q = input.q.slice();
    driftRocks(s.rocks, dt, s.size);
    if (s.banner) {
        s.banner.t -= dt;
        if (s.banner.t <= 0) s.banner = null;
    }

    const ship = s.ship;
    if (!s.over) {
        const lost = s.combo.update(dt);
        if (lost && lost.lost) emit(s, 'comboLost', { count: lost.count });
        if (!ship.alive) {
            ship.respawn -= dt;
            if (ship.respawn <= 0) respawnShip(s);
        } else {
            // Ship physics: thrust along the nose, gentle drag, speed cap
            if (input.thrust) {
                ship.vel = vAdd(ship.vel, vScale(forwardOf(ship.q), SIM.accel * dt));
            } else {
                ship.vel = vScale(ship.vel, Math.max(0, 1 - SIM.drag * dt));
            }
            const sp = vLen(ship.vel);
            if (sp > SIM.maxSpeed) ship.vel = vScale(ship.vel, SIM.maxSpeed / sp);
            ship.pos = wrapPos(vAdd(ship.pos, vScale(ship.vel, dt)), s.size);
            if (ship.invulnerable > 0) ship.invulnerable = Math.max(0, ship.invulnerable - dt);
            if (ship.shield > 0) ship.shield = Math.max(0, ship.shield - dt);

            s.fireCooldown = Math.max(0, s.fireCooldown - dt);
            if (input.fire && s.fireCooldown <= 0) {
                fire(s);
                s.fireCooldown = SIM.fireInterval;
            }
        }
        if (s.levels) stepIncoming(s, dt);
        // The adaptive difficulty's clock and periodic evaluation (2D: every frame of play)
        if (s.adaptive) {
            s.adaptive.tick(dt);
            s.adaptive.evaluate(s.score);
        }
    }
    syncAdaptive(s);

    // Bullets: swept against every rock (earliest hit wins); crystals are destroyed, reds split
    for (let i = s.bullets.length - 1; i >= 0; i--) {
        const b = s.bullets[i];
        const move = vScale(b.vel, dt);
        let best = null;
        let bestT = 2;
        for (const r of s.rocks) {
            const t = sweptHit(b.pos, move, r.pos, r.radius, s.size);
            if (t >= 0 && t < bestT) { bestT = t; best = r; }
        }
        if (best) {
            s.bullets.splice(i, 1);
            s.stats.shotsHit++;
            if (s.adaptive) s.adaptive.trackShotHit();
            if (best.kind === 'green') {
                // As in 2D: a shot crystal is lost (no points)
                removeRock(s, best);
                s.stats.wasted++;
                emit(s, 'wasted', { pos: best.pos.slice(), id: best.id });
            } else {
                hitRed(s, best, b.vel, false);
            }
            continue;
        }
        b.pos = wrapPos(vAdd(b.pos, move), s.size);
        b.life -= dt;
        if (b.life <= 0) s.bullets.splice(i, 1);
    }

    if (!s.over && ship.alive && ship.invulnerable <= 0) {
        // Collect crystals (generous radius), collide with reds. As in 2D, neither happens
        // while the ship is protected (after a respawn, a shield hit or a new level).
        for (let i = s.rocks.length - 1; i >= 0; i--) {
            const r = s.rocks[i];
            if (!r) continue;
            if (r.kind === 'green') {
                if (spheresOverlap(ship.pos, pickupRadius(s), r.pos, r.radius, s.size)) collect(s, r);
            } else if (spheresOverlap(ship.pos, SIM.shipRadius, r.pos, r.radius, s.size)) {
                const from = nearestDelta(ship.pos, r.pos, s.size);
                hitRed(s, r, vSub([0, 0, 0], from), true);
                shipHit(s, from);
                if (!ship.alive || s.over) break;
            }
        }
    }

    // Level complete: the 2D rule (nothing left), with a living ship
    if (s.levels && !s.over && ship.alive && rocksLeft(s) === 0 && !levelBlocked(s)) {
        s.stats.levels++;
        startLevel(s, s.level + 1);
    }
    return s;
}

/** Ship radius for collecting crystals: generous, plus the Assisting bonus (assist3d.js). */
export function pickupRadius(s) {
    return (SIM.shipRadius + SIM.pickupBonus) * (1 + (s.assist ? s.assist.pickupBonus : 0));
}

/**
 * Follow the adaptive tracker: its modifiers (s.dda) and aid level (s.assist). A new rock
 * speed modifier applies to the incoming rocks still to come at once (the field's own drift
 * and the crystal share change with the next level, as in 2D).
 */
function syncAdaptive(s) {
    const a = s.adaptive;
    if (!a) return;
    const speedWas = s.dda.asteroidSpeedMod;
    s.dda = ddaOf(a);
    s.assist = assistFor(a.getAdjustmentLevel());
    if (s.dda.asteroidSpeedMod !== speedWas && s.incoming && s.levels) {
        s.incoming.speed = levelPlan(s.level, { difficulty: s.difficulty, dda: s.dda, boss: isBossLevel(s.level) }).incoming.speed;
    }
}

/** The adaptive difficulty for the HUD and the test hook (Balanced, neutral without a tracker). */
export function adaptiveInfo(s) {
    const a = s.adaptive;
    return {
        level: s.assist.level,
        text: a ? a.getAdjustmentText() : 'Balanced',
        color: a ? a.getAdjustmentColor() : '#FFFFFF',
        performance: a ? a.performanceScore : 0,
        dda: { ...s.dda },
    };
}

/** Counts for the HUD / test hook. */
export function simCounts(s) {
    return {
        ...countRocks(s.rocks),
        bullets: s.bullets.length,
        left: rocksLeft(s),
        incoming: incomingInFlight(s.rocks),
        incomingLeft: s.incoming ? s.incoming.left : 0,
    };
}
