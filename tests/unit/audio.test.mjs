import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { AudioManager, volumeToGain, preferAmbientAudioSession } from '../../js/audio.js';
import { MusicEngine } from '../../js/music.js';

// Minimal Web Audio fake: records connections and gain values.
class FakeParam {
    constructor(v) { this.value = v; this.events = []; }
    setValueAtTime(v, t) { this.value = v; this.events.push(['set', v, t]); }
    linearRampToValueAtTime(v, t) { this.value = v; this.events.push(['lin', v, t]); }
    exponentialRampToValueAtTime(v, t) { this.value = v; this.events.push(['exp', v, t]); }
    cancelScheduledValues() {}
}
class FakeNode {
    constructor(kind) { this.kind = kind; this.out = []; }
    connect(n) { this.out.push(n); return n; }
    disconnect() { this.out = []; }
}
class FakeCtx {
    constructor() {
        this.state = 'running';
        this.currentTime = 0;
        this.sampleRate = 8000;
        this.destination = new FakeNode('destination');
        this.created = [];
    }
    _n(kind, extra = {}) { const n = Object.assign(new FakeNode(kind), extra); this.created.push(n); return n; }
    createGain() { return this._n('gain', { gain: new FakeParam(1) }); }
    createOscillator() {
        return this._n('osc', { frequency: new FakeParam(440), detune: new FakeParam(0), start() {}, stop() {} });
    }
    createBiquadFilter() { return this._n('filter', { frequency: new FakeParam(350), Q: new FakeParam(1), type: 'lowpass' }); }
    createDelay() { return this._n('delay', { delayTime: new FakeParam(0) }); }
    createBufferSource() { return this._n('src', { start() {}, stop() {}, loop: false }); }
    createBuffer(ch, len) { const d = new Float32Array(len); return { getChannelData: () => d }; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    decodeAudioData() { return Promise.resolve({}); }
}

let saved;
beforeEach(() => {
    saved = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
    globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
    globalThis.fetch = () => new Promise(() => {}); // sound files never arrive (kept silent)
});
afterEach(() => {
    for (const k of Object.keys(saved)) {
        if (saved[k] === undefined) delete globalThis[k];
        else globalThis[k] = saved[k];
    }
});

const quiet = (fn) => {
    const { log, warn, error } = console;
    console.log = console.warn = console.error = () => {};
    try { return fn(); } finally { Object.assign(console, { log, warn, error }); }
};

function makeManager() {
    globalThis.window = { AudioContext: FakeCtx };
    return quiet(() => new AudioManager());
}

test('volumeToGain is a v^2 curve on 0..10 and clamps', () => {
    assert.equal(volumeToGain(10), 1);
    assert.equal(volumeToGain(0), 0);
    assert.equal(volumeToGain(5), 0.25);
    assert.equal(volumeToGain(20), 1);
    assert.equal(volumeToGain(-3), 0);
    assert.equal(volumeToGain('x'), 1);
});

test('sfx and music buses feed the master gain, which feeds the destination', () => {
    const am = makeManager();
    const ctx = am.audioContext;
    assert.ok(am.sfxGain && am.musicGain && am.masterGain);
    assert.deepEqual(am.masterGain.out, [ctx.destination]);
    assert.deepEqual(am.sfxGain.out, [am.masterGain]);
    assert.deepEqual(am.musicGain.out, [am.masterGain]);
});

test('sound effects route through sfxGain, not straight to master', () => {
    const am = makeManager();
    am.sounds.playerShoot = {};
    am.play('playerShoot');
    am.play('collectGreen');
    const perSound = am.audioContext.created.filter(n => n.kind === 'gain' && n.out.includes(am.sfxGain));
    assert.equal(perSound.length, 2);
    assert.ok(!am.audioContext.created.some(n => n !== am.sfxGain && n !== am.musicGain && n.out.includes(am.masterGain)));
});

test('setSfxVolume applies the curve once on sfxGain; 0 skips sound effects', () => {
    const am = makeManager();
    am.sounds.playerShoot = {};
    assert.equal(am.setSfxVolume(5), 5);
    assert.equal(am.sfxGain.gain.value, 0.25);
    assert.equal(am.setSfxVolume(99), 10);
    assert.equal(am.sfxGain.gain.value, 1);
    am.setSfxVolume(0);
    assert.equal(am.play('playerShoot'), null);
    assert.equal(am.playCollectSound(), null);
    am.setSfxVolume(3);
    assert.notEqual(am.play('playerShoot'), null);
});

test('setMusicVolume forwards to the engine; musicGain stays at unity (curve applied once)', () => {
    const am = makeManager();
    const engine = am.attachMusic((ctx, dest) => new MusicEngine(ctx, dest));
    engine.setTune('synthwave');
    assert.equal(am.setMusicVolume(5), 5);
    assert.equal(engine.volume, 5);
    assert.equal(am.musicGain.gain.value, 1);
    assert.equal(engine.graph.volume.gain.value, 0.25 * 0.8); // MusicEngine: v^2 * MASTER_LEVEL
    assert.deepEqual(engine.graph.volume.out, [am.musicGain]);
});

test('mute silences master (both buses) and halts music scheduling; unmute restarts it', () => {
    const am = makeManager();
    const engine = am.attachMusic((ctx, dest) => new MusicEngine(ctx, dest));
    engine.setTune('ambient');
    quiet(() => am.toggleMute());
    assert.equal(am.masterGain.gain.value, 0);
    assert.equal(engine.halted, true);
    assert.equal(engine.update(), 0);
    quiet(() => am.toggleMute());
    assert.equal(am.masterGain.gain.value, 1);
    assert.equal(engine.halted, false);
});

test('attachMusic when already muted starts the engine halted; a throwing factory is contained', () => {
    const am = makeManager();
    quiet(() => am.toggleMute());
    const engine = am.attachMusic((ctx, dest) => new MusicEngine(ctx, dest));
    assert.equal(engine.halted, true);
    const am2 = makeManager();
    assert.equal(quiet(() => am2.attachMusic(() => { throw new Error('boom'); })), null);
    assert.equal(am2.setMusicVolume(4), 0);
});

test('without Web Audio nothing throws and music is a silent engine', () => {
    globalThis.window = {};
    const am = quiet(() => new AudioManager());
    assert.equal(am.audioContext, null);
    assert.equal(am.sfxGain, null);
    const engine = am.attachMusic((ctx, dest) => new MusicEngine(ctx, dest));
    assert.ok(engine);
    assert.doesNotThrow(() => {
        am.setSfxVolume(3);
        am.setMusicVolume(7);
        engine.setTune('chiptune');
        engine.setMood('boss');
        engine.update();
        engine.playPreview('chiptune');
        quiet(() => am.toggleMute());
        am.play('playerShoot');
    });
});

test('an AudioContext constructor that throws leaves the game silent', () => {
    globalThis.window = { AudioContext: function () { throw new Error('no audio'); } };
    const am = quiet(() => new AudioManager());
    assert.equal(am.audioContext, null);
    assert.equal(am.musicGain, null);
});

test('preferAmbientAudioSession is feature-detected', () => {
    assert.equal(preferAmbientAudioSession(null), false);
    assert.equal(preferAmbientAudioSession({}), false);
    const nav = { audioSession: { type: 'auto' } };
    assert.equal(preferAmbientAudioSession(nav), true);
    assert.equal(nav.audioSession.type, 'ambient');
    const broken = { get audioSession() { throw new Error('nope'); } };
    assert.equal(preferAmbientAudioSession(broken), false);
});
