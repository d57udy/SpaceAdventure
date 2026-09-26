import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    keyName, keyboardControls, sourceKindOf, controlsCard, introRulesLine, introSessionKey, createIntro,
    introPressFire, introAllReady, tickIntro, keyboardTable, stereoPan, thrustPan, STEREO_PAN,
    INTRO_FULL_SECONDS, INTRO_SHORT_SECONDS,
} from '../../js/mpIntro.js';
import { KEY_PROFILES } from '../../js/seats.js';

test('keyName: letters, arrows, named keys and numpad', () => {
    assert.equal(keyName('KeyW'), 'W');
    assert.equal(keyName('Space'), 'SPACE');
    assert.equal(keyName('Enter'), 'ENTER');
    assert.equal(keyName('ShiftRight'), 'RIGHT SHIFT');
    assert.equal(keyName('ArrowUp'), '↑');
    assert.equal(keyName('Numpad8'), 'NUM 8');
    assert.equal(keyName('NumpadEnter'), 'NUM ENTER');
    assert.equal(keyName('Digit3'), '3');
    assert.equal(keyName(undefined), '');
});

test('keyboardControls follows KEY_PROFILES (P1 WASD + Space/F, P2 arrows + Enter/Right Shift)', () => {
    assert.deepEqual(keyboardControls('kbLeft'), {
        thrust: 'W', turn: 'A D', hyperspace: 'S', fire: 'SPACE or F', numpad: '',
    });
    assert.deepEqual(keyboardControls('kbRight'), {
        thrust: '↑', turn: '← →', hyperspace: '↓', fire: 'ENTER or RIGHT SHIFT',
        numpad: '8 · 4 6 · 5 · ENTER',
    });
    assert.equal(keyboardControls('pad:0'), null);
    // Every non-numpad fire key of a profile is named
    for (const src of Object.keys(KEY_PROFILES)) {
        const fire = keyboardControls(src).fire;
        for (const code of KEY_PROFILES[src].fire.filter(c => !c.startsWith('Numpad'))) assert.ok(fire.includes(keyName(code)), code);
    }
});

test('sourceKindOf', () => {
    assert.equal(sourceKindOf('kbLeft'), 'keys');
    assert.equal(sourceKindOf('kbRight'), 'keys');
    assert.equal(sourceKindOf('pad:2'), 'pad');
    assert.equal(sourceKindOf('touch:a'), 'touch');
    assert.equal(sourceKindOf('touch:b'), 'touch');
    assert.equal(sourceKindOf('touch:c'), null);
    assert.equal(sourceKindOf(null), null);
});

test('controlsCard per source', () => {
    assert.deepEqual(controlsCard('kbLeft'), {
        kind: 'keys', lines: ['W thrust · A D turn', 'S hyperspace', 'SPACE or F fire'],
    });
    assert.equal(controlsCard('kbRight').lines[2], 'ENTER or RIGHT SHIFT fire');
    const pad = controlsCard('pad:1', { pad: { fire: '✕', hyperspace: '○' } });
    assert.equal(pad.kind, 'pad');
    assert.deepEqual(pad.lines, ['Controller 2: stick steers', '✕ or RT fire', '○ hyperspace']);
    const touch = controlsCard('touch:a');
    assert.equal(touch.kind, 'touch');
    assert.equal(touch.lines[0], 'Drag here to steer');
    assert.match(touch.lines[1], /FIRE.*outer/);
    assert.match(controlsCard('touch:b', { fireSide: 'inner' }).lines[1], /inner/);
    assert.deepEqual(controlsCard('mystery'), { kind: null, lines: [] });
});

test('controlsCard: Saucer roles (the saucer steers in absolute directions, no hyperspace)', () => {
    assert.deepEqual(controlsCard('kbLeft', { role: 'ship' }).lines,
        ['You fly the SHIP', 'W thrust \u00B7 A D turn', 'S hyperspace', 'SPACE or F fire']);
    assert.deepEqual(controlsCard('kbRight', { role: 'saucer' }).lines,
        ['You steer the SAUCER', '\u2191 \u2190 \u2193 \u2192 steer', 'ENTER or RIGHT SHIFT fire']);
    assert.equal(controlsCard('kbLeft', { role: 'saucer' }).lines[1], 'W A S D steer');
    assert.deepEqual(controlsCard('pad:0', { role: 'saucer', pad: { fire: '\u2715', hyperspace: '\u25CB' } }).lines,
        ['You steer the SAUCER', 'Stick steers', '\u2715 or RT fire']);
    assert.equal(controlsCard('touch:b', { role: 'saucer' }).lines[1], 'Drag here to steer');
    assert.deepEqual(controlsCard('nope', { role: 'saucer' }), { kind: null, lines: [] });
    assert.deepEqual(controlsCard('nope', { role: 'ship' }), { kind: null, lines: [] });
});

