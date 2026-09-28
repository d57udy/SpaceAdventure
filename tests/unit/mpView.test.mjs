import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    HULL_MARKS, hullMarkFor, hullMarkShapes, sideBarWidth, touchLayout, hudMode, hudSide, compactHudCorner,
    reservedSideBar, reservedTopBar, MP_BAR_MAX, MP_MIN_CANVAS_RATIO,
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

test('side bars: sideBarWidth / topBarHeight measure the space beside a centred canvas', () => {
    assert.equal(sideBarWidth(1024, 691), 166);
    assert.equal(sideBarWidth(1024, 691, { left: 20, right: 20 }), 146);
    assert.equal(sideBarWidth(700, 800), 0);
    assert.equal(topBarHeight(1080, 729, { top: 20, bottom: 10 }), 160);
});

test('reserved bars: 16% of the width, 150 to 200 px, the canvas keeps 3/4 of its height', () => {
    const cases = [
        [1024, 768, 164], // iPad 10.2" full screen
        [1080, 810, 173], // iPad gen 7 (test size)
        [1180, 820, 189], // iPad Air 11"
        [1366, 1024, 200], // iPad Pro 12.9": capped
        [1280, 800, 200], // 10" Android / laptop
        [844, 390, 150], // phone landscape: the HUD panel minimum
        [892, 412, 150], // Pixel 7 Pro landscape
    ];
    for (const [w, h, bar] of cases) {
        assert.equal(reservedSideBar(w, h), bar, `${w}x${h}`);
        const canvasW = w - 2 * bar;
        assert.ok(canvasW >= h * MP_MIN_CANVAS_RATIO, `${w}x${h} canvas keeps its width`);
    }
    // Nearly square landscape: the bars shrink so the canvas stays 3/4 as wide as tall
    assert.equal(reservedSideBar(700, 650), Math.floor((700 - 650 * 0.75) / 2));
    assert.equal(reservedSideBar(300, 600), 0);
    // Portrait facing: the same rule on the other axis
    assert.equal(reservedTopBar(810, 1080), 173);
    assert.equal(reservedTopBar(412, 892), 150);
    assert.equal(MP_BAR_MAX, 200);
});

