// UAT on the live GitHub Pages site: the 3D game (?3d=1) as a visitor gets it.
// WebGL runs through SwiftShader on CI (slow), so waits use game state, never wall time.
import { test, expect } from '@playwright/test';

const T = 90000;
const shot = (page, testInfo, name) => page.screenshot({ path: `tests/screenshots/uat/${testInfo.project.name}-3d-${name}.png` });
const g3 = (page) => page.evaluate(() => window.__spaceAdventure.game3d);

/**
 * Open the 3D page with fresh storage (once per test, not on its own reloads). storage: more
 * localStorage entries, written after the clear in the same init script (a separate init
 * script would run in registration order, and an earlier one is wiped by the clear).
 */
async function open3dLive(page, query = '', storage = {}) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.addInitScript((entries) => {
    try {
      if (!sessionStorage.getItem('__uat3d_cleared')) {
        localStorage.clear();
        localStorage.setItem('spaceAdventure_sensor3d', 'event');
        localStorage.setItem('spaceAdventure_control3d', 'joystick');
        localStorage.setItem('spaceAdventure_offerTutorial', 'false');
        for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
        sessionStorage.setItem('__uat3d_cleared', '1');
      }
    } catch (e) { /* storage unavailable */ }
  }, storage);
  await page.goto(`./?3d=1&lowres3d=1${query}`);
  await page.waitForFunction(() => window.__spaceAdventure && window.__spaceAdventure.game3d
    && window.__spaceAdventure.game3d.loaded, null, { timeout: T });
  return errors;
}

/** Start a game: through the menus (Play as guest) when deployed, else the prototype's start button. */
async function startLive(page) {
  const g = await g3(page);
  if (g.ui) {
    await expect.poll(async () => (await g3(page)).ui.screen, { timeout: T }).toMatch(/^(profile|menu)$/);
    if ((await g3(page)).ui.screen === 'profile') await page.click('[data-u3d="guest"]');
    await page.click('[data-u3d="play"]');
  } else {
    await page.click('#p3-start');
  }
}

test('3D: loads, starts and the game advances', async ({ page }, testInfo) => {
  const errors = await open3dLive(page, '&seed3d=1');
  await shot(page, testInfo, 'menu');
  await startLive(page);
  await expect.poll(async () => (await g3(page)).screen, { timeout: T }).toBe('playing');
  const s0 = (await g3(page)).steps;
  await page.waitForFunction((t) => window.__spaceAdventure.game3d.steps >= t, s0 + 30, { timeout: T });
  await shot(page, testInfo, 'playing');
  expect(errors).toEqual([]);
});

test('3D: the radar sits on the right edge, front above rear', async ({ page }) => {
  await open3dLive(page, '&seed3d=1');
  await startLive(page);
  await expect.poll(async () => (await g3(page)).screen, { timeout: T }).toBe('playing');
  const { layout } = (await g3(page)).radar;
  const w = page.viewportSize().width;
  expect(layout.front.cx).toBeGreaterThan(w * 0.75);
  expect(layout.front.cy).toBeLessThan(layout.rear.cy);
});

test('3D: reloads offline from the service worker cache', async ({ page, context }, testInfo) => {
  const errors = await open3dLive(page);
  // First visit installs the worker and fills the cache; the next load is controlled by it
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller)), { timeout: T }).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.__spaceAdventure && window.__spaceAdventure.game3d
    && window.__spaceAdventure.game3d.loaded, null, { timeout: T });
  await shot(page, testInfo, 'offline');
  await context.setOffline(false);
  expect(errors).toEqual([]);
});

