import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    selectMood, stepEvents, chordAt, layerGains, MusicEngine,
    LOOKAHEAD, PAUSE_DUCK, PAUSE_CUTOFF, OPEN_CUTOFF, MUSIC_MOODS,
} from '../../js/music.js';
import { TUNES, TUNE_IDS, LAYERS, STEPS_PER_BAR } from '../../js/tunes.js';

// ---------------------------------------------------------------------------
// Fake Web Audio: records node creation, start/stop times and param automation.
// ---------------------------------------------------------------------------
class FakeParam {
    constructor(value = 0) { this.value = value; this.events = []; }
    setValueAtTime(v, t) { this.events.push({ type: 'set', v, t }); this.value = v; return this; }
    linearRampToValueAtTime(v, t) { this.events.push({ type: 'linear', v, t }); this.value = v; return this; }
    exponentialRampToValueAtTime(v, t) {
        if (!(v > 0)) throw new RangeError('exponential ramp target must be > 0');
        this.events.push({ type: 'exp', v, t }); this.value = v; return this;
    }
    setTargetAtTime(v, t, c) { this.events.push({ type: 'target', v, t, c }); this.value = v; return this; }
    cancelScheduledValues(t) { this.events.push({ type: 'cancel', t }); return this; }
    ramps() { return this.events.filter(e => e.type === 'linear' || e.type === 'exp'); }
}

class FakeNode {
    constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.outputs = []; ctx.created.push(this); }
    connect(dest) { this.outputs.push(dest); return dest; }
    disconnect() { this.outputs = []; }
}

class FakeSource extends FakeNode {
    constructor(ctx, kind) { super(ctx, kind); this.starts = []; this.stops = []; }
    start(t = 0, offset, duration) {
        if (this.starts.length) throw new Error('start called twice');
        this.starts.push(t); this.offset = offset; this.duration = duration; this.ctx.starts.push({ node: this, t, at: this.ctx.currentTime });
    }
    stop(t = 0) { this.stops.push(t); }
}

class FakeAudioContext {
    constructor({ state = 'running', currentTime = 0 } = {}) {
        this.state = state;
        this.currentTime = currentTime;
        this.sampleRate = 8000;
        this.created = [];
        this.starts = [];
        this.destination = { kind: 'destination', connect() {} };
    }
    createGain() { const n = new FakeNode(this, 'gain'); n.gain = new FakeParam(1); return n; }
    createOscillator() {
        const n = new FakeSource(this, 'osc'); n.type = 'sine';
        n.frequency = new FakeParam(440); n.detune = new FakeParam(0); return n;
    }
    createBiquadFilter() {
        const n = new FakeNode(this, 'filter'); n.type = 'lowpass';
        n.frequency = new FakeParam(350); n.Q = new FakeParam(1); n.gain = new FakeParam(0); return n;
    }
    createDelay() { const n = new FakeNode(this, 'delay'); n.delayTime = new FakeParam(0); return n; }
    createBufferSource() { const n = new FakeSource(this, 'buffer'); n.buffer = null; return n; }
    createBuffer(ch, len, sr) {
        const data = new Float32Array(len);
        return { numberOfChannels: ch, length: len, sampleRate: sr, getChannelData: () => data };
    }
    count(kind) { return this.created.filter(n => n.kind === kind).length; }
}

function seededRng(seed = 1) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

// Run the engine for `seconds` of simulated time at 60 fps; returns events scheduled.
function run(engine, ctx, seconds, onFrame) {
    let total = 0;
    const frames = Math.round(seconds * 60);
    for (let i = 0; i < frames; i++) {
        const before = ctx.starts.length;
        total += engine.update();
        if (onFrame) onFrame(ctx.starts.slice(before));
        ctx.currentTime += 1 / 60;
    }
    return total;
}

function makeEngine(tune = 'synthwave', mood = 'calm', opts = {}) {
    const ctx = new FakeAudioContext(opts);
    const engine = new MusicEngine(ctx, null, { rng: seededRng(7) });
    engine.setMood(mood);
    engine.setTune(tune);
    return { ctx, engine };
}

