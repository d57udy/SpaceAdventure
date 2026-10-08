// The full 3D game through its menus (docs/plans/07-3d-game.md §4, Phase 4): js/3d/ui3d.js
// wired into the 3D page. Projects: chromium-3d (landscape phone, touch) and
// chromium-3d-desktop (mouse and keyboard), WebGL through SwiftShader on CI.
//
// Only the ui3d ids (#u3d-<id>, [data-u3d="<id>"]) and the read-only hook
// window.__spaceAdventure.game3d are used. SwiftShader can run at 1-5 fps, so nothing waits
// on wall time: waits are on hook state, fixed sim steps (`steps`) and game time (`time`).
// Every URL the test opens carries &lowres3d=1. (The 2D menu's Start 3D opens ./?3d=1 by
// itself, without it: that one test only checks the 3D menu, which draws no 3D scene.)
//
// REQUIRED HOOK FIELDS (window.__spaceAdventure.game3d), for the wiring agent:
//   ui          ui.snapshot() from js/3d/ui3d.js: { visible, screen, focus, items, profile,
//               guest, prompts, view }
//   screen      'menu' | 'playing' | 'paused' | 'over' as today ('playing' only while the
//               ui overlay is hidden and the sim runs)
//   steps, time, loaded, chosenMode, viewDistance, score, level, lives, over  (exist today)
//   difficulty  the run's difficulty id ('easy' | 'medium' | 'hard'), from the shared
//               'difficulty' setting at game start
//   tutorial    { active: boolean } (the 3D tutorial running in this game)
//   user        the current profile (persistence.getCurrentUser()), null for a guest
// REQUIRED URL OPTION:
//   &layout3d=doom  a deterministic quick game over: 1 life, a small crystal at the ship
//               (collected on the first steps, so the score is > 0) and a red rock on a
//               collision course arriving within about 2 game seconds, with no dodging.
// REQUIRED INPUT: P (and Esc) pause while playing, as the prototype's P does today.
import { test, expect } from '@playwright/test';

test.setTimeout(240000); // SwiftShader renders slowly on CI
const T = 60000;

const NAME_KEY = 'asteroids_currentUser';
const USER = 'PILOT3D';
const variant = (testInfo) => (testInfo.project.name.endsWith('desktop') ? 'desktop' : 'phone');
const shot = (page, testInfo, name) => page.screenshot({ path: `tests/screenshots/3d-${variant(testInfo)}-game-${name}.png` });

/** A signed-in profile (as the 2D name prompt leaves it). */
const profile = (name = USER) => ({ [NAME_KEY]: name, asteroids_userList: JSON.stringify([name]) });

/**
 * Open the 3D page with fresh storage (once per test, not on the test's own reloads).
 * Joystick control and deviceorientation only: deterministic without motion.
 */
async function open3d(page, { query = '&seed3d=1', storage = {}, path = '/?3d=1' } = {}) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.addInitScript((entries) => {
    try {
      if (!sessionStorage.getItem('__g3d_cleared')) {
        localStorage.clear();
        localStorage.setItem('spaceAdventure_sensor3d', 'event');
        localStorage.setItem('spaceAdventure_control3d', 'joystick');
        for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
        sessionStorage.setItem('__g3d_cleared', '1');
      }
    } catch (e) { /* storage unavailable */ }
  }, storage);
  await page.goto(`${path}${query}&lowres3d=1`);
  await waitLoaded(page);
  return errors;
}
const waitLoaded = (page) => page.waitForFunction(() => window.__spaceAdventure && window.__spaceAdventure.game3d
  && window.__spaceAdventure.game3d.loaded, null, { timeout: T });

const g3 = (page) => page.evaluate(() => window.__spaceAdventure.game3d);
const g3get = (page, key) => page.evaluate((k) => window.__spaceAdventure.game3d[k], key);
const ui = (page) => page.evaluate(() => window.__spaceAdventure.game3d.ui);
const uiScreen = (page) => expect.poll(async () => (await ui(page)).screen, { timeout: T });
const item = (page, id) => page.locator(`[data-u3d="${id}"]`);

