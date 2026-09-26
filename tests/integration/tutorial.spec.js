// First-game tutorial (Item 5): the ask-first dialog, the training wave, skip and replay.
// openFresh({ tutorial: true }) keeps the real "Offer tutorial" setting at its default (On).
import { test, expect } from '@playwright/test';
import {
  MENU, PAD, OFFER_TUTORIAL_KEY, openFresh, hook, frames, waitForState, loginWithKeyboard, loginWithTouch,
  tapMenuItem, tapAt, tapRegionCenter, drawnTexts, settingsRowIndex, Fingers, centerOf,
  padTap, padPress, padRelease,
} from './helpers.js';

const TUTORIAL_KEY = (user) => `asteroids_tutorial_${user}`;

async function selectMenuIndex(page, target) {
  for (let i = 0; i < 20 && (await hook(page, 'menuIndex')) !== target; i++) {
    const before = await hook(page, 'menuIndex');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'menuIndex')).not.toBe(before);
  }
  expect(await hook(page, 'menuIndex')).toBe(target);
}

async function selectSettingsRow(page, id) {
  const target = await settingsRowIndex(page, id);
  for (let i = 0; i < 14 && (await hook(page, 'settingsIndex')) !== target; i++) {
    const before = await hook(page, 'settingsIndex');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'settingsIndex')).not.toBe(before);
  }
  expect(await hook(page, 'settingsIndex')).toBe(target);
  return target;
}

/** Pause-menu row by index (one key press per frame, so presses don't merge). */
async function choosePause(page, target) {
  for (let i = 0; i < 6 && (await hook(page, 'pauseIndex')) !== target; i++) {
    const before = await hook(page, 'pauseIndex');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'pauseIndex')).not.toBe(before);
  }
  expect(await hook(page, 'pauseIndex')).toBe(target);
  await page.keyboard.press('Enter');
}

async function reloadToMenu(page) {
  await page.reload();
  await page.waitForFunction(() => window.__spaceAdventure && window.__spaceAdventure.state === 'menu');
  await frames(page, 2);
}

/** Menu Start (Enter) -> the ask dialog. */
async function startToAsk(page) {
  await selectMenuIndex(page, MENU.START);
  await page.keyboard.press('Enter');
  await waitForState(page, 'tutorial_ask');
}

async function startTraining(page) {
  await startToAsk(page);
  await page.keyboard.press('Enter'); // "Play the tutorial" is preselected
  await waitForState(page, 'playing');
  await expect.poll(() => hook(page, 'tutorial.active')).toBe(true);
}

const angleDiff = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/** Shortest (wrapped) vector from the ship to the tutorial target, or null. */
async function toTarget(page) {
  return page.evaluate(() => {
    const g = window.__spaceAdventure;
    const t = g.tutorial.target;
    const s = g.ship;
    if (!t || !s || !s.isAlive) return null;
    const { width, height } = g.world;
    let dx = t.x - s.x;
    let dy = t.y - s.y;
    if (dx > width / 2) dx -= width; else if (dx < -width / 2) dx += width;
    if (dy > height / 2) dy -= height; else if (dy < -height / 2) dy += height;
    return { dx, dy, rotation: s.rotation, speed: Math.hypot(s.velX, s.velY), velX: s.velX, velY: s.velY, type: t.type };
  });
}

/** Turn toward an angle with a short key hold; true when already within tolerance. */
async function turnToward(page, rotation, angle, tolerance) {
  const diff = angleDiff(rotation, angle);
  if (Math.abs(diff) <= tolerance) return true;
  const key = diff > 0 ? 'ArrowRight' : 'ArrowLeft';
  await page.keyboard.down(key);
  await page.waitForTimeout(Math.max(16, Math.min(150, (Math.abs(diff) / (2 * Math.PI)) * 1000)));
  await page.keyboard.up(key);
  return false;
}

/** Turn toward the target; true when roughly facing it. */
async function aim(page, tolerance) {
  const v = await toTarget(page);
  if (!v) return false;
  return turnToward(page, v.rotation, Math.atan2(v.dy, v.dx), tolerance);
}

