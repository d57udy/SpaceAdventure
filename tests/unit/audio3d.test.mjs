import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAudio3d, spatial, explosionEvent, mood3d, SOUND3D, AUDIO3D } from '../../js/3d/audio3d.js';
import { AudioManager, PROCEDURAL_SOUNDS } from '../../js/audio.js';
import { createSettings } from '../../js/settings.js';

function fakeAudio() {
    const calls = [];
    const a = {
        calls, isMuted: false, sfx: null, musicVol: null, thrust: false,
        play(id, loop, volume, pan) {
            const src = { id, loop, volume, pan, stopped: false, stop() { this.stopped = true; } };
            calls.push(src);
            return src;
        },
        startThrustSound() { this.thrust = true; },
        stopThrustSound() { this.thrust = false; },
        setLoopGain(src, o) { src.volume = o.gain; src.pan = o.pan; },
        setSfxVolume(v) { this.sfx = v; },
        setMusicVolume(v) { this.musicVol = v; },
        toggleMute() { this.isMuted = !this.isMuted; },
        resumeContext() { this.resumed = true; },
    };
    return a;
}
function fakeMusic() {
    return { tune: null, moods: [], updates: 0, setTune(t) { this.tune = t; }, setMood(m) { this.moods.push(m); }, update() { this.updates++; } };
}
function memStorage() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test('spatial: pan from the ship-local x direction, fading with distance', () => {
    assert.deepEqual(spatial(null, 1000), { pan: 0, gain: 1 });
    const right = spatial([100, 0, 0], 1000);
    assert.ok(right.pan > 0.8 && right.pan <= AUDIO3D.maxPan + 1e-9);
    assert.equal(right.gain, 1, 'near: full level');
    const left = spatial([-500, 0, -500], 1000);
    assert.ok(left.pan < -0.5);
    const ahead = spatial([0, 0, -500], 1000);
    assert.equal(ahead.pan, 0);
    assert.ok(ahead.gain > 0 && ahead.gain < 1);
    assert.ok(spatial([0, 0, -900], 1000).gain < ahead.gain, 'further is quieter');
    assert.equal(spatial([0, 0, -1000], 1000).gain, 0);
    assert.equal(spatial([0, 0, -5000], 1000).gain, 0);
    assert.deepEqual(spatial([0, 0, 0], 1000), { pan: 0, gain: 1 });
    // Above or below: centred
    assert.ok(Math.abs(spatial([0, 300, 0], 1000).pan) < 1e-9);
});

test('events map to the 2D sound ids, with pan and level', () => {
    const audio = fakeAudio();
    let t = 0;
    const a = createAudio3d({ audio, now: () => t, range: 1000 });
    a.play('collectGreen', { local: [200, 0, -200] });
    const c = audio.calls[0];
    assert.equal(c.id, 'collectGreen');
    assert.ok(c.pan > 0);
    assert.ok(c.volume > 0 && c.volume <= 1);
    assert.equal(c.loop, false);
    t = 1;
    a.play('shoot', { local: [900, 0, 0] });
    assert.equal(audio.calls[1].pan, 0, 'own sounds are centred');
    assert.ok(audio.calls[1].volume > 0.5);
    for (const [ev, id] of Object.entries(SOUND3D)) assert.equal(typeof id, 'string', ev);
    assert.equal(a.play('nope'), null);
    // Out of hearing range: skipped
    assert.equal(a.play('ufoShoot', { local: [0, 0, -2000] }), null);
});

test('explosions by size; the same event is rate limited', () => {
    assert.equal(explosionEvent('large'), 'explodeLarge');
    assert.equal(explosionEvent('medium'), 'explodeMedium');
    assert.equal(explosionEvent('small'), 'explodeSmall');
    assert.equal(explosionEvent(42), 'explodeLarge');
    assert.equal(explosionEvent(24), 'explodeMedium');
    assert.equal(explosionEvent(13), 'explodeSmall');
    const audio = fakeAudio();
    let t = 0;
    const a = createAudio3d({ audio, now: () => t });
    a.explosion('large', [0, 0, -50]);
    assert.equal(audio.calls[0].id, 'asteroidExplodeL');
    a.play('shoot'); t += 0.01; a.play('shoot');
    assert.equal(audio.calls.filter(c => c.id === 'playerShoot').length, 1);
    t += 0.1; a.play('shoot');
    assert.equal(audio.calls.filter(c => c.id === 'playerShoot').length, 2);
});

