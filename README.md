# Space Adventure

A modified Asteroids game with unique gameplay mechanics - collect green asteroids for points while avoiding and destroying dangerous red asteroids!

Try the game live: https://d57udy.github.io/SpaceAdventure/

## Gameplay

Navigate your spaceship through an infinite asteroid field with two types of asteroids:

### Green Asteroids (Collectible)
- **Fly INTO them** to collect points
- Larger green asteroids give more points
- **Don't shoot them** - shooting destroys potential points!

### Red Asteroids (Dangerous)
- **Avoid collision** - touching them costs you a life
- **Shoot them** to destroy and survive
- They split into smaller red asteroids when shot

### Aliens (UFOs)
- Enemy UFOs that shoot at you
- They also target green asteroids to steal your scoring opportunities!
- Destroy them before they destroy your points

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

On a touch screen the game shows on-screen buttons while you play. No keyboard is needed.

| Action | Touch |
|--------|-------|
| Rotate Left/Right | Arrow buttons, bottom left (slide your finger between them) |
| Thrust Forward | Up arrow button, bottom right |
| Fire | Red button, bottom right (hold for continuous fire) |
| Hyperspace (risky!) | Star button, next to Fire |
| Pause / Mute | Buttons in the top right corner |
| Menus | Tap a menu item. Tap anywhere to leave Help, High Scores, Achievements and Game Over |
| Username | Tap the box to open the on-screen keyboard, then tap OK |

Multi-touch works, so you can rotate, thrust and fire at the same time. Menus can also be clicked with a mouse. For a full-screen experience on iPad, use Safari's "Add to Home Screen".

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
```

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
