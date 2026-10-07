// Perceptual volume curve for the 0..10 settings scale: gain = (v / 10)^2.
export function volumeToGain(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 1;
    const x = Math.min(10, Math.max(0, n)) / 10;
    return x * x;
}

// Let iOS/iPadOS treat game audio as "ambient": it follows the ring/silent switch and
// mixes with the player's own music. Feature-detected; no-op elsewhere.
export function preferAmbientAudioSession(nav = (typeof navigator !== 'undefined' ? navigator : null)) {
    try {
        const session = nav && nav.audioSession;
        if (session && 'type' in session && session.type !== 'ambient') {
            session.type = 'ambient';
            return session.type === 'ambient';
        }
        return !!(session && session.type === 'ambient');
    } catch (e) {
        return false;
    }
}

// Short procedural sounds (no file to load): [frequency Hz, start s, length s] notes.
// threatTone: the 3D threat warning; extraLife / levelUp: chimes (2D has no files for them).
export const PROCEDURAL_SOUNDS = Object.freeze({
    threatTone: Object.freeze({ type: 'square', level: 0.12, notes: Object.freeze([[880, 0, 0.07], [660, 0.1, 0.07]]) }),
    extraLife: Object.freeze({ type: 'triangle', level: 0.25, notes: Object.freeze([[523, 0, 0.1], [659, 0.1, 0.1], [784, 0.2, 0.1], [1047, 0.3, 0.18]]) }),
    levelUp: Object.freeze({ type: 'sine', level: 0.25, notes: Object.freeze([[392, 0, 0.12], [523, 0.12, 0.12], [659, 0.24, 0.2]]) }),
});