const layerParam = (engine, name) => engine.graph.layers[name].gain.gain;

// ---------------------------------------------------------------------------
// selectMood
// ---------------------------------------------------------------------------
test('selectMood matrix', () => {
    const cases = [
        [{ state: 'menu' }, 'menu'],
        [{ state: 'help' }, 'menu'],
        [{ state: 'upgrades' }, 'menu'],
        [{ state: 'prompt_user' }, 'menu'],
        [{ state: 'settings' }, 'menu'],
        [{ state: 'playing', lives: 3 }, 'calm'],
        [{ state: 'playing', lives: 2 }, 'calm'],
        [{ state: 'playing', lives: 1 }, 'danger'],
        [{ state: 'playing', lives: 0 }, 'danger'],
        [{ state: 'playing', lives: 3, bossActive: true }, 'boss'],
        [{ state: 'playing', lives: 1, bossActive: true }, 'boss'],
        [{ state: 'playing', lives: 1, tutorialActive: true }, 'calm'],
        [{ state: 'playing', lives: 3, bossActive: true, tutorialActive: true }, 'calm'],
        [{ state: 'paused', lives: 3 }, 'paused'],
        [{ state: 'playing', paused: true, bossActive: true }, 'paused'],
        [{ state: 'game_over' }, 'gameover'],
    ];
    for (const [input, expected] of cases) assert.equal(selectMood(input), expected, JSON.stringify(input));
    assert.equal(selectMood(), 'menu');
    for (const [, m] of cases) assert.ok(MUSIC_MOODS.includes(m));
});

// ---------------------------------------------------------------------------
// stepEvents (pure patterns)
// ---------------------------------------------------------------------------
test('stepEvents is deterministic for a given rng', () => {
    for (const id of TUNE_IDS) {
        for (const mood of ['menu', 'calm', 'danger', 'boss']) {
            const a = [];
            const b = [];
            const r1 = seededRng(3);
            const r2 = seededRng(3);
            for (let bar = 0; bar < 16; bar++) for (let s = 0; s < STEPS_PER_BAR; s++) {
                a.push(stepEvents(TUNES[id], mood, bar, s, r1));
                b.push(stepEvents(TUNES[id], mood, bar, s, r2));
            }
            assert.deepEqual(a, b);
        }
    }
});

test('chords follow the progression bar by bar and change only on bar lines', () => {
    const t = TUNES.synthwave;
    const names = [0, 1, 2, 3].map(bar => chordAt(t, 'calm', bar).name);
    assert.deepEqual(names, ['Am7', 'Fmaj7', 'Cadd9', 'G']);
    // Section B after 8 bars
    assert.equal(chordAt(t, 'calm', 8).name, 'F');
    assert.equal(chordAt(t, 'boss', 3).name, 'E');
    // Pad chord only on step 0 of the bar (no pad pattern in synthwave)
    for (let s = 1; s < STEPS_PER_BAR; s++) {
        assert.ok(!stepEvents(t, 'calm', 0, s, seededRng()).some(e => e.voice === 'pad'));
    }
    const pad = stepEvents(t, 'calm', 1, 0, seededRng()).find(e => e.voice === 'pad');
    assert.deepEqual(pad.notes, [...chordAt(t, 'calm', 1).notes]);
    assert.equal(pad.dur, STEPS_PER_BAR);
});

test('only layers audible in the mood produce events (menu = pad only for synthwave)', () => {
    const t = TUNES.synthwave;
    const voices = new Set();
    const rng = seededRng();
    for (let bar = 0; bar < 8; bar++) for (let s = 0; s < 16; s++) stepEvents(t, 'menu', bar, s, rng).forEach(e => voices.add(e.voice));
    assert.deepEqual([...voices], ['pad']);
    const calm = new Set();
    for (let bar = 0; bar < 8; bar++) for (let s = 0; s < 16; s++) stepEvents(t, 'calm', bar, s, rng).forEach(e => calm.add(e.voice));
    assert.ok(!calm.has('kick') && !calm.has('snare'), 'no kick/snare in calm');
    assert.ok(calm.has('bass') && calm.has('hat') && calm.has('arp') && calm.has('lead'));
    const boss = new Set();
    for (let bar = 0; bar < 8; bar++) for (let s = 0; s < 16; s++) stepEvents(t, 'boss', bar, s, rng).forEach(e => boss.add(e.voice));
    for (const v of ['pad', 'bass', 'arp', 'kick', 'snare', 'hat']) assert.ok(boss.has(v), `boss has ${v}`);
});

