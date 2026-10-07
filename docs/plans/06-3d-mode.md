# 3D cockpit mode: investigation and plan (October 2026)

An optional first-person 3D mode next to the existing 2D game. On phones, the way you hold the device sets where the ship looks; on-screen Thrust and Fire buttons fly and shoot. 2D stays the default (and the choice for slower devices). 3D is single-player only at first. It must keep working on free GitHub Pages and in the installed app.

Status: **Phase 0 prototype built (7 October 2026)**; the full build is planned in [07-3d-game.md](07-3d-game.md), which replaces the roadmap in §6. Two research passes (technology; game design and architecture) are merged below; the owner's decisions are in §8, and what Phase 0 contains is in §10.

## Summary

| Question | Recommendation |
|---|---|
| Can this run on GitHub Pages and as an installable app? | **Yes.** Everything is static files. The 3D library is committed to the repo (no CDN, so it works offline) and loaded only when 3D is used. |
| 3D engine | **three.js (WebGL2), version pinned and vendored** into the repo. About 180 KB compressed. A hand-written WebGL2 renderer is the backup if download size ever matters more than development speed. WebGPU and WebXR are not worth it yet (iPhone Safari has no WebXR; WebGPU reach on low-end Android and CI testing are weak). |
| Phone motion | The standard `deviceorientation` event, converted to a quaternion with screen-rotation compensation (works on Android and iPhone; iPhone needs a one-tap permission). Android Chrome's `RelativeOrientationSensor` as an optional upgrade. |
| Control model | **"Comfort" hybrid by default:** inside a comfortable range the phone points exactly where you look; pushing past the edge keeps turning the ship; the neutral position slowly re-centres to however you're holding the phone. **"Full 360"** (turn your body) and **"Tilt steer"** (joystick-like) as options; **"Touch"** (drag to look) when there's no sensor or permission. |
| Ship and camera | **The ship is the camera:** the nose points where you look, the crosshair is fixed in the centre, thrust pushes forward. No roll, so the horizon stays stable (much more comfortable). |
| World | A **3D wrap-around cube** (the 3D version of today's wrap-around world), with fog hiding the seam and a fixed star background for orientation. |
| Does 2D change? | No. 3D is a separate game loop in `js/3d/`, loaded only when you start 3D. It reuses settings, scores, credits, upgrades, achievements, music, haptics and controllers. 2D players never download the 3D code. |
| Size of the work | About **4–6 weeks of agent time** in 5 phases, starting with a short spike you try on your phones before the big build. |

## 1. Controls

### Why not just "point the phone where you look"?
Pure "magic window" control (the phone's real direction is the view) is the most immersive and the most precise for aiming, but you have to physically turn around to look behind you. That's fine on a swivel chair, tiring on a couch, and unusable in a car or train (the vehicle's turns rotate your view).

### Recommended: Comfort hybrid
- **Inside a cone** (about ±30° left/right, ±20° up/down of the neutral position): the view follows the phone directly, slightly amplified (a sensitivity setting), so small wrist movements look around and aiming feels 1:1.
- **Past the edge of the cone:** the view stays at the edge and the ship keeps turning, faster the further you tilt (like pushing against the edge in a shooter), up to about 120° per second.
- **Drag** on a free area of the screen to turn quickly without twisting your wrist.
- **Auto-recentre:** whatever position you hold for a while slowly becomes the new neutral (about 15–20 s). This absorbs sensor drift, slouching on the couch, and a car turning. A **Recentre button** (and double-tap) sets it immediately.
- **Start of each 3D game:** "Hold the phone comfortably, then tap to start". This sets the neutral position and, on iPhone, is the tap that grants motion permission.
- **No roll:** the camera turns left/right and up/down around a fixed "up"; up/down is limited to ±80°. No loops in the first version.

### Other inputs
| Device | Look | Thrust | Fire | Hyperspace | Pause |
|---|---|---|---|---|---|
| Phone/tablet with motion | Phone direction (plus drag) | Left-thumb button | Right-thumb button (hold for auto-fire) | Small button next to Fire | Top bar, plus Recentre and Mute |
| Phone/tablet without motion | Drag anywhere outside the buttons | same | same | same | same |
| Desktop | Mouse (pointer lock after a click) | W / ↑ | Space / F / left click | H | Esc / P |
| Controller | Left stick (with acceleration curve) | Right trigger | A / RB | B | Start |

Light **aim assist** (bullets bend slightly toward a target within 2–3° of the crosshair; Off / Low / High) because aiming at small rocks in 3D is harder than in 2D.

### How the sensor maths works
- Read `deviceorientation` (alpha/beta/gamma), convert to a quaternion (never interpolate the angles directly; they jump near straight up/down), and compensate for screen rotation with `screen.orientation.angle`. The research verified this formula in Node against the reference three.js implementation over 10,000 random poses and all four screen orientations.
- Don't filter heavily: the phone's operating system already fuses the gyroscope and accelerometer. Store the latest reading and use it each frame, with light smoothing (a "1€ filter") for jitter only.
- Use the **relative** orientation (no compass), so nearby metal or magnets can't make the view jump.
- **iPhone/iPad:** `DeviceOrientationEvent.requestPermission()` has to be called from a real tap on a DOM button (the game's canvas taps are processed later in the game loop, so they don't count). Whether an installed home-screen app keeps the permission between launches isn't documented; plan for one tap per launch and test on a real iPhone.
- **Android Chrome:** no prompt; motion can be blocked in site settings. Same behaviour expected in the installed app.

## 2. The 3D game

| 2D | 3D |
|---|---|
| Wrap-around rectangle, 1.5 screens per side | Wrap-around cube; each object drawn at its nearest copy; fog hides the far edge so the wrap is never visible |
| About 4–5 rocks on screen | Same target: about 4–6 rocks in view within fog range (roughly 30–40 rocks in the cube at level 1, +4 per level, max about 90); rocks drift slower (judging depth is harder) |
| Green crystals: fly into them | Glowing crystal (bipyramid) meshes; a more generous pickup radius (plus the Collection Radius upgrade) |
| Red spiky rocks: shoot, they split | Spiky star-shaped rocks with an X mark, split large → medium → small with pieces flying apart; colour-safe palette shapes kept |
| Bullets | Fast projectiles (not instant hits), so UFO shots can be dodged and a lead indicator makes sense |
| UFOs shoot you and greens | Purple saucers with the same behaviour and timing |
| Boss every 2 levels with weak points | A large rotating core with 3–4 glowing weak points; you fly around it to expose them |
| Power-ups | Same 7 types and durations, as spinning glyph billboards; magnet and shield become spherical |
| Hyperspace | Jump to a random point clear of rocks, same risk rules |
| Scoring, combos, levels, lives, difficulty, adjusting difficulty, upgrades, credits, achievements | Reused unchanged (upgrades map to the 3D equivalents) |

### Finding your way in 3D
- **Two-circle radar** (X-Wing / FreeSpace style; owner choice 7 October 2026, replacing the Elite-style disc first proposed here): two circles at the bottom centre between Thrust and Fire, FRONT on the left and REAR on the right. Each object is placed in the ship's own frame (so a roll rotates the dots): the distance from a circle's centre is the angle off the nose (front) or tail (rear), centre = dead ahead / dead behind, rim = 90° off-axis; the direction is the object's up/right direction, and the rear circle keeps right on the right so a dot on the right always means "turn right". Shape and colour per type from the palette (colour-safe aware): diamond green crystal, × red rock (later saucer UFO, ring boss, square power-up); nearer objects are bigger and brighter; range = the current view distance (fog end), and beyond it only the nearest 3 crystals are shown, dimmed, with a tick on the rim.
- **Edge arrows** for things outside the view (boss, UFOs, nearest green on Easy and in the tutorial, close threats) with distance. The prototype shows one for the nearest green crystal whenever no crystal within the view distance is on screen.
- **Crosshair plus lead marker** for moving targets, brackets around the target, hit flash; a marker showing which way you're drifting.
- **Warning for threats:** radar flash, edge arrow, short tone and a light vibration when a red rock or UFO closes in. The prototype flashes the radar dot of a red rock within 25 % of the view distance on a closing course (closest approach within 6 s and closer than the radii plus 30) and gives a short vibration (haptics setting, at most once a second).
- **Cockpit frame:** dropped after the Pixel 7 Pro test (owner, 7 October 2026: "remove the cockpit frame"); the radar circles and the crosshair give the fixed reference instead.
- **Motion feel:** "space dust" particles around the ship and speed streaks at high speed.

### Comfort
- Field of view 60–95° (default about 70°), a darkened vignette during fast artificial turns (drag or stick; physical phone movement needs it less), no camera shake and no roll in 3D (hits use a flash and vibration instead), respect the system "reduce motion" setting, keep the frame rate steady by lowering resolution first.
- **Motion control Off** setting so 3D can be played with drag-to-look only; sensitivity, invert up/down and a left-handed layout.

## 3. Architecture

- **Separate 3D package** in `js/3d/`, loaded with `await import('./3d/game3d.js')` only when you start 3D. Pure modules (testable without a browser): 3D maths, look/sensor mapping, world wrap and spawning, collisions and lead calculation, radar projection (`js/3d/radar3d.js` in the prototype: two-circle projection, range filter, threats, edge marker, layout), and the whole game simulation. Only `render3d.js` touches three.js, so the renderer could be swapped later. The 3D HUD is drawn on the existing 2D canvas layered over a new 3D canvas, so menus, toasts, the pause menu and dialogs keep working.
- **New game state `PLAYING_3D`** and mode `solo3d`, so none of the hundreds of 2D-only code paths can run by accident. Pause, back button, wake lock, music and input context learn about it through one helper. One existing check must change first (`isMultiplayer()` currently treats any mode other than `solo` as multiplayer).
- **Small extractions** from `main.js` first, each with the full 2D test suite: dynamic difficulty into its own module, and the level/difficulty tables into the rules module. No 2D behaviour changes.
- **Menu:** a "Start 3D" row next to "Start" when the device can run 3D; Settings gets a "3D" sub-page (default view, control model, sensitivity, field of view, invert, aim assist, vignette, auto-recentre); Help gets a 3D page.
- **Capability check:** offer 3D only if WebGL2 works and the device isn't using a slow software renderer. Never switch to 3D automatically. During the first seconds of a 3D game, measure the frame rate; lower the resolution if needed, and offer "Switch to 2D?" if it's still too slow. If 3D fails to load or the graphics context is lost, return to 2D with a message.
- **Test hook:** read-only `window.__spaceAdventure.game3d` snapshot (look angles, ship position, score, counts, frame rate) and a `?seed3d=N` option for repeatable screenshots, following the existing patterns.

## 4. Hosting, offline and installing

- **GitHub Pages:** the 3D files are a few hundred KB; Pages allows sites up to 1 GB.
- **Vendored, not from a CDN:** the service worker only serves same-origin files, and the installed app can't reach a CDN offline. Pin a specific three.js version (r185 still ships minified files; r186 dropped them, so a newer version would be minified once and committed).
- **Two ways to cache 3D for offline play:**
  - **Precache everything (simplest):** 2D users also download about 180 KB extra once and store about 0.8 MB. Lazy loading still keeps the 3D code from slowing down 2D start-up.
  - **Separate 3D cache filled when 3D is first used:** 2D users never download it, but the service worker gets more complex. The research found two traps to fix first: the update step deletes every older cache with the game's prefix (a 3D cache would need its own prefix), and the request handler only looks in the main cache.
- **Precache script:** `scripts/update-sw-version.mjs` currently lists only files directly in `js/`, so it needs to include `js/3d/` (or generate a second list for the 3D cache), with the version test updated.
- **Landscape:** 3D is best in landscape. On Android in full screen the game can lock landscape while a 3D game runs (unlocking on exit). iPhone can't lock orientation or go full screen in Safari, so it shows a "rotate to landscape" hint.

## 5. Testing without your Mac

- **Unit tests (Node):** quaternions and look mapping at all screen orientations, recentre, cone and edge turning, auto-recentre keeping the view continuous; world wrap and spawning; collisions without tunnelling at full bullet speed; lead calculation; radar projection; capability decisions; a seeded 60-second headless game (collect, split, lose lives, level up, boss, power-ups, combos).
- **Browser tests on GitHub:** a new `chromium-3d` project with WebGL through SwiftShader (needs `--use-angle=swiftshader --enable-unsafe-swiftshader`), fake `deviceorientation` events to check looking, recentre and edge turning, the permission granted and denied paths, menu and settings flows, a test that 2D never loads any 3D file, and screenshots of the cockpit for review.
- **Safari engine on GitHub:** too slow without a GPU for gameplay; test only that 3D is offered or hidden correctly, the permission and fallback paths, and that 2D is unaffected.
- **Real feel and frame rate:** only on your phones, by playing a hidden `?3d=1` build on GitHub Pages after the first phase.

## 6. Roadmap

| Phase | Content | Size | Done when |
|---|---|---|---|
| 0 Spike | three.js vendored, capability check, hidden `?3d=1` entry, star background, space dust, a few static crystals and rocks, Comfort look plus recentre plus touch-look, iPhone permission button, frame-rate overlay, `chromium-3d` CI project with fake motion and screenshots | L | You try it on your phones: the controls feel right; at least 50 fps on a mid-range Android and a recent iPhone |
| 1 Playable core | Extractions from `main.js`; pure 3D modules with tests; ship physics, wrap and fog, collect greens, shoot and split reds, lives, levels, combos, scoring, difficulty; crosshair and basic HUD; "Start 3D" row, 3D settings, pause/back/wake lock, lazy load and fallback, 3D high scores, test hook | XL | Full game loop playable; 2D test suite green and unchanged |
| 2 Content | UFOs, boss with weak points, power-ups, radar, edge arrows, lead marker, threat warning, explosions, upgrades and achievements | XL | Matches 2D single-player |
| 3 Platform | 3D tutorial, music moods, vibration and rumble, controller, desktop mouse and keyboard, Help page | L | Every input type tested |
| 4 Polish | Comfort options, colour-safe meshes, instancing and dynamic resolution, context-loss handling, offline caching, docs, a device check, then remove the `?3d=1` gate | L | Steady 60 fps, works offline |

S = under a day, M = 1–2 days, L = 2–3 days, XL = a week or more. Tuning values (density, sizes, cone size) are settled in phases 0 and 1, not up front.

## 7. Risks

1. **It's a second game:** the 3D simulation, balancing and feel are new work; the reuse is in scoring, progression, settings and audio.
2. **iPhone motion permission** in the installed app may need a tap on every launch.
3. **three.js changes often** (it removed its minified builds in r186): pin a version and update deliberately.
4. **Service worker complexity** if 3D gets its own cache; a bug there could break offline 2D. Keep 2D independent of every 3D file.
5. **Low-end Android heat and frame rate:** mitigated by capping resolution, the frame-rate check and the 2D fallback.
6. **CI:** SwiftShader needs an opt-in flag that a future Chrome could change; Safari-engine 3D coverage stays minimal.
7. **Motion sickness:** mitigated by the comfort settings, Motion control Off, and 2D as the default.

## 8. Owner decisions (7 October 2026)

1. **Three control types**, selectable in Settings:
   - **Direct:** moving the physical phone is the same as moving the ship: rotation on all axes, including roll (1:1, absolute, with Recentre).
   - **Rate:** tilting the phone away from its neutral position sets the ship's rotation *rate* on each axis (joystick-like, including roll).
   - **Joystick:** an on-screen joystick rotates the ship, as in common mobile games (also the fallback without motion sensors, and the desktop/controller equivalent).
   - A **Level horizon** toggle applies to all three: when on, roll is blocked (the horizon stays level).
2. **The ship's nose always points where you look**; roll is controlled by the Level horizon toggle.
3. **Wrap-around cube world.** 3D is **cached for offline play for everyone** (precached, no separate lazy cache).
4. **Separate 3D high-score board**; **credits, upgrades and achievements shared** with 2D.
5. **"Start 3D" becomes the default and the first main-menu entry** — once 3D is a complete game (end of the roadmap). Until then the prototype is reached through a hidden `?3d=1` link so the regular game isn't replaced by an unfinished one.
6. **Start with a prototype** (Phase 0) to test whether this works in general, before the full build.

Not decided explicitly, applying the recommendations: three.js pinned and vendored; fixed-step 3D simulation separate from the renderer; comfort aids (cockpit frame, field-of-view setting, vignette during artificial rotation).

The earlier recommendation of a "Comfort hybrid" default is replaced by the three control types above.

## 9. Original questions

Recommendations in bold.
1. **Default controls:** **Comfort hybrid**, with Full 360, Tilt steer and Touch as options? Auto-recentre on by default (**yes**)?
2. **Ship = camera** (nose points where you look), or a separate free look?
3. **No roll** (stable horizon), or full flight with loops and rolls?
4. **World:** **wrap-around cube**, or a sphere with a soft wall?
5. **Engine:** **three.js** (about 180 KB compressed, fastest to build) or a custom renderer (smaller, more work)?
6. **Offline:** **precache 3D for everyone** (simplest, about 180 KB extra for 2D players) or a separate cache filled on first use?
7. **Scores:** a **separate 3D high-score board**, with **credits, upgrades and achievements shared** between 2D and 3D?
8. **Menu:** a **"Start 3D" row** next to Start, or one "Start ◂ 2D / 3D ▸" row?
9. **Borderline devices:** show 3D marked "beta", or hide it?
10. **Aim assist** default **Low**; keep **hyperspace** in 3D (**yes**)?
11. Should I start with **Phase 0** (a hidden `?3d=1` build for you to try on your phones before the big build)?

## 10. Phase 0 prototype (built 7 October 2026)

Open the game with `?3d=1` (also on GitHub Pages). Without the parameter nothing changes: `js/main.js` only checks the parameter and then loads `js/3d/proto3d.js` with a dynamic import.

- **What it is:** a feel test, not the game. Cockpit view (ship = camera), wrap-around cube (side 1600, fog 260–720 hides the seam, every object drawn at its nearest copy), fixed star background with a distant planet, space dust, 12 green crystals and 18 red spiky rocks (large and medium) that drift, simple projectile bullets, splitting, lives with a red flash and vibration, a cockpit frame (removed 7 October, §10.1), crosshair and HUD (score, lives, speed, control type, frames per second, render scale). The field refills far away so it never runs empty. No UFOs, boss, power-ups, sound, high scores or credits yet.
- **Controls (§8.1):** Direct (phone pose relative to the neutral pose, all axes, 1:1), Rate (tilt sets pitch/yaw/roll rates; 4° dead zone, full rate at 35°, curve exponent 1.6, about 100°/s and 140°/s roll at sensitivity 5) and Joystick (floating stick on the left 45 % of the screen; two ⟲ ⟳ roll buttons above Fire; Thrust moves next to Fire so the left thumb stays on the stick). Level horizon works in all three (no roll, pitch ±85°). The pose held when tapping Start is "straight ahead"; Recentre and double-tap reset it; a screen rotation recentres automatically. Desktop: pointer-lock mouse plus keys; controller: sticks, RT, A/RB.
- **Sensors:** `deviceorientation` (relative, never the compass event) converted to a quaternion with screen-angle compensation (unit-tested against the three.js DeviceOrientationControls formula at 0, 90, -90 and 180). On Android Chrome `RelativeOrientationSensor` (screen frame) is used while it delivers readings (setting `spaceAdventure_sensor3d`: `auto` or `event`). iPhone permission is requested inside the Start (or control type) button click; denied or no sensor falls back to Joystick with a message.
- **Performance:** drawing-buffer pixel ratio capped at 1.5 (1.0 on phones with a pixel ratio above 2, such as the Pixel 7 Pro), render scale lowered in 0.1 steps (down to 0.5) while below 45 fps and raised again after 3 s at 57+ fps, fixed 1/60 s simulation steps separate from rendering, screen wake lock while playing.
- **Files:** `js/3d/` math3d, look (all control models, pure), sensors, world3d, collide3d (swept bullets), sim3d (pure, seeded), render3d (the only three.js importer), hud3d, proto3d (entry, DOM, input, test hook `window.__spaceAdventure.game3d`, `?seed3d=N`, `&layout3d=range` for tests); three.js r185 (0.185.0) minified build in `js/3d/vendor/`. Settings keys `spaceAdventure_control3d`, `_levelHorizon3d`, `_sensitivity3d`, `_sensor3d`.
- **Offline:** every `.js` under `js/3d/` is in the single precache (owner decision §8.3), about 0.8 MB more stored for every player.
- **Tests:** unit tests for the maths, look models, world, collisions, simulation and the entry on a fake DOM; Playwright projects `chromium-3d` (landscape phone, touch) and `chromium-3d-desktop` with SwiftShader, which save `tests/screenshots/3d-*.png` (in the CI `screenshots` artifact); `no3d.spec.js` checks that 2D never requests a 3D file.
- **To try on the phones:** frame rate (bottom line), whether Direct, Rate or Joystick feels best, whether Level horizon should be the default, the sensitivity, rock density and speed, and whether the iPhone asks for motion access again on every launch of the installed app.

### 10.1 Owner feedback on the Pixel 7 Pro and changes (7 and 8 October 2026)

Feedback: "works well; keep all 3 control options; Level horizon doesn't really help; objects disappear a little too quickly, we need to see farther; Pixel shows at lowest 60 fps; remove the cockpit frame."

- **Controls:** Direct, Rate and Joystick all stay. Level horizon stays as a toggle, default off (unchanged).
- **View distance:** new choice on the prototype screen, setting `spaceAdventure_viewDistance3d` (`normal`, `far`, `veryfar`; default `far`), shown in the HUD footer next to the frame rate. Changing it regenerates the field (a different world size; a paused game becomes a fresh start). The numbers (`js/3d/world3d.js` `VIEW_DISTANCES`, `worldFor()`):

  | View distance | Visible range | Fog near–far | Cube side | Fog far / side | Crystals + red rocks | Refill minimum | Bullet life |
  |---|---|---|---|---|---|---|---|
  | (before) | 1× | 260–720 | 1600 | 0.45 | 12 + 18 = 30 | 6 + 8 | 0.85 s |
  | Normal | 1.5× | 390–1080 | 2400 | 0.45 | 41 + 61 = 102 | 20 + 27 | 1.27 s |
  | Far (default) | 2× | 520–1440 | 3200 | 0.45 | 96 + 144 = 240 | 48 + 64 | 1.67 s |
  | Very far | 2.6× | 675–1870 | 4200 | 0.445 | 217 + 326 = 543 | 109 + 145 | 2.14 s |

  Counts scale with the world volume, so the density per visible volume stays within 4 % of before (the unit tests allow 15 %); the initial field is capped at 600 objects. Objects are culled at fog far + 90 (below half the cube side, so a drawn object never jumps to another wrapped copy); refills appear beyond that distance, out of sight. Bullets reach just past the fog end.
- **Rendering changes for the larger world:** fog is now radial (distance from the camera rather than view depth, a one-line patch of three.js's `fog_vertex` chunk), so objects at the screen edges fade at the same distance as objects straight ahead and never pop at the seam. Rocks, crystals, crystal glows and bullets are drawn with `InstancedMesh` (about a dozen draw calls in total, whatever the rock count). The star sky and planet no longer write depth, are drawn first and are scaled inside the camera's far plane (cull distance + 200), so they always stay behind the field. The space dust box (200) divides every cube side.
- **Cockpit frame removed:** no canopy struts or dashboard strip. The crosshair, score/lives/speed and footer text get a soft dark shadow and the buttons a text shadow so they stay readable over rocks and stars.
- **Performance:** the Pixel 7 Pro reported at least 60 fps before this change. Very far draws up to about 4.5 times as many rocks as Far; if it drops below 45 fps the adaptive render scale reacts as before. To check on the phones: the frame rate at Far and Very far, and whether Far is the right default.
- **Tests:** unit tests for the presets (fog far ≤ 0.45 × side, cull before the seam, density within 15 %, counts capped, refills out of sight, bullet range) and the view-distance choice on the fake DOM; Playwright (CI): the choice persists across a reload and changes the world size, a red rock 1000 ahead (`&layout3d=far`, beyond the old fog end of 720) is visible at Far and fogged out at Normal, read through the hook `window.__spaceAdventure.rocks3d()` (distance, drawn, fog factor) rather than pixels; screenshot `3d-*-far.png`.

### 10.2 Two-circle radar (8 October 2026)

- **Owner request:** an X-Wing / FreeSpace style two-circle radar (§2 "Finding your way in 3D").
- **Built:** `js/3d/radar3d.js` (pure: `radarPoint`, `buildRadar`, `isThreat`, `edgeMarker`, `radarLayout`, `verticalFov`), drawn by `hud3d.js` `drawRadar` and `drawEdgeMarker`. Circles of radius 11 % of the shorter screen side (30–70 px), centred between Thrust and Fire just above the footer line; on narrow (portrait) screens they move up above the buttons and roll buttons. Up to 150 nearest objects within the view distance, plus the nearest 3 crystals beyond it. The palette's radar colours (`collectRadar`, `hazardRadar`) follow the Colour-safe setting. Threatening rocks flash at 3 Hz with a ring and give one short vibration (25 ms) when a new threat appears.
- **Edge marker:** an arrow at the screen edge towards the nearest crystal (the shortest turn) with its distance, shown only while no crystal within the view distance is on screen.
- **Test hook:** `game3d.radar = { front: [...], rear: [...], edge, layout }`, each blip `{ id, type, x, y, dist, near, threat, beyond }`.
- **Tests:** unit (dead ahead at the front centre, 90° right at the front rim on the right, directly behind at the rear centre, behind-right on the right of the rear circle, roll rotates the dots, the wrap seam, range filter and nearest 3 beyond it, blip cap, threats, edge marker, layout clear of buttons and footer at four screen sizes, the hook on the fake DOM); Playwright (CI): with `layout3d=range` the rock is at the front centre and the crystal at the rear centre, a 90° turn moves the rock to the rim; screenshot `3d-*-radar.png`.
- **To try on the phones:** whether the circles are large enough, whether the rear mirroring reads naturally, and whether the threat flash and vibration help or distract.

## Sources

- three.js r186 (minified builds removed): https://github.com/mrdoob/three.js/releases/tag/r186 · https://github.com/mrdoob/three.js/pull/33893
- File sizes (measured 2026-10-06): https://data.jsdelivr.com/v1/packages/npm/three@0.185.0?structure=flat · https://cdn.jsdelivr.net/npm/three@0.186.1/build/
- three.js in 2026: https://www.utsubo.com/blog/threejs-2026-what-changed · DeviceOrientationControls removed: https://github.com/mrdoob/three.js/pull/22654
- Babylon.js: https://doc.babylonjs.com/setup/frameworkPackages/nativeBrowserESM · https://babylonjs.medium.com/size-matters-e0e94dad01a7
- WebGPU: https://en.wikipedia.org/wiki/WebGPU · https://www.webgpu.com/news/webgpu-hits-critical-mass-all-major-browsers/ · https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/
- Import maps: https://caniuse.com/import-maps
- Device orientation: https://www.w3.org/TR/orientation-event/ · https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/requestPermission_static · https://developer.mozilla.org/en-US/docs/Web/API/Window/deviceorientation_event · https://developer.chrome.com/blog/device-orientation-changes
- iOS permission lifetime: https://github.com/w3c/deviceorientation/issues/74 · https://github.com/w3c/deviceorientation/issues/57 · https://bugs.webkit.org/show_bug.cgi?id=221399
- Generic Sensor API: https://developer.chrome.com/docs/capabilities/web-apis/generic-sensor · https://developer.mozilla.org/en-US/docs/Web/API/RelativeOrientationSensor
- WebXR: https://immersive-web.github.io/webxr/explainer.html · https://www.testmuai.com/learning-hub/webxr-compatible-browsers/
- Screen orientation lock: https://caniuse.com/mdn-api_screenorientation_lock · https://github.com/mdn/browser-compat-data/issues/19355
- Wake Lock: https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
- GitHub Pages limits: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- SwiftShader: https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md · https://groups.google.com/a/chromium.org/g/blink-dev/c/yhFguWS_3pM
- detect-gpu: https://github.com/pmndrs/detect-gpu
- Comfort: https://developers.google.com/vr/elements/tunneling · https://arxiv.org/pdf/2107.08432 · https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8323020/
- 1€ filter: https://gery.casiez.net/1euro/