// Routing: sound effects -> sfxGain -> masterGain -> destination
//          music         -> musicGain -> masterGain (the music engine applies its own
//                           volume curve, so musicGain stays at unity)
// Mute sets masterGain to 0 and silences both.
export class AudioManager {
    constructor() {
        this.sounds = {}; // Store loaded audio buffers
        this.isMuted = false;
        this.audioContext = null;
        this.masterGain = null;
        this.sfxGain = null;
        this.musicGain = null;
        this.sfxVolume = 10; // 0..10
        this.music = null; // optional MusicEngine (see attachMusic)
        this.thrustSoundSource = null; // To control the looping thrust sound
        this.ufoHumSource = null; // To control the looping UFO hum

        // Web Audio may be missing (old browsers) or throw; the game must still run silently
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                this.audioContext = new AudioCtx();
                this.masterGain = this.audioContext.createGain();
                this.masterGain.connect(this.audioContext.destination);
                this.sfxGain = this.audioContext.createGain();
                this.sfxGain.connect(this.masterGain);
                this.musicGain = this.audioContext.createGain();
                this.musicGain.connect(this.masterGain);
            }
        } catch (e) {
            console.error("Web Audio not available:", e);
            this.audioContext = null;
            this.masterGain = null;
            this.sfxGain = null;
            this.musicGain = null;
        }
        preferAmbientAudioSession();
        if (!this.audioContext) {
            console.warn("Audio disabled (no AudioContext).");
            return;
        }

        // List of sound files to load (paths relative to index.html)
        // NOTE: Using .mp3 extension now.
        this.soundFiles = {
            playerShoot: 'assets/audio/player_shoot.mp3',
            playerThrust: 'assets/audio/player_thrust.mp3', // Loop this one
            playerExplode: 'assets/audio/player_explode.mp3',
            asteroidExplodeS: 'assets/audio/asteroid_explode_small.mp3',
            asteroidExplodeM: 'assets/audio/asteroid_explode_medium.mp3',
            asteroidExplodeL: 'assets/audio/asteroid_explode_large.mp3',
            ufoHum: 'assets/audio/ufo_hum.mp3', // Loop this one
            ufoShoot: 'assets/audio/ufo_shoot.mp3',
            ufoExplode: 'assets/audio/ufo_explode.mp3',
            // hyperspace: 'assets/audio/hyperspace.mp3', // Add later
            // extraLife: 'assets/audio/extra_life.mp3', // Add later
        };

        this.installUnlockHandlers();
        this.installVisibilityHandler();

        this.loadSounds().catch(e => console.error("Error loading sounds:", e));
    }

    // iOS/Safari only allow starting audio from inside a user gesture handler.
    // Resume the context (and play a silent buffer for older iOS) on the first
    // touch/click/key, and keep listening until the context is actually running.
    // If the context later leaves 'running' (iOS interruptions: a call, Siri, another app's
    // audio; a suspend while hidden that the browser won't undo without a gesture), the
    // handlers are armed again so the next touch or key brings the sound back.
    installUnlockHandlers() {
        const events = ['touchstart', 'touchend', 'pointerdown', 'mousedown', 'keydown'];
        this.unlockArmed = false;
        const arm = () => {
            if (this.unlockArmed) return;
            this.unlockArmed = true;
            events.forEach(evt => document.addEventListener(evt, unlock, true));
        };
        const disarm = () => {
            if (!this.unlockArmed) return;
            this.unlockArmed = false;
            events.forEach(evt => document.removeEventListener(evt, unlock, true));
        };
        const unlock = () => {
            if (!this.audioContext) return;
            this.resumeContext();
            try {
                const buffer = this.audioContext.createBuffer(1, 1, 22050);
                const source = this.audioContext.createBufferSource();
                source.buffer = buffer;
                source.connect(this.audioContext.destination);
                source.start(0);
            } catch (e) {
                // Ignore - silent unlock buffer is best-effort
            }
            if (this.audioContext.state === 'running') disarm();
        };
        arm();
        const onStateChange = () => {
            if (!this.audioContext) return;
            if (this.audioContext.state === 'running') disarm();
            else if (this.audioContext.state !== 'closed') arm();
        };
        try {
            if (typeof this.audioContext.addEventListener === 'function') {
                this.audioContext.addEventListener('statechange', onStateChange);
            } else {
                this.audioContext.onstatechange = onStateChange;
            }
        } catch (e) { /* statechange unsupported: the first unlock still works */ }
    }

    // Looping sources (thrust, UFO hum) keep playing when the tab is hidden because
    // requestAnimationFrame stops and the game loop never stops them. Suspend audio while hidden.
    installVisibilityHandler() {
        document.addEventListener('visibilitychange', () => {
            if (!this.audioContext) return;
            try {
                if (document.hidden) {
                    if (this.audioContext.state === 'running') {
                        const p = this.audioContext.suspend();
                        if (p && p.catch) p.catch(() => {});
                    }
                } else {
                    this.resumeContext();
                }
            } catch (e) {
                console.error("Error handling audio visibility change:", e);
            }
        });
    }

    // decodeAudioData is callback-only in older Safari (webkitAudioContext)
    decodeAudio(arrayBuffer) {
        return new Promise((resolve, reject) => {
            const result = this.audioContext.decodeAudioData(arrayBuffer, resolve, reject);
            if (result && typeof result.then === 'function') {
                result.then(resolve, reject);
            }
        });
    }

    async loadSounds() {
        console.log("Loading sounds...");
        for (const key in this.soundFiles) {
            try {
                const response = await fetch(this.soundFiles[key]);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = await this.decodeAudio(arrayBuffer);
                this.sounds[key] = audioBuffer;
                console.log(`Loaded sound: ${key}`);
            } catch (error) {
                console.error(`Error loading sound ${key}:`, error);
                // You might want to handle this more gracefully, e.g., use a default sound or disable the sound.
                this.sounds[key] = null; // Mark as failed
            }
        }
        console.log("Sound loading complete.");
    }

    // Stereo panning (local multiplayer, side by side): feature-detected StereoPannerNode
    get stereoSupported() {
        return !!(this.audioContext && typeof this.audioContext.createStereoPanner === 'function');
    }

    // pan: -1 (left) … 1 (right); 0 or no StereoPannerNode plays centred as before
    play(soundName, loop = false, volume = 1.0, pan = 0) {
        // 'suspended' (autoplay policy) or 'interrupted' (iOS, e.g. phone call) cannot play
        if (!this.audioContext || this.isMuted || this.sfxVolume <= 0 || this.audioContext.state !== 'running') {
            return null;
        }

        // Handle procedural sounds
        if (soundName === 'collectGreen') {
            return this.playCollectSound(volume, pan);
        }
        if (PROCEDURAL_SOUNDS[soundName]) {
            return this.playProcedural(soundName, volume, pan);
        }

        if (!this.sounds[soundName]) {
            return null;
        }

        const source = this.audioContext.createBufferSource();
        source.buffer = this.sounds[soundName];

        // Optional Gain node per sound for individual volume control
        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = volume;

        source.connect(gainNode);
        source.gainNode = gainNode; // loops can be faded (setLoopGain)
        const panner = this.createPanner(pan, loop);
        if (panner) {
            gainNode.connect(panner);
            panner.connect(this.sfxGain);
            source.panner = panner;
        } else {
            gainNode.connect(this.sfxGain);
        }

        source.loop = loop;
        source.start(0);
        return source; // Return the source node for potential control (e.g., stopping loops)
    }

    // A StereoPannerNode at `pan`, or null (unsupported, or centred and not a loop that may move)
    createPanner(pan, always = false) {
        const p = Number(pan);
        if (!this.stereoSupported || (!always && !(Number.isFinite(p) && p !== 0))) return null;
        try {
            const panner = this.audioContext.createStereoPanner();
            panner.pan.value = Number.isFinite(p) ? Math.max(-1, Math.min(1, p)) : 0;
            return panner;
        } catch (e) {
            return null;
        }
    }

    // Move the thrust loop left or right (local multiplayer: the thrusting players' side)
    setThrustPan(pan) {
        const src = this.thrustSoundSource;
        if (!src || !src.panner) return;
        const p = Number(pan);
        try { src.panner.pan.value = Number.isFinite(p) ? Math.max(-1, Math.min(1, p)) : 0; } catch (e) { /* ignore */ }
    }

    // Connect a sound's last node to the effects bus, through a panner when pan is set
    _toSfx(node, pan) {
        const panner = this.createPanner(pan);
        if (panner) {
            node.connect(panner);
            panner.connect(this.sfxGain);
        } else {
            node.connect(this.sfxGain);
        }
    }

    // Procedural collect sound - a pleasant rising chime
    playCollectSound(volume = 1.0, pan = 0) {
        if (!this.audioContext || this.isMuted || this.sfxVolume <= 0) return null;

        const now = this.audioContext.currentTime;
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        const level = 0.3 * (Number.isFinite(Number(volume)) ? Math.max(0, Number(volume)) : 1);

        oscillator.connect(gainNode);
        this._toSfx(gainNode, pan);

        oscillator.type = 'sine';
        // Rising pitch for satisfying collection feeling
        oscillator.frequency.setValueAtTime(400, now);
        oscillator.frequency.exponentialRampToValueAtTime(800, now + 0.1);
        oscillator.frequency.exponentialRampToValueAtTime(1200, now + 0.15);

        gainNode.gain.setValueAtTime(Math.max(0.0001, level), now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

        oscillator.start(now);
        oscillator.stop(now + 0.2);

        return oscillator;
    }

    // A PROCEDURAL_SOUNDS entry: one oscillator per note, short decay. Returns the last one.
    playProcedural(name, volume = 1.0, pan = 0) {
        const def = PROCEDURAL_SOUNDS[name];
        if (!def || !this.audioContext || this.isMuted || this.sfxVolume <= 0) return null;
        const now = this.audioContext.currentTime;
        const v = Number.isFinite(Number(volume)) ? Math.max(0, Number(volume)) : 1;
        const bus = this.audioContext.createGain();
        bus.gain.value = 1;
        this._toSfx(bus, pan);
        let last = null;
        for (const [freq, start, len] of def.notes) {
            const osc = this.audioContext.createOscillator();
            const g = this.audioContext.createGain();
            osc.type = def.type;
            osc.frequency.setValueAtTime(freq, now + start);
            g.gain.setValueAtTime(Math.max(0.0001, def.level * v), now + start);
            g.gain.exponentialRampToValueAtTime(0.0001, now + start + len);
            osc.connect(g);
            g.connect(bus);
            osc.start(now + start);
            osc.stop(now + start + len + 0.02);
            last = osc;
        }
        return last;
    }

    // Specific function for looping thrust sound
    startThrustSound() {
        if (!this.thrustSoundSource && !this.isMuted && this.sfxVolume > 0 && this.sounds.playerThrust) {
            this.thrustSoundSource = this.play('playerThrust', true, 0.5); // Lower volume for loop
        }
    }

    stopThrustSound() {
        if (this.thrustSoundSource) {
            try {
                this.thrustSoundSource.stop(0);
            } catch (e) {
                // Already stopped
            }
            this.thrustSoundSource = null;
        }
    }

    // Pan (-1..1) and level (0..1) of a playing loop (play(name, true) source)
    setLoopGain(source, { pan, gain } = {}) {
        if (!source) return;
        try {
            if (pan !== undefined && source.panner) {
                const p = Number(pan);
                source.panner.pan.value = Number.isFinite(p) ? Math.max(-1, Math.min(1, p)) : 0;
            }
            if (gain !== undefined && source.gainNode) {
                const g = Number(gain);
                source.gainNode.gain.value = Number.isFinite(g) ? Math.max(0, g) : 1;
            }
        } catch (e) { /* ignore */ }
    }

    // Specific function for looping UFO hum
    startUfoHum() {
        if (!this.ufoHumSource && !this.isMuted && this.sfxVolume > 0 && this.sounds.ufoHum) {
            this.ufoHumSource = this.play('ufoHum', true, 0.4); // Lower volume
        }
    }

    stopUfoHum() {
        if (this.ufoHumSource) {
            try {
                this.ufoHumSource.stop(0);
            } catch (e) {
                // Already stopped
            }
            this.ufoHumSource = null;
        }
    }

    // Specific function to play asteroid explosion based on size
    playAsteroidExplosion(sizeInfo) {
        let soundName = 'asteroidExplodeS'; // Default to small
        // Check sizeInfo exists and has radius
        if (sizeInfo && sizeInfo.radius != null) {
             // Radii: Large = 40, Medium = 30, Small = 20
             if (sizeInfo.radius > 35) {
                 soundName = 'asteroidExplodeL';
             } else if (sizeInfo.radius > 25) {
                 soundName = 'asteroidExplodeM';
             }
        } else {
            console.warn("playAsteroidExplosion called without valid sizeInfo. Playing default small sound.");
        }
        // Add log here to confirm which sound name is selected
        console.log(`[AudioManager] Attempting to play asteroid explosion: ${soundName} (radius: ${sizeInfo?.radius})`);
        this.play(soundName);
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        if (!this.audioContext) {
            return this.isMuted;
        }
        if (this.isMuted) {
            this.masterGain.gain.setValueAtTime(0, this.audioContext.currentTime);
            if (this.music) this.music.stop(); // no point scheduling notes nobody hears
            // Stop any active loops immediately
            this.stopThrustSound();
            this.stopUfoHum();
        } else {
            this.masterGain.gain.setValueAtTime(1, this.audioContext.currentTime);
            if (this.music) this.music.start();
            // Loops will need to be restarted by the game logic if they should resume
        }
        console.log("Audio Muted:", this.isMuted);
        return this.isMuted;
    }

    // Sound effects volume on the settings scale 0..10 (v^2 curve applied here, once).
    setSfxVolume(v) {
        const n = Number(v);
        this.sfxVolume = Number.isFinite(n) ? Math.min(10, Math.max(0, n)) : this.sfxVolume;
        if (this.sfxVolume <= 0) {
            this.stopThrustSound();
            this.stopUfoHum();
        }
        if (this.sfxGain && this.audioContext) {
            try {
                this.sfxGain.gain.setValueAtTime(volumeToGain(this.sfxVolume), this.audioContext.currentTime);
            } catch (e) { /* ignore */ }
        }
        return this.sfxVolume;
    }

    // Music volume 0..10. The music engine owns the v^2 curve (MusicEngine.setVolume), so
    // this only forwards the value; musicGain stays at unity.
    setMusicVolume(v) {
        if (!this.music) return 0;
        try {
            return this.music.setVolume(v);
        } catch (e) {
            return 0;
        }
    }

    // Create the music engine on this context, routed into musicGain. Returns it (a silent
    // no-op engine when Web Audio is unavailable). engineFactory: (ctx, destination) => engine.
    attachMusic(engineFactory) {
        if (this.music) return this.music;
        try {
            this.music = engineFactory(this.audioContext, this.musicGain);
            if (this.isMuted && this.music) this.music.stop();
        } catch (e) {
            console.warn("Music unavailable:", e);
            this.music = null;
        }
        return this.music;
    }

    // Resume audio context if suspended (e.g., by browser auto-play policy)
    resumeContext() {
        if (!this.audioContext || this.audioContext.state === 'running' || this.audioContext.state === 'closed') {
            return;
        }
        if (document.hidden) return; // Stay suspended while the tab is hidden
        try {
            const p = this.audioContext.resume();
            if (p && typeof p.then === 'function') {
                p.then(() => {
                    console.log("AudioContext resumed successfully.");
                }).catch(e => console.warn("Error resuming AudioContext:", e));
            }
        } catch (e) {
            console.warn("Error resuming AudioContext:", e);
        }
    }
} 