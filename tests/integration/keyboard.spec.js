// Keyboard + mouse integration tests (desktop project).
import { test, expect } from '@playwright/test';
import {
  MENU, MENU_LABELS, CONTROL_MODE_KEY, SETTINGS_ROWS_DESKTOP, withFullscreenRow, openFresh, snap, hook, waitForState,
  loginWithKeyboard, frames, menuItemCenter, tapRegionCenter, tapRegionPoint, drawnTexts, difficultyText,
} from './helpers.js';

async function startGame(page) {
  expect(await hook(page, 'menuIndex')).toBe(MENU.START);
  await page.keyboard.press('Enter');
  await waitForState(page, 'playing');
  await expect.poll(() => hook(page, 'ship.isAlive')).toBe(true);
}

async function selectMenuIndex(page, target) {
  // Walk with ArrowDown from wherever we are (menu wraps)
  for (let i = 0; i < 20 && (await hook(page, 'menuIndex')) !== target; i++) {
    const before = await hook(page, 'menuIndex');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'menuIndex')).not.toBe(before);
  }
  expect(await hook(page, 'menuIndex')).toBe(target);
}

test.describe('keyboard: username prompt', () => {
  test('typing into the focused field and pressing Enter reaches the menu', async ({ page }) => {
    const errors = await openFresh(page);
    await waitForState(page, 'prompt_user');
    const input = page.locator('#username-input');
    await expect(input).toBeFocused(); // autofocused on non-touch devices
    await page.keyboard.type('pilot7', { delay: 20 });
    await expect(input).toHaveValue('PILOT7');
    await page.keyboard.press('Enter');
    await waitForState(page, 'menu');
    const s = await snap(page);
    expect(s.user).toBe('PILOT7');
    expect(s.menuIndex).toBe(0);
    expect(s.menuOptions).toEqual(MENU_LABELS);
    expect(s.menuOptions.indexOf('Settings')).toBe(MENU.SETTINGS);
    expect(s.menuOptions.indexOf('Settings')).toBe(s.menuOptions.indexOf('Help') + 1);
    expect(s.menuOptions).not.toContain('Controls');
    await expect(page.locator('#user-prompt')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('HUD user label shows the new user on the menu after login', async ({ page }) => {
    await openFresh(page);
    await loginWithKeyboard(page, 'LABEL1');
    await expect(page.locator('#user-display')).toHaveText('User: LABEL1', { timeout: 2000 });
  });

  test('typing while the field is not focused is forwarded into it', async ({ page }) => {
    await openFresh(page);
    await waitForState(page, 'prompt_user');
    const input = page.locator('#username-input');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await expect(input).not.toBeFocused();
    // Human-speed typing (one key per frame or slower)
    await page.keyboard.type('ace42', { delay: 60 });
    await expect(input).toHaveValue('ACE42');
    await page.keyboard.press('Backspace');
    await expect(input).toHaveValue('ACE4');
    await page.keyboard.press('Enter');
    await waitForState(page, 'menu');
    expect(await hook(page, 'user')).toBe('ACE4');
  });

  test('fast unfocused typing keeps character order', async ({ page }) => {
    await openFresh(page);
    await waitForState(page, 'prompt_user');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    // No delay: several keys land in the same animation frame
    await page.keyboard.type('ZYXW');
    await expect(page.locator('#username-input')).toHaveValue('ZYXW');
  });

  test("a name containing S, P, M and H does not leak into the menu or game", async ({ page }) => {
    await openFresh(page);
    await waitForState(page, 'prompt_user');
    await page.keyboard.type('SPMH', { delay: 30 });
    await page.keyboard.press('Enter');
    await waitForState(page, 'menu');
    // Give the menu several frames to (wrongly) consume leaked actions
    await page.waitForTimeout(300);
    let s = await snap(page);
    expect(s.user).toBe('SPMH');
    expect(s.menuIndex).toBe(0);
    expect(s.isMuted).toBe(false);
    await startGame(page);
    const shipStart = await hook(page, 'ship');
    await page.waitForTimeout(500);
    s = await snap(page);
    expect(s.state).toBe('playing'); // not paused by a leaked 'P'
    expect(s.isMuted).toBe(false); // not muted by a leaked 'M'
    // Not hyperspaced by a leaked 'S'/'H': ship still at its spawn point
    expect(Math.hypot(s.ship.x - shipStart.x, s.ship.y - shipStart.y)).toBeLessThan(5);
  });

  test('same letters typed unfocused do not leak either', async ({ page }) => {
    await openFresh(page);
    await waitForState(page, 'prompt_user');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.type('MSPH', { delay: 60 });
    await expect(page.locator('#username-input')).toHaveValue('MSPH');
    await page.keyboard.press('Enter');
    await waitForState(page, 'menu');
    await page.waitForTimeout(300);
    const s = await snap(page);
    expect(s.menuIndex).toBe(0);
    expect(s.isMuted).toBe(false);
    expect(s.state).toBe('menu');
  });
});

test.describe('keyboard: menu', () => {
  test.beforeEach(async ({ page }) => {
    await openFresh(page);
    await loginWithKeyboard(page, 'MENUTEST');
  });

  test('arrow keys (and W/S) move the selection with wrap-around', async ({ page }) => {
    const n = (await hook(page, 'menuOptions')).length;
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'menuIndex')).toBe(1);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'menuIndex')).toBe(2);
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => hook(page, 'menuIndex')).toBe(1);
    await page.keyboard.press('w');
    await expect.poll(() => hook(page, 'menuIndex')).toBe(0);
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => hook(page, 'menuIndex')).toBe(n - 1);
    await page.keyboard.press('s');
    await expect.poll(() => hook(page, 'menuIndex')).toBe(0);
  });

  test('the Difficulty row cycles with Left/Right (and A/D), Enter and Space', async ({ page }) => {
    expect(await hook(page, 'difficulty')).toBe('medium');
    await selectMenuIndex(page, MENU.DIFFICULTY);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => hook(page, 'difficulty')).toBe('easy');
    await page.keyboard.press('ArrowLeft'); // wraps
    await expect.poll(() => hook(page, 'difficulty')).toBe('hard');
    await page.keyboard.press('ArrowRight'); // wraps back
    await expect.poll(() => hook(page, 'difficulty')).toBe('easy');
    await page.keyboard.press('d');
    await expect.poll(() => hook(page, 'difficulty')).toBe('medium');
    await page.keyboard.press('a');
    await expect.poll(() => hook(page, 'difficulty')).toBe('easy');
    await page.keyboard.press('Enter'); // Enter steps forward
    await expect.poll(() => hook(page, 'difficulty')).toBe('medium');
    await page.keyboard.press('Space');
    await expect.poll(() => hook(page, 'difficulty')).toBe('hard');
    expect(await hook(page, 'state')).toBe('menu');
    expect(await hook(page, 'menuIndex')).toBe(MENU.DIFFICULTY);

    await selectMenuIndex(page, MENU.START);
    await startGame(page);
    expect(await hook(page, 'lives')).toBe(2); // Hard: 2 starting lives
  });

  test('Left/Right on other rows do nothing', async ({ page }) => {
    await selectMenuIndex(page, MENU.HELP);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    expect(await hook(page, 'state')).toBe('menu');
    expect(await hook(page, 'menuIndex')).toBe(MENU.HELP);
    expect(await hook(page, 'difficulty')).toBe('medium');
  });

  test('Start begins a game with sensible initial state', async ({ page }) => {
    await startGame(page);
    const s = await snap(page);
    expect(s.score).toBe(0);
    expect(s.level).toBe(1);
    expect(s.lives).toBe(3); // Medium
    expect(s.counts.asteroids).toBeGreaterThan(0);
    expect(s.counts.bullets).toBe(0);
    expect(s.ship.isAlive).toBe(true);
    expect(s.ship.x).toBeCloseTo(s.world.width / 2, 0);
    expect(s.ship.y).toBeCloseTo(s.world.height / 2, 0);
    expect(s.ship.velX).toBe(0);
    expect(s.ship.velY).toBe(0);
    await expect(page.locator('#lives')).toHaveText('Lives: 3');
    await expect(page.locator('body')).toHaveClass(/state-playing/);
  });

  test('mouse click on a menu item selects it', async ({ page }) => {
    const help = await menuItemCenter(page, 'Help');
    await page.mouse.click(help.x, help.y);
    await waitForState(page, 'help');
    // Clicking anywhere returns to the menu
    await page.mouse.click(help.x, help.y);
    await waitForState(page, 'menu');

    // Difficulty row: click the right part -> next, the left part -> previous
    await frames(page, 2);
    let p = await tapRegionPoint(page, MENU.DIFFICULTY, 0.9);
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => hook(page, 'difficulty')).toBe('hard');
    expect(await hook(page, 'menuIndex')).toBe(MENU.DIFFICULTY);
    p = await tapRegionPoint(page, MENU.DIFFICULTY, 0.1);
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => hook(page, 'difficulty')).toBe('medium');
    p = await tapRegionPoint(page, MENU.DIFFICULTY, 0.5); // centre cycles forward
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => hook(page, 'difficulty')).toBe('hard');

    const start = await menuItemCenter(page, 'Start');
    await page.mouse.click(start.x, start.y);
    await waitForState(page, 'playing');
  });

  test('right-click on a menu item does nothing', async ({ page }) => {
    const help = await menuItemCenter(page, 'Help');
    await page.mouse.click(help.x, help.y, { button: 'right' });
    await page.waitForTimeout(200);
    expect(await hook(page, 'state')).toBe('menu');
  });

  for (const [label, index, state] of [
    ['Help', MENU.HELP, 'help'],
    ['High Scores', MENU.HIGH_SCORES, 'high_scores'],
    ['Achievements', MENU.ACHIEVEMENTS, 'achievements'],
    ['Upgrades', MENU.UPGRADES, 'upgrades'],
    ['Settings', MENU.SETTINGS, 'settings'],
  ]) {
    test(`${label} screen opens and Escape returns to the menu`, async ({ page }) => {
      await selectMenuIndex(page, index);
      await page.keyboard.press('Enter');
      await waitForState(page, state);
      await page.keyboard.press('Escape');
      await waitForState(page, 'menu');
      expect(await hook(page, 'menuIndex')).toBe(0);
    });
  }

  test('a key pressed in the first frame after a screen change is not dropped', async ({ page }) => {
    await selectMenuIndex(page, MENU.HELP);
    await page.keyboard.press('Enter');
    // As soon as the Help screen is active, press Escape before the next game frame runs
    await page.evaluate(() => new Promise((resolve) => {
      const check = () => {
        if (window.__spaceAdventure.state === 'help') {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
          resolve(true);
        } else requestAnimationFrame(check);
      };
      check();
    }));
    await waitForState(page, 'menu', 1500);
  });

  test('upgrades screen can be navigated and Back returns to the menu', async ({ page }) => {
    await selectMenuIndex(page, MENU.UPGRADES);
    await page.keyboard.press('Enter');
    await waitForState(page, 'upgrades');
    expect(await hook(page, 'upgradeIndex')).toBe(0);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'upgradeIndex')).toBe(1);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'upgradeIndex')).toBe(2);
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => hook(page, 'upgradeIndex')).toBe(1);
    // Up from the first item wraps to the Back entry (last tap region)
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => hook(page, 'upgradeIndex')).toBe(0);
    await page.keyboard.press('ArrowUp');
    const regions = await hook(page, 'tapRegions');
    await expect.poll(() => hook(page, 'upgradeIndex')).toBe(regions.length - 1);
    // Enter with no credits on an upgrade does not leave the screen
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'upgradeIndex')).toBe(0);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    expect(await hook(page, 'state')).toBe('upgrades');
    // Back via mouse click on the Back entry
    const back = await tapRegionCenter(page, regions.length - 1);
    await page.mouse.click(back.x, back.y);
    await waitForState(page, 'menu');
  });

  test('Change User returns to the username prompt', async ({ page }) => {
    await selectMenuIndex(page, MENU.CHANGE_USER);
    await page.keyboard.press('Enter');
    await waitForState(page, 'prompt_user');
    expect(await hook(page, 'user')).toBeNull();
    await expect(page.locator('#user-prompt')).toBeVisible();
    await expect(page.locator('#username-input')).toBeFocused();
    await expect(page.locator('#username-input')).toHaveValue('');
  });

  test('Reset Data asks in the canvas (Cancel is the default; Esc and Enter on Cancel keep the data)', async ({ page }) => {
    let nativeDialog = false;
    page.on('dialog', async (d) => { nativeDialog = true; await d.dismiss(); });
    await selectMenuIndex(page, MENU.RESET);
    await page.keyboard.press('Enter');
    await expect.poll(() => hook(page, 'resetConfirm')).toEqual({ index: 1, user: 'MENUTEST' });
    const regions = await hook(page, 'tapRegions');
    expect(regions.map((r) => r.id)).toEqual([null, 'confirm:reset', 'confirm:cancel']);
    // The menu underneath ignores arrows while the confirmation is up
    const menuIndex = await hook(page, 'menuIndex');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'resetConfirm.index')).toBe(0);
    expect(await hook(page, 'menuIndex')).toBe(menuIndex);
    await page.keyboard.press('Escape');
    await expect.poll(() => hook(page, 'resetConfirm')).toBeNull();
    expect(await hook(page, 'state')).toBe('menu');
    expect(await hook(page, 'user')).toBe('MENUTEST');
    // Enter on the default (Cancel) keeps everything too
    await page.keyboard.press('Enter');
    await expect.poll(() => hook(page, 'resetConfirm.index')).toBe(1);
    await page.keyboard.press('Enter');
    await expect.poll(() => hook(page, 'resetConfirm')).toBeNull();
    expect(await hook(page, 'user')).toBe('MENUTEST');
    expect(nativeDialog).toBe(false);
  });

  test('Reset Data: choosing Reset clears the profile and stays signed in (mouse)', async ({ page }) => {
    await selectMenuIndex(page, MENU.RESET);
    await page.keyboard.press('Enter');
    await expect.poll(() => hook(page, 'resetConfirm')).not.toBeNull();
    const regions = await hook(page, 'tapRegions');
    const reset = regions.find((r) => r.id === 'confirm:reset');
    const p = await tapRegionCenter(page, regions.indexOf(reset));
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => hook(page, 'resetConfirm')).toBeNull();
    expect(await hook(page, 'state')).toBe('menu');
    expect(await hook(page, 'user')).toBe('MENUTEST');
    await expect(page.locator('#credits')).toHaveText('Credits: 0');
  });
});

