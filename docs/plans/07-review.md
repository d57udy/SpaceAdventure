# 3D game: code review (8 October 2026)

A read-only review of `js/3d/sim3d.js`, `ufo3d.js`, `boss3d.js`, `powerup3d.js`, `hyperspace3d.js`, `spawn3d.js`, `rules3d.js`, `assist3d.js`, `radar3d.js` and `render3d.js` (plus `meshes3d.js`, which render3d now uses). I checked two things: whether the code follows the 2D rules (`js/main.js`, `ufo.js`, `boss.js`, `powerup.js`, `asteroid.js`, plan 07 §2) and whether it has correctness bugs. Findings marked **confirmed** were reproduced with throwaway Node scripts against the pure modules (no browser). Line numbers are from the files as of this review.

## Summary

| # | Severity | Finding | Where | Status |
|---|---|---|---|---|
| 1 | High | A level with no rocks left can wait up to about 1.5 minutes for a UFO that is not on the radar | `sim3d.js:591`, `radar3d.js:75`, `ufo3d.js:273` | Fixed |
| 2 | High | A shield, or the 1 s grace after it, does not stop a second hit in the same step (**confirmed**) | `sim3d.js:574-585`, `428-444` | Fixed |
| 3 | Medium | Points and extra lives still count after the game-over event (**confirmed**) | `sim3d.js:535-569` | Fixed |
| 4 | Medium | Hyperspace can land inside the boss, and the ship then respawns inside it | `hyperspace3d.js:47-49`, `sim3d.js:310-345` | Fixed |
| 5 | Medium | Wiring rule for credits: the boss and its weak points carry their own credits | `sim3d.js:399-416`, `progress3d.js` | Open (page wiring) |
| 6 | Medium | The boss glow and its radar dot jump to the opposite side when the boss is about half a cube away | `meshes3d.js` (`createBossMeshes`), `radar3d.js:123` | Fixed |
| 7 | Low | Turret flash and the per-weak-point hit flare never show | `proto3d.js` `renderView`, `boss3d.js` | Fixed in boss3d / meshes3d (render3d may still pass its own) |
| 8 | Low | A new level's first UFO uses the previous level's spawn interval | `sim3d.js:174-176` | Fixed |
| 9 | Low | Bullets absorbed by the boss body count as hits for the adaptive difficulty | `sim3d.js:550-553` | Fixed |
| 10 | Low | Split pieces are not wrapped into the cube | `world3d.js:203` | Fixed (in sim3d.hitRed) |
| 11 | Low | A UFO bullet's last movement is never tested for a hit | `ufo3d.js:287-293`, `301-322` | Fixed |
| 12 | Low | A cluster's rim marker can point the wrong way when the cluster straddles the far seam | `radar3d.js:82-96` | Fixed |
| 13 | Low | Small per-frame allocations (CPU measured: not a problem) | `render3d.js:274`, `proto3d.js` `renderView` | Sim side fixed; render3d / proto3d open |
| 14 | Low | The event queue silently drops old events past 200 | `sim3d.js:147` | Fixed (counter) |

Things checked and found correct are listed at the end.

## 1. High: a level with no rocks left can wait about 1.5 minutes for a UFO the player cannot find

**Fixed (8 October 2026):** `ufo3d.update({ recall })` turns a UFO beyond the cull distance straight toward the ship and stops its leave timer; `sim3d` passes `recall` when no rock is left. `radar3d.lastFew(rocksLeft, blocked)` is also true with no rock left and a blocker, and `sim3d.showAllTargets(s)` wraps it. **The page must use `showAllTargets(sim)` (or `lastFew(rocksLeft, levelBlocked)`) and pass the UFOs and the boss to `buildRadar` / `remainingMarkers`.** Tests: `sim3d` review #1, `ufo3d` review #1, `radar3d` review #1.

**Where:** `sim3d.js:591` (level end needs `!levelBlocked(s)`), `sim3d.js:191-193` (`levelBlocked`: any hostile UFO), `radar3d.js:75` (`lastFew` needs `rocksLeft > 0`), `ufo3d.js:273-277` (a UFO leaves only after 8 s in a row beyond the cull distance).

**What happens:** this follows the 2D rule: 2D `main.js:3711` waits for `ufos.every(u => u.controlled)`. But a 2D UFO is always on the small screen, while a 3D UFO is often beyond the view distance. Once the rock count reaches 0, `lastFew` is false, so the radar's "show everything at any distance" mode is off. The UFO then only shows within the view distance, and there is no edge arrow beyond it.

