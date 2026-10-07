// Difficulty: the Easy / Medium / Hard table and the dynamic difficulty adjustment (DDA).
// DOM-free, shared by 2D (js/main.js, one instance) and 3D (js/3d/, its own instance).

/** Easy / Medium / Hard settings. */
export const Difficulty = {
    EASY: {
        id: 'easy',
        name: 'Easy',
        startingAsteroids: 3,
        asteroidSpeedMultiplier: 0.8,
        ufoSpawnMultiplier: 1.5,
        ufoAccuracy: 0.6,
        startingLives: 4,
        scoreMultiplier: 0.75
    },
    MEDIUM: {
        id: 'medium',
        name: 'Medium',
        startingAsteroids: 4,
        asteroidSpeedMultiplier: 1.0,
        ufoSpawnMultiplier: 1.0,
        ufoAccuracy: 0.8,
        startingLives: 3,
        scoreMultiplier: 1.0
    },
    HARD: {
        id: 'hard',
        name: 'Hard',
        startingAsteroids: 5,
        asteroidSpeedMultiplier: 1.2,
        ufoSpawnMultiplier: 0.7, // More frequent UFOs
        ufoAccuracy: 0.95,
        startingLives: 2,
        scoreMultiplier: 1.5
    }
};

/** The adaptive level shown on the HUD, from a performance score (-1 .. 1). */
export function adjustmentLevel(performanceScore) {
    if (performanceScore < -0.3) return 'assisting';
    if (performanceScore > 0.3) return 'challenging';
    return 'balanced';
}

/**
 * A fresh dynamic difficulty tracker. It watches accuracy, green collection, deaths per
 * minute and score rate on its own game clock (tick), and sets the modifiers the game
 * applies on top of the chosen difficulty.
 */