test('explicit layer set limits the generated voices', () => {
    const t = TUNES.synthwave;
    const ev = stepEvents(t, 'boss', 0, 0, seededRng(), new Set(['kick']));
    assert.ok(ev.length > 0);
    assert.ok(ev.every(e => e.voice === 'kick'));
});

test('boss arpeggio runs in 16ths, calm in 8ths; patterns rotate every 4 bars', () => {
    const t = TUNES.synthwave;
    const arpSteps = (mood, bar) => {
        const out = [];
        for (let s = 0; s < 16; s++) if (stepEvents(t, mood, bar, s, seededRng()).some(e => e.voice === 'arp')) out.push(s);
        return out;
    };
    assert.equal(arpSteps('boss', 0).length, 16);
    assert.deepEqual(arpSteps('calm', 0), [0, 2, 4, 6, 8, 10, 12, 14]);
    const arpNotes = bar => {
        const out = [];
        for (let s = 0; s < 16; s++) out.push(stepEvents(t, 'boss', bar, s, seededRng()).find(e => e.voice === 'arp')?.note);
        return out;
    };
    // bar 0 and bar 4 are both Am7 in boss mode but use different arp patterns
    assert.equal(chordAt(t, 'boss', 0).name, chordAt(t, 'boss', 4).name);
    assert.notDeepEqual(arpNotes(0), arpNotes(4));
    // arp notes are chord tones
    const pcs = new Set(chordAt(t, 'boss', 0).notes.map(n => n % 12));
    for (const n of arpNotes(0)) assert.ok(pcs.has(n % 12));
});

test('bass follows the chord root and notes last until the next one', () => {
    const t = TUNES.synthwave;
    for (let bar = 0; bar < 4; bar++) {
        const root = chordAt(t, 'calm', bar).bass;
        let covered = 0;
        for (let s = 0; s < 16; s++) {
            const b = stepEvents(t, 'calm', bar, s, seededRng()).find(e => e.voice === 'bass');
            if (b) {
                assert.ok([0, 7, 12].includes(b.note - root), `bass interval ${b.note - root}`);
                covered += b.dur;
            }
        }
        assert.equal(covered, 16);
    }
});

test('melody plays only in the second half of each 8-bar block', () => {
    const t = TUNES.synthwave;
    const hasLead = bar => {
        for (let s = 0; s < 16; s++) if (stepEvents(t, 'calm', bar, s, seededRng()).some(e => e.voice === 'lead')) return true;
        return false;
    };
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 12].map(hasLead), [false, false, false, false, true, true, true, true, true]);
});

test('boss drums: four on the floor with a fill on the last bar of 8', () => {
    const t = TUNES.synthwave;
    const hits = (bar, voice) => {
        const out = [];
        for (let s = 0; s < 16; s++) if (stepEvents(t, 'boss', bar, s, seededRng()).some(e => e.voice === voice)) out.push(s);
        return out;
    };
    assert.deepEqual(hits(0, 'kick'), [0, 4, 8, 12]);
    assert.deepEqual(hits(0, 'snare'), [4, 12]);
    assert.ok(hits(7, 'snare').length > hits(0, 'snare').length);
});

test('danger adds the heartbeat pulse', () => {
    for (const id of TUNE_IDS) {
        const ev = stepEvents(TUNES[id], 'danger', 0, 0, seededRng());
        assert.ok(ev.some(e => e.voice === 'pulse'), id);
        assert.ok(!stepEvents(TUNES[id], 'calm', 0, 0, seededRng()).some(e => e.voice === 'pulse'), id);
    }
});

