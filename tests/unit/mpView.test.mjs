import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    HULL_MARKS, hullMarkFor, hullMarkShapes, sideBarWidth, touchLayout, hudMode, hudSide, compactHudCorner,
    edgeArrow, respawnFraction, isIpad, touchPointsWarning, MP_BAR_MIN, MP_HUD_BAR_MIN,
} from '../../js/mpView.js';

const R = 15;
// Point-in-triangle for the ship hull (nose (r,0), rear corners at ±140°)
function insideHull(x, y, r = R) {
    const a = (140 * Math.PI) / 180;
    const pts = [[r, 0], [r * Math.cos(a), r * Math.sin(a)], [r * Math.cos(a), -r * Math.sin(a)]];
    const sign = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
    const p = [x, y];
    const d1 = sign(p, pts[0], pts[1]);
    const d2 = sign(p, pts[1], pts[2]);
    const d3 = sign(p, pts[2], pts[0]);
    const neg = d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9;
    const pos = d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9;
    return !(neg && pos);
}

test('hull marks: one per seat, cycling after four, P1 unmarked', () => {
    assert.deepEqual(HULL_MARKS, ['none', 'stripe', 'dot', 'notch']);
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(hullMarkFor), ['none', 'stripe', 'dot', 'notch', 'none', 'stripe']);
    assert.equal(hullMarkFor(-1), 'notch');
    assert.equal(hullMarkFor(undefined), 'none');
});

test('hull mark shapes: none is empty, the others differ and stay inside the hull', () => {
    assert.deepEqual(hullMarkShapes('none', R), []);
    assert.deepEqual(hullMarkShapes('bogus', R), []);
    const kinds = new Set();
    for (const mark of ['stripe', 'dot', 'notch']) {
        const shapes = hullMarkShapes(mark, R);
        assert.ok(shapes.length > 0, mark);
        kinds.add(JSON.stringify(shapes.map((s) => s.type)));
        for (const s of shapes) {
            if (s.type === 'line') {
                assert.ok(insideHull(s.x1, s.y1) && insideHull(s.x2, s.y2), `${mark} line inside`);
            } else {
                for (const [dx, dy] of [[s.r, 0], [-s.r, 0], [0, s.r], [0, -s.r]]) {
                    assert.ok(insideHull(s.x + dx, s.y + dy), `${mark} circle inside`);
                }
            }
        }
    }
    assert.equal(kinds.size, 3, 'stripe, dot and notch look different');
    // Scales with the radius
    const a = hullMarkShapes('stripe', 10)[0];
    const b = hullMarkShapes('stripe', 20)[0];
    assert.ok(Math.abs(b.y2 - 2 * a.y2) < 1e-9);
});

test('side bars: the space beside the centred square canvas (plan §9 table)', () => {
    // canvas = 90% of the short side
    const cases = [
        [1024, 768, 166], // iPad 10.2" full screen
        [1080, 810, 175], // iPad gen 7 (test size)
        [1180, 820, 221], // iPad Air 11"
        [1366, 1024, 222], // iPad Pro 12.9"
        [1280, 800, 280], // 10" Android
    ];
    for (const [w, h, bar] of cases) {
        const canvas = Math.floor(Math.min(w, h) * 0.9);
        assert.equal(sideBarWidth(w, canvas), bar, `${w}x${h}`);
    }
    assert.equal(sideBarWidth(1024, 691, { left: 20, right: 20 }), 146);
    assert.equal(sideBarWidth(700, 800), 0);
});

