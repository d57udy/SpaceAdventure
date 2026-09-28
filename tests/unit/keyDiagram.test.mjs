import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEY_PROFILES } from '../../js/seats.js';
import { keyName } from '../../js/mpIntro.js';
import {
    keyDiagramLayout, keyDiagramAspect, litCaps, fireKeyHint, sourceTag, seatTag, emptyCardLines,
    keyboardForSeat, preferredSeat, estimateTextWidth,
} from '../../js/keyDiagram.js';

const inside = (r, box, eps = 1e-6) => r.x >= box.x - eps && r.y >= box.y - eps
    && r.x + r.w <= box.x + box.w + eps && r.y + r.h <= box.y + box.h + eps;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const LOBBY_BOX = { x: 12, y: 72, w: 276, h: 64 }; // a lobby card on a 1280 x 800 canvas

test('kbLeft: W above A S D, a wide SPACE and a small F; caps name their seat actions', () => {
    const d = keyDiagramLayout('kbLeft', LOBBY_BOX);
    assert.deepEqual(d.caps.map(c => [c.id, c.key, c.action]), [
        ['thrust', 'W', 'thrust'], ['rotateLeft', 'A', 'rotateLeft'], ['hyperspace', 'S', 'hyperspace'],
        ['rotateRight', 'D', 'rotateRight'], ['fire', 'SPACE', 'fire'], ['fireAlt', 'F', 'fire'],
    ]);
    const cap = Object.fromEntries(d.caps.map(c => [c.id, c]));
    assert.ok(cap.thrust.y + cap.thrust.h <= cap.hyperspace.y, 'W above S');
    assert.equal(cap.thrust.x, cap.hyperspace.x);
    assert.ok(cap.rotateLeft.x < cap.hyperspace.x && cap.hyperspace.x < cap.rotateRight.x);
    assert.ok(cap.fire.w > 2 * cap.thrust.w, 'SPACE is wide');
    assert.equal(cap.fireAlt.w, cap.thrust.w);
    assert.ok(cap.fire.x > cap.rotateRight.x + cap.rotateRight.w, 'fire block right of the cluster');
});

test('kbRight: ↑ above ← ↓ → and a tall ENTER', () => {
    const d = keyDiagramLayout('kbRight', LOBBY_BOX);
    assert.deepEqual(d.caps.map(c => c.key), ['↑', '←', '↓', '→', 'ENTER']);
    const enter = d.caps.find(c => c.id === 'fire');
    const up = d.caps.find(c => c.id === 'thrust');
    assert.ok(enter.h > 1.5 * up.h, 'ENTER spans both rows');
});

test('cap glyphs match the key profiles (main keys, not the numpad)', () => {
    for (const src of ['kbLeft', 'kbRight']) {
        const d = keyDiagramLayout(src, LOBBY_BOX);
        for (const c of d.caps) {
            const codes = KEY_PROFILES[src][c.action];
            assert.ok(codes.map(keyName).includes(c.key), `${src} ${c.id}: ${c.key}`);
        }
    }
});

test('fits the lobby card box with labels; nothing overlaps', () => {
    for (const src of ['kbLeft', 'kbRight']) {
        const d = keyDiagramLayout(src, LOBBY_BOX);
        assert.equal(d.showLabels, true, src);
        assert.ok(d.labelPx >= 8);
        for (const c of d.caps) assert.ok(inside(c, LOBBY_BOX), `${src} ${c.id} inside`);
        for (let i = 0; i < d.caps.length; i++) {
            for (let k = i + 1; k < d.caps.length; k++) assert.ok(!overlap(d.caps[i], d.caps[k]), `${d.caps[i].id}/${d.caps[k].id}`);
        }
        assert.ok(d.width <= LOBBY_BOX.w + 1e-6 && d.height <= LOBBY_BOX.h + 1e-6);
        // Labels: Thrust, Turn, Hyper(space), Turn, Fire; inside the box, below the caps (Thrust beside W)
        assert.deepEqual(d.labels.map(l => l.action).sort(), ['fire', 'hyperspace', 'rotateLeft', 'rotateRight', 'thrust']);
        const lowest = Math.max(...d.caps.map(c => c.y + c.h));
        for (const l of d.labels) {
            assert.ok(l.y - d.labelPx / 2 >= LOBBY_BOX.y - 1e-6 && l.y + d.labelPx / 2 <= LOBBY_BOX.y + LOBBY_BOX.h + 1e-6, l.text);
            if (l.action !== 'thrust') assert.ok(l.y > lowest, `${l.text} under the caps`);
            assert.ok(estimateTextWidth(l.text, d.labelPx) <= l.maxWidth * 1.05 || l.text === 'Thrust', `${l.text} fits`);
        }
        assert.deepEqual(d.labels.filter(l => l.action === 'rotateLeft' || l.action === 'rotateRight').map(l => l.text), ['Turn', 'Turn']);
    }
});

