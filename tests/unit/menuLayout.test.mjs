import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    stackRows, screenTitleLayout, isCompact, exitRegionOk, MIN_EXIT_TAP, COMPACT_HEIGHT,
} from '../../js/menuLayout.js';

const PHONE = 351; // 90% of a 390 x 844 phone's width
const last = (l) => l.rows[l.rows.length - 1];

test('stackRows keeps the preferred pitch when the rows fit', () => {
    const l = stackRows({ count: 6, top: 150, bottom: 736, maxStep: 55, lastMin: 39, lastMax: 45 });
    assert.equal(l.fits, true);
    assert.equal(l.step, 55);
    assert.deepEqual(l.rows.slice(0, 2), [{ y: 150, h: 55 }, { y: 205, h: 55 }]);
    assert.deepEqual(last(l), { y: 150 + 5 * 55, h: 45 });
});

test('stackRows shrinks rows to fit and keeps the last (Back) row inside and tappable', () => {
    // Upgrades on a phone: 5 upgrades + Back between y 83 and 287
    const l = stackRows({ count: 6, top: 83, bottom: 287, maxStep: 55, lastMin: MIN_EXIT_TAP + 5, lastMax: 45 });
    assert.equal(l.fits, false);
    const b = last(l);
    assert.ok(b.y + b.h <= 287 + 1e-9, 'Back ends above the bottom');
    assert.ok(b.h >= MIN_EXIT_TAP + 5);
    assert.ok(l.step < 55);
    // Rows do not overlap and start at top
    assert.equal(l.rows[0].y, 83);
    for (let i = 1; i < l.rows.length; i++) assert.ok(l.rows[i].y >= l.rows[i - 1].y + l.rows[i - 1].h - 1e-9);
});

test('stackRows: many rows (Multiplayer modes + Back) on a phone', () => {
    const gap = 4;
    const l = stackRows({ count: 7, top: 73, bottom: PHONE - 34 + gap, maxStep: 96 + gap, lastMin: MIN_EXIT_TAP + gap, lastMax: 44 + gap });
    const b = last(l);
    assert.ok(b.y + b.h - gap <= PHONE - 34 + 1e-9);
    assert.ok(b.h - gap >= MIN_EXIT_TAP - 1e-9);
});

test('stackRows: desktop mode select keeps a 44 px Back under larger mode boxes', () => {
    const l = stackRows({ count: 7, top: 156, bottom: 800 - 34 + 8, maxStep: 104, lastMin: MIN_EXIT_TAP + 8, lastMax: 52 });
    assert.equal(last(l).h, 52);
    assert.ok(Math.abs(l.step - (618 - 52) / 6) < 1e-9);
});

test('stackRows: uniform rows without a last-row limit', () => {
    const l = stackRows({ count: 4, top: 0, bottom: 100, maxStep: 55 });
    assert.equal(l.step, 25);
    assert.ok(l.rows.every((r) => r.h === 25));
});

test('stackRows edge cases', () => {
    assert.deepEqual(stackRows({ count: 0, top: 0, bottom: 100, maxStep: 40 }), { step: 0, rows: [], fits: true });
    const one = stackRows({ count: 1, top: 10, bottom: 30, maxStep: 40, lastMin: 34 });
    assert.deepEqual(one.rows, [{ y: 10, h: 20 }]); // never beyond the bottom
    const none = stackRows({ count: 3, top: 50, bottom: 40, maxStep: 40 });
    assert.ok(none.rows.every((r) => r.h === 0 && r.y === 50));
});

test('screenTitleLayout: compact on a phone, unchanged on larger screens', () => {
    assert.equal(isCompact(PHONE), true);
    assert.equal(isCompact(COMPACT_HEIGHT), false);
    const big = screenTitleLayout(720, true);
    assert.equal(big.titleY, 720 * 0.12);
    assert.equal(big.contentTop, 720 * 0.12 + 50);
    assert.equal(screenTitleLayout(720, false).contentTop, 720 * 0.12 + 30);
    const small = screenTitleLayout(PHONE, true);
    assert.ok(small.contentTop < big.titleY + 50 - 20);
    assert.match(small.titleFont, /28px/);
});

test('exitRegionOk', () => {
    assert.equal(exitRegionOk({ x: 10, y: 300, w: 200, h: 34 }, PHONE, PHONE), true);
    assert.equal(exitRegionOk({ x: 10, y: 330, w: 200, h: 34 }, PHONE, PHONE), false); // below the canvas
    assert.equal(exitRegionOk({ x: 10, y: 100, w: 200, h: 20 }, PHONE, PHONE), false); // too short
    assert.equal(exitRegionOk(null, PHONE, PHONE), false);
});
