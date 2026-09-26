// Multiplayer modes (plan 05 MP-2): Take Turns end to end, the multiplayer pause and the
// Results screen. Keyboard tests run on desktop; the pass-and-play test runs on touch devices.
import { test, expect } from '@playwright/test';
import {
  MENU, openFresh, hook, waitForState, frames, loginWithKeyboard, loginWithTouch, tapAt, menuItemCenter,
  tapRegionCenter, canvasToPage, selectMenuRow, openTakeTurnsLobby, lobbyPress, selfDestruct, collectGreenByJump,
} from './helpers.js';

const USER_LIST_KEY = 'asteroids_userList';
const upgradesKey = (u) => `asteroids_upgrades_${u}`;
const highScoresKey = (u) => `asteroids_highScores_${u}`;


/** Pick the Hard difficulty (2 lives) from the main menu, then come back to Start. */
async function chooseHard(page) {
  await selectMenuRow(page, MENU.DIFFICULTY);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => hook(page, 'difficulty')).toBe('hard');
  await selectMenuRow(page, MENU.START);
}

/** TESTER (P1, Space) and ALICE (P2, Enter; picked with ↑) join, ready up and wait for the start. */
async function startTwoPlayerTurns(page) {
  await openTakeTurnsLobby(page);
  await lobbyPress(page, 'Space', 0, (c) => !!c && c.name === 'TESTER');
  await lobbyPress(page, 'Enter', 1, (c) => !!c && c.name === 'Guest 2');
  await lobbyPress(page, 'ArrowUp', 1, (c) => c.name === 'ALICE' && c.profile === 'ALICE');
  await lobbyPress(page, 'Space', 0, (c) => c.ready);
  await lobbyPress(page, 'Enter', 1, (c) => c.ready);
  await expect.poll(() => hook(page, 'lobby.countdown')).not.toBeNull();
  await waitForState(page, 'turn_change', 6000);
}

/** On the hand-over screen for player `index`: wait out the 1 s delay and press fire. */
async function takeTurn(page, index, key = 'Space') {
  await waitForState(page, 'turn_change', 8000);
  expect(await hook(page, 'turn.index')).toBe(index);
  await expect.poll(() => hook(page, 'turn.readyDelay')).toBe(0);
  await page.keyboard.press(key);
  await waitForState(page, 'playing');
  await expect.poll(() => hook(page, `players.${index}.ship.isAlive`)).toBe(true);
}

// Self-destruct by hyperspace; after a successful jump the drive needs up to 5 s to recharge,
// so H is pressed again until the life is gone.
async function loseLife(page, index) {
  const lives = await hook(page, `players.${index}.lives`);
  await selfDestruct(page);
  await expect(async () => {
    if ((await hook(page, `players.${index}.lives`)) !== lives - 1) {
      await page.keyboard.press('h');
      await frames(page, 3);
    }
    expect(await hook(page, `players.${index}.lives`)).toBe(lives - 1);
  }).toPass({ timeout: 8000, intervals: [300] });
}