/**
 * Fly into the target without orbiting it: steer the velocity, not the nose. The wanted
 * velocity points at the target at a modest speed; thrust along (wanted - current).
 */
async function flyInto(page) {
  const v = await toTarget(page);
  if (!v) { await page.waitForTimeout(60); return; }
  const dist = Math.hypot(v.dx, v.dy) || 1;
  const speed = 110;
  const ex = (v.dx / dist) * speed - v.velX;
  const ey = (v.dy / dist) * speed - v.velY;
  if (Math.hypot(ex, ey) < 25) { await page.waitForTimeout(60); return; }
  if (await turnToward(page, v.rotation, Math.atan2(ey, ex), 0.25)) {
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(Math.min(150, Math.hypot(ex, ey) * 2));
    await page.keyboard.up('ArrowUp');
  }
}

/**
 * Play the whole training wave with the keyboard. Records the lowest lives value and the
 * most UFOs/power-ups seen, and optionally rams the red target once before shooting it.
 */
async function playTrainingWithKeyboard(page, { ramRed = false, onStep = null } = {}) {
  const seen = { minLives: Infinity, maxUfos: 0, maxPowerUps: 0, rammed: false, steps: [] };
  const record = async () => {
    const g = await page.evaluate(() => {
      const h = window.__spaceAdventure;
      return { lives: h.lives, counts: h.counts, step: h.tutorial.step, active: h.tutorial.active };
    });
    seen.minLives = Math.min(seen.minLives, g.lives);
    seen.maxUfos = Math.max(seen.maxUfos, g.counts.ufos);
    seen.maxPowerUps = Math.max(seen.maxPowerUps, g.counts.powerUps);
    if (g.step && seen.steps[seen.steps.length - 1] !== g.step) {
      seen.steps.push(g.step);
      if (onStep) await onStep(g.step);
    }
    return g;
  };
  const deadline = Date.now() + 75000;
  let g = await record();
  while (g.active && Date.now() < deadline) {
    switch (g.step) {
      case 'steer':
        await page.keyboard.down('ArrowLeft');
        await page.waitForTimeout(150);
        await page.keyboard.up('ArrowLeft');
        break;
      case 'thrust':
        await page.keyboard.down('ArrowUp');
        await page.waitForTimeout(250);
        await page.keyboard.up('ArrowUp');
        break;
      case 'collect':
        await flyInto(page);
        break;
      case 'shoot': {
        if (ramRed && !seen.rammed) {
          if (seen.respawnsBefore === undefined) seen.respawnsBefore = await hook(page, 'tutorial.respawns');
          await flyInto(page);
          // Crashed: respawned at once, no life lost
          if ((await hook(page, 'tutorial.respawns')) > seen.respawnsBefore) seen.rammed = true;
          break;
        }
        if (await aim(page, 0.06)) {
          await page.keyboard.press('Space');
          await page.waitForTimeout(120);
        }
        break;
      }
      case 'avoid':
        await page.keyboard.press('Space'); // fire/select continues
        await page.waitForTimeout(100);
        break;
      default:
        await page.waitForTimeout(100);
    }
    g = await record();
  }
  return seen;
}

// --- Ask first ----------------------------------------------------------------

