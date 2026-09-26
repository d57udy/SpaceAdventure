# Space Adventure

A modified Asteroids game with unique gameplay mechanics - collect green asteroids for points while avoiding and destroying dangerous red asteroids!

Try the game live: https://d57udy.github.io/SpaceAdventure/

## Gameplay

Navigate your spaceship through an infinite asteroid field with two types of asteroids:

### Green Crystals (Collectible)
- Smooth, faceted, glowing shapes
- **Fly INTO them** to collect points
- Larger green asteroids give more points
- **Don't shoot them** - shooting destroys potential points!

### Red Rocks (Dangerous)
- Spiky star shapes with an X in the middle
- **Avoid collision** - touching them costs you a life
- **Shoot them** to destroy and survive
- They split into smaller red asteroids when shot

### Aliens (UFOs)
- Purple enemy UFOs that shoot at you
- They also target green asteroids to steal your scoring opportunities!
- Destroy them before they destroy your points

The shapes carry the meaning, so colour is never needed. For colour-blind players, **Settings > Colours > Colour-safe** switches to blue crystals and orange rocks (remembered on that device).

## Features

- **Infinite scrolling world** - explore endless space
- **Camera follows player** - smooth scrolling gameplay
- **Parallax starfield** - beautiful space background
- **Score-based leveling** - level up every 500 points
- Multiple difficulty levels (Easy, Medium, Hard)
- Persistent high scores per user
- Achievement system
- Keyboard, touch and game controller controls
- Sound effects and background music
- Local multiplayer on one device (see [Multiplayer](#multiplayer))

## Controls

Single-player: both key sets drive the one ship.

| Action | Keys |
|--------|------|
| Rotate Left/Right | Arrow Keys / A, D |
| Thrust Forward | Up Arrow / W |
| Fire | Spacebar, F or Enter |
| Hyperspace (risky!) | H / S / Down Arrow |
| Pause | P / Escape |
| Mute | M |

A game controller works too: left stick steers, Ⓐ or RT fires, Ⓑ is hyperspace and Start pauses. For two or more players see [Multiplayer](#multiplayer).

### Touch (tablets and phones)

On a touch screen the game shows on-screen controls while you play. No keyboard is needed. There are two touch schemes; switch between them with **Settings > Controls** in the main menu (your choice is remembered on that device).

**Drag to Steer (default)**

| Action | Touch |
|--------|-------|
| Steer | Put a finger anywhere on the left half of the screen and drag toward where you want to fly. The ship turns to face that direction |
| Thrust | Drag further from where your finger started. The further, the stronger |
| Fire | Red button, bottom right (hold for continuous fire) |
| Hyperspace (risky!) | Star button, next to Fire |
| Pause / Mute | Buttons in the top right corner |

**Buttons**

| Action | Touch |
|--------|-------|
| Rotate Left/Right | Arrow buttons, bottom left (slide your finger between them) |
| Thrust Forward | Up arrow button, bottom right |
| Fire, Hyperspace, Pause, Mute | Same as above |

In both schemes:
- Multi-touch works, so you can steer and fire at the same time.
- Tap a menu item to select it. Tap anywhere to leave Help, High Scores, Achievements and Game Over.
- Tap the username box to open the on-screen keyboard, then tap OK.
- Menus can also be clicked with a mouse. For full screen, see [Install, full screen and offline play](#install-full-screen-and-offline-play).

### Music, sound and vibration

**Settings > Music** picks the background tune (Off, Synthwave, Ambient or Chiptune) and plays a short preview. The music is generated in the browser and follows the game: quiet in menus, fuller in play, tense on your last life and in boss fights, and dimmed while paused. **Music volume** and **Sound effects** go from 0 to 10; Mute (M or the speaker button) silences everything. All choices are remembered on that device.

**Vibration (Android):** on phones and tablets whose browser supports it, pickups, hits, level-ups and boss kills give a short buzz. Turn it off with **Settings > Vibration**. iPhone, iPad and desktop browsers have no vibration support, so the setting does not appear there.

## Multiplayer

**Main menu > Multiplayer** plays on one device with no network: a shared keyboard, game controllers, one tablet, or any mix.

| Mode | Players | Rules |
|------|---------|-------|
| Take Turns | 2 to 4, one device passed around | One ship at a time; the highest score wins |
| Co-op "Wingmen" | 2 to 4 | Shared team score; fly close to a fallen wingman to revive them |
| Harvest Race | 2 | Most crystals when the clock runs out wins; shooting a crystal denies it |
| Duel | 2 | One hit kills; first to 5 kills wins |
| Saucer | 2 | P1 flies the ship and must reach the target score in 2:30; P2 steers the enemy saucer |
| Time Attack vs Ghost | 1 | 3 minutes on a numbered course, racing the best run on this device |

**Joining:** in the lobby each player presses their own fire to join and again when ready. Hyperspace leaves, rotate changes colour. The round starts 3 s after everyone is ready.

**Controls card:** the first round of a lobby shows each player's controls in their HUD panel, plus one line of rules. The world waits until every player presses fire (or 8 s). Rematches and restarts with the same players show it for 2 s. Help has a **Multiplayer** page (◂ ▸ or the button at the top).

### Controls per setup

**Shared keyboard**

| Action | P1 (left) | P2 (right) |
|--------|-----------|------------|
| Thrust | W | ↑ (numpad 8) |
| Turn | A / D | ← / → (numpad 4 / 6) |
| Hyperspace | S | ↓ (numpad 5) |
| Fire | Space or F | Enter or Right Shift (numpad Enter) |

Anyone can pause (P, Escape) or mute (M). Keys are matched by position, so AZERTY and QWERTZ keyboards use the same places.

**Controllers:** each controller is its own player. Press Ⓐ in the lobby to join; the stick steers, Ⓐ or RT fires, Ⓑ is hyperspace, Start pauses. Up to four players can mix controllers and the two keyboard sets; with three or four the camera zooms out to keep every ship on screen. If a controller disconnects mid-round the game pauses: press Ⓐ on it (or on a free controller) to continue, or choose **Drop Pn** in the pause menu.

**One tablet (touch):** each player drags on their own half to steer and uses their own fire and hyperspace buttons. Tap your side's pad in the lobby to join and again when ready; hold it to leave. **L** or the Layout row in the lobby picks the layout:

| Layout | How to sit | Orientation |
|--------|-----------|-------------|
| Side by side | Tablet on a stand, one player at each end; controls in the left and right bars | Landscape only |
| Facing | Tablet flat on a table between you; P1 at the bottom, P2 at the top (their controls and HUD turned to face them) | Portrait (best) or landscape |

Auto picks side by side in landscape and facing in portrait. Turning the tablet mid-round pauses the game.

### Tablet and keyboard tips

- **iPad:** four- and five-finger swipes can throw players to the home screen. Turn them off in **Settings > Multitasking & Gestures** (or **Settings > General > Gestures** on older iPadOS), or use Guided Access. Install the app (see below) for the full screen.
- Two players use four to six fingers at once. iPads handle this; some Android tablets report fewer touch points, and the lobby warns when fewer than 4 are available.
- **Keyboard ghosting:** two players thrusting, turning and firing press six keys at once, and many laptop keyboards drop some combinations. Check your keys with the lights on the lobby cards, use a USB keyboard if you can, or turn on **Auto-fire** so nobody holds fire.

### Accessibility

**Settings > Multiplayer** holds:
- **Auto-fire (multiplayer):** every living ship fires on its own in multiplayer rounds (never in single-player or Time Attack).
- **Fire side (left/bottom, right/top):** Outer puts a touch player's fire button at the screen edge, Inner next to the play area (side by side) or at the other end of their bar (facing), for left-handed players.
- **Stereo (side by side):** each player's fire and thrust sounds come from their side (where the browser supports stereo panning).

Every player has a colour, a hull mark and a number; HUD panel text is at least 18 px. The multiplayer pause menu also has **Mute**.

## Install, full screen and offline play

Space Adventure is an installable web app. After the first visit it also works offline, sounds included.

**Install**
- **Android (Chrome, Edge, Samsung Internet):** tap **Install** in the top right corner of the menu (or use the browser menu, "Install app"). The installed app opens full screen.
- **iPad and iPhone (Safari):** tap Share, then **Add to Home Screen**. The menu shows this hint until you dismiss it; the **Add to Home Screen** button in the top right corner shows it again. Note: iOS keeps the installed app's storage separate from Safari, so scores and credits from Safari don't carry over.
- **Desktop Chrome and Edge:** use the install icon in the address bar.

**Full screen in a browser tab:** the **Full screen** button (top right in menus, next to mute and pause while playing on touch screens, and in **Settings**) hides the browser's address bar. On a keyboard, press **F** in any menu (during play F fires). It is not offered on iPhone, where Safari does not allow it, or when the game already runs as an installed app.

**Offline:** a service worker stores everything the game needs on the device, so you can play without a connection, even after closing the browser.

**Updates:** when a new version has been downloaded, menus and the pause screen (never a running game) show "New version available: tap to update". Tapping saves your credits and reloads once. If you ignore it, the update applies the next time the game starts.

**Troubleshooting:** add `?nosw` to the address (for example `https://d57udy.github.io/SpaceAdventure/?nosw`) to remove the service worker and its stored files, then reload without it.

## Running Locally

**IMPORTANT: The game must be run from a web server, not by opening the HTML file directly!**

### Option 1: Using npm (recommended)
```bash
npm start
```
Then open http://localhost:8080

### Option 2: Using Python
```bash
python3 -m http.server 8080
```
Then open http://localhost:8080

### Option 3: Using any other web server
Serve the files from any web server and open in browser.

## Running Tests

```bash
# Install dependencies
npm install

# One-time: install the test browsers
npx playwright install chromium webkit

# Unit tests (Node's built-in runner, no browser)
npm run test:unit

# Integration and acceptance tests (Playwright: desktop keyboard, iPad touch)
npm run test:e2e

# Everything
npm test

# The game served under /SpaceAdventure/ like on GitHub Pages (http://localhost:8083/SpaceAdventure/)
npm run serve:subpath
```

On `localhost` the service worker stays off unless you add `?sw=1` to the address, so you always see your latest files while developing.

### Before committing: `npm run sw:version`

The service worker caches every game file under a version that is a hash of their contents. **Run `npm run sw:version` before committing any change to `index.html`, `style.css`, `manifest.webmanifest`, `js/*.js`, `assets/audio/*.mp3` or `icons/*.png`**, and after adding or removing such a file. Otherwise players keep the old files. `npm run sw:check` and the unit tests fail while `sw.js` is out of date. `npm run icons` regenerates the PNG icons from `icons/icon.svg` (needs ImageMagick).

GitHub Actions (`.github/workflows/test.yml`) runs `sw:check`, the unit tests and the Playwright tests on every push and pull request.

## GitHub Pages Deployment

This game is fully compatible with GitHub Pages (free edition):

1. Push to a GitHub repository
2. Go to Settings > Pages
3. Select "Deploy from a branch"
4. Select `main` branch and `/ (root)` folder
5. Your game will be available at `https://yourusername.github.io/repository-name/`

## Technical Notes

- Built with vanilla JavaScript and HTML5 Canvas
- Uses ES6 modules (requires web server)
- No external dependencies for the game itself
- Playwright tests for quality assurance
