// Time Attack vs Ghost (plan 05 §4.6, MP-6): course picker, seeded layout, ghost saved at the
// end of a run and replayed on the next one. Desktop keyboard.
import { test, expect } from '@playwright/test';
import {
  openFresh, hook, waitForState, frames, loginWithKeyboard, openTimeAttackSetup, selfDestruct,
} from './helpers.js';

const ghostKey = (user, course, difficulty) => `spaceAdventure_ghost_v1_${user}_${course}_${difficulty}`;

/** One key press, then let the game read it (several presses in one frame count once). */
async function press(page, key) {
  await page.keyboard.press(key);
  await frames(page, 2);
}

/** Setup screen: move to a row by id with the arrow keys. */
async function selectSetupRow(page, id) {
  const rows = await hook(page, 'timeAttack.setup.rows');
  const target = rows.indexOf(id);
  for (let i = 0; i < 10 && (await hook(page, 'timeAttack.setup.index')) !== target; i++) {
    await press(page, 'ArrowDown');
    await frames(page, 2);
  }
  expect(await hook(page, 'timeAttack.setup.index')).toBe(target);
}

/** From the setup screen: Start run, wait for play and the seeded level-1 layout. */
async function startRun(page) {
  await selectSetupRow(page, 'start');
  await page.keyboard.press('Enter');
  await waitForState(page, 'playing');
  await expect.poll(() => hook(page, 'timeAttack.active')).toBe(true);
  return hook(page, 'timeAttack');
}

/** Lose one life by a forced hyperspace self-destruct (real input; only Math.random is stubbed). */
async function loseLife(page) {
  const lives = await hook(page, 'lives');
  await expect(async () => {
    if ((await hook(page, 'lives')) === lives) {
      if (await hook(page, 'ship.isAlive')) await selfDestruct(page);
      await frames(page, 3);
    }
    expect(await hook(page, 'lives')).toBe(lives - 1);
  }).toPass({ timeout: 8000, intervals: [300] });
}