test.describe('tutorial: ask first (keyboard)', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!!testInfo.project.use.hasTouch, 'keyboard tutorial tests run on the desktop project');
  });

  test('first Start asks; Esc skips to Level 1 and the answer is remembered', async ({ page }) => {
    const errors = await openFresh(page, { tutorial: true, recordText: true });
    await loginWithKeyboard(page, 'NEWBIE');
    expect(await hook(page, 'tutorial')).toMatchObject({ active: false, asked: false, done: false });
    await startToAsk(page);
    const texts = await drawnTexts(page);
    expect(texts).toContain('First time?');
    expect(texts).toContain('Play the tutorial');
    expect(texts).toContain('Skip');
    expect((await hook(page, 'tapRegions')).length).toBe(2);
    await page.keyboard.press('Escape');
    await waitForState(page, 'playing');
    expect(await hook(page, 'tutorial.active')).toBe(false);
    expect(await hook(page, 'level')).toBe(1);
    await expect(page.locator('#level')).toHaveText('Level: 1');
    expect(await hook(page, 'tutorial.asked')).toBe(true);
    // Reload: Start goes straight to the game
    await reloadToMenu(page);
    await page.keyboard.press('Enter');
    await waitForState(page, 'playing');
    expect(await hook(page, 'tutorial.active')).toBe(false);
    expect(errors).toEqual([]);
  });

  test('"Play the tutorial" starts Training; the answer is remembered too', async ({ page }) => {
    await openFresh(page, { tutorial: true });
    await loginWithKeyboard(page, 'LEARNER');
    await startToAsk(page);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'tutorial.askIndex')).toBe(1);
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => hook(page, 'tutorial.askIndex')).toBe(0);
    await page.keyboard.press('Enter');
    await waitForState(page, 'playing');
    const t = await hook(page, 'tutorial');
    expect(t).toMatchObject({ active: true, step: 'steer', inputKind: 'keyboard', asked: true, done: false });
    expect(await hook(page, 'level')).toBe(0);
    await expect(page.locator('#level')).toHaveText('Level: Training');
    expect(await hook(page, 'counts.asteroids')).toBe(0);
    expect(await hook(page, 'musicMood')).toBe('calm');
    await reloadToMenu(page);
    await page.keyboard.press('Enter');
    await waitForState(page, 'playing');
    expect(await hook(page, 'tutorial.active')).toBe(false);
    expect(await hook(page, 'level')).toBe(1);
  });

  test('"Offer tutorial: Off" in Settings means no question', async ({ page }) => {
    await openFresh(page, { tutorial: true });
    await loginWithKeyboard(page, 'NOASK');
    await selectMenuIndex(page, MENU.SETTINGS);
    await page.keyboard.press('Enter');
    await waitForState(page, 'settings');
    const index = await selectSettingsRow(page, 'offerTutorial');
    expect((await hook(page, 'settingsRows'))[index]).toMatchObject({ label: 'Offer tutorial', value: 'On' });
    await page.keyboard.press('Enter');
    await expect.poll(() => hook(page, 'settings.offerTutorial')).toBe(false);
    expect(await page.evaluate((k) => localStorage.getItem(k), OFFER_TUTORIAL_KEY)).toBe('false');
    await page.keyboard.press('Escape');
    await waitForState(page, 'menu');
    await page.keyboard.press('Enter');
    await waitForState(page, 'playing');
    expect(await hook(page, 'tutorial.active')).toBe(false);
  });

  test('controller: Ⓑ skips and Ⓐ plays in the dialog; View skips training', async ({ page }) => {
    await openFresh(page, { tutorial: true, gamepads: [{}], recordText: true });
    await loginWithKeyboard(page, 'PADASK');
    await startToAsk(page);
    await padTap(page, PAD.X); // connect
    expect((await drawnTexts(page)).some((t) => t.includes('Ⓐ Play the tutorial') && t.includes('Ⓑ Skip'))).toBe(true);
    await padTap(page, PAD.A);
    await waitForState(page, 'playing');
    await expect.poll(() => hook(page, 'tutorial.inputKind')).toBe('gamepad');
    expect(await hook(page, 'counts.playerBullets')).toBe(0); // the Ⓐ didn't fire
    const texts = await drawnTexts(page);
    expect(texts).toContain('Tilt the left stick to steer');
    await padTap(page, PAD.VIEW);
    await expect.poll(() => hook(page, 'tutorial.active')).toBe(false);
    expect(await hook(page, 'level')).toBe(1);
    expect(await hook(page, 'tutorial')).toMatchObject({ done: true, skipped: true });
    // Second user: Ⓑ on the dialog skips
    await page.keyboard.press('p');
    await waitForState(page, 'paused');
    await choosePause(page, 2);
    await waitForState(page, 'menu');
    await selectMenuIndex(page, MENU.CHANGE_USER);
    await page.keyboard.press('Enter');
    await loginWithKeyboard(page, 'PADASK2');
    await startToAsk(page);
    await padPress(page, PAD.B);
    await waitForState(page, 'playing');
    await padRelease(page, PAD.B);
    expect(await hook(page, 'tutorial.active')).toBe(false);
    expect(await hook(page, 'tutorial.asked')).toBe(true);
  });
});

