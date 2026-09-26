// View maths for simultaneous local multiplayer (pure: no DOM, no globals).
// See docs/plans/05-local-multiplayer.md §3.4, §9, §10.3 and §11.
//
//   hull marks     a per-seat mark on the ship hull, so colour is never the only cue
//   side bars      the space left and right of the square canvas (tablet controls, HUD panels)
//   touch layout   side by side, facing (P2 rotated 180°) or "rotate", from the mpLayout setting
//   viewers        per-viewer regions and 180° rotated tap regions for the facing layout
//   edge arrows    where to point at a ship or revive beacon that is outside the view
//   devices        multi-touch warning and the iPad gesture hint

/** Side bar needed for the side-by-side touch controls (fire 84 px + margins). */
export const MP_BAR_MIN = 120;
/** Side bar needed for the DOM HUD panels; narrower bars use the compact canvas HUD. */
export const MP_HUD_BAR_MIN = 150;
/** Fewer reported touch points than this: warn that two touch players may not both steer. */
export const MIN_TOUCH_POINTS = 4;

/** Hull mark per seat (plan §10.3): none, stripe, dot, notch. */
export const HULL_MARKS = Object.freeze(['none', 'stripe', 'dot', 'notch']);

export function hullMarkFor(seat) {
    const n = HULL_MARKS.length;
    const i = Number.isInteger(seat) ? ((seat % n) + n) % n : 0;
    return HULL_MARKS[i];
}

/**
 * Shapes of a hull mark in the ship's local frame (nose along +x, ship radius r; the hull is
 * the triangle nose (r, 0) and rear corners at ±140°). Every point lies inside the hull.
 * @returns {Array<{type:'line', x1:number, y1:number, x2:number, y2:number}
 *                 | {type:'circle', x:number, y:number, r:number}>}
 */
export function hullMarkShapes(mark, r) {
    // Half-width of the hull at local x (between the nose and the rear edge)
    const rearX = r * Math.cos((140 * Math.PI) / 180); // -0.766 r
    const rearY = r * Math.sin((140 * Math.PI) / 180); //  0.643 r
    const halfWidth = (x) => (rearY * (r - x)) / (r - rearX);
    switch (mark) {
        case 'stripe': {
            const x = -0.25 * r;
            const h = halfWidth(x) * 0.85;
            return [{ type: 'line', x1: x, y1: -h, x2: x, y2: h }];
        }
        case 'dot':
            return [{ type: 'circle', x: -0.15 * r, y: 0, r: 0.2 * r }];
        case 'notch': {
            // A V cut into the rear edge
            const x0 = rearX * 0.98;
            const w = rearY * 0.45;
            return [
                { type: 'line', x1: x0, y1: -w, x2: -0.35 * r, y2: 0 },
                { type: 'line', x1: -0.35 * r, y1: 0, x2: x0, y2: w },
            ];
        }
        default:
            return [];
    }
}

/**
 * Width of each side bar beside the centred square canvas (CSS px, rounded down).
 * @param {number} viewportW window.innerWidth
 * @param {number} canvasSize the canvas side in CSS px
 * @param {{left?:number, right?:number}} [safe] safe-area insets
 */
export function sideBarWidth(viewportW, canvasSize, safe = {}) {
    const avail = viewportW - (safe.left || 0) - (safe.right || 0);
    return Math.max(0, Math.floor((avail - canvasSize) / 2));
}

/** Layout settings (settings.js 'mpLayout'): auto picks by orientation. */
export const MP_LAYOUT_SETTINGS = Object.freeze(['auto', 'sides', 'facing']);

/**
 * Height of the bars above and below the centred square canvas (portrait facing layout).
 * @param {number} viewportH window.innerHeight
 * @param {{top?:number, bottom?:number}} [safe]
 */
export function topBarHeight(viewportH, canvasSize, safe = {}) {
    const avail = viewportH - (safe.top || 0) - (safe.bottom || 0);
    return Math.max(0, Math.floor((avail - canvasSize) / 2));
}

/**
 * Layout for a setting and orientation (plan §9):
 *   auto   - landscape: side by side (facing when the side bars are narrower than MP_BAR_MIN);
 *            portrait: facing
 *   sides  - landscape: side by side (facing when the bars are too narrow); portrait: 'rotate'
 *            (ask to turn the device, or choose Facing)
 *   facing - facing in both orientations
 * @returns {'sides'|'facing'|'rotate'}
 */
export function resolveMpLayout(setting, landscape, sideBar) {
    const s = MP_LAYOUT_SETTINGS.includes(setting) ? setting : 'auto';
    if (s === 'facing') return 'facing';
    if (landscape) return sideBar >= MP_BAR_MIN ? 'sides' : 'facing';
    return s === 'sides' ? 'rotate' : 'facing';
}

/**
 * Which touch layout applies (plan §9).
 * @param {object} o
 * @param {number} o.viewportW @param {number} o.viewportH
 * @param {number} o.canvasSize
 * @param {{left?:number, right?:number, top?:number, bottom?:number}} [o.safe] safe-area insets
 * @param {boolean} o.touch - touch players take part (or may join, in the lobby)
 * @param {'auto'|'sides'|'facing'} [o.setting='sides'] - the mpLayout setting
 * @returns {{layout:'sides'|'facing'|'rotate'|null, bar:number, landscape:boolean}}
 *   null: no touch players; 'sides': controls in the side bars; 'facing': P1 at the bottom, P2
 *   at the top (rotated); 'rotate': ask to turn the device. `bar` is the bar the layout uses:
 *   the side bar width, or in portrait facing the top/bottom bar height.
 */
