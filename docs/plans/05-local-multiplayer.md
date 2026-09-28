# Local multiplayer: detailed plan

**Scope (decided 26 September 2026):** multiplayer on **one device only**: a shared keyboard, game controllers, or two people on one tablet. No network, no third-party services, still a static site on free GitHub Pages with no build step.

Two planners wrote this from the code: one for game architecture and modes (sections 1–7), one for input, screens and testing (sections 8–13). Line numbers refer to `js/main.js` (3076 lines) unless another file is named. It builds on the Settings screen ([README §A](README.md#a-one-settings-screen-instead-of-more-main-menu-rows)), sharp rendering (Item 2) and controller support (Item 8).

## Summary

| Decision | Choice |
|---|---|
| Players | **2** in every mode. Data model supports 4; 3–4 unlocked later for Co-op and Duel only, and only with controllers or keyboard (touch is limited to 2) |
| Screen | **One shared camera** at the midpoint of the ships. Proven to always fit 2 ships without split screen or zoom (section 3) |
| Modes, in shipping order | 1. **Take Turns** (pass the device), 2. **Co-op "Wingmen"**, 3. **Versus "Harvest Race"**, 4. **Duel**, 5. **Saucer** (one player is the UFO), 6. **Time Attack vs Ghost** (race a recorded run from this device) |
| Keyboard | P1: W A S D + Space (or F). P2: arrow keys + Enter (or numpad). Matched by physical key position so non-English keyboards work |
| Tablet | **Side by side** (landscape, controls in the bars beside the square play area) or **facing** each other across a flat tablet (P2's controls and HUD rotated). Drag to Steer only for touch players |
| Menu | Easy/Medium/Hard fold into one "Difficulty ◂ ▸" row, freeing space for a "Multiplayer" row. With Settings replacing Controls, the main menu has 10 rows |
| Profiles | P1 is the signed-in player. Others pick a saved profile on this device or play as Guest |
| Total size | Core refactor **L**, modes and screens **L–XL**, input and tablet layouts **L–XL**. Roughly 3–4 weeks of agent work, deliverable in phases that each ship on their own |

## Findings from the code

1. **Levels are not score-based.** A level ends when every asteroid, UFO and the boss are gone (l.1911–1915); `LEVEL_UP_SCORE` is unused. "Scaling difficulty with players" means scaling the asteroid count per level.
2. **Shooting a green already destroys it for no points** (`asteroid.js:164-168`), so Harvest Race "denial" needs no new mechanic.
3. **UFO bullets already hit ships and greens** (l.2362–2376, l.2432–2450), so a player-controlled saucer can fire ordinary enemy bullets.
4. **Two small single-player input bugs** that multiplayer would make much worse:
   - Held state is tracked per action, not per key: hold ← , tap and release A, and the ship stops turning although ← is still held.
   - One-shot presses are debounced per action: while S (hyperspace) is held, ↓ can't trigger hyperspace.
   - Keys are matched by the character typed (`event.key`), which changes with keyboard layout and Shift.
5. **Latent bug:** the safe-spawn check for new asteroids (l.2230) uses straight-line distance, ignoring world wrap-around, so an asteroid can spawn right next to the ship across the edge.
6. **Touch sticks need no rotation for a facing player.** Drag to Steer maps finger direction on the glass to ship direction on the glass, which is already right for someone sitting at the top edge. Only controller sticks, text, the HUD and button placement need rotating. This corrects [04-multiplayer.md](04-multiplayer.md).
7. **CSS trap:** the stick visual is `position: fixed` and follows the finger; inside a rotated container it would land in the wrong place, so stick visuals live in a separate unrotated layer.
8. **Menu space:** at 12 rows, menu tap targets on a 1024x768 tablet drop below our 30 px test threshold.

---

## 1. Core refactor: one player becomes a list of players

### 1.1 New modules (no DOM, unit tested)

**`js/players.js`**
```js
export const PLAYER_COLOURS = ['#00E5FF', '#FF9F1C', '#FF4FD8', '#FFE14D']; // avoids green, red, purple; see §10.3 for per-palette colours
export class Combo { addCollection(); break(); update(dt); reset(); }       // moved from ComboSystem (l.364-421)
export function createPlayer({ id, slot, name, profile, colour, bindingId, lives, upgrades }) → {
  id, slot, name, profile /* username or null for guests */, colour, bindingId, input: null,
  ship: null, score: 0, lives, respawnTimer: 0, nextExtraLifeScore: 10000,
  combo: new Combo(), powerUps: { rapid_fire: 0, triple_shot: 0, shield: 0, speed_boost: 0, magnet: 0, score_multiplier: 0 },
  stickHeading: null, upgrades, out: false, beacon: null,
  stats: { greens, redsShot, ufos, kills, deaths, shots, hits, bestCombo, revivesGiven, greensDenied, creditsEarned },
}
export function tickPowerUps(powerUps, dt) → expiredKeys[]
export function livingPlayers(players), nearestLivingShip(x, y, players, W, H), teamScore(players), allOut(players)
```

**`js/upgrades.js`:** `ShipUpgrades` (l.572–686) becomes a class `UpgradeState` with the same getters. P1 shares the existing object for the signed-in user (so the Upgrades screen and saves keep working); other profiles load their own; guests and fairness modes get `UpgradeState.zero()`, which never saves.

**Input seam:** `player.input` is any object with `isPressed(action)`, `consumeAction(action)` and `getJoystick()`. In single-player, `players[0].input` is the existing input handler, so nothing changes. Pause and mute stay shared (any player).

### 1.2 Per player, team-wide or global

| System | Multiplayer |
|---|---|
| Ship, score, lives, respawn timer, extra-life threshold | **Per player** |
| Power-ups | **Per player** (the collector). Magnet pulls greens to the collector only. Extra life: in co-op, revives an out teammate if there is one |
| Rapid fire cooldown | Per ship via one helper `applyShipModifiers(p)` (replaces three places that set it) |
| Combo | **Per player**; milestone text near that player's ship in their colour |
| Dynamic difficulty | **Team-wide** in co-op (averaged over players); **off** in competitive modes and Time Attack |
| Upgrades and credits | Per player, only for profiles, only in modes that allow them |
| Achievements | One achievement manager per profiled player |
| Level, boss, spawn timers, particles, screen shake, floating texts | **Global** |
| Thrust sound | One loop, on while any ship thrusts |

### 1.3 Migration in safe steps

Every step is one commit; after each, `npm test` (127 unit and 200 browser tests) passes and single-player behaves exactly as today. Invariant: single-player is `players.length === 1` with mode `solo`.

| Step | Change |
|---|---|
| R0 | Add `players.js`, `upgrades.js`, `camera.js` (maths only), `modes.js` (solo only), with unit tests. No wiring |
| R1 | `players = [createPlayer(...)]` in `startGame`; move score, lives, extra-life threshold and respawn timer onto `players[0]` in `startGame`, `updateUI`, `updateScore`, `handlePlayerDeath`, `respawnPlayer`, `gameOver`, `updateGame` and the test hook (hook values unchanged) |
| R2 | `ship` → `p.ship` (about 87 lines). Extract `handleShipInput(p, dt)` (l.1590–1649), `updateShip(p, dt)` (l.1799–1805), `checkShipCollisions(p)` (l.2258–2377 plus the boss body check l.2517–2544), looped over players. The `return` after a death becomes `continue` to the next player |
| R3 | Power-ups per player (`activatePowerUp(p, type)`, per-player tick, magnet and HUD) |
| R4 | Combo per player |
| R5 | Credits and achievements routed through `awardPoints(p, points)` |
| R6 | Bullet owners; UFO and boss target the nearest living ship; UFO spawning around the camera centre |
| R7 | Camera takes a list of targets; with one target it behaves exactly as today |
| R8 | Mode hooks wired with `solo` defaults; `startGame(modeId = 'solo', lobby = null)` |

Only after R8 does anything create a second player.

## 2. Bullets, scoring and enemies

- **Bullet owner:** `new Bullet(x, y, vx, vy, isPlayerBullet = true, ownerId = null)`. Player bullets take their owner's colour. Triple shot passes the owner too.
- **Who gets the points:**

| Event | Credited to |
|---|---|
| Green collected | the collecting player (their combo and score multiplier) |
| Red shot | bullet owner (stats only, no points, as today) |
| UFO destroyed | bullet owner (points and credits) |
| Boss weak point | bullet owner (200 points, 20 credits) |
| Boss defeated | bonus split equally among all players |
| Green shot by a player | shooter's "denied" count (Harvest shows "DENIED") |

- **Friendly fire:** off in Co-op and Harvest (bullets pass through teammates); on in Duel; own bullets never hit your own ship.
- **Ship bump** (Harvest, Duel): elastic bounce, no damage, 0.25 s cooldown per pair. Co-op ships pass through each other.
- **Enemy targeting:** UFOs and the boss aim at the nearest living ship (wrap-aware), preferring ships that aren't invulnerable. The boss hovers around the camera centre and rotates its attacks between players. A compatibility shim keeps single-player calls unchanged.
- **Spawning:** UFOs spawn at the edge of the shared view; new asteroids avoid every living ship using wrap-aware distance (fixing finding 5).

## 3. Shared camera

### 3.1 Why two ships always fit
- The view is a square of side V; the world is 1.5V and wraps. (Since 2026-09 the view is W x H and the world at least 1.5W x 1.5H; the argument holds per axis.)
- Per axis, the shortest separation between two ships is at most half the world: 0.75V.
- With the camera at the midpoint, each ship is at most 0.375V from the centre, and the view reaches 0.5V, leaving at least 0.125V: 86 px on a 690 px tablet canvas, 42 px on a 337 px phone. A ship with its shield ring is 25 px, so it fits whenever V ≥ 200.
- Each axis is bounded independently, so the diagonal is covered too. **No split screen or zoom needed for 2 players.**

### 3.2 Three or four players (later)
Compute the smallest covering interval per axis and zoom out just enough: about 0.90 for 3 players and 0.81 for 4 at V = 690, clamped at 0.75 so nothing is ever drawn twice. Zoom changes smoothly (out in 0.25 s, in over 0.4 s).

### 3.3 The half-world flip (replaced 2026-09-28: continuous tracking and a soft edge)
Original design: when the ships are almost exactly half a world apart, there are two equally good midpoints. Keep the current one until the other is better by more than 4% of the world width, then glide over 0.2 s along the shorter path, without jerking the starfield. Normal following uses light smoothing (0.12 s); single-player keeps today's instant follow.

**Change (2026-09-28).** Players reported that the view "snaps back" when one ship flies away: at half a world apart the shortest route between the ships switches sides and the flip glided about 0.75 of a view in 0.2 s. All simultaneous modes (Co-op, Harvest, Duel, Saucer including the flown saucer, 3-4 players) now use:
- **Continuous tracking.** The camera keeps each target's unwrapped position (per id), advanced every frame by the wrapped delta of its world position. The centre follows the midpoint of the unwrapped covering interval per axis (smoothing 0.12 s) and is itself unwrapped, so crossing the world edge scrolls like single-player. A target that (re)appears (spawn, respawn, revive, rejoin) or jumps more than a quarter of the world in one frame (hyperspace) is re-anchored to its image nearest the centre. There is no flip.
- **Zoom** eases out as the targets spread around the centre (margins 25 px), down to max(0.75, view/world); a settled target never gets closer than 15 px to the view edge.
- **Soft edge (leash).** Box = camera centre ± (visible half-extent at the minimum zoom − 25 px) per axis. Ships and the flown saucer are held inside: co-op clamps onto the edge and removes the outward velocity; Harvest, Duel and Saucer damp the outward velocity strongly and allow a springy overshoot of at most 20 px. While a player pushes against it, that screen edge glows in their colour (edge arrows stay as a fallback). Rocks, bullets and UFOs are not leashed and keep wrapping.
- **Hyperspace** lands inside the box (same self-destruct and collision risks); `nearTeam` respawns, revives and `furthestFromOpponents` respawns (a grid over the box) stay inside it too.
- Single-player and Take Turns keep today's instant follow. The maths is in `js/camera.js` (`unwrapTargets`, `leashBox`, `applyLeash`, `leashEntity`), unit tested in `tests/unit/camera.test.mjs`; the browser check is `tests/integration/mp-camera.spec.js`.

### 3.4 Deaths, respawn and radar
- The camera follows living ships only; a co-op revive beacon is included only if everything still fits.
- Respawn placement: `worldCentre` (single-player, as today); `nearTeam` (8 points around the camera centre, choosing the one furthest from hazards); `furthestFromOpponents` (Duel and Harvest).
- The radar centres on the camera and shows every ship in its player's colour with its number, and beacons as pulsing rings.

## 4. Mode layer (`js/modes.js`)

Each mode is a config object plus pure rule functions ("hooks") that return decisions; `main.js` applies effects:
```js
{ id, name, kind, players: { min, max }, lives: { type: 'perPlayer' | 'unlimited', count },
  friendlyFire, shipBump, timer, winCondition, target, upgradesApply: 'own' | 'none', ddaEnabled,
  levelProgression, bosses, field /* refill settings when levels are off */, ufos, powerUps, respawn, scaling,
  earnsCredits, earnsAchievements, leaderboard,
  hooks: { onStart, onCollectGreen, onShootGreen, onKill, onDeath, onTick, checkEnd } }
```
`solo` reproduces today exactly and routes to the existing Game Over screen.

### 4.1 Take Turns (ships first)
- Works with **one set of controls**: the device is passed around, so it also runs on phones.
- 2–4 players; only the active player has a ship. When they lose a life and someone else has lives left: "PLAYER 2 – GET READY", continue on fire or tap (at least 1 s).
- Each player's world (level, asteroids, UFOs, pickups, boss, timers, difficulty state) is kept in memory while parked.
- Each profile earns credits, achievements and a normal high-score entry, because the rules are the same as single-player.

### 4.2 Co-op "Wingmen"
- **Lives:** individual. At zero, the player is out and a drifting **beacon** appears.
- **Revive:** a teammate within 70 px fills a 2 s bar (drains twice as fast when leaving). Costs the reviver one life and needs them to have at least 2. The revived player gets 1 life and 3 s of invulnerability. Collecting Extra Life while a teammate is out revives them instantly.
- **Game over:** when everyone is out.
- **Scaling for 2 players:** 1.5x asteroids per level (15 at level 1); boss health 1.6x and attacks 1.25x faster; UFOs spawn 1.5x as often, up to 2 at once; random power-ups every 16 s instead of 20.
- Team score = sum of scores; own upgrades apply; credits and achievements for profiles; team leaderboard.

### 4.3 Versus "Harvest Race"
- **Round:** 3 minutes (2 or 5 selectable). No levels or bosses; the field refills every second to 12 greens and 6 reds, spawning at least 250 px from any ship with a short fade-in.
- **Scoring:** greens with your own combo; shooting a green denies it ("DENIED").
- **Deaths:** unlimited; respawn after 3 s far from the opponent, combo lost, 2 s invulnerability.
- No friendly fire, ships bump. One UFO every 30 s. Power-ups every 12 s from shield, speed, magnet, score multiplier, triple shot (no extra life, no rapid fire).
- **Fair:** standard ships, no difficulty adjustment, no credits or achievements.
- **End:** highest score when time runs out; a tie goes to 20 s of overtime where the next green wins, else a draw.

### 4.4 Duel (a Spacewar! homage)
- **Win:** first to 5 kills (3/5/7/10 selectable), 4-minute cap; ties go to sudden death.
- **Field:** 5 large reds and 4 greens; **a green gives 4 s of shield** (stacking to 8 s). No UFOs or boss. Power-ups every 15 s from rapid fire, triple shot, shield, speed.
- Friendly fire on, one hit kills, hyperspace available with its self-destruct risk. Self-inflicted deaths score for nobody.
- Respawn after 2 s at the point furthest from the opponent, with 2 s of invulnerability that firing cancels.

### 4.5 Saucer (asymmetric)
- **P1** flies the ship and must reach a target score (Easy 1800, Medium 2500, Hard 3500) within 150 s. **P2** wins if time runs out or P1 loses every life.
- P2 steers a UFO directly (speed 150) with a turret aimed along the movement direction, with slight aim assist (snaps to P1 or a green within ±30°) and a 1 s fire cooldown. A "saucer strength" handicap adjusts cooldown and speed.
- Reuses `ufo.js` with a `controlled` flag: its bullets are ordinary enemy bullets, so existing collision code kills P1 and destroys greens.
- Destroying the saucer gives P1 200 points; it returns after 4 s at the far edge of the view.

### 4.6 Time Attack vs Ghost
- 3-minute run on a numbered "course" (1–10) at a chosen difficulty; standard ships, no difficulty adjustment, 3 lives.
- The ghost is the best run by you or another profile **on this device** for that course and difficulty, replayed as a translucent ship with a "Ghost +140" pace readout.
- Recording: position, rotation and thrust every 100 ms of game time (about 11 KB for 3 minutes), stored in local storage.
- A seeded random generator (`js/rng.js`) makes level layouts, spawn timers and power-ups identical for the same course; collisions and particles stay random. Runs diverge after the first shots, so the ghost is a pace reference, not an opponent. Recordings note the screen size, since the world size depends on it.

## 5. Round flow

```
MENU ─Start────────────► PLAYING ─out of lives─► GAME_OVER          (single-player, unchanged)
MENU ─Multiplayer─► MP_MODE_SELECT ─► LOBBY ─► PLAYING (intro card first) ⇄ PAUSED
PLAYING ─Take Turns, life lost─► TURN_CHANGE ─fire/tap─► PLAYING
PLAYING ─mode says the round ended─► ROUND_END (2 s slow motion, banner) ─► RESULTS
RESULTS ─ Rematch ─► LOBBY (same players, joined, not ready)
        ─ Change mode ─► MP_MODE_SELECT
        ─ Main menu ─► MENU
```
- **Pause:** anyone can pause (P, Escape, controller Start, or their own pause button). The overlay says who paused. Anyone can resume; in multiplayer, resume runs a 3 s countdown so nobody is caught off guard. Timers, respawns and revive bars freeze while paused. Hiding the app auto-pauses.
- **Results** (`lastResults`): mode, duration, outcome, winners, team score and level, and per player: score, lives, kills, deaths, greens, reds, UFOs, accuracy, best combo, revives, denials, credits, new achievements, plus highlights ("Most denials: BOB (7)").

## 6. Saving (this device only)

| Key | Contents |
|---|---|
| `spaceAdventure_mp_history_v1` | last 20 results |
| `spaceAdventure_mp_board_coop_v1` | top 10 team scores (names, level, difficulty, date) |
| `spaceAdventure_mp_board_harvest_v1` | top 10 winning scores |
| `spaceAdventure_mp_rivalry_v1` | head-to-head wins per pair of names and mode |
| `spaceAdventure_ghost_v1_<USER>_<course>_<difficulty>` | best run only |

- Guests get no saves, credits, achievements or ghosts.
- **Credits:** Solo, Take Turns and Co-op (10% of own points); none in competitive modes, so two profiles can't farm each other.
- **Upgrades:** own in Solo, Take Turns and Co-op; standard ships in Harvest, Duel, Saucer and Time Attack.
- "Reset Data" also removes that player's ghosts and their entries in boards and rivalries.
- Existing keys keep their old `asteroids_` prefix; new keys use `spaceAdventure_`.

## 7. Performance and determinism
- 2 players with rapid fire and triple shot is at most about 72 bullets; collision checks stay trivial up to 4 players. Remove or gate the collision `console.log` calls (2 players double them).
- Seeded randomness is needed only for Time Attack and optional identical Take Turns layouts; everything else keeps `Math.random`. No fixed timestep needed for local play.

---

## 8. Input: sources and seats

- **Source:** a physical input: `kbLeft`, `kbRight`, `pad:<index>`, `touch:a`, `touch:b`.
- **Seat:** a player slot 0–3.
- **Single-player** uses "merged" mode: every source drives seat 0, so both key sets, every controller and the touch controls work exactly as today.
- **Shared actions** (pause, escape, mute, menu navigation, select, typing) aren't bound to a seat; anyone can navigate menus.

**New `js/seats.js`** (no DOM, unit tested): key profiles, lookups and a `SeatTable` (`setMerged`, `join`, `leave`, `seatOf`, `reserve` for a disconnected controller, `snapshot`).

| | P1 (`kbLeft`) | P2 (`kbRight`) |
|---|---|---|
| Thrust | W | ↑ (numpad 8) |
| Rotate | A / D | ← / → (numpad 4 / 6) |
| Hyperspace | S | ↓ (numpad 5 / 2) |
| Fire | Space or F | Enter (numpad Enter / 0; Right Shift as a listed alternate) |

H stays a hyperspace key in single-player only. Bindings use `event.code` (physical key position), so AZERTY and QWERTZ keyboards work; typing names still uses the typed character. Ctrl, Cmd, Alt and Option are never bound (Cmd+W would close the tab).

**`InputHandler` changes (`js/input.js`):**
- Per-seat state: held actions tracked by the set of keys/fingers/buttons holding them (fixes finding 4), a per-frame latch for quick taps, seat one-shots, a stick per seat, and a rotation flag for facing seats.
- Edge detection per physical key.
- `isPressed(action, seat?)`, `consumeAction(action, seat?)`, `getJoystick(seat = 0)`: without a seat they behave exactly as today.
- New: `consumeSourceEvents()` (lobby joining), `releaseSeat(seat)`, `releaseJoysticks()`, `setSeatOrientation(seat, deg)`.
- The stick-steadying code moves into `steering.js` as a pure function, with the heading stored per player.

**Pointer routing:** each touch belongs to the zone (`data-zone="a"` or `"b"`) where it landed. A finger that started as a player's stick keeps steering even if it slides into the other half. Button slides only switch between the same player's buttons. **Palm rule:** if a stick's finger hasn't moved more than 6 px in 500 ms (a resting palm or thumb), a new finger in that zone takes over.

**Keyboard ghosting:** both players thrusting, turning and firing is 6 keys, exactly the common USB limit; cheap laptop keyboards may drop some combinations. Mitigations: an **Auto-fire (multiplayer)** setting (saves two keys, also an accessibility aid), **key-test lights** on the lobby cards to check a keyboard before playing, and hint labels read from the real keyboard layout where the browser allows it.

**Controllers:** ask during Item 8 for the poller to report each controller separately (cheap now, expensive later). In multiplayer each controller drives its joined seat; unjoined controllers can join from the lobby. Identity is the controller index, since identical controllers have identical names.

## 9. Tablet layouts

| Layout | Landscape | Portrait | Decision |
|---|---|---|---|
| **Side by side** | Controls in the left/right bars | Players would crowd one edge | **Landscape only**; portrait shows "Rotate to landscape, or choose Facing" |
| **Facing** (tablet flat between players) | Controls in the bar corners | Full-width top and bottom bars | **Both** (portrait is best) |
| Stacked at one edge | – | Cramped | Not supported |
| 3–4 touch players | – | – | Not supported; seats 3–4 need keyboard or controllers |

- Setting `mpLayout: auto | sides | facing` (auto: landscape = side by side, portrait = facing), changed in the lobby. Rotating mid-round auto-pauses and resumes with a countdown.
- **Touch players always use Drag to Steer** in multiplayer (the button layout doesn't fit the bars).

> **Update (2026-09, adaptive screens):** bars are now reserved rather than left over: the canvas fills the safe viewport minus a side bar of 16% of the width (150 to 200 px, and the canvas keeps at least 3/4 of its height in width) on each side in landscape, or bars of the same size above and below in portrait facing (`js/mpView.js` reservedSideBar / touchLayout). Keyboard and controller multiplayer reserves side bars for the HUD panels in landscape; in portrait it uses the compact canvas HUD. The table below is the original square-canvas estimate.

**Space check** (canvas = 90% of the short side; bar = the leftover each side):

| Device (landscape) | Canvas | Side bar | Portrait top/bottom bar |
|---|---|---|---|
| iPad 10.2" 1024x768 (full screen) | 691 | 166 | 166 x 768 |
| same in Safari with toolbar (≈1024x700, estimate) | 630 | 197 | – |
| iPad gen 7 test size 1080x810 | 729 | 175 | 175 x 810 |
| iPad Air 11" 1180x820 | 738 | 221 | 221 x 820 |
| iPad Pro 12.9" 1366x1024 | 921 | 222 | 222 x 1024 |
| 10" Android 1280x800 | 720 | 280 | 280 x 800 |
| 8" Android ≈962x601 (estimate) | 540 | 211 | 211 x 601 |

- **Side by side, per bar:** pause (48 px) in the top outer corner; the HUD panel at the top (touches pass through it); fire (84 px) in the bottom outer corner with hyperspace (60 px) above it. Needs a bar of at least 120 px, otherwise the game switches to facing. Each player's stick zone is their half of the screen, including their half of the play area. P2 is a mirror image of P1.
- **Facing, portrait:** P1's bar at the bottom (pause, HUD, hyperspace, fire on the right); P2's bar at the top, rotated 180°. Zones are the bottom and top halves.
- **Facing, landscape:** P1 uses the lower halves of both side bars, P2 the upper halves, mirrored.
- Every control stays at least 20 px plus the safe-area inset away from the top and bottom edges, where iPad system swipes live.
- **Multi-touch:** 2 players use 4–6 touches. iPads track about 11 (though Safari reports 5); Android varies from 2 to 10+. The lobby warns only if fewer than 4 are reported. iPad 4/5-finger multitasking gestures can throw players to the home screen; the lobby shows a one-time hint to turn them off (Settings > Multitasking & Gestures) or use Guided Access.
- **DOM:** existing ids and single-player positions stay pixel-identical (checked by the current layout tests). Zone B adds its own stick zone, fire, hyperspace and pause buttons; join pads appear in the lobby; stick visuals sit in an unrotated layer (finding 7). Body classes control what's visible: `mp-active`, `mp-layout-sides`/`mp-layout-facing`, `mp-zone-a`/`mp-zone-b`, `state-lobby`, `state-paused`, orientation.

## 10. Lobby and joining

### 10.1 Menu entry
Fold Easy/Medium/Hard into **"Difficulty: Medium ◂ ▸"** and add **"Multiplayer"** after Start. With Settings replacing Controls, the main menu becomes: Start, Multiplayer, Upgrades, High Scores, Achievements, Help, Settings, Reset Data, Change User, Difficulty (10 rows, 30 px each on a 1024x768 tablet). Make this change together with the Settings screen so the menu tests change only once.

### 10.2 Lobby
- One card per seat, placed where the players sit (left/right for side by side; bottom upright and top rotated for facing; a row or grid on desktop).
- Each card shows: "P1" with the ship in the player's colour and hull mark, the input ("Keys: W A S D · SPACE", "Controller 1", "Touch left"), the name, key-test lights, and the status (`Press FIRE to join` → `Joined – FIRE when ready` → `READY`).

| Action | Not joined | Joined | Ready |
|---|---|---|---|
| Fire (Space/F, Enter, Ⓐ, tap own join pad) | join (lowest free seat) | ready | – |
| Hyperspace (S, ↓, Ⓑ, long-press the pad) | – | leave | unready |
| Rotate left/right (or ◂ ▸ on the card) | – | change colour (skips taken colours) | – |
| Escape, Back | back to mode select (asks if anyone joined) | | |

- **Start:** when at least 2 players have joined and all are ready, a 3 s countdown starts; any unready or leave cancels it. Nobody has to "own" a Start button.
- **Names:** the first seat to join gets the signed-in profile; others are "Guest 2", "Guest 3" and can cycle through saved profiles (no typing in the lobby).
- **Rematch** rebuilds the same line-up, joined but not ready.
- The Enter that picked the mode can't accidentally join P2 (the lobby reads per-input events, and pending presses are cleared on screen change).

### 10.3 Colours and identity
Seat colours are defined per palette (Item 1) so they never clash with asteroids or UFOs:
- Standard: cyan `#33D6FF`, orange `#FFA23A`, pink `#FF66CC`, white.
- Colour-safe: white, yellow `#F0E442`, pink, lavender `#C9B6FF`.

Colour is never the only cue: a player number next to each ship (kept upright for its owner), a hull mark (none, stripe, dot, notch), numbered radar markers, and bullets tinted in the player's colour. The colour-blindness unit test from Item 1 also checks seat colours against each other and against the asteroid colours.

### 10.4 Controller disconnect
Mid-round: the seat is reserved and the game pauses: "P2's controller disconnected. Press Ⓐ on a controller to continue as P2, or pause menu › Drop P2." Resuming uses the countdown. In the lobby, the seat simply leaves.

## 11. HUD, pause and results screens

- **Per-player HUD in the side panels (DOM, new `js/hud.js`):** colour stripe, "P1" and name, score (24 px), lives as ship icons, power-up chips with time bars, combo with its timer, and a status line (`RESPAWN 2.1s`, `OUT – fly near to revive`, `PAUSED`). Written only when something changes, to keep older iPads smooth. Rotated for a facing player. Falls back to a compact on-canvas HUD in the corners when the bars are narrower than 150 px.
- **Centre of the canvas:** team score or round timer and level; in facing mode drawn twice (upright and rotated) via a helper, also used for banners and countdowns.
- **Off-screen markers:** an edge arrow in the player's colour with their number, for zoomed 3–4 player games or revive beacons; a respawn ring with the countdown.
- **Multiplayer pause menu:** Resume / Restart round / Change players / Main menu / Mute / Drop Pn (only when a controller seat is reserved). In facing mode it's drawn in both halves, each with its own tap areas.
- **Results screen:** winner or team banner, one column per player ranked (score, greens, reds, UFOs, deaths, best combo), and Rematch / Change players / Main menu. A 1.5 s input delay stops a held fire button from skipping it. Mirrored copies in facing mode.

## 12. Controls card, help and accessibility

- **Round intro:** before the first round of a lobby session, each player's panel shows their controls (key hints, controller glyphs, or "Drag here to steer · FIRE" with their zone and fire button pulsing), a faint divider shows each touch player's half, and one line of mode rules. Starts when everyone presses fire or after 8 s; later rounds show it for 2 s.
- The single-player tutorial doesn't run in multiplayer; the Help screen gains a "Multiplayer controls" section.
- **Accessibility:** auto-fire option; colour plus shape plus number for every player; HUD text at least 18 px; fire/hyperspace on the inner or outer side per touch player (left-handed players); hyperspace always a deliberate button; optional stereo panning of each player's sounds in side-by-side mode.

## 13. Testing

### 13.1 Unit tests (`node --test`)

| File | Cases |
|---|---|
| `camera.test.mjs` | midpoint of 2 points, including across the world edge; single point; no points keeps the previous centre; flip hysteresis in both directions; 3 evenly spaced points; **fit property**: 10,000 seeded random pairs on canvases of 337, 690 and 1024 px, every ship within `0.5V − 25` of the centre; 4-player zoom ≥ 0.8 at V = 690 and never below the minimum; starfield ignores flips; one target matches today's camera |
| `players.test.mjs` | combo thresholds (5 → 2x, 10 → 3x, 20 → 4x) and milestones; power-up expiry reported once; nearest living ship across the wrap, skipping dead ships and preferring vulnerable ones; team score; all out |
| `upgrades.test.mjs` | same multipliers as today; zero state never saves; purchase deducts credits; loading resets first |
| `modes.test.mjs` | every mode valid; 2-player co-op scaling numbers; solo scaling equals today; end conditions for each mode (co-op all out; Harvest tie → overtime → next green → draw; Duel 5th kill and time cap; Saucer target or time); respawn point furthest from the opponent avoiding hazards; revive rules (needs 2 lives, drains when out of range, completes at 2 s) |
| `rng.test.mjs` | same seed gives the same sequence; values in [0, 1); different seeds differ; level seeds stable |
| `ghost.test.mjs` | encode/decode round trip; interpolation across the world edge; 3-minute trace under 16 KB; corrupt data returns nothing |
| `mpRecords.test.mjs` | leaderboard insert and trim; name order in rivalry keys; corrupt data; guests excluded; reset filtering |
| `seats.test.mjs` | every key maps to one source; H only in single-player; seat joining (lowest free, idempotent, full at 4, max 2 touch seats), leaving, reserving and rejoining; vector rotation by 180° |
| `input.test.mjs` (additions) | W drives seat 0 only, ↑ seat 1 only; **regression**: holding ← and tapping A keeps turning; **regression**: holding S doesn't block ↓ hyperspace for P2; seat one-shots don't leak; pause from either player records who; quick taps last one frame; unjoined inputs only produce lobby events; zone B touch drives seat 1; palm takeover after 500 ms still (with a fake clock), a moving owner keeps the stick; a finger sliding into the other half keeps its seat; sliding onto the other player's fire button doesn't press it; releasing one seat leaves the other; controller sticks rotated for facing seats, touch sticks not; fake controller on seat 1 fires for seat 1 |
| `steering.test.mjs`, `hud.test.mjs` | stick steadying is per player; HUD text fields; the HUD writes only on change |

### 13.2 Browser tests (Playwright)

The test hook gains read-only fields: `players[]`, `mode` (id, time left, phase), `camera` (centre, zoom), `turn`, `results`, `mp` (layout, phase, who paused, resume countdown), `seats`, `lobby`, `isPressedSeat(action, seat)`, `joystickFor(seat)`, and bullets per owner. The existing `score`, `lives` and `ship` keep reading player 1, so current tests don't change.

| Spec | Runs on | Covers |
|---|---|---|
| `mp-keyboard.spec.js` | desktop | join with Space and Enter, ready, countdown; A + → at the same time turns P1 left and P2 right; both thrust and fire (bullets per owner); S hyperspaces only P1; pause shows who, resume countdown; the Enter that chose the mode doesn't join P2; **single-player regression**: arrows and WASD both still drive the one ship |
| `mp-lobby.spec.js` | desktop, iPad landscape | leave, colour cycling skipping taken colours, unready cancels the countdown, Escape back, rematch line-up, 5th input ignored, touch join pads (tap and long-press), layout toggle |
| `mp-touch.spec.js` | iPad landscape (Safari engine), Chromium touch | **four fingers at once** (drag zone A right, drag zone B up, hold both fire buttons) → P1 faces right, P2 faces up, both fire; taps 5 px either side of the middle go to the right player; palm takeover; a finger crossing the middle keeps its player; zone B buttons don't overlap each other or the play area, are at least 48 px and inside the screen |
| `mp-facing.spec.js` | iPad portrait and landscape | a P2 drag toward the bottom of the screen makes P2 fly toward the bottom (touch not rotated); P2's HUD is rotated 180°; portrait with side-by-side selected shows the rotate prompt |
| `mp-gamepad.spec.js` | desktop | two fake controllers join; controller 2's stick steers only P2; disconnect mid-round pauses with the message; reconnect and Ⓐ restores P2; mixing keyboard and controller |
| `mp-modes.spec.js` | desktop | Take Turns hand-over screen and results order; Co-op revive and game over only when both are out; Harvest timer end and overtime; Duel kill count to win; results screen buttons |
| `mp-layout.spec.js` | new projects: iPad 1024x768, iPad Air, iPad Pro, 10" Android | screenshots of lobby, intro card, gameplay with four fingers down, pause and results, side by side and facing, for human review |

Helper additions: `openMultiplayer`, `joinWithKeyboard`, `zoneCenter`, `joinPad`, `dragInZone` on the Fingers helper, `installFakeGamepads(page, n)` with press/release/axes/disconnect, `waitForSeatState`.

### 13.3 Hands-on testing with two people
- iPad (a 1024x768 model and an 11" or 12.9") and a 10" Android tablet: 10 minutes of co-op side by side on a stand and 10 minutes facing on a table, in both orientations where supported.
- Both players steering and firing at once for 60 s without dropped input; lifting and re-landing fingers repeatedly.
- A palm resting on the screen doesn't steal a stick for more than half a second or leave fire stuck on.
- iPad multi-finger gestures on and off; system edge swipes near P2's controls.
- P2's rotated HUD readable at arm's length; colour-safe palette with the iPad grayscale filter; player numbers visible on ships.
- Rotating mid-round pauses and re-lays out fairly.
- Shared keyboard on a MacBook, a Windows laptop and a USB keyboard: use the lobby key-test lights to check both players' 6 keys, then add hyperspace; record results in the README. Check Right Shift and Windows Sticky Keys, and that no browser shortcut fires.
- Two controllers (Xbox and DualSense) on Mac Chrome, Mac Safari and iPad Safari: join, switch one off mid-round, rejoin; mixed keyboard, controller and touch.
- AZERTY and QWERTZ keyboards.

## 14. Roadmap

| Phase | Work | Size | Needs |
|---|---|---|---|
| MP-0 | Controller poller reports each controller separately (during Item 8); seat colours in `palette.js` (during Item 1) | S | Items 8, 1 |
| MP-1 | Core refactor R0–R8; per-seat input with physical key matching (also fixes the single-player key bugs); both keep single-player identical | L + M | Item 2 |
| MP-2 | Mode layer, round flow (turn change, round end, results), saving helpers and records; **Take Turns**; menu row change and mode select | M + S | MP-1, Settings screen |
| MP-3 | Shared camera for 2 players, radar, `nearTeam` respawn; lobby, join pads, keyboard profiles, touch zones and side-by-side layout, DOM HUD panels, multiplayer pause and results; **Co-op "Wingmen"** | L | MP-2 |
| MP-4 | Field refill, spawn points, ship bump, overtime, rivalry records; **Harvest Race**, then **Duel**; facing layout | M + M | MP-3 |
| MP-5 | Controllers in multiplayer (join, reserve, rejoin); **Saucer**; 3–4 players with zoom for controllers/keyboard | M + M | MP-4, Item 8 |
| MP-6 | Seeded random generator, ghost recording and playback; **Time Attack vs Ghost**; identical Take Turns layouts | S + M | MP-2 |
| MP-7 | Round intro card, Help section, accessibility options, screenshot matrix, hands-on testing, tuning (palm timing, balance constants) | M | all |
| – | Add every new module to the service worker precache (Item 3) | – | README §D |

**Parallel work with agent teams:** the pure modules (`players.js`, `upgrades.js`, `camera.js`, `modes.js`, `mpRecords.js`, `rng.js`, `ghost.js`, `seats.js`, `hud.js`) can each be built with their unit tests by a separate agent at the same time. The input rewrite (MP-1 second half) is independent of the core refactor and can run in parallel. Wiring into `main.js` stays sequential by phase.

## 15. Risks

| Risk | Mitigation |
|---|---|
| Single-player breaks during the refactor (about 87 `ship` references, early returns in collisions) | One function per step with unchanged hook values; full test suite after every commit; a check that single-player always has exactly one player |
| Two ships changing the asteroid list mid-loop | Keep the break/continue pattern per player; remove dead objects once after all players |
| Camera flip feels like a jump | Hysteresis plus a 0.2 s glide; rare in co-op because players stay close |
| Balance (revive too easy, denial feels mean) | Revive needs 2 lives and costs one; "DENIED" feedback and a fast refill; all numbers in `modes.js` |
| Two copies of one profile saving over each other | One upgrade object per profile; save at round end, page hide and tab switch |
| Keyboard ghosting | Key choice, auto-fire, lobby key-test lights, documented per keyboard |
| Palms and iPad multi-finger gestures | Palm takeover rule, lobby hint, hands-on testing |
| Cramped 8" tablets and the Safari toolbar | Automatic switch to facing when bars are under 120 px; recommend installing the app for full screen (Item 3) |
| Enter is both P2 fire and menu select | Lobby reads per-input events; pending presses cleared on screen change; tested |
| Ghost runs diverge and depend on screen size | Presented as a pace ghost; screen size stored with the run and a notice when it differs |

## 16. Questions for you

Recommendations in bold. **Applied as defaults when implementation started (26 September 2026).**
1. Tablet seating: side by side, facing across a flat tablet, or **both** (chosen automatically by orientation)?
2. Touch players in multiplayer: **Drag to Steer only**, or also offer Buttons?
3. **Up to 4 players with keyboard or controllers, 2 on touch**, and 2 as the default everywhere: OK?
4. Fold Easy/Medium/Hard into one **"Difficulty ◂ ▸" row** to make room for "Multiplayer": OK?
5. Can **anyone resume** after a pause (with a countdown), or only whoever paused?
6. Other players: **pick a saved profile or play as guest** (earning credits only in co-op and Take Turns), or guests only?
7. Is an **auto-fire option** acceptable in competitive modes, where it affects balance? (Alternative: co-op only.)
8. Co-op revive rules (needs 2 lives, costs 1) and Harvest's 3-minute rounds: **start with these** and tune after playtesting?
9. Which mode first after Take Turns: **Co-op** or Harvest Race?
