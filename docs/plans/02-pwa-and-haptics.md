# Items 3 and 4: Installable full-screen offline app, haptic feedback

Line numbers refer to `js/main.js` unless another file is named. Settings placement follows [README §A](README.md#a-one-settings-screen-instead-of-more-main-menu-rows): "Vibration" and "Full screen" live on the Settings screen, so the main-menu `menuStartY` change proposed during planning is no longer needed.

## Findings that shape both items

1. **Taps on the on-screen game buttons don't count as a user gesture for fullscreen.** `InputHandler` handles `.touch-btn[data-action]` presses on `pointerdown` and calls `preventDefault()` on `touchstart`. Browsers grant user activation on `pointerup`/`touchend`, and cancelling `touchstart` suppresses `click`. So fullscreen and install buttons get their own `app-btn` class (no `data-action`, excluded from the `touchstart` handler) and call `requestFullscreen()` synchronously in a `click` listener.
2. **GitHub Pages sends `Cache-Control: max-age=600`** (verify with `curl -I`). The service worker must fetch its precache with `cache: 'reload'`, or a new worker can cache old files from the HTTP cache: the classic "stale forever" bug.
3. **The `d57udy.github.io` origin is shared by all of the owner's project pages.** Cache names need an app prefix, and cleanup may only delete caches with that prefix. localStorage keys are already prefixed.
4. **Nothing is versioned by URL** (`js/main.js`, `style.css`, mp3s). Cache-first is only safe if the service worker version changes whenever any cached file changes, so the plan uses a content hash enforced by a unit test.
5. **Existing pieces:** `index.html` already has `viewport-fit=cover`, `apple-mobile-web-app-capable`, `black-translucent` and `theme-color`. Touch controls already use `env(safe-area-inset-*)`, but `resizeCanvas()` ignores safe areas. There is no CI. ImageMagick is installed on the dev Mac for icon generation.

---

## Item 3: Installable, full-screen, offline app

### Goal and user impact
- Install to the home screen on Android and iPad/iPhone; launch without browser chrome; truly full screen on Android.
- Works offline after the first visit, including audio.
- New versions arrive reliably, never mix old and new files, and never interrupt a game.
- In a browser tab, a Full screen button hides the address bar on Android, desktop and iPad (not iPhone, where Safari doesn't allow it).

### UX
- **App bar** (DOM, top right, shown outside gameplay): up to three `app-btn` buttons: **Full screen**, **Install** (Android/Chromium, after `beforeinstallprompt`) and an **Add to Home Screen** hint (iOS only). During play, a Full screen toggle sits next to mute and pause; desktop gets an `F` key.
- The Full screen button is hidden when `document.fullscreenEnabled` is false (iPhone) or the app already runs installed.
- **Orientation:** manifest `"orientation": "any"` (the square canvas works both ways). While in fullscreen on Android, lock to the current orientation so tilting mid-game doesn't rotate the world; unlock on exit. All guarded with `.catch(() => {})`.
- **iOS hint:** shown once in the menu on iOS/iPadOS Safari when not installed: "Install: tap Share, then 'Add to Home Screen'". Dismissible, remembered. It also tells the player that **scores and credits don't carry over from Safari to the installed app** (iOS keeps separate storage).
- **Android install:** capture `beforeinstallprompt`, show Install, call `prompt()` on click, hide on `appinstalled`.
- **Update toast** "New version available: tap to update", shown only in menu, pause, game over and high scores, never during play. Tapping saves credits, tells the waiting worker to activate, and reloads once. If ignored, the update applies on the next cold start.

### Technical approach

**New files (all committed; nothing is built at deploy time):**

| File | Purpose |
|---|---|
| `manifest.webmanifest` | App manifest (below) |
| `sw.js` (repo root, so its scope is `/SpaceAdventure/`) | Precache, cache-first, cleanup, activation on request |
| `js/pwa.js` | Registration, update toast, install prompt, iOS hint, fullscreen and orientation, display-mode detection; browser APIs injected for unit tests |
| `icons/icon.svg` | Source artwork: the ship on a dark background |
| `icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon-180.png`, `favicon-32.png` | Generated once with ImageMagick and committed. Maskable art stays inside the central 80%; the Apple icon has no transparency |
| `scripts/make-icons.sh` | Dev-only icon generation |
| `scripts/update-sw-version.mjs` | Dev-only: hashes the precached files and rewrites `CACHE_VERSION` in `sw.js` |
| `tests/support/serve.mjs` | Small static server that serves the repo under `/SpaceAdventure/` to test sub-path behaviour |

**Manifest** (all URLs relative, so it works at `/` locally and at `/SpaceAdventure/` on Pages):
```json
{
  "id": "./", "name": "Space Adventure", "short_name": "Space Adv",
  "description": "Collect green asteroids, dodge red ones.",
  "start_url": "./", "scope": "./",
  "display": "fullscreen", "display_override": ["fullscreen", "standalone"],
  "orientation": "any", "background_color": "#000000", "theme_color": "#111111",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```
`display: fullscreen` gives Android an immersive screen; iOS falls back to standalone. `index.html` gains the manifest link, favicon, `apple-touch-icon` and `apple-mobile-web-app-title`.

**Service worker (`sw.js`):**
- `CACHE_PREFIX = 'space-adventure-'`, `CACHE_VERSION = 'sa-<hash>'`.
- `PRECACHE`: `./`, `index.html`, `style.css`, the manifest, every `js/*.js`, every `assets/audio/*.mp3`, the icons.
- **install:** `cache.addAll(PRECACHE.map(u => new Request(u, { cache: 'reload' })))`; no automatic `skipWaiting`.
- **activate:** delete only caches starting with the prefix that aren't current, then `clients.claim()` so the first visit works offline without a reload.
- **message** `{type: 'SKIP_WAITING'}` → `skipWaiting()`.
- **fetch:** same-origin GET inside the scope only. Navigations are served from the cached `./` (so the page and its modules always come from the same version); other requests cache-first, network on miss.

**Update strategy (avoids "stale forever"):**
1. Version tied to content: `npm run sw:version` before committing; a unit test recomputes the hash and **fails `npm test` if the version is stale** or the precache list doesn't match the files on disk.
2. Register with `updateViaCache: 'none'` so the 10-minute Pages cache doesn't delay detection.
3. Check for updates when the page becomes visible and every 60 minutes (installed apps can stay open for days).
4. Show the toast for both a waiting worker at load and one that finishes installing later.
5. Reload exactly once on `controllerchange`.
6. Escape hatch: `?nosw` (or a kill-switch constant) unregisters the worker and clears its caches, to recover from a bad deploy.
7. On `localhost`, skip registration unless `?sw=1`, so developers aren't served stale files.

**Fullscreen:** fullscreen `document.documentElement` (not the canvas, or the HUD and touch controls would disappear), with `navigationUI: 'hide'` and a `webkitRequestFullscreen` fallback for older iPadOS. The existing resize handling covers entering and leaving.

**Safe areas:** CSS variables from `env(safe-area-inset-*)`; `resizeCanvas()` subtracts them before sizing the canvas. Matters for iPhone landscape (notch) and Android fullscreen with display cutouts.

**`main.js`:** `initPwa({ getState, onBeforeReload: save credits })` at startup; hook `pwa` fields (`swControlled`, `displayMode`, `updateReady`, `canInstall`, `fullscreen`); state classes on `<body>` so CSS shows the app bar and toast only outside play.

### Tasks
1. Icon artwork and generated PNGs; check the maskable safe zone.
2. Manifest and `<head>` links; check the MIME type locally.
3. `sw.js`; version script and npm script; run once.
4. `js/pwa.js`.
5. DOM and CSS for the app bar, iOS hint, toast and safe areas.
6. Wire into `main.js`; hook fields; safe-area canvas sizing.
7. Full screen button in the in-game corner and the Settings screen; `F` key.
8. Tests; Playwright config.
9. README: installing, offline play, "run `npm run sw:version` before committing".
10. Deploy and test on real devices.

### Tests
- **Unit:** `sw.test.mjs` (load `sw.js` in a `node:vm` context with fake `caches`/`fetch`/`clients`: install precaches everything with `cache: 'reload'`; activate deletes only old prefixed caches and claims clients; fetch serves cache hits, passes through cross-origin and non-GET, maps navigations to `./`; SKIP_WAITING works). `sw-version.test.mjs` (precache list equals the files on disk; version equals the recomputed hash). `manifest.test.mjs` (valid JSON, relative URLs, 192/512/maskable icons exist with matching pixel sizes, `index.html` links them). `pwa.test.mjs` (iOS and iPadOS detection, hint rules, fullscreen button visibility, toast only outside play).
- **Integration (Chromium only; Playwright's service worker support is Chromium-only):** new projects `pwa-chromium` and `pwa-subpath` (served under `/SpaceAdventure/`); existing projects get `serviceWorkers: 'block'` to stay deterministic. `pwa.spec.js`: worker registers and controls the page with the right scope; precache is complete; **offline**: go offline, reload, log in, play, mp3s served by the worker; **update flow**: serve a changed `sw.js`, toast appears in the menu but not during play, tapping it reloads onto the new cache and deletes the old one; manifest and installability via CDP; fullscreen button (may need a headed run). On the iPad project: the iOS hint appears in the menu, dismissal persists, never during play; Full screen hidden when unsupported.
- Lighthouse 12 removed the PWA audit, so installability is checked via CDP and DevTools.
- **UAT on real devices:** Android Chrome (install prompt, full screen launch, airplane-mode cold start with sound, orientation lock in fullscreen, update toast after a trivial deploy); iPad Safari (Full screen button, Add to Home Screen, status bar and safe areas, offline, hint once); iPhone (no Full screen button, hint, notch, offline); desktop Chrome/Edge (installable, `F` key).

### Risks
| Risk | Mitigation |
|---|---|
| Stale files forever | Content-hash version with a failing test; `cache: 'reload'`; `updateViaCache: 'none'`; periodic update checks; `?nosw` kill switch |
| Mixed old and new files | Everything served from one versioned cache, including navigations |
| Update applied mid-game | Toast only outside play; explicit activation; credits saved first |
| Deleting another app's caches on the shared origin | Delete only caches with the `space-adventure-` prefix |
| iOS installed app has separate storage | Explained in the hint; optional export/import later |
| Fullscreen blocked on touch | Dedicated `app-btn` with a click handler |
| Orientation lock rejected (iOS, not fullscreen) | Feature-detect and catch; purely progressive |

**GitHub Pages:** HTTPS satisfies the secure-context rule. No custom headers are possible, so the worker scope is its own folder (repo root = `/SpaceAdventure/`, as wanted) and the fixed cache header is handled as above. Avoid files starting with `_` (Jekyll ignores them) or add `.nojekyll`. All URLs stay relative. **Effort:** L (2–3 days). Do it last so the precache includes every new module.

**Open questions:** skip registration on localhost by default (recommended); `display: fullscreen` (hides the clock on Android) or `standalone`; offer Full screen on desktop too; progress export/import for iOS; add a GitHub Actions workflow to run the tests on push; keep the screen awake during play (Screen Wake Lock API, cheap to add).

---

## Item 4: Haptic feedback

### Goal and user impact
On Android phones and tablets, short vibrations confirm pickups and make hits, deaths, level-ups and boss kills feel physical, which helps most with audio muted. iOS Safari and desktops don't support the Vibration API; they see no change and no dead setting.

### UX
- **Settings row "Vibration: On/Off"**, shown only when `navigator.vibrate` exists and the device has touch (desktop Chromium exposes `vibrate` but has no motor). Default On; stored as `spaceAdventure_haptics`. Switching it on plays a confirmation tick. Independent of mute.
- Help screen touch list: "Vibration: Settings".
- No vibration on fire (it would buzz constantly).

### Event map
| Event | Pattern (ms) | Priority | Minimum gap |
|---|---|---|---|
| Collect green | `12` | 1 | 70 ms (combos stay tick-tick) |
| Power-up pickup | `[20, 40, 20]` | 2 | 150 ms |
| Shield absorbs a hit | `40` | 3 | 150 ms |
| Boss weak point destroyed | `25` | 2 | 100 ms |
| Successful hyperspace | `[15, 30, 40]` | 2 | – |
| Level up | `[30, 60, 30, 60, 60]` | 3 | – |
| Life lost | `[120, 60, 200]` | 4 | – |
| Boss defeated | `[60, 40, 60, 40, 220]` | 4 | – |
| Game over | `[200, 100, 350]` | 5 | – |
| Setting switched on | `30` | 5 | – |

**Rate limiting and priority:** while a pattern is running, only an equal or higher priority pattern can interrupt it (a new `vibrate()` call cancels the running one, so a death is never replaced by a collect tick); per-event minimum gaps stop bursts; a global cap of about 8 calls per second is a safety net; `stop()` calls `vibrate(0)`.

### Technical approach
- **New `js/haptics.js`** (no DOM; navigator, storage and clock injected): `HAPTIC_PATTERNS`, `HAPTICS_KEY`, `class Haptics { supported; enabled; setEnabled(bool); play(name); stop(); stats }`. Chrome requires a prior user gesture ("sticky activation"); the login and menu taps always come first, and the module checks `navigator.userActivation.hasBeenActive` where available to avoid console warnings.
- **`main.js` call sites:** power-up activation; green collect (next to the collect sound); every shield-block branch; boss weak point destroyed and boss defeated; `handlePlayerDeath` (death or game over, depending on remaining lives; also covers the fatal hyperspace case); successful hyperspace; `levelUp`. `stop()` in `pauseGame()`, when the tab is hidden, and in `gameOver()`. Hook: `haptics { supported, enabled, calls, last }`.
- Add `js/haptics.js` to the service worker precache (Item 3); the version test catches it either way.

### Tasks
1. `js/haptics.js` + unit tests.
2. Settings row and Help line.
3. Event calls and `stop()` points.
4. Hook and test helper.
5. Integration tests; README "Vibration (Android)" note.
6. Real-device UAT.

### Tests
- **Unit `haptics.test.mjs`** (fake navigator, storage, clock): unsupported → `play()` false, never throws, throwing `vibrate` is swallowed; default on; `setEnabled(false)` persists and stops; each pattern passed exactly; two collects 30 ms apart → one call, 80 ms apart → two; death then collect 50 ms later → collect dropped; collect then death → death goes through; global cap; unknown names ignored.
- **Integration (touch projects):** a recording `vibrate` stub installed before load (also works on WebKit, which lacks the API). The Settings row shows "Vibration: On"; toggling persists and records the confirmation tick; the hyperspace button records a hyperspace or death pattern (the 10% self-destruct makes both valid); with Vibration off, nothing is recorded; pausing records a stop (`0`); without the stub on the iPad project there is no Vibration row; desktop has no row.
- **UAT:** Android Chrome and Samsung Internet with vibration enabled and not in Do Not Disturb: each event feels distinct, fast combos don't blur into one buzz, death overrides collect, the toggle persists, nothing vibrates while paused or in the background. iPhone/iPad: no row, no errors.

### Risks
| Risk | Mitigation |
|---|---|
| Too much buzzing or battery drain | Short patterns, priorities, gaps, global cap, easy off switch |
| "Blocked vibrate" console warning before first gesture | Check `userActivation.hasBeenActive` |
| Silent mode or Do Not Disturb suppresses vibration | Operating-system behaviour; nothing to do |
| Firefox for Android lacks support | Feature detection hides the setting |

**GitHub Pages:** nothing beyond HTTPS. **Effort:** S–M (0.5–1 day).

**Open questions:** should mute also silence vibration (recommended: no); default on (recommended: yes); a light buzz when a UFO appears or at the boss warning.

## Sources
- Vibration API: [caniuse](https://caniuse.com/vibration), [MDN Navigator.vibrate](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate)
- Fullscreen API: [MDN requestFullscreen](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen), [caniuse](https://caniuse.com/fullscreen), [WebKit bug 240312](https://www2.webkit.org/show_bug.cgi?id=240312), [WebKit bug 212934](https://www2.webkit.org/show_bug.cgi?id=212934), [Apple developer forum](https://developer.apple.com/forums/thread/133248)
- Screen orientation lock: [MDN ScreenOrientation.lock](https://developer.mozilla.org/en-US/docs/Web/API/ScreenOrientation/lock), [caniuse](https://caniuse.com/screen-orientation)
- iOS 26 web apps: [Michael Tsai](https://mjtsai.com/blog/2025/10/03/web-apps-in-ios-26/), [Initial Charge](https://initialcharge.net/2025/10/open-as-web-app-option/), [Flavio Copes](https://flaviocopes.com/website-ios-full-screen/)
- Chrome install criteria: [web.dev](https://web.dev/articles/install-criteria)
- Playwright service workers: [playwright.dev](https://playwright.dev/docs/service-workers)
- Lighthouse 12 removed the PWA category: [GoogleChrome/lighthouse #15535](https://github.com/GoogleChrome/lighthouse/issues/15535), [changelog](https://github.com/GoogleChrome/lighthouse/blob/main/changelog.md)
- Not confirmed from a primary source, verify during testing: iOS home-screen apps keep storage separate from Safari; GitHub Pages `max-age=600`.
