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
- Keyboard and touch controls
- Sound effects

## Controls

| Action | Keys |
|--------|------|
| Rotate Left/Right | Arrow Keys / A, D |
| Thrust Forward | Up Arrow / W |
| Fire | Spacebar |
| Hyperspace (risky!) | H |
| Pause | P / Escape |
| Mute | M |

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
