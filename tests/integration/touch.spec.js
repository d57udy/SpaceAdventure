// Touch UAT tests (iPad WebKit, iPad landscape WebKit, Chromium with touch).
import { test, expect } from '@playwright/test';
import {
  openFresh, snap, hook, isPressed, waitForState, loginWithTouch, tapMenuItem,
  tapRegionCenter, tapRegionPoint, tapAt, Fingers, rectsOverlap, CONTROL_MODE_KEY, MENU,
  settingsRowIndex,
} from './helpers.js';

/** From the menu: open Settings, tap the centre of a row (cycles it), then tap Back. */
async function toggleSettingByTap(page, id) {
  await tapMenuItem(page, 'Settings');
  await waitForState(page, 'settings');
  await tapAt(page, await tapRegionCenter(page, await settingsRowIndex(page, id)));
  await expect.poll(() => hook(page, 'settingsIndex')).toBe(await settingsRowIndex(page, id));
  return async () => {
    await tapAt(page, await tapRegionCenter(page, await settingsRowIndex(page, 'back')));
    await waitForState(page, 'menu');
  };
}

const BUTTONS = {
  rotateLeft: '#touch-left-btn',
  rotateRight: '#touch-right-btn',
  thrust: '#touch-thrust-btn',
  fire: '#touch-fire-btn',
  hyperspace: '#touch-hyper-btn',
  toggleMute: '#touch-mute-btn',
  pause: '#touch-pause-btn',
};

// Visible per control scheme (the stick replaces rotate + thrust in joystick mode)
const JOYSTICK_HIDDEN = ['rotateLeft', 'rotateRight', 'thrust'];
const JOYSTICK_VISIBLE = ['fire', 'hyperspace', 'toggleMute', 'pause'];
const visibleButtons = (mode) => Object.fromEntries(Object.entries(BUTTONS)
  .filter(([action]) => mode === 'buttons' || !JOYSTICK_HIDDEN.includes(action)));

async function startByTap(page) {
  await tapMenuItem(page, 'Start');
  await waitForState(page, 'playing');
  await expect.poll(() => hook(page, 'ship.isAlive')).toBe(true);
  await expect(page.locator(BUTTONS.fire)).toBeVisible();
}

test.describe('touch: prompt and menu', () => {
  test('page is touch-enabled and the username can be entered with taps', async ({ page }) => {
    const errors = await openFresh(page);
    await expect(page.locator('body')).toHaveClass(/touch-enabled/);
    await waitForState(page, 'prompt_user');
    // Touch devices must not autofocus (the on-screen keyboard only opens on tap)
    await expect(page.locator('#username-input')).not.toBeFocused();
    await loginWithTouch(page, 'ipad1');
    expect(await hook(page, 'user')).toBe('IPAD1');
    await expect(page.locator('#user-prompt')).toBeHidden();
    await expect(page.locator('#username-input')).not.toBeFocused(); // keyboard dismissed
    expect(errors).toEqual([]);
  });

  test('menu items have tap regions inside the canvas', async ({ page }) => {
    await openFresh(page);
    await loginWithTouch(page);
    const s = await snap(page);
    const size = await page.evaluate(() => ({ w: gameCanvas.width, h: gameCanvas.height }));
    expect(s.tapRegions.length).toBe(s.menuOptions.length);
    for (const r of s.tapRegions) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(size.w);
      expect(r.y + r.h).toBeLessThanOrEqual(size.h);
      expect(r.h).toBeGreaterThanOrEqual(30); // finger-sized rows
    }
  });

  test('touch controls are hidden in the menu and shown only while playing (buttons mode)', async ({ page }) => {
    await openFresh(page, { controlMode: 'buttons' });
    await loginWithTouch(page);
    for (const sel of Object.values(BUTTONS)) await expect(page.locator(sel)).toBeHidden();
    await startByTap(page);
    for (const sel of Object.values(BUTTONS)) await expect(page.locator(sel)).toBeVisible();
    await page.locator(BUTTONS.pause).tap();
    await waitForState(page, 'paused');
    for (const sel of Object.values(BUTTONS)) await expect(page.locator(sel)).toBeHidden();
  });

  test('tapping Start starts the game with sensible state', async ({ page }) => {
    await openFresh(page);
    await loginWithTouch(page);
    await startByTap(page);
    const s = await snap(page);
    expect(s.score).toBe(0);
    expect(s.level).toBe(1);
    expect(s.lives).toBeGreaterThan(0);
    expect(s.counts.asteroids).toBeGreaterThan(0);
  });

  test('tapping the left/right part of the Difficulty row cycles it', async ({ page }) => {
    await openFresh(page);
    await loginWithTouch(page);
    expect(await hook(page, 'difficulty')).toBe('medium');
    await tapAt(page, await tapRegionPoint(page, MENU.DIFFICULTY, 0.1));
    await expect.poll(() => hook(page, 'difficulty')).toBe('easy');
    await tapAt(page, await tapRegionPoint(page, MENU.DIFFICULTY, 0.9));
    await expect.poll(() => hook(page, 'difficulty')).toBe('medium');
    await tapAt(page, await tapRegionPoint(page, MENU.DIFFICULTY, 0.9));
    await expect.poll(() => hook(page, 'difficulty')).toBe('hard');
    await tapMenuItem(page, 'Difficulty'); // centre tap cycles forward (wraps)
    await expect.poll(() => hook(page, 'difficulty')).toBe('easy');
    expect(await hook(page, 'state')).toBe('menu');
    expect(await hook(page, 'menuIndex')).toBe(MENU.DIFFICULTY);
  });

  for (const [label, state] of [['Help', 'help'], ['High Scores', 'high_scores'], ['Achievements', 'achievements']]) {
    test(`tapping ${label} opens it and a tap anywhere returns to the menu`, async ({ page }) => {
      await openFresh(page);
      await loginWithTouch(page);
      await tapMenuItem(page, label);
      await waitForState(page, state);
      const canvasBox = await page.locator('#gameCanvas').boundingBox();
      await tapAt(page, { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height * 0.2 });
      await waitForState(page, 'menu');
    });
  }

  test('upgrades screen: tap an upgrade (stays) and tap Back (returns)', async ({ page }) => {
    await openFresh(page);
    await loginWithTouch(page);
    await tapMenuItem(page, 'Upgrades');
    await waitForState(page, 'upgrades');
    const regions = await hook(page, 'tapRegions');
    expect(regions.length).toBeGreaterThan(1);
    await tapAt(page, await tapRegionCenter(page, 1));
    await expect.poll(() => hook(page, 'upgradeIndex')).toBe(1);
    expect(await hook(page, 'state')).toBe('upgrades'); // no credits: purchase fails, stays
    await tapAt(page, await tapRegionCenter(page, regions.length - 1));
    await waitForState(page, 'menu');
  });
});