// --- Training run-through, skip, replay ------------------------------------------

test.describe('tutorial: training (keyboard)', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!!testInfo.project.use.hasTouch, 'keyboard tutorial tests run on the desktop project');
  });

  test('full keyboard run-through ends at Level 1 with score 0; no UFOs or lives lost', async ({ page }, testInfo) => {
    test.slow();
    const errors = await openFresh(page, { tutorial: true, recordText: true });
    await loginWithKeyboard(page, 'PILOT');
    const creditsBefore = await page.locator('#credits').textContent();
    await startTraining(page);
    const livesAtStart = await hook(page, 'lives');
    const texts = await drawnTexts(page);
    expect(texts).toContain('TRAINING');
    expect(texts).toContain('Steer');
    expect(texts).toContain('Turn with ← → (or A / D)');
    expect(texts).toContain('Skip ▸');
    await page.screenshot({ path: `tests/screenshots/${testInfo.project.name}-tutorial-steer.png` });

    const seen = await playTrainingWithKeyboard(page, {
      ramRed: true,
      onStep: async (step) => {
        if (step === 'collect' || step === 'shoot') {
          await frames(page, 3);
          await page.screenshot({ path: `tests/screenshots/${testInfo.project.name}-tutorial-${step}.png` });
        }
      },
    });
    expect(seen.steps).toEqual(['steer', 'thrust', 'collect', 'shoot', 'avoid', 'done']);
    expect(seen.rammed).toBe(true);
    expect(seen.minLives).toBe(livesAtStart);
    expect(seen.maxUfos).toBe(0);
    expect(seen.maxPowerUps).toBe(0);

    await expect.poll(() => hook(page, 'tutorial.active')).toBe(false);
    expect(await hook(page, 'state')).toBe('playing');
    expect(await hook(page, 'level')).toBe(1);
    expect(await hook(page, 'score')).toBe(0);
    expect(await hook(page, 'lives')).toBe(livesAtStart);
    expect(await hook(page, 'counts.asteroids')).toBe(10); // a normal Level 1
    expect(await hook(page, 'tutorial')).toMatchObject({ done: true, skipped: false });
    await expect(page.locator('#level')).toHaveText('Level: 1');
    await expect(page.locator('#credits')).toHaveText(creditsBefore); // no credits in training
    const stored = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), TUTORIAL_KEY('PILOT')));
    expect(stored).toMatchObject({ done: true, skipped: false, version: 1 });
    expect(errors).toEqual([]);
  });

  test('Enter skips training into Level 1; no tutorial after reload', async ({ page }) => {
    await openFresh(page, { tutorial: true });
    await loginWithKeyboard(page, 'SKIPPER');
    await startTraining(page);
    await page.keyboard.press('Enter');
    await expect.poll(() => hook(page, 'tutorial.active')).toBe(false);
    expect(await hook(page, 'level')).toBe(1);
    expect(await hook(page, 'score')).toBe(0);
    expect(await hook(page, 'tutorial')).toMatchObject({ done: true, skipped: true });
    await expect(page.locator('#level')).toHaveText('Level: 1');
    await reloadToMenu(page);
    await page.keyboard.press('Enter');
    await waitForState(page, 'playing');
    expect(await hook(page, 'tutorial.active')).toBe(false);
  });

  test('pause menu has "Skip Tutorial" during training only', async ({ page }) => {
    await openFresh(page, { tutorial: true });
    await loginWithKeyboard(page, 'PAUSER');
    await startTraining(page);
    await page.keyboard.press('p');
    await waitForState(page, 'paused');
    expect(await hook(page, 'pauseOptions')).toEqual(['Resume', 'Restart', 'Main Menu', 'Skip Tutorial']);
    // Restart keeps training
    await choosePause(page, 1);
    await waitForState(page, 'playing');
    expect(await hook(page, 'tutorial')).toMatchObject({ active: true, step: 'steer' });
    await page.keyboard.press('p');
    await waitForState(page, 'paused');
    await choosePause(page, 3);
    await waitForState(page, 'playing');
    expect(await hook(page, 'tutorial.active')).toBe(false);
    expect(await hook(page, 'level')).toBe(1);
    await page.keyboard.press('p');
    await waitForState(page, 'paused');
    expect(await hook(page, 'pauseOptions')).toEqual(['Resume', 'Restart', 'Main Menu']);
  });

  test('Reset Data brings the question back', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await openFresh(page, { tutorial: true });
    await loginWithKeyboard(page, 'RESETME');
    await startToAsk(page);
    await page.keyboard.press('Escape');
    await waitForState(page, 'playing');
    expect(await hook(page, 'tutorial.asked')).toBe(true);
    await reloadToMenu(page);
    await selectMenuIndex(page, MENU.RESET);
    await page.keyboard.press('Enter');
    await expect.poll(() => hook(page, 'tutorial.asked')).toBe(false);
    expect(await page.evaluate((k) => localStorage.getItem(k), TUTORIAL_KEY('RESETME'))).toBeNull();
    await selectMenuIndex(page, MENU.START);
    await page.keyboard.press('Enter');
    await waitForState(page, 'tutorial_ask');
  });

  test('Help: T replays the tutorial (also after it was done); Settings has "Replay tutorial"', async ({ page }) => {
    await openFresh(page, { tutorial: true, recordText: true });
    await loginWithKeyboard(page, 'REPLAYER');
    await startTraining(page);
    await page.keyboard.press('Enter'); // skip -> done
    await expect.poll(() => hook(page, 'tutorial.done')).toBe(true);
    await page.keyboard.press('p');
    await waitForState(page, 'paused');
    await choosePause(page, 2);
    await waitForState(page, 'menu');
    await selectMenuIndex(page, MENU.HELP);
    await page.keyboard.press('Enter');
    await waitForState(page, 'help');
    expect(await drawnTexts(page)).toContain('▶ Replay tutorial (T)');
    await page.keyboard.press('t');
    await waitForState(page, 'playing');
    expect(await hook(page, 'tutorial')).toMatchObject({ active: true, step: 'steer' });
    // Help's replay button is a tap region too (desktop: mouse click)
    await page.keyboard.press('Escape');
    await waitForState(page, 'paused');
    await choosePause(page, 2);
    await waitForState(page, 'menu');
    await selectMenuIndex(page, MENU.HELP);
    await page.keyboard.press('Enter');
    await waitForState(page, 'help');
    const regions = await hook(page, 'tapRegions');
    expect(regions.length).toBe(2);
    const p = await tapRegionCenter(page, 1);
    await page.mouse.click(p.x, p.y);
    await waitForState(page, 'playing');
    expect(await hook(page, 'tutorial.active')).toBe(true);
    // Settings row
    await page.keyboard.press('Escape');
    await waitForState(page, 'paused');
    await choosePause(page, 2);
    await waitForState(page, 'menu');
    await selectMenuIndex(page, MENU.SETTINGS);
    await page.keyboard.press('Enter');
    await waitForState(page, 'settings');
    await selectSettingsRow(page, 'replayTutorial');
    await page.keyboard.press('Enter');
    await waitForState(page, 'playing');
    expect(await hook(page, 'tutorial')).toMatchObject({ active: true, step: 'steer' });
  });
});

