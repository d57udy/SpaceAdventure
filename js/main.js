import { PlayerShip } from './player.js';
import { Asteroid } from './asteroid.js';
import { Bullet } from './bullet.js';
import { InputHandler } from './input.js';
import { randomRange } from './utils.js';
import { UFO } from './ufo.js';
import { AudioManager } from './audio.js';
import { PersistenceManager } from './persistence.js';
import { AchievementManager } from './achievementManager.js';
import { Achievements } from './achievements.js';
import { PowerUp, PowerUpType } from './powerup.js';
import { Boss } from './boss.js';
import { Entity } from './entity.js';
import { applyJoystickSteering } from './steering.js';

// Game States Enum
const GameState = {
    PROMPT_USER: 'prompt_user',
    MENU: 'menu',
    PLAYING: 'playing',
    PAUSED: 'paused',
    HIGH_SCORES: 'high_scores',
    ACHIEVEMENTS: 'achievements',
    UPGRADES: 'upgrades',
    HELP: 'help',
    GAME_OVER: 'game_over'
};

// Difficulty Settings
const Difficulty = {
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

// Constants
const MAX_HIGH_SCORES = 10; // Max number of scores to keep
const STARTING_LIVES = 3; // Default lives if not overridden by difficulty
const STARTING_ASTEROIDS = 4;
const RESPAWN_DELAY = 2;
const SAFE_SPAWN_RADIUS = 150;
const UFO_SPAWN_BASE_INTERVAL = 15; // Average seconds between UFO spawns (Added back)
const EXTRA_LIFE_SCORE = 10000;
const LEVEL_UP_SCORE = 500; // Score needed per level (level 2 at 500, level 3 at 1000, etc.)

// Camera system - always centered on player, handles wrapping in rendering
const Camera = {
    x: 0,
    y: 0,
    // Parallax offset tracks continuous movement for smooth starfield
    parallaxX: 0,
    parallaxY: 0,
    lastShipX: null,
    lastShipY: null,

    update(shipX, shipY, canvasWidth, canvasHeight) {
        // Track continuous movement for parallax (before wrapping correction)
        if (this.lastShipX !== null) {
            let deltaX = shipX - this.lastShipX;
            let deltaY = shipY - this.lastShipY;

            // Correct for world wrapping to get actual movement
            if (deltaX > WORLD_WIDTH / 2) deltaX -= WORLD_WIDTH;
            else if (deltaX < -WORLD_WIDTH / 2) deltaX += WORLD_WIDTH;
            if (deltaY > WORLD_HEIGHT / 2) deltaY -= WORLD_HEIGHT;
            else if (deltaY < -WORLD_HEIGHT / 2) deltaY += WORLD_HEIGHT;

            // Accumulate for smooth parallax
            this.parallaxX += deltaX;
            this.parallaxY += deltaY;
        }

        this.lastShipX = shipX;
        this.lastShipY = shipY;

        // Simply center camera on ship - always
        this.x = shipX - canvasWidth / 2;
        this.y = shipY - canvasHeight / 2;
    },

    reset(shipX, shipY, canvasWidth, canvasHeight) {
        this.x = shipX - canvasWidth / 2;
        this.y = shipY - canvasHeight / 2;
        this.parallaxX = 0;
        this.parallaxY = 0;
        this.lastShipX = shipX;
        this.lastShipY = shipY;
    },

    worldToScreen(worldX, worldY) {
        return {
            x: worldX - this.x,
            y: worldY - this.y
        };
    }
};

// Game State Variables
let canvas, ctx;
let inputHandler;
let audioManager;
let persistenceManager;
let achievementManager;
let ship;
let asteroids = [];
let bullets = [];
let ufos = [];
let powerUps = [];

// Active power-up effects (tracks remaining duration)
let activePowerUps = {
    rapid_fire: 0,
    triple_shot: 0,
    shield: 0,
    speed_boost: 0,
    magnet: 0,
    score_multiplier: 0
};

// Power-up spawn settings
const POWERUP_SPAWN_CHANCE = 0.3; // 30% chance when destroying red asteroid/UFO
const SPEED_BOOST_MULT = 1.6; // Thrust multiplier while the speed boost power-up is active
const POWERUP_SPAWN_INTERVAL = 20; // Spawn random power-up every X seconds
let powerUpSpawnTimer = POWERUP_SPAWN_INTERVAL;

// Dynamic Difficulty Adjustment System
const DynamicDifficulty = {
    // Performance tracking
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

    reset() {
        this.sessionStartTime = Date.now();
        this.deaths = 0;
        this.shotsFired = 0;
        this.shotsHit = 0;
        this.greenAsteroidsCollected = 0;
        this.greenAsteroidsSpawned = 0;
        this.redAsteroidsDestroyed = 0;
        this.scoreAtLastCheck = 0;
        this.lastCheckTime = Date.now();
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
        const sessionMinutes = (Date.now() - this.sessionStartTime) / 60000;
        if (sessionMinutes < 0.5) return 0; // Not enough data
        return this.deaths / sessionMinutes;
    },

    // Evaluate performance and update adjustments
    evaluate(currentScore) {
        const now = Date.now();
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
    }
};

// Combo System - chain collections for multipliers
const ComboSystem = {
    count: 0,           // Current combo count
    multiplier: 1,      // Current score multiplier (1x, 2x, 3x, etc.)
    timer: 0,           // Time remaining before combo resets
    maxTime: 3,         // Seconds before combo expires
    streakMilestones: [5, 10, 15, 25, 50, 100], // Streak bonus thresholds
    lastMilestone: 0,   // Last milestone reached

    addCollection() {
        this.count++;
        this.timer = this.maxTime;

        // Update multiplier based on combo count
        if (this.count >= 20) this.multiplier = 4;
        else if (this.count >= 10) this.multiplier = 3;
        else if (this.count >= 5) this.multiplier = 2;
        else this.multiplier = 1;

        // Check for streak milestones
        for (const milestone of this.streakMilestones) {
            if (this.count === milestone && milestone > this.lastMilestone) {
                this.lastMilestone = milestone;
                const bonus = milestone * 100;
                FloatingTexts.spawn(canvas.width / 2, canvas.height / 3,
                    `${milestone} STREAK! +${bonus}`, '#FFD700', 36);
                return { streakBonus: bonus, milestone };
            }
        }
        return { streakBonus: 0, milestone: 0 };
    },

    break() {
        if (this.count >= 5) {
            FloatingTexts.spawn(canvas.width / 2, canvas.height / 2,
                'Combo Lost!', '#FF4444', 24);
        }
        this.count = 0;
        this.multiplier = 1;
        this.timer = 0;
        this.lastMilestone = 0;
    },

    update(deltaTime) {
        if (this.timer > 0) {
            this.timer -= deltaTime;
            if (this.timer <= 0) {
                this.break();
            }
        }
    },

    reset() {
        this.count = 0;
        this.multiplier = 1;
        this.timer = 0;
        this.lastMilestone = 0;
    }
};

// Floating Text System - for score popups, combo notifications
const FloatingTexts = {
    texts: [],

    spawn(x, y, text, color = '#FFFFFF', size = 20, duration = 1.5) {
        this.texts.push({
            x, y,
            text,
            color,
            size,
            duration,
            timer: duration,
            velY: -50 // Float upward
        });
    },

    update(deltaTime) {
        this.texts = this.texts.filter(t => {
            t.timer -= deltaTime;
            t.y += t.velY * deltaTime;
            t.velY *= 0.95; // Slow down
            return t.timer > 0;
        });
    },

    draw(ctx) {
        this.texts.forEach(t => {
            const alpha = Math.min(1, t.timer / (t.duration * 0.3));
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = t.color;
            ctx.font = `bold ${t.size}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            // Draw shadow
            ctx.fillStyle = 'black';
            ctx.fillText(t.text, t.x + 2, t.y + 2);
            ctx.fillStyle = t.color;
            ctx.fillText(t.text, t.x, t.y);
            ctx.restore();
        });
    },

    clear() {
        this.texts = [];
    }
};

// Particle System - for explosions, collections, trails
const Particles = {
    particles: [],

    spawn(x, y, count, color, speed = 100, lifetime = 0.5, size = 3) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const vel = speed * (0.5 + Math.random() * 0.5);
            this.particles.push({
                x, y,
                velX: Math.cos(angle) * vel,
                velY: Math.sin(angle) * vel,
                color,
                size: size * (0.5 + Math.random() * 0.5),
                lifetime,
                timer: lifetime
            });
        }
    },

    // Explosion effect
    explode(x, y, color = '#FF6600', count = 20) {
        this.spawn(x, y, count, color, 150, 0.8, 4);
        // Add some white sparks
        this.spawn(x, y, count / 2, '#FFFFFF', 200, 0.4, 2);
    },

    // Collection sparkle effect
    collect(x, y, color = '#00FF00') {
        this.spawn(x, y, 12, color, 80, 0.6, 3);
    },

    update(deltaTime) {
        this.particles = this.particles.filter(p => {
            p.timer -= deltaTime;
            p.x += p.velX * deltaTime;
            p.y += p.velY * deltaTime;
            p.velX *= 0.98;
            p.velY *= 0.98;
            return p.timer > 0;
        });
    },

    draw(ctx, cameraX, cameraY) {
        this.particles.forEach(p => {
            const alpha = p.timer / p.lifetime;
            const screenX = p.x - cameraX;
            const screenY = p.y - cameraY;

            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(screenX, screenY, p.size * alpha, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });
    },

    clear() {
        this.particles = [];
    }
};

// Screen Shake Effect
const ScreenShake = {
    intensity: 0,
    duration: 0,
    timer: 0,
    offsetX: 0,
    offsetY: 0,

    trigger(intensity = 10, duration = 0.3) {
        this.intensity = Math.max(this.intensity, intensity);
        this.duration = duration;
        this.timer = duration;
    },

    update(deltaTime) {
        if (this.timer > 0) {
            this.timer -= deltaTime;
            const progress = this.timer / this.duration;
            const currentIntensity = this.intensity * progress;
            this.offsetX = (Math.random() - 0.5) * 2 * currentIntensity;
            this.offsetY = (Math.random() - 0.5) * 2 * currentIntensity;
        } else {
            this.offsetX = 0;
            this.offsetY = 0;
            this.intensity = 0;
        }
    },

    reset() {
        this.intensity = 0;
        this.timer = 0;
        this.offsetX = 0;
        this.offsetY = 0;
    }
};

// Persistent Ship Upgrades System
const ShipUpgrades = {
    // Upgrade definitions with max levels and effects
    upgrades: {
        collectionRadius: {
            name: 'Collection Radius',
            maxLevel: 5,
            cost: [500, 1000, 2000, 4000, 8000],
            description: '+10% collection range per level'
        },
        thrustPower: {
            name: 'Thrust Power',
            maxLevel: 5,
            cost: [500, 1000, 2000, 4000, 8000],
            description: '+15% thrust speed per level'
        },
        startingLives: {
            name: 'Starting Lives',
            maxLevel: 3,
            cost: [2000, 5000, 10000],
            description: '+1 starting life per level'
        },
        turnSpeed: {
            name: 'Turn Speed',
            maxLevel: 5,
            cost: [300, 600, 1200, 2400, 4800],
            description: '+10% turn speed per level'
        },
        powerUpDuration: {
            name: 'Power-Up Duration',
            maxLevel: 5,
            cost: [400, 800, 1600, 3200, 6400],
            description: '+20% power-up duration per level'
        }
    },

    // Current upgrade levels (loaded from persistence)
    levels: {
        collectionRadius: 0,
        thrustPower: 0,
        startingLives: 0,
        turnSpeed: 0,
        powerUpDuration: 0
    },

    // Currency for buying upgrades
    currency: 0,

    load(persistenceManager, user) {
        if (!persistenceManager || !user) return;
        const data = persistenceManager.loadUpgrades(user);
        // Start from defaults so a previous user's credits/levels never carry over
        this.reset();
        if (data) {
            this.levels = { ...this.levels, ...(data.levels || {}) };
            this.currency = data.currency || 0;
        }
    },

    save(persistenceManager, user) {
        if (!persistenceManager || !user) return;
        persistenceManager.saveUpgrades(user, {
            levels: this.levels,
            currency: this.currency
        });
    },

    addCurrency(amount) {
        this.currency += amount;
    },

    canAfford(upgradeKey) {
        const upgrade = this.upgrades[upgradeKey];
        const currentLevel = this.levels[upgradeKey];
        if (currentLevel >= upgrade.maxLevel) return false;
        return this.currency >= upgrade.cost[currentLevel];
    },

    purchase(upgradeKey, persistenceManager, user) {
        if (!this.canAfford(upgradeKey)) return false;
        const upgrade = this.upgrades[upgradeKey];
        const currentLevel = this.levels[upgradeKey];
        this.currency -= upgrade.cost[currentLevel];
        this.levels[upgradeKey]++;
        this.save(persistenceManager, user);
        return true;
    },

    // Get multipliers for game systems
    getCollectionRadiusMult() {
        return 1 + (this.levels.collectionRadius * 0.1);
    },
    getThrustMult() {
        return 1 + (this.levels.thrustPower * 0.15);
    },
    getExtraStartingLives() {
        return this.levels.startingLives;
    },
    getTurnSpeedMult() {
        return 1 + (this.levels.turnSpeed * 0.1);
    },
    getPowerUpDurationMult() {
        return 1 + (this.levels.powerUpDuration * 0.2);
    },

    reset() {
        this.levels = {
            collectionRadius: 0,
            thrustPower: 0,
            startingLives: 0,
            turnSpeed: 0,
            powerUpDuration: 0
        };
        this.currency = 0;
    }
};

// Boss battle state
let currentBoss = null;
let bossDefeatedThisLevel = false;
const BOSS_LEVEL_INTERVAL = 2; // Boss every 2 levels

let score = 0;
let lives = Difficulty.MEDIUM.startingLives; // Default before selection
let level = 1;
let currentGameState = GameState.PROMPT_USER;
let selectedDifficulty = Difficulty.MEDIUM; // Default difficulty
let menuSelectionIndex = 0; // For menu navigation (0: Start, 1: High Scores, 2: Achievements, 3: Help, 4: Reset Data, 5: Easy, 6: Medium, 7: Hard)
const menuOptionBaseTexts = ['Start', 'Upgrades', 'High Scores', 'Achievements', 'Help', 'Controls', 'Reset Data', 'Change User'];

// Touch control schemes. Keyboard always works regardless of the choice.
const ControlMode = {
    JOYSTICK: { id: 'joystick', name: 'Drag to Steer' },
    BUTTONS: { id: 'buttons', name: 'Buttons' },
};
const CONTROL_MODE_KEY = 'spaceAdventure_controlMode';
let controlMode = ControlMode.JOYSTICK; // Default

// Finger tremor on a short drag swings the aim by several degrees; ignore direction
// changes smaller than a threshold (larger when the drag is short and less precise).
let stickHeading = null;
function stabilizeStick(stick) {
    if (!stick.active) {
        stickHeading = null;
        return stick;
    }
    const threshold = stick.magnitude < 0.45 ? 0.1 : 0.04; // radians
    if (stickHeading === null ||
        Math.abs(Math.atan2(Math.sin(stick.angle - stickHeading), Math.cos(stick.angle - stickHeading))) > threshold) {
        stickHeading = stick.angle;
    }
    return { ...stick, angle: stickHeading };
}

function loadControlMode() {
    try {
        const saved = localStorage.getItem(CONTROL_MODE_KEY);
        const found = Object.values(ControlMode).find(m => m.id === saved);
        if (found) controlMode = found;
    } catch (e) { /* storage unavailable: keep default */ }
    applyControlModeClass();
}

function setControlMode(mode) {
    controlMode = mode;
    try { localStorage.setItem(CONTROL_MODE_KEY, mode.id); } catch (e) { /* ignore */ }
    applyControlModeClass();
}

function applyControlModeClass() {
    Object.values(ControlMode).forEach(m => {
        document.body.classList.toggle(`controls-${m.id}`, m === controlMode);
    });
}

let upgradeMenuIndex = 0; // For navigating upgrade options
let currentMenuOptions = []; // Will be populated based on state
let respawnTimer = 0;
let ufoSpawnTimer = UFO_SPAWN_BASE_INTERVAL;
let finalScore = 0;
let highScores = []; // Holds scores for the *current* user usually
let allHighScores = []; // Holds combined scores for display
let allAchievements = {}; // Holds map of username -> Set of achievement IDs
let nextExtraLifeScore = EXTRA_LIFE_SCORE; // Track the next threshold
let pauseMenuSelectionIndex = 0; // For pause menu navigation
const pauseMenuOptions = ['Resume', 'Restart', 'Main Menu']; // Pause menu items
let pausedGameExists = false; // Flag to track paused game
let currentUser = null; // Track current user
let promptInput = ""; // For user name entry

// Bounded world settings (1.5x1.5 screens with wrap-around for higher asteroid density)
const WORLD_SCREENS_X = 1.5; // World is 1.5 screens wide
const WORLD_SCREENS_Y = 1.5; // World is 1.5 screens tall
let WORLD_WIDTH = 800 * WORLD_SCREENS_X;  // Will be set properly after canvas init
let WORLD_HEIGHT = 600 * WORLD_SCREENS_Y; // Will be set properly after canvas init

// Level progression settings
const BASE_ASTEROIDS_PER_LEVEL = 10; // Starting asteroids at level 1
const ASTEROIDS_PER_LEVEL_INCREASE = 3; // Additional asteroids per level

// Level up notification
let levelUpNotificationTimer = 0;
const LEVEL_UP_NOTIFICATION_DURATION = 3; // seconds to show "Level X" message

// Wrap an object's position within the bounded world
function wrapWorldPosition(entity) {
    // Wrap X position
    if (entity.x < 0) {
        entity.x += WORLD_WIDTH;
    } else if (entity.x >= WORLD_WIDTH) {
        entity.x -= WORLD_WIDTH;
    }

    // Wrap Y position
    if (entity.y < 0) {
        entity.y += WORLD_HEIGHT;
    } else if (entity.y >= WORLD_HEIGHT) {
        entity.y -= WORLD_HEIGHT;
    }
}

// Draw an entity at all its wrapped positions that are visible on screen
// This creates the seamless wrapping effect
function drawEntityWrapped(entity, ctx) {
    if (!entity.isAlive) return;

    const originalX = entity.x;
    const originalY = entity.y;

    // Get camera position in world coordinates (normalized)
    const camCenterX = Camera.x + canvas.width / 2;
    const camCenterY = Camera.y + canvas.height / 2;

    // Check all 9 possible wrapped positions (3x3 grid)
    // This ensures entity appears correctly when near world edges
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            const wrappedX = originalX + dx * WORLD_WIDTH;
            const wrappedY = originalY + dy * WORLD_HEIGHT;

            // Check if this wrapped position is visible on screen
            const screenX = wrappedX - Camera.x;
            const screenY = wrappedY - Camera.y;
            const margin = entity.radius ? entity.radius * 2 : 50;

            if (screenX > -margin && screenX < canvas.width + margin &&
                screenY > -margin && screenY < canvas.height + margin) {
                // Temporarily move entity to wrapped position and draw
                entity.x = wrappedX;
                entity.y = wrappedY;
                entity.draw(ctx);
            }
        }
    }

    // Restore original position
    entity.x = originalX;
    entity.y = originalY;
}

// Draw level up notification
function drawLevelUpNotification() {
    if (levelUpNotificationTimer <= 0) return;

    // Fade out effect
    const alpha = Math.min(1, levelUpNotificationTimer / (LEVEL_UP_NOTIFICATION_DURATION * 0.3));

    ctx.save();

    // Draw semi-transparent background box
    ctx.fillStyle = `rgba(0, 0, 0, ${0.7 * alpha})`;
    const boxWidth = 300;
    const boxHeight = 100;
    const boxX = (canvas.width - boxWidth) / 2;
    const boxY = (canvas.height - boxHeight) / 2 - 50;
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

    // Draw border
    ctx.strokeStyle = `rgba(0, 255, 0, ${alpha})`;
    ctx.lineWidth = 3;
    ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

    // Draw "LEVEL X" text
    ctx.fillStyle = `rgba(0, 255, 0, ${alpha})`;
    ctx.font = 'bold 36px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`LEVEL ${level}`, canvas.width / 2, boxY + 35);

    // Draw "Clear all asteroids!" subtitle
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.font = '16px Arial';
    ctx.fillText('Clear all asteroids to advance!', canvas.width / 2, boxY + 70);

    ctx.restore();
}

// Starfield for parallax background
const STAR_COUNT = 200;
const stars = [];

// Generate stars for the background
function generateStars() {
    stars.length = 0;
    for (let i = 0; i < STAR_COUNT; i++) {
        stars.push({
            x: Math.random() * 10000 - 5000, // Wide range for infinite world
            y: Math.random() * 10000 - 5000,
            size: Math.random() * 2 + 0.5,
            brightness: Math.random() * 0.5 + 0.5,
            layer: Math.random() < 0.7 ? 0.3 : 0.6 // Parallax layer (0.3 = far, 0.6 = near)
        });
    }
}

// Draw parallax starfield background
function drawStarfield() {
    // Dark space gradient background
    const gradient = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, 0,
        canvas.width / 2, canvas.height / 2, canvas.width
    );
    gradient.addColorStop(0, '#0A0A20');
    gradient.addColorStop(1, '#050510');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw stars with parallax effect using continuous parallax offset
    // This ensures smooth scrolling even when ship/camera wraps
    stars.forEach(star => {
        // Apply parallax based on layer using continuous parallax tracking
        const parallaxX = star.x - Camera.parallaxX * star.layer;
        const parallaxY = star.y - Camera.parallaxY * star.layer;

        // Wrap stars to keep them visible (seamless tiling)
        const screenX = ((parallaxX % canvas.width) + canvas.width) % canvas.width;
        const screenY = ((parallaxY % canvas.height) + canvas.height) % canvas.height;

        ctx.fillStyle = `rgba(255, 255, 255, ${star.brightness})`;
        ctx.beginPath();
        ctx.arc(screenX, screenY, star.size, 0, Math.PI * 2);
        ctx.fill();
    });
}

// Draw radar mini-map
function drawRadar() {
    const radarSize = Math.round(Math.max(70, Math.min(120, canvas.width * 0.2))); // Smaller on phones
    const radarX = canvas.width - radarSize - 15;
    const radarY = canvas.height - radarSize - 15;
    const radarCenterX = radarX + radarSize / 2;
    const radarCenterY = radarY + radarSize / 2;
    const radarRadius = radarSize / 2 - 5;

    // Radar background
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#001100';
    ctx.beginPath();
    ctx.arc(radarCenterX, radarCenterY, radarRadius + 5, 0, Math.PI * 2);
    ctx.fill();

    // Radar border
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(radarCenterX, radarCenterY, radarRadius + 5, 0, Math.PI * 2);
    ctx.stroke();

    // Radar grid lines
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(radarCenterX - radarRadius, radarCenterY);
    ctx.lineTo(radarCenterX + radarRadius, radarCenterY);
    ctx.moveTo(radarCenterX, radarCenterY - radarRadius);
    ctx.lineTo(radarCenterX, radarCenterY + radarRadius);
    ctx.stroke();

    // Scale factor to fit world into radar
    const scaleX = radarRadius / (WORLD_WIDTH / 2);
    const scaleY = radarRadius / (WORLD_HEIGHT / 2);
    const scale = Math.min(scaleX, scaleY);

    // Function to convert world position to radar position (relative to ship)
    function worldToRadar(entityX, entityY) {
        if (!ship) return null;

        // Calculate relative position to ship
        let relX = entityX - ship.x;
        let relY = entityY - ship.y;

        // Handle world wrapping - find shortest distance
        if (relX > WORLD_WIDTH / 2) relX -= WORLD_WIDTH;
        else if (relX < -WORLD_WIDTH / 2) relX += WORLD_WIDTH;
        if (relY > WORLD_HEIGHT / 2) relY -= WORLD_HEIGHT;
        else if (relY < -WORLD_HEIGHT / 2) relY += WORLD_HEIGHT;

        // Scale to radar size
        const radarRelX = relX * scale;
        const radarRelY = relY * scale;

        // Check if within radar range
        const dist = Math.sqrt(radarRelX * radarRelX + radarRelY * radarRelY);
        if (dist > radarRadius) return null;

        return {
            x: radarCenterX + radarRelX,
            y: radarCenterY + radarRelY
        };
    }

    ctx.globalAlpha = 1;

    // Draw asteroids on radar
    asteroids.forEach(asteroid => {
        if (!asteroid.isAlive) return;
        const pos = worldToRadar(asteroid.x, asteroid.y);
        if (pos) {
            ctx.fillStyle = asteroid.type === 'green' ? '#00FF00' : '#FF0000';
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    });

    // Draw UFOs on radar (purple)
    ufos.forEach(ufo => {
        if (!ufo.isAlive) return;
        const pos = worldToRadar(ufo.x, ufo.y);
        if (pos) {
            ctx.fillStyle = '#FF00FF';
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    });

    // Draw power-ups on radar (yellow)
    powerUps.forEach(powerUp => {
        if (!powerUp.isAlive) return;
        const pos = worldToRadar(powerUp.x, powerUp.y);
        if (pos) {
            ctx.fillStyle = '#FFFF00';
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    });

    // Draw player at center (white triangle)
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(radarCenterX, radarCenterY - 5);
    ctx.lineTo(radarCenterX - 4, radarCenterY + 4);
    ctx.lineTo(radarCenterX + 4, radarCenterY + 4);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}

// Draw active power-up indicators
function drawActivePowerUps() {
    const indicatorY = 50;
    let indicatorX = 10;
    const indicatorSpacing = 70;

    ctx.save();
    ctx.font = '12px Arial';
    ctx.textAlign = 'left';

    const powerUpDisplayInfo = [
        { key: 'rapid_fire', type: PowerUpType.RAPID_FIRE },
        { key: 'triple_shot', type: PowerUpType.TRIPLE_SHOT },
        { key: 'shield', type: PowerUpType.SHIELD },
        { key: 'speed_boost', type: PowerUpType.SPEED_BOOST },
        { key: 'magnet', type: PowerUpType.MAGNET },
        { key: 'score_multiplier', type: PowerUpType.SCORE_MULTIPLIER }
    ];

    powerUpDisplayInfo.forEach(info => {
        const remaining = activePowerUps[info.key];
        if (remaining > 0) {
            // Background bar
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.fillRect(indicatorX, indicatorY, 60, 20);

            // Progress bar
            const progress = Math.min(remaining / info.type.duration, 1);
            ctx.fillStyle = info.type.color;
            ctx.globalAlpha = 0.7;
            ctx.fillRect(indicatorX, indicatorY, 60 * progress, 20);

            // Border
            ctx.globalAlpha = 1;
            ctx.strokeStyle = info.type.color;
            ctx.lineWidth = 1;
            ctx.strokeRect(indicatorX, indicatorY, 60, 20);

            // Symbol
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(info.type.symbol, indicatorX + 5, indicatorY + 14);

            // Time remaining
            ctx.fillText(Math.ceil(remaining) + 's', indicatorX + 30, indicatorY + 14);

            indicatorX += indicatorSpacing;
        }
    });

    ctx.restore();
}

// Activate a collected power-up
function activatePowerUp(type) {
    console.log(`Activating power-up: ${type.name}`);
    // Power-Up Duration upgrade extends timed effects
    type = { ...type, duration: type.duration * ShipUpgrades.getPowerUpDurationMult() };

    switch (type.id) {
        case 'rapid_fire':
            activePowerUps.rapid_fire = type.duration;
            if (ship) ship.shootCooldown = 0.1; // Faster shooting
            break;
        case 'triple_shot':
            activePowerUps.triple_shot = type.duration;
            break;
        case 'shield':
            activePowerUps.shield = type.duration;
            break;
        case 'speed_boost':
            activePowerUps.speed_boost = type.duration;
            break;
        case 'magnet':
            activePowerUps.magnet = type.duration;
            break;
        case 'extra_life':
            lives++;
            console.log(`Extra life! Lives: ${lives}`);
            updateUI();
            if (audioManager) audioManager.play('collectGreen');
            break;
        case 'score_multiplier':
            activePowerUps.score_multiplier = type.duration;
            break;
    }
}

// Reset all power-ups (called when starting new game)
function resetPowerUps() {
    powerUps = [];
    activePowerUps = {
        rapid_fire: 0,
        triple_shot: 0,
        shield: 0,
        speed_boost: 0,
        magnet: 0,
        score_multiplier: 0
    };
    powerUpSpawnTimer = POWERUP_SPAWN_INTERVAL;
}

// Spawn a power-up at a position (e.g., from destroyed enemy)
function spawnPowerUpAt(x, y) {
    if (Math.random() < POWERUP_SPAWN_CHANCE) {
        const type = PowerUp.getRandomType();
        const powerUp = PowerUp.spawnType(x, y, type);
        powerUps.push(powerUp);
        console.log(`Power-up dropped: ${type.name} at (${x.toFixed(0)}, ${y.toFixed(0)})`);
    }
}

// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Loaded - Initializing Game");
    canvas = document.getElementById('gameCanvas');
    if (!canvas) { console.error("Canvas element not found!"); return; }
    ctx = canvas.getContext('2d');
    if (!ctx) { console.error("2D Context not available!"); return; }

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Initialize Managers
    inputHandler = new InputHandler(canvas);
    setupTouchSupport();
    loadControlMode();
    setupUserPromptForm();
    audioManager = new AudioManager();
    persistenceManager = new PersistenceManager();
    achievementManager = new AchievementManager(persistenceManager);

    // Load current user and their specific data
    currentUser = persistenceManager.getCurrentUser();
    if (currentUser) {
        console.log(`Found existing user: ${currentUser}`);
        loadUserData(currentUser); // Loads user's scores into highScores
        currentGameState = GameState.MENU;
    } else {
        console.log("No existing user found, proceeding to prompt.");
        currentGameState = GameState.PROMPT_USER;
    }
    console.log(`[DOM] Initial GameState set to: ${currentGameState}`); // Log the determined state

    // Audio context resume listener (browsers, esp. iOS Safari, only allow audio after a
    // user gesture; touchend/pointerup count as gestures, click may be suppressed on touch)
    const audioUnlockEvents = ['click', 'keydown', 'touchend', 'pointerup'];
    const resumeAudio = () => {
        audioManager.resumeContext();
        audioUnlockEvents.forEach(evt => document.removeEventListener(evt, resumeAudio));
    };
    audioUnlockEvents.forEach(evt => document.addEventListener(evt, resumeAudio));

    // Auto-pause when the tab/app is hidden (e.g. tablet home button) and persist credits
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            inputHandler.releaseAll();
            if (currentGameState === GameState.PLAYING) pauseGame();
            ShipUpgrades.save(persistenceManager, currentUser);
        }
    });
    window.addEventListener('pagehide', () => ShipUpgrades.save(persistenceManager, currentUser));

    // Read-only snapshot used by the automated browser tests
    window.__spaceAdventure = {
        get state() { return currentGameState; },
        get user() { return currentUser; },
        get score() { return score; },
        get lives() { return lives; },
        get level() { return level; },
        get menuIndex() { return menuSelectionIndex; },
        get menuOptions() { return currentMenuOptions.map(o => typeof o === 'string' ? o : o.name); },
        get difficulty() { return selectedDifficulty.id; },
        get pauseIndex() { return pauseMenuSelectionIndex; },
        get upgradeIndex() { return upgradeMenuIndex; },
        get isMuted() { return audioManager.isMuted; },
        get isTouchDevice() { return isTouchDevice; },
        get loopErrors() { return loopErrorCount; },
        get controlMode() { return controlMode.id; },
        get joystick() { return inputHandler.getJoystick(); },
        get world() { return { width: WORLD_WIDTH, height: WORLD_HEIGHT }; },
        get ship() { return ship ? { x: ship.x, y: ship.y, rotation: ship.rotation, velX: ship.velX, velY: ship.velY, isAlive: ship.isAlive, isThrusting: ship.isThrusting } : null; },
        get counts() { return { asteroids: asteroids.length, bullets: bullets.length, playerBullets: bullets.filter(b => b.isPlayerBullet).length, ufos: ufos.length, powerUps: powerUps.length }; },
        get tapRegions() { return tapRegions.map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h })); },
        isPressed(action) { return inputHandler.isPressed(action); },
    };

    console.log(`Starting Game Loop in State: ${currentGameState}`);
    gameLoop();
});

// --- Core Game Functions ---

// Function to load data for a specific user
function loadUserData(username) {
    if (!username) return;
    console.log(`Loading data for user: ${username}`);
    currentUser = username;
    persistenceManager.setCurrentUser(username);
    // Load only the current user's scores into the main highScores variable
    highScores = persistenceManager.loadHighScores(username);
    achievementManager.loadUserAchievements(username);
    // Load ship upgrades
    ShipUpgrades.load(persistenceManager, username);
    menuSelectionIndex = 0;
    pausedGameExists = false;
    // Ensure sounds are stopped
    audioManager.stopThrustSound();
    audioManager.stopUfoHum();
}

// Resets game variables for a new play session using selected difficulty
function startGame() {
    if (!currentUser) {
        console.error("Cannot start game without a user.");
        currentGameState = GameState.PROMPT_USER;
        return;
    }
    console.log(`Starting New Game (User: ${currentUser}, Difficulty: ${selectedDifficulty.name})`);
    score = 0;
    // Apply upgrade: extra starting lives
    lives = selectedDifficulty.startingLives + ShipUpgrades.getExtraStartingLives();
    level = 1;
    nextExtraLifeScore = EXTRA_LIFE_SCORE;
    bullets = [];
    asteroids = [];
    ufos = [];
    resetPowerUps();
    DynamicDifficulty.reset();

    // Reset visual effect systems
    ComboSystem.reset();
    FloatingTexts.clear();
    Particles.clear();
    ScreenShake.reset();

    // Reset boss state
    currentBoss = null;
    bossDefeatedThisLevel = false;

    // Generate starfield for the world
    generateStars();

    // Initialize camera at center of the world
    Camera.reset(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, canvas.width, canvas.height);

    ship = null; // Always build a fresh ship (Restart would otherwise keep the old one)
    respawnPlayer(true); // Call respawn before creating asteroids
    createLevelAsteroids();
    resetUfoSpawnTimer();
    audioManager.stopThrustSound();
    audioManager.stopUfoHum();
    updateUI();
    currentGameState = GameState.PLAYING;
    achievementManager.resetSessionStats();
    pauseMenuSelectionIndex = 0;
    pausedGameExists = false;

    // Show initial level notification
    levelUpNotificationTimer = LEVEL_UP_NOTIFICATION_DURATION;
}

// Function to handle username prompt input
// Keys typed while the text field is not focused are forwarded into it
function handlePromptInput() {
    if (currentGameState !== GameState.PROMPT_USER) return;
    const input = document.getElementById('username-input');
    if (!input) return;

    const pressedChar = inputHandler.consumeLastCharKey();
    if (pressedChar && input.value.length < 10) {
        input.value += pressedChar;
    }
    if (inputHandler.consumeAction('backspace') && input.value.length > 0) {
        input.value = input.value.slice(0, -1);
    }
    if (inputHandler.consumeAction('enter')) {
        submitUsername();
    }
    promptInput = input.value;
}

function sanitizeUsername(value) {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

function submitUsername() {
    const input = document.getElementById('username-input');
    const errorEl = document.getElementById('username-error');
    const newUser = sanitizeUsername(input ? input.value : promptInput);
    if (newUser.length < 3) {
        if (errorEl) errorEl.textContent = 'Please use at least 3 letters or digits.';
        return false;
    }
    if (errorEl) errorEl.textContent = '';
    console.log(`User entered: ${newUser}`);
    loadUserData(newUser);
    currentGameState = GameState.MENU;
    promptInput = "";
    updateUI();
    if (input) {
        input.value = '';
        input.blur(); // Dismiss the on-screen keyboard
    }
    return true;
}

function setupUserPromptForm() {
    const form = document.getElementById('user-prompt');
    const input = document.getElementById('username-input');
    if (!form || !input) return;
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        submitUsername();
    });
    input.addEventListener('input', () => {
        const clean = sanitizeUsername(input.value);
        if (input.value !== clean) input.value = clean;
        promptInput = clean;
    });
}

// Show or hide DOM overlays that depend on the game state
function syncDomToState() {
    document.body.classList.toggle('state-playing', currentGameState === GameState.PLAYING);
    const form = document.getElementById('user-prompt');
    if (form) {
        const show = currentGameState === GameState.PROMPT_USER;
        const wasHidden = form.classList.contains('hidden');
        form.classList.toggle('hidden', !show);
        const input = document.getElementById('username-input');
        // Autofocus for keyboards; touch users tap the field to raise their keyboard
        if (show && wasHidden && input && !isTouchDevice) input.focus();
    }
}

// Touch device detection: show on-screen controls when a touch screen is present
let isTouchDevice = false;
function setupTouchSupport() {
    const enableTouch = () => {
        if (isTouchDevice) return;
        isTouchDevice = true;
        document.body.classList.add('touch-enabled');
    };
    const coarse = window.matchMedia && window.matchMedia('(any-pointer: coarse)').matches;
    if (coarse || navigator.maxTouchPoints > 0 || 'ontouchstart' in window) enableTouch();
    // Fallback: first real touch turns the controls on
    document.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch') enableTouch();
    });
}

function pauseGame() {
    currentGameState = GameState.PAUSED;
    pauseMenuSelectionIndex = 0;
    audioManager.stopThrustSound();
    audioManager.stopUfoHum();
    ShipUpgrades.save(persistenceManager, currentUser);
    console.log("Game Paused");
}

// --- Main Update and Render Loop ---

function resizeCanvas() {
    // Make canvas fill most of the smaller dimension
    const size = Math.min(window.innerWidth, window.innerHeight) * 0.9;
    if (canvas.width > 0 && size < 50) return; // Ignore transient tiny/zero sizes (would zero the world)
    // A rotation can leave a held stick off-screen; make the player put the finger down again
    if (inputHandler) inputHandler.releaseJoystick();
    const oldWorldWidth = WORLD_WIDTH;
    const oldWorldHeight = WORLD_HEIGHT;
    canvas.width = Math.floor(size);
    canvas.height = Math.floor(size);

    // Update world dimensions based on canvas size
    WORLD_WIDTH = canvas.width * WORLD_SCREENS_X;
    WORLD_HEIGHT = canvas.height * WORLD_SCREENS_Y;
    Entity.worldWidth = WORLD_WIDTH;
    Entity.worldHeight = WORLD_HEIGHT;

    // A resize mid-game (e.g. rotating a tablet) changes the world size: scale every
    // entity's position so nothing ends up outside the world.
    if (oldWorldWidth > 0 && oldWorldHeight > 0 &&
        (oldWorldWidth !== WORLD_WIDTH || oldWorldHeight !== WORLD_HEIGHT)) {
        const sx = WORLD_WIDTH / oldWorldWidth;
        const sy = WORLD_HEIGHT / oldWorldHeight;
        const entities = [ship, currentBoss, ...asteroids, ...bullets, ...ufos, ...powerUps];
        entities.forEach(entity => {
            if (!entity) return;
            entity.x *= sx;
            entity.y *= sy;
            wrapWorldPosition(entity);
        });
        if (ship) Camera.reset(ship.x, ship.y, canvas.width, canvas.height);
    }

    console.log(`Canvas resized to: ${canvas.width}x${canvas.height}`);
    console.log(`World size: ${WORLD_WIDTH}x${WORLD_HEIGHT}`);
}

function updateUI() {
    const scoreElement = document.getElementById('score');
    const livesElement = document.getElementById('lives');
    const levelElement = document.getElementById('level');
    const creditsElement = document.getElementById('credits');
    const userElement = document.getElementById('user-display'); // Get user display element

    if (scoreElement) scoreElement.textContent = `Score: ${score}`;
    if (livesElement) livesElement.textContent = `Lives: ${lives}`;
    if (levelElement) levelElement.textContent = `Level: ${level}`;
    if (creditsElement) creditsElement.textContent = `Credits: ${ShipUpgrades.currency}`;
    // Update user display, show placeholder if no user
    if (userElement) {
        userElement.textContent = `User: ${currentUser || '---'}`;
        userElement.style.display = (currentGameState === GameState.PROMPT_USER) ? 'none' : 'block'; // Hide in prompt state
    }
}

// Clickable/tappable screen regions, rebuilt every frame by the render functions
let tapRegions = [];
function addTapRegion(x, y, w, h, onTap) {
    tapRegions.push({ x, y, w, h, onTap });
}
function addFullScreenTap(onTap) {
    addTapRegion(0, 0, canvas.width, canvas.height, onTap);
}
// Route a canvas tap to the topmost region under it
function processTaps() {
    let tap;
    while ((tap = inputHandler.consumeTap())) {
        for (let i = tapRegions.length - 1; i >= 0; i--) {
            const r = tapRegions[i];
            if (tap.x >= r.x && tap.x <= r.x + r.w && tap.y >= r.y && tap.y <= r.y + r.h) {
                r.onTap();
                break;
            }
        }
    }
}

let lastInputState = null;
let gameOverInputDelay = 0; // Ignore input briefly after game over to avoid accidental skips

// Forget one-shot inputs queued in a previous screen. Runs right after the frame's update,
// i.e. at the moment the state changed, so input arriving for the new screen is kept.
function syncStateTransition() {
    if (currentGameState === lastInputState) return;
    inputHandler.clearPending();
    if (currentGameState === GameState.PLAYING || lastInputState === GameState.PLAYING) {
        inputHandler.releaseAll();
    }
    lastInputState = currentGameState;
    syncDomToState();
}

function handleInput(deltaTime) {
    syncStateTransition(); // Catches changes made outside the loop (e.g. auto-pause)
    processTaps();

    if (currentGameState === GameState.PROMPT_USER) {
         handlePromptInput();
         return;
    }

    switch (currentGameState) {
        case GameState.MENU:
             // Regenerate options for current state
            currentMenuOptions = [...menuOptionBaseTexts];
            // Dynamically add difficulty options
            Object.values(Difficulty).forEach(diff => currentMenuOptions.push(diff));

            if (pausedGameExists) currentMenuOptions[0] = 'Resume';
            else currentMenuOptions[0] = 'Start';

            // Adjust index bounds safely
            if (menuSelectionIndex >= currentMenuOptions.length) {
                menuSelectionIndex = 0;
            }

            if (inputHandler.consumeAction('menuUp')) {
                 menuSelectionIndex = (menuSelectionIndex - 1 + currentMenuOptions.length) % currentMenuOptions.length;
            }
            if (inputHandler.consumeAction('menuDown')) {
                 menuSelectionIndex = (menuSelectionIndex + 1) % currentMenuOptions.length;
            }
            if (inputHandler.consumeAction('menuSelect')) {
                const selectedOption = currentMenuOptions[menuSelectionIndex];
                console.log(`Menu index ${menuSelectionIndex} selected: `, selectedOption);

                // Use the index for Start/Resume, then check the string value for others
                if (menuSelectionIndex === 0) { // Start or Resume
                    if (pausedGameExists) {
                        console.log("Resuming paused game...");
                        currentGameState = GameState.PLAYING;
                    } else {
                        console.log("Executing startGame() from menu...");
                        startGame();
                    }
                } else if (typeof selectedOption === 'string') {
                    // Handle string options (Upgrades, High Scores, Achievements, Help, Reset, Change User)
                    switch (selectedOption) {
                        case 'Upgrades':
                            upgradeMenuIndex = 0;
                            currentGameState = GameState.UPGRADES;
                            break;
                        case 'High Scores':
                            // Load combined data when entering the high score screen
                            allHighScores = persistenceManager.loadHighScores(); // Load all
                            allAchievements = persistenceManager.loadAchievements(); // Load all achievements
                            currentGameState = GameState.HIGH_SCORES;
                            break;
                        case 'Achievements':
                            currentGameState = GameState.ACHIEVEMENTS;
                            break;
                        case 'Help':
                            currentGameState = GameState.HELP;
                            break;
                        case 'Controls': {
                            // Cycle through the touch control schemes
                            const modes = Object.values(ControlMode);
                            setControlMode(modes[(modes.indexOf(controlMode) + 1) % modes.length]);
                            break;
                        }
                        case 'Reset Data':
                            if (currentUser && confirm(`Are you sure you want to reset all data for user '${currentUser}'?`)) {
                                console.log(`Resetting data for user: ${currentUser}`);
                                persistenceManager.resetUserData(currentUser);
                                persistenceManager.setCurrentUser(currentUser); // Stay signed in after the reset
                                highScores = [];
                                achievementManager.loadUserAchievements(currentUser);
                                ShipUpgrades.reset();
                                alert("User data reset.");
                            }
                            break;
                        case 'Change User':
                            ShipUpgrades.save(persistenceManager, currentUser);
                            currentGameState = GameState.PROMPT_USER;
                            promptInput = "";
                            currentUser = null;
                            persistenceManager.setCurrentUser(null);
                            break;
                    }
                } else if (typeof selectedOption === 'object' && selectedOption.id) { // Difficulty object
                    selectedDifficulty = selectedOption;
                    console.log(`Difficulty set to: ${selectedDifficulty.name}`);
                } else {
                     console.warn("Unhandled menu selection:", selectedOption);
                }
            }
            break;

        case GameState.PLAYING:
            if (inputHandler.consumeAction('pause') || inputHandler.consumeAction('escape')) {
                pauseGame();
                break;
            }
            if (!currentUser || !ship || !ship.isAlive) {
                inputHandler.consumeAction('hyperspace'); // Don't queue a jump while dead
                audioManager.stopThrustSound();
                break;
            }
            const turnTime = deltaTime * ShipUpgrades.getTurnSpeedMult();
            if (inputHandler.isPressed('rotateLeft')) ship.rotate(-1, turnTime);
            if (inputHandler.isPressed('rotateRight')) ship.rotate(1, turnTime);
            const speedBoost = activePowerUps.speed_boost > 0 ? SPEED_BOOST_MULT : 1;
            const thrustScale = ShipUpgrades.getThrustMult() * speedBoost;
            const stickThrust = applyJoystickSteering(ship, stabilizeStick(inputHandler.getJoystick()), deltaTime, turnTime, thrustScale);
            if (inputHandler.isPressed('thrust')) ship.thrust(deltaTime * thrustScale);
            else if (!stickThrust) ship.isThrusting = false;

            // Log fire button state and then attempt fire
            if (inputHandler.isPressed('fire')) {
                const bulletCountBefore = bullets.length;
                ship.fire(bullets, audioManager);
                // Track shots fired for DDA
                if (bullets.length > bulletCountBefore) {
                    DynamicDifficulty.trackShotFired();
                }

                // Triple shot: add 2 more bullets at angles if power-up active and we fired
                if (activePowerUps.triple_shot > 0 && bullets.length > bulletCountBefore) {
                    const spreadAngle = 0.25; // radians (~15 degrees)
                    const bulletSpeed = Bullet.PLAYER_SPEED;
                    const noseX = ship.x + Math.cos(ship.rotation) * ship.radius;
                    const noseY = ship.y + Math.sin(ship.rotation) * ship.radius;

                    // Left bullet
                    const leftAngle = ship.rotation - spreadAngle;
                    bullets.push(new Bullet(
                        noseX, noseY,
                        Math.cos(leftAngle) * bulletSpeed,
                        Math.sin(leftAngle) * bulletSpeed,
                        true
                    ));

                    // Right bullet
                    const rightAngle = ship.rotation + spreadAngle;
                    bullets.push(new Bullet(
                        noseX, noseY,
                        Math.cos(rightAngle) * bulletSpeed,
                        Math.sin(rightAngle) * bulletSpeed,
                        true
                    ));
                }
            }

            if (inputHandler.consumeAction('hyperspace')) {
                if (ship.hyperspace(WORLD_WIDTH, WORLD_HEIGHT, asteroids, ufos, audioManager) && !ship.isAlive) {
                    handlePlayerDeath(true); // May set ship = null (respawn pending)
                    audioManager.stopThrustSound();
                    break;
                }
            }
            if (ship.isThrusting && !audioManager.isMuted) audioManager.startThrustSound();
            else audioManager.stopThrustSound();
            break;

        case GameState.PAUSED:
            if (inputHandler.consumeAction('pause') || inputHandler.consumeAction('escape')) {
                console.log("Consumed pause/escape (to PLAYING)");
                currentGameState = GameState.PLAYING;
                console.log("Game Resumed");
                break; // Exit switch after resuming
            }

            if (inputHandler.consumeAction('menuUp')) {
                pauseMenuSelectionIndex = (pauseMenuSelectionIndex - 1 + pauseMenuOptions.length) % pauseMenuOptions.length;
            }
            if (inputHandler.consumeAction('menuDown')) {
                pauseMenuSelectionIndex = (pauseMenuSelectionIndex + 1) % pauseMenuOptions.length;
            }

            if (inputHandler.consumeAction('menuSelect')) {
                const selection = pauseMenuOptions[pauseMenuSelectionIndex];
                console.log(`Pause menu selection: ${selection}`);
                switch (selection) {
                    case 'Resume':
                        currentGameState = GameState.PLAYING;
                        console.log("Game Resumed");
                        break;
                    case 'Restart':
                        ShipUpgrades.save(persistenceManager, currentUser);
                        startGame();
                        break;
                    case 'Main Menu':
                        currentGameState = GameState.MENU;
                        menuSelectionIndex = 0;
                        pausedGameExists = true; // Set the flag when returning to menu from pause
                        break;
                }
            }
            break;

        case GameState.HIGH_SCORES:
            if (inputHandler.consumeAction('menuSelect') || inputHandler.consumeAction('escape')) {
                currentGameState = GameState.MENU;
                menuSelectionIndex = 0;
                allHighScores = []; // Clear combined data when leaving
                allAchievements = {};
            }
            break;

        case GameState.UPGRADES:
            {
                const upgradeKeys = Object.keys(ShipUpgrades.upgrades);
                if (inputHandler.consumeAction('menuUp')) {
                    upgradeMenuIndex = (upgradeMenuIndex - 1 + upgradeKeys.length + 1) % (upgradeKeys.length + 1);
                }
                if (inputHandler.consumeAction('menuDown')) {
                    upgradeMenuIndex = (upgradeMenuIndex + 1) % (upgradeKeys.length + 1);
                }
                if (inputHandler.consumeAction('menuSelect')) {
                    if (upgradeMenuIndex === upgradeKeys.length) {
                        // Back option
                        currentGameState = GameState.MENU;
                        menuSelectionIndex = 0;
                    } else {
                        // Try to purchase upgrade
                        const key = upgradeKeys[upgradeMenuIndex];
                        if (ShipUpgrades.purchase(key, persistenceManager, currentUser)) {
                            console.log(`Purchased upgrade: ${key}`);
                            FloatingTexts.spawn(canvas.width / 2, canvas.height / 2,
                                'Upgrade Purchased!', '#00FF00', 28);
                        }
                    }
                }
                if (inputHandler.consumeAction('escape')) {
                    currentGameState = GameState.MENU;
                    menuSelectionIndex = 0;
                }
            }
            break;

        case GameState.ACHIEVEMENTS:
            {
                let returnToMenu = false;
                if (inputHandler.consumeAction('escape')) {
                    console.log("Consumed escape (to MENU from Achievements)");
                    returnToMenu = true;
                } else if (inputHandler.consumeAction('menuSelect')) {
                    console.log("Consumed menuSelect (to MENU from Achievements)");
                    returnToMenu = true;
                }
                if (returnToMenu) {
                    currentGameState = GameState.MENU;
                    menuSelectionIndex = 0;
                }
            }
            break;

        case GameState.HELP:
            if (inputHandler.consumeAction('menuSelect') || inputHandler.consumeAction('escape')) {
                currentGameState = GameState.MENU;
                menuSelectionIndex = 0;
            }
            break;

        case GameState.GAME_OVER:
            if (gameOverInputDelay > 0) {
                gameOverInputDelay -= deltaTime;
                inputHandler.clearPending();
                break;
            }
            if (inputHandler.consumeAction('menuSelect') || inputHandler.consumeAction('enter')) {
                 currentGameState = GameState.MENU;
                 menuSelectionIndex = 0;
                 pausedGameExists = false;
            }
            break;
    }

    // Global Mute Toggle
    if (inputHandler.consumeAction('toggleMute')) {
        audioManager.toggleMute();
        const muteBtn = document.getElementById('touch-mute-btn');
        if (muteBtn) muteBtn.classList.toggle('muted', audioManager.isMuted);
    }
}

function updateGame(deltaTime) {
    handleInput(deltaTime);
    syncStateTransition();
    inputHandler.endFrame();
    if (currentGameState !== GameState.MENU && currentGameState !== GameState.PROMPT_USER) {
        achievementManager.updateNotifications(deltaTime);
    }
    if (currentGameState !== GameState.PLAYING) {
        return;
    }

    // --- Game Playing Logic ---

    if (respawnTimer > 0) {
        respawnTimer -= deltaTime;
        if (respawnTimer <= 0 && lives > 0 && currentGameState !== GameState.GAME_OVER) {
            console.log("Respawn timer finished, attempting respawn...");
            respawnPlayer();
        }
    }

    if (currentGameState === GameState.GAME_OVER) {
        return; // No updates if game is over
    }

    if (ship && ship.isAlive && respawnTimer <= 0) {
        ship.update(deltaTime, canvas.width, canvas.height, audioManager);
        // Wrap player position in bounded world
        wrapWorldPosition(ship);
        // Update camera to follow player
        Camera.update(ship.x, ship.y, canvas.width, canvas.height);
    }

    // Update asteroids and wrap their positions
    asteroids.forEach(asteroid => {
        asteroid.updateInfinite(deltaTime);
        wrapWorldPosition(asteroid);
    });

    // Update level up notification timer
    if (levelUpNotificationTimer > 0) {
        levelUpNotificationTimer -= deltaTime;
    }

    // Update bullets and wrap their positions
    bullets.forEach(bullet => {
        bullet.update(deltaTime, canvas.width, canvas.height);
        wrapWorldPosition(bullet);
    });

    // Update UFOs and wrap their positions
    let visibleUfoExists = false;
    // Create effective difficulty with DDA modifiers applied
    const effectiveDifficulty = {
        ...selectedDifficulty,
        ufoAccuracy: Math.min(1, selectedDifficulty.ufoAccuracy * DynamicDifficulty.ufoAccuracyMod)
    };
    ufos.forEach(ufo => {
        if(ufo.isAlive) {
             ufo.update(deltaTime, canvas.width, canvas.height, ship, bullets, audioManager, effectiveDifficulty, asteroids, Camera.x, Camera.y);
             wrapWorldPosition(ufo);
             if (ufo.isOnScreen) {
                 visibleUfoExists = true;
             }
        }
    });

    // Only play UFO hum when a UFO is actually visible on screen
    if (visibleUfoExists && !audioManager.isMuted) audioManager.startUfoHum();
    else audioManager.stopUfoHum();

    // Update power-ups
    powerUps.forEach(powerUp => {
        powerUp.update(deltaTime, canvas.width, canvas.height);
    });
    powerUps = powerUps.filter(p => p.isAlive);

    // Update active power-up timers
    for (const key in activePowerUps) {
        if (activePowerUps[key] > 0) {
            const wasActive = activePowerUps[key] > 0;
            activePowerUps[key] -= deltaTime;
            if (activePowerUps[key] < 0) activePowerUps[key] = 0;

            // Handle power-up expiry effects
            if (wasActive && activePowerUps[key] <= 0) {
                if (key === 'rapid_fire' && ship) {
                    ship.shootCooldown = 0.25; // Reset to normal cooldown
                    console.log('Rapid fire expired');
                }
            }
        }
    }

    // Spawn random power-ups periodically (DDA modifier affects spawn rate)
    powerUpSpawnTimer -= deltaTime;
    if (powerUpSpawnTimer <= 0) {
        const newPowerUp = PowerUp.spawnRandom(WORLD_WIDTH, WORLD_HEIGHT);
        newPowerUp.type = PowerUp.getRandomType();
        powerUps.push(newPowerUp);
        // Apply DDA modifier: lower mod = faster spawns (helps struggling players)
        powerUpSpawnTimer = POWERUP_SPAWN_INTERVAL * DynamicDifficulty.powerUpSpawnMod;
        console.log(`Spawned random power-up: ${newPowerUp.type.name}`);
    }

    // Magnet effect - attract green asteroids toward ship
    if (activePowerUps.magnet > 0 && ship && ship.isAlive) {
        asteroids.forEach(asteroid => {
            if (asteroid.isAlive && asteroid.type === 'green') {
                // Calculate direction to ship
                let dx = ship.x - asteroid.x;
                let dy = ship.y - asteroid.y;

                // Handle wrapping
                if (dx > WORLD_WIDTH / 2) dx -= WORLD_WIDTH;
                else if (dx < -WORLD_WIDTH / 2) dx += WORLD_WIDTH;
                if (dy > WORLD_HEIGHT / 2) dy -= WORLD_HEIGHT;
                else if (dy < -WORLD_HEIGHT / 2) dy += WORLD_HEIGHT;

                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 20 && dist < 300) { // Attract within range
                    const magnetForce = 100 / dist;
                    asteroid.velX += (dx / dist) * magnetForce * deltaTime;
                    asteroid.velY += (dy / dist) * magnetForce * deltaTime;
                }
            }
        });
    }

    checkCollisions();

    bullets = bullets.filter(bullet => bullet.isAlive);
    asteroids = asteroids.filter(asteroid => asteroid.isAlive);
    ufos = ufos.filter(ufo => ufo.isAlive);

    updateUfoSpawning(deltaTime);

    // Level up when all asteroids are cleared and boss is defeated (if present)
    const bossCleared = !currentBoss || !currentBoss.isAlive;
    if (asteroids.length === 0 && ufos.length === 0 && bossCleared && respawnTimer <= 0 && ship && ship.isAlive) {
        levelUp();
    }

    const currentSnapshot = { score: score, level: level, user: currentUser };
    achievementManager.checkUnlockConditions(currentSnapshot);

    // Evaluate player performance and adjust difficulty
    DynamicDifficulty.evaluate(score);

    // Update visual effects systems
    ComboSystem.update(deltaTime);
    FloatingTexts.update(deltaTime);
    Particles.update(deltaTime);
    ScreenShake.update(deltaTime);

    // Update boss if present
    if (currentBoss && currentBoss.isAlive) {
        currentBoss.update(deltaTime, canvas.width, canvas.height, ship, bullets, audioManager);
        // Only wrap position during fighting phase (not during entry animation)
        if (currentBoss.phase === Boss.PHASES.FIGHTING) {
            wrapWorldPosition(currentBoss);
        }
    }

    updateUI();
}

function renderGame() {
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    tapRegions = [];

    // console.log(`[renderGame] Current state: ${currentGameState}`); // Optional: Log state every frame
    switch (currentGameState) {
        case GameState.PROMPT_USER:
            drawUserPrompt();
            break;
        case GameState.MENU:
            ctx.fillStyle = 'white';
            ctx.textAlign = 'center';
            ctx.font = '48px Arial';
            ctx.fillText("SPACE ADVENTURE", canvas.width / 2, canvas.height / 6);

            // Game description
            ctx.font = '14px Arial';
            ctx.fillStyle = '#00FF00';
            ctx.fillText("Collect GREEN asteroids for points!", canvas.width / 2, canvas.height / 6 + 35);
            ctx.fillStyle = '#CC0000';
            ctx.fillText("Avoid RED asteroids - shoot them to survive!", canvas.width / 2, canvas.height / 6 + 55);
            ctx.fillStyle = 'white';

            ctx.font = '20px Arial';
            // Regenerate options based on paused state for render
            currentMenuOptions = [...menuOptionBaseTexts];
            if (pausedGameExists) currentMenuOptions[0] = 'Resume';
            else currentMenuOptions[0] = 'Start';
            currentMenuOptions.push(...Object.values(Difficulty)); // Add difficulties

            // Fit all items between the description and the player/credits footer
            const menuStartY = canvas.height * 0.38;
            const menuLineHeight = Math.min(30, (canvas.height - 75 - menuStartY) / currentMenuOptions.length);

            // Adjust index bounds safely before rendering
             if (menuSelectionIndex >= currentMenuOptions.length) {
                menuSelectionIndex = 0;
             }

            currentMenuOptions.forEach((option, index) => {
                const isSelected = index === menuSelectionIndex;
                ctx.fillStyle = isSelected ? 'yellow' : 'white';
                let text = '';
                if (option === 'Controls') {
                    text = `Controls: ${controlMode.name}`;
                } else if (typeof option === 'string') {
                    text = option;
                } else { // Difficulty object
                    text = option.name;
                    if (option === selectedDifficulty) {
                        text += " (Selected)";
                        if (!isSelected) ctx.fillStyle = 'cyan';
                    }
                }
                const itemY = menuStartY + index * menuLineHeight;
                ctx.fillText(text, canvas.width / 2, itemY);
                // Tapping an item highlights and selects it
                addTapRegion(canvas.width * 0.2, itemY - menuLineHeight * 0.7, canvas.width * 0.6, menuLineHeight, () => {
                    menuSelectionIndex = index;
                    inputHandler.triggerAction('menuSelect');
                });
            });

            // Show current user and credits at bottom
            ctx.font = '16px Arial';
            ctx.fillStyle = '#888888';
            ctx.fillText(`Player: ${currentUser || 'None'}`, canvas.width / 2, canvas.height - 50);
            ctx.fillStyle = '#FFD700';
            ctx.font = 'bold 18px Arial';
            ctx.fillText(`Upgrade Credits: ${ShipUpgrades.currency}`, canvas.width / 2, canvas.height - 25);
            break;

        case GameState.PLAYING:
            // Draw starfield background (parallax effect)
            drawStarfield();

            // Apply camera transformation for game objects (with screen shake)
            ctx.save();
            ctx.translate(-Camera.x + ScreenShake.offsetX, -Camera.y + ScreenShake.offsetY);

            // Draw all entities with wrapping support for seamless scrolling
            if (ship && ship.isAlive && respawnTimer <= 0) drawEntityWrapped(ship, ctx);
            asteroids.forEach(asteroid => drawEntityWrapped(asteroid, ctx));
            bullets.forEach(bullet => drawEntityWrapped(bullet, ctx));
            ufos.forEach(ufo => drawEntityWrapped(ufo, ctx));
            powerUps.forEach(powerUp => drawEntityWrapped(powerUp, ctx));

            // Draw boss if present
            if (currentBoss && currentBoss.isAlive) {
                drawEntityWrapped(currentBoss, ctx);
            }

            // Draw particles in world space (context is already camera-transformed, so pass 0,0)
            Particles.draw(ctx, 0, 0);

            ctx.restore();

            // Draw shield effect around ship if active (in screen space)
            if (ship && ship.isAlive && activePowerUps.shield > 0) {
                const screenPos = Camera.worldToScreen(ship.x, ship.y);
                ctx.strokeStyle = '#00FFFF';
                ctx.lineWidth = 2;
                ctx.globalAlpha = 0.5 + Math.sin(Date.now() / 100) * 0.3;
                ctx.beginPath();
                ctx.arc(screenPos.x, screenPos.y, ship.radius + 10, 0, Math.PI * 2);
                ctx.stroke();
                ctx.globalAlpha = 1;
            }

            // Draw level up notification (screen-space, not world-space)
            drawLevelUpNotification();

            // Draw HUD elements (screen-space)
            drawRadar();
            drawActivePowerUps();

            // Draw remaining asteroids count
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.font = '14px Arial';
            ctx.textAlign = 'left';
            ctx.fillText(`Asteroids: ${asteroids.length}`, 10, canvas.height - 10);

            // Draw Dynamic Difficulty Adjustment indicator
            const ddaText = DynamicDifficulty.getAdjustmentText();
            const ddaColor = DynamicDifficulty.getAdjustmentColor();
            ctx.fillStyle = ddaColor;
            ctx.font = '12px Arial';
            ctx.textAlign = 'left';
            ctx.fillText(`Difficulty: ${ddaText}`, 130, canvas.height - 10);

            // Draw combo indicator
            if (ComboSystem.count >= 2) {
                ctx.textAlign = 'center';
                const comboAlpha = Math.min(1, ComboSystem.timer / ComboSystem.maxTime + 0.3);
                ctx.globalAlpha = comboAlpha;

                // Combo count and multiplier
                ctx.fillStyle = '#FFD700';
                ctx.font = 'bold 24px Arial';
                ctx.fillText(`${ComboSystem.count}x COMBO`, canvas.width / 2, 80);

                // Multiplier indicator
                if (ComboSystem.multiplier > 1) {
                    ctx.fillStyle = '#FF6600';
                    ctx.font = 'bold 18px Arial';
                    ctx.fillText(`${ComboSystem.multiplier}x SCORE`, canvas.width / 2, 105);
                }

                // Timer bar
                const timerWidth = 100 * (ComboSystem.timer / ComboSystem.maxTime);
                ctx.fillStyle = '#FFD700';
                ctx.fillRect(canvas.width / 2 - 50, 115, timerWidth, 4);
                ctx.globalAlpha = 1;
            }

            // Draw floating texts (screen-space)
            FloatingTexts.draw(ctx);

            // Draw boss warning if boss is entering (limited time)
            if (currentBoss && currentBoss.isAlive && currentBoss.shouldShowWarning()) {
                ctx.fillStyle = '#FF0000';
                ctx.font = 'bold 36px Arial';
                ctx.textAlign = 'center';
                ctx.globalAlpha = 0.5 + Math.sin(Date.now() / 200) * 0.5;
                ctx.fillText('WARNING: BOSS APPROACHING!', canvas.width / 2, canvas.height / 2);
                ctx.globalAlpha = 1;
            }

            break;

        case GameState.PAUSED:
            // Draw starfield background
            drawStarfield();

            ctx.globalAlpha = 0.5;
            // Apply camera transformation for game objects
            ctx.save();
            ctx.translate(-Camera.x, -Camera.y);

            // Draw all entities with wrapping support
            if (ship && ship.isAlive && respawnTimer <= 0) drawEntityWrapped(ship, ctx);
            asteroids.forEach(asteroid => drawEntityWrapped(asteroid, ctx));
            bullets.forEach(bullet => drawEntityWrapped(bullet, ctx));
            ufos.forEach(ufo => drawEntityWrapped(ufo, ctx));

            ctx.restore();
            ctx.globalAlpha = 1.0;

            drawPauseMenu();
            break;

        case GameState.HIGH_SCORES:
            drawHighScores(allHighScores, allAchievements);
            addFullScreenTap(() => inputHandler.triggerAction('menuSelect'));
            break;

        case GameState.ACHIEVEMENTS:
            drawAchievements();
            addFullScreenTap(() => inputHandler.triggerAction('menuSelect'));
            break;

        case GameState.UPGRADES:
            drawUpgradesMenu();
            FloatingTexts.draw(ctx);
            break;

        case GameState.HELP:
            drawHelpScreen();
            addFullScreenTap(() => inputHandler.triggerAction('menuSelect'));
            break;

        case GameState.GAME_OVER:
            drawCenterText("GAME OVER", `Final Score: ${finalScore}`);
            ctx.font = '20px Arial';
            ctx.fillText(isTouchDevice ? "Tap for Menu" : "Press Space or Enter for Menu", canvas.width / 2, canvas.height / 2 + 60);
            addFullScreenTap(() => inputHandler.triggerAction('menuSelect'));
            break;
        default:
             console.error(`[renderGame] Encountered unknown game state: ${currentGameState}`);
             break;
    }

    if (currentGameState === GameState.PLAYING || currentGameState === GameState.PAUSED) {
        drawAchievementNotifications();
    }
}

function drawCenterText(line1, line2 = null) {
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.font = '48px Arial';
    ctx.fillText(line1, canvas.width / 2, canvas.height / 2 - (line2 ? 20 : 0));
    if (line2) {
        ctx.font = '24px Arial';
        ctx.fillText(line2, canvas.width / 2, canvas.height / 2 + 20);
    }
}

// The Main Game Loop
let lastTime = 0;
let loopErrorCount = 0;
function gameLoop(timestamp = 0) {
    // Schedule the next frame first so one bad frame can never stop the game for good
    requestAnimationFrame(gameLoop);
    const rawDeltaTime = (timestamp - lastTime) / 1000;
    const deltaTime = Math.min(rawDeltaTime, 1 / 20);
    lastTime = timestamp;
    try {
        updateGame(deltaTime);
        renderGame();
    } catch (error) {
        loopErrorCount++;
        if (loopErrorCount <= 5) console.error('[gameLoop] frame error (game continues):', error);
    }
}

// --- Helper Functions ---

function createLevelAsteroids(isBossLevel = false) {
    console.log(`Creating asteroids for level ${level} (Difficulty: ${selectedDifficulty.name})${isBossLevel ? ' [BOSS LEVEL]' : ''}`);
    asteroids = [];

    // Calculate number of asteroids for this level (fewer during boss battles)
    let numAsteroids = BASE_ASTEROIDS_PER_LEVEL + (level - 1) * ASTEROIDS_PER_LEVEL_INCREASE;
    if (isBossLevel) {
        numAsteroids = Math.floor(numAsteroids * 0.4); // 40% of normal asteroids during boss fight
    }
    const playerX = ship ? ship.x : WORLD_WIDTH / 2;
    const playerY = ship ? ship.y : WORLD_HEIGHT / 2;

    // Apply DDA modifiers
    const speedMod = selectedDifficulty.asteroidSpeedMultiplier * DynamicDifficulty.asteroidSpeedMod;
    // Base green probability is 60%, modified by DDA
    const greenProbability = Math.min(0.85, Math.max(0.4, 0.6 * DynamicDifficulty.greenRatioMod));

    console.log(`Spawning ${numAsteroids} asteroids (speed: ${speedMod.toFixed(2)}x, green%: ${(greenProbability * 100).toFixed(0)}%)`);

    let greenCount = 0;
    for (let i = 0; i < numAsteroids; i++) {
        let x, y;
        let attempts = 0;

        // Find a position that's not too close to the player
        do {
            x = randomRange(0, WORLD_WIDTH);
            y = randomRange(0, WORLD_HEIGHT);
            attempts++;
        } while (
            Math.sqrt((x - playerX) ** 2 + (y - playerY) ** 2) < SAFE_SPAWN_RADIUS * 2 &&
            attempts < 20
        );

        // Mostly large asteroids at start of level (they split into smaller ones)
        const sizeRoll = Math.random();
        let size;
        if (sizeRoll < 0.6) {
            size = Asteroid.Sizes.LARGE;
        } else if (sizeRoll < 0.85) {
            size = Asteroid.Sizes.MEDIUM;
        } else {
            size = Asteroid.Sizes.SMALL;
        }

        // Determine asteroid type with DDA-adjusted probability
        const isGreen = Math.random() < greenProbability;
        const type = isGreen ? 'green' : 'red';
        if (isGreen) greenCount++;

        asteroids.push(new Asteroid(x, y, size, null, speedMod, type));
    }

    // Track green asteroids spawned for DDA
    DynamicDifficulty.trackGreenSpawned(greenCount);
}

function checkCollisions() {
    // Check ship collecting power-ups (always check, even when invulnerable)
    if (ship && ship.isAlive) {
        for (const powerUp of powerUps) {
            if (powerUp.isAlive && ship.collidesWith(powerUp)) {
                console.log(`Collected power-up: ${powerUp.type.name}`);
                activatePowerUp(powerUp.type);
                powerUp.isAlive = false;
            }
        }
    }

    if (ship && ship.isAlive && !ship.isInvulnerable) {
        const collectRadius = ship.radius * ShipUpgrades.getCollectionRadiusMult();
        for (const asteroid of asteroids) {
            if (!asteroid.isAlive) continue;
            // Collection Radius upgrade enlarges the pickup range for green asteroids only
            let touching;
            if (asteroid.isGreen()) {
                const { dx, dy } = Entity.wrappedDelta(ship.x, ship.y, asteroid.x, asteroid.y);
                touching = Math.hypot(dx, dy) < collectRadius + asteroid.radius;
            } else {
                touching = ship.collidesWith(asteroid);
            }
            if (touching) {
                if (asteroid.isGreen()) {
                    // GREEN asteroid: Collect it for points!
                    console.log("Collision: Ship <-> Green Asteroid (Collected!)");

                    // Calculate base score
                    let scoreGained = Math.round(asteroid.scoreValue * selectedDifficulty.scoreMultiplier);

                    // Apply score multiplier power-up
                    if (activePowerUps.score_multiplier > 0) {
                        scoreGained *= 2;
                    }

                    // Apply combo multiplier
                    const comboResult = ComboSystem.addCollection();
                    scoreGained *= ComboSystem.multiplier;

                    // Add streak bonus if any
                    if (comboResult.streakBonus > 0) {
                        scoreGained += comboResult.streakBonus;
                    }

                    updateScore(scoreGained);

                    // Add credits for upgrades (10% of score)
                    const creditsEarned = Math.ceil(scoreGained * 0.1);
                    ShipUpgrades.addCurrency(creditsEarned);

                    asteroid.destroy();

                    // Visual effects
                    const screenPos = Camera.worldToScreen(asteroid.x, asteroid.y);
                    Particles.collect(asteroid.x, asteroid.y, '#00FF00');

                    // Floating score text
                    let scoreText = `+${scoreGained}`;
                    if (ComboSystem.multiplier > 1) {
                        scoreText += ` (${ComboSystem.multiplier}x)`;
                    }
                    FloatingTexts.spawn(screenPos.x, screenPos.y, scoreText, '#00FF00', 18);

                    // Play collection sound
                    if (audioManager) {
                        audioManager.play('collectGreen');
                    }
                    achievementManager.trackAsteroidCollected();
                    DynamicDifficulty.trackGreenCollected(ComboSystem.count);
                } else {
                    // RED asteroid: Lose a life (unless shield is active)!
                    if (activePowerUps.shield > 0) {
                        console.log("Collision: Ship <-> Red Asteroid (Shield blocked!)");
                        activePowerUps.shield = 0; // Shield breaks on impact
                        ship.makeInvulnerable(1); // Grace period so the fragments don't kill instantly
                        asteroid.split(asteroids, audioManager);
                        break; // split() appended to the array we're iterating
                    } else {
                        console.log("Collision: Ship <-> Red Asteroid (Damage!)");
                        handlePlayerDeath();
                        asteroid.split(asteroids, audioManager);
                        return;
                    }
                }
            }
        }

        for (const ufo of ufos) {
            if (ufo.isAlive && ship.collidesWith(ufo)) {
                if (activePowerUps.shield > 0) {
                    console.log("Collision: Ship <-> UFO (Shield blocked!)");
                    activePowerUps.shield = 0;
                    ship.makeInvulnerable(1);
                    ufo.destroy(audioManager);
                } else {
                    console.log("Collision: Ship <-> UFO");
                    handlePlayerDeath();
                    ufo.destroy(audioManager);
                    return;
                }
            }
        }

        for (const bullet of bullets) {
            if (bullet.isAlive && !bullet.isPlayerBullet && ship.collidesWith(bullet)) {
                if (activePowerUps.shield > 0) {
                    console.log("Collision: Ship <-> UFO Bullet (Shield blocked!)");
                    activePowerUps.shield = 0;
                    ship.makeInvulnerable(1);
                    bullet.destroy();
                } else {
                    console.log("Collision: Ship <-> UFO Bullet");
                    handlePlayerDeath();
                    bullet.destroy();
                    return;
                }
            }
        }
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        if (!bullet.isAlive || !bullet.isPlayerBullet) continue;
        let bulletHit = false;
        for (let j = asteroids.length - 1; j >= 0; j--) {
            const asteroid = asteroids[j];
            if (!asteroid.isAlive) continue;
            if (bullet.collidesWith(asteroid)) {
                bullet.destroy();

                DynamicDifficulty.trackShotHit(); // Track bullet hit
                if (asteroid.isGreen()) {
                    // Shooting green asteroids: NO points! (wasteful - should collect instead)
                    console.log("Collision: Player Bullet <-> Green Asteroid (Wasted!)");
                    asteroid.split(asteroids, audioManager); // Just destroys, no children
                } else {
                    // Shooting red asteroids: Good! They split but no points
                    console.log("Collision: Player Bullet <-> Red Asteroid (Destroyed!)");
                    // Chance to drop power-up from red asteroids
                    spawnPowerUpAt(asteroid.x, asteroid.y);
                    asteroid.split(asteroids, audioManager);
                    achievementManager.trackAsteroidDestroyed();
                    DynamicDifficulty.trackRedDestroyed();
                }
                bulletHit = true;
                break;
            }
        }
        if (bulletHit) continue;
        for (let j = ufos.length - 1; j >= 0; j--) {
            const ufo = ufos[j];
            if (!ufo.isAlive) continue;
            if (bullet.collidesWith(ufo)) {
                console.log("Collision: Player Bullet <-> UFO");
                bullet.destroy();
                DynamicDifficulty.trackShotHit(); // Track bullet hit
                const scoreGained = Math.round(ufo.scoreValue * selectedDifficulty.scoreMultiplier);
                updateScore(scoreGained);
                // Award credits for UFO kill (10% of score)
                const creditsEarned = Math.ceil(scoreGained * 0.1);
                ShipUpgrades.addCurrency(creditsEarned);
                // UFOs have higher chance to drop power-ups
                if (Math.random() < 0.5) {
                    spawnPowerUpAt(ufo.x, ufo.y);
                }
                ufo.destroy(audioManager);
                achievementManager.trackUfoDestroyed();
                break;
            }
        }
    }

    // Check UFO bullets hitting asteroids (UFOs destroy green asteroids!)
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        if (!bullet.isAlive || bullet.isPlayerBullet) continue; // Only UFO bullets

        for (let j = asteroids.length - 1; j >= 0; j--) {
            const asteroid = asteroids[j];
            if (!asteroid.isAlive) continue;

            if (bullet.collidesWith(asteroid)) {
                bullet.destroy();
                if (asteroid.isGreen()) {
                    // UFO destroyed a green asteroid - bad for player!
                    console.log("Collision: UFO Bullet <-> Green Asteroid (Score opportunity lost!)");
                }
                asteroid.split(asteroids, audioManager);
                break;
            }
        }
    }

    // Check player bullets hitting boss weak points
    if (currentBoss && currentBoss.isAlive && currentBoss.phase === Boss.PHASES.FIGHTING) {
        for (const bullet of bullets) {
            if (!bullet.isAlive || !bullet.isPlayerBullet) continue;

            const hitWeakPoint = currentBoss.checkBulletHit(bullet);
            if (hitWeakPoint) {
                bullet.destroy();
                DynamicDifficulty.trackShotHit();

                // Damage the weak point
                const bossDefeated = currentBoss.damageWeakPoint(hitWeakPoint, 10);

                // Visual and audio feedback
                Particles.explode(bullet.x, bullet.y, '#FFFF00', 10);
                ScreenShake.trigger(5, 0.1);

                if (hitWeakPoint.destroyed) {
                    // Weak point destroyed
                    FloatingTexts.spawn(bullet.x, bullet.y - 20, 'WEAK POINT!', '#FFFF00', 24);
                    Particles.explode(bullet.x, bullet.y, '#FF00FF', 25);
                    ScreenShake.trigger(10, 0.3);
                    updateScore(200);
                    ShipUpgrades.addCurrency(20); // Credits for weak point
                }

                if (bossDefeated) {
                    // Boss defeated!
                    console.log('Boss defeated! Awarding bonus score.');
                    FloatingTexts.spawn(canvas.width / 2, canvas.height / 3,
                        `BOSS DEFEATED! +${currentBoss.scoreValue}`, '#FFD700', 36, 3);
                    updateScore(currentBoss.scoreValue);
                    // Big credit bonus for defeating boss (20% of boss score)
                    const bossCredits = Math.ceil(currentBoss.scoreValue * 0.2);
                    ShipUpgrades.addCurrency(bossCredits);
                    FloatingTexts.spawn(canvas.width / 2, canvas.height / 3 + 50,
                        `+${bossCredits} CREDITS!`, '#FFD700', 24, 3);
                    Particles.explode(currentBoss.x, currentBoss.y, '#FF00FF', 50);
                    Particles.explode(currentBoss.x, currentBoss.y, '#FFFF00', 40);
                    ScreenShake.trigger(20, 0.5);

                    // Drop multiple power-ups
                    for (let i = 0; i < 3; i++) {
                        const offsetX = (Math.random() - 0.5) * 100;
                        const offsetY = (Math.random() - 0.5) * 100;
                        const powerUp = new PowerUp(currentBoss.x + offsetX, currentBoss.y + offsetY);
                        powerUp.type = PowerUp.getRandomType();
                        powerUps.push(powerUp);
                    }

                    // Clear boss reference
                    currentBoss = null;
                    bossDefeatedThisLevel = true;
                }
                break;
            }
        }
    }

    // Check boss bullets hitting player
    if (currentBoss && currentBoss.isAlive && ship && ship.isAlive && !ship.isInvulnerable) {
        // Boss bullets are added to the main bullets array in boss.update
        // They're already checked in the earlier ship-bullet collision section
    }

    // Check if player collides with boss body
    if (currentBoss && currentBoss.isAlive && currentBoss.phase === Boss.PHASES.FIGHTING &&
        ship && ship.isAlive && !ship.isInvulnerable) {
        // Use elliptical collision for the saucer shape
        // Boss visual is: width = radius, height = radius * 0.4
        let dx = ship.x - currentBoss.x;
        let dy = ship.y - currentBoss.y;
        if (dx > WORLD_WIDTH / 2) dx -= WORLD_WIDTH;
        else if (dx < -WORLD_WIDTH / 2) dx += WORLD_WIDTH;
        if (dy > WORLD_HEIGHT / 2) dy -= WORLD_HEIGHT;
        else if (dy < -WORLD_HEIGHT / 2) dy += WORLD_HEIGHT;
        // Scale vertical distance to account for saucer's flat elliptical shape
        const scaledDy = dy / 0.5; // Make vertical collision zone thinner (saucer shape)
        const dist = Math.sqrt(dx * dx + scaledDy * scaledDy);

        if (dist < ship.radius + currentBoss.radius) {
            // Player crashed into boss
            console.log('Boss collision detected!');
            if (activePowerUps.shield > 0) {
                activePowerUps.shield = 0;
                console.log('Shield absorbed boss collision!');
                ship.isInvulnerable = true;
                ship.invulnerabilityTimer = 1;
            } else {
                handlePlayerDeath();
            }
        }
    }
}

function handlePlayerDeath(forced = false) {
    let destroyed = forced;
    const shipX = ship ? ship.x : WORLD_WIDTH / 2;
    const shipY = ship ? ship.y : WORLD_HEIGHT / 2;

    if (ship && !forced) {
        destroyed = ship.destroy(audioManager, forced);
    }

    if (destroyed) {
        console.log(`Player death handled. Lives left: ${lives - 1}`);
        audioManager.stopThrustSound();
        DynamicDifficulty.onPlayerDeath(); // Immediate difficulty adjustment on death

        // Visual effects
        Particles.explode(shipX, shipY, '#FFFFFF', 30);
        ScreenShake.trigger(15, 0.5);
        ComboSystem.break();

        lives--;
        updateUI();
        if (lives <= 0) {
            gameOver();
        } else {
            console.log(`Starting respawn timer (${RESPAWN_DELAY}s)`);
            respawnTimer = RESPAWN_DELAY;
            ship = null;
        }
    }
}

function respawnPlayer(isInitialSpawn = false) {
    console.log(`respawnPlayer called. isInitialSpawn=${isInitialSpawn}, currentGameState=${currentGameState}, shipExists=${!!ship}, shipAlive=${ship?.isAlive}`);
    if (currentGameState !== GameState.GAME_OVER && (!ship || !ship.isAlive)) {
         console.log("Respawning Player - Conditions Met");

         // Spawn at center of the world
         const centerX = WORLD_WIDTH / 2;
         const centerY = WORLD_HEIGHT / 2;

         ship = new PlayerShip(centerX, centerY);
         if (activePowerUps.rapid_fire > 0) ship.shootCooldown = 0.1;
         respawnTimer = 0;
         audioManager.stopThrustSound();

         // Make ship invulnerable after respawn (unless initial spawn)
         if (!isInitialSpawn) {
             ship.makeInvulnerable(3); // 3 seconds of invulnerability after respawn
             console.log("Ship made invulnerable for 3 seconds");
         }

         // Reset camera to player position
         Camera.reset(centerX, centerY, canvas.width, canvas.height);
    } else {
        console.log("Respawning Player - Conditions NOT Met");
    }
}

function levelUp() {
    level++;
    console.log(`Level up to ${level}!`);

    // Show level up notification
    levelUpNotificationTimer = LEVEL_UP_NOTIFICATION_DURATION;

    // Play level up sound
    if (audioManager) {
        audioManager.play('collectGreen'); // Satisfying chime
    }

    // Reset boss defeated flag for new level
    bossDefeatedThisLevel = false;

    // Check if this is a boss level
    if (level > 1 && level % BOSS_LEVEL_INTERVAL === 0) {
        // Spawn boss at top of visible area (in world coordinates)
        const bossX = ship ? ship.x : WORLD_WIDTH / 2;
        // Target Y is 150px below top of visible screen in world coords
        const targetY = ship ? ship.y - canvas.height / 2 + 150 : WORLD_HEIGHT / 4;
        const bossLevel = Math.floor(level / BOSS_LEVEL_INTERVAL);
        currentBoss = new Boss(bossX, targetY, bossLevel);
        console.log(`BOSS BATTLE! Spawning level ${bossLevel} boss at target y=${targetY}!`);

        // Show boss warning
        FloatingTexts.spawn(canvas.width / 2, canvas.height / 2 - 50,
            'BOSS BATTLE!', '#FF0000', 48, 3);

        // Fewer regular asteroids during boss fight
        createLevelAsteroids(true); // Boss level modifier
    } else {
        // Create normal asteroids for this level
        createLevelAsteroids();
    }

    // Reset UFO spawn timer for new level
    resetUfoSpawnTimer();

    updateUI();
    achievementManager.checkUnlockConditions({ score: score, level: level, user: currentUser });
}

function gameOver() {
    console.log("Game Over!");
    finalScore = score;
    currentGameState = GameState.GAME_OVER;
    gameOverInputDelay = 1;
    pausedGameExists = false;
    if(ship) {
        ship.isThrusting = false;
    }
    audioManager.stopThrustSound();
    audioManager.stopUfoHum();
    checkAndAddHighScore(finalScore);

    // Save upgrade currency earned this session
    ShipUpgrades.save(persistenceManager, currentUser);
    console.log(`Saved ${ShipUpgrades.currency} upgrade credits.`);

    // Clear boss if present
    currentBoss = null;
}

function checkAndAddHighScore(currentScore) {
    if (!persistenceManager || !currentUser || currentScore <= 0) return;
    const playerName = currentUser.substring(0, 3).toUpperCase();
    const newEntry = { name: playerName, score: currentScore }; // Note: name here is just for display if needed, user is implicit

    // Load current user's scores for comparison
    let currentUserScores = persistenceManager.loadHighScores(currentUser);

    let insertIndex = currentUserScores.findIndex(entry => currentScore > entry.score);
    if (insertIndex === -1 && currentUserScores.length < MAX_HIGH_SCORES) {
        insertIndex = currentUserScores.length;
    }

    if (insertIndex !== -1) {
        console.log(`New high score for ${currentUser}: ${playerName} - ${currentScore}`);
        currentUserScores.splice(insertIndex, 0, newEntry);
        if (currentUserScores.length > MAX_HIGH_SCORES) {
            currentUserScores.pop();
        }
        // Save the updated list for the current user
        persistenceManager.saveHighScores(currentUser, currentUserScores);
        // Update the local copy used by the game state if needed immediately
        highScores = currentUserScores;
    }
}

function resetUfoSpawnTimer() {
    let interval = UFO_SPAWN_BASE_INTERVAL;
    interval *= selectedDifficulty.ufoSpawnMultiplier;
    interval *= DynamicDifficulty.ufoSpawnMod; // Apply DDA modifier
    interval *= Math.max(0.5, 1 - (level * 0.05));
    ufoSpawnTimer = interval * randomRange(0.75, 1.25);
    console.log(`Next UFO spawn timer set to ~${interval.toFixed(1)}s`);
}

function updateUfoSpawning(deltaTime) {
    if (currentGameState !== GameState.PLAYING || respawnTimer > 0) return;

    if (ufos.length >= UFO.MaxActiveUFOs) return;

    ufoSpawnTimer -= deltaTime;
    if (ufoSpawnTimer <= 0) {
        console.log("Attempting to spawn UFO");
        // Spawn UFO at a visible position near the edge of the current screen
        const playerX = ship ? ship.x : WORLD_WIDTH / 2;
        const playerY = ship ? ship.y : WORLD_HEIGHT / 2;

        // Spawn at edge of visible area
        const spawnSide = Math.floor(Math.random() * 4); // 0=top, 1=right, 2=bottom, 3=left
        let ufoX, ufoY;

        switch (spawnSide) {
            case 0: // Top
                ufoX = playerX + randomRange(-canvas.width / 2, canvas.width / 2);
                ufoY = playerY - canvas.height / 2 - 20;
                break;
            case 1: // Right
                ufoX = playerX + canvas.width / 2 + 20;
                ufoY = playerY + randomRange(-canvas.height / 2, canvas.height / 2);
                break;
            case 2: // Bottom
                ufoX = playerX + randomRange(-canvas.width / 2, canvas.width / 2);
                ufoY = playerY + canvas.height / 2 + 20;
                break;
            case 3: // Left
                ufoX = playerX - canvas.width / 2 - 20;
                ufoY = playerY + randomRange(-canvas.height / 2, canvas.height / 2);
                break;
        }

        // Wrap UFO spawn position to world bounds
        ufoX = ((ufoX % WORLD_WIDTH) + WORLD_WIDTH) % WORLD_WIDTH;
        ufoY = ((ufoY % WORLD_HEIGHT) + WORLD_HEIGHT) % WORLD_HEIGHT;

        // Create UFO at the calculated position
        const ufo = new UFO(canvas.width, canvas.height, playerX, playerY);
        ufo.x = ufoX;
        ufo.y = ufoY;
        ufos.push(ufo);

        console.log(`UFO spawned at (${ufoX.toFixed(0)}, ${ufoY.toFixed(0)}) near player at (${playerX.toFixed(0)}, ${playerY.toFixed(0)})`);
        resetUfoSpawnTimer();
    }

    // In bounded world, UFOs wrap around naturally - no despawning needed
}

function drawHighScores(scoresToDisplay, achievementsMap) {
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.font = '36px Arial';
    const titleY = canvas.height / 6;
    ctx.fillText("HIGH SCORES (ALL USERS)", canvas.width / 2, titleY);

    ctx.font = '20px Arial';
    const listStartY = titleY + 60;
    const listLineHeight = 30;
    const rankX = canvas.width / 6;
    const nameX = canvas.width / 3;
    const scoreX = canvas.width * 4 / 5;
    const achievementSymbol = '*'; // Symbol for achievements

    if (!scoresToDisplay || scoresToDisplay.length === 0) {
        ctx.textAlign = 'center';
        ctx.fillText("No scores yet!", canvas.width / 2, listStartY);
    } else {
        // Limit to MAX_HIGH_SCORES for display
        const scoresToShow = scoresToDisplay.slice(0, MAX_HIGH_SCORES);
        scoresToShow.forEach((entry, index) => {
            ctx.textAlign = 'left';
            const rank = `${index + 1}.`.padEnd(3);
            // entry.user should exist from loadHighScores(null)
            const username = entry.user || "???";
            const nameDisplay = username.substring(0, 3).toUpperCase();
            const scoreVal = entry.score;

            // Check if this user has any achievements
            const userAchievements = achievementsMap[username];
            const hasAchievements = userAchievements && userAchievements.size > 0;
            const displayName = `${nameDisplay}${hasAchievements ? achievementSymbol : ''}`;

            ctx.fillStyle = 'white';
            ctx.fillText(`${rank}`, rankX, listStartY + index * listLineHeight);
            ctx.fillText(displayName, nameX, listStartY + index * listLineHeight);
            ctx.textAlign = 'right';
            ctx.fillText(scoreVal.toString(), scoreX, listStartY + index * listLineHeight);
        });
    }

    ctx.textAlign = 'center';
    ctx.font = '18px Arial';
    ctx.fillStyle = 'white';
    ctx.fillText((isTouchDevice ? "Tap to return" : "Press Space/Enter/Esc to return"), canvas.width / 2, canvas.height - 40);
}

function drawAchievements() {
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.font = '36px Arial';
    const titleY = canvas.height / 8;
    ctx.fillText("ACHIEVEMENTS", canvas.width / 2, titleY);

    ctx.font = '18px Arial';
    ctx.textAlign = 'left';
    const listStartY = titleY + 50;
    const listLineHeight = 45;
    const nameX = canvas.width / 8;
    const descX = canvas.width / 8;
    const statusX = canvas.width * 7 / 8;

    const allAchievements = achievementManager.getAllAchievementsStatus();

    allAchievements.forEach((ach, index) => {
        const yPos = listStartY + index * listLineHeight;
        ctx.fillStyle = ach.unlocked ? 'gold' : 'gray';
        ctx.font = 'bold 18px Arial';
        ctx.fillText(ach.name, nameX, yPos);

        ctx.fillStyle = ach.unlocked ? 'white' : '#aaa';
        ctx.font = '16px Arial';
        ctx.fillText(ach.description, descX, yPos + 20);
    });

    ctx.textAlign = 'center';
    ctx.font = '18px Arial';
    ctx.fillStyle = 'white';
    ctx.fillText((isTouchDevice ? "Tap to return" : "Press Space/Enter/Esc to return"), canvas.width / 2, canvas.height - 40);
}

function drawUpgradesMenu() {
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.font = '36px Arial';
    const titleY = canvas.height / 10;
    ctx.fillText("SHIP UPGRADES", canvas.width / 2, titleY);

    // Show currency
    ctx.font = '24px Arial';
    ctx.fillStyle = '#FFD700';
    ctx.fillText(`Credits: ${ShipUpgrades.currency}`, canvas.width / 2, titleY + 40);

    ctx.font = '18px Arial';
    ctx.textAlign = 'left';
    const listStartY = titleY + 90;
    const listLineHeight = 55;

    const upgradeKeys = Object.keys(ShipUpgrades.upgrades);

    upgradeKeys.forEach((key, index) => {
        const upgrade = ShipUpgrades.upgrades[key];
        const currentLevel = ShipUpgrades.levels[key];
        const isMaxed = currentLevel >= upgrade.maxLevel;
        const cost = isMaxed ? 'MAX' : upgrade.cost[currentLevel];
        const canAfford = !isMaxed && ShipUpgrades.currency >= cost;
        const isSelected = index === upgradeMenuIndex;

        const yPos = listStartY + index * listLineHeight;
        const nameX = canvas.width * 0.1;
        addTapRegion(nameX - 10, yPos - 20, canvas.width * 0.8 + 20, listLineHeight - 5, () => {
            upgradeMenuIndex = index;
            inputHandler.triggerAction('menuSelect');
        });

        // Selection indicator
        if (isSelected) {
            ctx.fillStyle = 'rgba(255, 255, 0, 0.2)';
            ctx.fillRect(nameX - 10, yPos - 20, canvas.width * 0.8 + 20, listLineHeight - 5);
        }

        // Upgrade name
        ctx.fillStyle = isSelected ? '#FFFF00' : '#FFFFFF';
        ctx.font = 'bold 20px Arial';
        ctx.fillText(upgrade.name, nameX, yPos);

        // Level indicators
        ctx.font = '16px Arial';
        let levelText = '';
        for (let i = 0; i < upgrade.maxLevel; i++) {
            levelText += i < currentLevel ? '[*]' : '[ ]';
        }
        ctx.fillStyle = '#00FF00';
        ctx.fillText(levelText, nameX + 200, yPos);

        // Cost
        ctx.textAlign = 'right';
        if (isMaxed) {
            ctx.fillStyle = '#888888';
            ctx.fillText('MAXED', canvas.width * 0.9, yPos);
        } else {
            ctx.fillStyle = canAfford ? '#00FF00' : '#FF4444';
            ctx.fillText(`Cost: ${cost}`, canvas.width * 0.9, yPos);
        }
        ctx.textAlign = 'left';

        // Description
        ctx.fillStyle = '#AAAAAA';
        ctx.font = '14px Arial';
        ctx.fillText(upgrade.description, nameX, yPos + 22);
    });

    // Back option
    const backY = listStartY + upgradeKeys.length * listLineHeight;
    const isBackSelected = upgradeMenuIndex === upgradeKeys.length;
    ctx.fillStyle = isBackSelected ? '#FFFF00' : '#FFFFFF';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('< Back to Menu >', canvas.width / 2, backY);
    addTapRegion(canvas.width * 0.25, backY - 25, canvas.width * 0.5, 40, () => {
        upgradeMenuIndex = upgradeKeys.length;
        inputHandler.triggerAction('menuSelect');
    });

    ctx.fillStyle = '#888888';
    ctx.font = '14px Arial';
    ctx.fillText('Earn credits by collecting green asteroids', canvas.width / 2, canvas.height - 50);
    ctx.fillText(isTouchDevice ? 'Tap an upgrade to purchase it' : 'Use UP/DOWN to navigate, ENTER to purchase (or click)', canvas.width / 2, canvas.height - 30);
}

function drawAchievementNotifications() {
    const notifications = achievementManager.getActiveNotifications();
    if (notifications.length > 0) {
        const startY = canvas.height * 0.85;
        const lineHeight = 30;
        ctx.textAlign = 'center';
        ctx.font = 'bold 20px Arial';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, startY - 25, canvas.width, notifications.length * lineHeight + 15);

        notifications.forEach((ach, index) => {
            ctx.fillStyle = 'yellow';
            ctx.fillText(`Achievement Unlocked: ${ach.name}`, canvas.width / 2, startY + index * lineHeight);
        });
    }
}

function updateScore(amount) {
    if (amount <= 0) return;
    score += amount;
    if (score >= nextExtraLifeScore) {
        lives++;
        console.log(`Extra Life! Score: ${score}, Lives: ${lives}`);
        nextExtraLifeScore += Math.round(EXTRA_LIFE_SCORE * DynamicDifficulty.extraLifeThresholdMod);
    }
    updateUI();
    achievementManager.checkUnlockConditions({ score: score, level: level, user: currentUser });
}

function drawPauseMenu() {
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(canvas.width * 0.25, canvas.height * 0.25, canvas.width * 0.5, canvas.height * 0.5);

    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.font = '36px Arial';
    const titleY = canvas.height * 0.35;
    ctx.fillText("PAUSED", canvas.width / 2, titleY);

    ctx.font = '24px Arial';
    const pauseStartY = titleY + 60;
    const pauseLineHeight = 40;
    pauseMenuOptions.forEach((option, index) => {
        ctx.fillStyle = index === pauseMenuSelectionIndex ? 'yellow' : 'white';
        const itemY = pauseStartY + index * pauseLineHeight;
        ctx.fillText(option, canvas.width / 2, itemY);
        addTapRegion(canvas.width * 0.25, itemY - pauseLineHeight * 0.7, canvas.width * 0.5, pauseLineHeight, () => {
            pauseMenuSelectionIndex = index;
            inputHandler.triggerAction('menuSelect');
        });
    });

    ctx.font = '16px Arial';
    ctx.fillStyle = 'lightgray';
    ctx.fillText(isTouchDevice ? "(Tap an option)" : "(Press P or Esc to Resume)", canvas.width / 2, canvas.height * 0.75 - 20);
}

function drawHelpScreen() {
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.font = '28px Arial';
    const titleY = canvas.height / 12;
    ctx.fillText("SPACE ADVENTURE - HELP", canvas.width / 2, titleY);

    // Game rules section
    ctx.font = '16px Arial';
    ctx.textAlign = 'left';
    const rulesX = canvas.width / 10;
    let rulesY = titleY + 40;

    ctx.fillStyle = '#00FF00';
    ctx.fillText("GREEN Asteroids:", rulesX, rulesY);
    ctx.fillStyle = 'white';
    ctx.fillText("Fly INTO them to collect points! Don't shoot them.", rulesX + 130, rulesY);

    rulesY += 22;
    ctx.fillStyle = '#CC0000';
    ctx.fillText("RED Asteroids:", rulesX, rulesY);
    ctx.fillStyle = 'white';
    ctx.fillText("Dangerous! SHOOT them to survive. Don't touch!", rulesX + 120, rulesY);

    rulesY += 22;
    ctx.fillStyle = '#9933FF';
    ctx.fillText("Aliens (UFOs):", rulesX, rulesY);
    ctx.fillStyle = 'white';
    ctx.fillText("Shoot at you AND green asteroids! Destroy them!", rulesX + 110, rulesY);

    // Controls section
    ctx.fillStyle = 'white';
    ctx.font = '20px Arial';
    rulesY += 35;
    ctx.fillText("CONTROLS", rulesX, rulesY);

    ctx.font = '14px Arial';
    const helpStartY = rulesY + 25;
    const helpLineHeight = 22;
    const controlsX = rulesX;
    const keysX = canvas.width / 2;

    const controls = isTouchDevice && controlMode === ControlMode.JOYSTICK ? [
        { action: 'Steer', keys: 'Drag on the left half of the screen' },
        { action: 'Thrust Forward', keys: 'Drag further out' },
        { action: 'Fire', keys: 'Red button' },
        { action: 'Hyperspace (Risky!)', keys: 'Star button' },
        { action: 'Pause Game', keys: 'Pause button (top right)' },
        { action: 'Control scheme', keys: 'Menu > Controls' },
    ] : isTouchDevice ? [
        { action: 'Rotate Left/Right', keys: 'Arrow buttons (bottom left)' },
        { action: 'Thrust Forward', keys: 'Up arrow button' },
        { action: 'Fire', keys: 'Red button' },
        { action: 'Hyperspace (Risky!)', keys: 'Star button' },
        { action: 'Pause Game', keys: 'Pause button (top right)' },
        { action: 'Toggle Mute', keys: 'Speaker button (top right)' },
    ] : [
        { action: 'Rotate Left/Right', keys: 'Arrow Keys / A,D' },
        { action: 'Thrust Forward', keys: 'Up Arrow / W' },
        { action: 'Fire', keys: 'Spacebar' },
        { action: 'Hyperspace (Risky!)', keys: 'H / S / Down Arrow' },
        { action: 'Pause Game', keys: 'P / Escape' },
        { action: 'Toggle Mute', keys: 'M' },
    ];

    controls.forEach((ctrl, index) => {
        ctx.fillText(ctrl.action + ":", controlsX, helpStartY + index * helpLineHeight);
        ctx.fillText(ctrl.keys, keysX, helpStartY + index * helpLineHeight);
    });

    ctx.textAlign = 'center';
    ctx.font = '16px Arial';
    ctx.fillText((isTouchDevice ? "Tap to return" : "Press Space/Enter/Esc to return"), canvas.width / 2, canvas.height - 30);
}

// The username text field itself is a DOM form (see index.html) so touch devices get
// their on-screen keyboard; the canvas only draws the title around it.
function drawUserPrompt() {
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.font = '40px Arial';
    ctx.fillText("SPACE ADVENTURE", canvas.width / 2, canvas.height / 6);

    ctx.font = '18px Arial';
    ctx.fillStyle = '#AAAAAA';
    ctx.fillText(isTouchDevice ? "Tap the box, type a name, then tap OK" : "Type a name, then press Enter",
        canvas.width / 2, canvas.height * 0.7);
}

// Export necessary functions/variables if using modules elsewhere
// export { canvas, ctx, score, lives, level }; 