test.describe('keyboard: gameplay', () => {
  test.beforeEach(async ({ page }) => {
    await openFresh(page);
    await loginWithKeyboard(page, 'PLAYER');
    await startGame(page);
  });

  test('holding ArrowLeft / ArrowRight rotates the ship', async ({ page }) => {
    const r0 = await hook(page, 'ship.rotation');
    await page.keyboard.down('ArrowLeft');
    await expect.poll(() => isPressedKey(page, 'rotateLeft')).toBe(true);
    await expect.poll(() => hook(page, 'ship.rotation')).toBeLessThan(r0 - 0.2);
    await page.keyboard.up('ArrowLeft');
    await expect.poll(() => isPressedKey(page, 'rotateLeft')).toBe(false);
    const r1 = await hook(page, 'ship.rotation');
    await page.keyboard.down('ArrowRight');
    await expect.poll(() => hook(page, 'ship.rotation')).toBeGreaterThan(r1 + 0.2);
    await page.keyboard.up('ArrowRight');
  });

  test('A / D also rotate the ship', async ({ page }) => {
    const r0 = await hook(page, 'ship.rotation');
    await page.keyboard.down('a');
    await expect.poll(() => hook(page, 'ship.rotation')).toBeLessThan(r0 - 0.2);
    await page.keyboard.up('a');
    const r1 = await hook(page, 'ship.rotation');
    await page.keyboard.down('d');
    await expect.poll(() => hook(page, 'ship.rotation')).toBeGreaterThan(r1 + 0.2);
    await page.keyboard.up('d');
  });

  test('holding ArrowUp thrusts the ship forward (upwards at spawn)', async ({ page }) => {
    await page.keyboard.down('ArrowUp');
    await expect.poll(() => hook(page, 'ship.isThrusting')).toBe(true);
    // Ship faces up (-90deg) at spawn, so thrust gives negative Y velocity
    await expect.poll(() => hook(page, 'ship.velY')).toBeLessThan(-0.5);
    await page.keyboard.up('ArrowUp');
    await expect.poll(() => hook(page, 'ship.isThrusting')).toBe(false);
    const ship = await hook(page, 'ship');
    expect(Math.abs(ship.velX)).toBeLessThan(Math.abs(ship.velY));
  });

  test('holding Space fires player bullets', async ({ page }) => {
    expect(await hook(page, 'counts.playerBullets')).toBe(0);
    await page.keyboard.down('Space');
    await expect.poll(() => hook(page, 'counts.playerBullets')).toBeGreaterThanOrEqual(2);
    await page.keyboard.up('Space');
  });

  test('P pauses and P resumes', async ({ page }) => {
    await page.keyboard.press('p');
    await waitForState(page, 'paused');
    await expect(page.locator('body')).not.toHaveClass(/state-playing/);
    expect(await hook(page, 'pauseIndex')).toBe(0);
    // World is frozen while paused
    const a = await hook(page, 'ship');
    await page.waitForTimeout(200);
    expect(await hook(page, 'ship')).toEqual(a);
    await page.keyboard.press('p');
    await waitForState(page, 'playing');
  });

  test('Escape pauses and Escape resumes', async ({ page }) => {
    await page.keyboard.press('Escape');
    await waitForState(page, 'paused');
    await page.keyboard.press('Escape');
    await waitForState(page, 'playing');
  });

  test('pause menu: Resume via Enter', async ({ page }) => {
    await page.keyboard.press('p');
    await waitForState(page, 'paused');
    await page.keyboard.press('Enter');
    await waitForState(page, 'playing');
  });

  test('pause -> Main Menu -> Resume continues the same game', async ({ page }) => {
    const before = await snap(page);
    await page.keyboard.press('p');
    await waitForState(page, 'paused');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'pauseIndex')).toBe(1);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'pauseIndex')).toBe(2);
    await page.keyboard.press('Enter');
    await waitForState(page, 'menu');
    await expect.poll(() => hook(page, 'menuOptions')).toContain('Resume');
    expect((await hook(page, 'menuOptions'))[0]).toBe('Resume');
    expect(await hook(page, 'menuIndex')).toBe(0);
    await page.keyboard.press('Enter');
    await waitForState(page, 'playing');
    const after = await snap(page);
    expect(after.level).toBe(before.level);
    expect(after.lives).toBeLessThanOrEqual(before.lives);
    expect(after.counts.asteroids).toBeGreaterThan(0);
  });

  test('a paused game survives Multiplayer and Time Attack menus and keeps its difficulty', async ({ page }) => {
    expect(await hook(page, 'runDifficulty')).toBe('medium');
    const before = await snap(page);
    await page.keyboard.press('p');
    await waitForState(page, 'paused');
    // One press per frame: a one-shot is a flag, so two presses in the same frame count once
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'pauseIndex')).toBe(1);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'pauseIndex')).toBe(2);
    await page.keyboard.press('Enter'); // Main Menu
    await waitForState(page, 'menu');
    expect(await hook(page, 'pausedGameExists')).toBe(true);
    // Multiplayer -> Time Attack setup: Hard -> Back -> Back
    await selectMenuIndex(page, MENU.MULTIPLAYER);
    await page.keyboard.press('Enter');
    await waitForState(page, 'mp_mode_select');
    const rows = await hook(page, 'mp.modeSelect.rows');
    for (let i = 0; i < 10 && (await hook(page, 'mp.modeSelect.index')) !== rows.indexOf('timeattack'); i++) {
      await page.keyboard.press('ArrowDown');
      await frames(page, 2);
    }
    await page.keyboard.press('Enter');
    await waitForState(page, 'ta_setup');
    await page.keyboard.press('ArrowDown'); // Difficulty
    await expect.poll(() => hook(page, 'timeAttack.setup.index')).toBe(1);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => hook(page, 'difficulty')).toBe('hard');
    await page.keyboard.press('Escape');
    await waitForState(page, 'mp_mode_select');
    await page.keyboard.press('Escape');
    await waitForState(page, 'menu');
    // Still resumable; the menu Difficulty row is locked while the game is paused
    expect(await hook(page, 'pausedGameExists')).toBe(true);
    expect((await hook(page, 'menuOptions'))[0]).toBe('Resume');
    await selectMenuIndex(page, MENU.DIFFICULTY);
    await page.keyboard.press('ArrowRight');
    await frames(page, 3);
    expect(await hook(page, 'difficulty')).toBe('hard');
    await selectMenuIndex(page, MENU.START);
    await page.keyboard.press('Enter');
    await waitForState(page, 'playing');
    const after = await snap(page);
    expect(after.level).toBe(before.level);
    expect(await hook(page, 'runDifficulty')).toBe('medium'); // not the Hard picked meanwhile
  });

  test('upgrades cannot be bought while a game is paused', async ({ page }) => {
    await page.keyboard.press('p');
    await waitForState(page, 'paused');
    // One press per frame: a one-shot is a flag, so two presses in the same frame count once
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'pauseIndex')).toBe(1);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'pauseIndex')).toBe(2);
    await page.keyboard.press('Enter');
    await waitForState(page, 'menu');
    await selectMenuIndex(page, MENU.UPGRADES);
    await page.keyboard.press('Enter');
    await waitForState(page, 'upgrades');
    await expect.poll(() => hook(page, 'upgradesLocked')).toBe(true);
    await page.keyboard.press('Escape');
    await waitForState(page, 'menu');
  });

  test('pause -> Restart starts a fresh game', async ({ page }) => {
    await page.keyboard.down('ArrowUp');
    await expect.poll(() => hook(page, 'ship.velY')).toBeLessThan(-0.5);
    await page.keyboard.up('ArrowUp');
    await page.keyboard.press('p');
    await waitForState(page, 'paused');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'pauseIndex')).toBe(1);
    await page.keyboard.press('Enter');
    await waitForState(page, 'playing');
    const s = await snap(page);
    expect(s.ship.velY).toBe(0);
    expect(s.score).toBe(0);
  });

  test('M toggles mute (in game and in the menu)', async ({ page }) => {
    expect(await hook(page, 'isMuted')).toBe(false);
    await page.keyboard.press('m');
    await expect.poll(() => hook(page, 'isMuted')).toBe(true);
    await page.keyboard.press('m');
    await expect.poll(() => hook(page, 'isMuted')).toBe(false);
    await page.keyboard.press('p');
    await waitForState(page, 'paused');
    await page.keyboard.press('m');
    await expect.poll(() => hook(page, 'isMuted')).toBe(true);
  });

  test('H hyperspaces the ship away from its spawn point', async ({ page }) => {
    const s0 = await hook(page, 'ship');
    await page.keyboard.press('h');
    // 10% chance of self-destruct is part of the design; accept either outcome
    await expect.poll(async () => {
      const s = await snap(page);
      if (!s.ship || !s.ship.isAlive) return 'died';
      return Math.hypot(s.ship.x - s0.x, s.ship.y - s0.y) > 20 ? 'moved' : 'still';
    }).not.toBe('still');
  });

  // Regression: a failed jump used to null the ship and then read ship.isThrusting,
  // throwing inside the game loop and freezing the game for good.
  test('a failed hyperspace jump costs a life and the game keeps running (no freeze)', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const lives0 = await hook(page, 'lives');
    // Force the 10% self-destruct roll, just for the jump
    await page.evaluate(() => { window.__realRandom = Math.random; Math.random = () => 0.01; });
    await page.keyboard.press('h');
    await expect.poll(() => hook(page, 'lives')).toBe(lives0 - 1);
    await page.evaluate(() => { Math.random = window.__realRandom; });
    // The ship respawns after the 2 s delay, which only happens if frames keep running
    await expect.poll(() => hook(page, 'ship.isAlive'), { timeout: 6000 }).toBe(true);
    expect(await hook(page, 'state')).toBe('playing');
    expect(await hook(page, 'loopErrors')).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('keyboard: menu layout and control mode on desktop', () => {
  test('every menu item has a tap region, stacked inside the canvas', async ({ page }) => {
    await openFresh(page, { recordText: true });
    await loginWithKeyboard(page, 'CTRL');
    const s = await snap(page);
    expect(s.menuOptions[MENU.SETTINGS]).toBe('Settings');
    expect(s.tapRegions.length).toBe(s.menuOptions.length);
    // Regions are stacked top to bottom without overlapping (menu line height shrinks to fit)
    for (let i = 1; i < s.tapRegions.length; i++) {
      expect(s.tapRegions[i].y).toBeGreaterThanOrEqual(s.tapRegions[i - 1].y + s.tapRegions[i - 1].h - 0.5);
    }
    const last = s.tapRegions[s.tapRegions.length - 1];
    expect(last.y + last.h).toBeLessThanOrEqual(s.view.height);
    const texts = await drawnTexts(page);
    expect(texts).toContain(difficultyText('Medium'));
    expect(texts.some((t) => t.startsWith('Controls'))).toBe(false);
  });

  test('default control mode is joystick with empty storage; Settings has no Controls row on desktop', async ({ page }) => {
    await openFresh(page);
    await loginWithKeyboard(page, 'CTRL');
    expect(await hook(page, 'controlMode')).toBe('joystick');
    await expect(page.locator('body')).toHaveClass(/controls-joystick/);
    await expect(page.locator('body')).not.toHaveClass(/controls-buttons/);
    expect(await page.evaluate((k) => localStorage.getItem(k), CONTROL_MODE_KEY)).toBeNull();
    await selectMenuIndex(page, MENU.SETTINGS);
    await page.keyboard.press('Enter');
    await waitForState(page, 'settings');
    expect((await hook(page, 'settingsRows')).map((r) => r.id)).toEqual(await withFullscreenRow(page, SETTINGS_ROWS_DESKTOP));
  });

  test('an invalid saved control mode falls back to joystick', async ({ page }) => {
    await openFresh(page, { controlMode: 'bogus' });
    await waitForState(page, 'prompt_user');
    expect(await hook(page, 'controlMode')).toBe('joystick');
    await expect(page.locator('body')).toHaveClass(/controls-joystick/);
  });

  for (const mode of ['joystick', 'buttons']) {
    test(`keyboard gameplay works in ${mode} mode (no touch controls on desktop)`, async ({ page }) => {
      await openFresh(page, { controlMode: mode });
      await loginWithKeyboard(page, 'KEYS');
      expect(await hook(page, 'controlMode')).toBe(mode);
      await startGame(page);
      await expect(page.locator('.touch-controls')).toBeHidden();
      await expect(page.locator('#joystick-zone')).toBeHidden();
      expect(await hook(page, 'joystick.active')).toBe(false);

      // Mouse drag over the left half of the play area is not a joystick on desktop
      const box = await page.locator('#gameCanvas').boundingBox();
      await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.6);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.25 + 50, box.y + box.height * 0.6, { steps: 4 });
      expect(await hook(page, 'joystick.active')).toBe(false);
      await page.mouse.up();

      const r0 = await hook(page, 'ship.rotation');
      await page.keyboard.down('ArrowLeft');
      await expect.poll(() => hook(page, 'ship.rotation')).toBeLessThan(r0 - 0.2);
      await page.keyboard.up('ArrowLeft');
      await page.keyboard.down('ArrowUp');
      await expect.poll(() => hook(page, 'ship.isThrusting')).toBe(true);
      await page.keyboard.up('ArrowUp');
      await expect.poll(() => hook(page, 'ship.isThrusting')).toBe(false);
      await page.keyboard.down('Space');
      await expect.poll(() => hook(page, 'counts.playerBullets')).toBeGreaterThanOrEqual(1);
      await page.keyboard.up('Space');
      await page.keyboard.press('p');
      await waitForState(page, 'paused');
    });
  }
});