test.describe('Take Turns (keyboard)', () => {
  test.skip(({ hasTouch }) => hasTouch, 'desktop keyboard');

  test('two players: hand-over screen, own worlds, results order, credits and high score saved', async ({ page }) => {
    test.setTimeout(90000);
    const errors = await openFresh(page, { storage: { [USER_LIST_KEY]: JSON.stringify(['TESTER', 'ALICE']) } });
    await loginWithKeyboard(page, 'TESTER');
    await chooseHard(page);
    await startTwoPlayerTurns(page);

    const players = await hook(page, 'players');
    expect(players.map((p) => [p.name, p.profile, p.lives])).toEqual([['TESTER', 'TESTER', 2], ['ALICE', 'ALICE', 2]]);
    expect(await hook(page, 'mode.id')).toBe('turns');
    expect(await hook(page, 'seats.merged')).toBe(true); // one shared input

    // Hand-over screen: fire is ignored for the first second
    expect(await hook(page, 'turn.index')).toBe(0);
    if ((await hook(page, 'turn.readyDelay')) > 0.4) {
      await page.keyboard.press('Space');
      await frames(page, 3);
      expect(await hook(page, 'state')).toBe('turn_change');
    }
    await takeTurn(page, 0);
    expect(await hook(page, 'players.1.ship')).toBeNull(); // only the active player has a ship
    const p1World = await hook(page, 'counts.asteroids');

    // P1 loses a life: after the explosion, P2's turn
    await loseLife(page, 0);
    await waitForState(page, 'turn_change', 5000);
    expect(await hook(page, 'turn.index')).toBe(1);
    expect(await hook(page, 'turn.worlds.0.asteroids')).toBe(p1World); // P1's world is parked
    await takeTurn(page, 1, 'Enter');
    expect(await hook(page, 'players.0.ship')).toBeNull();
    expect(await hook(page, 'level')).toBe(1);

    // ALICE collects a crystal (points and credits), then loses a life
    await expect.poll(() => hook(page, 'players.1.ship.isInvulnerable'), { timeout: 6000 }).toBe(false);
    await collectGreenByJump(page);
    await expect.poll(() => hook(page, 'players.1.score'), { timeout: 5000 }).toBeGreaterThan(0);
    await expect.poll(() => hook(page, 'players.1.ship.isAlive')).toBe(true);
    await loseLife(page, 1);

    // P1 again (their own world back), out; then ALICE's last life
    await takeTurn(page, 0);
    await loseLife(page, 0);
    await takeTurn(page, 1);
    await loseLife(page, 1);

    // Round end banner, then Results
    await waitForState(page, 'round_end', 5000);
    await waitForState(page, 'results', 5000);
    const results = await hook(page, 'results');
    const final = await hook(page, 'players');
    expect(results.mode).toBe('turns');
    // Ranked by score (ALICE collected a crystal; TESTER only crashed), winner first
    const byScore = final.slice().sort((a, b) => b.score - a.score || a.slot - b.slot);
    expect(results.players.map((p) => [p.name, p.score])).toEqual(byScore.map((p) => [p.name, p.score]));
    expect(results.players[0].winner).toBe(true);
    expect(results.winnerNames).toEqual([byScore[0].name]);
    const alice = results.players.find((p) => p.name === 'ALICE');
    const aliceScore = final[1].score;
    expect(alice.credits).toBeGreaterThan(0);

    // Credits and a normal high-score entry saved for ALICE's profile
    const saved = await page.evaluate(([u, h]) => ({
      upgrades: JSON.parse(localStorage.getItem(u) || 'null'),
      scores: JSON.parse(localStorage.getItem(h) || '[]'),
      history: JSON.parse(localStorage.getItem('spaceAdventure_mp_history_v1') || '[]'),
      rivalry: JSON.parse(localStorage.getItem('spaceAdventure_mp_rivalry_v1') || '{}'),
    }), [upgradesKey('ALICE'), highScoresKey('ALICE')]);
    expect(saved.upgrades.currency).toBe(alice.credits);
    expect(saved.scores.map((s) => s.score)).toContain(aliceScore);
    expect(saved.history[0].mode).toBe('turns');
    expect(saved.rivalry['ALICE|TESTER'].turns.played).toBe(1);
    if (byScore[0].score > byScore[1].score) expect(saved.rivalry['ALICE|TESTER'].turns.wins[byScore[0].name]).toBe(1);

    // Input waits 1.5 s, then Rematch rebuilds the same line-up, joined but not ready
    expect(results.inputDelay).toBeGreaterThan(0);
    await expect.poll(() => hook(page, 'results.inputDelay')).toBe(0);
    expect(await hook(page, 'results.index')).toBe(0);
    await page.keyboard.press('Enter');
    await waitForState(page, 'lobby');
    const cards = await hook(page, 'lobby.cards');
    expect(cards.slice(0, 2).map((c) => [c.name, c.source, c.ready])).toEqual([['TESTER', 'kbLeft', false], ['ALICE', 'kbRight', false]]);
    expect(errors).toEqual([]);
  });

  test('multiplayer pause: who paused, anyone resumes after a 3 s countdown, pause menu', async ({ page }) => {
    test.setTimeout(60000);
    const errors = await openFresh(page, { storage: { [USER_LIST_KEY]: JSON.stringify(['TESTER', 'ALICE']) } });
    await loginWithKeyboard(page, 'TESTER');
    await startTwoPlayerTurns(page);
    await takeTurn(page, 0);

    await page.keyboard.press('p');
    await waitForState(page, 'paused');
    expect(await hook(page, 'mp.pausedBy')).toBe(0);
    expect(await hook(page, 'pauseOptions')).toEqual(['Resume', 'Restart round', 'Change players', 'Main menu']);

    // Escape resumes with a countdown; the ship doesn't move meanwhile
    await page.keyboard.press('Escape');
    await waitForState(page, 'playing');
    expect(await hook(page, 'mp.resumeCountdown')).toBeGreaterThan(2);
    const before = await hook(page, 'ship');
    await page.keyboard.down('w');
    await frames(page, 20);
    expect(await hook(page, 'ship.y')).toBe(before.y);
    await page.keyboard.up('w');
    await expect.poll(() => hook(page, 'mp.resumeCountdown'), { timeout: 5000 }).toBe(0);

    // Restart round: same players, fresh scores, back to P1's hand-over
    await page.keyboard.press('Escape');
    await waitForState(page, 'paused');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'pauseIndex')).toBe(1);
    await page.keyboard.press('Enter');
    await waitForState(page, 'turn_change');
    expect((await hook(page, 'players')).map((p) => p.name)).toEqual(['TESTER', 'ALICE']);
    expect(await hook(page, 'turn.index')).toBe(0);

    // Pause from the hand-over screen, then Main menu
    await page.keyboard.press('Escape');
    await waitForState(page, 'paused');
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => hook(page, 'pauseIndex')).toBe(3);
    await page.keyboard.press('Enter');
    await waitForState(page, 'menu');
    expect(await hook(page, 'menuOptions')).toContain('Start'); // no single-player game to resume
    expect(errors).toEqual([]);
  });

  test('Results buttons: Change mode and Main menu; the screen ignores input for 1.5 s', async ({ page }) => {
    test.setTimeout(60000);
    await openFresh(page);
    await loginWithKeyboard(page, 'TESTER');
    await chooseHard(page);
    await openTakeTurnsLobby(page);
    await lobbyPress(page, 'Space', 0, (c) => !!c);
    await lobbyPress(page, 'Enter', 1, (c) => !!c);
    await lobbyPress(page, 'Space', 0, (c) => c.ready);
    await lobbyPress(page, 'Enter', 1, (c) => c.ready);
    for (const i of [0, 1, 0, 1]) {
      await takeTurn(page, i);
      await loseLife(page, i);
    }
    await waitForState(page, 'results', 8000);
    const r = await hook(page, 'results');
    expect(r.outcome).toBe('win');
    expect(r.winnerNames).toEqual(['TESTER', 'Guest 2']); // a tie at 0 points
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await frames(page, 5);
    expect(await hook(page, 'state')).toBe('results'); // too early
    await expect.poll(() => hook(page, 'results.inputDelay')).toBe(0);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => hook(page, 'results.index')).toBe(1);
    await page.keyboard.press('Enter');
    await waitForState(page, 'mp_mode_select');
    await page.keyboard.press('Escape');
    await waitForState(page, 'menu');
  });
});

