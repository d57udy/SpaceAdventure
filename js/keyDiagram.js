// Key diagrams and seat wording for local multiplayer on a shared keyboard.
// Pure module: no DOM, no globals. main.js draws what these functions return.
//
//   keyDiagramLayout  mini key caps for a keyboard seat (kbLeft: W over A S D plus SPACE and F;
//                     kbRight: ↑ over ← ↓ → plus a tall ENTER), scaled into a box, with tiny
//                     action labels when there is room. Each cap names the seat action it
//                     drives, so a cap can light while that action is held.
//   keyboardForSeat   the keyboard half whose card a seat is (see seats.js preferredSeat)
//   emptyCardLines    what an empty lobby card says (each card names its own join key)
//   seatTag           "P1 · WASD + SPACE" under a ship at the round start
//   fireKeyHint       "SPACE" / "ENTER" / "Ⓐ" for "Press FIRE (…) when ready"

import { KEYBOARD_SEAT } from './seats.js';

export { KEYBOARD_SEAT, preferredSeat } from './seats.js';

/** The keyboard half that prefers a seat, or null (seats 2 and 3). */
export function keyboardForSeat(seat) {
    for (const [source, s] of Object.entries(KEYBOARD_SEAT)) if (s === seat) return source;
    return null;
}

// Cap glyphs per profile (the main keys of js/seats.js KEY_PROFILES; numpad alternates are not drawn)
const DIAGRAMS = Object.freeze({
    kbLeft: Object.freeze({
        thrust: 'W', rotateLeft: 'A', hyperspace: 'S', rotateRight: 'D',
        fire: 'SPACE', fireAlt: 'F', fireTall: false, short: 'WASD + SPACE', fireKey: 'SPACE',
    }),
    kbRight: Object.freeze({
        thrust: '↑', rotateLeft: '←', hyperspace: '↓', rotateRight: '→',
        fire: 'ENTER', fireAlt: null, fireTall: true, short: 'ARROWS + ENTER', fireKey: 'ENTER',
    }),
});

export const ACTION_LABELS = Object.freeze({
    thrust: 'Thrust', rotateLeft: 'Turn', rotateRight: 'Turn', hyperspace: 'Hyperspace', fire: 'Fire',
});
const SHORT_LABELS = Object.freeze({ hyperspace: 'Hyper' });
// Saucer mode: the saucer steers in absolute directions and has no hyperspace
const SAUCER_LABELS = Object.freeze({
    thrust: 'Up', rotateLeft: 'Left', rotateRight: 'Right', hyperspace: 'Down', fire: 'Fire',
});

// Layout in cap units: a cap is 1 x 1, caps sit PITCH apart, the fire block starts after a gap
const GAP = 0.14;
const PITCH = 1 + GAP;
const FIRE_X = 2 * PITCH + 1 + 0.55;
const FIRE_W = 2.9;
const WIDTH = FIRE_X + FIRE_W;
const CAPS_H = PITCH + 1;
const LABEL_ROW = 0.52;     // label row under the caps, in cap units
const LABEL_FONT = 0.36;    // label font size, in cap units
const CHAR_W = 0.56;        // rough Arial glyph width per font px (sizing only)

/** Rough text width for sizing decisions (Arial, bold-ish). */
export function estimateTextWidth(text, fontPx) {
    return String(text).length * CHAR_W * fontPx;
}

/**
 * Key caps for a keyboard seat, fitted into a box.
 * @param {string} source 'kbLeft' | 'kbRight' (anything else: null)
 * @param {{x:number, y:number, w:number, h:number}} box
 * @param {object} [o]
 * @param {number} [o.maxCap=48] largest cap size in px
 * @param {number} [o.minCap=9] below this the diagram is not drawn (null)
 * @param {number} [o.minLabelPx=8] smallest label font; smaller hides the labels
 * @param {number} [o.maxLabelPx=13] largest label font (labels stay small on big diagrams)
 * @param {boolean} [o.labels=true] show action labels when they fit
 * @param {'left'|'center'} [o.align='center']
 * @param {'ship'|'saucer'|null} [o.role]
 * @returns {null | {source:string, cap:number, width:number, height:number, showLabels:boolean,
 *   labelPx:number, caps:Array<{id:string, action:string, key:string, x:number, y:number, w:number, h:number, fontPx:number}>,
 *   labels:Array<{action:string, text:string, x:number, y:number, align:'left'|'center'|'right', maxWidth:number}>}}
 */