test('ambient bells are sparse and random (rng driven)', () => {
    const t = TUNES.ambient;
    const count = seed => {
        const rng = seededRng(seed);
        let n = 0;
        for (let bar = 0; bar < 32; bar++) for (let s = 0; s < 16; s++) n += stepEvents(t, 'calm', bar, s, rng).filter(e => e.voice === 'bell').length;
        return n;
    };
    const a = count(1);
    assert.ok(a > 5 && a < 32 * 8 * 0.3, `bells ${a}`);
    assert.equal(stepEvents(t, 'calm', 0, 0, () => 0.99).filter(e => e.voice === 'bell').length, 0);
    assert.equal(stepEvents(t, 'calm', 0, 0, () => 0.0).filter(e => e.voice === 'bell').length, 1);
});

test('paused/gameover moods fall back to calm material; unknown tune gives nothing', () => {
    const t = TUNES.synthwave;
    assert.deepEqual(stepEvents(t, 'paused', 0, 0, seededRng(), new Set(['pad'])), stepEvents(t, 'calm', 0, 0, seededRng(), new Set(['pad'])));
    assert.deepEqual(stepEvents(null, 'calm', 0, 0), []);
});

test('layerGains covers every layer with zero defaults', () => {
    const g = layerGains(TUNES.synthwave, 'menu');
    assert.deepEqual(Object.keys(g).sort(), [...LAYERS].sort());
    assert.equal(g.kick, 0);
    assert.ok(g.pad > 0);
});

// ---------------------------------------------------------------------------
// MusicEngine
// ---------------------------------------------------------------------------
test('nothing happens unless the audio context is running', () => {
    const { ctx, engine } = makeEngine('synthwave', 'calm', { state: 'suspended' });
    assert.equal(run(engine, ctx, 2), 0);
    assert.equal(ctx.count('osc'), 0);
    assert.equal(ctx.starts.length, 0);
    assert.equal(engine.playPreview('ambient'), 0);
    assert.equal(engine.playGameOverPhrase(), 0);
    ctx.state = 'running';
    assert.ok(run(engine, ctx, 1) > 0);
    assert.ok(ctx.starts.length > 0);
});

test('a null context gives a silent no-op engine', () => {
    const engine = new MusicEngine(null);
    assert.equal(engine.setTune('synthwave'), 'synthwave');
    assert.equal(engine.setMood('boss'), true);
    assert.equal(engine.update(), 0);
    assert.equal(engine.playPreview('synthwave'), 0);
    assert.equal(engine.playGameOverPhrase(), 0);
    engine.setVolume(3);
    engine.stop();
    engine.start();
});

test('notes are scheduled only inside the lookahead window and never in the past', () => {
    const { ctx, engine } = makeEngine('synthwave', 'boss');
    let frames = 0;
    run(engine, ctx, 6, (starts) => {
        frames++;
        for (const s of starts) {
            assert.ok(s.t >= s.at - 1e-9, `start ${s.t} before now ${s.at}`);
            assert.ok(s.t <= s.at + LOOKAHEAD + 1e-9, `start ${s.t} beyond lookahead from ${s.at}`);
        }
    });
    assert.ok(frames > 0);
    assert.ok(ctx.starts.length > 50);
});

test('steps are evenly spaced on the audio clock at the tune tempo', () => {
    const { ctx, engine } = makeEngine('synthwave', 'boss');
    run(engine, ctx, 4);
    const kicks = ctx.starts.filter(s => s.node.kind === 'osc' && s.node.frequency.events.some(e => e.type === 'exp' && Math.abs(e.v - 42) < 1e-6)).map(s => s.t);
    assert.ok(kicks.length >= 4);
    const beat = 60 / 96;
    for (let i = 1; i < kicks.length; i++) assert.ok(Math.abs(kicks[i] - kicks[i - 1] - beat) < 1e-6);
});