export function createDynamicDifficulty() {
    return {
        // Performance tracking. Times are game time (ms of play, advanced by tick): pause,
        // menus and a backgrounded tab do not count as playing time.
        gameTimeMs: 0,
        sessionStartTime: 0,
        deaths: 0,
        shotsFired: 0,
        shotsHit: 0,
        greenAsteroidsCollected: 0,
        greenAsteroidsSpawned: 0,
        redAsteroidsDestroyed: 0,
        scoreAtLastCheck: 0,
        lastCheckTime: 0,
        recentScoreRate: 0, // Points per second recently

        // Performance score: -1 (struggling) to +1 (skilled), 0 = neutral
        performanceScore: 0,

        // Adjustment multipliers (applied on top of selected difficulty)
        asteroidSpeedMod: 1.0,
        ufoSpawnMod: 1.0,
        ufoAccuracyMod: 1.0,
        powerUpSpawnMod: 1.0,
        greenRatioMod: 1.0,
        extraLifeThresholdMod: 1.0,

        // Settings
        evaluationInterval: 15, // Seconds between performance evaluations (faster response)
        adjustmentSpeed: 0.3, // How fast adjustments change (0-1) - more responsive

        // Advance the game clock by one frame of play (seconds)
        tick(deltaTime) {
            if (Number.isFinite(deltaTime) && deltaTime > 0) this.gameTimeMs += deltaTime * 1000;
        },

        now() {
            return this.gameTimeMs;
        },

        reset() {
            this.gameTimeMs = 0;
            this.sessionStartTime = this.now();
            this.deaths = 0;
            this.shotsFired = 0;
            this.shotsHit = 0;
            this.greenAsteroidsCollected = 0;
            this.greenAsteroidsSpawned = 0;
            this.redAsteroidsDestroyed = 0;
            this.scoreAtLastCheck = 0;
            this.lastCheckTime = this.now();
            this.recentScoreRate = 0;
            this.performanceScore = 0;
            this.asteroidSpeedMod = 1.0;
            this.ufoSpawnMod = 1.0;
            this.ufoAccuracyMod = 1.0;
            this.powerUpSpawnMod = 1.0;
            this.greenRatioMod = 1.0;
            this.extraLifeThresholdMod = 1.0;
        },

        trackDeath() {
            this.deaths++;
        },

        trackShotFired() {
            this.shotsFired++;
        },

        trackShotHit() {
            this.shotsHit++;
        },

        trackGreenCollected(comboCount = 0) {
            this.greenAsteroidsCollected++;
            // If player maintains high combo, they're skilled - increase difficulty
            if (comboCount >= 10) {
                this.performanceScore = Math.min(1, this.performanceScore + 0.05);
                this.applyAdjustments();
            }
        },

        trackGreenSpawned(count = 1) {
            this.greenAsteroidsSpawned += count;
        },

        trackRedDestroyed() {
            this.redAsteroidsDestroyed++;
        },

        // Calculate current shooting accuracy (0-1)
        getAccuracy() {
            if (this.shotsFired === 0) return 0.5; // Default
            return Math.min(1, this.shotsHit / this.shotsFired);
        },

        // Calculate collection efficiency (0-1)
        getCollectionEfficiency() {
            if (this.greenAsteroidsSpawned === 0) return 0.5; // Default
            return Math.min(1, this.greenAsteroidsCollected / this.greenAsteroidsSpawned);
        },

        // Calculate deaths per minute
        getDeathRate() {
            const sessionMinutes = (this.now() - this.sessionStartTime) / 60000;
            if (sessionMinutes < 0.5) return 0; // Not enough data
            return this.deaths / sessionMinutes;
        },

        // Evaluate performance and update adjustments
        evaluate(currentScore) {
            const now = this.now();
            const timeSinceLastCheck = (now - this.lastCheckTime) / 1000;

            if (timeSinceLastCheck < this.evaluationInterval) return;

            // Calculate score rate (points per second)
            this.recentScoreRate = (currentScore - this.scoreAtLastCheck) / timeSinceLastCheck;
            this.scoreAtLastCheck = currentScore;
            this.lastCheckTime = now;

            // Calculate performance metrics
            const accuracy = this.getAccuracy();
            const efficiency = this.getCollectionEfficiency();
            const deathRate = this.getDeathRate();

            // Calculate performance score components
            // Positive = skilled, Negative = struggling
            let scoreComponents = 0;
            let componentCount = 0;

            // Accuracy component: <30% struggling, >60% skilled
            if (this.shotsFired > 10) {
                scoreComponents += (accuracy - 0.45) * 2; // -0.9 to +1.1
                componentCount++;
            }

            // Collection efficiency: <40% struggling, >70% skilled
            if (this.greenAsteroidsSpawned > 5) {
                scoreComponents += (efficiency - 0.55) * 2; // -1.1 to +0.9
                componentCount++;
            }

            // Death rate: >2/min struggling, <0.5/min skilled
            if ((now - this.sessionStartTime) > 60000) {
                const deathComponent = (1.25 - deathRate) * 0.8; // High deaths = negative
                scoreComponents += Math.max(-1, Math.min(1, deathComponent));
                componentCount++;
            }

            // Score rate component (points per second)
            // <5 pts/sec = struggling, >20 pts/sec = skilled
            if (timeSinceLastCheck > 10) {
                const rateComponent = (this.recentScoreRate - 12.5) / 12.5;
                scoreComponents += Math.max(-1, Math.min(1, rateComponent));
                componentCount++;
            }

            // Average all components
            if (componentCount > 0) {
                const targetScore = scoreComponents / componentCount;
                // Smoothly adjust toward target
                this.performanceScore += (targetScore - this.performanceScore) * this.adjustmentSpeed;
                this.performanceScore = Math.max(-1, Math.min(1, this.performanceScore));
            }

            // Apply adjustments based on performance score
            this.applyAdjustments();

            console.log(`[DDA] Performance: ${this.performanceScore.toFixed(2)} | ` +
                `Acc: ${(accuracy * 100).toFixed(0)}% | Eff: ${(efficiency * 100).toFixed(0)}% | ` +
                `Deaths/min: ${deathRate.toFixed(1)} | Score/sec: ${this.recentScoreRate.toFixed(1)}`);
        },

        applyAdjustments() {
            const p = this.performanceScore;

            // Struggling (p < 0): Make game easier
            // Skilled (p > 0): Make game harder

            // Asteroid speed: 0.6x (struggling) to 1.5x (skilled) - MORE PRONOUNCED
            this.asteroidSpeedMod = 1.0 + (p * 0.4);

            // UFO spawn rate: 2x interval (struggling) to 0.5x interval (skilled) - MORE PRONOUNCED
            this.ufoSpawnMod = 1.0 - (p * 0.5);

            // UFO accuracy: 0.5x (struggling) to 1.3x (skilled) - MORE PRONOUNCED
            this.ufoAccuracyMod = 1.0 + (p * 0.3);

            // Power-up spawn: 2x rate (struggling) to 0.5x rate (skilled) - MORE PRONOUNCED
            this.powerUpSpawnMod = 1.0 - (p * 0.5);

            // Green asteroid ratio: +30% (struggling) to -15% (skilled) - MORE PRONOUNCED
            this.greenRatioMod = 1.0 - (p * 0.225);

            // Extra life threshold: 0.5x (struggling) to 1.5x (skilled) - MORE PRONOUNCED
            this.extraLifeThresholdMod = 1.0 + (p * 0.5);
        },

        // Immediate difficulty reduction on death
        onPlayerDeath() {
            this.deaths++;
            // Immediately reduce performance score on death for faster response
            this.performanceScore = Math.max(-1, this.performanceScore - 0.2);
            this.applyAdjustments();
            console.log(`[DDA] Death penalty applied. Performance: ${this.performanceScore.toFixed(2)}`);
        },

        // Get display text for current adjustment level
        getAdjustmentText() {
            if (this.performanceScore < -0.3) return 'Assisting';
            if (this.performanceScore > 0.3) return 'Challenging';
            return 'Balanced';
        },

        getAdjustmentColor() {
            if (this.performanceScore < -0.3) return '#00FF00'; // Green = helping
            if (this.performanceScore > 0.3) return '#FF6600'; // Orange = challenging
            return '#FFFFFF'; // White = neutral
        },

        // 'assisting' | 'balanced' | 'challenging' (3D switches its aids on this)
        getAdjustmentLevel() {
            return adjustmentLevel(this.performanceScore);
        },
    };
}
