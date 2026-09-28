import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    valueRowArrows, valueRowHit, valueRowStep, MIN_ARROW_W, ARROW_FRACTION,
} from '../../js/valueRow.js';

const PHONE = 351; // logical canvas of a 390 x 844 phone (90% of its width)

// Row geometries the game uses: Settings (10%..90%), main-menu Difficulty (10%..90%),
// a lobby option row and a Time Attack row, on phone, iPad and desktop canvases.
const ROWS = [
    ['phone settings', PHONE * 0.1, PHONE * 0.8],
    ['iPad settings', 691 * 0.1, 691 * 0.8],
    ['desktop settings', 720 * 0.1, 720 * 0.8],
    ['phone lobby option', 20, PHONE - 40],
    ['phone Time Attack', 30, PHONE - 60],
    ['desktop Time Attack', 130, 460],
];

test('arrow targets are at least 44 px wide and sit at the ends of the row', () => {
    for (const [name, x, w] of ROWS) {
        const a = valueRowArrows(x, w);
        assert.ok(a.arrowW >= MIN_ARROW_W, `${name}: ${a.arrowW}`);
        assert.equal(a.left.x, x, name);
        assert.ok(Math.abs(a.right.x + a.right.w - (x + w)) < 1e-9, name);
        assert.ok(Math.abs(a.inner.x - (x + a.arrowW)) < 1e-9, name);
        assert.ok(Math.abs(a.inner.x + a.inner.w - a.right.x) < 1e-9, name);
        assert.ok(a.inner.w > 0, `${name}: room for the label and value`);
        // Glyphs are drawn at the target centres
        assert.ok(a.left.cx > a.left.x && a.left.cx < a.inner.x, name);
        assert.ok(a.right.cx > a.right.x && a.right.cx < x + w, name);
    }
});

test('a 390 px phone Settings row: 44+ px arrows, left arrow steps back, the rest forward', () => {
    const x = PHONE * 0.1;
    const w = PHONE * 0.8; // 280.8
    const a = valueRowArrows(x, w);
    assert.ok(Math.abs(a.arrowW - w * ARROW_FRACTION) < 1e-9); // 50.5 px
    assert.equal(valueRowStep(a.left.cx, x, w), -1, '◂ glyph');
    assert.equal(valueRowStep(x + 1, x, w), -1, 'left edge');
    assert.equal(valueRowStep(x + 43, x, w), -1, 'anywhere in the 44 px');
    assert.equal(valueRowStep(a.right.cx, x, w), 1, '▸ glyph');
    assert.equal(valueRowStep(x + w - 1, x, w), 1, 'right edge');
    assert.equal(valueRowStep(x + w / 2, x, w), 1, 'centre steps forward');
    assert.equal(valueRowHit(a.left.cx, x, w), 'left');
    assert.equal(valueRowHit(x + w / 2, x, w), 'centre');
    assert.equal(valueRowHit(a.right.cx, x, w), 'right');
});

test('the old bug: the ◂ drawn next to the value (right side) must not be the only back target', () => {
    // Before the fix "◂  5  ▸" was right-aligned at the row end, so the ◂ glyph was ~70 px from
    // the right edge, inside the "forward" part of the row. It is now at the left end.
    const x = PHONE * 0.1;
    const w = PHONE * 0.8;
    const oldGlyphX = x + w - 70;
    assert.equal(valueRowStep(oldGlyphX, x, w), 1);
    assert.ok(valueRowArrows(x, w).left.cx < x + w * 0.25, '◂ is drawn at the left end now');
});

test('the hit-test agrees with the drawn targets at many widths', () => {
    for (let w = 132; w <= 1200; w += 17) {
        const x = 13;
        const a = valueRowArrows(x, w);
        assert.equal(valueRowStep(a.left.cx, x, w), -1, `w=${w}`);
        assert.equal(valueRowStep(a.left.x + a.left.w - 0.01, x, w), -1, `w=${w}`);
        assert.equal(valueRowStep(a.inner.x + 0.01, x, w), 1, `w=${w}`);
        assert.equal(valueRowStep(a.right.cx, x, w), 1, `w=${w}`);
        assert.ok(a.arrowW >= MIN_ARROW_W - 1e-9, `w=${w}`);
    }
});

test('wide rows scale the arrows; tiny rows keep a middle (arrows at most a third each)', () => {
    assert.equal(valueRowArrows(0, 1000).arrowW, 180);
    assert.equal(valueRowArrows(0, 200).arrowW, MIN_ARROW_W);
    const tiny = valueRowArrows(0, 90);
    assert.equal(tiny.arrowW, 30);
    assert.equal(tiny.inner.w, 30);
    assert.equal(valueRowStep(10, 0, 90), -1);
    assert.equal(valueRowStep(45, 0, 90), 1);
    assert.equal(valueRowArrows(5, 0).arrowW, 0);
    assert.equal(valueRowArrows(5, -10).arrowW, 0);
});
