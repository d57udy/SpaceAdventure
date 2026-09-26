export class AudioManager {
    constructor() {
        this.sounds = {}; // Store loaded audio buffers
        this.isMuted = false;
        this.audioContext = null;
        this.masterGain = null;
        this.thrustSoundSource = null; // To control the looping thrust sound
        this.ufoHumSource = null; // To control the looping UFO hum

        // Web Audio may be missing (old browsers) or throw; the game must still run silently
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                this.audioContext = new AudioCtx();
                this.masterGain = this.audioContext.createGain();
                this.masterGain.connect(this.audioContext.destination);
            }
        } catch (e) {
            console.error("Web Audio not available:", e);
            this.audioContext = null;
            this.masterGain = null;
        }
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
    installUnlockHandlers() {
        const events = ['touchstart', 'touchend', 'pointerdown', 'mousedown', 'keydown'];
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
            if (this.audioContext.state === 'running') {
                events.forEach(evt => document.removeEventListener(evt, unlock, true));
            }
        };
        events.forEach(evt => document.addEventListener(evt, unlock, true));
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

    play(soundName, loop = false, volume = 1.0) {
        // 'suspended' (autoplay policy) or 'interrupted' (iOS, e.g. phone call) cannot play
        if (!this.audioContext || this.isMuted || this.audioContext.state !== 'running') {
            return null;
        }

        // Handle procedural sounds
        if (soundName === 'collectGreen') {
            return this.playCollectSound();
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
        gainNode.connect(this.masterGain);

        source.loop = loop;
        source.start(0);
        return source; // Return the source node for potential control (e.g., stopping loops)
    }

    // Procedural collect sound - a pleasant rising chime
    playCollectSound() {
        if (!this.audioContext || this.isMuted) return null;

        const now = this.audioContext.currentTime;
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(this.masterGain);

        oscillator.type = 'sine';
        // Rising pitch for satisfying collection feeling
        oscillator.frequency.setValueAtTime(400, now);
        oscillator.frequency.exponentialRampToValueAtTime(800, now + 0.1);
        oscillator.frequency.exponentialRampToValueAtTime(1200, now + 0.15);

        gainNode.gain.setValueAtTime(0.3, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

        oscillator.start(now);
        oscillator.stop(now + 0.2);

        return oscillator;
    }

    // Specific function for looping thrust sound
    startThrustSound() {
        if (!this.thrustSoundSource && !this.isMuted && this.sounds.playerThrust) {
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

    // Specific function for looping UFO hum
    startUfoHum() {
        if (!this.ufoHumSource && !this.isMuted && this.sounds.ufoHum) {
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
            // Stop any active loops immediately
            this.stopThrustSound();
            this.stopUfoHum();
        } else {
            this.masterGain.gain.setValueAtTime(1, this.audioContext.currentTime);
            // Loops will need to be restarted by the game logic if they should resume
        }
        console.log("Audio Muted:", this.isMuted);
        return this.isMuted;
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