test.describe('Take Turns (touch: pass one device)', () => {
  test.skip(({ hasTouch }) => !hasTouch, 'touch devices');

  test('tap Multiplayer, Take Turns, 3 players, Start; hand-over by tap', async ({ page }) => {
    test.setTimeout(60000);
    const errors = await openFresh(page, { controlMode: 'joystick' });
    await loginWithTouch(page, 'TOUCHY');
    await tapAt(page, await menuItemCenter(page, 'Multiplayer'));
    await waitForState(page, 'mp_mode_select');
    await tapAt(page, await tapRegionCenter(page, 0));
    await waitForState(page, 'lobby');
    expect(await hook(page, 'lobby.kind')).toBe('count');
    expect(await hook(page, 'lobby.count')).toBe(2);
    expect(await hook(page, 'lobby.rows')).toEqual(['count', 'name1', 'name2', 'start', 'back']);

    // Right side of the Players row: 3 players
    const regions = await hook(page, 'tapRegions');
    const row = regions[0];
    await tapAt(page, await canvasToPage(page, row.x + row.w * 0.9, row.y + row.h / 2));
    await expect.poll(() => hook(page, 'lobby.count')).toBe(3);
    expect((await hook(page, 'lobby.names')).map((n) => n.name)).toEqual(['TOUCHY', 'Guest 2', 'Guest 3']);

    const rows = await hook(page, 'lobby.rows');
    await tapAt(page, await tapRegionCenter(page, rows.indexOf('start')));
    await waitForState(page, 'turn_change');
    expect((await hook(page, 'players')).map((p) => p.name)).toEqual(['TOUCHY', 'Guest 2', 'Guest 3']);
    await expect.poll(() => hook(page, 'turn.readyDelay')).toBe(0);
    await tapAt(page, await tapRegionCenter(page, 0));
    await waitForState(page, 'playing');
    await expect.poll(() => hook(page, 'players.0.ship.isAlive')).toBe(true);
    expect(errors).toEqual([]);
  });
});
