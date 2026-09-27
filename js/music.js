// Background music generated with Web Audio. Pure pattern logic (selectMood,
// stepEvents) plus a tune-agnostic MusicEngine with a lookahead scheduler.
// Uses only basic nodes (Oscillator, Gain, BiquadFilter, Delay, BufferSource).

import { TUNES, LAYERS, STEPS_PER_BAR, midiToFreq } from './tunes.js';

export const MUSIC_MOODS = Object.freeze(['menu', 'calm', 'danger', 'boss', 'paused', 'gameover']);
export const LOOKAHEAD = 0.25; // seconds scheduled ahead of the audio clock
export const START_DELAY = 0.06; // first note after a (re)sync
export const MOOD_GLIDE = 1.8; // seconds for layer volumes to follow a mood change
export const PAUSE_DUCK = 0.4; // about -8 dB
export const PAUSE_CUTOFF = 800; // Hz, filter closed while paused
export const OPEN_CUTOFF = 18000;
export const MASTER_LEVEL = 0.8; // gain at volume 10 (volume curve is v^2)
export const MAX_STEPS_PER_UPDATE = 64;
export const PREVIEW_MIN_INTERVAL = 0.3; // s between previews; faster cycling plays only the last pick
export const PREVIEW_TAIL = 1.5; // s after a preview's phrase ends before its nodes are disconnected

// Which mood the game is in. state uses main.js GameState ids.
export function selectMood({ state, bossActive = false, lives = 3, tutorialActive = false, paused = false } = {}) {
    if (paused || state === 'paused') return 'paused';
    if (state === 'game_over' || state === 'gameover') return 'gameover';
    if (state === 'playing') {
        if (tutorialActive) return 'calm';
        if (bossActive) return 'boss';
        if (typeof lives === 'number' && lives <= 1) return 'danger';
        return 'calm';
    }
    return 'menu';
}

// Mood used for patterns (paused/gameover keep the calm material).
function patternMoodOf(tune, mood) {
    return tune && tune.progressions[mood] ? mood : 'calm';
}

export function chordAt(tune, mood, bar) {
    const sections = tune.progressions[patternMoodOf(tune, mood)];
    const section = sections[Math.floor(bar / 8) % sections.length];
    return section[((bar % section.length) + section.length) % section.length];
}

export function layerGains(tune, mood) {
    const table = (tune && tune.layers[mood]) || {};
    const out = {};
    for (const l of LAYERS) out[l] = table[l] || 0;
    return out;
}

