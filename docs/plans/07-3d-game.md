# 3D game: full implementation plan (October 2026)

This plan turns the Phase 0 prototype (`?3d=1`, [06-3d-mode.md](06-3d-mode.md) §10) into the complete 3D game. It builds on the investigation in plan 06 and on everything the owner decided and tested since. Where this plan differs from plan 06 §6 (roadmap), this plan wins.

Status: **planned 8 October 2026**. Not started. The prototype stays behind `?3d=1` until Phase 6.

## Summary

| Topic | Plan |
|---|---|
| Biggest gameplay gap | Random collisions are more than 10 times rarer in 3D than in 2D (§2.1). Danger now comes from three sources aimed at the player: **incoming rocks**, **asteroid clusters** and **hunter UFOs** (owner decision, 8 October 2026). |
| Level structure | Each level is a **sector** with a fixed set of crystals, most of them inside clusters. Collect them all to finish the level. Red rocks don't have to be cleared. Boss every 2 levels, as in 2D. |
| Content | UFOs, boss, the 7 power-ups, hyperspace, lives, combos, scoring, Easy/Medium/Hard and adaptive difficulty, all mapped from 2D. |
| Progression | **Separate 3D high-score board**; **credits, upgrades and achievements shared** with 2D. |
| Controls | Direct, Rate and Joystick (all kept), Level horizon toggle (default off), desktop mouse and keys, game controller. |
| HUD | No cockpit frame. Two-circle radar stacked on the right edge. Crosshair, lead marker, edge arrows, threat and damage-direction warnings. |
| View distance | Normal, Far (default, above 70 fps on the Pixel 7 Pro), Very far. |
| Menu | Phases 1 to 5: the 3D game stays behind `?3d=1`. Phase 6: **"Start 3D" becomes the first main-menu entry and the default**, 2D stays one tap away. |
| Hosting | Unchanged: static files on free GitHub Pages, everything precached for offline play, installable app. |
| Testing | Unit tests and a headless **balance harness** locally (Node only). Every browser test runs on GitHub Actions, never on the Mac. |
| Size | About **5 to 7 weeks of agent time** in 6 phases, with a phone test by the owner after phases 1, 2, 3 and 5. |

## 1. Decisions so far

From plan 06 §8, the prototype feedback (§10.1) and this conversation:

1. Three control types, all kept: **Direct** (phone pose = ship pose, all axes), **Rate** (tilt sets the turn rate), **Joystick** (on-screen stick, two roll buttons). **Level horizon** is a toggle for all three, default **off** ("doesn't really help").
2. The ship's nose points where you look. No cockpit frame.
3. Wrap-around cube world, every object drawn at its nearest copy, fog hides the seam.
4. **Far** view distance is the default (owner: "far is fine, still >70fps").
5. **Two-circle radar** (front and rear), stacked on the right edge (owner, 8 October 2026: "too close to the center of the screen").
6. Danger fixes 1, 2 and 3: incoming rocks, clusters, hunter UFOs (owner, 8 October 2026).
7. Separate 3D high-score board; credits, upgrades and achievements shared.
8. 3D precached for everyone, offline.
9. No multiplayer in 3D for now.
10. "Start 3D" becomes the default and first menu entry once the 3D game is complete.

## 2. Gameplay design

### 2.1 Why nothing hits you today

The chance of hitting a rock depends on how many rocks are in the volume you fly through. In 2D a rock only has to cross your path; in 3D it must also be at your height.

With Far's numbers (144 red rocks in a 3200 cube, rock radius 24 to 42, ship radius 9), the average flight between two collisions is about 39,000 units. At top speed (260 per second) that's about 2.5 minutes of flying straight without dodging. A rough 2D estimate (4 large rocks of radius 40 in a 1200 × 1200 world, ship radius 15) gives about 3,300 units, so 3D is more than 10 times calmer, and the 2D screen also wraps you back into the rocks within seconds. Adding rocks doesn't fix this: matching 2D would need about 1,700 red rocks, almost 3 times the 600 object cap.