async function waitSteps(page, n = 2) {
  const s0 = await g3get(page, 'steps');
  await page.waitForFunction((t) => window.__spaceAdventure.game3d.steps >= t, s0 + n, { timeout: T });
}
async function play(page, ms) {
  const t0 = await g3get(page, 'time');
  await page.waitForFunction((t) => window.__spaceAdventure.game3d.time >= t, t0 + ms / 1000, { timeout: T });
}
async function expectPlaying(page) {
  await expect.poll(() => g3get(page, 'screen'), { timeout: T }).toBe('playing');
  expect((await ui(page)).visible).toBe(false);
  await waitSteps(page, 2);
}
/** Step a Settings row with its ▸ (dir 1) or ◂ (dir -1) button. */
async function stepRow(page, key, dir = 1, times = 1) {
  const row = page.locator(`#u3d-set-${key}`);
  for (let i = 0; i < times; i++) await row.locator('button').nth(dir > 0 ? 2 : 0).click();
}
const rowValue = async (page, key) => (await ui(page)).items.find((i) => i.id === `set-${key}`).value;

test('name entry like 2D: rules, then the menu with the pilot and the version', async ({ page }, testInfo) => {
  const errors = await open3d(page);
  await uiScreen(page).toBe('profile');
  await shot(page, testInfo, 'profile');
  const name = page.locator('#u3d-name');
  await name.fill('a-1');
  await item(page, 'name-ok').click();
  await expect.poll(async () => (await ui(page)).view.error).toMatch(/at least 3/);
  await name.fill('pilot3d');
  await expect(name).toHaveValue(USER);
  await item(page, 'name-ok').click();
  await uiScreen(page).toBe('menu');
  const s = await ui(page);
  expect(s.profile).toBe(USER);
  expect(s.guest).toBe(false);
  expect(s.view.version).toBeTruthy();
  expect(await page.evaluate((k) => localStorage.getItem(k), NAME_KEY)).toBe(USER);
  await shot(page, testInfo, 'menu');
  // The profile is remembered: no name screen after a reload
  await page.reload();
  await waitLoaded(page);
  await uiScreen(page).toBe('menu');
  expect((await ui(page)).profile).toBe(USER);
  expect(errors).toEqual([]);
});

test('Play as guest: the menu shows Guest, Play starts at once (no tutorial offer)', async ({ page }) => {
  const errors = await open3d(page);
  await uiScreen(page).toBe('profile');
  await item(page, 'guest').click();
  await uiScreen(page).toBe('menu');
  expect((await ui(page)).guest).toBe(true);
  await expect(page.locator('#u3d')).toContainText('Guest');
  await item(page, 'play').click();
  await expectPlaying(page);
  expect(await g3get(page, 'user')).toBeNull();
  expect(errors).toEqual([]);
});

test('tutorial offer for a new pilot, declined: plain game, not asked again', async ({ page }) => {
  const errors = await open3d(page, { storage: profile() });
  await uiScreen(page).toBe('menu');
  await item(page, 'play').click();
  await uiScreen(page).toBe('tutorial');
  await item(page, 'tutorial-no').click();
  await expectPlaying(page);
  expect((await g3get(page, 'tutorial')).active).toBe(false);
  await page.reload();
  await waitLoaded(page);
  await uiScreen(page).toBe('menu');
  await item(page, 'play').click();
  await expectPlaying(page);
  expect(errors).toEqual([]);
});

test('settings persist across a reload: control type, view distance, difficulty', async ({ page }, testInfo) => {
  const errors = await open3d(page, { storage: { ...profile(), spaceAdventure_control3d: 'direct', spaceAdventure_offerTutorial: 'false' } });
  await uiScreen(page).toBe('menu');
  await item(page, 'settings').click();
  await uiScreen(page).toBe('settings');
  await shot(page, testInfo, 'settings');
  await stepRow(page, 'control3d', 1, 2); // Direct -> Rate -> Joystick
  await stepRow(page, 'viewDistance3d', 1); // Far -> Very far
  await stepRow(page, 'difficulty', 1); // Medium -> Hard
  expect(await rowValue(page, 'control3d')).toBe('joystick');
  expect(await rowValue(page, 'viewDistance3d')).toBe('veryfar');
  expect(await rowValue(page, 'difficulty')).toBe('hard');
  const stored = await page.evaluate(() => ['control3d', 'viewDistance3d', 'difficulty'].map((k) => localStorage.getItem(`spaceAdventure_${k}`)));
  expect(stored).toEqual(['joystick', 'veryfar', 'hard']);
  await page.reload();
  await waitLoaded(page);
  await uiScreen(page).toBe('menu');
  expect(await g3get(page, 'chosenMode')).toBe('joystick');
  expect(await g3get(page, 'viewDistance')).toBe('veryfar');
  await item(page, 'settings').click();
  expect(await rowValue(page, 'difficulty')).toBe('hard');
  await item(page, 'back').click();
  await item(page, 'play').click();
  await expectPlaying(page);
  expect(await g3get(page, 'difficulty')).toBe('hard');
  expect(errors).toEqual([]);
});