test('scales down on small canvases: labels hidden, then no diagram', () => {
    const small = keyDiagramLayout('kbLeft', { x: 0, y: 0, w: 150, h: 30 });
    assert.equal(small.showLabels, false);
    assert.equal(small.labels.length, 0);
    for (const c of small.caps) assert.ok(inside(c, { x: 0, y: 0, w: 150, h: 30 }));
    assert.equal(keyDiagramLayout('kbLeft', { x: 0, y: 0, w: 40, h: 10 }), null);
    assert.equal(keyDiagramLayout('kbLeft', { x: 0, y: 0, w: 0, h: 50 }), null);
    // Labels can be switched off
    assert.equal(keyDiagramLayout('kbLeft', LOBBY_BOX, { labels: false }).showLabels, false);
});

test('larger boxes give larger caps, capped by maxCap; the full "Hyperspace" label when it fits', () => {
    const big = keyDiagramLayout('kbRight', { x: 0, y: 0, w: 600, h: 300 }, { maxCap: 44 });
    assert.equal(big.cap, 44);
    const huge = keyDiagramLayout('kbRight', { x: 0, y: 0, w: 2000, h: 1000 }, { maxCap: 400 });
    assert.equal(huge.labels.find(l => l.action === 'hyperspace').text, 'Hyperspace');
    const card = keyDiagramLayout('kbRight', LOBBY_BOX);
    assert.equal(card.labels.find(l => l.action === 'hyperspace').text, 'Hyper');
    assert.ok(big.cap > card.cap);
});

test('align left keeps the diagram at the box edge; centre centres it', () => {
    const box = { x: 100, y: 0, w: 600, h: 60 };
    const left = keyDiagramLayout('kbLeft', box, { align: 'left' });
    assert.equal(Math.min(...left.caps.map(c => c.x)), 100);
    const mid = keyDiagramLayout('kbLeft', box);
    const minX = Math.min(...mid.caps.map(c => c.x));
    assert.ok(Math.abs((minX - box.x) - (box.x + box.w - (minX + mid.width))) < 1e-6);
    assert.ok(keyDiagramAspect(true) < keyDiagramAspect(false));
});

test('saucer role: direction labels', () => {
    const d = keyDiagramLayout('kbRight', { x: 0, y: 0, w: 400, h: 120 }, { role: 'saucer' });
    assert.deepEqual(Object.fromEntries(d.labels.map(l => [l.action, l.text])),
        { rotateLeft: 'Left', hyperspace: 'Down', rotateRight: 'Right', thrust: 'Up', fire: 'Fire' });
});

test('non-keyboard sources have no diagram', () => {
    for (const s of ['pad:0', 'touch:a', null, 'bogus']) assert.equal(keyDiagramLayout(s, LOBBY_BOX), null);
});

test('lit caps follow the pressed actions (both fire caps light with fire)', () => {
    const d = keyDiagramLayout('kbLeft', LOBBY_BOX);
    assert.deepEqual(litCaps(d, a => a === 'thrust'), ['thrust']);
    assert.deepEqual(litCaps(d, a => a === 'fire'), ['fire', 'fireAlt']);
    assert.deepEqual(litCaps(d, () => false), []);
    assert.deepEqual(litCaps(null, () => true), []);
});

test('seat wording: preferred seats, fire keys, tags, empty cards', () => {
    assert.equal(preferredSeat('kbLeft'), 0);
    assert.equal(keyboardForSeat(0), 'kbLeft');
    assert.equal(keyboardForSeat(1), 'kbRight');
    assert.equal(keyboardForSeat(2), null);
    assert.equal(fireKeyHint('kbLeft'), 'SPACE');
    assert.equal(fireKeyHint('kbRight'), 'ENTER');
    assert.equal(fireKeyHint('pad:1', '✕'), '✕');
    assert.equal(fireKeyHint('touch:a'), null);
    assert.equal(sourceTag('pad:0'), 'Controller 1');
    assert.equal(seatTag('P1', 'kbLeft'), 'P1 · WASD + SPACE');
    assert.equal(seatTag('P2', 'kbRight'), 'P2 · ARROWS + ENTER');
    assert.equal(seatTag('P3', 'pad:0'), 'P3 · Controller 1');
    assert.equal(seatTag('P1', 'touch:b'), 'P1 · Touch right');
    assert.equal(seatTag('P4', null), 'P4');
    assert.equal(emptyCardLines(0).title, 'Press SPACE to join');
    assert.equal(emptyCardLines(1).title, 'Press ENTER to join');
    assert.match(emptyCardLines(0).detail, /W A S D.*Ⓐ on a controller/);
    assert.match(emptyCardLines(1, { pad: '✕' }).detail, /Arrow keys.*✕ on a controller/);
    assert.doesNotMatch(emptyCardLines(1).detail, /side pad/);
    assert.match(emptyCardLines(1, { touch: true }).detail, /side pad/);
    assert.equal(emptyCardLines(2).title, 'Press Ⓐ on a controller to join');
    assert.match(emptyCardLines(3, { touch: true }).detail, /side pad/);
});
