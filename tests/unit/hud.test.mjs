import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSeatHud, SeatHudView, POWER_UP_INFO } from '../../js/hud.js';

// ---- minimal fake DOM ----
function makeDoc() {
    const doc = {
        createElement(tag) { return makeEl(tag, doc); },
    };
    return doc;
}
function makeEl(tag, doc) {
    let text = '';
    const el = {
        tagName: tag, ownerDocument: doc, children: [], attrs: {}, className: '', textWrites: 0,
        style: {},
        get textContent() { return text; },
        set textContent(v) { text = v; el.textWrites++; },
        setAttribute(k, v) { el.attrs[k] = String(v); },
        appendChild(c) { el.children.push(c); c.parentNode = el; return c; },
        removeChild(c) { el.children.splice(el.children.indexOf(c), 1); c.parentNode = null; return c; },
        querySelector(sel) {
            const m = /^\[data-hud="(\w+)"\]$/.exec(sel);
            return m ? el.children.find((c) => c.attrs['data-hud'] === m[1]) ?? null : null;
        },
    };
    return el;
}
function makePanel() {
    const doc = makeDoc();
    const root = makeEl('div', doc);
    for (const k of ['name', 'score', 'lives', 'powerUps', 'combo', 'comboBar', 'status']) {
        const c = makeEl('div', doc);
        c.setAttribute('data-hud', k);
        root.appendChild(c);
    }
    const q = (k) => root.querySelector(`[data-hud="${k}"]`);
    return { root, q };
}

const baseModel = {
    slot: 1, name: 'bob', score: 1234.9, lives: 3,
    powerUps: { shield: 3, magnet: 0, rapid_fire: 8 },
    combo: { count: 6, multiplier: 2, timer: 1.5, maxTime: 3 },
};

test('HUD text fields', () => {
    const h = formatSeatHud(baseModel);
    assert.equal(h.name, 'P2 BOB');
    assert.equal(h.score, '1234');
    assert.equal(h.lives, '▲▲▲');
    assert.deepEqual(h.powerUps, [
        { id: 'shield', label: POWER_UP_INFO.shield.label, frac: 0.5 },
        { id: 'rapid_fire', label: 'R', frac: 1 },
    ]);
    assert.deepEqual(h.combo, { count: 6, mult: 2, frac: 0.5 });
    assert.equal(h.status, '');
});

test('HUD defaults and edge values', () => {
    const h = formatSeatHud({});
    assert.equal(h.name, 'P1');
    assert.equal(h.score, '0');
    assert.equal(h.lives, '');
    assert.deepEqual(h.powerUps, []);
    assert.equal(h.combo, null);
    assert.equal(formatSeatHud({ lives: 9 }).lives, '▲ x9');
    assert.equal(formatSeatHud({ combo: { count: 1, multiplier: 1, timer: 3, maxTime: 3 } }).combo, null);
    assert.deepEqual(formatSeatHud({ combo: { count: 2, multiplier: 1, timer: 9, maxTime: 3 } }).combo, { count: 2, mult: 1, frac: 1 });
    assert.deepEqual(formatSeatHud({ powerUps: { shield: 3 }, powerUpDurations: { shield: 12 } }).powerUps[0].frac, 0.25);
});

test('HUD status line', () => {
    assert.equal(formatSeatHud({ respawnTimer: 2.13 }).status, 'RESPAWN 2.1s');
    assert.equal(formatSeatHud({ out: true, respawnTimer: 1 }).status, 'OUT – fly near to revive');
    assert.equal(formatSeatHud({ paused: true, out: true }).status, 'PAUSED');
    assert.equal(formatSeatHud({ status: 'READY', paused: true }).status, 'READY');
});

test('the view writes the fields into the DOM', () => {
    const { root, q } = makePanel();
    const view = new SeatHudView(root);
    view.update(formatSeatHud(baseModel));
    assert.equal(q('name').textContent, 'P2 BOB');
    assert.equal(q('score').textContent, '1234');
    assert.equal(q('lives').textContent, '▲▲▲');
    assert.equal(q('combo').textContent, '6x COMBO · 2x');
    assert.equal(q('comboBar').style.width, '50%');
    assert.equal(q('status').style.display, 'none');
    const chips = q('powerUps').children;
    assert.deepEqual(chips.map((c) => c.attrs['data-power-up']), ['shield', 'rapid_fire']);
    assert.equal(chips[0].children[0].textContent, 'S');
    assert.equal(chips[0].children[1].style.width, '50%');
});

test('the HUD writes only on change', () => {
    const { root, q } = makePanel();
    const view = new SeatHudView(root);
    view.update(formatSeatHud(baseModel));
    const first = view.writes;
    assert.ok(first > 0);
    // Same model again: no writes at all
    view.update(formatSeatHud(baseModel));
    view.update(formatSeatHud({ ...baseModel }));
    assert.equal(view.writes, first);
    // Only the score changes: exactly one write, and only to the score element
    const nameWrites = q('name').textWrites;
    view.update(formatSeatHud({ ...baseModel, score: 1300 }));
    assert.equal(view.writes, first + 1);
    assert.equal(q('score').textContent, '1300');
    assert.equal(q('name').textWrites, nameWrites);
    // A tiny timer change that rounds to the same bar width writes nothing
    const w = view.writes;
    view.update(formatSeatHud({ ...baseModel, score: 1300, powerUps: { shield: 2.999, rapid_fire: 8 } }));
    assert.equal(view.writes, w);
    // Power-up expires: chip removed (one write)
    view.update(formatSeatHud({ ...baseModel, score: 1300, powerUps: { rapid_fire: 8 } }));
    assert.equal(view.writes, w + 1);
    assert.deepEqual(q('powerUps').children.map((c) => c.attrs['data-power-up']), ['rapid_fire']);
    // Status appears: text + display
    const s = view.writes;
    view.update(formatSeatHud({ ...baseModel, score: 1300, powerUps: { rapid_fire: 8 }, respawnTimer: 2 }));
    assert.equal(view.writes, s + 2);
    assert.equal(q('status').textContent, 'RESPAWN 2.0s');
    assert.equal(q('status').style.display, '');
});

test('combo hides when it ends', () => {
    const { root, q } = makePanel();
    const view = new SeatHudView(root);
    view.update(formatSeatHud(baseModel));
    view.update(formatSeatHud({ ...baseModel, combo: null }));
    assert.equal(q('combo').textContent, '');
    assert.equal(q('combo').style.display, 'none');
    assert.equal(q('comboBar').style.width, '0%');
    view.update(formatSeatHud({ ...baseModel, combo: { count: 3, multiplier: 1, timer: 3, maxTime: 3 } }));
    assert.equal(q('combo').textContent, '3x COMBO');
    assert.equal(q('combo').style.display, '');
});

test('elements can be injected directly and missing ones are skipped', () => {
    const doc = makeDoc();
    const score = makeEl('span', doc);
    const view = new SeatHudView(null, { score });
    view.update(formatSeatHud(baseModel));
    assert.equal(score.textContent, '1234');
    assert.equal(view.writes, 1);
});

test('unlimited lives show ∞; scoreText replaces the score (Duel kills)', () => {
    const h = formatSeatHud({ slot: 1, name: 'bob', score: 250, lives: Infinity, scoreText: '3 KILLS' });
    assert.equal(h.lives, '▲ ∞');
    assert.equal(h.score, '3 KILLS');
    assert.equal(formatSeatHud({ score: 250, scoreText: '' }).score, '250');
});