test('touch layout: side by side in landscape with bars >= 120 px, else rotate; none without touch', () => {
    const at = (w, h, touch = true, safe = {}) => touchLayout({
        viewportW: w, viewportH: h, canvasSize: Math.floor(Math.min(w, h) * 0.9), safe, touch,
    });
    assert.deepEqual(at(1080, 810), { layout: 'sides', bar: 175, landscape: true });
    assert.deepEqual(at(810, 1080), { layout: 'rotate', bar: 40, landscape: false });
    assert.equal(at(1024, 768, false).layout, null);
    // A landscape phone: bars too narrow
    assert.equal(at(844, 390).layout, 'sides'); // 844 - 351 = 493 / 2 = 246
    assert.equal(at(1000, 900).layout, 'rotate'); // bar 95
    assert.equal(MP_BAR_MIN, 120);
    // Exactly at the threshold
    const canvas = 600;
    assert.equal(touchLayout({ viewportW: canvas + 2 * MP_BAR_MIN, viewportH: 667, canvasSize: canvas, touch: true }).layout, 'sides');
    assert.equal(touchLayout({ viewportW: canvas + 2 * MP_BAR_MIN - 2, viewportH: 667, canvasSize: canvas, touch: true }).layout, 'rotate');
});

test('HUD: DOM panels from 150 px bars, compact canvas HUD below; seats alternate sides', () => {
    assert.equal(hudMode(MP_HUD_BAR_MIN), 'dom');
    assert.equal(hudMode(149), 'canvas');
    assert.equal(hudMode(0), 'canvas');
    assert.deepEqual([0, 1, 2, 3].map(hudSide), ['left', 'right', 'left', 'right']);
    assert.deepEqual(compactHudCorner(0), { x: 'left', y: 'top' });
    assert.deepEqual(compactHudCorner(1), { x: 'right', y: 'top' });
    assert.deepEqual(compactHudCorner(2), { x: 'left', y: 'bottom' });
    assert.deepEqual(compactHudCorner(3), { x: 'right', y: 'bottom' });
});

test('edge arrows: none on screen; on the inset border pointing at the target otherwise', () => {
    assert.equal(edgeArrow(0, 0, 300, 300), null);
    assert.equal(edgeArrow(299, -299, 300, 300), null);
    assert.equal(edgeArrow(310, 0, 300, 300, { radius: 15 }), null); // partly visible
    const right = edgeArrow(900, 0, 300, 300, { inset: 24 });
    assert.deepEqual(right, { x: 276, y: 0, angle: 0 });
    const up = edgeArrow(0, -500, 300, 300, { inset: 24 });
    assert.ok(Math.abs(up.y + 276) < 1e-9 && up.x === 0);
    assert.ok(Math.abs(up.angle + Math.PI / 2) < 1e-12);
    // Diagonal: clamps on the nearer edge and keeps the direction
    const d = edgeArrow(600, 300, 300, 300, { inset: 0 });
    assert.ok(Math.abs(d.x - 300) < 1e-9 && Math.abs(d.y - 150) < 1e-9);
    assert.ok(Math.abs(d.angle - Math.atan2(300, 600)) < 1e-12);
    // Never outside the view
    for (let k = 0; k < 200; k++) {
        const a = (k / 200) * Math.PI * 2;
        const e = edgeArrow(Math.cos(a) * 2000, Math.sin(a) * 1000, 345, 345, { inset: 24 });
        assert.ok(Math.abs(e.x) <= 321 + 1e-9 && Math.abs(e.y) <= 321 + 1e-9);
    }
});

test('respawn ring fraction and device checks', () => {
    assert.equal(respawnFraction(2, 2), 1);
    assert.equal(respawnFraction(0.5, 2), 0.25);
    assert.equal(respawnFraction(0, 2), 0);
    assert.equal(respawnFraction(3, 2), 1);
    assert.equal(respawnFraction(1, 0), 0);
    assert.equal(isIpad({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X)' }), true);
    assert.equal(isIpad({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 }), true);
    assert.equal(isIpad({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 }), false);
    assert.equal(isIpad({ userAgent: 'Mozilla/5.0 (Linux; Android 13)', maxTouchPoints: 10 }), false);
    assert.equal(touchPointsWarning(1), true);
    assert.equal(touchPointsWarning(3), true);
    assert.equal(touchPointsWarning(4), false);
    assert.equal(touchPointsWarning(10), false);
    assert.equal(touchPointsWarning(undefined), false);
});