// --- Acceptance flows through the 3D menus (js/3d/ui3d.js). They skip themselves while the
// live site's 3D page has no menus yet (game3d.ui missing). The live site hides Start 3D from
// automated browsers unless ?force3d=1 (js/mode3d.js), so 2D -> 3D uses it.
//
// REQUIRED (see tests/integration/game3d.spec.js for the full list): game3d.ui (ui.snapshot()),
// game3d.screen / steps / time / over / score as today, P pauses while playing, and the
// URL option &layout3d=doom (1 life, a crystal at the ship, a red rock on a collision course:
// a quick, deterministic game over with a score above 0).

const ui = (page) => page.evaluate(() => window.__spaceAdventure.game3d.ui);
const item = (page, id) => page.locator(`[data-u3d="${id}"]`);
const uiScreen = (page) => expect.poll(async () => ((await ui(page)) || {}).screen, { timeout: T });
const gameScreen = (page) => expect.poll(async () => (await g3(page)).screen, { timeout: T });

/** The menus are live? Otherwise skip (older deploy). */
async function requireUi(page) {
  test.skip(!(await page.evaluate(() => !!window.__spaceAdventure.game3d.ui)), '3D menus (ui3d) not deployed yet');
}
/** Wait for `s` seconds of game time. The game clock stops at a game over, so that ends the wait too. */
async function gameSeconds(page, s) {
  const t0 = (await g3(page)).time;
  await page.waitForFunction((t) => window.__spaceAdventure.game3d.time >= t || window.__spaceAdventure.game3d.over,
    t0 + s, { timeout: Math.max(T, s * 8000) });
}
/**
 * Play for `s` seconds of game time in total. Flying without steering loses lives quickly
 * (incoming rocks are aimed at the ship, UFOs shoot), so a game over is expected: Play again
 * and go on counting.
 */
async function playSeconds(page, s) {
  let left = s;
  while (left > 0) {
    const t0 = (await g3(page)).time;
    await gameSeconds(page, Math.min(5, left));
    const g = await g3(page);
    left -= Math.max(0.5, g.time - t0);
    if (g.over) {
      await uiScreen(page).toBe('gameOver');
      await item(page, 'again').click();
      await gameScreen(page).toBe('playing');
    }
  }
}
/** Fresh storage, then the profile screen: Play as guest. The tutorial is off (open3dLive). */
async function asGuest(page) {
  await requireUi(page);
  await uiScreen(page).toBe('profile');
  await item(page, 'guest').click();
  await uiScreen(page).toBe('menu');
}

test('3D menus: Play as guest, 60 game seconds without page errors, pause and resume', async ({ page }, testInfo) => {
  test.setTimeout(900000); // 60 game seconds can take many minutes of SwiftShader wall time
  const errors = await open3dLive(page, '&seed3d=2');
  await asGuest(page);
  await shot(page, testInfo, 'ui-menu');
  await item(page, 'play').click();
  await gameScreen(page).toBe('playing');
  await playSeconds(page, 30);
  await page.keyboard.press('p');
  await uiScreen(page).toBe('pause');
  await gameScreen(page).toBe('paused');
  await shot(page, testInfo, 'ui-pause');
  await item(page, 'resume').click();
  await gameScreen(page).toBe('playing');
  // A game over before 60 s is fine (careless autopilot-free flying): play again and go on
  await playSeconds(page, 30);
  await shot(page, testInfo, 'ui-60s');
  expect(errors).toEqual([]);
});

test('3D menus: settings persist after a reload', async ({ page }) => {
  const errors = await open3dLive(page);
  await asGuest(page);
  await item(page, 'settings').click();
  await uiScreen(page).toBe('settings');
  await page.locator('#u3d-set-viewDistance3d button').nth(0).click(); // Far -> Normal
  await page.locator('#u3d-set-fov3d button').nth(2).click(); // 70 -> 75
  await page.reload();
  await page.waitForFunction(() => window.__spaceAdventure && window.__spaceAdventure.game3d
    && window.__spaceAdventure.game3d.loaded, null, { timeout: T });
  expect((await g3(page)).viewDistance).toBe('normal');
  const stored = await page.evaluate(() => [localStorage.getItem('spaceAdventure_viewDistance3d'), localStorage.getItem('spaceAdventure_fov3d')]);
  expect(stored).toEqual(['normal', '75']);
  expect(errors).toEqual([]);
});

