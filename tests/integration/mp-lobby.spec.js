// Multiplayer lobby, keyboard and controller part (plan 05 §10.2, MP-2): join with fire from
// each keyboard half or controller, ready, leave, colours, the start countdown, Escape back
// and the saved line-up. Desktop only (touch join pads come with MP-3).
import { test, expect } from '@playwright/test';
import {
  PAD, openFresh, hook, waitForState, frames, loginWithKeyboard, openTakeTurnsLobby, lobbyPress, padTap, drawnTexts,
} from './helpers.js';

const USER_LIST_KEY = 'asteroids_userList';
const LINEUP_KEY = 'spaceAdventure_mp_lineup';

async function lobbyReady(page, name = 'TESTER', storage = {}, opts = {}) {
  const errors = await openFresh(page, { storage, ...opts });
  await loginWithKeyboard(page, name);
  await openTakeTurnsLobby(page);
  return errors;
}

const joined = (page) => hook(page, 'lobby.joined');

test.describe('multiplayer lobby (keyboard)', () => {
  test('the Enter that chose the mode does not join P2; Space and Enter join, ready and count down', async ({ page }) => {
    const errors = await lobbyReady(page);
    await frames(page, 5);
    expect(await joined(page)).toBe(0);
    expect(await hook(page, 'seats.merged')).toBe(false);
    expect(await hook(page, 'seats.seats')).toEqual([null, null, null, null]);

    await lobbyPress(page, 'Space', 0, (c) => !!c && !c.ready);
    let cards = await hook(page, 'lobby.cards');
    expect(cards[0]).toMatchObject({ name: 'TESTER', profile: 'TESTER', source: 'kbLeft', colour: 0 });
    await lobbyPress(page, 'Enter', 1, (c) => !!c && !c.ready);
    cards = await hook(page, 'lobby.cards');
    expect(cards[1]).toMatchObject({ name: 'Guest 2', profile: null, source: 'kbRight', colour: 1 });

    // One ready: no countdown yet
    await lobbyPress(page, 'Space', 0, (c) => c.ready);
    await frames(page, 3);
    expect(await hook(page, 'lobby.countdown')).toBeNull();
    // Key-test lights while ready: P1's W is routed to seat 0 only and changes nothing else
    await page.keyboard.down('w');
    await expect.poll(() => page.evaluate(() => window.__spaceAdventure.isPressedSeat('thrust', 0))).toBe(true);
    expect(await page.evaluate(() => window.__spaceAdventure.isPressedSeat('thrust', 1))).toBe(false);
    await page.keyboard.up('w');
    expect((await hook(page, 'lobby.cards'))[0]).toMatchObject({ name: 'TESTER', ready: true });
    // Both ready: 3 s countdown; P2 unready (↓) cancels it
    await lobbyPress(page, 'Enter', 1, (c) => c.ready);
    await expect.poll(() => hook(page, 'lobby.countdown')).not.toBeNull();
    expect(await hook(page, 'lobby.countdown')).toBeGreaterThan(2);
    await lobbyPress(page, 'ArrowDown', 1, (c) => !!c && !c.ready);
    await expect.poll(() => hook(page, 'lobby.countdown')).toBeNull();
    // Ready again: the round starts when the countdown ends
    await lobbyPress(page, 'Enter', 1, (c) => c.ready);
    await waitForState(page, 'turn_change', 6000);
    expect((await hook(page, 'players')).map((p) => [p.name, p.slot])).toEqual([['TESTER', 0], ['Guest 2', 1]]);
    expect(await hook(page, 'seats.merged')).toBe(true); // Take Turns shares one input
    const saved = await page.evaluate((k) => JSON.parse(sessionStorage.getItem(k)), LINEUP_KEY);
    expect(saved).toMatchObject({ modeId: 'turns', kind: 'seats' });
    expect(saved.players.map((p) => [p.seat, p.source, p.name])).toEqual([[0, 'kbLeft', 'TESTER'], [1, 'kbRight', 'Guest 2']]);
    expect(errors).toEqual([]);
  });

  test('leave with S / ↓: ready players unready first; the freed seat is joined again', async ({ page }) => {
    await lobbyReady(page);
    await lobbyPress(page, 'Enter', 1, (c) => !!c && c.source === 'kbRight'); // arrows: P2 even when first
    await lobbyPress(page, 'Space', 0, (c) => !!c && c.source === 'kbLeft');
    // The signed-in profile went to the first player to join
    expect((await hook(page, 'lobby.cards'))[1].name).toBe('TESTER');
    await lobbyPress(page, 'ArrowDown', 1, (c) => c === null);
    expect(await joined(page)).toBe(1);
    expect((await hook(page, 'seats.seats'))[1]).toBeNull();
    // S while ready: unready, then leave
    await lobbyPress(page, 'Space', 0, (c) => c.ready);
    await lobbyPress(page, 's', 0, (c) => !!c && !c.ready);
    await lobbyPress(page, 's', 0, (c) => c === null);
    expect(await joined(page)).toBe(0);
    // Rejoin: the same seat again, and the profile is free again
    await lobbyPress(page, 'Enter', 1, (c) => !!c && c.name === 'TESTER' && c.source === 'kbRight');
  });

  test('seats follow the keyboard sides: Enter first joins P2, Space then P1; cards name their keys; caps light', async ({ page }, testInfo) => {
    const errors = await lobbyReady(page, 'TESTER', {}, { recordText: true });
    // Empty cards: each names its own join key
    await expect.poll(async () => {
      const t = await drawnTexts(page);
      return t.includes('Press SPACE to join') && t.includes('Press ENTER to join');
    }).toBe(true);
    const texts = await drawnTexts(page);
    expect(texts.some((t) => /^W A S D side · or press . on a controller$/.test(t))).toBe(true);
    expect(texts.some((t) => /^Arrow keys side · or press . on a controller$/.test(t))).toBe(true);
    expect(texts).not.toContain('Press FIRE to join');

    // The arrow-keys player presses first: P2 (right card), not P1
    await lobbyPress(page, 'Enter', 1, (c) => !!c && c.source === 'kbRight');
    expect((await hook(page, 'lobby.cards'))[0]).toBeNull();
    expect((await hook(page, 'seats.seats'))[1]).toMatchObject({ source: 'kbRight', colour: 1 });
    await expect.poll(async () => (await drawnTexts(page)).includes('Press SPACE to join')).toBe(true);
    // Space joins P1 (left card)
    await lobbyPress(page, 'Space', 0, (c) => !!c && c.source === 'kbLeft');
    expect((await hook(page, 'seats.seats')).map((s) => s && s.source)).toEqual(['kbLeft', 'kbRight', null, null]);

    // Key caps on the joined cards, in the seat colour, lit while that seat's key is held
    await expect.poll(() => hook(page, 'lobby.cards.0.keys.caps')).toEqual(['W', 'A', 'S', 'D', 'SPACE', 'F']);
    expect(await hook(page, 'lobby.cards.1.keys.caps')).toEqual(['↑', '←', '↓', '→', 'ENTER']);
    const cards = await hook(page, 'lobby.cards');
    expect(cards[0].keys.colour).toBe(cards[0].colourHex);
    expect(cards[1].keys.colour).toBe(cards[1].colourHex);
    expect(cards[0].keys.labels).toEqual(expect.arrayContaining(['Thrust', 'Turn', 'Fire']));
    expect(cards[0].keys.lit).toEqual([]);
    // P1 ready first (ready cards ignore W and Space), then W lights on P1's card only
    await lobbyPress(page, 'Space', 0, (c) => c.ready);
    await page.keyboard.down('w');
    await expect.poll(() => hook(page, 'lobby.cards.0.keys.lit')).toEqual(['W']);
    expect(await hook(page, 'lobby.cards.1.keys.lit')).toEqual([]);
    await page.keyboard.up('w');
    await page.keyboard.down('Space'); // both fire caps (SPACE and F) light
    await expect.poll(() => hook(page, 'lobby.cards.0.keys.lit')).toEqual(['SPACE', 'F']);
    await page.keyboard.up('Space');
    await expect.poll(() => hook(page, 'lobby.cards.0.keys.lit')).toEqual([]);
    await page.keyboard.down('ArrowUp'); // P2 (not ready): ↑ also steps the name, harmless here
    await expect.poll(() => hook(page, 'lobby.cards.1.keys.lit')).toEqual(['↑']);
    expect(await hook(page, 'lobby.cards.0.keys.lit')).toEqual([]);
    await page.keyboard.up('ArrowUp');
    await expect.poll(() => hook(page, 'lobby.cards.1.keys.lit')).toEqual([]);
    await page.screenshot({ path: `tests/screenshots/${testInfo.project.name}-lobby-keys.png` });
    expect(errors).toEqual([]);
  });

  test('colours cycle with rotate keys and skip colours other players hold', async ({ page }) => {
    await lobbyReady(page);
    await lobbyPress(page, 'Space', 0, (c) => !!c);
    await lobbyPress(page, 'Enter', 1, (c) => !!c);
    const colours = async () => (await hook(page, 'lobby.cards')).slice(0, 2).map((c) => c.colour);
    expect(await colours()).toEqual([0, 1]);
    await lobbyPress(page, 'd', 0, (c) => c.colour === 2); // 1 is P2's: skipped
    await lobbyPress(page, 'ArrowLeft', 1, (c) => c.colour === 0); // 0 is free now
    await lobbyPress(page, 'a', 0, (c) => c.colour === 1);
    await lobbyPress(page, 'a', 0, (c) => c.colour === 3); // skips 0 (P2), wraps to 3
    expect(await colours()).toEqual([3, 0]);
    const hex = (await hook(page, 'lobby.cards')).slice(0, 2).map((c) => c.colourHex);
    expect(hex[0]).not.toBe(hex[1]);
    // Ready players can't change colour
    await lobbyPress(page, 'Space', 0, (c) => c.ready);
    await page.keyboard.press('d');
    await frames(page, 3);
    expect((await hook(page, 'lobby.cards'))[0].colour).toBe(3);
  });

  test('names: ↑ cycles Guest N and saved profiles not in use', async ({ page }) => {
    await lobbyReady(page, 'TESTER', { [USER_LIST_KEY]: JSON.stringify(['TESTER', 'ALICE', 'BOB']) });
    await lobbyPress(page, 'Space', 0, (c) => !!c && c.name === 'TESTER');
    await lobbyPress(page, 'Enter', 1, (c) => !!c && c.name === 'Guest 2');
    await lobbyPress(page, 'ArrowUp', 1, (c) => c.name === 'ALICE'); // TESTER is taken
    await lobbyPress(page, 'ArrowUp', 1, (c) => c.name === 'BOB');
    await lobbyPress(page, 'ArrowUp', 1, (c) => c.name === 'Guest 2');
    await lobbyPress(page, 'w', 0, (c) => c.name === 'ALICE');
    await lobbyPress(page, 'ArrowUp', 1, (c) => c.name === 'TESTER'); // free now
    expect((await hook(page, 'lobby.cards')).slice(0, 2).map((c) => c.profile)).toEqual(['ALICE', 'TESTER']);
  });

  test('Escape goes back to mode select, asking first when someone has joined', async ({ page }) => {
    await lobbyReady(page);
    await page.keyboard.press('Escape');
    await waitForState(page, 'mp_mode_select');
    expect(await hook(page, 'seats.merged')).toBe(true);

    await page.keyboard.press('Enter');
    await waitForState(page, 'lobby');
    await lobbyPress(page, 'Space', 0, (c) => !!c);
    await page.keyboard.press('Escape');
    await expect.poll(() => hook(page, 'lobby.exitNotice')).toBeGreaterThan(0);
    expect(await hook(page, 'state')).toBe('lobby');
    await page.keyboard.press('Escape');
    await waitForState(page, 'mp_mode_select');
    expect(await hook(page, 'seats')).toEqual({ merged: true, seats: [null, null, null, null] });
    await page.keyboard.press('Escape');
    await waitForState(page, 'menu');
  });

  test('Change players / rematch rebuilds the line-up joined but not ready', async ({ page }) => {
    await lobbyReady(page, 'TESTER', { [USER_LIST_KEY]: JSON.stringify(['TESTER', 'ALICE']) });
    await lobbyPress(page, 'Enter', 1, (c) => !!c);
    await lobbyPress(page, 'Space', 0, (c) => !!c);
    await lobbyPress(page, 'a', 0, (c) => c.colour === 3);
    await lobbyPress(page, 'w', 0, (c) => c.name === 'ALICE');
    const withoutKeys = (cards) => cards.map(({ keys, ...c }) => c); // drawn key caps: not part of the line-up
    const before = withoutKeys((await hook(page, 'lobby.cards')).slice(0, 2));
    await lobbyPress(page, 'Enter', 1, (c) => c.ready);
    await lobbyPress(page, 'Space', 0, (c) => c.ready);
    await waitForState(page, 'turn_change', 6000);
    expect((await hook(page, 'players')).map((p) => p.name)).toEqual(['ALICE', 'TESTER']);

    // Pause menu > Change players
    await page.keyboard.press('Escape');
    await waitForState(page, 'paused');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'pauseIndex')).toBe(1);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'pauseIndex')).toBe(2);
    await page.keyboard.press('Enter');
    await waitForState(page, 'lobby');
    const after = withoutKeys((await hook(page, 'lobby.cards')).slice(0, 2));
    expect(after).toEqual(before.map((c) => ({ ...c, ready: false })));
    expect(await hook(page, 'seats.merged')).toBe(false);
    expect(await hook(page, 'lobby.countdown')).toBeNull();
  });

  test('controllers join with Ⓐ; a 5th input is ignored when all 4 seats are taken', async ({ page }) => {
    await lobbyReady(page, 'TESTER', {}, { gamepads: [{}, {}, {}] });
    await lobbyPress(page, 'Space', 0, (c) => !!c);
    await lobbyPress(page, 'Enter', 1, (c) => !!c);
    await padTap(page, PAD.A, { pad: 0 });
    await expect.poll(() => hook(page, 'lobby.cards.2.source')).toBe('pad:0');
    await padTap(page, PAD.A, { pad: 1 });
    await expect.poll(() => hook(page, 'lobby.cards.3.source')).toBe('pad:1');
    expect(await joined(page)).toBe(4);
    await padTap(page, PAD.A, { pad: 2 });
    await frames(page, 5);
    expect(await joined(page)).toBe(4);
    expect((await hook(page, 'seats.seats')).map((s) => s && s.source)).toEqual(['kbLeft', 'kbRight', 'pad:0', 'pad:1']);
    // Ⓐ readies, Ⓑ unreadies, Ⓑ again leaves
    await padTap(page, PAD.A, { pad: 1 });
    await expect.poll(() => hook(page, 'lobby.cards.3.ready')).toBe(true);
    await padTap(page, PAD.B, { pad: 1 });
    await expect.poll(() => hook(page, 'lobby.cards.3.ready')).toBe(false);
    await padTap(page, PAD.B, { pad: 1 });
    await expect.poll(() => hook(page, 'lobby.cards.3')).toBeNull();
  });

  test('"Pass one device instead" switches to the player-count lobby', async ({ page }) => {
    await lobbyReady(page);
    const regions = await hook(page, 'tapRegions');
    const r = regions[regions.length - 1];
    const box = await page.locator('#gameCanvas').boundingBox();
    const view = await hook(page, 'view');
    await page.mouse.click(box.x + (r.x + r.w / 2) * (box.width / view.width), box.y + (r.y + r.h / 2) * (box.height / view.height));
    await expect.poll(() => hook(page, 'lobby.kind')).toBe('count');
    expect(await hook(page, 'seats.merged')).toBe(true);
    expect(await hook(page, 'lobby.rows')).toEqual(['count', 'name1', 'name2', 'start', 'seats', 'back']);
    // Keys work here too: Players 2 -> 3, then Start
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => hook(page, 'lobby.count')).toBe(3);
    for (let i = 1; i <= 4; i++) {
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => hook(page, 'lobby.index')).toBe(i);
    }
    await page.keyboard.press('Enter');
    await waitForState(page, 'turn_change');
    expect((await hook(page, 'players')).length).toBe(3);
  });
});
