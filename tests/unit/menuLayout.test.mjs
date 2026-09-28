import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    stackRows, screenTitleLayout, isCompact, exitRegionOk, MIN_EXIT_TAP, COMPACT_HEIGHT,
    MIN_TAP, MENU_COLUMN_MIN, menuColumn, overlayInsets, fitFontPx, menuGrid,
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
    const l = stackRows({ count: 6, top: 83, bottom: 287, maxStep: 55, lastMin: MIN_EXIT_TAP + 5, lastMax: MIN_EXIT_TAP + 5 });
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

// --- Adaptive (non-square) screens ---

test('tap targets are at least 44 px', () => {
    assert.equal(MIN_TAP, 44);
    assert.equal(MIN_EXIT_TAP, 44);
});

test('menuColumn: centred, full height, about as wide as the view is tall', () => {
    assert.deepEqual(menuColumn(412, 892), { x: 0, y: 0, w: 412, h: 892 }); // portrait phone: all of it
    assert.deepEqual(menuColumn(892, 412), { x: (892 - MENU_COLUMN_MIN) / 2, y: 0, w: MENU_COLUMN_MIN, h: 412 });
    assert.deepEqual(menuColumn(1280, 800), { x: 240, y: 0, w: 800, h: 800 });
    assert.deepEqual(menuColumn(1024, 768), { x: 128, y: 0, w: 768, h: 768 });
    assert.deepEqual(menuColumn(810, 1080), { x: 0, y: 0, w: 810, h: 1080 });
    assert.deepEqual(menuColumn(3440, 1440), { x: 1000, y: 0, w: 1440, h: 1440 });
    assert.deepEqual(menuColumn(500, 500), { x: 0, y: 0, w: 500, h: 500 });
});

test('menuColumn: overlays shorten it; never by more than a quarter of the height', () => {
    assert.deepEqual(menuColumn(412, 892, { top: 90, bottom: 60 }), { x: 0, y: 90, w: 412, h: 892 - 150 });
    const c = menuColumn(412, 400, { top: 150, bottom: 50 });
    assert.equal(c.h, 300);
    assert.equal(c.y, 75); // the cut is shared in proportion
});

test('overlayInsets: app bar at the top right and a notice at the bottom push the column', () => {
    const canvas = { left: 0, top: 0, right: 412, bottom: 892 };
    const col = menuColumn(412, 892);
    const appBar = { left: 300, top: 8, right: 404, bottom: 86 };
    const toast = { left: 100, top: 830, right: 312, bottom: 882 };
    assert.deepEqual(overlayInsets(canvas, col, [appBar, toast]), { top: 90, bottom: 66 });
    // Hidden (empty) overlays and missing ones are ignored
    assert.deepEqual(overlayInsets(canvas, col, [null, { left: 0, top: 0, right: 0, bottom: 0 }]), { top: 0, bottom: 0 });
    // Desktop: the app bar sits beside the 800 px column and does not cover it
    const desk = { left: 0, top: 0, right: 1280, bottom: 800 };
    assert.deepEqual(overlayInsets(desk, menuColumn(1280, 800), [{ left: 1150, top: 8, right: 1272, bottom: 50 }]), { top: 0, bottom: 0 });
    // A canvas that does not start at the page origin (multiplayer side bars)
    const offset = { left: 173, top: 0, right: 907, bottom: 810 };
    const oc = menuColumn(734, 810);
    assert.deepEqual(overlayInsets(offset, oc, [{ left: 800, top: 8, right: 1072, bottom: 52 }]), { top: 56, bottom: 0 });
    assert.deepEqual(overlayInsets(null, oc, []), { top: 0, bottom: 0 });
});

test('fitFontPx: shrinks in proportion, never below the minimum', () => {
    assert.equal(fitFontPx(48, 300, 400), 48);
    assert.equal(fitFontPx(48, 480, 388), 38);
    assert.equal(fitFontPx(48, 4800, 100, 12), 12);
    assert.equal(fitFontPx(20, 100, 0), 20);
});

test('menuGrid: one column of >= 44 px rows when they fit, two on a short screen', () => {
    // Portrait phone: 10 rows in one column at the preferred pitch
    const tall = menuGrid({ count: 10, top: 229, bottom: 820, width: 396, maxPitch: 48 });
    assert.equal(tall.cols, 1);
    assert.equal(tall.pitch, 48);
    assert.ok(tall.fits);
    assert.deepEqual(tall.cells[1], { x: 0, y: 277, w: 396, h: 48 });
    // Landscape phone: 10 rows between y 101 and 340 need two columns of five
    const short = menuGrid({ count: 10, top: 101, bottom: 340, width: 560, maxPitch: 48 });
    assert.equal(short.cols, 2);
    assert.equal(short.perCol, 5);
    assert.ok(short.pitch >= MIN_TAP && short.fits);
    assert.deepEqual(short.cells[5], { x: 280, y: 101, w: 280, h: short.pitch });
    for (const c of short.cells) assert.ok(c.y + c.h <= 340 + 1e-9);
    // Too narrow for a second column: one column, rows shrink but stay inside
    const narrow = menuGrid({ count: 10, top: 0, bottom: 300, width: 250 });
    assert.equal(narrow.cols, 1);
    assert.equal(narrow.fits, false);
    assert.equal(narrow.pitch, 30);
    assert.deepEqual(menuGrid({ count: 0, top: 0, bottom: 100, width: 300 }).cells, []);
});
