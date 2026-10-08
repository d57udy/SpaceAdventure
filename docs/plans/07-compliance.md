# Plan 07 compliance (8 October 2026)

Each requirement of [07-3d-game.md](07-3d-game.md), checked against the code. **Done** means it is implemented, with where it lives. **Deviated** means it is done differently, with why. **Missing** means it is not done, with the owner who would do it. "ui3d" is the agent that owns sim3d, ufo3d, boss3d, hyperspace3d, meshes3d and spawn3d. Browser behaviour is covered by CI specs only; nothing here was run in a browser locally.

## §1 Decisions

| # | Requirement | Status |
|---|---|---|
| 1 | Direct, Rate and Joystick; Level horizon toggle, default off | Done: `look.js`, `settings.js` (`control3d`, `levelHorizon3d` false), Settings rows in `ui3d.js` |
| 2 | Nose points where you look; no cockpit frame | Done: `look.js` → `sim3d` ship.q; `hud3d.js` has no frame (unit test) |
| 3 | Wrap-around cube, nearest copy, fog hides the seam | Done: `world3d.nearestDelta`, `render3d.js` radial fog, `FOG_SEAM_RATIO` |
| 4 | Far is the default view distance | Done: `settings.js` `viewDistance3d: 'far'` |
| 5 | Two-circle radar stacked on the right edge | Done: `radar3d.radarLayout` (left edge in the left-handed layout) |
| 6 | Danger from incoming rocks, clusters and UFOs | Done: `spawn3d.js`, `ufo3d.js`, `sim3d.js` |
| 7 | Separate 3D board; credits, upgrades, achievements shared | Done: `progress3d.js`, `persistence.js` (`highScores3d`), `ui3d.js` |
| 8 | 3D precached for everyone, offline | Done: `scripts/update-sw-version.mjs` (js/3d/**), `sw.js` |
| 9 | No multiplayer in 3D | Done (none built) |
| 10 | "Start 3D" first and default once complete | Done: `js/main.js` `mainMenuItems` (first row, focused by default where 3D runs, `is3dAvailable`) |
| 11 | Level ends with no red and no green left; greens can be shot (wasted) | Done: `sim3d.js` level rule, `wasted` |
| 12 | Hits as in 2D | Done: `sim3d.js` `shipHit` (shield, grace, respawn) |
| 13 | UFOs as in 2D | Done: `ufo3d.js` in `sim3d.js` |
| 14 | Aids switch on with the adaptive level, no settings | Done: `assist3d.js`, `sim3d.js` `syncAdaptive` |
| 15 | Switching 2D / 3D in the menu | Done: `ui3d.js` Switch to 2D, `main.js` Start 3D, `mode3d.js` |

## §2 Gameplay

| § | Requirement | Status |
|---|---|---|
| 2.1 | Tuning targets (Medium L1: threat 6–10 s, careless 30–60 s, dodging 2–3 min) | Done: `scripts/balance3d.mjs`, `tests/unit/balance3d.test.mjs` (7 s / 56 s / 120 s). Easy and Hard are not tuned to exactly ½ and 1.5 × (only Medium is fixed); the "+8 % per level" isn't measured |
| 2.2 | Incoming rocks: cone, intercept aim, miss disc, speeds, sizes, timing, cap 4, respawn hold, release at clear | Done: `spawn3d.js`, `rules3d.js`. Deviated: interval 4.5 / 7 / 3.5 s and miss disc 1.5 (re-tuned with UFOs, written up in plan §2.1) |
| 2.3 | Clusters (size, members, drift, tumble), crystals mostly inside, level growth, `greenRatioMod`, far clusters as a rim ring | Done: `spawn3d.js`, `rules3d.js`, `radar3d.js` (seam-safe centres, review #12) |
| 2.4 | UFOs: one at a time, 15 s rule, speed 100, shots every 2 s, 30 % at greens, accuracy rule, passes within half the view, 3D cone matches the 2D hit chance, ramming | Done: `ufo3d.js`, `sim3d.js`. Missing: the harness doesn't yet report the UFO hit chance against 2D (§6.2 asks for it); `ufo3d.test.mjs` checks the cone formula instead (owner: whoever owns `scripts/balance3d.mjs`) |
| 2.4 | Radar saucer glyph, edge arrow for UFOs off screen, damage-direction arc | Done: `radar3d.js`, `hud3d.js`, `game3d.js` |
| 2.5 | Fixed rock set, boss levels at 40 %, level-complete rule, wasted greens, last-5 radar and arrows, banner, 3 s protection, field clear of 320, rocks-left HUD, hit rules, shield, 2 s respawn, push-out 150, combos, extra life, red rocks score nothing | Done: `rules3d.js`, `sim3d.js`, `radar3d.js`, `hud3d.js`. Blockers (UFOs or the boss once the rocks are gone) show at any distance with arrows (review #1, radar part) |
| 2.6 | Boss: core, 4+ weak points, 2D health, bursts from turrets, an escort per weak point, glow to 1.5 × view, ring glyph, permanent edge arrow | Done: `boss3d.js`, `meshes3d.js`, `radar3d.js` / `game3d.js` (boss at any distance with an arrow); turret flash wired (review #7) |
| 2.6 | Boss levels have half the crystals and fewer clusters | Deviated: boss levels use 40 % of everything (`rules3d.levelPlan` `bossFieldShare`), the 2D rule in §2.5. Half the crystals would need a separate share (owner: `rules3d.js`, which neither agent owns yet) |
| 2.7 | 7 power-ups, 2D chances and durations, 30 % drops plus one every 20 s (× `powerUpSpawnMod`), within view, glyph billboards, squares on radar, shield bubble, magnet sphere, triple 3°, chips with timer bars | Done: `powerup3d.js`, `sim3d.js`, `meshes3d.js`, `radar3d.js`, `hud3d.js` |
| 2.8 | Hyperspace: button next to Fire, H, controller Ⓑ, 2D risk and cooldown | Done: `hyperspace3d.js`, `sim3d.js`, `game3d.js` (`#p3-hyper` with a cooldown count) |
| 2.9 | Aids table (aim 4° / 2° / off, lead marker, crystal arrow modes, warnings, +50 % pickup); brackets and hit flash always | Done: `assist3d.js`, `sim3d.js`, `game3d.js`, `hud3d.js` |

## §3 HUD and controls

| Requirement | Status |
|---|---|
| Radar glyphs: saucer, ring, square, faint rim ring | Done: `hud3d.drawRadar` (and a dot for hostile shots on a collision course) |
| Top left: score, lives, crystals left, speed, active power-ups | Done, with one deviation: the counter is ROCKS LEFT (rocks plus crystals, the 2D level rule), not crystals alone. Also shows the adaptive difficulty label |
| Top right: Pause (and Recentre for Direct and Rate) | Done: Recentre hides in Joystick (`game3d.refreshUi`). Deviated: the quick Control type and Level horizon buttons stay in the top bar (owner tested them) |
| Bottom: Thrust left, Fire right; Joystick: Thrust next to Fire, stick left; Hyperspace next to Fire; roll buttons in Joystick with Level horizon off | Done: `game3d.js` CSS, mirrored by Left-handed layout |
| Footer (frame rate, view distance) into a debug setting | Done: setting `debug3d` (Settings row "Frame rate line"), `hud3d.drawHudText` draws the footer only with it |
| Warnings: radar flash, edge arrow, tone, vibration for a threat; red arc for a hit | Done (tone and vibration follow the aids table) |
| Desktop: pointer-lock mouse, W/↑ thrust, Space/F/click fire, A/D or Q/E roll, H hyperspace, Esc pause | Done: `game3d.js`; plus a "Click the view to steer" hint until the mouse is captured, and no cursor while captured |
| Controller: left stick turn, triggers thrust and fire, bumpers roll, Ⓑ hyperspace, Start pause | Done (compliance pass): LT thrust, RT (or Ⓐ) fire, LB / RB roll (right stick too), Ⓑ hyperspace, Start pause; menus with D-pad / stick, Ⓐ, Ⓑ. Help and tutorial texts updated |
| Upgrades map to 3D | Done: `progress3d.shipMods3d` → `sim3d` (pickup, thrust, lives, durations), `look.turnRateMult` (Rate, Joystick) |

## §4 Menus, settings, progression

| Requirement | Status |
|---|---|
| 3D screens: Play, Settings, High Scores, Help, Switch to 2D; pause menu Resume, Restart, Settings, Quit | Done: `ui3d.js`, wired in `game3d.js` (also Upgrades and Profile) |
| 3D settings (control, Level horizon, sensitivity, invert, view distance, FOV 60–95 default 70, vignette, left-handed) and shared ones | Done: `ui3d.SETTINGS3D_ROWS`, applied live in `game3d.onSettingChange`. Deviated: FOV 70 means the tuned view (about 90° across on wide screens) and the setting scales it (`radar3d.verticalFov`), so the default view is unchanged |
| High scores: separate 3D board, top 10, name rules; 2D High Scores gets a 2D / 3D switch | Done: `progress3d.js`, `ui3d.js`, `main.js` (`highScoresBoard`) |
| Credits, upgrades, achievements shared; 3D events count | Done: `game3d.progressEvent` (credit rule as in review #5) |
| Switching remembered; installed app opens where you left it | Done: `mode3d.js` `startupRoute` / `writeLastMode`, `game3d.switchTo2d` clears it, `main.js` sets it for ?3d=1 |
| Updates applied on the menu and game-over screens; version shown | Done: hook `updateSafe` read by `main.js`; `js/version.js` → menu label |

## §5 Architecture

| Requirement | Status |
|---|---|
| `game3d.js` entry, `ui3d.js`, `input3d.js` | Done: `game3d.js` (proto3d.js re-exports it), `ui3d.js`. Deviated: `input3d.js` not split (input is tied to pause, menu and tutorial state; low value for the risk) |
| Pure modules (`rules3d`, `spawn3d`, `ufo3d`, `boss3d`, `powerup3d`, `sim3d`, `progress3d`) | Done |
| Shared from 2D | Done (persistence, upgrades, achievements, settings, audio, music, haptics, gamepad constants, palette, names, rng, wakeLock, pwa) |
| `render3d.js` the only three.js importer | Deviated: `meshes3d.js` imports three.js too (builders called by render3d) |
| Budget: 600 objects, 6 UFOs, 200 bullets, 400 particles, < 25 draw calls, ≥ 60 fps on the Pixel 7 Pro | Done for the caps (particles: 160 sparkles + 240 debris after this pass; `meshes3d` UFOs 6, shots 200). Not measured: draw calls in CI are only checked below 30 (`proto3d.spec.js`); frame rate needs the owner's phone check |
| Test hook grows; `?seed3d=N` and `layout3d=` stay | Done (layouts: range, far, last, ufo, boss, doom, powerup, blocked) |

## Phase 5 and 6 rows

| Requirement | Status |
|---|---|
| 3D tutorial, asked first | Done: `tutorial3d.js` in `game3d.js` |
| Music | Done: `audio3d.update({ screen, bossActive, lives, tutorialActive })` every frame |
| Vibration and rumble | Done: `haptics3d.js` |
| Controller | Done (see §3) |
| Desktop polish | Done: pointer-lock hint, hidden cursor, Esc and P pause, keyboard menus |
| FOV, vignette, invert, left-handed | Done |
| Capability check and slow-device offer | Done: `mode3d.can3d` (software renderers excluded), `perf3d.js` prompt |
| "Start 3D" first and default; keep ?3d=1 as a link | Done: `main.js` |
| Context-loss handling | Done: `perf3d.js` tracker, prompt, rebuild, 2D fallback |
| iPhone motion permission in the installed app | Done: requested inside the starting gesture, else a Motion prompt whose Allow is the gesture. Not tested on a real iPhone |
| Landscape | Done (compliance pass): `orient3d.js` locks landscape while a game runs where allowed (Android full screen, installed app) and unlocks on Quit and Switch to 2D; iPhones get a "turn your iPhone sideways" banner (also over the menus) |
| Reduce motion | Done (compliance pass): `prefers-reduced-motion` gives gentler flashes, no hyperspace tunnel, no pulsing highlights. No camera shake exists in 3D (none was added) |
| Colour-safe | Done (compliance pass): `render3d.setPalette` (blue crystals, orange rocks; radar, arrows and debris already used the palette) |
| Docs and README | Missing: README still says "in development … behind ?3d=1" (owner: whoever updates docs at launch) |

## §6 Testing

| Requirement | Status |
|---|---|
| No browsers locally; CI runs them | Followed |
| Balance harness with targets in a unit test | Done |
| Harness reports the UFO hit chance against 2D | Missing (see §2.4) |
| Unit tests per module | Done |
| CI: full seeded level, boss level, power-ups, pause and resume, settings persist, high-score entry, 2D and back, offline reload, screenshots | Done in `proto3d.spec.js` / `game3d.spec.js` (level end via `layout3d=last`, boss via `layout3d=boss`, power-up layout, doom game over). Offline reload: `tests/uat/live-3d.spec.js` only |
| WebKit: 3D offered or hidden, menus work | Partly: the WebKit projects run the 2D specs (`no3d`, `mode-switch`); no WebKit run of the 3D menus |

## For the ui3d agent (files I don't own)

- `sim3d.js` / `ufo3d.js`: review #1 sim side (far UFOs re-aiming once the rocks are gone), already in progress.
- `rules3d.js` (unowned): boss levels with half the crystals (§2.6) if the owner wants the plan's number instead of the 2D 40 % rule.
- `scripts/balance3d.mjs` (unowned): report the UFO hit chance against 2D (§2.4, §6.2).
- `meshes3d.js`: a colour-safe variant isn't needed for UFOs (purple) or the boss, but its bullets' magenta and orange could be checked against the Colour-safe palette.
- `meshes3d.js`: with `prefers-reduced-motion`, the shield-bubble flicker and the boss weak-point pulsing could be calmer. The page already turns off the hyperspace tunnel.

## Added to the pass: review #1 (page side) and #13

- **#1:** `game3d.updateRadar` takes its show-all decision from `sim3d.showAllTargets(sim)`. With no rock left, UFO edge arrows show at any distance. The lists passed to `buildRadar` and `remainingMarkers` include the UFOs and the boss. Checked by the `layout3d=blocked` unit test (the UFO on the radar beyond the view distance, with an arrow).
- **#13:** behaviour is unchanged; no new objects are made per frame in these hot paths.
  - render3d: hostile bullets go straight to meshes3d (no mapping). The builder states, the view for the builders and the ship-to-object delta are reused. Spark colours are written by index.
  - game3d: `renderView` returns the same object every frame. UFO and boss shots share one reused list, as do the radar's object list, options, ship and colours.
  - The sim side of #13 (`ufo3d.configure`, `ddaOf` per step) is ui3d's.