3D space games solve this by aiming danger at the player rather than relying on chance. The three sources below do that, and they keep the number of rocks (and so the frame rate) about where it is today.

**Tuning targets** (Medium, level 1, measured by the balance harness in §6.2):
- A rock or UFO on a collision course (a radar threat) about **every 6 to 10 seconds**.
- A pilot who flies straight at crystals and never dodges loses a life about **every 30 to 60 seconds**.
- A pilot who dodges loses a life about **every 2 to 3 minutes**.
- Easy halves the threat rate; Hard is about 1.5 times Medium. Each level raises it about 8 %.

### 2.2 Incoming rocks (fix 1)

- Some red rocks spawn **just beyond the fog** (cull distance), inside a 70° cone around the direction the ship is moving (random direction while the ship is nearly still). Each is aimed at the point where the ship will be when the rock arrives, plus a random miss offset. About a third would hit a ship that doesn't react.
- Speed 70 to 120 units per second at level 1 (×0.8 Easy, ×1.2 Hard), plus 4 % per level. Large or medium, so shooting one splits it into pieces that keep flying toward you.
- Rate: Medium level 1 one every 8 s, Easy 12 s, Hard 5 s; 0.4 s less per level, at least 3 s. At most 4 incoming rocks at once. No new one in the 3 s after a respawn.
- They fade in through the fog like every other object. The radar threat flash (already built) marks them once they're within 25 % of the view distance on a closing course. A short warning tone and a light vibration come with it.
- Incoming rocks that miss keep drifting and join the field. The field is trimmed far from the ship so the total stays within budget.

### 2.3 Asteroid clusters (fix 2)

- Most red rocks are gathered into **clusters**: spheres of radius 250 to 400 holding 18 to 30 rocks (mostly medium and small) that drift slowly together and tumble.
- **Most of the level's crystals sit inside clusters**, so collecting means flying through danger. The space between clusters is calm and has a few scattered rocks.
- At Far, level 1: 6 clusters of about 22 rocks plus 20 scattered, about 150 red rocks in total, the same as today. Inside a cluster, the average flight between collisions drops to about 1,100 units, so crossing one without dodging is a real risk.
- Clusters scale with the view distance (more clusters, not denser ones, in a bigger cube), with level (+1 cluster every 2 levels, rocks +2 per cluster per level) and with difficulty. The total stays under `MAX_FIELD_ROCKS` (600).
- The radar shows each cluster's rocks as usual. Clusters beyond the view distance appear as a faint ring on the radar rim, so you can find the next one.

### 2.4 Hunter UFOs (fix 3)