test('a 10 s clock jump resynchronises instead of bursting catch-up notes', () => {
    const { ctx, engine } = makeEngine('synthwave', 'boss');
    run(engine, ctx, 2);
    const before = ctx.starts.length;
    ctx.currentTime += 10;
    const n = engine.update();
    const added = ctx.starts.slice(before);
    // at most the notes of ~0.25 s of boss music (a handful of 16th steps)
    assert.ok(n < 40, `scheduled ${n} events after the jump`);
    for (const s of added) assert.ok(s.t >= ctx.currentTime, 'no notes in the past after the jump');
    assert.equal(engine.stats.resyncs, 1);
});

test('suspend then resume (iOS interruption) does not burst notes', () => {
    const { ctx, engine } = makeEngine('chiptune', 'boss');
    run(engine, ctx, 1);
    ctx.state = 'suspended';
    assert.equal(run(engine, ctx, 3), 0);
    ctx.state = 'running';
    const before = ctx.starts.length;
    engine.update();
    for (const s of ctx.starts.slice(before)) assert.ok(s.t >= ctx.currentTime);
    assert.ok(ctx.starts.length - before < 60);
});

test('mood change ramps the right layers and switches patterns on the next bar', () => {
    const { ctx, engine } = makeEngine('synthwave', 'calm');
    run(engine, ctx, 1.2); // mid-bar (bar = 2.5 s)
    const kickP = layerParam(engine, 'kick');
    const leadP = layerParam(engine, 'lead');
    const padP = layerParam(engine, 'pad');
    const kickRampsBefore = kickP.ramps().length;
    const barStart = engine.nextStepTime + (16 - engine.step) * (60 / 96 / 4);
    const tChange = ctx.currentTime;
    assert.equal(engine.setMood('boss'), true);
    assert.equal(engine.setMood('boss'), false, 'same mood is a no-op');

    const lastRamp = p => p.ramps().at(-1);
    assert.ok(kickP.ramps().length > kickRampsBefore);
    assert.equal(lastRamp(kickP).v, TUNES.synthwave.layers.boss.kick);
    assert.ok(lastRamp(kickP).t - tChange >= 1.5 - 1e-9 && lastRamp(kickP).t - tChange <= 2.0 + 1e-9, 'glide 1.5-2 s');
    assert.equal(lastRamp(leadP).v, 0, 'lead fades out in boss');
    assert.equal(lastRamp(padP).v, TUNES.synthwave.layers.boss.pad);
    // hat layer: 0.5 -> 0.7
    assert.equal(lastRamp(layerParam(engine, 'hat')).v, 0.7);

    assert.equal(engine.patternMood, 'calm', 'patterns wait for the bar line');
    const startsBefore = ctx.starts.length;
    run(engine, ctx, 3);
    assert.equal(engine.patternMood, 'boss');
    // The first boss-only snare is not before the bar line
    const snares = ctx.starts.slice(startsBefore).filter(s => s.node.kind === 'buffer'
        && s.node.outputs[0].outputs[0] === engine.graph.layers.snare.gain);
    assert.ok(snares.length > 0);
    assert.ok(snares[0].t >= barStart - 1e-6, `snare at ${snares[0].t}, bar at ${barStart}`);
});

test('layers keep playing while they fade out, then stop generating events', () => {
    const { ctx, engine } = makeEngine('synthwave', 'boss');
    run(engine, ctx, 3);
    engine.setMood('calm');
    run(engine, ctx, 1.0);
    assert.ok(engine._activeLayers().has('kick'), 'kick still fading');
    run(engine, ctx, 4);
    assert.ok(!engine._activeLayers().has('kick'));
    const before = ctx.starts.length;
    run(engine, ctx, 3);
    const kickOut = engine.graph.layers.kick.gain;
    assert.equal(ctx.starts.slice(before).filter(s => s.node.outputs[0]?.outputs[0] === kickOut).length, 0);
});