// Events for one 16th step: [{ voice, note?, notes?, dur (steps), vel }].
// `layers` (optional Set) limits which voices are generated; by default the voices
// with a non-zero gain in this mood. Pure given `rng`.
export function stepEvents(tune, mood, bar, step, rng = Math.random, layers = null) {
    if (!tune) return [];
    const m = patternMoodOf(tune, mood);
    const gains = tune.layers[m] || {};
    const use = v => !!tune.voices[v] && (layers ? layers.has(v) : (gains[v] || 0) > 0);
    const chord = chordAt(tune, m, bar);
    const events = [];

    // Pad: whole-bar chord, or rhythmic stabs when the tune defines a pattern.
    if (use('pad')) {
        const pat = tune.pad && tune.pad.patterns && tune.pad.patterns[m];
        if (pat) {
            if (pat[step] > 0) events.push({ voice: 'pad', notes: [...chord.notes], dur: tune.pad.dur || 2, vel: pat[step] });
        } else if (step === 0) {
            events.push({ voice: 'pad', notes: [...chord.notes], dur: STEPS_PER_BAR, vel: 1 });
        }
    }

    // Bass: offsets from the chord root; a note lasts until the next one.
    if (use('bass')) {
        const pat = tune.bass.patterns[m] || tune.bass.patterns.default;
        const off = pat[step];
        if (off !== null && off !== undefined) {
            let dur = 1;
            while (step + dur < STEPS_PER_BAR && (pat[step + dur] === null || pat[step + dur] === undefined)) dur++;
            events.push({ voice: 'bass', note: chord.bass + off, dur, vel: step % 4 === 0 ? 1 : 0.8 });
        }
    }

    // Arpeggio: chord tones over two octaves, pattern rotated every 4 bars.
    if (use('arp')) {
        const stride = tune.arp.stride[m];
        if (stride && step % stride === 0) {
            const pats = tune.arp.patterns;
            const idx = pats[Math.floor(bar / 4) % pats.length][step];
            if (idx !== null && idx !== undefined) {
                const tones = [...chord.notes, ...chord.notes.map(n => n + 12)];
                const note = tones[idx % tones.length] + (tune.arp.octave || 0);
                events.push({ voice: 'arp', note, dur: stride, vel: step % 4 === 0 ? 1 : 0.72 });
            }
        }
    }

    // Lead melody (second half of each 8-bar block by default).
    if (use('lead')) {
        const mel = tune.lead && tune.lead.melodies && tune.lead.melodies[m];
        if (mel && mel.length && bar % 8 >= (tune.lead.startBar || 0)) {
            const sectionIdx = Math.floor(bar / 8) % tune.progressions[m].length;
            const sec = mel[sectionIdx % mel.length];
            const barEvents = sec[bar % sec.length];
            for (const e of barEvents) {
                if (e.step === step) events.push({ voice: 'lead', note: e.note, dur: e.dur, vel: 1 });
            }
        }
    }

    // Bells: sparse random chord tones high up.
    if (use('bell') && step % 2 === 0) {
        const p = (tune.bells && tune.bells.prob && tune.bells.prob[m]) || 0;
        if (p > 0 && rng() < p) {
            const n = chord.notes[Math.floor(rng() * chord.notes.length) % chord.notes.length];
            events.push({ voice: 'bell', note: n + (tune.bells.octave || 24), dur: 8, vel: 0.7 + 0.3 * rng() });
        }
    }

    // Drums
    const kit = tune.drums && tune.drums[m];
    if (kit) {
        if (use('kick') && kit.kick[step] > 0) events.push({ voice: 'kick', dur: 1, vel: kit.kick[step] });
        let snare = kit.snare[step];
        const fill = tune.drums.fill && tune.drums.fill[m];
        if (fill && bar % 8 === 7) {
            const c = fill[step];
            if (c === 'x') snare = Math.max(snare, 0.9);
            else if (c === 'o') snare = Math.max(snare, 0.5);
        }
        if (use('snare') && snare > 0) events.push({ voice: 'snare', dur: 1, vel: snare });
        if (use('hat')) {
            if (kit.hat[step] > 0) {
                events.push({ voice: 'hat', dur: 1, vel: kit.hat[step] * (0.85 + 0.3 * rng()) });
            } else {
                const ghost = (tune.drums.ghostHat && tune.drums.ghostHat[m]) || 0;
                if (ghost > 0 && step % 2 === 1 && rng() < ghost) events.push({ voice: 'hat', dur: 1, vel: 0.3 });
            }
        }
    }

    // Heartbeat pulse (danger)
    if (use('pulse') && tune.pulse && tune.pulse[step] > 0) {
        events.push({ voice: 'pulse', dur: 1, vel: tune.pulse[step] });
    }
    return events;
}

function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
}

export class MusicEngine {
    // ctx: AudioContext (or null for a silent no-op engine); destination defaults to ctx.destination.
    constructor(ctx, destination = null, { rng = Math.random, tunes = TUNES } = {}) {
        this.ctx = ctx || null;
        this.destination = destination || (ctx ? ctx.destination : null);
        this.rng = rng;
        this.tunes = tunes;
        this.tuneId = 'off';
        this.tune = null;
        this.mood = 'menu';
        this.patternMood = 'menu';
        this.pendingPatternMood = null;
        this.volume = 5; // 0..10
        this.halted = false;
        this.bar = 0;
        this.step = 0;
        this.nextStepTime = 0;
        this.needsResync = true;
        this.layerTargets = Object.fromEntries(LAYERS.map(l => [l, 0]));
        this.fadeUntil = Object.fromEntries(LAYERS.map(l => [l, 0]));
        this.phraseUntil = 0;
        this.preview = null;
        this.pendingPreview = null; // tune picked while previews were rate-limited
        this.retiredPreviews = []; // faded previews waiting to be disconnected
        this.graph = null;
        this.noise = null;
        this.stats = { events: 0, nodes: 0, resyncs: 0 };
    }

    get now() {
        return this.ctx ? this.ctx.currentTime : 0;
    }

    get running() {
        return !!this.ctx && this.ctx.state === 'running';
    }