test.describe('touch: gameplay controls (buttons mode)', () => {
  test.beforeEach(async ({ page }) => {
    await openFresh(page, { controlMode: 'buttons' });
    await loginWithTouch(page);
    await startByTap(page);
  });

  test('holding rotate left / right changes the ship rotation', async ({ page, browserName }) => {
    const f = new Fingers(page, browserName);
    const r0 = await hook(page, 'ship.rotation');
    await f.down(1, BUTTONS.rotateLeft);
    await expect.poll(() => isPressed(page, 'rotateLeft')).toBe(true);
    await expect(page.locator(BUTTONS.rotateLeft)).toHaveClass(/active/);
    await expect.poll(() => hook(page, 'ship.rotation')).toBeLessThan(r0 - 0.2);
    await f.up(1);
    await expect.poll(() => isPressed(page, 'rotateLeft')).toBe(false);
    await expect(page.locator(BUTTONS.rotateLeft)).not.toHaveClass(/active/);

    const r1 = await hook(page, 'ship.rotation');
    await f.down(2, BUTTONS.rotateRight);
    await expect.poll(() => hook(page, 'ship.rotation')).toBeGreaterThan(r1 + 0.2);
    await f.up(2);
    await expect.poll(() => isPressed(page, 'rotateRight')).toBe(false);
  });

  test('multi-touch: thrust + fire + rotate held together all register', async ({ page, browserName }) => {
    const f = new Fingers(page, browserName);
    await f.down(1, BUTTONS.thrust);
    await f.down(2, BUTTONS.fire);
    await f.down(3, BUTTONS.rotateLeft);
    await expect.poll(async () => ({
      thrust: await isPressed(page, 'thrust'),
      fire: await isPressed(page, 'fire'),
      rotateLeft: await isPressed(page, 'rotateLeft'),
    })).toEqual({ thrust: true, fire: true, rotateLeft: true });
    await expect.poll(() => hook(page, 'ship.isThrusting')).toBe(true);
    // Lift one finger: others stay held
    await f.up(2);
    await expect.poll(() => isPressed(page, 'fire')).toBe(false);
    expect(await isPressed(page, 'thrust')).toBe(true);
    expect(await isPressed(page, 'rotateLeft')).toBe(true);
    await f.releaseAll();
    await expect.poll(async () => (await isPressed(page, 'thrust')) || (await isPressed(page, 'rotateLeft'))).toBe(false);
  });

  test('sliding a finger from rotate left to rotate right switches the action', async ({ page, browserName }) => {
    const f = new Fingers(page, browserName);
    await f.down(1, BUTTONS.rotateLeft);
    await expect.poll(() => isPressed(page, 'rotateLeft')).toBe(true);
    await f.moveTo(1, BUTTONS.rotateRight);
    await expect.poll(() => isPressed(page, 'rotateRight')).toBe(true);
    expect(await isPressed(page, 'rotateLeft')).toBe(false);
    await expect(page.locator(BUTTONS.rotateRight)).toHaveClass(/active/);
    await expect(page.locator(BUTTONS.rotateLeft)).not.toHaveClass(/active/);
    const r = await hook(page, 'ship.rotation');
    await expect.poll(() => hook(page, 'ship.rotation')).toBeGreaterThan(r + 0.1);
    await f.up(1);
    await expect.poll(() => isPressed(page, 'rotateRight')).toBe(false);
  });

  test('thrust button accelerates the ship', async ({ page, browserName }) => {
    const f = new Fingers(page, browserName);
    await f.down(1, BUTTONS.thrust);
    await expect.poll(() => hook(page, 'ship.velY')).toBeLessThan(-0.5);
    await f.up(1);
    await expect.poll(() => hook(page, 'ship.isThrusting')).toBe(false);
  });

  test('holding fire creates player bullets', async ({ page, browserName }) => {
    const f = new Fingers(page, browserName);
    expect(await hook(page, 'counts.playerBullets')).toBe(0);
    await f.down(1, BUTTONS.fire);
    await expect.poll(() => hook(page, 'counts.playerBullets')).toBeGreaterThanOrEqual(2);
    await f.up(1);
  });

  test('a short (~100ms) tap on fire shoots', async ({ page, browserName }) => {
    const f = new Fingers(page, browserName);
    await f.down(1, BUTTONS.fire);
    await page.waitForTimeout(100);
    await f.up(1);
    await expect.poll(() => hook(page, 'counts.playerBullets'), { timeout: 2000 }).toBeGreaterThanOrEqual(1);
  });

  test('pause button pauses; tapping Resume resumes', async ({ page }) => {
    await page.locator(BUTTONS.pause).tap();
    await waitForState(page, 'paused');
    const options = await hook(page, 'tapRegions');
    expect(options.length).toBe(3);
    await tapAt(page, await tapRegionCenter(page, 0)); // Resume
    await waitForState(page, 'playing');
    await expect(page.locator(BUTTONS.fire)).toBeVisible();
  });

  test('pause -> Main Menu -> Resume via taps', async ({ page }) => {
    await page.locator(BUTTONS.pause).tap();
    await waitForState(page, 'paused');
    await tapAt(page, await tapRegionCenter(page, 2)); // Main Menu
    await waitForState(page, 'menu');
    await expect.poll(() => hook(page, 'menuOptions.0')).toBe('Resume');
    await tapMenuItem(page, 'Resume');
    await waitForState(page, 'playing');
  });

  test('pause -> Restart via taps', async ({ page }) => {
    await page.locator(BUTTONS.pause).tap();
    await waitForState(page, 'paused');
    await tapAt(page, await tapRegionCenter(page, 1)); // Restart
    await waitForState(page, 'playing');
    expect(await hook(page, 'score')).toBe(0);
  });

  test('mute button toggles mute', async ({ page }) => {
    expect(await hook(page, 'isMuted')).toBe(false);
    await page.locator(BUTTONS.toggleMute).tap();
    await expect.poll(() => hook(page, 'isMuted')).toBe(true);
    await page.locator(BUTTONS.toggleMute).tap();
    await expect.poll(() => hook(page, 'isMuted')).toBe(false);
    expect(await hook(page, 'state')).toBe('playing');
  });

  test('hyperspace button moves the ship (or self-destructs, 10%)', async ({ page }) => {
    const s0 = await hook(page, 'ship');
    await page.locator(BUTTONS.hyperspace).tap();
    await expect.poll(async () => {
      const s = await snap(page);
      if (!s.ship || !s.ship.isAlive) return 'died';
      return Math.hypot(s.ship.x - s0.x, s.ship.y - s0.y) > 20 ? 'moved' : 'still';
    }).not.toBe('still');
  });

  test('tapping the canvas during play does not fire or pause', async ({ page }) => {
    const box = await page.locator('#gameCanvas').boundingBox();
    await tapAt(page, { x: box.x + box.width / 2, y: box.y + box.height / 3 });
    await page.waitForTimeout(200);
    const s = await snap(page);
    expect(s.state).toBe('playing');
    expect(s.counts.playerBullets).toBe(0);
  });
});