test('paused ducks about 8 dB and closes the filter; resuming restores', () => {
    const { ctx, engine } = makeEngine('synthwave', 'calm');
    run(engine, ctx, 1);
    engine.setMood('paused');
    const duck = engine.graph.duck.gain;
    const bus = engine.graph.busFilter.frequency;
    assert.equal(duck.ramps().at(-1).v, PAUSE_DUCK);
    assert.ok(Math.abs(20 * Math.log10(PAUSE_DUCK) + 8) < 0.5);
    assert.equal(bus.ramps().at(-1).v, PAUSE_CUTOFF);
    assert.equal(engine.patternMood, 'calm');
    assert.ok(run(engine, ctx, 1) > 0, 'music continues quietly while paused');
    engine.setMood('calm');
    assert.equal(duck.ramps().at(-1).v, 1);
    assert.equal(bus.ramps().at(-1).v, OPEN_CUTOFF);
});

test('volume 0 stops scheduling; volume is clamped and uses a v^2 curve', () => {
    const { ctx, engine } = makeEngine('synthwave', 'calm');
    run(engine, ctx, 1);
    assert.equal(engine.setVolume(0), 0);
    assert.equal(engine.graph.volume.gain.ramps().at(-1).v, 0);
    const before = ctx.starts.length;
    assert.equal(run(engine, ctx, 2), 0);
    assert.equal(ctx.starts.length, before);
    assert.equal(engine.setVolume(15), 10);
    assert.equal(engine.setVolume(-3), 0);
    engine.setVolume(5);
    const g5 = engine.graph.volume.gain.ramps().at(-1).v;
    engine.setVolume(10);
    const g10 = engine.graph.volume.gain.ramps().at(-1).v;
    assert.ok(Math.abs(g5 / g10 - 0.25) < 1e-9);
    assert.ok(g10 <= 1);
    assert.equal(engine.setVolume('abc'), 10, 'non-numbers are ignored');
    const n = run(engine, ctx, 1);
    assert.ok(n > 0, 'scheduling resumes');
});

test('tune off stops the sequencer; unknown tunes count as off', () => {
    const { ctx, engine } = makeEngine('synthwave', 'calm');
    run(engine, ctx, 1);
    assert.equal(engine.setTune('off'), 'off');
    assert.equal(engine.scheduling, false);
    assert.equal(run(engine, ctx, 2), 0);
    assert.equal(engine.setTune('polka'), 'off');
    assert.equal(engine.setTune('ambient'), 'ambient');
    assert.ok(run(engine, ctx, 2) > 0);
});

test('switching tunes fades the old one and restarts at bar 0 without overlap', () => {
    const { ctx, engine } = makeEngine('synthwave', 'calm');
    run(engine, ctx, 3);
    const t = ctx.currentTime;
    engine.setTune('chiptune');
    assert.equal(engine.bar, 0);
    assert.equal(engine.graph.seq.gain.events.some(e => e.type === 'linear' && e.v === 0 && e.t > t), true);
    const before = ctx.starts.length;
    run(engine, ctx, 1);
    for (const s of ctx.starts.slice(before)) assert.ok(s.t >= t + 0.2 - 1e-9, 'new tune starts after the fade');
});

test('stop() halts and start() resumes', () => {
    const { ctx, engine } = makeEngine('synthwave', 'calm');
    run(engine, ctx, 1);
    engine.stop();
    assert.equal(run(engine, ctx, 1), 0);
    engine.start();
    assert.ok(run(engine, ctx, 1) > 0);
});