- Purple saucers, as in 2D: score 200, 1 hit to destroy.
- They come in from beyond the fog, close to 300 to 500 units, then circle and strafe the player at that range. They avoid the inside of clusters.
- They fire **dodgeable bullets** (speed 320, life 3 s) aimed at where the ship will be, with the 2D accuracy per difficulty (`ufoAccuracy`: 0.6 Easy up to Hard's value) and the 2D fire rate (`fireRate` 2 s, with ±50 % jitter). Like in 2D, they also shoot crystals.
- At most 1 at once at levels 1 and 2, 2 from level 3, 3 from level 6. Spawn timing follows 2D's `ufoSpawnMultiplier`.
- The radar shows them as a purple saucer glyph. An edge arrow points to any UFO within the view distance that's off screen. A **damage-direction marker** (a red arc at the screen edge) shows where a hit came from.

### 2.5 Level structure

- Each level is a **sector**: a new seeded field of clusters, scattered rocks and a fixed number of crystals (Far: 24 at level 1, +3 per level, at most 60). Crystals don't refill during a level.
- **Level complete:** all crystals collected, and the boss destroyed on boss levels. Red rocks don't have to be cleared. Hunting every rock in a 3D cube would be tedious, unlike 2D's single screen.
- A HUD counter shows the crystals left. When only 3 are left, each one gets an edge arrow.
- Between levels: a short "Sector N" banner, 3 s of invulnerability, and a new field generated around the ship (nothing within 320).
- Lives, the extra-life threshold, combos (a quick series of crystals) and the score values match 2D. One rock or bullet hit costs a life; the ship respawns at its position with 3 s of invulnerability, and rocks within 150 are pushed away.

### 2.6 Boss (every 2 levels)

- A mothership with a slowly rotating core (radius about 150) and **4 glowing weak points** spread around it, so you have to fly around it to reach them. Weak-point health comes from the 2D boss (`js/boss.js`).
- It fires bursts from its turrets and releases one escort UFO each time a weak point is destroyed.
- It's drawn with a glow that stays visible through the fog up to 1.5 times the view distance, and the radar shows it as a ring glyph with a permanent edge arrow, so it's always findable.
- Boss levels have half the crystals and fewer clusters.

### 2.7 Power-ups

- The same 7 types, drop chances (`js/powerup.js`) and durations as 2D, dropped by destroyed rocks and UFOs. They float as spinning glyph billboards and show as squares on the radar.
- In 3D: **Shield** is a bubble around the ship; **Magnet** pulls crystals within a sphere; **Triple shot** fires 3 bullets 3° apart; **Rapid fire**, **Speed boost**, **Score multiplier** and **Extra life** work as in 2D.
- Active power-ups show as chips with a timer bar on the HUD, top left under the score.

### 2.8 Hyperspace

Kept, as plan 06 recommended. A button next to Fire (H on desktop, B on a controller) jumps to a random point clear of rocks, with the same risk rules and cooldown as 2D.

### 2.9 Aiming

- A **lead marker** in front of a moving target that's near the crosshair, and brackets around the current target.
- **Aim assist** (Off, Low, High; default Low): a bullet bends slightly toward a target within 2° (Low) or 4° (High) of the crosshair.
- A hit flash on the target, and a short explosion of debris particles when a rock splits.

## 3. HUD and controls

- **Radar:** the two circles stacked on the right edge (built 8 October 2026, deployed with this plan). New glyphs: UFO (saucer), boss (ring), power-up (square), cluster beyond range (faint rim ring).
- **Top left:** score, lives, crystals left, speed, active power-ups. **Top right:** Pause (and Recentre for Direct and Rate). **Bottom:** Thrust left, Fire right (Joystick mode: Thrust next to Fire, stick on the left), Hyperspace small next to Fire, roll buttons in Joystick mode with Level horizon off. The footer line (frame rate, view distance) moves into a debug setting.
- **Warnings:** radar flash, edge arrow, short tone and light vibration for a threat; red edge arc for a hit, showing its direction.
- **Desktop:** pointer-lock mouse, W/↑ thrust, Space/F/click fire, A/D or Q/E roll, H hyperspace, Esc pause.
- **Controller:** the existing `js/gamepad.js`: left stick turn, triggers thrust and fire, bumpers roll, B hyperspace, Start pause.
- Upgrades map to 3D: Collection Radius → pickup radius; Thrust Power → acceleration; Starting Lives → lives; Turn Speed → maximum turn rate in Rate and Joystick (Direct follows the phone 1:1 and is unaffected); Power-Up Duration → durations.

## 4. Menus, settings and progression

- **3D screens** (DOM overlay in the 3D page, built like the prototype's start screen): Play, Settings, High Scores, Help, Back to 2D. Pause menu: Resume, Restart, Settings, Quit to 3D menu.
- **3D settings:** control type, Level horizon, sensitivity, invert up/down, view distance, aim assist, field of view (60 to 95°, default 70°), vignette during fast turns, left-handed layout. Shared with 2D (same keys): colours (Colour-safe), vibration, music tune and volume, sound effects volume, controller rumble.
- **High scores:** separate 3D board, top 10 per profile (key `asteroids_highScores3d`, same format as 2D), name entry with the existing name rules. The 2D High Scores screen gets a 2D / 3D switch.
- **Credits, upgrades, achievements:** shared, through the existing `js/persistence.js`, `js/upgrades.js` and `js/achievementManager.js`. 3D events count toward the existing achievements (score, level, rocks destroyed, UFOs destroyed). New 3D achievements are optional and not planned.
- **Switching between 2D and 3D:** a full page change (`./` and `./?3d=1`). Both come from the offline cache, so this takes about a second, and the 2D and 3D games never share live state. This is simpler and safer than running both in one page.
- **Updates:** the 3D page applies a waiting update on its menu and game-over screens (fixed 8 October 2026) and shows the build version in its menu.

## 5. Architecture

- **Entry:** `js/3d/game3d.js` replaces `proto3d.js` as the entry `js/main.js` imports for `?3d=1`. Split the prototype's DOM and input code into `ui3d.js` (menus, settings, buttons) and `input3d.js` (touch, mouse, keys, controller, sensors).
- **Pure, DOM-free modules** (unit-tested without a browser):
  - `rules3d.js`: levels, difficulty, crystal counts, threat rates, scoring tables.
  - `spawn3d.js`: sectors, clusters, incoming rocks, field trimming.
  - `ufo3d.js`: hunter movement, aiming with lead, firing.
  - `boss3d.js`: core, weak points, turrets, escorts.
  - `powerup3d.js`: drops and effects.
  - `sim3d.js` (grows): the fixed-step game simulation calling the modules above.
  - `progress3d.js`: high scores, credits, achievements and upgrades through the shared 2D modules.
- **Shared from 2D:** `persistence.js`, `upgrades.js`, `achievementManager.js`, `settings.js`, `audio.js`, `music.js`, `tunes.js`, `haptics.js`, `gamepad.js`, `palette.js`, `names.js`, `rng.js`, `wakeLock.js`, `pwa.js`. Two extractions from `main.js` come first, each checked against the full 2D test suite: `DynamicDifficulty` into `js/difficulty.js`, and the `Difficulty` table plus level constants into the rules module.
- **Renderer:** `render3d.js` stays the only three.js importer. It gets meshes for UFOs, boss, power-ups, the shield bubble and explosions, all instanced or pooled.
- **Performance budget** (Far, Pixel 7 Pro): at least 60 fps; at most 600 field objects, 6 UFOs including escorts, 200 bullets and 400 particles; under 25 draw calls. The adaptive render scale stays.
- **Test hook:** `window.__spaceAdventure.game3d` grows with level, crystals left, UFOs, boss, power-ups and threats; `?seed3d=N` and `layout3d=` test layouts stay.

## 6. Testing

### 6.1 Rules for this work
- **No browsers, servers, Playwright or audio on the Mac.** Agents only run `nice -n 10 npm run test:unit` and `node --check` locally.
- Browser tests run on GitHub Actions: push to `release-candidate`, wait for green, then push `main`.

### 6.2 Balance harness (new)
- `scripts/balance3d.mjs` runs the pure simulation headless for seeded minutes with two scripted pilots: one flies straight at the nearest crystal and never dodges; the other also turns away from threats.
- It reports threats per minute, collisions per minute, crystals per minute and level time per difficulty and level.
- A unit test checks the targets in §2.1 within a tolerance band, so later changes can't silently make the game trivial or unfair again. It runs in Node only and takes seconds.

### 6.3 Unit tests (Node)
Cluster and sector generation, incoming-rock aiming and rates, UFO movement and lead, boss weak points, power-up effects, level completion, scoring and combos, high scores and shared progression through the real persistence modules, menus and settings on the fake DOM.

### 6.4 Browser tests (GitHub Actions)
- `chromium-3d` and `chromium-3d-desktop` with SwiftShader: a full seeded level (collect, shoot, get hit, respawn, level up), a boss level, power-ups, pause and resume, settings persist, the high-score entry, switching to 2D and back, offline reload, screenshots in the `screenshots` artifact.
- `no3d.spec.js` keeps checking that 2D never loads a 3D file.
- WebKit: only that 3D is offered or hidden correctly and that the menus work (too slow for gameplay without a GPU).

### 6.5 Owner phone checks
After phases 1, 2, 3 and 5 on the Pixel 7 Pro (and an iPhone if available): feel, danger level, frame rate. Each check lists what to try.

## 7. Phases

| Phase | Content | Size | Done when |
|---|---|---|---|
| 1 Danger and levels | `rules3d`, `spawn3d`: sectors, clusters, incoming rocks, crystals-left counter, level complete and banner, respawn rules, damage-direction marker, threat tone; balance harness; extract `DynamicDifficulty` and the difficulty table from `main.js` | L | Harness meets §2.1 targets; owner phone check: "I get hit when I'm careless" |
| 2 Hunters | Hunter UFOs, UFO bullets, lead marker, target brackets, aim assist, explosions, sound effects in 3D (stereo pan by direction) | L | UFOs a fair threat in the harness and on the phone |
| 3 Boss, power-ups, hyperspace | Boss with weak points, turrets, escorts, boss glow and arrow; 7 power-ups; hyperspace | XL | Matches 2D single-player content; owner phone check |
| 4 Menus and progression | `game3d` entry, `ui3d`, `input3d`; 3D menu, pause menu, settings, Help page; 3D high scores and name entry; shared credits, upgrades and achievements; 2D High Scores 2D / 3D switch; version label | L | A full game from menu to high-score entry; 2D suite green and unchanged |
| 5 Platform and comfort | 3D tutorial (asks first, like 2D), music, vibration and rumble, controller, desktop polish, field of view, vignette, invert, left-handed layout, capability check and slow-device offer to switch to 2D | L | Every input type tested; owner phone check |
| 6 Launch | "Start 3D" first in the main menu and the default; remove the `?3d=1` gate (keep it as a direct link); context-loss handling; iPhone motion-permission check in the installed app; docs and README | M | Live on Pages, works offline and installed, 2D unchanged |

S = under a day, M = 1 to 2 days, L = 2 to 3 days, XL = a week or more. Phases 1 and 2 can overlap (separate modules), and phases 4 and 5 can partly run in parallel with agent teams. Each phase ends with a CI run and a deploy behind `?3d=1`.

## 8. Risks

1. **Balance:** the right threat level is a feel question. The harness keeps numbers stable, but the phone checks decide.
2. **Frame rate with more content:** UFOs, boss and particles add draw calls. Instancing, pools and the adaptive render scale keep this in check; Very far may need fewer clusters.
3. **iPhone:** motion permission in the installed app may need a tap on every launch; not tested on a real iPhone yet.
4. **Two games to maintain:** shared modules keep progression consistent, but rules changes in 2D won't reach 3D automatically.
5. **Making 3D the default:** slower devices could land in 3D first. The capability check offers 2D in that case, and 2D stays one tap away.
6. **CI only:** SwiftShader in CI is slow, so browser tests use short seeded scenarios and the harness covers long play.

## 9. Open questions (defaults used unless you decide otherwise)

1. **Level goal:** collect all sector crystals, red rocks optional (**default**), or also clear every red rock as in 2D?
2. **Hits:** one hit costs a life as in 2D (**default**), or a small shield bar that absorbs one or two hits?
3. **UFOs shoot crystals** as in 2D (**default yes**)?
4. **Aim assist** default Low (**default**)?
5. **Switching 2D and 3D** by a page change (**default**), which is simpler and keeps both games independent?