test('3D menus: a game over puts the score on the 3D board, highlighted', async ({ page }, testInfo) => {
  test.setTimeout(600000);
  // A named pilot (guests keep no scores), seeded with the fresh storage
  const errors = await open3dLive(page, '&seed3d=1&layout3d=doom', {
    asteroids_currentUser: 'UATPILOT', asteroids_userList: JSON.stringify(['UATPILOT']),
  });
  await requireUi(page);
  await uiScreen(page).toBe('menu');
  await item(page, 'play').click();
  await gameScreen(page).toBe('playing');
  await expect.poll(async () => (await g3(page)).over, { timeout: T * 4 }).toBe(true);
  await uiScreen(page).toBe('gameOver');
  const over = (await ui(page)).view;
  expect(over.score).toBeGreaterThan(0);
  expect(over.newHigh).toBe(true);
  await item(page, 'highscores').click();
  await uiScreen(page).toBe('highScores');
  await expect(page.locator('#u3d tr.u3d-hl')).toContainText(String(over.score));
  await shot(page, testInfo, 'ui-highscores');
  expect(errors).toEqual([]);
});

test('3D menus offline: start a game with the network off, Switch to 2D and back', async ({ page, context }, testInfo) => {
  test.setTimeout(600000);
  const errors = await open3dLive(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller)), { timeout: T }).toBe(true);
  await page.waitForFunction(() => window.__spaceAdventure && window.__spaceAdventure.game3d
    && window.__spaceAdventure.game3d.loaded, null, { timeout: T });
  await requireUi(page);
  await context.setOffline(true);
  try {
    await page.reload();
    await page.waitForFunction(() => window.__spaceAdventure && window.__spaceAdventure.game3d
      && window.__spaceAdventure.game3d.loaded, null, { timeout: T });
    await asGuest(page);
    await item(page, 'play').click();
    await gameScreen(page).toBe('playing');
    await playSeconds(page, 3);
    await page.keyboard.press('p');
    await uiScreen(page).toBe('pause');
    await item(page, 'quit').click();
    await uiScreen(page).toBe('menu');
    // Switch to 2D, offline, from the cache
    await Promise.all([page.waitForURL(/[?&]2d=1/, { timeout: T }), item(page, 'switch2d').click()]);
    await page.waitForFunction(() => window.__spaceAdventure && typeof window.__spaceAdventure.state === 'string', null, { timeout: T });
    await shot(page, testInfo, 'ui-offline-2d');
    // ... and back: ?force3d=1 because the live site hides Start 3D from automated browsers
    await page.goto('./?force3d=1');
    await page.waitForFunction(() => window.__spaceAdventure && typeof window.__spaceAdventure.state === 'string', null, { timeout: T });
    if (await page.evaluate(() => window.__spaceAdventure.state === 'prompt_user')) {
      const input = page.locator('#username-input');
      await input.fill('UATOFF');
      await page.keyboard.press('Enter');
    }
    await page.waitForFunction(() => window.__spaceAdventure.state === 'menu', null, { timeout: T });
    expect((await page.evaluate(() => window.__spaceAdventure.menuOptions))[0]).toBe('Start 3D');
    await Promise.all([page.waitForURL(/[?&]3d=1/, { timeout: T }), page.keyboard.press('Enter')]);
    await page.waitForFunction(() => window.__spaceAdventure && window.__spaceAdventure.game3d
      && window.__spaceAdventure.game3d.loaded, null, { timeout: T });
    await uiScreen(page).toBe('menu');
    await shot(page, testInfo, 'ui-offline-3d');
  } finally {
    await context.setOffline(false);
  }
  expect(errors).toEqual([]);
});
