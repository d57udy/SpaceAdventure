# Plan 07: Phase 2 UFOs and Phase 3 integration, report (8 October 2026)

UFOs, the boss, the 7 power-ups and hyperspace are now part of the 3D simulation, radar, HUD, renderer and test hook. Unit suite: 1022 of 1022 pass (after `node scripts/update-sw-version.mjs`). Nothing is committed.

## Simulation (`js/3d/sim3d.js`)

- **New state:** `s.ufoSys` (ufo3d `createUfoSystem`), with `s.ufos` refreshed from it every step. Also `s.boss` (boss3d on boss levels until it is gone), `s.power` (powerup3d), `s.hyper` (hyperspace3d) and `s.mods` (ship upgrades).
- **New `createSim` options:**
  - `mods` uses the progress3d `shipMods3d` shape. The default is all 1, and `extraLives` 0.
  - `ufos` and `powerUps` switch the UFO timer and the timed power-up. Both default to on only when the game has levels, so test layouts and `field: false` worlds stay quiet.
- **Adaptive difficulty:** `ufoSpawnMod`, `ufoAccuracyMod` and `powerUpSpawnMod` go into the UFO and power-up systems on every step with a live tracker.
- **Level start:**
  - UFOs and their shots are cleared, and the UFO level is updated.
  - Pickups are cleared, but running effects stay, as in 2D.
  - On boss levels (`isBossLevel`), the boss is created 700 ahead of the ship, and the banner reads "LEVEL N / BOSS BATTLE".
- **Player shots:**
  - A swept test against rocks, UFOs (`hitUfo`) and the boss (`hitTest`). The earliest hit along the path wins.
  - A UFO gives 200 points × the difficulty's score multiplier (the 2D formula), plus a 30 % power-up drop.
  - Each red rock shot also has the 2D 30 % drop chance.
  - **Boss:**
    - A weak point gives 200 points and 20 credits, and releases an escort through `ufoSys.spawnAt`.
    - Defeating the boss gives its points and credits, and drops 3 power-ups.
    - Credits are counted in `stats.credits`.