test('envelopes always ramp (no clicks) and stay gentle', () => {
    for (const id of TUNE_IDS) {
        for (const mood of ['menu', 'calm', 'danger', 'boss']) {
            const { ctx, engine } = makeEngine(id, mood);
            run(engine, ctx, 6);
            const layerGainsSet = new Set(Object.values(engine.graph.layers).flatMap(l => [l.gain, l.send]));
            const persistent = new Set([engine.graph.volume, engine.graph.duck, engine.graph.seq, engine.graph.echoIn, engine.graph.feedback, engine.graph.wet, ...layerGainsSet]);
            const envs = ctx.created.filter(n => n.kind === 'gain' && !persistent.has(n) && n.gain.events.length);
            assert.ok(envs.length > 0);
            for (const g of envs) {
                const ev = g.gain.events;
                assert.equal(ev[0].type, 'set');
                assert.equal(ev[0].v, 0, 'envelopes start from silence');
                assert.ok(ev.some(e => e.type === 'linear'), 'attack is a ramp');
                for (const e of ev) assert.ok(e.v <= 0.5, `${id} ${mood} peak ${e.v}`);
                const last = ev.at(-1);
                assert.ok(last.v <= 0.0001 + 1e-12, 'ends silent');
            }
            // every oscillator/buffer is stopped (nothing long-running leaks)
            for (const n of ctx.created) {
                if (n.kind === 'osc' || n.kind === 'buffer') {
                    assert.equal(n.starts.length, 1);
                    assert.equal(n.stops.length, 1);
                    assert.ok(n.stops[0] > n.starts[0] && n.stops[0] - n.starts[0] < 8, 'short-lived');
                }
            }
        }
    }
});

test('node budget stays modest in boss mode', () => {
    for (const id of TUNE_IDS) {
        const { ctx, engine } = makeEngine(id, 'boss');
        engine.update();
        const base = ctx.created.length;
        run(engine, ctx, 20);
        const perSecond = (ctx.created.length - base) / 20;
        assert.ok(perSecond < 45, `${id}: ${perSecond.toFixed(1)} nodes/s`);
    }
});

test('persistent graph is built once and routed to the destination', () => {
    const ctx = new FakeAudioContext();
    const dest = ctx.createGain();
    const engine = new MusicEngine(ctx, dest, { rng: seededRng() });
    engine.setTune('synthwave');
    engine.setMood('calm');
    run(engine, ctx, 1);
    assert.equal(ctx.count('delay'), 1);
    assert.ok(engine.graph.volume.outputs.includes(dest));
    const graph = engine.graph;
    engine.setTune('ambient');
    assert.equal(engine.graph, graph);
    assert.equal(ctx.count('delay'), 1);
    // echo delay follows the tune tempo (ambient: 6 sixteenths at 70 BPM)
    const d = graph.delay.delayTime.events.at(-1).v;
    assert.ok(Math.abs(d - 6 * 60 / 70 / 4) < 1e-9);
});

test('playPreview plays a short phrase of the chosen tune and ducks the sequencer', () => {
    const { ctx, engine } = makeEngine('synthwave', 'menu');
    run(engine, ctx, 1);
    const now = ctx.currentTime;
    const before = ctx.starts.length;
    const len = engine.playPreview('chiptune');
    assert.ok(len > 1 && len <= 6, `preview ${len}s`);
    const added = ctx.starts.slice(before);
    assert.ok(added.length > 10);
    for (const s of added) {
        assert.ok(s.t >= now);
        assert.ok(s.t <= now + len + 0.1);
    }
    const seq = engine.graph.seq.gain;
    assert.ok(seq.events.some(e => e.type === 'linear' && e.v === 0));
    assert.ok(seq.events.some(e => e.type === 'linear' && e.v === 1 && e.t > now + len));
    assert.equal(engine.playPreview('off'), 0);
    assert.equal(engine.playPreview('nope'), 0);
    // A second preview replaces the first one (old output fades)
    const first = engine.preview.out;
    ctx.currentTime += 1;
    engine.playPreview('ambient');
    assert.equal(first.gain.ramps().at(-1).v, 0);
    engine.setVolume(0);
    assert.equal(engine.playPreview('synthwave'), 0);
});

test('preview works when the music tune is off', () => {
    const { ctx, engine } = makeEngine('off', 'menu');
    assert.equal(engine.update(), 0);
    const len = engine.playPreview('ambient');
    assert.ok(len > 0);
    assert.ok(ctx.starts.length > 0);
});