// --- Touch ------------------------------------------------------------------------

async function touchTraining(page, { controlMode = 'joystick' } = {}) {
  const errors = await openFresh(page, { tutorial: true, controlMode, recordText: true });
  await loginWithTouch(page, controlMode === 'joystick' ? 'STICKY' : 'BUTTONY');
  await tapMenuItem(page, 'Start');
  await waitForState(page, 'tutorial_ask');
  await tapAt(page, await tapRegionCenter(page, 0)); // "Play the tutorial"
  await waitForState(page, 'playing');
  await expect.poll(() => hook(page, 'tutorial.active')).toBe(true);
  return errors;
}

const animationName = (page, selector) =>
  page.locator(selector).evaluate((el) => getComputedStyle(el).animationName);

test.describe('tutorial: touch', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, 'touch tutorial tests run on the tablet projects');
  });

  test('drag to steer: the stick pulses in step 1 and a drag advances', async ({ page, browserName }, testInfo) => {
    const errors = await touchTraining(page);
    expect(await hook(page, 'tutorial')).toMatchObject({ step: 'steer', inputKind: 'joystick' });
    const body = page.locator('body');
    await expect(body).toHaveClass(/tutorial-step-steer/);
    await expect(body).toHaveClass(/tutorial-joystick/);
    await expect(page.locator('#joystick-base')).toHaveClass(/tutorial-highlight/);
    expect(await animationName(page, '#joystick-base')).toBe('tutorial-pulse');
    expect(await drawnTexts(page)).toContain('Drag anywhere on the left half to steer');
    await page.screenshot({ path: `tests/screenshots/${testInfo.project.name}-tutorial-steer.png` });

    // Drag right from a point in the zone: the ship turns from -PI/2 toward 0
    const fingers = new Fingers(page, browserName);
    const zone = await page.locator('#joystick-zone').boundingBox();
    const start = { x: zone.x + zone.width * 0.4, y: zone.y + zone.height * 0.6 };
    await fingers.downAt(1, start);
    await fingers.moveBy(1, 20, 0);
    await expect.poll(() => hook(page, 'tutorial.step')).toBe('thrust');
    await fingers.releaseAll();
    expect(await drawnTexts(page)).toContain('Drag further out to fly: past the dashed ring = thrust');
    await expect(page.locator('#joystick-base')).toHaveClass(/tutorial-highlight/);
    // Drag further out: thrust
    await fingers.downAt(2, start);
    await fingers.moveBy(2, 0, -58);
    await expect.poll(() => hook(page, 'tutorial.step'), { timeout: 5000 }).toBe('collect');
    await fingers.releaseAll();
    await expect(page.locator('#joystick-base')).not.toHaveClass(/tutorial-highlight/);
    await expect.poll(() => hook(page, 'tutorial.target.type')).toBe('green');
    await frames(page, 3);
    await page.screenshot({ path: `tests/screenshots/${testInfo.project.name}-tutorial-collect.png` });
    expect(errors).toEqual([]);
  });

  test('buttons mode: the arrow buttons pulse, then the thrust button', async ({ page, browserName }) => {
    await touchTraining(page, { controlMode: 'buttons' });
    expect(await hook(page, 'tutorial.inputKind')).toBe('buttons');
    await expect(page.locator('body')).toHaveClass(/tutorial-buttons/);
    for (const sel of ['#touch-left-btn', '#touch-right-btn']) {
      await expect(page.locator(sel)).toHaveClass(/tutorial-highlight/);
      expect(await animationName(page, sel)).toBe('tutorial-pulse');
    }
    expect(await drawnTexts(page)).toContain('Use the arrow buttons to turn');
    const fingers = new Fingers(page, browserName);
    await fingers.down(1, '#touch-left-btn');
    await expect.poll(() => hook(page, 'tutorial.step')).toBe('thrust');
    await fingers.releaseAll();
    await expect(page.locator('#touch-thrust-btn')).toHaveClass(/tutorial-highlight/);
    await expect(page.locator('#touch-left-btn')).not.toHaveClass(/tutorial-highlight/);
    await fingers.down(2, '#touch-thrust-btn');
    await expect.poll(() => hook(page, 'tutorial.step'), { timeout: 5000 }).toBe('collect');
    await fingers.releaseAll();
  });

  test('the Skip button on the banner ends training (Level 1, touch controls unaffected)', async ({ page }) => {
    await touchTraining(page);
    const regions = await hook(page, 'tapRegions');
    expect(regions.length).toBe(1); // only Skip during play
    const p = await tapRegionCenter(page, 0);
    // The Skip button must not sit under the pause/mute buttons
    const pause = await centerOf(page, '#touch-pause-btn');
    expect(Math.hypot(p.x - pause.x, p.y - pause.y)).toBeGreaterThan(40);
    await tapAt(page, p);
    await expect.poll(() => hook(page, 'tutorial.active')).toBe(false);
    expect(await hook(page, 'level')).toBe(1);
    await expect(page.locator('body')).not.toHaveClass(/tutorial-step/);
    expect(await hook(page, 'tutorial')).toMatchObject({ done: true, skipped: true });
  });
});