test('voice cap: at most maxVoices spatial sounds per window; hits and UI sounds always play', () => {
    const audio = fakeAudio();
    let t = 0;
    const a = createAudio3d({ audio, now: () => t });
    for (let i = 0; i < 20; i++) { a.play('explodeLarge', { local: [0, 0, -30] }); t += 0.001; }
    assert.equal(audio.calls.length, AUDIO3D.maxVoices);
    a.play('hit');
    a.play('levelUp');
    assert.equal(audio.calls.length, AUDIO3D.maxVoices + 2);
    t += AUDIO3D.voiceWindow + 0.01;
    a.play('explodeLarge', { local: [0, 0, -30] });
    assert.equal(audio.calls.length, AUDIO3D.maxVoices + 3);
});

test('threat tone, extra life and level up use procedural sounds from audio.js', () => {
    for (const ev of ['threat', 'extraLife', 'levelUp']) assert.ok(PROCEDURAL_SOUNDS[SOUND3D[ev]], ev);
    const audio = fakeAudio();
    let t = 0;
    const a = createAudio3d({ audio, now: () => t });
    a.play('threat'); t += 0.2; a.play('threat');
    assert.equal(audio.calls.length, 1, 'at most one threat tone per 0.8 s');
});

test('thrust loop on/off without repeats; UFO hum follows the nearest UFO', () => {
    const audio = fakeAudio();
    const a = createAudio3d({ audio, range: 1000 });
    a.thrust(true); a.thrust(true);
    assert.equal(audio.thrust, true);
    a.thrust(false);
    assert.equal(audio.thrust, false);
    a.ufoHum([300, 0, -300]);
    const hum = audio.calls.find(c => c.id === 'ufoHum');
    assert.ok(hum && hum.loop);
    assert.ok(hum.pan > 0);
    a.ufoHum([-300, 0, -100]);
    assert.ok(hum.pan < 0, 'moved left');
    assert.equal(audio.calls.filter(c => c.id === 'ufoHum').length, 1, 'one loop');
    a.ufoHum(null);
    assert.equal(hum.stopped, true);
    assert.equal(a.snapshot().hum, false);
    a.ufoHum([0, 0, -5000]);
    assert.equal(audio.calls.filter(c => c.id === 'ufoHum').length, 1, 'out of range: no hum');
});

test('music moods per screen; leaving play stops the loops', () => {
    assert.equal(mood3d({ screen: 'menu' }), 'menu');
    assert.equal(mood3d({ screen: 'playing' }), 'calm');
    assert.equal(mood3d({ screen: 'playing', lives: 1 }), 'danger');
    assert.equal(mood3d({ screen: 'playing', bossActive: true }), 'boss');
    assert.equal(mood3d({ screen: 'playing', tutorialActive: true, bossActive: true }), 'calm');
    assert.equal(mood3d({ screen: 'paused' }), 'paused');
    assert.equal(mood3d({ screen: 'over' }), 'gameover');
    const audio = fakeAudio();
    const music = fakeMusic();
    const a = createAudio3d({ audio, music });
    a.thrust(true);
    a.update({ screen: 'playing', lives: 3 });
    assert.equal(music.moods.at(-1), 'calm');
    assert.equal(audio.thrust, true);
    a.update({ screen: 'paused' });
    assert.equal(music.moods.at(-1), 'paused');
    assert.equal(audio.thrust, false);
    assert.equal(music.updates, 2);
    assert.equal(a.mood, 'paused');
});

