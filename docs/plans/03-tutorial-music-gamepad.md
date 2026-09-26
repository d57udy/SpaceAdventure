# Items 5, 7 and 8: First-game tutorial, background music, game controller support

Line numbers refer to `js/main.js` unless another file is named. The "Options screen" from the original plan is the **Settings screen** in [README §A](README.md#a-one-settings-screen-instead-of-more-main-menu-rows); `menuLeft`/`menuRight` and `lastInputSource` are in [§B](README.md#b-shared-input-additions).

**Build order within these three:** 7 Music → 8 Gamepad → 5 Tutorial. Gamepad provides `lastInputSource`, which the tutorial uses to word its hints for the player's input device.

---

## Item 5: First-game tutorial

### Goal and user impact
New players, especially children on an iPad, don't know the unusual rule: fly **into** green asteroids and **shoot** red ones. The two menu lines explaining it are easy to miss. A 45–90 second guided training wave teaches steering, thrust, collecting, shooting and danger. Each step advances only when the player actually does it, the wording matches the input device, it appears once per player, and it can be skipped and replayed.

### UX
- **Trigger (decided: ask first):** on a player's first Start (with "Offer tutorial" on in Settings), a small canvas dialog asks **"First time? Play the tutorial / Skip"**, selectable by tap, keyboard (Enter/Esc) or controller (Ⓐ/Ⓑ). "Play" begins a **Training** wave instead of Level 1 (the HUD shows "Level: Training"); "Skip" marks the tutorial as offered and starts Level 1. Either way the player isn't asked again (Replay remains available).
- **Format:** a banner at the top of the canvas with a title, one instruction line and progress dots, plus a "Skip ▸" button. The on-screen control being taught pulses (a CSS class on the DOM control, since touch buttons sit outside the canvas on iPad). An edge arrow points at an off-screen target.
- **Steps:**

| # | Advances when | Keyboard | Touch: Drag to Steer | Touch: Buttons | Controller |
|---|---|---|---|---|---|
| 1 Steer | ship has turned ≥ 90° in total | "Turn with ← → (or A / D)" | "Drag anywhere on the left half to steer" (stick pulses) | "Use the arrow buttons to turn" (they pulse) | "Tilt the left stick to steer" |
| 2 Thrust | thrusting ≥ 0.6 s in total | "Hold ↑ (or W) to fly" | "Drag further out to fly: past the dashed ring = thrust" | "Hold ▲ to fly" | "Push the stick all the way to fly" |
| 3 Collect | 2 green asteroids collected | "Fly INTO the GREEN asteroid to collect it" (all devices) | | | |
| 4 Shoot | 1 red asteroid destroyed | "Press SPACE to shoot the RED one" | "Tap the red button to shoot RED" (it pulses) | same | "Press Ⓐ or RT to shoot RED" |
| 5 Avoid | 5 s, or fire/select | "Never touch RED or UFO shots. Emergency: H = hyperspace (risky)" | "…✱ button = hyperspace" | same | "…Ⓑ = hyperspace" |
| 6 Done | shown 2 s | "Training complete! Level 1…" | | | |

- **Placement:** targets appear only when their step starts, in front of the ship: a stationary medium green about 180 px ahead; a small red about 260 px ahead drifting slowly sideways. Easy for beginners and repeatable for automated tests.
- **Gentle mistakes:** shooting a green shows "Don't shoot green, fly into it!" and spawns a new one; crashing into red respawns at once with 3 s of invulnerability and no life lost; a target drifting more than 600 px away respawns ahead; after 20 s without progress the Skip button becomes more prominent and the hint repeats.
- **Skip:** the Skip button, Enter, controller View/Select, or a "Skip Tutorial" item at the end of the pause menu during training. Skipping marks it done.
- **Replay:** "Replay tutorial" on the Settings screen and on the Help screen (or the T key / controller Y). Replay continues into Level 1.
- **No side effects:** no UFOs, random power-ups, level-up, achievements or difficulty adjustment during training; no credits earned; everything is reset when Level 1 starts.

### Technical approach
- **New `js/tutorial.js`** (no DOM): `TUTORIAL_VERSION`, `STEPS`, `class Tutorial { start(); notify(event, data); update(dt, { inputKind }); skip(); stepId; progress; finished }` with events `rotated`, `thrusted`, `collectedGreen`, `destroyedRed`, `shotGreen`, `died`, `confirm`; `tutorialText(stepId, inputKind)` returning title, body and the selectors to highlight; `detectInputKind({ lastInputSource, isTouchDevice, controlMode })`.
- **`js/persistence.js`:** `loadTutorialState(user)` / `saveTutorialState(user, { done, version, skipped })`, per-user key, removed by "Reset Data" so the tutorial comes back.
- **`js/main.js`:**
  - `startGame({ tutorial })`: training sets level 0 and starts with no asteroids. Menu Start decides via `shouldRunTutorial()`; pause-menu Restart keeps the current mode.
  - PLAYING input feeds rotation and thrust to the tutorial; Enter skips.
  - `updateGame` skips UFO spawning, random power-ups, the level-up check, achievements and difficulty evaluation during training, and spawns tutorial targets on request.
  - Collisions notify the tutorial; no credits in training.
  - `handlePlayerDeath` during training: no life lost, immediate respawn with invulnerability.
  - `finishTutorial({ skipped })`: persist, reset score, level 1, difficulty, session stats and combo, create Level 1 asteroids, reset timers. The game state stays PLAYING.
  - Drawing: `drawTutorialOverlay()` after floating texts; `syncTutorialDom()` sets `body.tutorial-step-<id>` and `body.tutorial-<inputKind>` for the CSS pulse (which never blocks touches).
  - Pause menu options become dynamic to add "Skip Tutorial"; Help screen adds the Replay button (registered after the full-screen tap region, because taps are checked last-to-first).
- Optional achievement "Flight School" (complete the tutorial without skipping); needs a small `unlock(id)` path in `achievementManager.js`.

### Tasks
1. `tutorial.js` logic and texts + unit tests.
2. Persistence methods and reset + unit tests.
3. `startGame` options, training spawns, guards in update, death and collisions.
4. Overlay, DOM highlight classes, CSS pulse.
5. Skip and Replay paths.
6. Hook `tutorial { active, step, inputKind, done }`.
7. Test helper option and tutorial specs.
8. README and Help screen line.

### Tests
- **Unit:** each step advances only on its own event; rotation totals use absolute changes (wiggling counts); thrust accumulates; skip finishes immediately; every step × input kind has non-empty text and the right highlight; `detectInputKind` covers all combinations; persistence round-trip, corrupt data, reset removes it.
- **Existing tests:** every spec logs in as a new user and presses Start, so with the tutorial on they would all start in training. The test helper `openFresh` gets a `tutorial = false` option that seeds the real user setting "Tutorial hints: off" before load. Tests still never write game state.
- **New `tutorial.spec.js`** (keyboard and touch projects): full keyboard run-through ending at level 1 with score 0; skip with Enter and no tutorial after reload; Reset Data brings it back; Help → T starts it; touch: the stick pulses in step 1 and a drag advances; buttons mode pulses the arrow buttons; deaths don't cost lives and no UFOs appear during training; screenshots for visual review.
- **UAT:** a first-time child player on a real iPad in both control modes: readable at arm's length, visible pulse, reachable Skip button not clashing with pause, banner not covering the ship.

### Risks
- Breaking existing tests: handled by the helper option, changed in the same commit.
- Player stuck: fallbacks per step, respawning targets, timer on the info step.
- Banner covering gameplay: semi-transparent, top 15%, moves to the bottom when the ship is in the top third.
- State leaking into the real game: one `finishTutorial()` path, also used by Restart and Main Menu; a test checks Level 1 afterwards matches a normal start.

**GitHub Pages:** one new module and CSS, no assets. **Effort:** M–L (1.5–2 days).

**Open questions:** score or credits for tutorial collects (proposed: none); add the Flight School achievement; Replay continues into Level 1 or returns to the menu (proposed: continue); teach hyperspace or only mention it (proposed: mention).

---

## Item 7: Background music

### Goal and user impact
Atmosphere, and a clear sense of tension: calm music in menus and normal play, building up in boss fights and on the last life. Music has its own volume, separate from sound effects.

### Recommendation: music generated in code with Web Audio

| | Audio files (CC0) | Generated in code (recommended) |
|---|---|---|
| Download | 2 loops of 60–90 s ≈ 2–3 MB (all current sound effects total 124 KB) | About 8–12 KB of JavaScript |
| Memory on iPad | Decoded audio ≈ 35 MB per 90 s track | Negligible |
| Seamless looping | MP3 encoder padding makes loops gap differently in Chrome and Safari | No gaps: notes are scheduled on the audio clock |
| Safari formats | MP3/AAC; Ogg only from Safari/iOS 18.4 | Not applicable |
| Dynamic mood | Only crossfades between whole tracks | Instruments fade in and out per mood; chord changes land on bar lines |
| Licensing | CC0 is fine | None needed |
| Risk | Quality depends on the track found | Can sound repetitive or "chiptune" |

Optional phase 2: short CC0 jingles (for example Kenney Music Jingles, a few KB each) for level-up, boss intro and game over. The music engine's interface (`setMood`, `update`, `stop`) allows swapping in file-based music later without touching `main.js`.

### UX
- **Moods:** `menu` (slow pad only); `calm` (pad, bass, soft hi-hats; normal play and training); `danger` (calm plus a heartbeat-like pulse and tighter filter, on the last life); `boss` (kick, snare, 16th-note arpeggio, tense chords, including the boss warning); `paused` (current mood 8 dB quieter, filter closed); `gameover` (short falling phrase, then menu).
- **Transitions:** layer volumes glide over 1.5–2 s; chord changes wait for the next bar; tempo fixed at 96 BPM, with the boss mood using double-time drums so the rhythm never jumps.
- **Settings (decided: player picks a tune):** "Music tune" cycles through **Off** plus several built-in tunes, each a different song definition for the same engine, for example:
  - **Synthwave** (96 BPM, detuned saw pads, arpeggios, gated drums),
  - **Ambient** (70 BPM, slow evolving pads, sparse bells, no drums in calm mood),
  - **Chiptune** (132 BPM, square and triangle leads, noise percussion).
  Each tune defines its own progressions, instruments and per-mood layer table, so every tune still gets calmer and more intense with the game. Selecting a tune in Settings plays a short preview. Stored as `spaceAdventure_musicTune` (default: Synthwave, or Off if the player chose it). Plus Music volume 0–10 (default 5) and Sound effects 0–10 (default 10). Tune "Off" or volume 0 stops the sequencer entirely. The existing mute button still silences everything (and should be remembered between visits).

### Technical approach
- **`js/audio.js` routing:** sound effects → `sfxGain` → `masterGain`; music → `musicGain` → `masterGain`. `setSfxVolume`/`setMusicVolume` with a perceptual curve (v²). Mute keeps using `masterGain`.
- **Tunes as data:** `js/tunes.js` exports `TUNES = { synthwave: {...}, ambient: {...}, chiptune: {...} }`, each with `name`, `bpm`, `progressions` per mood, `voices` (oscillator types, filter ranges, envelopes) and a `layers` table per mood. The engine is tune-agnostic; adding a tune is adding data. Unit tests check every tune defines every mood and that all notes are in range.
- **New `js/music.js`:** pure `selectMood({ state, bossActive, lives, tutorialActive })`; `PROGRESSIONS` (calm Am–F–C–G, boss Am–F–Dm–E, danger Am–Am–F–E); pure `stepEvents(mood, bar, step, rng)` so patterns are testable; `class MusicEngine` with a **lookahead scheduler** (called each frame, schedules notes up to 0.25 s ahead on the audio clock), resynchronised after a pause or iOS interruption so there's no burst of catch-up notes, running only while the audio context is running.
- **Voices:** all short-lived nodes, nothing long-running to leak. Pad: two detuned sawtooth oscillators through a lowpass filter. Bass: triangle, 8th notes. Arpeggio: quiet square wave through a filter and a shared echo. Kick: sine sweep 150 → 40 Hz. Hi-hat and snare: filtered noise from one pre-generated 1 s buffer. One gain per layer; moods set target gains from a table. Variation: 3 arpeggio patterns rotated every 4 bars, A/B sections every 8 bars. At most about 30 nodes per second in boss mode.
- **`main.js`:** start music after the audio manager; update the mood every frame in every state (before `updateGame`'s early return, or in `gameLoop`); game over triggers the falling phrase; Settings writes volumes via `settings.js`.
- **iOS:** music starts when audio is unlocked (existing handling). Optionally set `navigator.audioSession.type = 'ambient'` where supported, so the game respects the ring/silent switch and mixes with the player's own music (verify on iPadOS).

### Tasks
1. Split sound effects and music buses in `audio.js`; confirm all sound effects still play.
2. `music.js` pure parts, then the engine.
3. Hook into the game loop with the mood snapshot.
4. Settings rows for Music and Sound effects; persistence.
5. Tune by ear on desktop Chrome, a real iPad and Mac Safari (about half a day).
6. Optional CC0 jingles with a README credit.

### Tests
- **Unit `music.test.mjs`** (fake AudioContext recording node creation, start/stop times and gain ramps): mood matrix; scheduling only inside the lookahead window and never in the past; jumping the clock 10 s ahead resynchronises instead of scheduling hundreds of notes; mood changes ramp the right layers; volume 0 stops scheduling; nothing happens unless the context is running. Settings clamping and defaults.
- **Integration:** hook `musicMood` is `menu` in the menu, `calm` after Start, `paused` when paused; Settings changes the music volume by keyboard and by tap, and it survives reload; no page errors on WebKit. Boss and last-life moods are covered by unit tests (too slow to reach through real play).
- **UAT:** no clicks at mood changes; 10 minutes of play without CPU spikes on iPad; returning from the background doesn't burst notes; a phone call pauses and music resumes; mute silences everything; Music 0 with sound effects on works.

### Risks
- Sounds cheap or repetitive: time-boxed sound design, variation scheme, low default volume, swappable engine.
- Clicks and pops: always ramp gains.
- Frame hitches: 0.25 s lookahead covers the 50 ms frame cap.
- Older Safari: only basic audio nodes, no AudioWorklet.

**GitHub Pages:** no assets for the generated approach. If audio files are added later, keep them under about 300 KB as MP3/AAC and commit them normally (Git LFS files are not served by Pages). **Effort:** M (1.5 days plus about half a day of sound tuning).

**Open questions:** which tunes to include first (proposed: the three above) and the default; remember mute; should `danger` also apply during a boss fight with the shield down; add CC0 jingles in phase 2.

---

## Item 8: Game controller support

### Platform facts
- `navigator.getGamepads()` may contain `null` entries. A controller only appears **after the player presses a button while the page is visible** (anti-fingerprinting). Chrome requires HTTPS or localhost.
- **Standard mapping** (by position, not label): buttons 0–3 = bottom (A/✕), right (B/○), left (X/□), top (Y/△); 4/5 = LB/RB; 6/7 = LT/RT (analog); 8 = View/Select; 9 = Menu/Start; 12–15 = D-pad up/down/left/right; 16 = Home (don't rely on it). Axes 0/1 = left stick, +Y is down like the canvas.
- **Rumble:** `gamepad.vibrationActuator.playEffect('dual-rumble', …)` in Chrome 89+ and Safari 16.4+ (null when the controller can't rumble); not in Firefox. Always feature-detect.
- iPadOS Safari supports MFi, Xbox and PlayStation controllers. Verify per controller on hardware whether `mapping === 'standard'`.
- **Controller presses don't unlock audio** (not a user gesture in the HTML spec), so a controller-only player needs one tap or key press for sound.

### UX
| Control | In game | Menus (and pause) |
|---|---|---|
| Left stick | Drag-to-steer: angle and strength, same as the touch stick | Up/down/left/right with repeat |
| D-pad | Classic: ← → rotate, ↑ thrust, ↓ hyperspace | Same as the stick |
| A | Fire (hold) | Select |
| RT | Fire (hold, value > 0.35) | – |
| LT | Thrust (hold), so aiming and thrust can be separate | – |
| B | Hyperspace | Back (resumes when paused) |
| Y | – | Help: replay tutorial |
| Start | Pause | Resume from pause; on the menu, Select |
| View/Select | Skip tutorial | Mute |

- **Menu repeat:** first move immediately, then after 400 ms, then every 140 ms.
- **Deadzones:** radial 0.15 on the raw stick, rescaled to 0–1, then the existing steering thresholds apply unchanged. Menu navigation needs more than 0.6, re-armed below 0.4. Triggers count above 0.35.
- **Connect/disconnect:** a 2 s toast ("Xbox Wireless Controller connected"). Disconnecting while playing with the controller pauses the game.
- **Button hints:** when the last input came from a controller, hints switch to glyphs: menu footer "Ⓐ Select Ⓑ Back", pause and game-over footers, a controller branch on the Help screen, Upgrades and Settings footers. Glyphs are drawn on the canvas; the controller family comes from `gamepad.id` (Xbox, PlayStation shapes, Nintendo with swapped letters, generic dots otherwise).
- **Touch controls** hide while the controller is the active input (`body.input-gamepad`) and return on the first touch.
- **Rumble** (Settings, default on): death strong 0.8 for 350 ms; red destroyed weak 0.25 for 60 ms; boss hit weak 0.4 for 80 ms; boss defeated strong 0.6 for 500 ms; green collect weak 0.15 for 40 ms.
- **Name entry:** a controller can't type. Show "Use keyboard or touch to enter a name"; optionally Ⓐ accepts the default "PLAYER1".

### Technical approach
- **New `js/gamepad.js`** (no DOM; `getGamepads` and clock injected): button constants; `radialDeadzone(x, y)`; `controllerFamily(id)`; context mappings for game and menu; `class GamepadPoller` with `poll(context)` returning held and newly pressed actions, the stick, connect/disconnect events and whether there was any input; `suppressHeld()`; `rumble(strong, weak, ms)`. Uses the most recently active controller; detects disconnects by polling as well as events; best-effort fallback plus a toast for non-standard layouts.
- **`js/input.js`:** a `GamepadPoller`, an input context, `lastInputSource` set by keyboard, pointer and controller input, `setContext()`, `pollGamepads()` merging pressed actions into the one-shot queue and held actions into `isPressed()`. `getJoystick()` returns the touch stick if active, otherwise the controller stick during play, so the existing steering call in `main.js` works unchanged. `releaseAll()`/`clearPending()` suppress held buttons until released (pressing Ⓐ on Start must not also fire). `menuLeft`/`menuRight` actions.
- **`js/main.js`:** set the input context on state changes; poll controllers each frame before taps; toast and pause on disconnect; a `rumble(kind)` helper at the same event sites as haptics; hint helpers for glyphs; `body.input-gamepad`; hook `gamepad { connected, id, family, mapping }` and `lastInputSource`.

### Tasks
1. `gamepad.js` helpers and poller + unit tests.
2. `InputHandler` integration + unit tests.
3. `main.js` wiring: context, polling, disconnect pause, toasts.
4. Glyph hints on all screens; Help screen controller branch.
5. Rumble helper and Settings toggle.
6. CSS to hide touch controls.
7. Playwright controller stub helper and `gamepad.spec.js`.
8. Real controllers on iPad Safari, Mac Safari and Chrome; README controls table.

### Tests
- **Unit `gamepad.test.mjs`:** deadzone (0.1 inactive; (0.7, 0) → angle 0, magnitude about 0.65; diagonal clamped); a button held for 3 polls counts as pressed only once; menu repeat timing with a fake clock; context mapping (A = fire in game, select in menu; B = hyperspace or back); suppressed buttons block until released; disconnect detected when a controller disappears; `null` entries tolerated; family detection by id; rumble no-op without an actuator.
- **Unit `input.test.mjs`:** controller stick used when the touch stick isn't active, touch wins when both are; `isPressed('fire')` while A is held in game; `lastInputSource` switches correctly.
- **Integration `gamepad.spec.js`** (stubbed `navigator.getGamepads` with a fake standard controller that records rumble calls): D-pad and stick menu navigation with repeat; Ⓐ on Start starts the game without firing a bullet; holding A or RT fires; stick right turns the ship toward 0 and full stick thrusts; B hyperspaces; Start pauses and B resumes; disconnecting while playing pauses with the toast; Ⓐ on game over returns to the menu; rumble recorded on death; hints show glyphs after controller input; on the iPad project, touch controls hide after controller input and return after a tap.
- **UAT:** Xbox Series and DualSense controllers on iPadOS Safari and macOS Safari/Chrome: mapping, rumble, reconnect, Home button behaviour, a full session without touching the screen (except name entry and the first sound unlock).

### Risks
- Controller-only players can't unlock audio: menu hint "Tap or press a key to enable sound" while audio isn't running.
- Controller invisible until a button is pressed: expected; mention it on the Help screen.
- Stick drift: radial deadzone plus the steering deadzone.
- Held buttons carrying over state changes: suppression on every transition, tested.
- Non-standard layouts: best-effort fallback and a toast.

**GitHub Pages:** HTTPS satisfies Chrome's secure-context rule; no headers needed. **Effort:** M–L (about 2 days plus hardware checks).

**Open questions:** name entry for controller-only players (default name, or an on-screen letter picker); LT as thrust or LB/RB as rotate; two controllers (that is part of multiplayer); rumble on green collect.

## Sources
- [MDN: Gamepad](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad), [MDN: Controls using the Gamepad API](https://developer.mozilla.org/en-US/docs/Games/Techniques/Controls_Gamepad_API), [MDN: vibrationActuator](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad/vibrationActuator), [MDN: GamepadHapticActuator](https://developer.mozilla.org/en-US/docs/Web/API/GamepadHapticActuator)
- [WebKit Features in Safari 16.4](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/), [WebKit commit: dual-rumble](https://github.com/WebKit/WebKit/commit/4eaf82bc0732bda0d63b7886f7e3647df6405d01)
- [Jake Archibald: Sounds fun (gapless looping)](https://jakearchibald.com/2016/sounds-fun/), [Ogg Vorbis browser support](https://www.testmuai.com/learning-hub/ogg-vorbis-browser-support/), [web.dev: A tale of two clocks](https://web.dev/articles/audio-scheduling)
- CC0 music: [Kenney Music Jingles](https://kenney.nl/assets/music-jingles), [OpenGameArt CC0 music](https://opengameart.org/content/cc0-music-0), [OpenGameArt: all CC0 by Kenney](https://opengameart.org/content/all-cc0-uploader-kenney)