test('introRulesLine: one line per mode, with the round options', () => {
    assert.match(introRulesLine('coop'), /revive/);
    assert.equal(introRulesLine('harvest', { roundSeconds: 120 }), 'Harvest Race: most crystals in 2:00 wins. Shoot a crystal to deny it.');
    assert.match(introRulesLine('harvest'), /^Harvest Race: most crystals wins/);
    assert.equal(introRulesLine('duel', { target: 3 }), 'Duel: first to 3 kills. One hit kills.');
    assert.match(introRulesLine('duel'), /first to 5 kills/);
    assert.equal(introRulesLine('saucer', { target: 2500, roundSeconds: 150 }), 'Saucer: the ship needs 2500 points in 2:30. The saucer stops it.');
    assert.equal(introRulesLine('saucer'), 'Saucer: the ship needs the target score. The saucer stops it.');
    assert.equal(introRulesLine('mystery', { fallback: 'Mystery: rules.' }), 'Mystery: rules.');
    assert.equal(introRulesLine('unknown'), '');
});

test('introSessionKey: same mode and inputs give the same key', () => {
    assert.equal(introSessionKey('coop', ['kbLeft', 'kbRight']), introSessionKey('coop', ['kbLeft', 'kbRight']));
    assert.notEqual(introSessionKey('coop', ['kbLeft', 'kbRight']), introSessionKey('duel', ['kbLeft', 'kbRight']));
    assert.notEqual(introSessionKey('coop', ['kbLeft', 'kbRight']), introSessionKey('coop', ['kbLeft', 'pad:0']));
    assert.equal(introSessionKey('coop', null), 'coop|');
});

test('full intro: waits for every fire, or times out after 8 s', () => {
    const intro = createIntro(2);
    assert.equal(intro.full, true);
    assert.equal(intro.duration, INTRO_FULL_SECONDS);
    assert.equal(INTRO_FULL_SECONDS, 8);
    assert.deepEqual(intro.ready, [false, false]);
    assert.equal(tickIntro(intro, 1), false);
    assert.equal(introPressFire(intro, 0), true);
    assert.equal(introPressFire(intro, 0), false, 'pressing again changes nothing');
    assert.equal(introPressFire(intro, 5), false, 'no such player');
    assert.equal(introPressFire(intro, -1), false);
    assert.equal(introAllReady(intro), false);
    assert.equal(tickIntro(intro, 1), false);
    assert.equal(introPressFire(intro, 1), true);
    assert.equal(introAllReady(intro), true);
    assert.equal(tickIntro(intro, 0), true, 'everyone ready: starts at once');

    const idle = createIntro(3);
    for (let t = 0; t < 7.9; t += 0.1) assert.equal(tickIntro(idle, 0.1), false);
    assert.equal(tickIntro(idle, 0.2), true, 'timed out');
    assert.equal(idle.timeLeft, 0);
});

test('short intro (later rounds) lasts 2 s; bad dt is ignored', () => {
    const intro = createIntro(2, { full: false });
    assert.equal(intro.full, false);
    assert.equal(intro.duration, INTRO_SHORT_SECONDS);
    assert.equal(tickIntro(intro, NaN), false);
    assert.equal(tickIntro(intro, -3), false);
    assert.equal(tickIntro(intro, 1.5), false);
    assert.equal(tickIntro(intro, 0.5), true);
    assert.equal(tickIntro(null, 0), true);
    assert.deepEqual(createIntro(-2).ready, []);
    assert.equal(introAllReady(createIntro(0)), false);
});

test('keyboardTable lists both profiles', () => {
    const t = keyboardTable();
    assert.deepEqual(t.map(r => r.action), ['Thrust', 'Turn', 'Hyperspace', 'Fire', 'Numpad']);
    assert.deepEqual(t.find(r => r.action === 'Fire'), { action: 'Fire', p1: 'SPACE or F', p2: 'ENTER or RIGHT SHIFT' });
});

test('stereoPan: only side by side with the setting on', () => {
    assert.equal(stereoPan('left', { layout: 'sides' }), -STEREO_PAN);
    assert.equal(stereoPan('right', { layout: 'sides' }), STEREO_PAN);
    assert.equal(stereoPan('left', { layout: 'sides', enabled: false }), 0);
    assert.equal(stereoPan('left', { layout: 'facing' }), 0);
    assert.equal(stereoPan('left', { layout: null }), 0);
    assert.equal(stereoPan(null, { layout: 'sides' }), 0);
});

test('thrustPan: mean of the thrusting players', () => {
    assert.equal(thrustPan([]), 0);
    assert.equal(thrustPan(null), 0);
    assert.equal(thrustPan([-0.6]), -0.6);
    assert.equal(thrustPan([-0.6, 0.6]), 0);
    assert.equal(thrustPan([0.6, NaN]), 0.6);
});