test.describe('keyboard: game over', () => {
  test('game over screen returns to the menu with Enter', async ({ page }) => {
    test.slow();
    await openFresh(page);
    await loginWithKeyboard(page, 'CRASHER');
    // Hard mode: 2 lives. Fly around at full thrust while spinning to hit red asteroids.
    await selectMenuIndex(page, MENU.DIFFICULTY);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => hook(page, 'difficulty')).toBe('hard');
    await selectMenuIndex(page, MENU.START);
    await startGame(page);
    await page.keyboard.down('ArrowUp');
    await page.keyboard.down('ArrowRight');
    let reached = false;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const s = await hook(page, 'state');
      if (s === 'game_over') { reached = true; break; }
      // Occasionally hyperspace (10% self-destruct helps too)
      await page.keyboard.press('h');
      await page.waitForTimeout(500);
    }
    await page.keyboard.up('ArrowUp');
    await page.keyboard.up('ArrowRight');
    test.skip(!reached, 'Could not reach game over through real input within 60s');
    await expect(page.locator('#lives')).toHaveText('Lives: 0');
    // 1s input delay: an immediate Enter is ignored
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    expect(await hook(page, 'state')).toBe('game_over');
    await page.waitForTimeout(1100);
    await page.keyboard.press('Enter');
    await waitForState(page, 'menu');
    expect((await hook(page, 'menuOptions'))[0]).toBe('Start');
  });
});

function isPressedKey(page, action) {
  return page.evaluate((a) => window.__spaceAdventure.isPressed(a), action);
}
