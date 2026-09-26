import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    TUNES, TUNE_IDS, TUNE_OPTIONS, MOODS, LAYERS, STEPS_PER_BAR,
    noteToMidi, midiToFreq, parseBar, parseHits, tuneName,
} from '../../js/tunes.js';
import { SETTING_DEFS } from '../../js/settings.js';

const NOTE_MIN = 24; // C1
const NOTE_MAX = 96; // C7
const PC_OF = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function rootPc(chordName) {
    const m = /^([A-G])(#|b)?/.exec(chordName);
    return (PC_OF[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
}

test('noteToMidi / midiToFreq basics', () => {
    assert.equal(noteToMidi('C4'), 60);
    assert.equal(noteToMidi('A4'), 69);
    assert.equal(noteToMidi('C#5'), 73);
    assert.equal(noteToMidi('Bb3'), 58);
    assert.equal(noteToMidi('B1'), 35);
    assert.throws(() => noteToMidi('H2'));
    assert.equal(midiToFreq(69), 440);
    assert.ok(Math.abs(midiToFreq(81) - 880) < 1e-9);
});

test('parseBar and parseHits validate bar length', () => {
    assert.deepEqual(parseBar('A4:8 -:4 C5:4'), [{ step: 0, note: 69, dur: 8 }, { step: 12, note: 72, dur: 4 }]);
    assert.throws(() => parseBar('A4:8 C5:4'));
    assert.throws(() => parseBar('A4:0 C5:16'));
    assert.deepEqual(parseHits('x.o.............').slice(0, 4), [1, 0, 0.55, 0]);
    assert.throws(() => parseHits('x.x'));
});

test('the three decided tunes exist with their planned tempos', () => {
    assert.deepEqual([...TUNE_IDS].sort(), ['ambient', 'chiptune', 'synthwave']);
    assert.equal(TUNES.synthwave.bpm, 96);
    assert.equal(TUNES.ambient.bpm, 70);
    assert.equal(TUNES.chiptune.bpm, 132);
    for (const id of TUNE_IDS) {
        assert.equal(TUNES[id].id, id);
        assert.ok(TUNES[id].name.length > 0);
    }
});

test('tune options match the musicTune setting values', () => {
    assert.deepEqual([...TUNE_OPTIONS].sort(), [...SETTING_DEFS.musicTune.values].sort());
    assert.equal(tuneName('off'), 'Off');
    assert.equal(tuneName('chiptune'), 'Chiptune');
    assert.equal(tuneName('nope'), 'Off');
});

test('every tune defines progressions, layers and filter scale for every mood', () => {
    for (const id of TUNE_IDS) {
        const t = TUNES[id];
        for (const mood of MOODS) {
            assert.ok(Array.isArray(t.progressions[mood]) && t.progressions[mood].length > 0, `${id} ${mood} progression`);
            for (const section of t.progressions[mood]) assert.ok(section.length > 0);
            assert.ok(t.layers[mood], `${id} ${mood} layers`);
            assert.ok(Object.values(t.layers[mood]).some(g => g > 0), `${id} ${mood} has an audible layer`);
            assert.ok(t.filterScale[mood] > 0, `${id} ${mood} filter scale`);
        }
    }
});

test('menu mood is pad-led; boss mood is the busiest', () => {
    for (const id of TUNE_IDS) {
        const L = TUNES[id].layers;
        assert.ok(L.menu.pad > 0, `${id} menu has a pad`);
        assert.ok(!L.menu.kick && !L.menu.snare, `${id} menu has no drums`);
        assert.ok(L.boss.kick > 0 && L.boss.snare > 0, `${id} boss has kick and snare`);
        assert.ok(L.danger.pulse > 0, `${id} danger has the heartbeat pulse`);
        const drums = m => (L[m].kick || 0) + (L[m].snare || 0) + (L[m].hat || 0);
        assert.ok(drums('boss') > drums('calm'), `${id} boss drums are stronger than calm`);
        assert.ok(TUNES[id].filterScale.danger < TUNES[id].filterScale.calm, `${id} danger filter is tighter`);
    }
});

test('ambient has no drums in calm mood', () => {
    const a = TUNES.ambient;
    assert.ok(!a.layers.calm.kick && !a.layers.calm.snare && !a.layers.calm.hat);
    assert.equal(a.drums.calm, undefined);
});

test('all layer names are known and every audible layer has a voice', () => {
    for (const id of TUNE_IDS) {
        const t = TUNES[id];
        for (const mood of MOODS) {
            for (const [layer, gain] of Object.entries(t.layers[mood])) {
                assert.ok(LAYERS.includes(layer), `${id} unknown layer ${layer}`);
                assert.ok(gain >= 0 && gain <= 1, `${id} ${mood} ${layer} gain in 0..1`);
                if (gain > 0) assert.ok(t.voices[layer], `${id} ${mood} ${layer} has a voice`);
            }
        }
        for (const v of Object.keys(t.voices)) assert.ok(LAYERS.includes(v));
    }
});

test('all chord, bass and melody notes are in range', () => {
    for (const id of TUNE_IDS) {
        const t = TUNES[id];
        for (const mood of MOODS) {
            for (const section of t.progressions[mood]) {
                for (const c of section) {
                    for (const n of c.notes) assert.ok(n >= 48 && n <= 84, `${id} ${c.name} pad note ${n}`);
                    assert.ok(c.bass >= 28 && c.bass <= 55, `${id} ${c.name} bass ${c.bass}`);
                    // bass pattern offsets keep it in range too
                    const pats = Object.values(t.bass.patterns);
                    for (const p of pats) for (const o of p) if (o !== null) assert.ok(c.bass + o <= 67 && c.bass + o >= NOTE_MIN);
                    // arp tones (two octaves above the voicing plus arp.octave)
                    assert.ok(Math.max(...c.notes) + 12 + t.arp.octave <= NOTE_MAX);
                }
            }
            const mel = t.lead.melodies[mood];
            if (mel) {
                for (const sec of mel) for (const bar of sec) {
                    for (const e of bar) {
                        assert.ok(e.note >= 55 && e.note <= NOTE_MAX, `${id} melody note ${e.note}`);
                        assert.ok(e.step + e.dur <= STEPS_PER_BAR);
                    }
                }
            }
        }
        for (const e of t.gameOver.events) assert.ok(e.note >= NOTE_MIN && e.note <= NOTE_MAX);
        for (let i = 1; i < t.gameOver.events.length; i++) {
            assert.ok(t.gameOver.events[i].note < t.gameOver.events[i - 1].note, `${id} game-over phrase falls`);
        }
    }
});

test('chords are real voicings: bass on the chord root, compact upper voicing', () => {
    for (const id of TUNE_IDS) {
        const t = TUNES[id];
        for (const mood of MOODS) {
            for (const section of t.progressions[mood]) {
                for (const c of section) {
                    assert.equal(c.bass % 12, rootPc(c.name), `${id} ${c.name} bass is the root`);
                    assert.ok(c.notes.length >= 3, `${id} ${c.name} at least a triad`);
                    const span = Math.max(...c.notes) - Math.min(...c.notes);
                    assert.ok(span <= 19, `${id} ${c.name} voicing span ${span}`);
                    const sorted = [...c.notes].sort((a, b) => a - b);
                    assert.deepEqual([...c.notes], sorted, `${id} ${c.name} notes ascending`);
                }
            }
        }
    }
});

test('planned progressions for synthwave: calm Am-F-C-G, boss Am-F-Dm-E, danger Am-Am-F-E', () => {
    const names = s => s.map(c => /^([A-G][#b]?)(m(?!aj))?/.exec(c.name).slice(1).join(''));
    const t = TUNES.synthwave;
    assert.deepEqual(names(t.progressions.calm[0]), ['Am', 'F', 'C', 'G']);
    assert.deepEqual(names(t.progressions.boss[0]), ['Am', 'F', 'Dm', 'E']);
    assert.deepEqual(names(t.progressions.danger[0]), ['Am', 'Am', 'F', 'E']);
});

test('patterns are 16 steps; arp has 3 patterns for variation', () => {
    for (const id of TUNE_IDS) {
        const t = TUNES[id];
        for (const p of Object.values(t.bass.patterns)) assert.equal(p.length, STEPS_PER_BAR);
        assert.equal(t.arp.patterns.length, 3);
        for (const p of t.arp.patterns) assert.equal(p.length, STEPS_PER_BAR);
        for (const [k, kit] of Object.entries(t.drums)) {
            if (k === 'fill' || k === 'ghostHat') continue;
            for (const part of ['kick', 'snare', 'hat']) assert.equal(kit[part].length, STEPS_PER_BAR);
        }
        for (const f of Object.values(t.drums.fill || {})) assert.equal(f.length, STEPS_PER_BAR);
        assert.equal(t.pulse.length, STEPS_PER_BAR);
    }
});

test('voices use only basic oscillator types and gentle gains', () => {
    const types = new Set(['sine', 'square', 'sawtooth', 'triangle']);
    for (const id of TUNE_IDS) {
        for (const [name, v] of Object.entries(TUNES[id].voices)) {
            if (v.drum !== 'noise') assert.ok(types.has(v.type), `${id} ${name} type ${v.type}`);
            assert.ok(v.gain > 0 && v.gain <= 0.5, `${id} ${name} gain ${v.gain}`);
            if (v.filter) assert.ok(['lowpass', 'highpass', 'bandpass'].includes(v.filter.type));
            if (v.echo) assert.ok(v.echo <= 1);
        }
        const e = TUNES[id].echo;
        assert.ok(e.feedback < 0.6, 'echo feedback stays well below runaway');
    }
});

test('tunes are frozen data', () => {
    assert.ok(Object.isFrozen(TUNES));
    assert.ok(Object.isFrozen(TUNES.synthwave.layers.calm));
    assert.throws(() => { 'use strict'; TUNES.synthwave.bpm = 1; });
});