for (const mode of ['buttons', 'joystick']) {
  test.describe(`touch: layout (${mode} mode)`, () => {
    test.beforeEach(async ({ page }) => {
      await openFresh(page, { controlMode: mode });
      await loginWithTouch(page);
      await startByTap(page);
    });

    test('buttons do not overlap each other or the canvas and are inside the viewport', async ({ page }) => {
      const vp = page.viewportSize();
      const canvas = await page.locator('#gameCanvas').boundingBox();
      const boxes = {};
      for (const [action, sel] of Object.entries(visibleButtons(mode))) {
        const b = await page.locator(sel).boundingBox();
        expect(b, sel).not.toBeNull();
        boxes[action] = b;
        expect(b.x, `${sel} left`).toBeGreaterThanOrEqual(0);
        expect(b.y, `${sel} top`).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, `${sel} right`).toBeLessThanOrEqual(vp.width);
        expect(b.y + b.height, `${sel} bottom`).toBeLessThanOrEqual(vp.height);
        expect(Math.min(b.width, b.height), `${sel} >= 44px touch target`).toBeGreaterThanOrEqual(44);
      }
      const names = Object.keys(boxes);
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          expect(rectsOverlap(boxes[names[i]], boxes[names[j]]), `${names[i]} overlaps ${names[j]}`).toBe(false);
        }
      }
      // Allow a few px of bounding-box overlap (buttons are circles, so the box corner is empty)
      const TOL = 6;
      const inset = { x: canvas.x + TOL, y: canvas.y + TOL, width: canvas.width - 2 * TOL, height: canvas.height - 2 * TOL };
      const covering = names.filter((n) => rectsOverlap(boxes[n], inset))
        .map((n) => `${n}: button ${JSON.stringify(boxes[n])} canvas ${JSON.stringify(canvas)}`);
      expect(covering, 'touch buttons covering the play area').toEqual([]);
    });

    test('buttons hit-test to themselves (nothing on top of them)', async ({ page }) => {
      for (const [action, sel] of Object.entries(visibleButtons(mode))) {
        const hit = await page.evaluate((q) => {
          const r = document.querySelector(q).getBoundingClientRect();
          const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          const btn = el && el.closest('.touch-btn');
          return btn ? btn.dataset.action : (el ? `${el.tagName}#${el.id}` : null);
        }, sel);
        expect(hit, sel).toBe(action);
      }
    });

    test('canvas and controls fit the viewport without page scroll', async ({ page }) => {
      const m = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight,
        iw: window.innerWidth, ih: window.innerHeight, sx: window.scrollX, sy: window.scrollY,
      }));
      expect(m.sw).toBeLessThanOrEqual(m.iw);
      expect(m.sh).toBeLessThanOrEqual(m.ih);
      expect(m.sx).toBe(0);
      expect(m.sy).toBe(0);
      const c = await page.locator('#gameCanvas').boundingBox();
      expect(c.y + c.height).toBeLessThanOrEqual(m.ih);
      expect(c.x + c.width).toBeLessThanOrEqual(m.iw);
    });
  });
}