test('play to game over: score, rank, credits; the new entry is highlighted on the 3D board', async ({ page }, testInfo) => {
  const errors = await open3d(page, { query: '&seed3d=1&layout3d=doom', storage: { ...profile(), spaceAdventure_offerTutorial: 'false' } });
  await uiScreen(page).toBe('menu');
  await item(page, 'play').click();
  await expectPlaying(page);
  await expect.poll(() => g3get(page, 'over'), { timeout: T * 2 }).toBe(true);
  await uiScreen(page).toBe('gameOver');
  const over = (await ui(page)).view;
  expect(over.score).toBeGreaterThan(0);
  expect(over.score).toBe(await g3get(page, 'score'));
  expect(over.newHigh).toBe(true);
  expect(over.rank).toBe(0);
  expect(over.credits).toBeGreaterThan(0);
  await expect(page.locator('#u3d')).toContainText('New high score!');
  await shot(page, testInfo, 'gameover');
  const board = await page.evaluate((u) => JSON.parse(localStorage.getItem(`asteroids_highScores3d_${u}`) || '[]'), USER);
  expect(board[0].score).toBe(over.score);
  await item(page, 'highscores').click();
  await uiScreen(page).toBe('highScores');
  const hs = (await ui(page)).view;
  expect(hs.highlight).toBeGreaterThanOrEqual(0);
  expect(hs.rows[hs.highlight].score).toBe(over.score);
  await expect(page.locator('#u3d tr.u3d-hl')).toHaveCount(1);
  await expect(page.locator('#u3d tr.u3d-hl')).toContainText(String(over.score));
  await shot(page, testInfo, 'highscores');
  // Back to game over, then Play again starts a new game
  await item(page, 'back').click();
  await uiScreen(page).toBe('gameOver');
  await item(page, 'again').click();
  await expectPlaying(page);
  expect(await g3get(page, 'over')).toBe(false);
  expect(errors).toEqual([]);
});

test('pause menu: Resume, Settings and back, Restart, Quit to the 3D menu', async ({ page }, testInfo) => {
  const errors = await open3d(page, { storage: { ...profile(), spaceAdventure_offerTutorial: 'false' } });
  await uiScreen(page).toBe('menu');
  await item(page, 'play').click();
  await expectPlaying(page);
  await play(page, 1500);
  await page.keyboard.press('p');
  await uiScreen(page).toBe('pause');
  await expect.poll(() => g3get(page, 'screen'), { timeout: T }).toBe('paused');
  await shot(page, testInfo, 'pause');
  const frozen = await g3get(page, 'steps');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  expect(await g3get(page, 'steps')).toBe(frozen); // paused: no sim steps
  await item(page, 'resume').click();
  await expectPlaying(page);
  // Settings from the pause menu return to it
  await page.keyboard.press('p');
  await uiScreen(page).toBe('pause');
  await item(page, 'settings').click();
  await uiScreen(page).toBe('settings');
  expect((await ui(page)).view.from).toBe('pause');
  await item(page, 'back').click();
  await uiScreen(page).toBe('pause');
  // Restart: a new game from the start
  const tBefore = await g3get(page, 'time');
  await item(page, 'restart').click();
  await expectPlaying(page);
  expect(await g3get(page, 'time')).toBeLessThan(tBefore);
  // Quit: back to the 3D menu
  await page.keyboard.press('p');
  await uiScreen(page).toBe('pause');
  await item(page, 'quit').click();
  await uiScreen(page).toBe('menu');
  await expect.poll(() => g3get(page, 'screen'), { timeout: T }).toBe('menu');
  expect(errors).toEqual([]);
});

test('Help: controls per input kind, radar and rules; Esc goes back', async ({ page }, testInfo) => {
  const errors = await open3d(page, { storage: profile() });
  await uiScreen(page).toBe('menu');
  await item(page, 'help').click();
  await uiScreen(page).toBe('help');
  const box = page.locator('#u3d');
  await expect(box).toContainText('Radar');
  await expect(box).toContainText('Clear every red rock and every green crystal');
  await expect(box).toContainText('Triple Shot');
  await item(page, 'help-desktop').click();
  await expect.poll(async () => (await ui(page)).view.input).toBe('desktop');
  await expect(box).toContainText('W or ↑ thrust');
  await item(page, 'help-controller').click();
  await expect.poll(async () => (await ui(page)).view.input).toBe('controller');
  await shot(page, testInfo, 'help');
  await page.keyboard.press('Escape');
  await uiScreen(page).toBe('menu');
  expect(errors).toEqual([]);
});

