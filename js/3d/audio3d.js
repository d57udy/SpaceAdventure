// 3D sound (docs/plans/07-3d-game.md Phase 2 and 5): the 2D AudioManager's sounds
// (js/audio.js) and music engine (js/music.js) driven by 3D events. Each sound is panned by
// the object's left/right direction in the ship's own frame and fades with distance; a cap
// keeps many explosions at once from turning into noise. The shared settings (sound effects
// and music volume, tune, Sound on/off) apply as in 2D.
//
// DOM-free: the audio manager, music engine and settings are injected (fakes in unit tests).
// createBrowserAudio3d() builds the real ones in the 3D page.

import { selectMood } from '../music.js';

/** 3D events -> 2D sound ids (AudioManager.play). */
export const SOUND3D = Object.freeze({
    shoot: 'playerShoot',
    collectGreen: 'collectGreen',
    explodeLarge: 'asteroidExplodeL',
    explodeMedium: 'asteroidExplodeM',
    explodeSmall: 'asteroidExplodeS',
    ufoShoot: 'ufoShoot',
    ufoExplode: 'ufoExplode',
    bossExplode: 'ufoExplode',
    hit: 'playerExplode',
    extraLife: 'extraLife',
    levelUp: 'levelUp',
    threat: 'threatTone',
});

// Base level per event (the ship's own sounds a little quieter than 2D: they're constant)
const LEVEL = Object.freeze({
    shoot: 0.6, collectGreen: 1, explodeLarge: 1, explodeMedium: 0.9, explodeSmall: 0.8,
    ufoShoot: 0.8, ufoExplode: 1, bossExplode: 1, hit: 1, extraLife: 1, levelUp: 1, threat: 1,
});

// The ship's own sounds and UI sounds are never panned or faded
const NON_SPATIAL = new Set(['shoot', 'hit', 'extraLife', 'levelUp', 'threat']);

// The same event no faster than this (seconds): rapid fire, a split into many pieces
const MIN_INTERVAL = Object.freeze({ shoot: 0.06, threat: 0.8, explodeSmall: 0.05, explodeMedium: 0.05 });

export const AUDIO3D = Object.freeze({
    maxVoices: 8,       // sounds started within VOICE_WINDOW at most
    voiceWindow: 0.5,   // s
    near: 0.12,         // share of the range at full level
    minGain: 0.08,      // quieter than this is skipped
    maxPan: 0.85,       // never fully one-sided
});

/**
 * Pan and level of a sound at `local` (ship frame: x right, y up, -z the nose).
 * @param {number[]|null} local - null for the ship's own sounds (centred, full level)
 * @param {number} range - hearing distance (the view distance)
 * @returns {{ pan: number, gain: number }} gain 0 = out of hearing range
 */
export function spatial(local, range) {
    if (!local) return { pan: 0, gain: 1 };
    const [x, y, z] = local;
    const dist = Math.hypot(x, y, z);
    const r = Math.max(1, Number(range) || 1);
    const pan = dist < 1e-6 ? 0 : Math.max(-1, Math.min(1, x / dist)) * AUDIO3D.maxPan;
    const near = r * AUDIO3D.near;
    let gain;
    if (dist <= near) gain = 1;
    else if (dist >= r) gain = 0;
    else {
        const f = 1 - (dist - near) / (r - near); // 1 .. 0
        gain = f * f;
    }
    return { pan, gain };
}

/** Explosion event for a rock size ('large' | 'medium' | 'small'; radius also accepted). */
export function explosionEvent(size) {
    if (size === 'large' || (typeof size === 'number' && size >= 36)) return 'explodeLarge';
    if (size === 'medium' || (typeof size === 'number' && size >= 20)) return 'explodeMedium';
    return 'explodeSmall';
}

/** Music mood for the 3D screen ('menu' | 'playing' | 'paused' | 'over'). */
export function mood3d({ screen, bossActive = false, lives = 3, tutorialActive = false } = {}) {
    const state = screen === 'over' ? 'game_over' : screen === 'paused' ? 'paused' : screen === 'playing' ? 'playing' : 'menu';
    return selectMood({ state, bossActive, lives, tutorialActive });
}

/**
 * @param {object} o
 * @param {object} o.audio - AudioManager (play, startThrustSound, stopThrustSound, setLoopGain,
 *   setSfxVolume, setMusicVolume, toggleMute, isMuted, resumeContext)
 * @param {object} [o.music] - MusicEngine (setTune, setMood, update)
 * @param {object} [o.settings] - js/settings.js (sfxVolume, musicVolume, musicTune, muted, onChange)
 * @param {() => number} [o.now] - seconds
 * @param {number} [o.range] - hearing distance (call setRange when the view distance changes)
 */