test.describe('Time Attack vs Ghost (keyboard)', () => {
  test.skip(({ hasTouch }) => hasTouch, 'desktop keyboard');

  test('seeded course, ghost saved at the end and replayed on the next run', async ({ page }) => {
    test.setTimeout(90000);
    const errors = await openFresh(page);
    await loginWithKeyboard(page, 'TESTER');

    // Mode select -> Time Attack -> course 3, Medium
    await openTimeAttackSetup(page);
    expect(await hook(page, 'timeAttack.setup.rows')).toEqual(['course', 'difficulty', 'start', 'back']);
    expect(await hook(page, 'timeAttack.setup.course')).toBe(1);
    await press(page, 'ArrowRight');
    await press(page, 'ArrowRight');
    await expect.poll(() => hook(page, 'timeAttack.setup.course')).toBe(3);
    await press(page, 'ArrowLeft');
    await press(page, 'ArrowLeft');
    await press(page, 'ArrowLeft');
    await expect.poll(() => hook(page, 'timeAttack.setup.course')).toBe(10); // wraps 1 -> 10
    await press(page, 'ArrowRight');
    await press(page, 'ArrowRight');
    await press(page, 'ArrowRight');
    await expect.poll(() => hook(page, 'timeAttack.setup.course')).toBe(3);
    expect(await hook(page, 'difficulty')).toBe('medium');
    expect(await hook(page, 'timeAttack.setup.ghostOwner')).toBeNull();

    // Run 1: 3 lives, 180 s, standard ship, no ghost yet
    const run1 = await startRun(page);
    expect(await hook(page, 'mode.id')).toBe('timeattack');
    expect(await hook(page, 'lives')).toBe(3);
    expect(await hook(page, 'mode.timeLeft')).toBeGreaterThan(178);
    expect(await hook(page, 'seats.merged')).toBe(true); // one player on the shared input
    expect(run1.course).toBe(3);
    expect(run1.difficulty).toBe('medium');
    expect(run1.seededLevel).toBe(1);
    expect(run1.layout.length).toBe(10);
    expect(run1.ghost).toMatchObject({ active: false, owner: null, paceDelta: null });

    // Game time only: a pause stops the recorder and the clock
    await expect.poll(() => hook(page, 'timeAttack.samples')).toBeGreaterThan(3);
    await page.keyboard.press('Escape');
    await waitForState(page, 'paused');
    expect(await hook(page, 'pauseOptions')).toEqual(['Resume', 'Restart round', 'Main menu']);
    const pausedAt = await hook(page, 'timeAttack.elapsedMs');
    await page.waitForTimeout(600);
    expect(await hook(page, 'timeAttack.elapsedMs')).toBe(pausedAt);
    await page.keyboard.press('Escape');
    await waitForState(page, 'playing');
    await expect.poll(() => hook(page, 'mp.resumeCountdown'), { timeout: 6000 }).toBe(0);

    // Lose every life: the run ends, the round-end banner, then Results with the ghost lines
    for (let i = 0; i < 3; i++) {
      await expect.poll(() => hook(page, 'ship.isAlive'), { timeout: 6000 }).toBe(true);
      await loseLife(page);
    }
    await waitForState(page, 'results', 8000);
    const results = await hook(page, 'results');
    expect(results.buttons).toEqual(['Retry', 'Change course', 'Main menu']);
    expect(results.timeAttack).toMatchObject({ course: 3, difficulty: 'medium', newBest: true, saved: true, ghostOwner: null });
    expect(results.timeAttack.banner).toBe('NEW BEST!');
    await page.screenshot({ path: test.info().outputPath('timeattack-results.png') });

    // The ghost is in local storage (checked there directly), with the screen size noted
    const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), ghostKey('TESTER', 3, 'medium'));
    expect(stored).not.toBeNull();
    const view = await hook(page, 'view');
    // viewSize: the side of a square with the view's area (js/main.js viewSizeMetric)
    expect(stored).toMatchObject({ v: 1, owner: 'TESTER', course: 3, difficulty: 'medium',
      viewSize: Math.round(Math.sqrt(view.width * view.height)) });
    expect(stored.durationMs).toBeGreaterThan(1000);
    expect(typeof stored.data).toBe('string');

    // Run 2 (Retry): identical starting layout, the ghost races along
    await expect.poll(() => hook(page, 'results.inputDelay')).toBe(0);
    await page.keyboard.press('Enter'); // Retry
    await waitForState(page, 'playing');
    const run2 = await hook(page, 'timeAttack');
    expect(run2.seed).toBe(run1.seed);
    expect(run2.layout).toEqual(run1.layout);
    expect(run2.ghost).toMatchObject({ active: true, owner: 'TESTER', sizeDiffers: false });
    expect(run2.previousBest).toBe(stored.score);
    await expect.poll(() => hook(page, 'timeAttack.ghost.visible')).toBe(true);
    const ghost = await hook(page, 'timeAttack.ghost');
    expect(typeof ghost.paceDelta).toBe('number');
    const world = await hook(page, 'world');
    // The first run started at the world centre, as does the ghost
    expect(Math.abs(ghost.x - world.width / 2)).toBeLessThan(world.width / 4);
    await page.screenshot({ path: test.info().outputPath('timeattack-ghost.png') });

    // Back out via pause -> Main menu; the setup screen now names the ghost
    await page.keyboard.press('Escape');
    await waitForState(page, 'paused');
    await press(page, 'ArrowDown');
    await press(page, 'ArrowDown');
    await expect.poll(() => hook(page, 'pauseIndex')).toBe(2);
    await page.keyboard.press('Enter');
    await waitForState(page, 'menu');
    await openTimeAttackSetup(page);
    expect(await hook(page, 'timeAttack.setup.course')).toBe(3); // the last course is remembered
    await expect.poll(() => hook(page, 'timeAttack.setup.ghostOwner')).toBe('TESTER');
    await page.screenshot({ path: test.info().outputPath('timeattack-setup.png') });
    await press(page, 'ArrowRight');
    await expect.poll(() => hook(page, 'timeAttack.setup.ghostOwner')).toBeNull(); // course 4: none yet
    await page.keyboard.press('Escape');
    await waitForState(page, 'mp_mode_select');
    expect(errors).toEqual([]);
  });

  test('best ghost of any profile is chosen; a screen size difference is flagged', async ({ page }) => {
    test.setTimeout(45000);
    // A short ghost recorded by ALICE on a much bigger screen (built with the real encoder)
    const errors = await openFresh(page, { storage: { asteroids_userList: JSON.stringify(['TESTER', 'ALICE']) } });
    await loginWithKeyboard(page, 'TESTER');
    await page.evaluate(async () => {
      const { GhostRecorder } = await import('./js/ghost.js');
      const { makeGhostRecord } = await import('./js/timeAttack.js');
      const rec = new GhostRecorder({ worldWidth: 3000, worldHeight: 3000, viewSize: 2000 });
      for (let t = 0; t < 5000; t += 50) rec.update(50, { x: 1500 + t / 20, y: 1500, rotation: 0, thrusting: true }, Math.floor(t / 10));
      localStorage.setItem('spaceAdventure_ghost_v1_ALICE_1_medium',
        JSON.stringify(makeGhostRecord(rec.encode(), { owner: 'ALICE', course: 1, difficulty: 'medium' })));
    });
    await openTimeAttackSetup(page);
    await expect.poll(() => hook(page, 'timeAttack.setup.ghostOwner')).toBe('ALICE');
    const run = await startRun(page);
    expect(run.ghost).toMatchObject({ active: true, owner: 'ALICE', sizeDiffers: true, notice: true });
    await expect.poll(() => hook(page, 'timeAttack.ghost.paceDelta')).toBeLessThan(0); // ALICE scores from the start
    // Runs stay independent of the menu's single-player game: back to the menu via pause
    await page.keyboard.press('Escape');
    await waitForState(page, 'paused');
    await press(page, 'ArrowUp');
    await expect.poll(() => hook(page, 'pauseIndex')).toBe(2);
    await page.keyboard.press('Enter');
    await waitForState(page, 'menu');
    // Nothing was saved for an abandoned run
    expect(await page.evaluate(() => localStorage.getItem('spaceAdventure_ghost_v1_TESTER_1_medium'))).toBeNull();
    expect(errors).toEqual([]);
  });
});
