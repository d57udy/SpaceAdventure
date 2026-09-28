// Co-op "Wingmen" with a shared keyboard (plan 05 §4.2, §8, §13.2 MP-3): P1 on W A S D + Space,
// P2 on the arrows + Enter, both ships in one world. Desktop only.
import { test, expect } from '@playwright/test';
import {
  MENU, openFresh, hook, waitForState, frames, loginWithKeyboard, selectMenuRow, openCoopLobby,
  joinTwoWithKeyboard, jumpTo, selfDestruct, rectsOverlap, skipRoundIntro,
} from './helpers.js';

const TAU = Math.PI * 2;
const norm = (a) => ((a % TAU) + TAU) % TAU;

async function startCoop(page, { difficulty = null, storage = {} } = {}) {
  const errors = await openFresh(page, { storage });
  await loginWithKeyboard(page, 'TESTER');
  if (difficulty) {
    await selectMenuRow(page, MENU.DIFFICULTY);
    const steps = { easy: 'ArrowLeft', hard: 'ArrowRight' }[difficulty];
    await page.keyboard.press(steps);
    await expect.poll(() => hook(page, 'difficulty')).toBe(difficulty);
  }
  await openCoopLobby(page);
  await joinTwoWithKeyboard(page);
  await expect.poll(() => hook(page, 'players.1.ship.isAlive')).toBe(true);
  return errors;
}

const player = (page, i) => hook(page, `players.${i}`);

/** Self-destruct one seat's ship by hyperspace and wait for the life to go. */
async function loseLife(page, i, key) {
  const before = await hook(page, `players.${i}.lives`);
  await expect(async () => {
    const p = await player(page, i);
    if (p.lives === before && p.ship && p.ship.isAlive) {
      await selfDestruct(page, key);
      await frames(page, 3);
    }
    expect(await hook(page, `players.${i}.lives`)).toBe(before - 1);
  }).toPass({ timeout: 15000, intervals: [400] });
  await page.evaluate(() => { if (window.__realRandom) Math.random = window.__realRandom; });
}

/** Wait until a player (not out) has a living ship again after a death. */
async function waitForShip(page, i) {
  await expect.poll(() => hook(page, `players.${i}.ship.isAlive`), { timeout: 8000 }).toBe(true);
}