test.describe('touch: screenshots for review', () => {
  test('menu and in-game screenshots (buttons mode)', async ({ page }, testInfo) => {
    const name = testInfo.project.name;
    await openFresh(page, { controlMode: 'buttons' });
    await waitForState(page, 'prompt_user');
    await page.screenshot({ path: `tests/screenshots/${name}-prompt.png` });
    await loginWithTouch(page);
    await page.screenshot({ path: `tests/screenshots/${name}-menu.png` });
    await startByTap(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `tests/screenshots/${name}-ingame.png` });
    await page.locator(BUTTONS.pause).tap();
    await waitForState(page, 'paused');
    await page.screenshot({ path: `tests/screenshots/${name}-paused.png` });
  });
});

// ---------------------------------------------------------------------------
// Drag-to-steer joystick (default touch scheme)
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
/** Absolute angular distance between two angles (radians, any winding). */
const angDist = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
// The game ignores aim changes below 0.1 rad (short drags) / 0.04 rad (long drags) to
// filter finger tremor, so the ship may settle a few degrees off the exact drag angle.
const ROT_TOL = 0.12;

/** A point inside the joystick zone, as fractions of the zone box. */
async function zonePoint(page, fx = 0.5, fy = 0.6) {
  const box = await page.locator('#joystick-zone').boundingBox();
  expect(box, 'joystick zone box').not.toBeNull();
  return { x: Math.round(box.x + box.width * fx), y: Math.round(box.y + box.height * fy) };
}