export function keyDiagramLayout(source, box, {
    maxCap = 48, minCap = 9, minLabelPx = 8, maxLabelPx = 13, labels = true, align = 'center', role = null,
} = {}) {
    const d = DIAGRAMS[source];
    if (!d || !box || !(box.w > 0) || !(box.h > 0)) return null;
    const fit = (hUnits) => Math.min(box.w / WIDTH, box.h / hUnits, maxCap);
    let cap = fit(CAPS_H + LABEL_ROW);
    let showLabels = labels && cap * LABEL_FONT >= minLabelPx;
    if (!showLabels) cap = fit(CAPS_H);
    if (!(cap >= minCap)) return null;
    const width = WIDTH * cap;
    const height = (CAPS_H + (showLabels ? LABEL_ROW : 0)) * cap;
    const ox = box.x + (align === 'left' ? 0 : (box.w - width) / 2);
    const oy = box.y + (box.h - height) / 2;
    const at = (ux, uy, uw, uh) => ({ x: ox + ux * cap, y: oy + uy * cap, w: uw * cap, h: uh * cap });
    const keyFont = (key, w) => Math.max(6, Math.min(cap * 0.5, (w * 0.82) / (Math.max(1, key.length) * 0.62)));
    const caps = [];
    const addCap = (id, action, key, r) => caps.push({ id, action, key, ...r, fontPx: keyFont(key, r.w) });
    addCap('thrust', 'thrust', d.thrust, at(PITCH, 0, 1, 1));
    addCap('rotateLeft', 'rotateLeft', d.rotateLeft, at(0, PITCH, 1, 1));
    addCap('hyperspace', 'hyperspace', d.hyperspace, at(PITCH, PITCH, 1, 1));
    addCap('rotateRight', 'rotateRight', d.rotateRight, at(2 * PITCH, PITCH, 1, 1));
    if (d.fireTall) {
        addCap('fire', 'fire', d.fire, at(FIRE_X, 0, FIRE_W * 0.8, CAPS_H));
    } else {
        addCap('fire', 'fire', d.fire, at(FIRE_X, PITCH, FIRE_W, 1));
        if (d.fireAlt) addCap('fireAlt', 'fire', d.fireAlt, at(FIRE_X, 0, 1, 1));
    }
    const labelPx = Math.min(cap * LABEL_FONT, maxLabelPx);
    const out = { source, cap, width, height, showLabels, labelPx: showLabels ? labelPx : 0, caps, labels: [] };
    if (!showLabels) return out;
    const names = role === 'saucer' ? SAUCER_LABELS : ACTION_LABELS;
    const labelY = oy + (CAPS_H + LABEL_ROW / 2) * cap;
    const capOf = (id) => caps.find(c => c.id === id);
    // Turn labels sit at the outer edges of A and D, so the middle one (hyperspace) has the room
    // between them: the full word on larger diagrams, 'Hyper' on a lobby card
    const a = capOf('rotateLeft');
    const dCap = capOf('rotateRight');
    const sCap = capOf('hyperspace');
    const side = PITCH * cap;
    out.labels.push({ action: 'rotateLeft', text: names.rotateLeft, x: a.x, y: labelY, align: 'left', maxWidth: side });
    out.labels.push({ action: 'rotateRight', text: names.rotateRight, x: dCap.x + dCap.w, y: labelY, align: 'right', maxWidth: side });
    const sideText = Math.max(estimateTextWidth(names.rotateLeft, labelPx), estimateTextWidth(names.rotateRight, labelPx));
    const middle = Math.max(side * 0.9, (dCap.x + dCap.w - a.x) - 2 * sideText - GAP * 2 * cap);
    const full = names.hyperspace;
    const hyper = estimateTextWidth(full, labelPx) <= middle || role === 'saucer' ? full : SHORT_LABELS.hyperspace;
    out.labels.push({ action: 'hyperspace', text: hyper, x: sCap.x + sCap.w / 2, y: labelY, align: 'center', maxWidth: middle });
    // Thrust: beside W, in the empty corner above D
    const w = capOf('thrust');
    const thrustRoom = (FIRE_X - 2 * PITCH - 0.1) * cap;
    out.labels.push({ action: 'thrust', text: names.thrust, x: w.x + w.w + GAP * cap * 1.5, y: w.y + w.h / 2, align: 'left', maxWidth: thrustRoom });
    const f = capOf('fire');
    out.labels.push({ action: 'fire', text: names.fire, x: f.x + f.w / 2, y: labelY, align: 'center', maxWidth: f.w });
    return out;
}

/** Aspect ratio (width / height) of a diagram, for sizing boxes. */
export function keyDiagramAspect(withLabels = true) {
    return WIDTH / (CAPS_H + (withLabels ? LABEL_ROW : 0));
}

/** Caps of a layout that are lit, given a pressed(action) test. */
export function litCaps(layout, pressed) {
    if (!layout || typeof pressed !== 'function') return [];
    return layout.caps.filter(c => pressed(c.action)).map(c => c.id);
}

/** Fire key of a source for "Press FIRE (…) when ready": 'SPACE', 'ENTER', a pad glyph, or null. */
export function fireKeyHint(source, padGlyph = 'Ⓐ') {
    if (DIAGRAMS[source]) return DIAGRAMS[source].fireKey;
    if (/^pad:\d+$/.test(String(source || ''))) return padGlyph;
    return null;
}

/** Short controls tag of a source: 'WASD + SPACE', 'ARROWS + ENTER', 'Controller 2', 'Touch left'. */
export function sourceTag(source) {
    const s = String(source || '');
    if (DIAGRAMS[s]) return DIAGRAMS[s].short;
    const m = /^pad:(\d+)$/.exec(s);
    if (m) return `Controller ${Number(m[1]) + 1}`;
    if (s === 'touch:a') return 'Touch left';
    if (s === 'touch:b') return 'Touch right';
    return '';
}

/** Label under a ship: 'P1 · WASD + SPACE' (just 'P1' for an unknown source). */
export function seatTag(label, source) {
    const tag = sourceTag(source);
    return tag ? `${label} · ${tag}` : String(label);
}

/**
 * Text of an empty lobby card. Seats 0 and 1 name their keyboard half; every card also says
 * how controllers (and, in a touch lobby, the side pads) join.
 * @param {number} seat
 * @param {{pad?:string, touch?:boolean}} [o] pad: the controller's fire glyph
 * @returns {{title:string, detail:string}}
 */
export function emptyCardLines(seat, { pad = 'Ⓐ', touch = false } = {}) {
    const kb = keyboardForSeat(seat);
    const tail = touch ? ` · or tap a side pad` : '';
    if (kb === 'kbLeft') return { title: 'Press SPACE to join', detail: `W A S D side · or press ${pad} on a controller${tail}` };
    if (kb === 'kbRight') return { title: 'Press ENTER to join', detail: `Arrow keys side · or press ${pad} on a controller${tail}` };
    return {
        title: `Press ${pad} on a controller to join`,
        detail: touch ? 'or tap a side pad' : 'Controllers take the first free card',
    };
}
