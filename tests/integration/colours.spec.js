// Colour-blind friendly palettes: palette setting, palette words on screen, and
// colour-blindness simulation screenshots (desktop Chromium, CDP) for human review.
import { test, expect } from '@playwright/test';
import {
  PALETTE_KEY, openFresh, hook, waitForState, loginWithKeyboard, loginWithTouch, tapMenuItem, tapAt,
  tapRegionCenter, drawnTexts, frames,
} from './helpers.js';

const WORDS = {
  standard: { collect: 'Collect smooth GREEN crystals for points!', hazard: 'Avoid spiky RED rocks - shoot them!', c: 'GREEN', h: 'RED' },
  safe: { collect: 'Collect smooth BLUE crystals for points!', hazard: 'Avoid spiky ORANGE rocks - shoot them!', c: 'BLUE', h: 'ORANGE' },
};

async function login(page, testInfo) {
  if (testInfo.project.use.hasTouch) await loginWithTouch(page, 'COLOURS');
  else await loginWithKeyboard(page, 'COLOURS');
}

async function openHelp(page, testInfo) {
  if (testInfo.project.use.hasTouch) await tapMenuItem(page, 'Help');
  else {
    const p = await tapRegionCenter(page, (await hook(page, 'menuOptions')).indexOf('Help'));
    await page.mouse.click(p.x, p.y);
  }
  await waitForState(page, 'help');
}

async function leaveHelp(page, testInfo) {
  const box = await page.locator('#gameCanvas').boundingBox();
  const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  if (testInfo.project.use.hasTouch) await tapAt(page, p);
  else await page.mouse.click(p.x, p.y);
  await waitForState(page, 'menu');
}

async function startGame(page, testInfo) {
  if (testInfo.project.use.hasTouch) await tapMenuItem(page, 'Start');
  else await page.keyboard.press('Enter');
  await waitForState(page, 'playing');
  await expect.poll(() => hook(page, 'ship.isAlive')).toBe(true);
}

test.describe('colours: palette', () => {
  test('default palette is standard; menu and Help use GREEN/RED words and shape names', async ({ page }, testInfo) => {
    const errors = await openFresh(page, { recordText: true });
    await login(page, testInfo);
    expect(await hook(page, 'palette')).toBe('standard');
    const texts = await drawnTexts(page);
    expect(texts).toContain(WORDS.standard.collect);
    expect(texts).toContain(WORDS.standard.hazard);
    await openHelp(page, testInfo);
    const help = await drawnTexts(page);
    expect(help).toContain('GREEN crystals (smooth):');
    expect(help).toContain('RED rocks (spiky, X):');
    expect(help).toContain('Aliens (purple UFOs):');
    expect(errors).toEqual([]);
  });

  test('a saved Colour-safe palette is used on load (BLUE/ORANGE words)', async ({ page }, testInfo) => {
    await openFresh(page, { recordText: true, storage: { [PALETTE_KEY]: 'safe' } });
    await login(page, testInfo);
    expect(await hook(page, 'palette')).toBe('safe');
    const texts = await drawnTexts(page);
    expect(texts).toContain(WORDS.safe.collect);
    expect(texts).toContain(WORDS.safe.hazard);
    expect(texts.some((t) => t.includes('GREEN') || t.includes('RED '))).toBe(false);
    await openHelp(page, testInfo);
    expect(await drawnTexts(page)).toContain('BLUE crystals (smooth):');
  });

  test('an invalid saved palette falls back to standard', async ({ page }, testInfo) => {
    await openFresh(page, { storage: { [PALETTE_KEY]: 'neon' } });
    await login(page, testInfo);
    expect(await hook(page, 'palette')).toBe('standard');
  });

  test('gameplay runs in the Colour-safe palette without errors', async ({ page }, testInfo) => {
    const errors = await openFresh(page, { storage: { [PALETTE_KEY]: 'safe' } });
    await login(page, testInfo);
    await startGame(page, testInfo);
    await page.waitForTimeout(1000);
    expect(await hook(page, 'loopErrors')).toBe(0);
    expect(await hook(page, 'particles')).toEqual(expect.objectContaining({ dot: expect.any(Number), shard: expect.any(Number) }));
    expect(errors).toEqual([]);
  });
});

test.describe('colours: screenshots for review', () => {
  for (const pal of ['standard', 'safe']) {
    test(`menu, settings, help and in-game (${pal})`, async ({ page }, testInfo) => {
      const name = `${testInfo.project.name}-${pal}`;
      await openFresh(page, { storage: { [PALETTE_KEY]: pal } });
      await login(page, testInfo);
      await page.screenshot({ path: `tests/screenshots/${name}-menu.png` });
      if (testInfo.project.use.hasTouch) await tapMenuItem(page, 'Settings');
      else {
        const p = await tapRegionCenter(page, (await hook(page, 'menuOptions')).indexOf('Settings'));
        await page.mouse.click(p.x, p.y);
      }
      await waitForState(page, 'settings');
      await page.screenshot({ path: `tests/screenshots/${name}-settings.png` });
      await page.keyboard.press('Escape');
      await waitForState(page, 'menu');
      await openHelp(page, testInfo);
      await page.screenshot({ path: `tests/screenshots/${name}-help.png` });
      await leaveHelp(page, testInfo);
      await startGame(page, testInfo);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `tests/screenshots/${name}-ingame.png` });
    });
  }
});

test.describe('colours: colour-blindness simulation screenshots (desktop Chromium)', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'CDP vision emulation: desktop Chromium only');
  });

  for (const pal of ['standard', 'safe']) {
    test(`menu, help and gameplay under protanopia/deuteranopia/tritanopia/achromatopsia (${pal})`, async ({ page }, testInfo) => {
      test.slow();
      await openFresh(page, { storage: { [PALETTE_KEY]: pal } });
      await loginWithKeyboard(page, 'CVD');
      const cdp = await page.context().newCDPSession(page);
      const types = ['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'];
      const shoot = async (screen) => {
        for (const type of types) {
          await cdp.send('Emulation.setEmulatedVisionDeficiency', { type });
          await frames(page, 2);
          await page.locator('#gameCanvas').screenshot({ path: `tests/screenshots/cvd-${pal}-${screen}-${type}.png` });
        }
        await cdp.send('Emulation.setEmulatedVisionDeficiency', { type: 'none' });
      };
      await shoot('menu');
      await openHelp(page, testInfo);
      await shoot('help');
      await leaveHelp(page, testInfo);
      await startGame(page, testInfo);
      await page.waitForTimeout(400);
      await shoot('ingame');
      expect(await hook(page, 'loopErrors')).toBe(0);
    });
  }
});