**Measured (confirmed):** I cleared every rock, put one UFO in play and kept the ship idle, 30 seeds per view distance. The level ended after a median of 30 s (Normal), 38 s (Far) and 46 s (Very far), and after up to 75, 97 and 85 s. During that time the HUD shows 0 rocks left and nothing seems to happen.

**Suggested fix (either or both):**
- Treat blockers as "last few": when `rocksLeft(s) === 0 && levelBlocked(s)`, show the UFOs and the boss on the radar at any distance, with edge arrows. One way is a `blockers` list passed to `buildRadar` and `remainingMarkers` (`all: true` for them).
- When the rocks are gone, a hostile UFO beyond the cull distance should leave at once, or re-aim its straight line at the ship (as `spawn` does) so it comes back within reach quickly.

## 2. High: a second hit in the same step gets through the shield and its grace

**Fixed:** `shipHit` returns at once while the ship is protected, dead or the game is over (except a failed hyperspace jump), and the rock loop stops after a shield hit. Test: `sim3d` review #2.

**Where:** `sim3d.js:574-585` (the rock loop only stops when the ship died), `sim3d.js:439-444` (the boss bullets loop), `sim3d.js:428-438` (UFO bullets). `shipHit` itself (`sim3d.js:284`) never checks `ship.invulnerable`.

**Scenario (confirmed):** the ship has the shield power-up, and two small red rocks touch it in the same step (inside a cluster, or a split right next to the ship). The events are `['shieldHit', 'hit']` and lives go from 3 to 2. The shield absorbed the first rock and set 1 s of protection, but the loop went on and the second rock still cost a life. The same applies to two boss spread shots at close range (5 shots 4° apart), or a UFO shot and a boss shot arriving in the same step. In 2D, the shield and the protection stop everything for that frame.

**Fix:** at the top of `shipHit` add `if (cause !== 'hyperspace' && (!ship.alive || s.over || ship.invulnerable > 0)) return;`, or after each hit in the three loops use `if (!ship.alive || s.over || ship.invulnerable > 0) break`. The guard in `shipHit` covers all callers at once.

## 3. Medium: points and extra lives after the game is over

**Fixed:** the game over clears `s.bullets` and the bullet loop does not run while `s.over`. Test: `sim3d` review #3.

**Where:** `sim3d.js:535-569`. The player-bullet loop runs even when `s.over` is true, and `shootUfo`, `shootBoss` and `collect` add to the score.