export function touchLayout({ viewportW, viewportH, canvasSize, safe = {}, touch, setting = 'sides' }) {
    const side = sideBarWidth(viewportW, canvasSize, safe);
    const landscape = viewportW > viewportH;
    if (!touch) return { layout: null, bar: side, landscape };
    const layout = resolveMpLayout(setting, landscape, side);
    const bar = layout === 'facing' && !landscape ? topBarHeight(viewportH, canvasSize, safe) : side;
    return { layout, bar, landscape };
}

/** Key that changes when a running round has to be laid out again (auto-pause on rotation). */
export function layoutKey(state) {
    if (!state || !state.layout) return '';
    return `${state.layout}:${state.landscape ? 'L' : 'P'}`;
}

/**
 * HUD column ('left' | 'right') for a player. In the facing layout the 'left' column is the
 * bottom player's (zone a) and the 'right' column the top player's (zone b, rotated), so a
 * touch player's HUD follows the zone they sit in; everyone else goes by seat (hudSide).
 */
export function hudColumn(layout, zone, seat) {
    if (zone === 'a') return 'left';
    if (zone === 'b') return 'right';
    return hudSide(seat);
}

/** Title of a lobby join pad for the layout. */
export function joinPadTitle(layout, zone) {
    if (layout === 'facing') return zone === 'a' ? 'BOTTOM PLAYER' : 'TOP PLAYER';
    return zone === 'a' ? 'LEFT PLAYER' : 'RIGHT PLAYER';
}

/**
 * A rectangle turned 180° about the centre of a W x H view (the facing player's copy of a
 * tap region drawn under a 180° rotation).
 * @param {{x:number, y:number, w:number, h:number}} r
 */
export function rotateRect180(r, W, H) {
    return { x: W - r.x - r.w, y: H - r.y - r.h, w: r.w, h: r.h };
}

/** A point turned 180° about the centre of a W x H view. */
export function rotatePoint180(x, y, W, H) {
    return { x: W - x, y: H - y };
}

/**
 * Regions to draw centre texts, banners and menus in, one per viewer (plan §11).
 * Not facing: the whole view, upright. Facing: the bottom half upright for the bottom player,
 * and the same half drawn under a 180° rotation for the top player (it lands on the top half).
 * @returns {Array<{x:number, y:number, w:number, h:number, rotated:boolean, half:boolean}>}
 */
export function viewerRegions(layout, W, H) {
    if (layout !== 'facing') return [{ x: 0, y: 0, w: W, h: H, rotated: false, half: false }];
    const half = { x: 0, y: H / 2, w: W, h: H / 2, half: true };
    return [{ ...half, rotated: false }, { ...half, rotated: true }];
}

/** 'dom' (panels in the side bars) or 'canvas' (compact HUD in the canvas corners). */
export function hudMode(bar) {
    return bar >= MP_HUD_BAR_MIN ? 'dom' : 'canvas';
}

/** Side bar a seat's HUD panel goes in: seats 1 and 3 left, 2 and 4 right (P1 left, P2 right). */
export function hudSide(seat) {
    return (Number.isInteger(seat) ? seat : 0) % 2 === 0 ? 'left' : 'right';
}

/** Corner of the compact canvas HUD for a seat: P1 top-left, P2 top-right, P3/P4 below. */
export function compactHudCorner(seat) {
    const s = Number.isInteger(seat) ? seat : 0;
    return { x: s % 2 === 0 ? 'left' : 'right', y: s < 2 ? 'top' : 'bottom' };
}

/**
 * Edge arrow for a point outside the view (plan §11). (dx, dy) is the point's offset from the
 * view centre in screen pixels; the view is 2*halfW x 2*halfH. Returns null when the point
 * (plus `radius`) is on screen, else the arrow's position on the rectangle inset by `inset`
 * (relative to the view centre) and the direction it points in.
 * @returns {{x:number, y:number, angle:number}|null}
 */
export function edgeArrow(dx, dy, halfW, halfH, { inset = 24, radius = 0 } = {}) {
    if (Math.abs(dx) - radius <= halfW && Math.abs(dy) - radius <= halfH) return null;
    const ax = Math.max(1, halfW - inset);
    const ay = Math.max(1, halfH - inset);
    const tx = dx !== 0 ? ax / Math.abs(dx) : Infinity;
    const ty = dy !== 0 ? ay / Math.abs(dy) : Infinity;
    const t = Math.min(tx, ty);
    return { x: dx * t, y: dy * t, angle: Math.atan2(dy, dx) };
}

/** 1 when the respawn countdown starts, 0 when the ship appears. */
export function respawnFraction(timer, delay) {
    if (!(delay > 0) || !(timer > 0)) return 0;
    return Math.min(1, timer / delay);
}

/** iPad, including iPadOS reporting itself as a Mac with a touch screen. */
export function isIpad({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
    if (/iPad/.test(userAgent) || platform === 'iPad') return true;
    return (platform === 'MacIntel' || /Macintosh/.test(userAgent)) && maxTouchPoints > 1;
}

/** True when the device reports fewer touch points than two touch players need. */
export function touchPointsWarning(maxTouchPoints) {
    return Number.isFinite(maxTouchPoints) && maxTouchPoints < MIN_TOUCH_POINTS;
}