    get scheduling() {
        return !!this.tune && !this.halted && this.volume > 0;
    }

    snapshot() {
        return {
            tune: this.tuneId, mood: this.mood, patternMood: this.patternMood, volume: this.volume,
            bar: this.bar, step: this.step, scheduling: this.scheduling, running: this.running,
            events: this.stats.events, nodes: this.stats.nodes,
        };
    }

    // --- node helpers -----------------------------------------------------------------
    _gain(value = 1) {
        const g = this.ctx.createGain();
        g.gain.value = value;
        this.stats.nodes++;
        return g;
    }

    _osc(type, freq) {
        const o = this.ctx.createOscillator();
        o.type = type || 'sine';
        o.frequency.value = freq;
        this.stats.nodes++;
        return o;
    }

    _filter(type, freq, q) {
        const f = this.ctx.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = q;
        this.stats.nodes++;
        return f;
    }

    _ramp(param, target, t, dur) {
        // Hold whatever the automation reaches at t (param.value is only the value "now",
        // and is stale before rendering starts; restarting from it made filters snap open
        // and ring, peaking near 2.0 in the ambient pad sweep).
        if (typeof param.cancelAndHoldAtTime === 'function') {
            try {
                param.cancelAndHoldAtTime(t);
                param.linearRampToValueAtTime(target, t + Math.max(0.01, dur));
                return;
            } catch (e) { /* fall back below */ }
        }
        let cur = param.value;
        if (!Number.isFinite(cur)) cur = target;
        if (typeof param.cancelScheduledValues === 'function') param.cancelScheduledValues(t);
        param.setValueAtTime(cur, t);
        param.linearRampToValueAtTime(target, t + Math.max(0.01, dur));
    }

    _noiseBuffer() {
        if (this.noise) return this.noise;
        const sr = this.ctx.sampleRate || 44100;
        const buf = this.ctx.createBuffer(1, sr, sr);
        const data = buf.getChannelData(0);
        let seed = 12345;
        for (let i = 0; i < data.length; i++) {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            data[i] = (seed / 0x3fffffff) - 1;
        }
        this.noise = buf;
        return buf;
    }

    // Persistent graph: layer gain -> layer filter -> seq -> bus filter -> pause duck -> volume -> out.
    _build() {
        if (this.graph || !this.ctx) return this.graph;
        const t = this.now;
        const volume = this._gain(this._volumeGain());
        volume.connect(this.destination);
        const duck = this._gain(1);
        duck.connect(volume);
        const busFilter = this._filter('lowpass', OPEN_CUTOFF, 0.5);
        busFilter.connect(duck);
        const seq = this._gain(1);
        seq.connect(busFilter);
        const echoIn = this._gain(1);
        const delay = this.ctx.createDelay(2);
        this.stats.nodes++;
        const feedback = this._gain(0.3);
        const wet = this._gain(0.3);
        echoIn.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(wet);
        wet.connect(busFilter);
        const layers = {};
        for (const name of LAYERS) {
            const gain = this._gain(0);
            const filter = this._filter('lowpass', OPEN_CUTOFF, 0.7);
            const send = this._gain(0);
            gain.connect(filter);
            filter.connect(seq);
            filter.connect(send);
            send.connect(echoIn);
            layers[name] = { gain, filter, send };
        }
        this.graph = { volume, duck, busFilter, seq, echoIn, delay, feedback, wet, layers, builtAt: t };
        return this.graph;
    }

    _volumeGain() {
        const v = clamp(this.volume, 0, 10) / 10;
        return v * v * MASTER_LEVEL;
    }

    _configureTune(tune, t) {
        const g = this.graph;
        const stepDur = 60 / tune.bpm / 4;
        g.delay.delayTime.setValueAtTime(clamp((tune.echo.steps || 3) * stepDur, 0.05, 1.9), t);
        g.feedback.gain.setValueAtTime(clamp(tune.echo.feedback, 0, 0.7), t);
        g.wet.gain.setValueAtTime(clamp(tune.echo.wet, 0, 1), t);
        for (const name of LAYERS) {
            const v = tune.voices[name];
            const layer = g.layers[name];
            const f = v && v.filter;
            layer.filter.type = f ? f.type : 'lowpass';
            layer.filter.Q.setValueAtTime(f ? f.q : 0.7, t);
            layer.filter.frequency.setValueAtTime(this._layerCutoff(tune, name, this.patternMood), t);
            layer.send.gain.setValueAtTime(v && v.echo ? v.echo : 0, t);
        }
    }

