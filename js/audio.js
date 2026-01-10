export class AudioManager {
    constructor() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.sounds = {}; // Store loaded audio buffers
        this.isMuted = false;
        this.masterGain = this.audioContext.createGain();
        this.masterGain.connect(this.audioContext.destination);

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

        this.thrustSoundSource = null; // To control the looping thrust sound
        this.ufoHumSource = null; // To control the looping UFO hum

        this.loadSounds();
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
                const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
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
        if (this.isMuted || this.audioContext.state === 'suspended') {
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
        if (this.isMuted) return null;

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
            this.thrustSoundSource.stop(0);
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
            this.ufoHumSource.stop(0);
            this.ufoHumSource = null;
        }
    }

    // Specific function to play asteroid explosion based on size
    playAsteroidExplosion(sizeInfo) {
        let soundName = 'asteroidExplodeS'; // Default to small
        // Check sizeInfo exists and has radius
        if (sizeInfo && sizeInfo.radius != null) {
             if (sizeInfo.radius > 30) { // Approx Large size radius (Correct: L = 40)
                 soundName = 'asteroidExplodeL';
             } else if (sizeInfo.radius > 15) { // Approx Medium size radius (Correct: M = 20)
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
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume().then(() => {
                console.log("AudioContext resumed successfully.");
            }).catch(e => console.error("Error resuming AudioContext:", e));
        }
    }
} 