test('shared settings: volumes, tune and Sound on/off, now and on change', () => {
    const settings = createSettings({ storage: memStorage() });
    settings.set('sfxVolume', 4);
    settings.set('musicTune', 'ambient');
    const audio = fakeAudio();
    const music = fakeMusic();
    const a = createAudio3d({ audio, music, settings });
    a.bindSettings();
    assert.equal(audio.sfx, 4);
    assert.equal(audio.musicVol, 5);
    assert.equal(music.tune, 'ambient');
    settings.set('muted', true);
    assert.equal(audio.isMuted, true);
    settings.set('musicVolume', 2);
    assert.equal(audio.musicVol, 2);
    a.dispose();
    settings.set('sfxVolume', 9);
    assert.equal(audio.sfx, 4, 'unsubscribed');
    a.unlock();
    assert.equal(audio.resumed, true);
});

test('a throwing audio manager never breaks the game; no manager is silent', () => {
    const bad = { play() { throw new Error('x'); }, startThrustSound() { throw new Error('x'); }, stopThrustSound() {} };
    const a = createAudio3d({ audio: bad });
    assert.equal(a.play('shoot'), null);
    a.thrust(true);
    const none = createAudio3d({});
    assert.equal(none.play('shoot'), null);
    none.thrust(true);
    none.ufoHum([0, 0, -10]);
    none.update({ screen: 'playing' });
});

// The real AudioManager with a minimal Web Audio fake: the new procedural sounds and panning
class P { constructor(v) { this.value = v; } setValueAtTime(v) { this.value = v; } exponentialRampToValueAtTime(v) { this.value = v; } }
class N { constructor(k) { this.kind = k; this.out = []; } connect(n) { this.out.push(n); return n; } disconnect() {} }
class Ctx {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = new N('dest'); this.created = []; }
    _n(k, x = {}) { const n = Object.assign(new N(k), x); this.created.push(n); return n; }
    createGain() { return this._n('gain', { gain: new P(1) }); }
    createOscillator() { return this._n('osc', { type: 'sine', frequency: new P(0), start() {}, stop() {} }); }
    createStereoPanner() { return this._n('pan', { pan: new P(0) }); }
    createBufferSource() { return this._n('src', { start() {}, stop() {} }); }
    resume() { return Promise.resolve(); }
}
function realManager() {
    globalThis.window = { AudioContext: Ctx, addEventListener() {}, removeEventListener() {} };
    globalThis.document = { addEventListener() {}, removeEventListener() {}, hidden: false };
    globalThis.fetch = () => Promise.reject(new Error('no network in tests'));
    const origErr = console.error; const origLog = console.log; console.error = () => {}; console.log = () => {};
    const m = new AudioManager();
    console.error = origErr; console.log = origLog;
    return m;
}

test('audio.js: procedural threat tone, panned collect chime, loop gain', () => {
    const m = realManager();
    const ctx = m.audioContext;
    const before = ctx.created.length;
    const osc = m.play('threatTone', false, 0.5, 0.6);
    assert.ok(osc && osc.kind === 'osc');
    const made = ctx.created.slice(before);
    assert.equal(made.filter(n => n.kind === 'osc').length, PROCEDURAL_SOUNDS.threatTone.notes.length);
    const pan = made.find(n => n.kind === 'pan');
    assert.ok(pan && Math.abs(pan.pan.value - 0.6) < 1e-9);
    assert.ok(pan.out.includes(m.sfxGain));
    // Collect with pan goes through a panner; default (2D) stays direct
    const b2 = ctx.created.length;
    m.play('collectGreen', false, 1, -0.5);
    assert.ok(ctx.created.slice(b2).some(n => n.kind === 'pan'));
    const b3 = ctx.created.length;
    m.play('collectGreen');
    assert.ok(!ctx.created.slice(b3).some(n => n.kind === 'pan'));
    // Loop gain and pan on a looping buffer source
    m.sounds.ufoHum = {};
    const hum = m.play('ufoHum', true, 0.4, 0.2);
    m.setLoopGain(hum, { pan: -2, gain: 0.1 });
    assert.equal(hum.panner.pan.value, -1);
    assert.equal(hum.gainNode.gain.value, 0.1);
    m.setLoopGain(null, { gain: 1 });
    // Muted: nothing plays
    m.toggleMute();
    assert.equal(m.play('levelUp'), null);
});