test.describe('touch: control scheme selection', () => {
  test('default mode is joystick with empty storage', async ({ page }) => {
    await openFresh(page);
    await loginWithTouch(page);
    expect(await hook(page, 'controlMode')).toBe('joystick');
    await expect(page.locator('body')).toHaveClass(/controls-joystick/);
    await expect(page.locator('body')).not.toHaveClass(/controls-buttons/);
    expect(await page.evaluate((k) => localStorage.getItem(k), CONTROL_MODE_KEY)).toBeNull();
  });

  test('joystick mode: zone, fire, hyperspace, pause, mute shown; rotate and thrust hidden', async ({ page }) => {
    await openFresh(page);
    await loginWithTouch(page);
    await expect(page.locator('#joystick-zone')).toBeHidden(); // not in the menu
    await startByTap(page);
    await expect(page.locator('#joystick-zone')).toBeVisible();
    await expect(page.locator('#joystick-base')).toBeVisible(); // resting hint
    await expect(page.locator('.touch-left')).toBeHidden();
    for (const a of JOYSTICK_HIDDEN) await expect(page.locator(BUTTONS[a]), a).toBeHidden();
    for (const a of JOYSTICK_VISIBLE) await expect(page.locator(BUTTONS[a]), a).toBeVisible();
    await page.locator(BUTTONS.pause).tap();
    await waitForState(page, 'paused');
    await expect(page.locator('#joystick-zone')).toBeHidden();
  });

  test('buttons mode: all buttons shown, joystick zone hidden', async ({ page }) => {
    await openFresh(page, { controlMode: 'buttons' });
    await loginWithTouch(page);
    await startByTap(page);
    await expect(page.locator('#joystick-zone')).toBeHidden();
    await expect(page.locator('#joystick-base')).toBeHidden();
    for (const sel of Object.values(BUTTONS)) await expect(page.locator(sel)).toBeVisible();
  });

  test('changing Controls in Settings switches the scheme (and it applies in game)', async ({ page }) => {
    await openFresh(page);
    await loginWithTouch(page);
    let back = await toggleSettingByTap(page, 'controls');
    await expect.poll(() => hook(page, 'controlMode')).toBe('buttons');
    await expect(page.locator('body')).toHaveClass(/controls-buttons/);
    await expect(page.locator('body')).not.toHaveClass(/controls-joystick/);
    expect(await hook(page, 'state')).toBe('settings');
    expect(await page.evaluate((k) => localStorage.getItem(k), CONTROL_MODE_KEY)).toBe('buttons');
    await back();
    await startByTap(page);
    await expect(page.locator(BUTTONS.thrust)).toBeVisible();
    await expect(page.locator('#joystick-zone')).toBeHidden();

    // Pause -> Main Menu -> Settings -> Controls -> Back -> Resume: switches mid-game
    await page.locator(BUTTONS.pause).tap();
    await waitForState(page, 'paused');
    await tapAt(page, await tapRegionCenter(page, 2)); // Main Menu
    await waitForState(page, 'menu');
    back = await toggleSettingByTap(page, 'controls');
    await expect.poll(() => hook(page, 'controlMode')).toBe('joystick');
    await expect(page.locator('body')).toHaveClass(/controls-joystick/);
    await back();
    await tapMenuItem(page, 'Resume');
    await waitForState(page, 'playing');
    await expect(page.locator('#joystick-zone')).toBeVisible();
    await expect(page.locator(BUTTONS.thrust)).toBeHidden();
  });

  test('joystick zone sits below the top bar and does not cover fire/hyperspace/pause/mute', async ({ page }) => {
    await openFresh(page);
    await loginWithTouch(page);
    await startByTap(page);
    const vp = page.viewportSize();
    const zone = await page.locator('#joystick-zone').boundingBox();
    expect(zone.x).toBeGreaterThanOrEqual(0);
    expect(zone.y).toBeGreaterThanOrEqual(70);
    expect(zone.x + zone.width).toBeLessThanOrEqual(vp.width / 2 + 1);
    expect(zone.y + zone.height).toBeLessThanOrEqual(vp.height);
    for (const a of JOYSTICK_VISIBLE) {
      const hit = await page.evaluate((q) => {
        const r = document.querySelector(q).getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const btn = el && el.closest('.touch-btn');
        return btn ? btn.dataset.action : (el ? `${el.tagName}#${el.id}` : null);
      }, BUTTONS[a]);
      expect(hit, BUTTONS[a]).toBe(a);
      const b = await page.locator(BUTTONS[a]).boundingBox();
      expect(rectsOverlap(zone, b), `zone overlaps ${a}`).toBe(false);
    }
    // And the zone itself is what a finger in the left half hits
    const p = await zonePoint(page);
    expect(await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return !!(el && el.closest('.joystick-zone'));
    }, [p.x, p.y])).toBe(true);
  });
});