    _layerCutoff(tune, name, mood, bar = 0) {
        const v = tune.voices[name];
        if (!v || !v.filter) return OPEN_CUTOFF;
        let f = v.filter.freq;
        if (v.filter.type === 'lowpass') {
            f *= (tune.filterScale && tune.filterScale[mood]) || 1;
            if (v.sweep) f *= 1 + v.sweep * Math.sin((bar / 8) * Math.PI * 2);
        }
        return clamp(f, 60, OPEN_CUTOFF);
    }

    _applyLayerTargets(mood, glide = MOOD_GLIDE) {
        if (!this.graph || !this.tune) return;
        const t = this.now;
        const gains = mood === 'gameover' ? layerGains(null, mood) : layerGains(this.tune, mood);
        for (const name of LAYERS) {
            const target = gains[name];
            const layer = this.graph.layers[name];
            if (target !== this.layerTargets[name]) {
                this._ramp(layer.gain.gain, target, t, glide);
                if (target === 0) this.fadeUntil[name] = t + glide + 0.1;
                this.layerTargets[name] = target;
            }
            if (mood !== 'gameover' && this.tune.voices[name] && this.tune.voices[name].filter) {
                this._ramp(layer.filter.frequency, this._layerCutoff(this.tune, name, mood, this.bar), t, glide);
            }
        }
    }

    _activeLayers() {
        const t = this.now;
        const set = new Set();
        for (const name of LAYERS) {
            if (this.layerTargets[name] > 0 || this.fadeUntil[name] > t) set.add(name);
        }
        return set;
    }

    // --- public API --------------------------------------------------------------------

    // 'synthwave' | 'ambient' | 'chiptune' | 'off'. Unknown ids count as 'off'.
    setTune(id) {
        const tune = id && id !== 'off' ? this.tunes[id] : null;
        const newId = tune ? id : 'off';
        if (newId === this.tuneId) return this.tuneId;
        this.tuneId = newId;
        if (!this.ctx) { this.tune = tune; return this.tuneId; }
        this._build();
        const t = this.now;
        const g = this.graph;
        // Quick fade of the old tune, then start the new one at bar 0.
        this._ramp(g.seq.gain, 0, t, 0.15);
        for (const name of LAYERS) {
            this._ramp(g.layers[name].gain.gain, 0, t, 0.15);
            this.layerTargets[name] = 0;
            this.fadeUntil[name] = 0;
        }
        this.tune = tune;
        this.bar = 0;
        this.step = 0;
        this.needsResync = true;
        this.pendingPatternMood = null;
        if (!tune) return this.tuneId;
        const start = t + 0.2;
        this.patternMood = patternMoodOf(tune, this.mood === 'paused' || this.mood === 'gameover' ? this.patternMood : this.mood);
        this._configureTune(tune, start);
        g.seq.gain.setValueAtTime(0, start);
        g.seq.gain.linearRampToValueAtTime(1, start + 0.1);
        this.resumeAt = start;
        const mood = this.mood === 'paused' ? this.patternMood : this.mood;
        const gains = layerGains(tune, mood === 'gameover' ? 'menu' : mood);
        for (const name of LAYERS) {
            const layer = g.layers[name];
            layer.gain.gain.setValueAtTime(0, start);
            layer.gain.gain.linearRampToValueAtTime(gains[name], start + 0.3);
            this.layerTargets[name] = gains[name];
        }
        return this.tuneId;
    }

    // One of MUSIC_MOODS. Layer gains glide at once; chords/patterns switch on the next bar.
    setMood(mood) {
        if (!MUSIC_MOODS.includes(mood) || mood === this.mood) return false;
        const prev = this.mood;
        this.mood = mood;
        if (!this.ctx) return true;
        this._build();
        const t = this.now;
        const g = this.graph;
        if (mood === 'paused') {
            this._ramp(g.duck.gain, PAUSE_DUCK, t, 0.4);
            this._ramp(g.busFilter.frequency, PAUSE_CUTOFF, t, 0.4);
            return true;
        }
        if (prev === 'paused') {
            this._ramp(g.duck.gain, 1, t, 0.4);
            this._ramp(g.busFilter.frequency, OPEN_CUTOFF, t, 0.4);
        }
        if (mood === 'gameover') {
            this._applyLayerTargets('gameover', 1.0);
            this.playGameOverPhrase();
            return true;
        }
        if (this.tune) {
            // Nothing scheduled yet (or just resynced): switch patterns immediately.
            if (this.needsResync && this.step === 0) this.patternMood = patternMoodOf(this.tune, mood);
            else this.pendingPatternMood = patternMoodOf(this.tune, mood);
        }
        this._applyLayerTargets(mood);
        return true;
    }