**Scenario (confirmed):** the last life is lost while a shot is in flight toward a UFO. The events are `hit`, `gameover`, then `ufoDestroyed:200`, and `s.score` goes from 0 to 200 after the `gameover` event. If the page calls `progress.finishGame(sim.score)` on the `gameover` event (the natural wiring, and what ui3d's game-over screen does), the saved score, the HUD and the game-over screen can disagree. Extra lives can also be awarded after the game is over.

**Fix:** clear `s.bullets` in `shipHit` when `s.over` becomes true, or skip the scoring branches of the bullet loop while `s.over`.

## 4. Medium: hyperspace into the boss, then a respawn inside it

**Fixed:** `hyperspace3d.clearPoint` keeps the clearance from each obstacle's edge (its radius), and a respawn inside the boss moves the ship out to its radius + ship + 40. Tests: `hyperspace3d` review #4, `sim3d` review #4.

**Where:** `hyperspace3d.js:47-49`. `spawnPoint` keeps 120 units from each obstacle's **centre**, but the boss radius is 150 (+ ship 9). `sim3d.js:331-345`: a landing inside counts as `materialised`, a life lost. `sim3d.js:310-318`: the respawn is where the ship was, and only rocks are pushed away.

**Scenario:** on a boss level, a jump lands 120 to 159 units from the boss centre. The ship loses a life (2D-like, but the clearance was meant to avoid this), then respawns inside the boss body with the camera inside its mesh. After the 3 s of protection, `boss.touches` costs another life unless the player has flown out. In a crowded test field this landing happened in 2 of 3605 jumps, so it is rare but bad when it happens.

**Fix:** have `spawnPoint` take per-obstacle radii (keep `clearance + o.radius` from each obstacle), and on respawn move the ship out of the boss if it is inside (along the boss → ship direction to `radius + 20`).

## 5. Medium (wiring rule): credits for the boss and its weak points

**Where:** `sim3d.js:399-416` sends `weakPointDestroyed { points: 200, credits: 20 }` and `bossDefeated { points, credits: 20 % }`. `progress3d.awardPoints(points, credits = 10 %)`. The page does not award points or credits yet (`proto3d.js` has no progress calls).

**Risk:** default 10 % credits for the boss would under-pay (2D pays 20 %, `main.js:4997`). Adding `sim.stats.credits` on top of `awardPoints` with explicit credits would double-pay.

**Rule for the wiring:**
- `collect` and `ufoDestroyed` (by `player`): call `awardPoints(e.points)`.
- `weakPointDestroyed` and `bossDefeated`: call `awardPoints(e.points, e.credits)`.
- Never add `stats.credits` separately.
- `ufoDestroyed` by ramming has `points: 0`, which `awardPoints` ignores.

## 6. Medium: the boss glow jumps across the sky at half a cube

**Fixed:** `meshes3d.seamFade` fades the glow between 0.42 and 0.5 × size along any axis. The radar dot still flips (accepted). Test: `meshes3d` review #6.

**Where:** `meshes3d.js` (`createBossMeshes`: the glow shows up to `MESHES3D.bossGlowReach` = 1.5 × fog end), `radar3d.js:123` (the boss shows at any distance).

**Scenario:** 1.5 × fog end is more than half the cube (Normal 1620 vs 1200, Far 2160 vs 1600, Very far 2805 vs 2100). When the boss is about `size / 2` away along one axis, `nearestDelta` switches to the other image, and the glow (and the radar dot) jump from one side to the opposite side. The body is culled by then, so only the glow and the dot move. This is my module (meshes3d.js).

**Fix:** fade the glow by the largest axis component of the delta, for example `opacity *= 1 - smooth(maxAbsAxis, 0.42 * size, 0.5 * size)`. For the radar, accept the flip (the boss really is that close the other way), or damp it the same way.

## 7. Low: turret flash and the weak-point hit flare are never drawn

**Fixed in my files:** boss3d sets `lastHit`, `turretDir` (body frame) and `turretFlash` (1, fading in 0.15 s); meshes3d uses them when the page passes none. Test: `boss3d` review #7, `meshes3d` review #6.

**Where:** `proto3d.js` `renderView` passes neither `turretFlash` nor `turretDir` (meshes3d needs both), and `boss3d.js` never sets `state.lastHit`. So the turret-flash sprite and the per-weak-point flare stay off; only the body's hit flash shows.

**Fix:**
- `boss3d.attack`: record `b.turret = { dir, t: time }` for the firing weak point and set `b.lastHit = w.id` in `damage`.
- The page passes `turretFlash` (fading over about 0.15 s) and `turretDir` (the firing weak point's `dir`).

## 8. Low: the UFO timer at a new level uses the old level

**Fixed:** `configure({ level })` before `clear()`. Test: `sim3d` review #8.

**Where:** `sim3d.js:174-176`. `ufoSys.clear()` resets the spawn timer with `sys.level` still set to the previous level, then `configure({ level })` changes it. The interval shrinks 5 % per level (`ufoInterval`), so each level's first UFO comes about 5 % late.

**Fix:** call `configure({ level })` before `clear()`.

## 9. Low: boss body hits inflate the accuracy the adaptive difficulty sees

**Fixed:** a shot absorbed by the boss body, or any boss hit while it is not vulnerable, is not counted. Test: `sim3d` review #9.

**Where:** `sim3d.js:550-553`. Every bullet that strikes anything counts as `shotsHit` / `trackShotHit`, including bullets the boss body absorbs (`hitTest` type `body`, also during its 3 s entry). In a boss fight that pushes the adaptive level toward Challenging, which switches off aim assist exactly when it is needed.

**Fix:** count only `weakPoint` and `core` hits (and rocks and UFOs) as hits.

## 10. Low: split pieces are not wrapped

**Fixed** in `sim3d.hitRed` (world3d.js unchanged). Test: `sim3d` review #10.

**Where:** `world3d.js:203`. `splitRock` places pieces at `rock.pos ± side × r × 1.1` without `wrapPos`, so a piece can sit slightly outside `[0, size)` until the next `driftRocks`. Everything uses `nearestDelta` today, so nothing breaks yet, but a spatial grid or `pos` comparisons would.

**Fix:** `pos: wrapPos(vAdd(...), size)`. `splitRock` needs `size`, or `sim3d.hitRed` can wrap the pieces.

## 11. Low: a UFO bullet's last move is skipped

**Fixed** for UFO and boss shots: expired shots are dropped at the start of the next `update` or by `collideBullets` after their last test. Tests: `ufo3d` and `boss3d` review #11.

**Where:** `ufo3d.js:287-293` drops bullets whose `life <= 0` inside `update`, before `collideBullets` (`ufo3d.js:301`) tests the move they just made. At the end of a 3 s, 1050-unit flight this hardly matters.

**Fix:** filter expired bullets after `collideBullets`.

## 12. Low: a cluster's rim marker near the far seam

**Fixed** as suggested. Test: `radar3d` review #12.

**Where:** `radar3d.js:82-96`. A cluster's direction is the mean of its members' nearest-image deltas. For a cluster straddling the seam opposite the ship (members about `size / 2` away along an axis), some members flip sign and the mean points sideways or near the ship. This only affects the faint "beyond range" rim ring.

**Fix:** average the members' positions relative to the first member (`nearestDelta(first, member)`), then take one `nearestDelta` from the ship to that centre.

## 13. Low: per-frame allocations

**Sim side fixed:** `sim3d.syncAdaptive` rebuilds the modifiers and reconfigures the UFO and power-up systems only when the tracker's modifiers change (an allocation-free compare first). Test: `sim3d` review #13. The render3d / proto3d allocations are the sim agent's.

**Where:**
- `render3d.js:274` maps every hostile bullet into a new object each frame.
- `proto3d.js` `renderView` spreads the UFO and boss bullet arrays each frame.
- `render3d.js` `syncSparks` calls `sparkCol.set([...])` per spark.
- `ufo3d.configure` and `rules3d.ddaOf` build new objects every step (`sim3d.syncAdaptive`).

**Measured:** sim CPU is not a concern: 0.09 to 0.1 ms per step on the Mac at Far and Very far with triple shot and rapid fire held (about 50 rocks, 30 to 45 bullets). Even 10 × slower on a phone is about 1 ms per step. The garbage is small but steady.

**Fix (when convenient):** pass the bullet arrays straight through (meshes3d reads `from`, `pos`, `radius`, `id` only), write spark colours with `sparkCol[n*3] = ...`, and call `configure` only when the dda values change.

## 14. Low: the event queue drops events silently

**Fixed:** `s.eventsDropped` counts dropped events and `simCounts(s).eventsDropped` reports it (the hook's `counts`). Test: `sim3d` review #14.

**Where:** `sim3d.js:147`. Past 200 undrained events the oldest go. The page drains every frame, so this only bites a harness or test that steps without draining, where a `gameover` or `level` event could be lost.

**Fix:** keep it, but document it on `drainEvents`; or never drop `gameover` and `level`.

## Checked and correct

- **Wrap seam:** `sweptHit` picks the target image nearest the segment midpoint, and `boss3d.hitTest` shifts all weak points with the body's image. UFO and boss bullets use `nearestDelta(prev, pos)` for their move, and `cullDistance` (fog end + 90) stays below `size / 2` for every view distance. Rocks, UFOs and power-ups are placed and collided at their nearest image.
- **NaN paths:** `vNorm` of a zero vector returns zeros, and `splitRock` falls back to fixed axes. A ship centred exactly on a rock gives a valid split, `isThreat` cannot divide by zero (closing < 0 implies motion), and the aim, intercept and cone maths clamp their inputs.
- **Quaternions:** the ship uses the look model's quaternion (copied). The boss spins as `qNorm(qMul(axisAngle, q))` (world frame), its weak points use `qRotate(b.q, dir)`, and meshes3d draws them with the same quaternion. Billboards undo the body rotation.
- **2D rules:**
  - Boss and levels: the boss every 2 levels from level 2, boss level `floor(level / 2)`, weak point and core health, score 1000 + 500 × L, and 200 points / 20 credits per weak point, as 2D.
  - Scoring: UFO 200 × the difficulty's score multiplier (`main.js:4916`); crystal score × difficulty, × 2 with the power-up, × combo, + streak (`main.js:4743`); no points for red rocks.
  - Hits: UFO bullets destroy crystals and split red rocks.
  - Level end: no rocks, no hostile UFO, boss gone (`main.js:3711`).
  - Lives and timers: extra life every 10000 × the adaptive modifier; power-up effects count down while the ship waits to respawn (2D `tickPlayerPowerUps` for every active player, `main.js:3678`).
- **Pause:** every timer (power-up effects and pickups, UFO and boss timers, hyperspace cooldown, combo) lives in `stepSim`, which the page does not call while paused.
- **Leaks and growth:** bullets, UFO and boss shots, pickups and sparks all expire. The renderer's `lastSeen` map is cleared every frame. The boss mesh is rebuilt only when `sim.boss.state` changes identity (a new boss), and the old one is disposed. Pool `InstancedMesh`es dispose without disposing their shared geometry.
- **Events:** every system's events are drained into `s.events` each step; `bulletExpired` is deliberately dropped.
- **Deadlocks other than §1:** incoming rocks are released at once when the rest of the level is cleared. A rock that chases a faster ship stays "incoming" but can be shot, and the level still counts it. The boss is removed 2 s after its defeat. Escorts and regular UFOs leave after 8 s beyond the cull distance.