test.describe('touch: joystick steering', () => {
  // A red asteroid can occasionally hit the ship mid-test (respawn resets rotation/velocity)
  test.describe.configure({ retries: 2 });

  test.beforeEach(async ({ page }) => {
    await openFresh(page);
    await loginWithTouch(page);
    await startByTap(page);
    expect(await hook(page, 'controlMode')).toBe('joystick');
  });

  test('drag right: ship turns to face right (~0 rad) and accelerates right', async ({ page, browserName }) => {
    const f = new Fingers(page, browserName);
    const p = await zonePoint(page);
    await f.downAt(1, p);
    await f.moveBy(1, 50, 0);
    await expect.poll(() => hook(page, 'joystick.active')).toBe(true);
    const j = await hook(page, 'joystick');
    expect(angDist(j.angle, 0)).toBeLessThan(0.05);
    expect(j.magnitude).toBeCloseTo(50 / 60, 1);
    await expect.poll(async () => angDist(await hook(page, 'ship.rotation'), 0), { timeout: 2000 }).toBeLessThan(ROT_TOL);
    await expect.poll(() => hook(page, 'ship.isThrusting')).toBe(true);
    await expect.poll(() => hook(page, 'ship.velX')).toBeGreaterThan(0.5);
    const s = await hook(page, 'ship');
    expect(s.isAlive).toBe(true);
    expect(Math.abs(s.velY)).toBeLessThan(s.velX);
    await f.releaseAll();
  });

  test('drag up: ship turns to face up (~-PI/2) and accelerates up', async ({ page, browserName }) => {
    const f = new Fingers(page, browserName);
    const p = await zonePoint(page);
    // First turn left with a medium drag (magnitude ~0.33: steers, but below the thrust threshold)
    await f.downAt(1, p);
    await f.moveBy(1, -20, 0);
    await expect.poll(async () => angDist(await hook(page, 'ship.rotation'), Math.PI), { timeout: 2000 }).toBeLessThan(ROT_TOL);
    let s = await hook(page, 'ship');
    expect(s.isThrusting).toBe(false);
    expect(Math.hypot(s.velX, s.velY)).toBeLessThan(0.01);
    await f.up(1);
    await expect.poll(() => hook(page, 'joystick.active')).toBe(false);

    await f.downAt(2, p);
    await f.moveBy(2, 0, -50);
    const j = await hook(page, 'joystick');
    expect(angDist(j.angle, -Math.PI / 2)).toBeLessThan(0.05);
    await expect.poll(async () => angDist(await hook(page, 'ship.rotation'), -Math.PI / 2), { timeout: 2000 }).toBeLessThan(ROT_TOL);
    const rot = await hook(page, 'ship.rotation');
    expect((((rot % TAU) + TAU) % TAU)).toBeCloseTo(1.5 * Math.PI, 1);
    await expect.poll(() => hook(page, 'ship.velY')).toBeLessThan(-0.5);
    s = await hook(page, 'ship');
    expect(Math.abs(s.velX)).toBeLessThan(Math.abs(s.velY));
    await f.releaseAll();
  });

  test('a short drag (< 12px, inside the dead zone) does nothing', async ({ page, browserName }) => {
    const f = new Fingers(page, browserName);
    const s0 = await hook(page, 'ship');
    const p = await zonePoint(page);
    await f.downAt(1, p);
    await f.moveBy(1, 8, 0, 2); // to the right: would turn the (upward-facing) ship if it counted
    await expect.poll(() => hook(page, 'joystick.active')).toBe(true);
    expect(await hook(page, 'joystick.magnitude')).toBeLessThan(0.2);
    await page.waitForTimeout(400);
    const s = await hook(page, 'ship');
    expect(s.rotation).toBe(s0.rotation);
    expect(s.isThrusting).toBe(false);
    expect(s.velX).toBe(0);
    expect(s.velY).toBe(0);
    await f.releaseAll();
  });

  test('a ~40px drag (magnitude ~0.67) thrusts', async ({ page, browserName }) => {
    const f = new Fingers(page, browserName);
    const p = await zonePoint(page);
    await f.downAt(1, p);
    await f.moveBy(1, 0, -40); // ship already faces up, so it thrusts straight away
    await expect.poll(() => hook(page, 'joystick.active')).toBe(true);
    expect(await hook(page, 'joystick.magnitude')).toBeCloseTo(40 / 60, 1);
    await expect.poll(() => hook(page, 'ship.isThrusting')).toBe(true);
    await expect.poll(() => hook(page, 'ship.velY')).toBeLessThan(-0.3);
    await f.releaseAll();
  });

  test('releasing the finger deactivates the stick and stops thrust', async ({ page, browserName }) => {
    const f = new Fingers(page, browserName);
    const p = await zonePoint(page);
    await f.downAt(1, p);
    await f.moveBy(1, 0, -55);
    await expect.poll(() => hook(page, 'ship.isThrusting')).toBe(true);
    await f.up(1);
    await expect.poll(() => hook(page, 'joystick.active')).toBe(false);
    await expect.poll(() => hook(page, 'ship.isThrusting')).toBe(false);
    // Ship keeps its heading after release (no drift back to a default)
    const r = await hook(page, 'ship.rotation');
    await page.waitForTimeout(200);
    expect(await hook(page, 'ship.rotation')).toBe(r);
  });

  test('multi-touch: hold the joystick and fire together', async ({ page, browserName }) => {
    const f = new Fingers(page, browserName);
    const p = await zonePoint(page);
    await f.downAt(1, p);
    await f.moveBy(1, 50, 0);
    const fireBtn = page.locator(BUTTONS.fire);
    const idleBg = await fireBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
    await f.down(2, BUTTONS.fire);
    await expect.poll(() => isPressed(page, 'fire')).toBe(true);
    await expect(fireBtn).toHaveClass(/active/);
    // Pressed feedback: the fire button background changes while held
    await expect.poll(() => fireBtn.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(idleBg);
    await expect.poll(() => hook(page, 'counts.playerBullets')).toBeGreaterThanOrEqual(2);
    // Still steering while firing
    const j = await hook(page, 'joystick');
    expect(j.active).toBe(true);
    expect(angDist(j.angle, 0)).toBeLessThan(0.05);
    await expect.poll(async () => angDist(await hook(page, 'ship.rotation'), 0), { timeout: 2000 }).toBeLessThan(ROT_TOL);
    // Lift fire: the stick stays held
    await f.up(2);
    await expect.poll(() => isPressed(page, 'fire')).toBe(false);
    expect(await hook(page, 'joystick.active')).toBe(true);
    await f.up(1);
    await expect.poll(() => hook(page, 'joystick.active')).toBe(false);
  });

  test('a second finger in the zone does not hijack the stick', async ({ page, browserName }) => {
    const f = new Fingers(page, browserName);
    const p = await zonePoint(page, 0.5, 0.7);
    await f.downAt(1, p);
    await f.moveBy(1, 40, 0);
    await expect.poll(() => hook(page, 'joystick.active')).toBe(true);
    const base = page.locator('#joystick-base');
    const left0 = await base.evaluate((el) => el.style.left);

    await f.downAt(2, await zonePoint(page, 0.3, 0.3));
    await f.moveBy(2, 0, 60);
    const j = await hook(page, 'joystick');
    expect(j.active).toBe(true);
    expect(angDist(j.angle, 0)).toBeLessThan(0.05);
    expect(j.magnitude).toBeCloseTo(40 / 60, 1);
    expect(await base.evaluate((el) => el.style.left)).toBe(left0);
    await expect.poll(async () => angDist(await hook(page, 'ship.rotation'), 0), { timeout: 2000 }).toBeLessThan(ROT_TOL);

    // Lifting the second finger does not release the stick
    await f.up(2);
    await page.waitForTimeout(100);
    expect(await hook(page, 'joystick.active')).toBe(true);
    // The first finger still steers
    await f.moveBy(1, -40, 40); // now straight down from the origin
    await expect.poll(async () => angDist(await hook(page, 'joystick.angle'), Math.PI / 2)).toBeLessThan(0.05);
    await f.up(1);
    await expect.poll(() => hook(page, 'joystick.active')).toBe(false);
  });

  test('joystick visuals follow the finger and reset on release', async ({ page, browserName }) => {
    const f = new Fingers(page, browserName);
    const base = page.locator('#joystick-base');
    const knob = page.locator('#joystick-knob');
    await expect(base).not.toHaveClass(/active/);
    const p = await zonePoint(page);
    await f.downAt(1, p);
    await expect(base).toHaveClass(/active/);
    await f.moveBy(1, 30, 0);
    await expect(base).toHaveClass(/active/);
    // Base centred on the touch origin, knob pushed toward the drag
    const b = await base.boundingBox();
    expect(Math.abs(b.x + b.width / 2 - p.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(b.y + b.height / 2 - p.y)).toBeLessThanOrEqual(2);
    const k = await knob.boundingBox();
    expect(k.x + k.width / 2 - p.x).toBeGreaterThan(20);
    expect(Math.abs(k.y + k.height / 2 - p.y)).toBeLessThanOrEqual(2);
    await f.up(1);
    await expect(base).not.toHaveClass(/active/);
    expect(await base.evaluate((el) => el.style.left)).toBe('');
    expect(await knob.evaluate((el) => el.style.transform)).toBe('');
  });

  test('pausing while dragging releases the stick (no ghost steering after resume)', async ({ page, browserName }) => {
    const f = new Fingers(page, browserName);
    const p = await zonePoint(page);
    await f.downAt(1, p);
    await f.moveBy(1, 0, -55);
    await expect.poll(() => hook(page, 'ship.isThrusting')).toBe(true);

    await f.down(2, BUTTONS.pause);
    await waitForState(page, 'paused');
    await f.up(2);
    expect(await hook(page, 'joystick.active')).toBe(false);
    await expect(page.locator('#joystick-base')).not.toHaveClass(/active/);

    // Resume with another finger while the first is still down, then move the first finger
    const resume = await tapRegionCenter(page, 0);
    await f.downAt(3, resume);
    await f.up(3);
    await waitForState(page, 'playing');
    const r = await hook(page, 'ship.rotation');
    await f.moveBy(1, 50, 0);
    await page.waitForTimeout(300);
    expect(await hook(page, 'joystick.active')).toBe(false);
    const s = await hook(page, 'ship');
    expect(s.isThrusting).toBe(false);
    expect(s.rotation).toBe(r);
    await f.up(1);
  });
});

test.describe('touch: joystick and viewport changes', () => {
  test('a viewport resize (e.g. rotation) while dragging releases the stick', async ({ page, browserName }) => {
    await openFresh(page);
    await loginWithTouch(page);
    await startByTap(page);
    const f = new Fingers(page, browserName);
    await f.downAt(1, await zonePoint(page));
    await f.moveBy(1, 0, -55);
    await expect.poll(() => hook(page, 'ship.isThrusting')).toBe(true);
    const vp = page.viewportSize();
    await page.setViewportSize({ width: vp.height, height: vp.width }); // rotate the device
    await expect.poll(() => hook(page, 'joystick.active')).toBe(false);
    await expect(page.locator('#joystick-base')).not.toHaveClass(/active/);
    await expect.poll(() => hook(page, 'ship.isThrusting')).toBe(false);
    // The held finger moving afterwards does not re-grab the stick
    await f.moveBy(1, 30, 0);
    await page.waitForTimeout(150);
    expect(await hook(page, 'joystick.active')).toBe(false);
    await f.releaseAll();
    // A fresh touch in the (re-laid-out) zone works again
    await f.downAt(2, await zonePoint(page));
    await f.moveBy(2, 40, 0);
    await expect.poll(() => hook(page, 'joystick.active')).toBe(true);
    await f.releaseAll();
    await expect.poll(() => hook(page, 'joystick.active')).toBe(false);
  });
});

test.describe('touch: joystick and toolbar resizes', () => {
  test('a resize that keeps the canvas size and orientation (toolbar collapse) keeps the stick', async ({ page, browserName }) => {
    await openFresh(page);
    await loginWithTouch(page);
    await startByTap(page);
    const f = new Fingers(page, browserName);
    await f.downAt(1, await zonePoint(page));
    await f.moveBy(1, 0, -55);
    await expect.poll(() => hook(page, 'joystick.active')).toBe(true);
    const vp = page.viewportSize();
    const before = await hook(page, 'view');
    // Grow the longer side a little (like Safari's toolbar collapsing): min side unchanged
    const grow = vp.width > vp.height ? { width: vp.width + 40, height: vp.height } : { width: vp.width, height: vp.height + 40 };
    await page.setViewportSize(grow);
    await page.waitForTimeout(200);
    const after = await hook(page, 'view');
    expect([after.width, after.height, after.backingWidth]).toEqual([before.width, before.height, before.backingWidth]);
    expect(await hook(page, 'joystick.active')).toBe(true);
    await f.releaseAll();
    await expect.poll(() => hook(page, 'joystick.active')).toBe(false);
  });
});

test.describe('touch: joystick screenshots for review', () => {
  test('joystick mode while dragging', async ({ page, browserName }, testInfo) => {
    const name = testInfo.project.name;
    await openFresh(page);
    await loginWithTouch(page);
    await startByTap(page);
    const f = new Fingers(page, browserName);
    const p = await zonePoint(page);
    await f.downAt(1, p);
    await f.moveBy(1, 35, -35);
    await expect(page.locator('#joystick-base')).toHaveClass(/active/);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tests/screenshots/${name}-joystick-drag.png` });
    await f.releaseAll();
  });
});