    // Music volume on the settings scale 0..10 (perceptual v^2 curve). 0 stops scheduling.
    setVolume(v) {
        v = Number(v);
        this.volume = Number.isFinite(v) ? clamp(v, 0, 10) : this.volume;
        if (this.volume === 0) this.needsResync = true;
        if (this.ctx && this.graph) this._ramp(this.graph.volume.gain, this._volumeGain(), this.now, 0.15);
        return this.volume;
    }

    // Fade out and stop scheduling until start() is called (setTune/setVolume keep working).
    stop() {
        this.halted = true;
        this.needsResync = true;
        if (this.ctx && this.graph) this._ramp(this.graph.seq.gain, 0, this.now, 0.3);
    }

    start() {
        if (!this.halted) return;
        this.halted = false;
        this.needsResync = true;
        if (this.ctx && this.graph) this._ramp(this.graph.seq.gain, 1, this.now + START_DELAY, 0.3);
    }

    // Call every frame. Schedules notes up to LOOKAHEAD seconds ahead on the audio clock.
    // Returns the number of note events scheduled.
    update() {
        this._updatePreviews();
        if (!this.ctx || !this.scheduling) return 0;
        if (!this.running) {
            this.needsResync = true;
            return 0;
        }
        this._build();
        const now = this.now;
        // After a pause, an iOS interruption, a hidden tab or a long frame, restart from
        // "now" instead of catching up with a burst of stale notes.
        if (this.needsResync || this.nextStepTime < now) {
            if (!this.needsResync) this.stats.resyncs++;
            this.nextStepTime = Math.max(now + START_DELAY, this.resumeAt || 0);
            this.needsResync = false;
        }
        const tune = this.tune;
        const stepDur = 60 / tune.bpm / 4;
        let count = 0;
        let guard = 0;
        while (this.nextStepTime < now + LOOKAHEAD && guard++ < MAX_STEPS_PER_UPDATE) {
            const t = this.nextStepTime;
            if (this.step === 0) this._onBar(t);
            const events = stepEvents(tune, this.patternMood, this.bar, this.step, this.rng, this._activeLayers());
            for (const ev of events) this._play(tune, ev, t, stepDur, this.graph.layers[ev.voice].gain);
            count += events.length;
            this.step++;
            if (this.step >= STEPS_PER_BAR) {
                this.step = 0;
                this.bar++;
            }
            this.nextStepTime += stepDur;
        }
        this.stats.events += count;
        return count;
    }

    _onBar(t) {
        if (this.pendingPatternMood) {
            this.patternMood = this.pendingPatternMood;
            this.pendingPatternMood = null;
        }
        // Slowly evolving pad filters (tunes with a 'sweep'), one gentle move per bar.
        const tune = this.tune;
        if (this.mood === 'paused' || this.mood === 'gameover') return;
        for (const name of LAYERS) {
            const v = tune.voices[name];
            if (v && v.sweep && v.filter) {
                const barDur = (60 / tune.bpm) * 4;
                this._ramp(this.graph.layers[name].filter.frequency, this._layerCutoff(tune, name, this.patternMood, this.bar), t, barDur);
            }
        }
    }

    // --- voices -----------------------------------------------------------------------
    _play(tune, ev, t, stepDur, out) {
        const v = tune.voices[ev.voice];
        if (!v || !out) return;
        const dur = ev.dur * stepDur;
        const vel = ev.vel === undefined ? 1 : ev.vel;
        if (v.drum === 'kick') return this._kick(v, t, vel, out);
        if (v.drum === 'noise') return this._noiseHit(v, t, vel, out);
        const notes = ev.notes || [ev.note];
        return this._tone(v, notes, t, dur, vel, out);
    }