test.describe('co-op (shared keyboard)', () => {
  test.skip(({ hasTouch }) => hasTouch, 'desktop keyboard');

  test('two ships in one world: simultaneous steering and fire per seat; S hyperspaces only P1', async ({ page }) => {
    const errors = await startCoop(page);
    expect(await hook(page, 'mode.id')).toBe('coop');
    const players = await hook(page, 'players');
    expect(players.map((p) => [p.name, p.label, p.seat])).toEqual([['TESTER', 'P1', 0], ['Guest 2', 'P2', 1]]);
    expect(await hook(page, 'seats.merged')).toBe(false);
    const mp = await hook(page, 'mp');
    expect(mp).toMatchObject({ simultaneous: true, cameraSingleInstant: false, layout: null, hud: 'dom' });
    // Co-op scaling for 2 players (plan §4.2)
    expect(mp.scaling).toMatchObject({ asteroidCount: 15, ufoMaxActive: 2, powerUpInterval: 16, bossHpMult: 1.6, bossAttackMult: 1.25 });
    expect(await hook(page, 'counts.asteroids')).toBe(15);
    // Identity: hull colour and mark per seat
    expect(players[0].shipColour).toBe(players[0].colour);
    expect(players[1].shipColour).toBe(players[1].colour);
    expect(players[0].colour).not.toBe(players[1].colour);
    expect([players[0].hullMark, players[1].hullMark]).toEqual(['none', 'stripe']);

    // A (P1 left) and → (P2 right) at the same time
    const r0 = [players[0].ship.rotation, players[1].ship.rotation];
    await page.keyboard.down('a');
    await page.keyboard.down('ArrowRight');
    await frames(page, 8);
    expect(await page.evaluate(() => [0, 1].map((s) => ['rotateLeft', 'rotateRight'].map((a) => window.__spaceAdventure.isPressedSeat(a, s)))))
      .toEqual([[true, false], [false, true]]);
    await page.keyboard.up('a');
    await page.keyboard.up('ArrowRight');
    const r1 = [await hook(page, 'players.0.ship.rotation'), await hook(page, 'players.1.ship.rotation')];
    expect(r1[0]).toBeLessThan(r0[0] - 0.2);
    expect(r1[1]).toBeGreaterThan(r0[1] + 0.2);

    // Both fire: bullets per owner
    await page.keyboard.down('Space');
    await page.keyboard.down('Enter');
    await expect.poll(async () => {
      const b = await hook(page, 'bulletsByOwner');
      return (b.p1 || 0) > 0 && (b.p2 || 0) > 0;
    }).toBe(true);
    await page.keyboard.up('Space');
    await page.keyboard.up('Enter');
    const stats = (await hook(page, 'players')).map((p) => p.stats.shots);
    expect(stats[0]).toBeGreaterThan(0);
    expect(stats[1]).toBeGreaterThan(0);

    // S is P1's hyperspace only: P1 lands on the target, P2 stays
    const world = await hook(page, 'world');
    const p2Before = await hook(page, 'players.1.ship');
    // A spot clear of every rock, so the jump never lands inside one (that is a fatal jump)
    const target = await page.evaluate(() => {
      const g = window.__spaceAdventure;
      const W = g.world.width, H = g.world.height;
      const wrap = (d, size) => d - size * Math.round(d / size);
      let best = null;
      for (const fx of [0.2, 0.35, 0.65, 0.8]) for (const fy of [0.2, 0.35, 0.65, 0.8]) {
        const p = { x: W * fx, y: H * fy };
        const clear = Math.min(...g.asteroids.map((a) => Math.hypot(wrap(a.x - p.x, W), wrap(a.y - p.y, H)) - a.radius));
        if (!best || clear > best.clear) best = { ...p, clear };
      }
      return { x: best.x, y: best.y };
    });
    await jumpTo(page, 's', target.x, target.y);
    await expect.poll(async () => {
      const s = await hook(page, 'players.0.ship');
      return !!s && Math.hypot(s.x - target.x, s.y - target.y) < 20;
    }).toBe(true);
    const p2After = await hook(page, 'players.1.ship');
    expect(Math.hypot(p2After.x - p2Before.x, p2After.y - p2Before.y)).toBeLessThan(40);
    await page.evaluate(() => { if (window.__realRandom) Math.random = window.__realRandom; });

    // HUD panels in the side bars (desktop: 280 px bars), P1 left and P2 right of the canvas
    const canvas = await page.locator('#gameCanvas').boundingBox();
    const panels = page.locator('.seat-hud');
    await expect(panels).toHaveCount(2);
    const a = await panels.nth(0).boundingBox();
    const b = await panels.nth(1).boundingBox();
    expect(a.x + a.width).toBeLessThanOrEqual(canvas.x);
    expect(b.x).toBeGreaterThanOrEqual(canvas.x + canvas.width);
    expect(rectsOverlap(a, canvas) || rectsOverlap(b, canvas)).toBe(false);
    await expect(panels.nth(0).locator('[data-hud="name"]')).toHaveText('P1 TESTER');
    await expect(panels.nth(1).locator('[data-hud="name"]')).toHaveText('P2 GUEST 2');
    await expect(page.locator('.ui-overlay')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('revive at the beacon; game over only when both are out; team results', async ({ page }) => {
    test.setTimeout(120000);
    const errors = await startCoop(page, { difficulty: 'easy' });
    const lives = await hook(page, 'players.1.lives');
    expect(lives).toBe(4);

    // P2 loses every life: out, with a beacon; the round goes on
    for (let k = 0; k < lives; k++) {
      await waitForShip(page, 1);
      await loseLife(page, 1, 'ArrowDown');
    }
    await expect.poll(() => hook(page, 'players.1.out')).toBe(true);
    const beacon = await hook(page, 'players.1.beacon');
    expect(beacon).not.toBeNull();
    await frames(page, 10);
    expect(await hook(page, 'state')).toBe('playing');

    // P1 jumps onto the beacon and waits there: the 2 s bar fills, P1 pays one life
    await expect(async () => {
      const p1 = await player(page, 0);
      if (p1.ship && p1.ship.isAlive && !p1.ship.isInvulnerable) {
        const b = await hook(page, 'players.1.beacon');
        if (b && Math.hypot(p1.ship.x - b.x, p1.ship.y - b.y) > 50) await jumpTo(page, 's', b.x, b.y);
      }
      expect(await hook(page, 'players.1.out')).toBe(false);
    }).toPass({ timeout: 60000, intervals: [1000] });
    await page.evaluate(() => { if (window.__realRandom) Math.random = window.__realRandom; });
    const after = await hook(page, 'players');
    expect(after[1]).toMatchObject({ out: false, lives: 1, beacon: null });
    expect(after[1].ship.isAlive).toBe(true);
    expect(after[0].stats.revivesGiven).toBe(1);

    // P1 down to 1 life (too few to revive anyone), then P2 out again: the round goes on
    while ((await hook(page, 'players.0.lives')) > 1) {
      await waitForShip(page, 0);
      await loseLife(page, 0, 's');
    }
    // (P2 has one life left and may already have been hit by a rock or UFO meanwhile)
    await expect.poll(async () => {
      const p2 = await player(page, 1);
      return p2.out || !!(p2.ship && p2.ship.isAlive);
    }, { timeout: 8000 }).toBe(true);
    if (!(await hook(page, 'players.1.out'))) await loseLife(page, 1, 'ArrowDown');
    await expect.poll(() => hook(page, 'players.1.out')).toBe(true);
    await frames(page, 10);
    expect(await hook(page, 'state')).toBe('playing');
    // P1's last life: now everyone is out
    await waitForShip(page, 0);
    await loseLife(page, 0, 's');
    await waitForState(page, 'round_end', 5000);
    await waitForState(page, 'results', 8000);
    const r = await hook(page, 'results');
    expect(r).toMatchObject({ mode: 'coop', kind: 'coop', outcome: 'gameOver' });
    expect(r.players.map((p) => p.name).sort()).toEqual(['Guest 2', 'TESTER']);
    expect(r.teamScore).toBe(r.players.reduce((s, p) => s + p.score, 0));
    expect(r.players.find((p) => p.name === 'TESTER').revivesGiven).toBe(1);
    // The team board keeps rounds with a profile (TESTER)
    const board = await page.evaluate(() => JSON.parse(localStorage.getItem('spaceAdventure_mp_board_coop_v1')));
    expect(board.length).toBe(1);
    expect(board[0].score).toBe(r.teamScore);
    expect(errors).toEqual([]);
  });
});

test.describe('single-player keyboard regression (co-op round trip)', () => {
  test.skip(({ hasTouch }) => hasTouch, 'desktop keyboard');

  test('WASD and the arrow keys both drive the one ship', async ({ page }) => {
    const errors = await openFresh(page);
    await loginWithKeyboard(page, 'TESTER');
    // Visit the co-op lobby first, leave it, then play alone: input is merged again
    await openCoopLobby(page);
    await page.keyboard.press('Escape');
    await waitForState(page, 'mp_mode_select');
    await page.keyboard.press('Escape');
    await waitForState(page, 'menu');
    await selectMenuRow(page, MENU.START);
    await page.keyboard.press('Enter');
    await waitForState(page, 'playing');
    expect(await hook(page, 'seats.merged')).toBe(true);
    expect(await hook(page, 'mp.cameraSingleInstant')).toBe(true);
    expect(await hook(page, 'players.length')).toBe(1);

    for (const [left, right] of [['a', 'd'], ['ArrowLeft', 'ArrowRight']]) {
      let r = await hook(page, 'ship.rotation');
      await page.keyboard.down(left);
      await frames(page, 6);
      await page.keyboard.up(left);
      let next = await hook(page, 'ship.rotation');
      expect(next, `${left} turns left`).toBeLessThan(r - 0.1);
      r = next;
      await page.keyboard.down(right);
      await frames(page, 6);
      await page.keyboard.up(right);
      next = await hook(page, 'ship.rotation');
      expect(next, `${right} turns right`).toBeGreaterThan(r + 0.1);
    }
    for (const key of ['w', 'ArrowUp']) {
      await page.keyboard.down(key);
      await expect.poll(() => hook(page, 'ship.isThrusting')).toBe(true);
      await page.keyboard.up(key);
      await expect.poll(() => hook(page, 'ship.isThrusting')).toBe(false);
    }
    for (const key of ['Space', 'Enter']) {
      const before = await hook(page, 'counts.playerBullets');
      await page.keyboard.down(key);
      await expect.poll(() => hook(page, 'counts.playerBullets')).toBeGreaterThan(before);
      await page.keyboard.up(key);
      await frames(page, 30);
    }
    // Colours and marks stay single-player
    expect(await hook(page, 'players.0.shipColour')).toBeNull();
    expect(await hook(page, 'players.0.hullMark')).toBe('none');
    expect(errors).toEqual([]);
  });
});

test.describe('co-op screenshots for review (desktop)', () => {
  test.skip(({ hasTouch }) => hasTouch, 'desktop keyboard');

  test('lobby, in game, paused and team results', async ({ page }, testInfo) => {
    test.setTimeout(90000);
    const name = testInfo.project.name;
    await openFresh(page);
    await loginWithKeyboard(page, 'TESTER');
    await selectMenuRow(page, MENU.DIFFICULTY);
    await page.keyboard.press('ArrowRight'); // Hard: 2 lives each
    await expect.poll(() => hook(page, 'difficulty')).toBe('hard');
    await openCoopLobby(page);
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
    await expect.poll(() => hook(page, 'lobby.joined')).toBe(2);
    await page.keyboard.press('Space');
    await expect.poll(() => hook(page, 'lobby.cards.0.ready')).toBe(true);
    await page.screenshot({ path: `tests/screenshots/${name}-coop-lobby.png` });
    await page.keyboard.press('Enter');
    await waitForState(page, 'playing', 6000);
    await page.screenshot({ path: `tests/screenshots/${name}-coop-intro.png` });
    await skipRoundIntro(page);
    await page.keyboard.down('Space');
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(600);
    await page.keyboard.up('Space');
    await page.keyboard.up('ArrowLeft');
    // Round start: each ship is tagged with its player and keys for 5 s
    expect(await hook(page, 'players.0.tag')).toBe('P1 · WASD + SPACE');
    expect(await hook(page, 'players.1.tag')).toBe('P2 · ARROWS + ENTER');
    expect(await hook(page, 'players.0.tagTimer')).toBeGreaterThan(0);
    await page.screenshot({ path: `tests/screenshots/${name}-coop-ingame.png` });
    // Pause: a controls reminder per player under the menu
    await page.keyboard.press('p');
    await waitForState(page, 'paused');
    await expect.poll(() => hook(page, 'mp.pauseControls')).toHaveLength(2);
    const reminder = await hook(page, 'mp.pauseControls');
    expect(reminder[0]).toMatch(/^P1 · WASD \+ SPACE \(TESTER\): W thrust · A D turn · S hyperspace · SPACE or F fire$/);
    expect(reminder[1]).toMatch(/^P2 · ARROWS \+ ENTER \(Guest 2\): ↑ thrust/);
    await page.screenshot({ path: `tests/screenshots/${name}-coop-paused.png` });
    await page.keyboard.press('p');
    await waitForState(page, 'playing');
    await expect.poll(() => hook(page, 'mp.resumeCountdown'), { timeout: 8000 }).toBe(0);
    await expect.poll(() => hook(page, 'players.0.tagTimer'), { timeout: 10000 }).toBe(0);
    // P1 down to 1 life (can't revive), then P2 out: beacon on screen
    await expect.poll(() => hook(page, 'players.0.ship.isAlive'), { timeout: 8000 }).toBe(true);
    await loseLife(page, 0, 's');
    // After a respawn the tag shows again for 2 s
    await expect.poll(async () => {
      const p = await hook(page, 'players.0');
      return !!(p.ship && p.ship.isAlive && p.respawnTimer <= 0 && p.tagTimer > 0);
    }, { timeout: 8000, intervals: [100] }).toBe(true);
    for (let k = 0; k < 2; k++) {
      await expect.poll(() => hook(page, 'players.1.ship.isAlive'), { timeout: 8000 }).toBe(true);
      await loseLife(page, 1, 'ArrowDown');
    }
    await page.waitForTimeout(500);
    await page.screenshot({ path: `tests/screenshots/${name}-coop-beacon.png` });
    await expect.poll(() => hook(page, 'players.0.ship.isAlive'), { timeout: 8000 }).toBe(true);
    await loseLife(page, 0, 's');
    await waitForState(page, 'results', 8000);
    await expect.poll(() => hook(page, 'results.inputDelay')).toBe(0);
    await page.screenshot({ path: `tests/screenshots/${name}-coop-results.png` });
  });
});