export function createAudio3d({ audio, music = null, settings = null, now = () => Date.now() / 1000, range = 1440 } = {}) {
    let hearing = range;
    const started = [];           // start times of recent sounds (voice cap)
    const lastAt = new Map();     // event -> last start time
    let thrusting = false;
    let hum = null;               // UFO hum loop source
    let mood = 'menu';
    let unsubscribe = null;
    const safe = (fn) => { try { return fn(); } catch (e) { return null; } };

    function applySettings() {
        if (!settings || !audio) return;
        safe(() => {
            audio.setSfxVolume(settings.get('sfxVolume'));
            audio.setMusicVolume(settings.get('musicVolume'));
            const muted = !!settings.get('muted');
            if (audio.isMuted !== muted) audio.toggleMute();
        });
        if (music) safe(() => music.setTune(settings.get('musicTune')));
    }

    function voiceFree(t) {
        while (started.length && t - started[0] > AUDIO3D.voiceWindow) started.shift();
        return started.length < AUDIO3D.maxVoices;
    }

    const api = {
        get range() { return hearing; },
        setRange(r) { if (Number(r) > 0) hearing = Number(r); },
        /**
         * Play a 3D event. opts: { local } ship-frame vector to the source (spatial events),
         * { volume } extra level. Returns the sound (or null when skipped).
         */
        play(event, { local = null, volume = 1 } = {}) {
            const id = SOUND3D[event];
            if (!id || !audio) return null;
            const t = now();
            const min = MIN_INTERVAL[event];
            if (min && lastAt.has(event) && t - lastAt.get(event) < min) return null;
            const { pan, gain } = NON_SPATIAL.has(event) ? { pan: 0, gain: 1 } : spatial(local, hearing);
            const level = gain * (LEVEL[event] ?? 1) * volume;
            if (level < AUDIO3D.minGain) return null;
            // The ship's hit and UI sounds always play; others respect the voice cap
            if (!NON_SPATIAL.has(event) && !voiceFree(t)) return null;
            started.push(t);
            lastAt.set(event, t);
            return safe(() => audio.play(id, false, level, pan));
        },
        explosion(size, local) {
            return api.play(explosionEvent(size), { local });
        },
        thrust(on) {
            if (!audio || !!on === thrusting) return;
            thrusting = !!on;
            safe(() => (thrusting ? audio.startThrustSound() : audio.stopThrustSound()));
        },
        /** The nearest UFO (ship frame), or null when none: starts, moves or stops the hum. */
        ufoHum(local) {
            if (!audio) return;
            const s = local ? spatial(local, hearing) : null;
            if (!s || s.gain < AUDIO3D.minGain) {
                if (hum) { safe(() => hum.stop(0)); hum = null; }
                return;
            }
            if (!hum) hum = safe(() => audio.play('ufoHum', true, 0.4 * s.gain, s.pan));
            else safe(() => audio.setLoopGain(hum, { pan: s.pan, gain: 0.4 * s.gain }));
        },
        /** Follow the game's mood and schedule notes (call every frame). */
        update({ screen = 'menu', bossActive = false, lives = 3, tutorialActive = false } = {}) {
            mood = mood3d({ screen, bossActive, lives, tutorialActive });
            if (screen !== 'playing') { api.thrust(false); api.ufoHum(null); }
            if (music) safe(() => { music.setMood(mood); music.update(); });
        },
        get mood() { return mood; },
        /** Settings now, and on every later change of a sound setting. */
        bindSettings() {
            applySettings();
            if (settings && settings.onChange && !unsubscribe) {
                unsubscribe = settings.onChange((name) => {
                    if (['sfxVolume', 'musicVolume', 'musicTune', 'muted'].includes(name)) applySettings();
                });
            }
        },
        /** A tap or key: browsers only start audio from a user gesture. */
        unlock() { if (audio) safe(() => audio.resumeContext()); },
        stopAll() {
            api.thrust(false);
            api.ufoHum(null);
        },
        dispose() {
            api.stopAll();
            if (unsubscribe) { unsubscribe(); unsubscribe = null; }
        },
        snapshot() {
            return { mood, thrusting, hum: !!hum, recentVoices: started.length, range: hearing };
        },
    };
    return api;
}

/**
 * The real audio for the 3D page: the 2D AudioManager (loads the same sound files) and a
 * music engine on its music bus. Dynamic imports keep this module DOM-free for unit tests.
 */
export async function createBrowserAudio3d({ settings, range } = {}) {
    const [{ AudioManager }, { MusicEngine }] = await Promise.all([import('../audio.js'), import('../music.js')]);
    const audio = new AudioManager();
    const music = audio.attachMusic((ctx, dest) => new MusicEngine(ctx, dest));
    const a = createAudio3d({ audio, music, settings, range, now: () => performance.now() / 1000 });
    a.bindSettings();
    return a;
}