    // Pitched note(s) sharing one envelope: sustain (attack/gate/release) or percussive (decay).
    _tone(v, notes, t, dur, vel, out) {
        const peak = v.gain * vel;
        const env = this._gain(0);
        env.connect(out);
        const g = env.gain;
        const attack = Math.max(0.002, v.attack || 0.005);
        let end;
        g.setValueAtTime(0, t);
        g.linearRampToValueAtTime(peak, t + attack);
        if (v.decay) {
            end = t + attack + v.decay;
            g.exponentialRampToValueAtTime(0.0001, end);
        } else {
            const hold = t + Math.max(attack, dur * (v.gate === undefined ? 1 : v.gate));
            const release = Math.max(0.01, v.release || 0.05);
            g.setValueAtTime(peak, hold);
            g.linearRampToValueAtTime(0, hold + release);
            end = hold + release;
        }
        const oscCount = Math.max(1, v.osc || 1);
        for (const n of notes) {
            const f = midiToFreq(n);
            for (let i = 0; i < oscCount; i++) {
                const o = this._osc(v.type, f);
                if (oscCount > 1 && o.detune) o.detune.value = (i / (oscCount - 1) * 2 - 1) * (v.detune || 0);
                o.connect(env);
                o.start(t);
                o.stop(end + 0.02);
            }
            if (v.partial) {
                const pg = this._gain(v.partialGain || 0.3);
                pg.connect(env);
                const o = this._osc('sine', f * v.partial);
                o.connect(pg);
                o.start(t);
                o.stop(end + 0.02);
            }
        }
        return end;
    }

    _kick(v, t, vel, out) {
        const env = this._gain(0);
        env.connect(out);
        const o = this._osc(v.type || 'sine', v.startFreq);
        o.frequency.setValueAtTime(v.startFreq, t);
        o.frequency.exponentialRampToValueAtTime(v.endFreq, t + v.sweep);
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(v.gain * vel, t + 0.004);
        env.gain.exponentialRampToValueAtTime(0.0001, t + v.decay);
        o.connect(env);
        o.start(t);
        o.stop(t + v.decay + 0.02);
        return t + v.decay;
    }

