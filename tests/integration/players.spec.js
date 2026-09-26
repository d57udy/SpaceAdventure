// Single-player through the players[] / mode / camera refactor (plan 05 MP-1 R0-R8).
// Single-player is exactly one player in mode 'solo'; the old hook fields read player 1.
import { test, expect } from '@playwright/test';
import { openFresh, hook, waitForState, loginWithKeyboard, frames } from './helpers.js';

async function startSolo(page, name = 'SOLO') {
  const errors = await openFresh(page);
  await loginWithKeyboard(page, name);
  await page.keyboard.press('Enter');
  await waitForState(page, 'playing');
  await expect.poll(() => hook(page, 'ship.isAlive')).toBe(true);
  return errors;
}

// Hyperspace with the 10% self-destruct roll forced (a browser API stub, not game state)
async function selfDestruct(page) {
  const lives0 = await hook(page, 'lives');
  await page.evaluate(() => { window.__realRandom = Math.random; Math.random = () => 0.01; });
  await page.keyboard.press('h');
  await expect.poll(() => hook(page, 'lives')).toBe(lives0 - 1);
  await page.evaluate(() => { Math.random = window.__realRandom; });
}

test.describe('single-player on the players list', () => {
  test('one player in mode solo; score, lives and ship read player 1', async ({ page }) => {
    const errors = await startSolo(page);
    const g = await page.evaluate(() => {
      const h = window.__spaceAdventure;
      return { players: h.players, mode: h.mode, score: h.score, lives: h.lives, ship: h.ship, user: h.user };
    });
    expect(g.mode.id).toBe('solo');
    expect(g.mode.kind).toBe('solo');
    expect(g.mode.timeLeft).toBeNull();
    expect(g.mode.result).toBeNull();
    expect(g.players).toHaveLength(1);
    const [p] = g.players;
    expect(p.id).toBe('p1');
    expect(p.slot).toBe(0);
    expect(p.profile).toBe(g.user);
    expect(p.name).toBe(g.user);
    expect(p.out).toBe(false);
    expect(p.hasAchievements).toBe(true);
    expect(p.score).toBe(g.score);
    expect(p.lives).toBe(g.lives);
    expect(p.lives).toBe(3); // Medium, no upgrades
    expect(p.nextExtraLifeScore).toBe(10000);
    expect(p.combo).toEqual({ count: 0, multiplier: 1 });
    expect(Object.values(p.powerUps).every(v => v === 0)).toBe(true);
    expect(p.ship).toEqual(g.ship);
    expect(p.ship.ownerId).toBe('p1');
    expect(errors).toEqual([]);
  });

  test('the camera snaps to the ship every frame (zoom 1), as before', async ({ page }) => {
    await startSolo(page, 'CAMERA');
    const view = await hook(page, 'view');
    await page.keyboard.down('ArrowUp');
    await page.keyboard.down('ArrowLeft');
    for (let i = 0; i < 5; i++) {
      await frames(page, 6);
      const { camera, ship } = await page.evaluate(() => ({ camera: window.__spaceAdventure.camera, ship: window.__spaceAdventure.ship }));
      expect(camera.zoom).toBe(1);
      expect(camera.x).toBeCloseTo(ship.x, 6);
      expect(camera.y).toBeCloseTo(ship.y, 6);
      expect(camera.left).toBeCloseTo(ship.x - view.width / 2, 6);
      expect(camera.top).toBeCloseTo(ship.y - view.height / 2, 6);
    }
    await page.keyboard.up('ArrowUp');
    await page.keyboard.up('ArrowLeft');
  });

  test('bullets carry the owner p1; shots are counted per player', async ({ page }) => {
    await startSolo(page, 'SHOOTER');
    await page.keyboard.down('Space');
    await expect.poll(() => hook(page, 'counts.playerBullets')).toBeGreaterThan(1);
    await page.keyboard.up('Space');
    const { byOwner, counts, stats } = await page.evaluate(() => ({
      byOwner: window.__spaceAdventure.bulletsByOwner, counts: window.__spaceAdventure.counts,
      stats: window.__spaceAdventure.players[0].stats,
    }));
    expect(Object.keys(byOwner)).toEqual(['p1']);
    expect(byOwner.p1).toBe(counts.playerBullets);
    expect(stats.shots).toBeGreaterThan(0);
  });

  test('losing every life ends the round through the mode (Game Over, player out)', async ({ page }) => {
    const errors = await startSolo(page, 'LASTLIFE');
    const lives = await hook(page, 'lives');
    for (let i = 0; i < lives; i++) {
      await selfDestruct(page);
      const p = await hook(page, 'players.0');
      expect(p.stats.deaths).toBe(i + 1);
      if (i < lives - 1) {
        expect(p.out).toBe(false);
        // respawns at the world centre after the delay
        await expect.poll(() => hook(page, 'ship.isAlive'), { timeout: 6000 }).toBe(true);
        const [ship, world] = await Promise.all([hook(page, 'ship'), hook(page, 'world')]);
        expect(ship.x).toBeCloseTo(world.width / 2, 0);
        expect(ship.y).toBeCloseTo(world.height / 2, 0);
      }
    }
    await waitForState(page, 'game_over');
    const g = await page.evaluate(() => ({ p: window.__spaceAdventure.players[0], mode: window.__spaceAdventure.mode }));
    expect(g.p.out).toBe(true);
    expect(g.p.lives).toBe(0);
    expect(g.mode.result).toEqual({ ended: true, outcome: 'gameOver', winners: [] });
    expect(await hook(page, 'loopErrors')).toBe(0);
    expect(errors).toEqual([]);
  });
});
