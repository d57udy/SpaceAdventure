# Space Adventure: Improvement Plan (September 2026)

This folder holds the implementation plan for the next round of improvements and the multiplayer investigation. Each item was planned from the current code (`main` at `383a7a9` plus the uncommitted freeze fix).

| # | Item | Plan | Size |
|---|------|------|------|
| 1 | Colour-blind friendly asteroids | [01-hidpi-and-colour-blind.md](01-hidpi-and-colour-blind.md#item-1-colour-blind-friendly-asteroids) | M |
| 2 | Sharp rendering on tablets (HiDPI) | [01-hidpi-and-colour-blind.md](01-hidpi-and-colour-blind.md#item-2-sharp-rendering-on-hidpi-tablets) | M |
| 3 | Installable, full-screen, offline app | [02-pwa-and-haptics.md](02-pwa-and-haptics.md#item-3-installable-full-screen-offline-app) | L |
| 4 | Haptic feedback (Android) | [02-pwa-and-haptics.md](02-pwa-and-haptics.md#item-4-haptic-feedback) | S–M |
| 5 | First-game tutorial | [03-tutorial-music-gamepad.md](03-tutorial-music-gamepad.md#item-5-first-game-tutorial) | M–L |
| 7 | Background music | [03-tutorial-music-gamepad.md](03-tutorial-music-gamepad.md#item-7-background-music) | M |
| 8 | Game controller support | [03-tutorial-music-gamepad.md](03-tutorial-music-gamepad.md#item-8-game-controller-support) | M–L |
| – | Multiplayer investigation (all options) | [04-multiplayer.md](04-multiplayer.md) | – |
| – | **Local multiplayer plan** (decided scope) | [05-local-multiplayer.md](05-local-multiplayer.md) | about 3–4 weeks, in 8 phases |
| – | **3D cockpit mode** (investigation October 2026; Phase 0 prototype built, `?3d=1`) | [06-3d-mode.md](06-3d-mode.md) | about 4–6 weeks, in 5 phases |
| – | **3D game: full implementation plan** (8 October 2026; replaces plan 06 §6 roadmap) | [07-3d-game.md](07-3d-game.md) | about 5–7 weeks, in 6 phases |

Sizes: S = under a day, M = 1–2 days, L = 2–3 days, XL = a week or more. Each includes unit, integration and acceptance tests.

## Cross-cutting decisions

These resolve overlaps between the individual plans. Where an item plan says something different, this section wins.

### A. One "Settings" screen instead of more main-menu rows

The main menu already has 11 rows. Items 1, 4, 7, 8 and 5 each want a setting, and the plans proposed adding rows to the main menu. At 12 rows the tap targets on a 1024x768 tablet drop below the 30 px our layout test requires.

Decision: replace the "Controls" row with a **Settings** row that opens a new `GameState.SETTINGS` screen, built like the Upgrades screen (up/down/select/escape, one tap region per row, left/right or tapping the left/right half of a row to change values). It holds:

| Setting | Values | Shown when | From item |
|---|---|---|---|
| Controls | Drag to Steer / Buttons | touch device | existing |
| Colours | Standard / Colour-safe | always | 1 |
| Graphics | Sharp / Fast (optional) | only if performance testing shows a need | 2 |
| Vibration | On / Off | `navigator.vibrate` exists and touch device | 4 |
| Music tune | Off / tune list (e.g. Synthwave, Ambient, Chiptune) | always | 7 |
| Music volume | 0–10 | always | 7 |
| Sound effects | 0–10 | always | 7 |
| Controller rumble | On / Off | a controller has been seen | 8 |
| Offer tutorial | On / Off (controls whether new players are asked) | always | 5 |
| Replay tutorial | action | always | 5 |
| Full screen | action | Fullscreen API available and not already installed | 3 |

All device-level settings live in one small `js/settings.js` module (load/save with try/catch, range checks, `spaceAdventure_` key prefix), unit tested. The main menu shrinks by one row, and the `MENU` test indices change once, in the groundwork commit. The same commit should also fold Easy/Medium/Hard into one "Difficulty ◂ ▸" row, which makes room for the "Multiplayer" row later ([05-local-multiplayer.md §10.1](05-local-multiplayer.md#101-menu-entry)). Final main menu: Start, Multiplayer, Upgrades, High Scores, Achievements, Help, Settings, Reset Data, Change User, Difficulty.

Note: the Full screen action must be a real DOM button click, not a canvas tap, because browsers only allow fullscreen inside a user gesture (see Item 3). The Settings row can show it, but the tap is handled by a DOM `app-btn` overlaid on that row or by the separate app bar.

### B. Shared input additions

- New single-press actions `menuLeft` / `menuRight` (ArrowLeft/A, ArrowRight/D) for Settings values (Items 7, 8).
- `lastInputSource` on `InputHandler` (`keyboard`, `touch`, `mouse`, `gamepad`), set by Item 8 and read by Item 5 for input-specific tutorial wording.

### C. Logical canvas size first

Item 2 replaces the roughly 130 uses of `canvas.width`/`canvas.height` in `main.js` with `viewWidth`/`viewHeight`. Every other item adds drawing code, so Item 2 goes first to avoid rework and merge conflicts.

### D. Service worker last

Item 3's service worker precaches every file and uses a content-hash version checked by a unit test. Adding it last means new modules from the other items are in the precache from the start, and developers are not fighting a cache while building them.

### E. Test hook stays read-only

All new fields on `window.__spaceAdventure` are getters. Tests only stub browser APIs (`navigator.vibrate`, `navigator.getGamepads`) and seed user settings before load. They never write game state.

## Recommended build order

| Step | Work | Why here |
|---|---|---|
| 0 | Ship the freeze fix (hyperspace crash + safe game loop) | Already done and tested locally, not yet pushed |
| 1 | Item 2 HiDPI | Touches almost every draw call; do it before new drawing code |
| 2 | Settings screen groundwork (A, B, `settings.js`) | Every later item plugs into it |
| 3 | Item 1 Colour-blind | New asteroid drawing on the logical-size code |
| 4 | Item 4 Haptics | Small; adds call sites that Item 8 rumble mirrors |
| 5 | Item 7 Music | Audio bus split, independent of input |
| 6 | Item 8 Gamepad | Provides `lastInputSource` for the tutorial |
| 7 | Item 5 Tutorial | Needs input kinds, settings and the final visuals |
| 8 | Item 3 PWA + fullscreen | Precaches the final file set |

## Parallelisation with agent teams

Most items share `js/main.js`, so fully parallel branches would conflict constantly. The plan splits work into two kinds:

1. **Pure modules, built in parallel.** Each item's core logic is a DOM-free module with its own unit tests: `viewport.js`, `palette.js`, `settings.js`, `haptics.js`, `music.js`, `gamepad.js`, `tutorial.js`, `sw.js` plus its version script. One agent per module, each in its own git worktree, touching only its module and its unit test file.
2. **Wiring, done in order by one integrator.** Hooking each module into `main.js`, `input.js`, the Settings screen and the DOM follows the build order above, one item per commit, with the full suite run after each.
3. **Testing in parallel per item.** After each wiring commit, an integration-test agent and a hands-on acceptance agent (emulated iPad, Android tablet, phone, desktop) run at the same time, as in the drag-to-steer round.

## Decisions (26 September 2026)

| # | Question | Decision |
|---|---|---|
| 1 | Replace the "Controls" menu row with a Settings screen | **Yes** |
| 2 | Change UFOs from green to purple | **Yes** |
| 3 | Tutorial on a player's first game | **Ask first**: "First time? Play the tutorial / Skip" |
| 4 | Music style | **The player picks a tune in Settings** (several built-in tunes plus Off) |
| 5 | Multiplayer scope | **Local play on one device only.** No online play, no third-party services, must keep working on free GitHub Pages |
| 6 | Freeze fix | **Shipped** in `5c3ca37` |

### Defaults applied when implementation started (26 September 2026)

The owner asked to implement everything; the open questions below were resolved with the recommendations in bold. The multiplayer questions in [05-local-multiplayer.md §16](05-local-multiplayer.md#16-questions-for-you) were likewise resolved with their bold recommendations.

1. Colour-safe palette blue/orange with shapes always on (**yes**); label spelling "Colours" or "Colors" (the code uses American spelling).
2. Cap render resolution at 2x (**yes**); a "Graphics: Fast" setting only if older iPads struggle.
3. Remember the mute setting between visits (**yes**).
4. Vibration on by default where supported (**yes**), independent of mute (**yes**).
5. Controller-only name entry: default name "PLAYER1" (**yes, for now**) or an on-screen letter picker.
6. iOS installed-app storage: explain it in the install hint (**yes, for now**) or build progress export/import.
7. GitHub Actions workflow running the tests on every push (**yes**).

## Multiplayer

Scope decided: **local multiplayer on one device only** (shared keyboard, game controllers, or several people on one tablet), with no network and no third-party services, so it keeps working on free GitHub Pages. The detailed plan is in [05-local-multiplayer.md](05-local-multiplayer.md). The broader investigation, including the online options that were ruled out, is in [04-multiplayer.md](04-multiplayer.md).
