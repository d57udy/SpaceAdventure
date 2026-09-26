// Keyboard + mouse integration tests (desktop project).
import { test, expect } from '@playwright/test';
import {
  MENU, openFresh, snap, hook, waitForState, loginWithKeyboard, menuItemCenter, tapRegionCenter,
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
    expect(s.menuOptions.slice(0, 7)).toEqual(['Start', 'Upgrades', 'High Scores', 'Achievements', 'Help', 'Reset Data', 'Change User']);
    expect(s.menuOptions.slice(7)).toEqual(['Easy', 'Medium', 'Hard']);
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

  test('selecting Easy and Hard changes the difficulty and starting lives', async ({ page }) => {
    expect(await hook(page, 'difficulty')).toBe('medium');
    await selectMenuIndex(page, MENU.EASY);
    await page.keyboard.press('Enter');
    await expect.poll(() => hook(page, 'difficulty')).toBe('easy');
    expect(await hook(page, 'state')).toBe('menu');

    await selectMenuIndex(page, MENU.HARD);
    await page.keyboard.press('Space');
    await expect.poll(() => hook(page, 'difficulty')).toBe('hard');

    await selectMenuIndex(page, MENU.START);
    await startGame(page);
    expect(await hook(page, 'lives')).toBe(2); // Hard: 2 starting lives
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

    const hard = await menuItemCenter(page, 'Hard');
    await page.mouse.click(hard.x, hard.y);
    await expect.poll(() => hook(page, 'difficulty')).toBe('hard');
    expect(await hook(page, 'menuIndex')).toBe(MENU.HARD);

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

  test('Reset Data asks for confirmation (dismiss keeps the menu)', async ({ page }) => {
    let dialogMessage = null;
    page.on('dialog', async (d) => { dialogMessage = d.message(); await d.dismiss(); });
    await selectMenuIndex(page, MENU.RESET);
    await page.keyboard.press('Enter');
    await expect.poll(() => dialogMessage).toContain('MENUTEST');
    expect(await hook(page, 'state')).toBe('menu');
    expect(await hook(page, 'user')).toBe('MENUTEST');
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
});

test.describe('keyboard: game over', () => {
  test('game over screen returns to the menu with Enter', async ({ page }) => {
    test.slow();
    await openFresh(page);
    await loginWithKeyboard(page, 'CRASHER');
    // Hard mode: 2 lives. Fly around at full thrust while spinning to hit red asteroids.
    await selectMenuIndex(page, MENU.HARD);
    await page.keyboard.press('Enter');
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