test('game over: layers fade out and a falling phrase plays once', () => {
    const { ctx, engine } = makeEngine('synthwave', 'calm');
    run(engine, ctx, 2);
    const before = ctx.starts.length;
    engine.setMood('gameover');
    for (const name of LAYERS) {
        const r = layerParam(engine, name).ramps().at(-1);
        if (r) assert.equal(r.v, 0, `${name} fades`);
    }
    const phraseOscs = ctx.starts.slice(before).filter(s => s.node.kind === 'osc');
    assert.ok(phraseOscs.length >= 5);
    const leadFreqs = phraseOscs.map(s => s.node.frequency.value);
    assert.ok(Math.max(...leadFreqs) > Math.min(...leadFreqs));
    assert.equal(engine.playGameOverPhrase(), 0, 'not retriggered while playing');
    ctx.currentTime += 10;
    assert.ok(engine.playGameOverPhrase() > 0);
    // back to the menu: layers come back
    engine.setMood('menu');
    assert.ok(layerParam(engine, 'pad').ramps().at(-1).v > 0);
});

test('snapshot reports tune, mood and scheduling state', () => {
    const { engine } = makeEngine('ambient', 'danger');
    const s = engine.snapshot();
    assert.equal(s.tune, 'ambient');
    assert.equal(s.mood, 'danger');
    assert.equal(s.scheduling, true);
    assert.equal(s.running, true);
});

// ---------------------------------------------------------------------------
// Ramps continue from the automated value (regression: stale param.value made the
// ambient pad filter snap open at each bar and ring, peaking near 2.0 when rendered)
// ---------------------------------------------------------------------------
test('ramps use cancelAndHoldAtTime when available and never jump to param.value', () => {
    const { engine } = makeEngine('ambient', 'calm');
    const p = new FakeParam(18000);
    const holds = [];
    p.cancelAndHoldAtTime = (t) => { holds.push(t); p.events.push({ type: 'hold', t }); return p; };
    engine._ramp(p, 900, 2, 1);
    assert.deepEqual(holds, [2]);
    assert.ok(!p.events.some(e => e.type === 'set'), 'no setValueAtTime from the stale value');
    assert.deepEqual(p.events.at(-1), { type: 'linear', v: 900, t: 3 });
});

test('ramps fall back to cancel + set + ramp without cancelAndHoldAtTime (or when it throws)', () => {
    const { engine } = makeEngine('ambient', 'calm');
    const p = new FakeParam(0.5);
    engine._ramp(p, 1, 1, 0.5);
    assert.deepEqual(p.events.map(e => e.type), ['cancel', 'set', 'linear']);
    const q = new FakeParam(0.5);
    q.cancelAndHoldAtTime = () => { throw new RangeError('not supported'); };
    engine._ramp(q, 1, 1, 0.5);
    assert.deepEqual(q.events.map(e => e.type), ['cancel', 'set', 'linear']);
});

test('previews are rate-limited (the last pick plays) and their nodes are disconnected', () => {
    const { ctx, engine } = makeEngine('synthwave', 'menu');
    run(engine, ctx, 1);
    assert.ok(engine.playPreview('chiptune') > 0);
    const first = engine.preview;
    // Cycling fast through tunes: nothing new is scheduled, the last pick is remembered
    const before = ctx.starts.length;
    assert.equal(engine.playPreview('ambient'), 0);
    assert.equal(engine.playPreview('synthwave'), 0);
    assert.equal(ctx.starts.length, before);
    assert.equal(engine.preview, first);
    // Once the interval has passed, update() plays the last pick and retires the old preview
    ctx.currentTime += 0.5;
    engine.update();
    assert.equal(engine.preview.tuneId, 'synthwave');
    assert.ok(first.out.outputs.length > 0, 'fading, still connected');
    ctx.currentTime += 0.3;
    engine.update();
    assert.equal(first.out.outputs.length, 0, 'the replaced preview is disconnected');
    // A finished preview is disconnected after its tail
    const second = engine.preview;
    ctx.currentTime = second.until + 2;
    engine.update();
    assert.equal(engine.preview, null);
    assert.equal(second.out.outputs.length, 0);
    assert.ok(second.nodes.length > 0 && second.nodes.every((n) => n.outputs.length === 0));
});