    _noiseHit(v, t, vel, out) {
        const env = this._gain(0);
        env.connect(out);
        const src = this.ctx.createBufferSource();
        this.stats.nodes++;
        src.buffer = this._noiseBuffer();
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(v.gain * vel, t + 0.002);
        env.gain.exponentialRampToValueAtTime(0.0001, t + v.decay);
        src.connect(env);
        const offset = this.rng() * 0.5;
        src.start(t, offset, v.decay + 0.05);
        src.stop(t + v.decay + 0.05);
        if (v.tone) {
            const o = this._osc('triangle', v.tone);
            const tg = this._gain(0);
            tg.connect(out);
            tg.gain.setValueAtTime(0, t);
            tg.gain.linearRampToValueAtTime(v.gain * vel * 0.8, t + 0.002);
            tg.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(0.12, v.decay));
            o.connect(tg);
            o.start(t);
            o.stop(t + Math.min(0.12, v.decay) + 0.02);
        }
        return t + v.decay;
    }

    // Temporary per-voice chain (gain -> filter) for one-shot phrases outside the sequencer.
    _oneShotLayers(tune, dest, gains, nodes = null) {
        const out = {};
        for (const name of LAYERS) {
            const v = tune.voices[name];
            if (!v || !(gains[name] > 0)) continue;
            const g = this._gain(gains[name]);
            if (nodes) nodes.push(g);
            if (v.filter) {
                const f = this._filter(v.filter.type, this._layerCutoff(tune, name, 'calm'), v.filter.q);
                if (nodes) nodes.push(f);
                g.connect(f);
                f.connect(dest);
            } else {
                g.connect(dest);
            }
            out[name] = g;
        }
        return out;
    }

    // Previews: start a rate-limited pick once allowed, disconnect finished/faded previews
    // (their gain chains otherwise stay attached to the bus for the whole session).
    _updatePreviews() {
        if (!this.ctx) return;
        const now = this.now;
        if (this.preview && now > this.preview.until + PREVIEW_TAIL) {
            this._disconnectPreview(this.preview);
            this.preview = null;
        }
        this.retiredPreviews = this.retiredPreviews.filter((p) => {
            if (now < p.retireAt) return true;
            this._disconnectPreview(p);
            return false;
        });
        if (this.pendingPreview && (!this.preview || now >= this.preview.startedAt + PREVIEW_MIN_INTERVAL)) {
            const id = this.pendingPreview;
            this.pendingPreview = null;
            this.playPreview(id);
        }
    }

    _disconnectPreview(p) {
        for (const node of [p.out, ...(p.nodes || [])]) {
            try { node.disconnect(); } catch (e) { /* already disconnected */ }
        }
    }

    // Short phrase of a tune for the Settings screen. Ducks the running music meanwhile.
    // Returns the phrase length in seconds (0 when nothing plays, or when rate-limited: the
    // pick then plays from update() once PREVIEW_MIN_INTERVAL has passed).
    playPreview(tuneId) {
        const tune = this.tunes[tuneId];
        if (!tune || !this.running || this.volume === 0) return 0;
        if (this.preview && this.now < this.preview.startedAt + PREVIEW_MIN_INTERVAL) {
            this.pendingPreview = tuneId;
            return 0;
        }
        this.pendingPreview = null;
        this._build();
        const t0 = this.now + 0.05;
        const g = this.graph;
        if (this.preview) {
            this._ramp(this.preview.out.gain, 0, this.now, 0.08);
            this.retiredPreviews.push({ ...this.preview, retireAt: this.now + 0.2 });
            this.preview = null;
        }
        const stepDur = 60 / tune.bpm / 4;
        const bars = (tune.preview && tune.preview.bars) || 1;
        const startBar = (tune.preview && tune.preview.bar) || 0;
        const len = bars * STEPS_PER_BAR * stepDur;
        // Duck the sequencer while the preview plays.
        this._ramp(g.seq.gain, 0, this.now, 0.1);
        g.seq.gain.setValueAtTime(0, t0 + len);
        g.seq.gain.linearRampToValueAtTime(this.halted ? 0 : 1, t0 + len + 0.8);

        const out = this._gain(1);
        out.connect(g.busFilter);
        const gains = layerGains(tune, 'calm');
        const nodes = [];
        const chains = this._oneShotLayers(tune, out, gains, nodes);
        const layers = new Set(Object.keys(chains));
        for (let b = 0; b < bars; b++) {
            for (let s = 0; s < STEPS_PER_BAR; s++) {
                const t = t0 + (b * STEPS_PER_BAR + s) * stepDur;
                for (const ev of stepEvents(tune, 'calm', startBar + b, s, this.rng, layers)) {
                    // Keep the preview inside its window: shorten notes crossing the end.
                    const maxSteps = (bars - b) * STEPS_PER_BAR - s;
                    this._play(tune, { ...ev, dur: Math.min(ev.dur, maxSteps) }, t, stepDur, chains[ev.voice]);
                }
            }
        }
        out.gain.setValueAtTime(1, t0 + len);
        out.gain.linearRampToValueAtTime(0, t0 + len + 1.2);
        this.preview = { tuneId, out, nodes, startedAt: this.now, until: t0 + len };
        return len;
    }

    // Short falling phrase over the tune's tonic chord. Returns its length in seconds.
    playGameOverPhrase() {
        const tune = this.tune;
        if (!tune || !this.running || this.volume === 0) return 0;
        this._build();
        const now = this.now;
        if (now < this.phraseUntil) return 0;
        const stepDur = 60 / tune.bpm / 4;
        const t0 = now + 0.05;
        const out = this._gain(1);
        out.connect(this.graph.busFilter);
        const phrase = tune.gameOver;
        const voiceName = phrase.voice;
        const chains = this._oneShotLayers(tune, out, { [voiceName]: 1, pad: 0.8 });
        let end = t0;
        for (const e of phrase.events) {
            const t = t0 + e.step * stepDur;
            const target = chains[voiceName];
            if (target) end = Math.max(end, this._play(tune, { voice: voiceName, note: e.note, dur: e.dur, vel: 1 }, t, stepDur, target));
        }
        const last = phrase.events[phrase.events.length - 1];
        const chordAtT = t0 + last.step * stepDur;
        if (chains.pad) {
            const padEnd = this._tone(tune.voices.pad, phrase.chord.notes, chordAtT, last.dur * stepDur, 0.9, chains.pad);
            end = Math.max(end, padEnd);
        }
        this.phraseUntil = end;
        return end - now;
    }
}