test('touch layout: side by side in landscape with bars >= 120 px, else rotate; none without touch', () => {
    const at = (w, h, touch = true, safe = {}, panels = false) => touchLayout({
        viewportW: w, viewportH: h, safe, touch, panels,
    });
    assert.deepEqual(at(1080, 810), { layout: 'sides', bar: 173, landscape: true, reserve: { left: 173, right: 173, top: 0, bottom: 0 } });
    assert.deepEqual(at(810, 1080), { layout: 'rotate', bar: 0, landscape: false, reserve: { left: 0, right: 0, top: 0, bottom: 0 } });
    // No touch players: nothing reserved (single-player, Take Turns)
    assert.deepEqual(at(1024, 768, false), { layout: null, bar: 0, landscape: true, reserve: { left: 0, right: 0, top: 0, bottom: 0 } });
    // Keyboard / controller multiplayer: bars for the HUD panels in landscape, none in portrait
    assert.deepEqual(at(1280, 800, false, {}, true).reserve, { left: 200, right: 200, top: 0, bottom: 0 });
    assert.equal(hudMode(at(1280, 800, false, {}, true).bar), 'dom');
    assert.deepEqual(at(810, 1080, false, {}, true).reserve, { left: 0, right: 0, top: 0, bottom: 0 });
    assert.equal(hudMode(at(810, 1080, false, {}, true).bar), 'canvas');
    // A landscape phone
    assert.equal(at(844, 390).layout, 'sides');
    // Nearly square landscape: bars below 120 px, switch to facing (plan §9) in the side bars
    const sq = at(700, 650);
    assert.equal(sq.layout, 'facing');
    assert.equal(sq.reserve.left, sq.bar);
    assert.ok(sq.bar < MP_BAR_MIN);
    assert.equal(MP_BAR_MIN, 120);
    // Safe areas come off the available width first
    const notch = at(1080, 810, true, { left: 40, right: 40 });
    assert.equal(notch.bar, reservedSideBar(1000, 810));
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

// --- MP-4: facing layout ---
import {
    resolveMpLayout, topBarHeight, layoutKey, hudColumn, joinPadTitle, rotateRect180, rotatePoint180, viewerRegions,
    MP_LAYOUT_SETTINGS,
} from '../../js/mpView.js';

test('layout setting: auto = landscape sides / portrait facing; sides in portrait asks to rotate', () => {
    assert.deepEqual(MP_LAYOUT_SETTINGS, ['auto', 'sides', 'facing']);
    assert.equal(resolveMpLayout('auto', true, 175), 'sides');
    assert.equal(resolveMpLayout('auto', false, 40), 'facing');
    assert.equal(resolveMpLayout('auto', true, 90), 'facing'); // bars too narrow
    assert.equal(resolveMpLayout('sides', true, 175), 'sides');
    assert.equal(resolveMpLayout('sides', false, 40), 'rotate');
    assert.equal(resolveMpLayout('facing', true, 175), 'facing');
    assert.equal(resolveMpLayout('facing', false, 40), 'facing');
    assert.equal(resolveMpLayout('bogus', false, 40), 'facing'); // unknown = auto
});

test('touch layout with a setting: portrait facing reserves bars above and below', () => {
    const at = (w, h, setting) => touchLayout({ viewportW: w, viewportH: h, touch: true, setting });
    assert.deepEqual(at(810, 1080, 'auto'), { layout: 'facing', bar: 173, landscape: false, reserve: { left: 0, right: 0, top: 173, bottom: 173 } });
    assert.deepEqual(at(810, 1080, 'sides'), { layout: 'rotate', bar: 0, landscape: false, reserve: { left: 0, right: 0, top: 0, bottom: 0 } });
    assert.deepEqual(at(1080, 810, 'facing'), { layout: 'facing', bar: 173, landscape: true, reserve: { left: 173, right: 173, top: 0, bottom: 0 } });
    assert.deepEqual(at(1080, 810, 'auto').layout, 'sides');
    // A portrait phone: 150 px bars leave a 412 x 592 canvas
    assert.deepEqual(at(412, 892, 'auto').reserve, { left: 0, right: 0, top: 150, bottom: 150 });
    assert.equal(layoutKey({ layout: 'facing', landscape: false }), 'facing:P');
    assert.notEqual(layoutKey(at(810, 1080, 'auto')), layoutKey(at(1080, 810, 'auto')));
    assert.equal(layoutKey({ layout: null }), '');
});

test('HUD column follows the touch zone; join pad titles per layout', () => {
    assert.equal(hudColumn('facing', 'a', 1), 'left');
    assert.equal(hudColumn('facing', 'b', 0), 'right');
    assert.equal(hudColumn(null, null, 0), 'left');
    assert.equal(hudColumn(null, null, 1), 'right');
    assert.equal(joinPadTitle('facing', 'a'), 'BOTTOM PLAYER');
    assert.equal(joinPadTitle('facing', 'b'), 'TOP PLAYER');
    assert.equal(joinPadTitle('sides', 'a'), 'LEFT PLAYER');
    assert.equal(joinPadTitle(null, 'b'), 'RIGHT PLAYER');
});

test('rotated tap region: 180° about the view centre; twice is the identity', () => {
    const r = { x: 100, y: 500, w: 200, h: 40 };
    assert.deepEqual(rotateRect180(r, 729, 729), { x: 429, y: 189, w: 200, h: 40 });
    assert.deepEqual(rotateRect180(rotateRect180(r, 729, 729), 729, 729), r);
    // A point inside the region maps inside the rotated region
    const p = rotatePoint180(150, 510, 729, 729);
    const q = rotateRect180(r, 729, 729);
    assert.ok(p.x >= q.x && p.x <= q.x + q.w && p.y >= q.y && p.y <= q.y + q.h);
    // Full-width bottom half maps onto the top half
    assert.deepEqual(rotateRect180({ x: 0, y: 364.5, w: 729, h: 364.5 }, 729, 729), { x: 0, y: 0, w: 729, h: 364.5 });
});

test('viewer regions: one upright view, or two halves in the facing layout', () => {
    assert.deepEqual(viewerRegions('sides', 600, 600), [{ x: 0, y: 0, w: 600, h: 600, rotated: false, half: false }]);
    assert.deepEqual(viewerRegions(null, 600, 600).length, 1);
    const [a, b] = viewerRegions('facing', 600, 600);
    assert.deepEqual(a, { x: 0, y: 300, w: 600, h: 300, half: true, rotated: false });
    assert.deepEqual(b, { ...a, rotated: true });
});