- **Hostile shots:**
  - A UFO shot at the ship costs a life, or breaks the shield.
  - A UFO shot destroys a crystal (`wasted` with `by: 'ufo'`, not counted as the player's waste) and splits a red rock (`split` with `by: 'ufo'`, no drop, not counted for the adaptive difficulty).
  - Boss shots cost a life or the shield.
  - Ramming a UFO destroys it and costs a life. Touching the boss body costs a life.
  - Every `hit` and `shieldHit` event has a `cause`: rock, ufo, ufoShot, boss, bossShot or hyperspace.
- **Shield:** `power.consumeShield()` feeds the existing shield rule (absorb, then 1 s of protection). `ship.shield` still works for tests. A failed hyperspace jump is not absorbed.
- **Power-up effects:**
  - Rapid fire: shot interval × 0.4.
  - Triple shot: 3 bullets 3° apart. Aim assist bends all three by the same amount.
  - Speed boost: thrust and top speed × 1.6.
  - Score ×2: crystals.
  - Extra life: +1 at once.
  - Magnet: handled by powerup3d.
  - Durations are multiplied by `mods.powerUpDurationMult`.
  - `mods.accelMult` scales thrust, `mods.pickupRadiusMult` scales the collection radius (on top of the Assisting bonus), and `mods.extraLives` adds starting lives.
  - `mods.turnRateMult` is not used yet: turning is in look.js, not the sim.
- **Hyperspace:**
  - Triggered by `input.hyperspace` (one step), using the 2D rules from hyperspace3d.
  - A self-destruct or landing inside something costs a life.
  - Landing inside a red rock splits it. Landing inside a UFO destroys it.
- **Level complete:** also needs no hostile UFO and the boss gone (`levelBlocked`).
- **New exports:** `NEUTRAL_MODS`, `bossBody(s)`, `activeEffects(s)` (`[{ kind, left, max }]` for the HUD chips) and `hyperspaceState(s)` (`{ ready, cooldown, jumps }`).
- **`simCounts`** gains `ufos`, `ufoBullets`, `bossBullets` and `powerUps`.
- **New events:** ufoSpawn, ufoShoot, ufoLeft, ufoDestroyed {by}, escort, bossFight, bossShoot, bossHit, weakPointDestroyed, bossDefeated, bossGone, powerUpDrop, powerUpSpawn, powerUp, effectEnd, powerUpExpired, hyperspace {result}.
- **New stats:** ufosShot, ufoHits, bossHits, weakPoints, bosses, powerUps, jumps, credits.

The standalone modules (ufo3d, boss3d, powerup3d, hyperspace3d) were not changed.

## Balance (`scripts/balance3d.mjs`, plan 07 §2.1)

- **Harness changes:**
  - Threats now include UFOs on a collision course and UFO or boss shots.
  - Both pilots hunt UFOs as well as red rocks once the crystals are gone, because a UFO blocks the level end.
  - The dodging pilot shoots UFOs in its way. It sees shots from the whole view distance (they glow), but only radar-distance shots count as threats. It only dodges shots, since shots can't be shot down.
- **Re-tune (deviations, written into plan §2.1 and §2.2):** incoming rocks every 4.5 s on Medium (Easy 7, Hard 3.5; was 5.5 / 8.5 / 4), and a miss disc of 1.5 (was 1.75). The UFO numbers are unchanged from 2D.
- **Result (Medium, 16 seeds × 3 min):** a threat every 7 s, the careless pilot loses a life every 56 s, the dodging pilot every 120 s. Medium meets the plan targets, with the dodging pilot at the low end.
- **The test is tightened:**
  - A threat every 6 to 10 s.
  - The careless pilot loses a life every 30 to 60 s ± 10 %.
  - The dodging pilot loses a life every 2 to 3 minutes ± 20 %.
  - The dodging pilot is clearly safer than the careless one.
  - Easy < Medium < Hard.
  - Level 1 is still clearable in 2 to 5 minutes.
- **Hard is harsher than "1.5 × Medium":** the careless pilot loses a life every 38 s against 56 s on Medium. Easy is milder than half of Medium. I didn't tune these further because the plan only fixes Medium.
- I ran `node scripts/balance3d.mjs` locally to measure. It is Node only, finishes in a few seconds and opens no browser.

## Radar (`js/3d/radar3d.js`) and HUD (`js/3d/hud3d.js`)

- **Radar types:** `ufo` → 'saucer' (flat ellipse), `boss` → 'boss' (ring, shown at any distance), `powerup` → 'powerup' (square), new 'shot' (dot). New export `radarType`.
- **`buildRadar(..., { shots })`:** hostile shots appear only when on a collision course, as flashing threats. A UFO on a collision course flashes like a rock. A new shot threat also triggers the threat tone and vibration, following the aids table.
- **Edge arrows:** UFOs within the view distance that are off screen, and the boss whenever it is off screen. They use their own colours: UFO purple, boss orange.
- **HUD:**
  - Power-up chips: 2D colours and letters from `PowerUpType`, with a timer bar, under the top-left block. Pure `chipLayout()`; `drawHudText` now returns the y below that block.
  - `drawBossBar`: a health bar at the top centre, labelled "BOSS".
  - A "BOSS" banner while the boss is entering and the level banner has gone.
  - Radar colours `ufo`, `boss` and `powerup`.

## Page (`js/3d/proto3d.js`)

- **Hyperspace:** a small HYPER button next to Fire (repositioned in Joystick mode), the H key and pad B, one jump per press. While cooling down, the button dims and shows the seconds left.
- **Sound, vibration and effects:**
  - UFO and boss shots: `ufoShoot`.
  - A destroyed UFO: `ufoExplode`, purple debris, rumble.
  - Boss hits: hit marker. A destroyed weak point: large explosion and `bossWeakPoint` haptic.
  - Boss defeat: `bossExplode` and `bossDefeated` haptic.
  - Power-up pickup: haptic plus the collect sound.
  - Hyperspace: haptic.
  - UFO hum: follows the nearest UFO through `audio.ufoHum`.
  - The music uses the boss mood while a boss is alive.
- **New layouts:**
  - `layout3d=ufo`: one still, non-firing UFO 400 ahead.
  - `layout3d=boss`: level 2 with only the boss, holding still 700 ahead, its outer weak points already gone and the core down to 10 health. One shot after the 3 s entry defeats it. This is the URL test shortcut; it needs no hook writes.
  - `layout3d=powerup`: triple shot 60 ahead, a red rock 500 ahead.
- **New hook fields:**
  - `ufos` [{id, pos, dist, escort}], `ufoBullets`.
  - `boss`: boss3d `snapshot()` plus `pos`, `dist` and `warning`, or null.
  - `powerUps` [{id, type, life, dist}].
  - `effects` {kind: seconds left}.
  - `hyperspace` {ready, cooldown, jumps}.
  - `counts` gains the new fields.

## Renderer (`js/3d/render3d.js`)

- It uses the meshes3d.js builders. I didn't edit meshes3d.js; its 14 tests pass.
- **Content per frame:**
  - UFOs, hostile shots (from 'boss' or 'ufo'), power-up billboards.
  - Shield bubble: seconds left plus a hit flare.
  - Magnet hint: seconds left plus its range.
  - Hyperspace effect: time since the jump, attached to the camera.
  - The boss mesh is rebuilt for each new boss, from its weak-point directions.
- `render(view)` takes the new fields from proto3d's `renderView()`. `dispose()` frees everything.
- Not run in a browser: CI will be the first real WebGL run of meshes3d through render3d.

## 2D (`js/main.js`)

- `selectedDifficulty` is read from the shared `difficulty` setting at startup, and `cycleDifficulty` writes it. This is a two-line change. The 2D unit tests pass; the 2D browser tests run only in CI.

## Tests

- **New `tests/unit/sim3d-enemies.test.mjs` (10 tests):**
  - UFO timer and adaptive modifiers.
  - Shooting UFOs on Medium and Hard.
  - UFO shots against the ship, the shield, crystals and red rocks.
  - Ramming.
  - A full boss fight: weak points, escorts, core, points, credits, drops, gone after 2 s, escorts blocking the level, then level 3.
  - Boss contact.
  - Every power-up effect, durations × the upgrade, and the drop rate.
  - The timed power-up spawning within range.
  - Hyperspace: jump, cooldown, and about 10 % self-destructs.
  - Ship upgrades.
- **`tests/unit/proto3d.test.mjs`:** +4 tests (the ufo, boss and powerup layouts with H and the hyperspace button; HUD chips, boss bar and new glyphs). The counts expectation is updated.
- **`tests/unit/radar3d.test.mjs`:** +1 test (new types, the boss at any distance, shot threats, UFO threat).
- **`tests/unit/sim3d.test.mjs`:** the level-blocking test now uses the real UFO system. The rocks-left test turns UFOs off, because UFO hits would hold back the incoming rocks.
- **`tests/unit/balance3d.test.mjs`:** tightened, as described above.
- **`tests/integration/proto3d.spec.js`:** +3 CI tests (UFO layout shot for 200 points, boss layout defeated then level 3, power-up pickup with 3 bullets per shot and an H jump). Not run locally.

## Not done, or worth knowing

- `mods.turnRateMult` is not applied, because turning lives in look.js. Nothing passes real upgrades in yet either: proto3d uses the neutral mods until the progress3d wiring (Phase 4, ui3d) passes `shipMods3d` into `createSim({ mods })`.
- Credits are only collected for the boss and weak points (`stats.credits`). The 2D rule of "10 % of the score as credits" belongs to the game-over and progress step.
- Regular UFOs keep arriving on their timer during a boss fight, besides the escorts. That matches 2D, which doesn't stop the UFO timer for a boss.
- The other agents' `tests/integration/game3d.spec.js` expects the ui3d wiring. I didn't touch it.