test('keyboard and controller-style navigation: arrows move the focus, Enter selects', async ({ page }) => {
  const errors = await open3d(page, { storage: profile() });
  await uiScreen(page).toBe('menu');
  expect((await ui(page)).focus).toBe('play');
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await ui(page)).focus).toBe('settings');
  await page.keyboard.press('Enter');
  await uiScreen(page).toBe('settings');
  await page.keyboard.press('ArrowRight'); // the focused row (Control type) steps
  await expect.poll(() => rowValue(page, 'control3d')).toBe('direct'); // joystick wraps to direct
  await page.keyboard.press('Escape');
  await uiScreen(page).toBe('menu');
  expect((await ui(page)).focus).toBe('settings');
  expect(errors).toEqual([]);
});

test('Switch to 2D lands on the 2D menu (./?2d=1) and forgets 3D as the last mode', async ({ page }) => {
  const errors = await open3d(page, { storage: { ...profile('TESTER'), spaceAdventure_lastMode: '3d' } });
  await uiScreen(page).toBe('menu');
  await Promise.all([
    page.waitForURL(/[?&]2d=1/, { timeout: T }),
    item(page, 'switch2d').click(),
  ]);
  await page.waitForFunction(() => window.__spaceAdventure && window.__spaceAdventure.state === 'menu', null, { timeout: T });
  expect(await page.evaluate(() => window.__spaceAdventure.user)).toBe('TESTER');
  expect(await page.evaluate(() => localStorage.getItem('spaceAdventure_lastMode'))).toBeNull();
  expect(errors).toEqual([]);
});

test('Start 3D from the 2D menu (?force3d=1) reaches the 3D menu with the same pilot', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.addInitScript((entries) => {
    try {
      if (!sessionStorage.getItem('__g3d_cleared')) {
        localStorage.clear();
        for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
        sessionStorage.setItem('__g3d_cleared', '1');
      }
    } catch (e) { /* storage unavailable */ }
  }, { ...profile('TESTER'), spaceAdventure_offerTutorial: 'false', spaceAdventure_sensor3d: 'event' });
  await page.goto('/?force3d=1');
  await page.waitForFunction(() => window.__spaceAdventure && window.__spaceAdventure.state === 'menu', null, { timeout: T });
  expect((await page.evaluate(() => window.__spaceAdventure.menuOptions))[0]).toBe('Start 3D');
  await Promise.all([
    page.waitForURL(/[?&]3d=1/, { timeout: T }),
    page.keyboard.press('Enter'),
  ]);
  await waitLoaded(page);
  await uiScreen(page).toBe('menu');
  expect((await ui(page)).profile).toBe('TESTER');
  expect(errors).toEqual([]);
});

test('credits and upgrades are shared: bought in 3D, shown in 2D', async ({ page }, testInfo) => {
  const errors = await open3d(page, {
    storage: { ...profile('TESTER'), asteroids_upgrades_TESTER: JSON.stringify({ levels: {}, currency: 1234 }) },
  });
  await uiScreen(page).toBe('menu');
  await item(page, 'upgrades').click();
  await uiScreen(page).toBe('upgrades');
  let v = (await ui(page)).view;
  expect(v.canBuy).toBe(true);
  expect(v.credits).toBe(1234);
  await item(page, 'buy-turnSpeed').click(); // 300 credits
  await expect.poll(async () => (await ui(page)).view.credits).toBe(934);
  v = (await ui(page)).view;
  expect(v.levels.turnSpeed).toBe(1);
  await shot(page, testInfo, 'upgrades');
  // The 2D Upgrades screen shows the same credits (canvas text is observed, not changed)
  await page.addInitScript(() => {
    window.__drawnTexts = new Set();
    const orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
      window.__drawnTexts.add(String(text));
      return orig.call(this, text, ...rest);
    };
  });
  await item(page, 'back').click();
  await Promise.all([page.waitForURL(/[?&]2d=1/, { timeout: T }), item(page, 'switch2d').click()]);
  await page.waitForFunction(() => window.__spaceAdventure && window.__spaceAdventure.state === 'menu', null, { timeout: T });
  const upgradesRow = (await page.evaluate(() => window.__spaceAdventure.menuOptions)).indexOf('Upgrades');
  expect(upgradesRow).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < 20 && (await page.evaluate(() => window.__spaceAdventure.menuIndex)) !== upgradesRow; i++) {
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__spaceAdventure.state === 'upgrades', null, { timeout: T });
  await expect.poll(() => page.evaluate(() => [...window.__drawnTexts]), { timeout: T }).toContain('Upgrade Credits: 934');
  expect(errors).toEqual([]);
});
