import { PlayerShip } from './player.js';
import { Asteroid } from './asteroid.js';
import { Bullet } from './bullet.js';
import { InputHandler } from './input.js';
import { randomRange, wrapDelta, isNearAny } from './utils.js';
import { UFO } from './ufo.js';
import { AudioManager } from './audio.js';
import { PersistenceManager } from './persistence.js';
import { AchievementManager } from './achievementManager.js';
import { Achievements } from './achievements.js';
import { PowerUp, PowerUpType } from './powerup.js';
import { Boss } from './boss.js';
import { Entity } from './entity.js';
import { applyJoystickSteering, angleDiff, stabilizeHeading } from './steering.js';
import { computeCanvasSize, MAX_RENDER_SCALE } from './viewport.js';
import { Particles } from './particles.js';
import { createSettings } from './settings.js';
import { findPalette } from './palette.js';
import { Haptics } from './haptics.js';
import { MusicEngine, selectMood } from './music.js';
import { tuneName } from './tunes.js';
import { GP, buttonGlyph, controllerName } from './gamepad.js';
import { Tutorial, detectInputKind, TUTORIAL_VERSION } from './tutorial.js';
import { UpgradeState } from './upgrades.js';
import { createCamera } from './camera.js';
import { MODES, getMode, scaleForPlayers, pickSpawnPoint, ringSpawnGrid, worldSpawnGrid } from './modes.js';
import { createPlayer, tickPowerUps, teamScore, isLiving, livingPlayers, nearestLivingShip } from './players.js';
import {
    createSeatLobby, createCountLobby, handleLobbyEvent, tickLobby, seatLineup, countLineup, restoreSeatLineup,
    restoreCountLineup, changePlayerCount, cycleCountName, joinedSeats, canStart,
    serializeLineup, parseLineup, LINEUP_KEY,
} from './lobby.js';
import { buildResults, resultBanner, historyEntry } from './mpResults.js';
import { MP_KEYS, addHistory, addToBoard, recordRivalry, isHistory, isBoard, isRivalry } from './mpRecords.js';

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
    SETTINGS: 'settings',
    TUTORIAL_ASK: 'tutorial_ask', // "First time? Play the tutorial / Skip" before a first game
    GAME_OVER: 'game_over',
    // Local multiplayer (docs/plans/05-local-multiplayer.md §5)
    MP_MODE_SELECT: 'mp_mode_select',
    LOBBY: 'lobby',
    TURN_CHANGE: 'turn_change', // Take Turns: "PLAYER 2 – GET READY"
    ROUND_END: 'round_end',     // 2 s slow-motion banner
    RESULTS: 'results',
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

// Shared camera (js/camera.js). It follows the living ships: with one ship it snaps to it
// every frame exactly like the old single-player camera (instant follow, zoom 1, parallax from
// the ship's wrapped movement); with more ships it frames their midpoint.
// camera.x/y is the world point at the top-left of the view, camera.cx/cy the centre.
const camera = createCamera();
function cameraView() {
    return { width: viewWidth, height: viewHeight, worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT };
}

// Game State Variables
let canvas, ctx;
let inputHandler;
let audioManager;
let persistenceManager;
let achievementManager;
let asteroids = [];
let bullets = [];
let ufos = [];
let powerUps = [];

// Active power-up effects are per player (p.powerUps: remaining seconds per timed power-up)
const RAPID_FIRE_COOLDOWN = 0.1;  // seconds between shots with rapid fire
const NORMAL_SHOT_COOLDOWN = 0.25; // PlayerShip default

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

// Combo: per player (p.combo, a Combo from js/players.js). It reports milestones and breaks;
// these show the texts. Single-player keeps the centred texts; with more players they
// appear near that player's ship in the player's colour.
function comboTextAnchor(p, fallbackY) {
    if (simultaneous() && p.ship) {
        const pos = shipScreenPos(p.ship);
        return { x: pos.x, y: pos.y - 40 };
    }
    return { x: viewWidth / 2, y: fallbackY };
}
function showComboMilestone(p, result) {
    if (!result.streakBonus) return;
    const at = comboTextAnchor(p, viewHeight / 3);
    FloatingTexts.spawn(at.x, at.y, `${result.milestone} STREAK! +${result.streakBonus}`,
        simultaneous() ? p.colour : '#FFD700', 36);
}
function showComboLost(p, result) {
    if (!result || !result.lost) return;
    const at = comboTextAnchor(p, viewHeight / 2);
    FloatingTexts.spawn(at.x, at.y, 'Combo Lost!', simultaneous() ? p.colour : '#FF4444', 24);
}

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

// Persistent ship upgrades of the signed-in profile (js/upgrades.js). Player 1 shares this
// object (players[0].upgrades), so the Upgrades screen and saves keep working.
const ShipUpgrades = new UpgradeState();

// Boss battle state
let currentBoss = null;
let bossDefeatedThisLevel = false;
const BOSS_LEVEL_INTERVAL = 2; // Boss every 2 levels

// Players (js/players.js): each has its own ship, score, lives, respawn timer and extra-life
// threshold. Single-player is exactly one player (mode 'solo'); players[0] is the signed-in
// player and shares ShipUpgrades. A default player exists before the first game.
let players = [createPlayer({ slot: 0, lives: Difficulty.MEDIUM.startingLives, upgrades: ShipUpgrades })];
function p1() { return players[0]; }

// Game mode (js/modes.js): rules and pure hooks; main.js applies their decisions. Single-player
// is MODES.solo, which reproduces the classic game exactly. `round` is the per-round data the
// hooks read (timer, phase, difficulty); `lastLobby` is kept for Restart.
let mode = MODES.solo;
let round = null;
let lastLobby = null;
let lastRoundResult = null;
function createRound(m) {
    const timer = m.timer ? m.timer.default : null;
    return {
        elapsed: 0, timeLeft: timer, phase: 'normal', overtimeLeft: null, overtimeWinner: null,
        difficulty: selectedDifficulty.id, target: null,
    };
}
// Numbers for this mode, player count and level (single-player: today's constants)
function currentScaling() {
    return scaleForPlayers(mode, players.length, Math.max(1, level));
}
// Starting lives: the mode's fixed count, else the difficulty's plus the Starting Lives upgrade
function startingLivesFor(upgrades) {
    return mode.lives.count ?? (selectedDifficulty.startingLives + upgrades.getExtraStartingLives());
}
// Input seam: `p.input` is anything with isPressed/consumeAction/getJoystick. Single-player
// uses the shared InputHandler (every source drives seat 0); a lobby seat gets this view of it.
function seatInput(seat) {
    return {
        seat,
        isPressed: (action) => inputHandler.isPressed(action, seat),
        consumeAction: (action) => inputHandler.consumeAction(action, seat),
        getJoystick: () => inputHandler.getJoystick(seat),
    };
}
let level = 1;
let currentGameState = GameState.PROMPT_USER;
let selectedDifficulty = Difficulty.MEDIUM; // Default difficulty
let menuSelectionIndex = 0; // Index into the visible main menu rows

// Touch control schemes. Keyboard always works regardless of the choice.
const ControlMode = {
    JOYSTICK: { id: 'joystick', name: 'Drag to Steer' },
    BUTTONS: { id: 'buttons', name: 'Buttons' },
};
let controlMode = ControlMode.JOYSTICK; // Default; the saved choice lives in settings.js
let palette = findPalette('standard');  // Colour palette (js/palette.js), from settings.js

// Device-level settings (js/settings.js; keys spaceAdventure_<name>)
const settings = createSettings();

// Vibration (Android): follows the 'haptics' setting; independent of mute.
const haptics = new Haptics({ enabled: () => settings.get('haptics') });
// Controller rumble mirrors the vibration sites (js/gamepad.js RUMBLE_PATTERNS).
const RUMBLE_FOR_HAPTIC = {
    collect: 'collect', lifeLost: 'death', gameOver: 'death', bossWeakPoint: 'bossHit', bossDefeated: 'bossDefeated',
};
function vibrate(name) {
    try { haptics.play(name); } catch (e) { /* never let haptics break the game */ }
    if (RUMBLE_FOR_HAPTIC[name]) rumble(RUMBLE_FOR_HAPTIC[name]);
}
// Rumble the most recently used controller ('Controller rumble' setting; no-op without one).
const rumbleStats = { calls: 0, last: null };
function rumble(kind) {
    if (!inputHandler || !settings.get('rumble') || !gamepadSeen) return;
    try {
        if (inputHandler.gamepad.rumbleEvent(kind)) {
            rumbleStats.calls++;
            rumbleStats.last = kind;
        }
    } catch (e) { /* never let rumble break the game */ }
}
function stopVibration() {
    try { haptics.stop(); } catch (e) { /* ignore */ }
}

// Background music (js/music.js), routed into the audio manager's music bus.
let music = null;
let musicMood = 'menu';
function withMusic(fn) {
    if (!music) return undefined;
    try { return fn(music); } catch (e) { return undefined; } // audio problems must not escape
}

// Stick steadying (steering.js stabilizeHeading); the heading is kept per player (p.stickHeading).
function stabilizeStick(p, stick) {
    const r = stabilizeHeading(stick, p.stickHeading);
    p.stickHeading = r.heading;
    return r.stick;
}

function findControlMode(id) {
    return Object.values(ControlMode).find(m => m.id === id) || ControlMode.JOYSTICK;
}

// Apply the stored settings at startup and keep the game in sync whenever one changes
// (from the Settings screen, the M key or the mute button).
function applySettings() {
    controlMode = findControlMode(settings.get('controlMode'));
    applyControlModeClass();
    palette = findPalette(settings.get('palette'));
    Asteroid.palette = palette;
}

function applyAudioSettings() {
    if (!audioManager) return;
    try {
        audioManager.setSfxVolume(settings.get('sfxVolume'));
        audioManager.setMusicVolume(settings.get('musicVolume'));
    } catch (e) { /* ignore */ }
    withMusic(m => m.setTune(settings.get('musicTune')));
}

function applyMuted() {
    if (!audioManager) return;
    const muted = !!settings.get('muted');
    if (audioManager.isMuted !== muted) audioManager.toggleMute();
    const muteBtn = document.getElementById('touch-mute-btn');
    if (muteBtn) muteBtn.classList.toggle('muted', audioManager.isMuted);
}

settings.onChange((name) => {
    if (name === 'controlMode' || name === 'palette') applySettings();
    if (name === 'muted') applyMuted();
    if (name === 'musicTune' || name === 'musicVolume' || name === 'sfxVolume') applyAudioSettings();
    if (name === 'haptics') {
        try { haptics.setEnabled(settings.get('haptics')); } catch (e) { /* ignore */ } // tick when switched on
    }
});

// Music row: cycle Off / tunes and play a short preview of the newly picked tune.
function changeMusicTune(dir) {
    const id = settings.cycle('musicTune', dir);
    if (id && id !== 'off') withMusic(m => m.playPreview(id));
}

// --- Row lists (main menu and Settings) ---
// A row is { id, label(), visible?() } plus either
//   select()                      - an action (Enter / tap)
//   change(dir) and value()       - a value; left/right step it, Enter / centre tap steps forward
//   setting: 'name', format(v)    - shorthand for a settings.js value (cycled with settings.cycle)
function rowValue(row) {
    if (row.setting) return row.format ? row.format(settings.get(row.setting)) : String(settings.get(row.setting));
    return row.value ? row.value() : null;
}
function rowChange(row, dir) {
    if (row.setting) settings.cycle(row.setting, dir);
    else if (row.change) row.change(dir);
}
const rowHasValue = (row) => !!(row.setting || row.change);
const visibleRows = (rows) => rows.filter(r => !r.visible || r.visible());

// Keyboard (and tap-triggered) navigation shared by row lists. getIndex/setIndex hold the
// list's selection; the index is stored before a row acts, so actions can change it.
function navigateRows(rows, getIndex, setIndex) {
    const n = rows.length;
    if (n === 0) return;
    let index = getIndex();
    if (index >= n || index < 0) index = 0;
    if (inputHandler.consumeAction('menuUp')) index = (index - 1 + n) % n;
    if (inputHandler.consumeAction('menuDown')) index = (index + 1) % n;
    setIndex(index);
    const row = rows[index];
    const left = inputHandler.consumeAction('menuLeft');
    const right = inputHandler.consumeAction('menuRight');
    const select = inputHandler.consumeAction('menuSelect');
    if (rowHasValue(row)) {
        if (left) rowChange(row, -1);
        if (right) rowChange(row, 1);
        if (select) rowChange(row, 1);
    } else if (select && row.select) {
        row.select();
    }
}

// One tap region per row. On a value row the left part steps back, the rest (centre and
// right) steps forward, applied at once so several quick taps in one frame all count.
function addRowTapRegion(x, y, w, h, row, index, setIndex) {
    addTapRegion(x, y, w, h, (tap) => {
        setIndex(index);
        if (rowHasValue(row) && tap) {
            rowChange(row, tap.x < x + w * 0.35 ? -1 : 1);
        } else {
            inputHandler.triggerAction('menuSelect');
        }
    });
}

function cycleDifficulty(dir) {
    const list = Object.values(Difficulty);
    const i = list.indexOf(selectedDifficulty);
    selectedDifficulty = list[(i + (dir < 0 ? -1 : 1) + list.length) % list.length];
    console.log(`Difficulty set to: ${selectedDifficulty.name}`);
}

function returnToMenu() {
    currentGameState = GameState.MENU;
    menuSelectionIndex = 0;
}

// Main menu rows, top to bottom. Adding a row is one line.
const mainMenuItems = [
    { id: 'start', label: () => (pausedGameExists ? 'Resume' : 'Start'), select: () => startOrResume() },
    { id: 'multiplayer', label: () => 'Multiplayer', select: () => openModeSelect() },
    { id: 'upgrades', label: () => 'Upgrades', select: () => { upgradeMenuIndex = 0; currentGameState = GameState.UPGRADES; } },
    { id: 'highScores', label: () => 'High Scores', select: () => openHighScores() },
    { id: 'achievements', label: () => 'Achievements', select: () => { currentGameState = GameState.ACHIEVEMENTS; } },
    { id: 'help', label: () => 'Help', select: () => { currentGameState = GameState.HELP; } },
    { id: 'settings', label: () => 'Settings', select: () => { settingsIndex = 0; currentGameState = GameState.SETTINGS; } },
    { id: 'reset', label: () => 'Reset Data', select: () => resetUserData() },
    { id: 'changeUser', label: () => 'Change User', select: () => changeUser() },
    { id: 'difficulty', label: () => 'Difficulty', value: () => selectedDifficulty.name, change: (dir) => cycleDifficulty(dir) },
];

// Settings screen rows. Adding a setting is one line here (plus its entry in settings.js).
let settingsIndex = 0;
const settingsRows = [
    { id: 'controls', label: () => 'Controls', setting: 'controlMode', format: (v) => findControlMode(v).name,
        visible: () => isTouchDevice },
    { id: 'colours', label: () => 'Colours', setting: 'palette', format: (v) => findPalette(v).name },
    { id: 'sound', label: () => 'Sound', setting: 'muted', format: (v) => (v ? 'Off' : 'On') },
    { id: 'music', label: () => 'Music', value: () => tuneName(settings.get('musicTune')), change: changeMusicTune },
    { id: 'musicVolume', label: () => 'Music volume', setting: 'musicVolume' },
    { id: 'sfxVolume', label: () => 'Sound effects', setting: 'sfxVolume' },
    { id: 'vibration', label: () => 'Vibration', setting: 'haptics', format: (v) => (v ? 'On' : 'Off'),
        visible: () => isTouchDevice && haptics.supported },
    { id: 'rumble', label: () => 'Controller rumble', setting: 'rumble', format: (v) => (v ? 'On' : 'Off'),
        visible: () => gamepadSeen },
    { id: 'offerTutorial', label: () => 'Offer tutorial', setting: 'offerTutorial', format: (v) => (v ? 'On' : 'Off') },
    { id: 'replayTutorial', label: () => 'Replay tutorial', select: () => replayTutorial() },
    { id: 'back', label: () => 'Back', select: () => returnToMenu() },
];

function startOrResume() {
    if (pausedGameExists) {
        console.log("Resuming paused game...");
        currentGameState = GameState.PLAYING;
    } else if (shouldAskTutorial()) {
        openTutorialAsk();
    } else {
        console.log("Executing startGame() from menu...");
        startGame('solo');
    }
}

// --- Game controllers (js/gamepad.js via InputHandler) ---
let gamepadSeen = false; // a controller has been connected this session (shows the rumble row)
let toasts = []; // short canvas messages: { text, time }
const TOAST_SECONDS = 2;
function showToast(text) {
    toasts.push({ text, time: TOAST_SECONDS });
    if (toasts.length > 3) toasts.shift();
}
function usingGamepad() {
    return !!inputHandler && inputHandler.lastInputSource === 'gamepad';
}
// Glyph for a controller button in the current controller's family (Ⓐ, ✕, …)
const CIRCLED_LETTERS = { A: '\u24B6', B: '\u24B7', X: '\u24CD', Y: '\u24CE' };
function padGlyph(button) {
    const family = (inputHandler && inputHandler.gamepadInfo().family) || 'generic';
    const glyph = buttonGlyph(family, button);
    return CIRCLED_LETTERS[glyph] || glyph;
}
// Hint text for the device in use: controller glyphs once a controller was the last input.
function inputHint(keyboard, touch, gamepad = null) {
    if (gamepad && usingGamepad()) return typeof gamepad === 'function' ? gamepad() : gamepad;
    return isTouchDevice ? touch : keyboard;
}
function inputContextFor(state) {
    if (state === GameState.PLAYING) return 'game';
    // Seat lobby: controllers use their game buttons (Ⓐ fire = join/ready, Ⓑ = leave, ◂ ▸ colour)
    if (state === GameState.LOBBY && lobby && lobby.kind === 'seats') return 'game';
    if (state === GameState.PAUSED) return 'pause';
    return 'menu';
}
// Poll controllers (before taps and keys), then react to connects/disconnects.
function pollControllers() {
    inputHandler.setContext(inputContextFor(currentGameState));
    inputHandler.pollGamepads();
    for (const ev of inputHandler.consumeGamepadEvents()) {
        const name = controllerName(ev.id);
        if (ev.type === 'connected') {
            gamepadSeen = true;
            showToast(ev.mapping === 'standard' ? `${name} connected` : `${name} connected (unknown layout: buttons may differ)`);
        } else {
            showToast(`${name} disconnected`);
            // Losing the controller mid-game would leave the ship uncontrolled: pause
            if (currentGameState === GameState.PLAYING && inputHandler.lastInputSource === 'gamepad') pauseGame();
        }
    }
    syncInputSourceClass();
}
// body.input-gamepad hides the touch controls while a controller is in use (until a touch)
let inputSourceClass = null;
function syncInputSourceClass() {
    const pad = usingGamepad();
    if (pad === inputSourceClass) return;
    inputSourceClass = pad;
    document.body.classList.toggle('input-gamepad', pad);
}
function updateToasts(dt) {
    toasts.forEach(t => { t.time -= dt; });
    toasts = toasts.filter(t => t.time > 0);
}
function drawToasts() {
    if (toasts.length === 0) return;
    ctx.save();
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    toasts.forEach((t, i) => {
        const alpha = Math.min(1, t.time / 0.4);
        const w = Math.min(viewWidth - 20, ctx.measureText(t.text).width + 30);
        const y = viewHeight - 110 - i * 36;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.fillRect((viewWidth - w) / 2, y - 15, w, 30);
        ctx.strokeStyle = '#66CCFF';
        ctx.lineWidth = 1.5;
        ctx.strokeRect((viewWidth - w) / 2, y - 15, w, 30);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(t.text, viewWidth / 2, y);
    });
    ctx.restore();
}
// Controller presses are not user gestures, so a controller-only player must tap or press
// a key once before the browser allows sound.
let userGestureSeen = false;
function audioLocked() {
    const ac = audioManager && audioManager.audioContext;
    return !userGestureSeen && !!ac && ac.state !== 'running';
}

// --- First-game tutorial (js/tutorial.js) ---
const tutorial = new Tutorial();
let tutorialTarget = null; // the asteroid the current step is about
let tutorialPending = []; // requests raised during collisions, handled after them
let tutorialAskIndex = 0; // 0 = Play the tutorial, 1 = Skip
let tutorialFireHeld = false; // fire press edge ('confirm' in the avoid step)
let tutorialRespawns = 0; // crashes during training (no life lost), for the test hook

function tutorialRecord() {
    return currentUser && persistenceManager ? persistenceManager.loadTutorialState(currentUser) : null;
}
// Ask on a player's first Start (unless the 'Offer tutorial' setting is off); either answer
// is remembered for that player. Reset Data brings the question back.
function shouldAskTutorial() {
    if (!settings.get('offerTutorial') || !currentUser) return false;
    const rec = tutorialRecord();
    return !(rec && (rec.asked || rec.done));
}
function openTutorialAsk() {
    tutorialAskIndex = 0;
    currentGameState = GameState.TUTORIAL_ASK;
}
function answerTutorialAsk(play) {
    if (currentUser) {
        persistenceManager.saveTutorialState(currentUser, { asked: true, done: false, skipped: !play, version: TUTORIAL_VERSION });
    }
    startGame('solo', null, { tutorial: play });
}
function replayTutorial() {
    pausedGameExists = false;
    startGame('solo', null, { tutorial: true });
}
function currentInputKind() {
    return detectInputKind({
        lastInputSource: inputHandler ? inputHandler.lastInputSource : null,
        isTouchDevice,
        controlMode: controlMode.id,
    });
}
function queueTutorial(requests) {
    if (requests && requests.length) tutorialPending.push(...requests);
}
function processTutorialRequests(requests = null) {
    const list = requests || tutorialPending.splice(0);
    for (const r of list) {
        switch (r.type) {
            case 'spawn': spawnTutorialTarget(r); break;
            case 'message':
            case 'hint':
                FloatingTexts.spawn(viewWidth / 2, viewHeight * 0.62, r.text, '#FFD700', 22, 2.5);
                break;
            case 'respawnPlayer':
                tutorialRespawns++;
                p1().ship = null;
                respawnPlayer(p1());
                if (p1().ship) p1().ship.makeInvulnerable(r.invulnerableSeconds || 3);
                break;
            case 'finish': finishTutorial(!!r.skipped); break;
            default: break; // 'step': the overlay and DOM classes follow tutorial.stepId
        }
    }
}
// Targets appear in front of the ship: a still green, a slowly drifting red.
function spawnTutorialTarget(req) {
    if (tutorialTarget && tutorialTarget.isAlive) tutorialTarget.destroy();
    const ship = p1().ship;
    const angle = ship ? ship.rotation : -Math.PI / 2;
    const ox = ship ? ship.x : WORLD_WIDTH / 2;
    const oy = ship ? ship.y : WORLD_HEIGHT / 2;
    const size = req.size === 'small' ? Asteroid.Sizes.SMALL : req.size === 'large' ? Asteroid.Sizes.LARGE : Asteroid.Sizes.MEDIUM;
    const drift = req.drift || 0;
    const target = new Asteroid(ox + Math.cos(angle) * req.distanceAhead, oy + Math.sin(angle) * req.distanceAhead,
        size, { x: -Math.sin(angle) * drift, y: Math.cos(angle) * drift }, 1, req.kind === 'green' ? 'green' : 'red');
    wrapWorldPosition(target);
    asteroids.push(target);
    tutorialTarget = target;
}
function tutorialTargetDistance() {
    const ship = p1().ship;
    if (!tutorialTarget || !tutorialTarget.isAlive || !ship) return undefined;
    const { dx, dy } = Entity.wrappedDelta(ship.x, ship.y, tutorialTarget.x, tutorialTarget.y);
    return Math.hypot(dx, dy);
}
// Per frame while training (after collisions)
function updateTutorial(dt) {
    processTutorialRequests();
    if (!tutorial.active) return;
    processTutorialRequests(tutorial.update(dt, { inputKind: currentInputKind(), targetDistance: tutorialTargetDistance() }));
    const step = tutorial.stepId;
    if (tutorial.active && (step === 'collect' || step === 'shoot') && !(tutorialTarget && tutorialTarget.isAlive)) {
        processTutorialRequests(tutorial.notify('targetLost'));
    }
}
function skipTutorial() {
    if (tutorial.active) processTutorialRequests(tutorial.skip());
}
// The one exit from training (finished or skipped): remember it and start a clean Level 1.
function finishTutorial(skipped) {
    if (currentUser) {
        persistenceManager.saveTutorialState(currentUser, { asked: true, done: true, skipped, version: TUTORIAL_VERSION });
    }
    tutorial.reset();
    tutorialPending = [];
    tutorialTarget = null;
    const p = p1();
    p.score = 0;
    level = 1;
    p.lives = startingLivesFor(p.upgrades);
    p.nextExtraLifeScore = EXTRA_LIFE_SCORE;
    bullets = [];
    asteroids = [];
    ufos = [];
    resetPowerUps();
    DynamicDifficulty.reset();
    p.combo.reset();
    FloatingTexts.clear();
    ScreenShake.reset();
    currentBoss = null;
    bossDefeatedThisLevel = false;
    if (p.achievements) p.achievements.resetSessionStats();
    p.ship = null;
    respawnPlayer(p, true);
    createLevelAsteroids();
    resetUfoSpawnTimer();
    levelUpNotificationTimer = LEVEL_UP_NOTIFICATION_DURATION;
    syncTutorialDom();
    updateUI();
    console.log(`Tutorial ${skipped ? 'skipped' : 'completed'}; starting Level 1`);
}
// body.tutorial-step-<id> / body.tutorial-<inputKind> and .tutorial-highlight on the DOM
// control being taught (touch buttons sit outside the canvas on tablets). CSS pulses it.
let tutorialDomKey = '';
function syncTutorialDom() {
    const on = tutorial.active && (currentGameState === GameState.PLAYING || currentGameState === GameState.PAUSED);
    const key = on ? `${tutorial.stepId}|${tutorial.inputKind}` : '';
    if (key === tutorialDomKey) return;
    tutorialDomKey = key;
    const body = document.body;
    [...body.classList].filter(c => c.startsWith('tutorial-')).forEach(c => body.classList.remove(c));
    document.querySelectorAll('.tutorial-highlight').forEach(el => el.classList.remove('tutorial-highlight'));
    if (!on) return;
    body.classList.add('tutorial-active', `tutorial-step-${tutorial.stepId}`, `tutorial-${tutorial.inputKind}`);
    const text = tutorial.text;
    (text ? text.highlight : []).forEach(sel => {
        const el = document.querySelector(sel);
        if (el) el.classList.add('tutorial-highlight');
    });
}
function getPauseMenuOptions() {
    if (isMultiplayer()) return MP_PAUSE_OPTIONS;
    return tutorial.active ? [...pauseMenuOptions, 'Skip Tutorial'] : pauseMenuOptions;
}

// --- Local multiplayer (docs/plans/05-local-multiplayer.md §5, §10, §11) ---
// MENU ─Multiplayer─► MP_MODE_SELECT ─► LOBBY ─► (TURN_CHANGE ⇄) PLAYING ⇄ PAUSED
// PLAYING ─round over─► ROUND_END (2 s slow motion) ─► RESULTS ─► Rematch (LOBBY) / Change mode / Main menu
const MP_MODE_IDS = ['turns']; // playable modes, in the order shown on the mode select screen
const MP_MODE_INFO = {
    turns: ['2 to 4 players pass one device.', 'One ship at a time; the highest score wins.'],
};
const MP_PAUSE_OPTIONS = ['Resume', 'Restart round', 'Change players', 'Main menu'];
const RESULTS_BUTTONS = ['Rematch', 'Change mode', 'Main menu'];
const ROUND_END_SECONDS = 2;
const ROUND_END_SLOWMO = 0.3;      // world speed during the round-end banner
const RESULTS_INPUT_DELAY = 1.5;   // s before the Results screen takes input (a held fire can't skip it)
const RESUME_COUNTDOWN = 3;        // multiplayer resumes after 3, 2, 1
const TURN_HANDOVER_DELAY = 1.2;   // s the explosion plays before "PLAYER N – GET READY"
const TURN_READY_DELAY = 1;        // s before the hand-over screen accepts fire/tap
const LOBBY_EXIT_NOTICE = 2;       // s the "press Esc again" notice stays up

let mpModeIndex = 0;          // mode select row
let lobby = null;             // js/lobby.js lobby: 'seats' (own inputs) or 'count' (pass one device)
let lobbyModeId = 'turns';
let lobbyIndex = 0;           // count lobby row
let lobbyExitNotice = 0;      // seconds left of the "Esc again to leave" notice
let lastLineup = null;        // { modeId, kind, players } of the last round started (rematch)
let turn = null;              // Take Turns: { index, worlds, started, handover, readyDelay, needsWorld }
let roundEndTimer = 0;
let lastResults = null;       // js/mpResults.js record of the last multiplayer round
let resultsIndex = 0;
let resultsInputDelay = 0;
let pausedBy = null;          // seat number, 'system' or null
let pausedFrom = null;        // PLAYING or TURN_CHANGE
let resumeCountdown = 0;      // seconds until play resumes (multiplayer)

function isMultiplayer() { return mode.id !== 'solo'; }
function isTurns() { return mode.kind === 'turns' && !!turn; }
// Ships in play this frame (Take Turns: only the active player's)
function activePlayers() { return isTurns() ? [players[turn.index]] : players; }
// States of a round in progress
function inRound() {
    return [GameState.PLAYING, GameState.PAUSED, GameState.TURN_CHANGE, GameState.ROUND_END].includes(currentGameState);
}
// The player the HUD shows: player 1, or whoever's turn it is
function hudPlayer() { return isTurns() && inRound() ? players[turn.index] : p1(); }
// Several ships share the screen (not single-player, not Take Turns)
function simultaneous() { return players.length > 1 && !isTurns(); }
function seatColour(index) {
    const list = palette.seats;
    return list[((index % list.length) + list.length) % list.length];
}

// Seat routing: seat mode in a 'seats' lobby and in rounds whose players use their own input;
// merged (every input drives seat 0) everywhere else, including Take Turns.
function syncSeatMode() {
    let wantSeats = false;
    if (currentGameState === GameState.LOBBY) wantSeats = !!lobby && lobby.kind === 'seats';
    else if (inRound()) wantSeats = isMultiplayer() && mode.kind !== 'turns';
    if (wantSeats === inputHandler.seats.merged) inputHandler.setMerged(!wantSeats);
}

// --- Mode select ---
function openModeSelect() {
    pausedGameExists = false; // a paused single-player game is abandoned
    mpModeIndex = 0;
    currentGameState = GameState.MP_MODE_SELECT;
}
function mpModeRows() {
    return [
        ...MP_MODE_IDS.map(id => ({ id, label: () => MODES[id].name, select: () => openLobby(id) })),
        { id: 'back', label: () => 'Back', select: () => returnToMenu() },
    ];
}

// --- Lobby ---
function savedLineup() {
    try {
        const parsed = parseLineup(sessionStorage.getItem(LINEUP_KEY));
        if (parsed) return parsed;
    } catch (e) { /* storage unavailable */ }
    return lastLineup;
}
function saveLineup(modeId, kind, lineup) {
    lastLineup = { modeId, kind, players: lineup.map(e => ({ ...e })) };
    try { sessionStorage.setItem(LINEUP_KEY, serializeLineup(modeId, kind, lineup)); } catch (e) { /* ignore */ }
}

// kind: 'seats' (join with own keys/controllers) or 'count' (pass one device). By default a
// tap or click picks 'count' (touch devices), a key or controller press 'seats'.
// lineup: players to restore joined but not ready (rematch, change players).
function openLobby(modeId, { kind = null, lineup = null } = {}) {
    const m = getMode(modeId) || MODES.turns;
    lobbyModeId = m.id;
    const pointer = inputHandler.lastInputSource === 'touch' || inputHandler.lastInputSource === 'mouse';
    const k = kind || (pointer ? 'count' : 'seats');
    const profiles = persistenceManager.getAllUsernames();
    if (k === 'seats') {
        inputHandler.setMerged(false);
        lobby = createSeatLobby({ seats: inputHandler.seats, min: m.players.min, max: m.players.max, currentUser, profiles });
        restoreSeatLineup(lobby, lineup || []);
    } else {
        inputHandler.setMerged(true);
        lobby = createCountLobby({ min: m.players.min, max: m.players.max, currentUser, profiles });
        if (lineup) restoreCountLineup(lobby, lineup);
    }
    lobbyIndex = 0;
    lobbyExitNotice = 0;
    pausedGameExists = false;
    currentGameState = GameState.LOBBY;
}
function reopenLobby() {
    const saved = savedLineup();
    if (saved && saved.modeId && getMode(saved.modeId)) openLobby(saved.modeId, { kind: saved.kind, lineup: saved.players });
    else openModeSelect();
}
function leaveLobby() {
    lobby = null;
    lobbyExitNotice = 0;
    inputHandler.setMerged(true);
    mpModeIndex = Math.max(0, MP_MODE_IDS.indexOf(lobbyModeId));
    currentGameState = GameState.MP_MODE_SELECT;
}
// Escape in a lobby: asks first ("press again") when anyone has joined
function requestLobbyExit() {
    if (lobby && lobby.kind === 'seats' && joinedSeats(lobby).length > 0 && lobbyExitNotice <= 0) {
        lobbyExitNotice = LOBBY_EXIT_NOTICE;
        return;
    }
    leaveLobby();
}
function countLobbyRows() {
    const rows = [
        { id: 'count', label: () => 'Players', value: () => String(lobby.count), change: (d) => changePlayerCount(lobby, d) },
    ];
    for (let i = 0; i < lobby.count; i++) {
        rows.push({ id: `name${i + 1}`, label: () => `Player ${i + 1}`, value: () => lobby.names[i].name,
            change: (d) => cycleCountName(lobby, i, d) });
    }
    rows.push({ id: 'start', label: () => 'Start', select: () => startFromLobby() });
    rows.push({ id: 'seats', label: () => 'Join with keys or controllers', select: () => openLobby(lobbyModeId, { kind: 'seats' }),
        visible: () => !isTouchDevice || gamepadSeen });
    rows.push({ id: 'back', label: () => 'Back', select: () => leaveLobby() });
    return visibleRows(rows);
}
function handleLobbyInput(deltaTime) {
    if (lobbyExitNotice > 0) lobbyExitNotice = Math.max(0, lobbyExitNotice - deltaTime);
    if (lobby.kind === 'count') {
        inputHandler.consumeSourceEvents(); // shared input: rows only
        if (inputHandler.consumeAction('escape')) { leaveLobby(); return; }
        navigateRows(countLobbyRows(), () => lobbyIndex, (i) => { lobbyIndex = i; });
        return;
    }
    // Seat lobby: every input acts for its own card (source events), Esc/Start/P go back
    let back = false;
    for (const ev of inputHandler.consumeSourceEvents()) {
        if (ev.action === 'pause') { if (ev.seat === null) back = true; continue; }
        const r = handleLobbyEvent(lobby, ev);
        if (r && r.type !== 'full') {
            lobbyExitNotice = 0;
            if (audioManager && (r.type === 'joined' || r.type === 'ready')) audioManager.play('collectGreen');
        }
    }
    if (inputHandler.consumeAction('escape') || inputHandler.consumeAction('pause') || back) {
        requestLobbyExit();
        if (currentGameState !== GameState.LOBBY) return;
    }
    if (tickLobby(lobby, deltaTime) === 'start') startFromLobby();
}
// Start the round with the lobby's players (in seat order)
function startFromLobby() {
    if (!lobby) return;
    const m = getMode(lobbyModeId) || MODES.turns;
    const lineup = lobby.kind === 'seats' ? seatLineup(lobby) : countLineup(lobby);
    if (lineup.length < m.players.min) return;
    const kind = lobby.kind;
    saveLineup(m.id, kind, lineup);
    const shared = m.kind === 'turns'; // one set of controls, passed around
    const entries = lineup.map(e => ({
        name: e.name, profile: e.profile, colour: seatColour(e.colour), colourIndex: e.colour,
        bindingId: e.source, ...(shared ? {} : { seat: e.seat }),
    }));
    lobby = null;
    startGame(m.id, { kind, players: entries });
}

// --- Take Turns: one world per player, parked while the others play (plan §4.1) ---
const DDA_FIELDS = Object.keys(DynamicDifficulty).filter(k => typeof DynamicDifficulty[k] !== 'function');
function captureWorld() {
    return {
        level, asteroids, ufos, powerUps, boss: currentBoss, bossDefeatedThisLevel,
        ufoSpawnTimer, powerUpSpawnTimer,
        dda: Object.fromEntries(DDA_FIELDS.map(k => [k, DynamicDifficulty[k]])),
        parkedAt: Date.now(),
    };
}
function clearWorldEffects() {
    bullets = [];
    FloatingTexts.clear();
    Particles.clear();
    ScreenShake.reset();
}
function restoreWorld(w) {
    level = w.level;
    asteroids = w.asteroids;
    ufos = w.ufos;
    powerUps = w.powerUps;
    currentBoss = w.boss;
    bossDefeatedThisLevel = w.bossDefeatedThisLevel;
    ufoSpawnTimer = w.ufoSpawnTimer;
    powerUpSpawnTimer = w.powerUpSpawnTimer;
    Object.assign(DynamicDifficulty, w.dda);
    // The difficulty clock doesn't run while a world is parked
    const away = Date.now() - w.parkedAt;
    DynamicDifficulty.sessionStartTime += away;
    DynamicDifficulty.lastCheckTime += away;
    clearWorldEffects();
}
function freshWorld() {
    level = 1;
    asteroids = [];
    ufos = [];
    powerUps = [];
    currentBoss = null;
    bossDefeatedThisLevel = false;
    powerUpSpawnTimer = currentScaling().powerUpInterval;
    DynamicDifficulty.reset();
    clearWorldEffects();
    createLevelAsteroids();
    resetUfoSpawnTimer();
}
// After a lost life: let the explosion play, then hand over
function beginHandover(nextIndex) {
    turn.handover = { next: nextIndex, timer: TURN_HANDOVER_DELAY };
}
function handOverTurn() {
    const leaving = players[turn.index];
    for (const key of Object.keys(leaving.powerUps)) leaving.powerUps[key] = 0;
    turn.worlds[turn.index] = captureWorld();
    turn.index = turn.handover.next;
    turn.handover = null;
    turn.needsWorld = true;
    turn.readyDelay = TURN_READY_DELAY;
    audioManager.stopThrustSound();
    audioManager.stopUfoHum();
    stopVibration();
    saveAllUpgrades();
    currentGameState = GameState.TURN_CHANGE;
    updateUI();
}
// "GET READY" confirmed: the player's own world comes back and their ship appears
function confirmTurn() {
    const p = players[turn.index];
    if (turn.needsWorld) {
        const w = turn.worlds[turn.index];
        if (w) restoreWorld(w);
        else freshWorld();
        turn.worlds[turn.index] = null;
        turn.needsWorld = false;
    }
    const first = !turn.started.includes(turn.index);
    if (first) turn.started.push(turn.index);
    currentGameState = GameState.PLAYING;
    p.ship = null;
    p.respawnTimer = 0;
    respawnPlayer(p, first); // later turns start with the usual respawn protection
    levelUpNotificationTimer = LEVEL_UP_NOTIFICATION_DURATION;
    updateUI();
}
function handleTurnChangeInput(deltaTime) {
    if (inputHandler.consumeAction('escape') || inputHandler.consumeAction('pause')) {
        pauseGame(inputHandler.pressedBy('pause') ?? inputHandler.pressedBy('escape'));
        return;
    }
    if (turn.readyDelay > 0) {
        turn.readyDelay = Math.max(0, turn.readyDelay - deltaTime);
        inputHandler.clearPending();
        return;
    }
    const fired = inputHandler.consumeSourceEvents().some(e => e.action === 'fire');
    if (inputHandler.consumeAction('menuSelect') || fired) confirmTurn();
}

// --- Round end and results ---
function newAchievementNames(p) {
    if (!p.achievements || !p.achievementsAtStart) return [];
    const defs = Object.values(Achievements);
    return [...p.achievements.unlockedAchievementIds]
        .filter(id => !p.achievementsAtStart.has(id))
        .map(id => (defs.find(a => a.id === id) || { name: id }).name);
}
function finishMultiplayerRound(result) {
    for (const p of players) if (p.ship) p.ship.isThrusting = false;
    audioManager.stopThrustSound();
    audioManager.stopUfoHum();
    stopVibration();
    vibrate('gameOver');
    players.forEach((p, i) => {
        // Take Turns: each player's own world level
        p.level = turn ? (i === turn.index ? level : (turn.worlds[i] ? turn.worlds[i].level : 1)) : level;
        p.newAchievements = newAchievementNames(p);
    });
    lastResults = buildResults({
        mode, result, players, duration: round ? round.elapsed : 0,
        level: turn ? null : level, difficulty: selectedDifficulty.id,
    });
    // Take Turns plays by single-player rules: every profile gets a normal high-score entry
    if (mode.leaderboard === 'highScores') {
        for (const p of players) if (p.profile) checkAndAddHighScore(p.score, p.profile);
    }
    saveAllUpgrades();
    saveMultiplayerRecords(lastResults);
    if (turn) turn.handover = null;
    pausedGameExists = false;
    levelUpNotificationTimer = 0; // the banner owns the centre of the screen
    roundEndTimer = ROUND_END_SECONDS;
    currentGameState = GameState.ROUND_END;
}
// History for every round; boards and rivalries where the mode keeps them (this device only)
function saveMultiplayerRecords(results) {
    try {
        const pm = persistenceManager;
        pm.saveJson(MP_KEYS.history, addHistory(pm.loadJson(MP_KEYS.history, isHistory, []), historyEntry(results)));
        const rows = results.players;
        if (mode.leaderboard === 'coop') {
            const entry = { score: results.teamScore, level: results.level, difficulty: results.difficulty, date: results.date,
                players: rows.map(r => ({ name: r.name, profile: r.profile })) };
            pm.saveJson(MP_KEYS.boardCoop, addToBoard(pm.loadJson(MP_KEYS.boardCoop, isBoard, []), entry));
        } else if (mode.leaderboard === 'harvest' && results.outcome === 'win') {
            const w = rows.find(r => r.winner);
            if (w) {
                const entry = { score: w.score, name: w.name, profile: w.profile, date: results.date };
                pm.saveJson(MP_KEYS.boardHarvest, addToBoard(pm.loadJson(MP_KEYS.boardHarvest, isBoard, []), entry));
            }
        }
        if (mode.kind !== 'coop' && rows.length > 1) {
            const winners = rows.filter(r => r.winner);
            const winner = results.outcome === 'win' && winners.length === 1 ? (winners[0].profile || winners[0].name) : null;
            const rivalry = recordRivalry(pm.loadJson(MP_KEYS.rivalry, isRivalry, {}), mode.id,
                rows.map(r => ({ name: r.name, profile: r.profile })), winner);
            pm.saveJson(MP_KEYS.rivalry, rivalry);
        }
    } catch (e) {
        console.error('Saving multiplayer records failed:', e);
    }
}
function openResults() {
    currentBoss = null;
    resultsIndex = 0;
    resultsInputDelay = RESULTS_INPUT_DELAY;
    currentGameState = GameState.RESULTS;
    updateUI(); // the HUD line shows player 1 again
}
function selectResultsButton(index) {
    switch (RESULTS_BUTTONS[index]) {
        case 'Rematch': reopenLobby(); break;
        case 'Change mode': openModeSelect(); break;
        default: returnToMenu(); break;
    }
}
function handleResultsInput(deltaTime) {
    if (resultsInputDelay > 0) {
        resultsInputDelay = Math.max(0, resultsInputDelay - deltaTime);
        inputHandler.clearPending();
        return;
    }
    const n = RESULTS_BUTTONS.length;
    if (inputHandler.consumeAction('menuLeft') || inputHandler.consumeAction('menuUp')) resultsIndex = (resultsIndex - 1 + n) % n;
    if (inputHandler.consumeAction('menuRight') || inputHandler.consumeAction('menuDown')) resultsIndex = (resultsIndex + 1) % n;
    if (inputHandler.consumeAction('menuSelect')) { selectResultsButton(resultsIndex); return; }
    if (inputHandler.consumeAction('escape')) returnToMenu();
}
// Round-end banner: the world keeps moving in slow motion, nothing collides
function updateRoundEnd(deltaTime) {
    const dt = deltaTime * ROUND_END_SLOWMO;
    asteroids.forEach(a => { a.updateInfinite(dt); wrapWorldPosition(a); });
    bullets.forEach(b => { b.update(dt, viewWidth, viewHeight); wrapWorldPosition(b); });
    bullets = bullets.filter(b => b.isAlive);
    FloatingTexts.update(dt);
    Particles.update(dt);
    ScreenShake.update(dt);
    roundEndTimer -= deltaTime;
    if (roundEndTimer <= 0) openResults();
}

// --- Multiplayer pause ---
// Anyone can resume; in multiplayer play restarts after a 3 s countdown (single-player: at once)
function resumeGame() {
    if (pausedFrom === GameState.TURN_CHANGE) {
        currentGameState = GameState.TURN_CHANGE;
        return;
    }
    currentGameState = GameState.PLAYING;
    resumeCountdown = isMultiplayer() ? RESUME_COUNTDOWN : 0;
}
function pausedByName() {
    if (pausedBy === 'system' || pausedBy === null || pausedBy === undefined) return null;
    if (isTurns()) return players[turn.index].name; // one shared input: whoever is playing
    const p = players.find(q => q.input && q.input.seat === pausedBy);
    return p ? p.name : `P${pausedBy + 1}`;
}
function selectMultiplayerPauseOption(option) {
    switch (option) {
        case 'Resume': resumeGame(); break;
        case 'Restart round':
            saveAllUpgrades();
            startGame(mode.id, lastLobby);
            break;
        case 'Change players':
            saveAllUpgrades();
            reopenLobby();
            break;
        case 'Main menu':
            saveAllUpgrades();
            pausedGameExists = false;
            returnToMenu();
            break;
    }
}
// Every achievement manager in play (signed-in user first, then other profiles)
function achievementManagers() {
    const list = [achievementManager];
    for (const p of players) if (p.achievements && !list.includes(p.achievements)) list.push(p.achievements);
    return list;
}

function openHighScores() {
    // Load combined data when entering the high score screen
    allHighScores = persistenceManager.loadHighScores();
    allAchievements = persistenceManager.loadAchievements();
    currentGameState = GameState.HIGH_SCORES;
}

function resetUserData() {
    if (currentUser && confirm(`Are you sure you want to reset all data for user '${currentUser}'?`)) {
        console.log(`Resetting data for user: ${currentUser}`);
        persistenceManager.resetUserData(currentUser);
        persistenceManager.setCurrentUser(currentUser); // Stay signed in after the reset
        highScores = [];
        achievementManager.loadUserAchievements(currentUser);
        ShipUpgrades.reset();
        alert("User data reset.");
    }
}

function changeUser() {
    ShipUpgrades.save(persistenceManager, currentUser);
    currentGameState = GameState.PROMPT_USER;
    promptInput = "";
    currentUser = null;
    persistenceManager.setCurrentUser(null);
}

function applyControlModeClass() {
    Object.values(ControlMode).forEach(m => {
        document.body.classList.toggle(`controls-${m.id}`, m === controlMode);
    });
}

let upgradeMenuIndex = 0; // For navigating upgrade options
let currentMenuOptions = []; // Will be populated based on state
let ufoSpawnTimer = UFO_SPAWN_BASE_INTERVAL;
let finalScore = 0;
let highScores = []; // Holds scores for the *current* user usually
let allHighScores = []; // Holds combined scores for display
let allAchievements = {}; // Holds map of username -> Set of achievement IDs
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
let viewWidth = 800, viewHeight = 800;   // logical (CSS) pixels: all game code uses these
let renderScale = 1;                     // backing pixels per CSS pixel (capped dpr)
let renderScaleCap = MAX_RENDER_SCALE;   // lowered by the adaptive fallback when frames are slow
let canvasSized = false;
let lastLandscape = false;                // window orientation at the last resize
let backingSize = 0;                     // canvas backing-store width/height in device pixels

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

    // Check all 9 possible wrapped positions (3x3 grid)
    // This ensures entity appears correctly when near world edges
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            const wrappedX = originalX + dx * WORLD_WIDTH;
            const wrappedY = originalY + dy * WORLD_HEIGHT;

            // Check if this wrapped position is visible on screen
            // (in world units; the view spans viewWidth / zoom of them)
            const screenX = wrappedX - camera.x;
            const screenY = wrappedY - camera.y;
            const margin = entity.radius ? entity.radius * 2 : 50;

            if (screenX > -margin && screenX < viewWidth / camera.zoom + margin &&
                screenY > -margin && screenY < viewHeight / camera.zoom + margin) {
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
    const boxX = (viewWidth - boxWidth) / 2;
    const boxY = (viewHeight - boxHeight) / 2 - 50;
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
    ctx.fillText(`LEVEL ${level}`, viewWidth / 2, boxY + 35);

    // Draw "Clear all asteroids!" subtitle
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.font = '16px Arial';
    ctx.fillText('Clear all asteroids to advance!', viewWidth / 2, boxY + 70);

    ctx.restore();
}

// Starfield for parallax background
const STAR_COUNT = 200;
const stars = [];

// Generate stars for the background
function generateStars() {
    stars.length = 0;
    for (let i = 0; i < STAR_COUNT; i++) {
        const brightness = Math.random() * 0.5 + 0.5;
        stars.push({
            x: Math.random() * 10000 - 5000, // Wide range for infinite world
            y: Math.random() * 10000 - 5000,
            size: Math.random() * 2 + 0.5,
            brightness,
            // Brightness bucket for batched drawing (see drawStarfield)
            level: Math.min(STAR_BRIGHTNESS_LEVELS - 1, Math.floor((brightness - 0.5) * 2 * STAR_BRIGHTNESS_LEVELS)),
            layer: Math.random() < 0.7 ? 0.3 : 0.6 // Parallax layer (0.3 = far, 0.6 = near)
        });
    }
}

// Background gradient, cached per resize (resizeCanvas clears it) instead of rebuilt every frame
let backgroundGradient = null;
const STAR_BRIGHTNESS_LEVELS = 6; // Stars are drawn in one path per brightness level

// Draw parallax starfield background
function drawStarfield() {
    // Dark space gradient background (also covers the whole view, so no black fill is needed)
    if (!backgroundGradient) {
        backgroundGradient = ctx.createRadialGradient(
            viewWidth / 2, viewHeight / 2, 0,
            viewWidth / 2, viewHeight / 2, viewWidth
        );
        backgroundGradient.addColorStop(0, '#0A0A20');
        backgroundGradient.addColorStop(1, '#050510');
    }
    ctx.fillStyle = backgroundGradient;
    ctx.fillRect(0, 0, viewWidth, viewHeight);

    // Draw stars with parallax effect using continuous parallax offset
    // This ensures smooth scrolling even when ship/camera wraps.
    // Batched: one path and one fill per brightness level instead of one per star.
    for (let level = 0; level < STAR_BRIGHTNESS_LEVELS; level++) {
        ctx.beginPath();
        let any = false;
        for (let i = 0; i < stars.length; i++) {
            const star = stars[i];
            if (star.level !== level) continue;
            // Apply parallax based on layer using continuous parallax tracking
            const parallaxX = star.x - camera.parallaxX * star.layer;
            const parallaxY = star.y - camera.parallaxY * star.layer;

            // Wrap stars to keep them visible (seamless tiling)
            const screenX = ((parallaxX % viewWidth) + viewWidth) % viewWidth;
            const screenY = ((parallaxY % viewHeight) + viewHeight) % viewHeight;

            ctx.moveTo(screenX + star.size, screenY);
            ctx.arc(screenX, screenY, star.size, 0, Math.PI * 2);
            any = true;
        }
        if (!any) continue;
        ctx.fillStyle = `rgba(255, 255, 255, ${starLevelBrightness(level)})`;
        ctx.fill();
    }
}

function starLevelBrightness(level) {
    return 0.5 + (0.5 * (level + 0.5)) / STAR_BRIGHTNESS_LEVELS;
}

// Draw radar mini-map
function drawRadar() {
    const radarSize = Math.round(Math.max(70, Math.min(120, viewWidth * 0.2))); // Smaller on phones
    const radarX = viewWidth - radarSize - 15;
    const radarY = viewHeight - radarSize - 15;
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
    // Centred on the camera (the ship in single-player); empty while no ship is in play
    const hasShip = players.some(p => p.ship);
    const centre = cameraCentre();
    function worldToRadar(entityX, entityY) {
        if (!hasShip) return null;

        // Calculate relative position to the camera centre
        let relX = entityX - centre.x;
        let relY = entityY - centre.y;

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

    // Every radar marker has its own shape: collectible = filled dot, hazard = x,
    // UFO = diamond, power-up = hollow square
    asteroids.forEach(asteroid => {
        if (!asteroid.isAlive) return;
        const pos = worldToRadar(asteroid.x, asteroid.y);
        if (!pos) return;
        if (asteroid.isGreen()) {
            ctx.fillStyle = palette.collectRadar;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.strokeStyle = palette.hazardRadar;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(pos.x - 3, pos.y - 3);
            ctx.lineTo(pos.x + 3, pos.y + 3);
            ctx.moveTo(pos.x + 3, pos.y - 3);
            ctx.lineTo(pos.x - 3, pos.y + 3);
            ctx.stroke();
        }
    });

    ufos.forEach(ufo => {
        if (!ufo.isAlive) return;
        const pos = worldToRadar(ufo.x, ufo.y);
        if (!pos) return;
        ctx.fillStyle = '#CC66FF'; // purple, like the UFOs
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y - 5);
        ctx.lineTo(pos.x + 4, pos.y);
        ctx.lineTo(pos.x, pos.y + 5);
        ctx.lineTo(pos.x - 4, pos.y);
        ctx.closePath();
        ctx.fill();
    });

    powerUps.forEach(powerUp => {
        if (!powerUp.isAlive) return;
        const pos = worldToRadar(powerUp.x, powerUp.y);
        if (!pos) return;
        ctx.strokeStyle = '#FFFF00';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(pos.x - 3.5, pos.y - 3.5, 7, 7);
    });

    // Single-player: the player at the centre (white triangle). More players: each living
    // ship in its player's colour.
    const markers = players.length === 1
        ? [{ pos: { x: radarCenterX, y: radarCenterY }, colour: '#FFFFFF' }]
        : livingPlayers(players).map(p => ({ pos: worldToRadar(p.ship.x, p.ship.y), colour: p.colour }));
    markers.forEach(({ pos, colour }) => {
        if (!pos) return;
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y - 5);
        ctx.lineTo(pos.x - 4, pos.y + 4);
        ctx.lineTo(pos.x + 4, pos.y + 4);
        ctx.closePath();
        ctx.fill();
    });

    ctx.restore();
}

// Draw a player's active power-up indicators (player 1's in single-player)
function drawActivePowerUps(p = p1()) {
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
        const remaining = p.powerUps[info.key];
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

// Ship settings that follow the player's power-ups (the one place that sets the fire rate)
function applyShipModifiers(p) {
    if (p.ship) p.ship.shootCooldown = p.powerUps.rapid_fire > 0 ? RAPID_FIRE_COOLDOWN : NORMAL_SHOT_COOLDOWN;
}

// Activate a power-up collected by player p (effects are the collector's only)
function activatePowerUp(p, type) {
    console.log(`Activating power-up: ${type.name}`);
    if (type.id === 'extra_life') {
        p.lives++;
        console.log(`Extra life! Lives: ${p.lives}`);
        updateUI();
        if (audioManager) audioManager.play('collectGreen');
        return;
    }
    if (!(type.id in p.powerUps)) return;
    // Power-Up Duration upgrade extends timed effects
    p.powerUps[type.id] = type.duration * p.upgrades.getPowerUpDurationMult();
    if (type.id === 'rapid_fire') applyShipModifiers(p); // Faster shooting
}

// Count down each player's power-ups and undo effects that expire
function tickPlayerPowerUps(p, deltaTime) {
    for (const key of tickPowerUps(p.powerUps, deltaTime)) {
        if (key === 'rapid_fire' && p.ship) {
            applyShipModifiers(p); // Reset to normal cooldown
            console.log('Rapid fire expired');
        }
    }
}

// Reset all power-ups (called when starting new game): pickups in the world and every
// player's active effects
function resetPowerUps() {
    powerUps = [];
    for (const p of players) {
        for (const key of Object.keys(p.powerUps)) p.powerUps[key] = 0;
    }
    powerUpSpawnTimer = currentScaling().powerUpInterval; // POWERUP_SPAWN_INTERVAL in single-player
}

// Magnet: pull green asteroids toward the ship of the player who holds the magnet
function applyMagnet(p, deltaTime) {
    const ship = p.ship;
    if (!(p.powerUps.magnet > 0 && ship && ship.isAlive)) return;
    asteroids.forEach(asteroid => {
        if (asteroid.isAlive && asteroid.type === 'green') {
            // Direction to the ship, shortest way across the wrapping world
            const dx = wrapDelta(ship.x - asteroid.x, WORLD_WIDTH);
            const dy = wrapDelta(ship.y - asteroid.y, WORLD_HEIGHT);
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 20 && dist < 300) { // Attract within range
                const magnetForce = 100 / dist;
                asteroid.velX += (dx / dist) * magnetForce * deltaTime;
                asteroid.velY += (dy / dist) * magnetForce * deltaTime;
            }
        }
    });
}

// A random power-up type among the ones this mode allows (single-player: all of them, one roll)
function randomPowerUpType() {
    const allowed = mode.powerUps.types;
    let type = PowerUp.getRandomType();
    for (let i = 0; i < 20 && !allowed.includes(type.id); i++) type = PowerUp.getRandomType();
    return allowed.includes(type.id) ? type : (Object.values(PowerUpType).find(t => allowed.includes(t.id)) || type);
}

// Spawn a power-up at a position (e.g., from destroyed enemy)
function spawnPowerUpAt(x, y) {
    if (Math.random() < POWERUP_SPAWN_CHANCE) {
        const type = randomPowerUpType();
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
    inputHandler = new InputHandler(canvas, { getLogicalSize: () => ({ width: viewWidth, height: viewHeight }) });
    setupTouchSupport();
    applySettings();
    setupUserPromptForm();
    audioManager = new AudioManager();
    applyMuted(); // Sound setting is remembered between visits
    // The engine is inert until the audio context is unlocked (running) by a user gesture.
    music = audioManager.attachMusic((ctx, dest) => new MusicEngine(ctx, dest));
    applyAudioSettings();
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
        userGestureSeen = true;
        audioManager.resumeContext();
        audioUnlockEvents.forEach(evt => document.removeEventListener(evt, resumeAudio));
    };
    audioUnlockEvents.forEach(evt => document.addEventListener(evt, resumeAudio));

    // Auto-pause when the tab/app is hidden (e.g. tablet home button) and persist credits
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            inputHandler.releaseAll();
            stopVibration();
            if (currentGameState === GameState.PLAYING) pauseGame();
            saveAllUpgrades();
        }
    });
    window.addEventListener('pagehide', () => saveAllUpgrades());

    // Read-only snapshot used by the automated browser tests
    window.__spaceAdventure = {
        get state() { return currentGameState; },
        get user() { return currentUser; },
        get score() { return p1().score; },
        get lives() { return p1().lives; },
        get level() { return level; },
        get menuIndex() { return menuSelectionIndex; },
        get menuOptions() { return currentMenuOptions.map(o => o.label()); },
        get difficulty() { return selectedDifficulty.id; },
        get pauseIndex() { return pauseMenuSelectionIndex; },
        get upgradeIndex() { return upgradeMenuIndex; },
        get isMuted() { return audioManager.isMuted; },
        get isTouchDevice() { return isTouchDevice; },
        get loopErrors() { return loopErrorCount; },
        get controlMode() { return controlMode.id; },
        get settings() { return settings.all(); },
        get settingsIndex() { return settingsIndex; },
        get settingsRows() { return visibleRows(settingsRows).map(r => ({ id: r.id, label: r.label(), value: rowValue(r) })); },
        get palette() { return palette.id; },
        get haptics() {
            return { supported: haptics.supported, enabled: haptics.enabled, calls: haptics.stats.calls,
                stops: haptics.stats.stops, last: haptics.stats.last };
        },
        get musicMood() { return musicMood; },
        get musicTune() { return settings.get('musicTune'); },
        get music() { return music ? music.snapshot() : null; },
        get particles() { return Particles.countByShape(); },
        get joystick() { return inputHandler.getJoystick(); },
        get lastInputSource() { return inputHandler.lastInputSource; },
        get inputContext() { return inputHandler.context; },
        get gamepad() {
            const info = inputHandler.gamepadInfo();
            return { connected: info.connected, id: info.id, family: info.family, mapping: info.mapping,
                count: info.count, seen: gamepadSeen, rumbles: rumbleStats.calls, lastRumble: rumbleStats.last };
        },
        get toasts() { return toasts.map(t => t.text); },
        get audioState() { return audioManager.audioContext ? audioManager.audioContext.state : 'none'; },
        get tutorial() {
            const rec = tutorialRecord();
            return {
                active: tutorial.active, step: tutorial.active ? tutorial.stepId : null, inputKind: tutorial.inputKind,
                done: !!(rec && rec.done), asked: !!(rec && (rec.asked || rec.done)), skipped: !!(rec && rec.skipped),
                progress: tutorial.progress, noProgress: tutorial.noProgress, respawns: tutorialRespawns,
                target: tutorialTarget && tutorialTarget.isAlive
                    ? { x: tutorialTarget.x, y: tutorialTarget.y, type: tutorialTarget.type, radius: tutorialTarget.radius } : null,
                askIndex: tutorialAskIndex,
            };
        },
        get pauseOptions() { return getPauseMenuOptions(); },
        get world() { return { width: WORLD_WIDTH, height: WORLD_HEIGHT }; },
        get view() {
            return {
                width: viewWidth, height: viewHeight, scale: renderScale,
                backingWidth: backingSize, backingHeight: backingSize,
                dpr: window.devicePixelRatio || 1,
                scaleCap: renderScaleCap, downgrades: renderPerf.downgrades, avgFrameMs: renderPerf.lastAvgMs,
            };
        },
        get ship() { return shipSnapshot(p1().ship); },
        // Every player (player 1 first); score, lives and ship above read player 1
        get players() {
            return players.map(p => ({
                id: p.id, slot: p.slot, name: p.name, profile: p.profile, colour: p.colour,
                score: p.score, lives: p.lives, respawnTimer: p.respawnTimer, out: p.out,
                nextExtraLifeScore: p.nextExtraLifeScore,
                combo: { count: p.combo.count, multiplier: p.combo.multiplier },
                powerUps: { ...p.powerUps }, stats: { ...p.stats }, ship: shipSnapshot(p.ship),
                credits: p.upgrades ? p.upgrades.currency : 0, hasAchievements: !!p.achievements,
            }));
        },
        get mode() {
            return {
                id: mode.id, name: mode.name, kind: mode.kind,
                elapsed: round ? round.elapsed : 0, timeLeft: round ? round.timeLeft : null,
                phase: round ? round.phase : null, result: lastRoundResult ? { ...lastRoundResult } : null,
            };
        },
        get bulletsByOwner() {
            const out = {};
            for (const b of bullets) if (b.isPlayerBullet) out[b.ownerId] = (out[b.ownerId] || 0) + 1;
            return out;
        },
        // Shared camera: centre (x, y), top-left of the view (left, top) and zoom
        get camera() { return { x: camera.cx, y: camera.cy, left: camera.x, top: camera.y, zoom: camera.zoom }; },
        // Asteroids in the current world (position, type, radius)
        get asteroids() {
            return asteroids.filter(a => a.isAlive).map(a => ({ x: a.x, y: a.y, velX: a.velX, velY: a.velY, type: a.type, radius: a.radius }));
        },
        get counts() { return { asteroids: asteroids.length, bullets: bullets.length, playerBullets: bullets.filter(b => b.isPlayerBullet).length, ufos: ufos.length, powerUps: powerUps.length }; },
        get tapRegions() { return tapRegions.map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h })); },
        isPressed(action) { return inputHandler.isPressed(action); },
        isPressedSeat(action, seat) { return inputHandler.isPressed(action, seat); },
        // Local multiplayer (read-only copies)
        get mp() {
            return {
                active: isMultiplayer(), modeId: mode.id, pausedBy, pausedFrom, resumeCountdown,
                roundEndTimer: currentGameState === GameState.ROUND_END ? roundEndTimer : 0,
                modeSelect: { index: mpModeIndex, rows: mpModeRows().map(r => r.id) },
                lineup: savedLineup() ? JSON.parse(JSON.stringify(savedLineup())) : null,
            };
        },
        get seats() { return inputHandler.seats.snapshot(); },
        get lobby() { return lobbySnapshot(); },
        get turn() {
            if (!turn) return null;
            return {
                index: turn.index, playerId: players[turn.index] ? players[turn.index].id : null,
                handover: !!turn.handover, readyDelay: turn.readyDelay, started: turn.started.slice(),
                worlds: turn.worlds.map(w => (w ? { level: w.level, asteroids: w.asteroids.length } : null)),
            };
        },
        get results() {
            if (!lastResults) return null;
            return { ...JSON.parse(JSON.stringify(lastResults)), index: resultsIndex, inputDelay: resultsInputDelay,
                buttons: RESULTS_BUTTONS.slice() };
        },
    };

    console.log(`Starting Game Loop in State: ${currentGameState}`);
    gameLoop();
});

// --- Core Game Functions ---

// Read-only copy of a ship for the test hook
function shipSnapshot(ship) {
    return ship ? { x: ship.x, y: ship.y, rotation: ship.rotation, velX: ship.velX, velY: ship.velY,
        isAlive: ship.isAlive, isThrusting: ship.isThrusting, isInvulnerable: !!ship.isInvulnerable,
        ownerId: ship.ownerId } : null;
}

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

// Players for a new round. No lobby: the signed-in user alone (single-player). A lobby is
// { players: [{ name?, profile?, colour?, bindingId?, seat?, input? }] }: player 1 should be the
// signed-in user (shares ShipUpgrades and the achievement manager), other profiles load their
// own, guests (no profile) and modes without own upgrades fly standard ships.
function buildPlayers(lobby) {
    const entries = lobby && Array.isArray(lobby.players) && lobby.players.length
        ? lobby.players.slice(0, mode.players.max)
        : [{ name: currentUser, profile: currentUser }];
    return entries.map((e, slot) => {
        const profile = e.profile || null;
        const own = mode.upgradesApply === 'own' && profile;
        const upgrades = !own ? UpgradeState.zero()
            : profile === currentUser ? ShipUpgrades : loadProfileUpgrades(profile);
        const p = createPlayer({
            slot, name: e.name || profile || `Guest ${slot + 1}`, profile, colour: e.colour,
            bindingId: e.bindingId ?? null, upgrades, lives: startingLivesFor(upgrades),
        });
        p.input = e.input || (Number.isInteger(e.seat) ? seatInput(e.seat) : inputHandler);
        p.achievements = !(mode.earnsAchievements && profile) ? null
            : profile === currentUser ? achievementManager : loadProfileAchievements(profile);
        return p;
    });
}
function loadProfileUpgrades(profile) {
    const u = new UpgradeState();
    u.load(persistenceManager, profile);
    return u;
}
function loadProfileAchievements(profile) {
    const m = new AchievementManager(persistenceManager);
    m.loadUserAchievements(profile);
    return m;
}
// Save credits: the signed-in user's, plus other profiles playing in this round
function saveAllUpgrades() {
    ShipUpgrades.save(persistenceManager, currentUser);
    for (const p of players) {
        if (p.profile && p.profile !== currentUser && p.upgrades !== ShipUpgrades) p.upgrades.save(persistenceManager, p.profile);
    }
}

// Resets game variables for a new play session using selected difficulty.
// modeId: a js/modes.js mode ('solo' = the classic single-player game); lobby: see buildPlayers.
// options.tutorial: start the Training wave (level 0, no asteroids) instead of Level 1
// (single-player only).
function startGame(modeId = 'solo', lobby = null, { tutorial: withTutorial = false } = {}) {
    if (!currentUser) {
        console.error("Cannot start game without a user.");
        currentGameState = GameState.PROMPT_USER;
        return;
    }
    mode = getMode(modeId) || MODES.solo;
    lastLobby = lobby;
    lastRoundResult = null;
    lastResults = null;
    roundEndTimer = 0;
    pausedBy = null;
    pausedFrom = null;
    resumeCountdown = 0;
    // Take Turns: only the active player has a ship; each player's world is parked while the
    // others play (index: whose turn, worlds: parked worlds, started: players who have flown)
    turn = mode.kind === 'turns'
        ? { index: 0, worlds: [], started: [], handover: null, readyDelay: TURN_READY_DELAY, needsWorld: false }
        : null;
    if (mode.id !== 'solo') withTutorial = false;
    console.log(`Starting New Game (User: ${currentUser}, Mode: ${mode.id}, Difficulty: ${selectedDifficulty.name})`);
    // Fresh player records (score 0, extra-life threshold reset); upgrade: extra starting lives
    players = buildPlayers(lobby);
    round = createRound(mode);
    level = 1;
    bullets = [];
    asteroids = [];
    ufos = [];
    resetPowerUps();
    DynamicDifficulty.reset();

    // Reset visual effect systems (each new player starts with an empty combo)
    FloatingTexts.clear();
    Particles.clear();
    ScreenShake.reset();

    // Reset boss state
    currentBoss = null;
    bossDefeatedThisLevel = false;

    // Generate starfield for the world
    generateStars();

    // Initialize camera at center of the world
    camera.reset(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, cameraView());

    // Fresh ships; before creating asteroids (Take Turns: player 1's ship appears after "GET READY")
    if (!turn) for (const p of players) respawnPlayer(p, true);
    tutorial.reset();
    tutorialPending = [];
    tutorialTarget = null;
    tutorialFireHeld = false;
    if (withTutorial) {
        level = 0; // HUD shows "Training"; targets are spawned step by step
        processTutorialRequests(tutorial.start());
    } else {
        createLevelAsteroids();
    }
    resetUfoSpawnTimer();
    audioManager.stopThrustSound();
    audioManager.stopUfoHum();
    currentGameState = turn ? GameState.TURN_CHANGE : GameState.PLAYING;
    updateUI();
    for (const p of players) {
        if (p.achievements) p.achievements.resetSessionStats();
        p.achievementsAtStart = p.achievements ? new Set(p.achievements.unlockedAchievementIds) : null;
    }
    pauseMenuSelectionIndex = 0;
    pausedGameExists = false;

    // Show initial level notification
    levelUpNotificationTimer = withTutorial ? 0 : LEVEL_UP_NOTIFICATION_DURATION;
    syncTutorialDom();
    mode.hooks.onStart(round, players);
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
    } else if (inputHandler.gamepadJustPressed('menuSelect')) {
        // A controller can't type: Ⓐ accepts the typed name, or the default "PLAYER1"
        if (sanitizeUsername(input.value).length < 3) input.value = 'PLAYER1';
        submitUsername();
        return;
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

// by: the seat that paused (a number), 'system' (tab hidden, controller lost) or null (unknown)
function pauseGame(by = 'system') {
    pausedFrom = currentGameState === GameState.TURN_CHANGE ? GameState.TURN_CHANGE : GameState.PLAYING;
    pausedBy = by;
    resumeCountdown = 0;
    currentGameState = GameState.PAUSED;
    pauseMenuSelectionIndex = 0;
    audioManager.stopThrustSound();
    audioManager.stopUfoHum();
    stopVibration();
    saveAllUpgrades();
    console.log("Game Paused");
}

// --- Main Update and Render Loop ---

function resizeCanvas() {
    // Logical (CSS) size: a square of 90% of the smaller window side. Backing store: that
    // times devicePixelRatio (capped), so lines and text are sharp on retina tablets.
    const dpr = window.devicePixelRatio || 1;
    const size = computeCanvasSize(window.innerWidth, window.innerHeight, dpr, renderScaleCap);
    if (canvas.width > 0 && size.css < 50) return; // Ignore transient tiny/zero sizes (would zero the world)
    const cssChanged = size.css !== viewWidth || size.css !== viewHeight || !canvasSized;
    const backingChanged = canvas.width !== size.backing || canvas.height !== size.backing;
    const landscape = window.innerWidth > window.innerHeight;
    const orientationChanged = canvasSized && landscape !== lastLandscape;
    lastLandscape = landscape;

    // A rotation re-lays out the page and can leave a held stick off-screen; make the player
    // put the finger down again. Toolbar collapses and DPR-only changes (zoom, other monitor,
    // adaptive fallback) keep the stick.
    if ((cssChanged || orientationChanged) && inputHandler) inputHandler.releaseJoystick();

    // iOS fires many resize events (e.g. toolbar collapse); resizing clears the canvas, so skip no-ops
    if (!cssChanged && !backingChanged && renderScale === size.scale) return;
    canvasSized = true;

    canvas.style.width = `${size.css}px`;
    canvas.style.height = `${size.css}px`;
    if (backingChanged) {
        canvas.width = size.backing;
        canvas.height = size.backing;
    }
    backingSize = size.backing;
    viewWidth = size.css;
    viewHeight = size.css;
    renderScale = size.scale;
    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
    backgroundGradient = null; // Rebuilt for the new view size on the next frame
    watchDevicePixelRatio();

    if (cssChanged) {
        const oldWorldWidth = WORLD_WIDTH;
        const oldWorldHeight = WORLD_HEIGHT;
        // World dimensions come from the logical size only (identical at any DPR)
        WORLD_WIDTH = viewWidth * WORLD_SCREENS_X;
        WORLD_HEIGHT = viewHeight * WORLD_SCREENS_Y;
        Entity.worldWidth = WORLD_WIDTH;
        Entity.worldHeight = WORLD_HEIGHT;

        // A resize mid-game (e.g. rotating a tablet) changes the world size: scale every
        // entity's position so nothing ends up outside the world.
        if (oldWorldWidth > 0 && oldWorldHeight > 0 &&
            (oldWorldWidth !== WORLD_WIDTH || oldWorldHeight !== WORLD_HEIGHT)) {
            const sx = WORLD_WIDTH / oldWorldWidth;
            const sy = WORLD_HEIGHT / oldWorldHeight;
            const entities = [...players.map(p => p.ship), currentBoss, ...asteroids, ...bullets, ...ufos, ...powerUps];
            entities.forEach(entity => {
                if (!entity) return;
                entity.x *= sx;
                entity.y *= sy;
                wrapWorldPosition(entity);
            });
            // Re-centre on a ship (the next frame re-frames several ships)
            const ship = players.map(p => p.ship).find(Boolean);
            if (ship) camera.reset(ship.x, ship.y, cameraView());
        }
    }

    console.log(`Canvas resized to: ${viewWidth}x${viewHeight} CSS px, backing ${canvas.width}x${canvas.height} (scale ${renderScale.toFixed(3)})`);
    console.log(`World size: ${WORLD_WIDTH}x${WORLD_HEIGHT}`);
}

// Re-run resizeCanvas when devicePixelRatio changes without a resize event (browser zoom,
// moving the window to a monitor with another pixel density).
let dprMediaQuery = null;
function watchDevicePixelRatio() {
    if (typeof window.matchMedia !== 'function') return;
    const dpr = window.devicePixelRatio || 1;
    if (dprMediaQuery && dprMediaQuery.dpr === dpr) return;
    if (dprMediaQuery) dprMediaQuery.mql.removeEventListener?.('change', dprMediaQuery.onChange);
    const mql = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const onChange = () => resizeCanvas();
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else if (mql.addListener) mql.addListener(onChange); // Older Safari
    dprMediaQuery = { dpr, mql, onChange };
}

// Adaptive render-scale fallback: if frames are slow while playing (average over 22 ms for
// 3 s), lower the backing-store cap to 1.5, then 1, for the rest of the session.
const SLOW_FRAME_MS = 22;
const SLOW_FRAME_WINDOW_S = 3;
const RENDER_SCALE_STEPS = [MAX_RENDER_SCALE, 1.5, 1];
const renderPerf = { windowTime: 0, windowFrames: 0, lastAvgMs: 0, downgrades: 0 };
function trackRenderPerformance(rawDeltaTime) {
    if (currentGameState !== GameState.PLAYING || !(rawDeltaTime > 0) || rawDeltaTime > 0.25) {
        // Only measure steady gameplay; a paused tab or long hitch restarts the window
        renderPerf.windowTime = 0;
        renderPerf.windowFrames = 0;
        return;
    }
    renderPerf.windowTime += rawDeltaTime;
    renderPerf.windowFrames++;
    if (renderPerf.windowTime < SLOW_FRAME_WINDOW_S) return;
    const avgMs = (renderPerf.windowTime / renderPerf.windowFrames) * 1000;
    renderPerf.lastAvgMs = avgMs;
    renderPerf.windowTime = 0;
    renderPerf.windowFrames = 0;
    if (avgMs <= SLOW_FRAME_MS || renderScale <= 1) return;
    lowerRenderScaleCap();
}

function lowerRenderScaleCap() {
    const next = RENDER_SCALE_STEPS.find(step => step < renderScale - 1e-9);
    if (next === undefined) return false;
    renderScaleCap = next;
    renderPerf.downgrades++;
    console.log(`[render] Frames are slow, lowering render scale cap to ${renderScaleCap}`);
    resizeCanvas();
    return true;
}

function updateUI() {
    const scoreElement = document.getElementById('score');
    const livesElement = document.getElementById('lives');
    const levelElement = document.getElementById('level');
    const creditsElement = document.getElementById('credits');
    const userElement = document.getElementById('user-display'); // Get user display element

    const hp = hudPlayer(); // player 1, or whoever's turn it is (Take Turns)
    if (scoreElement) scoreElement.textContent = `Score: ${hp.score}`;
    if (livesElement) livesElement.textContent = `Lives: ${hp.lives}`;
    if (levelElement) levelElement.textContent = `Level: ${tutorial.active ? 'Training' : level}`;
    const credits = hp !== p1() && hp.upgrades ? hp.upgrades.currency : ShipUpgrades.currency;
    if (creditsElement) creditsElement.textContent = `Credits: ${credits}`;
    // Update user display, show placeholder if no user
    if (userElement) {
        userElement.textContent = `User: ${hp !== p1() ? hp.name : (currentUser || '---')}`;
        userElement.style.display = (currentGameState === GameState.PROMPT_USER) ? 'none' : 'block'; // Hide in prompt state
    }
}

// Clickable/tappable screen regions, rebuilt every frame by the render functions
let tapRegions = [];
function addTapRegion(x, y, w, h, onTap) {
    tapRegions.push({ x, y, w, h, onTap });
}
function addFullScreenTap(onTap) {
    addTapRegion(0, 0, viewWidth, viewHeight, onTap);
}
// Route a canvas tap to the topmost region under it
function processTaps() {
    let tap;
    while ((tap = inputHandler.consumeTap())) {
        for (let i = tapRegions.length - 1; i >= 0; i--) {
            const r = tapRegions[i];
            if (tap.x >= r.x && tap.x <= r.x + r.w && tap.y >= r.y && tap.y <= r.y + r.h) {
                r.onTap(tap);
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
    if (inputHandler) syncSeatMode();
    if (currentGameState === lastInputState) return;
    inputHandler.clearPending();
    if (currentGameState === GameState.PLAYING || lastInputState === GameState.PLAYING) {
        inputHandler.releaseAll();
    }
    lastInputState = currentGameState;
    syncDomToState();
}

// One player's ship controls for this frame: rotate, thrust (keys or stick), fire, hyperspace.
// p.input is the player's input (the shared InputHandler in single-player).
function handleShipInput(p, deltaTime) {
    const input = p.input || inputHandler;
    const ship = p.ship;
    if (!currentUser || !ship || !ship.isAlive) {
        input.consumeAction('hyperspace'); // Don't queue a jump while dead
        return;
    }
    const turnTime = deltaTime * p.upgrades.getTurnSpeedMult();
    const rotationBefore = ship.rotation;
    if (input.isPressed('rotateLeft')) ship.rotate(-1, turnTime);
    if (input.isPressed('rotateRight')) ship.rotate(1, turnTime);
    const speedBoost = p.powerUps.speed_boost > 0 ? SPEED_BOOST_MULT : 1;
    const thrustScale = p.upgrades.getThrustMult() * speedBoost;
    const stickThrust = applyJoystickSteering(ship, stabilizeStick(p, input.getJoystick()), deltaTime, turnTime, thrustScale);
    if (input.isPressed('thrust')) ship.thrust(deltaTime * thrustScale);
    else if (!stickThrust) ship.isThrusting = false;

    if (tutorial.active) {
        const turned = angleDiff(rotationBefore, ship.rotation);
        if (turned !== 0) queueTutorial(tutorial.notify('rotated', { delta: turned }));
        if (ship.isThrusting) queueTutorial(tutorial.notify('thrusted', { dt: deltaTime }));
        const fireHeld = input.isPressed('fire');
        if (fireHeld && !tutorialFireHeld) queueTutorial(tutorial.notify('confirm'));
        tutorialFireHeld = fireHeld;
    }

    if (input.isPressed('fire')) {
        const bulletCountBefore = bullets.length;
        ship.fire(bullets, audioManager);
        // Track shots fired for DDA
        if (bullets.length > bulletCountBefore) {
            DynamicDifficulty.trackShotFired();
            p.stats.shots++;
        }

        // Triple shot: add 2 more bullets at angles if power-up active and we fired
        if (p.powerUps.triple_shot > 0 && bullets.length > bulletCountBefore) {
            const spreadAngle = 0.25; // radians (~15 degrees)
            const bulletSpeed = Bullet.PLAYER_SPEED;
            const noseX = ship.x + Math.cos(ship.rotation) * ship.radius;
            const noseY = ship.y + Math.sin(ship.rotation) * ship.radius;
            for (const angle of [ship.rotation - spreadAngle, ship.rotation + spreadAngle]) {
                bullets.push(new Bullet(noseX, noseY, Math.cos(angle) * bulletSpeed, Math.sin(angle) * bulletSpeed, true,
                    ship.ownerId, ship.bulletColour));
            }
        }
    }

    if (input.consumeAction('hyperspace')) {
        const jumped = ship.hyperspace(WORLD_WIDTH, WORLD_HEIGHT, asteroids, ufos, audioManager);
        if (jumped && !ship.isAlive) {
            handlePlayerDeath(p, true); // May set p.ship = null (respawn pending); vibrates
            return;
        }
        if (jumped) vibrate('hyperspace');
    }
}

function handleInput(deltaTime) {
    syncStateTransition(); // Catches changes made outside the loop (e.g. auto-pause)
    pollControllers(); // may pause (controller disconnected mid-game)
    syncStateTransition();
    processTaps();

    if (currentGameState === GameState.PROMPT_USER) {
         handlePromptInput();
         return;
    }

    switch (currentGameState) {
        case GameState.MENU:
            currentMenuOptions = visibleRows(mainMenuItems);
            navigateRows(currentMenuOptions, () => menuSelectionIndex, (i) => { menuSelectionIndex = i; });
            break;

        case GameState.TUTORIAL_ASK:
            if (inputHandler.consumeAction('escape')) {
                answerTutorialAsk(false);
                break;
            }
            if (inputHandler.consumeAction('menuUp') || inputHandler.consumeAction('menuLeft') ||
                inputHandler.consumeAction('menuDown') || inputHandler.consumeAction('menuRight')) {
                tutorialAskIndex = 1 - tutorialAskIndex;
            }
            if (inputHandler.consumeAction('menuSelect')) answerTutorialAsk(tutorialAskIndex === 0);
            break;

        case GameState.SETTINGS:
            if (inputHandler.consumeAction('escape')) {
                returnToMenu();
                break;
            }
            navigateRows(visibleRows(settingsRows), () => settingsIndex, (i) => { settingsIndex = i; });
            break;

        case GameState.MP_MODE_SELECT:
            if (inputHandler.consumeAction('escape')) {
                returnToMenu();
                break;
            }
            navigateRows(mpModeRows(), () => mpModeIndex, (i) => { mpModeIndex = i; });
            break;

        case GameState.LOBBY:
            if (lobby) handleLobbyInput(deltaTime);
            else leaveLobby();
            break;

        case GameState.TURN_CHANGE:
            if (turn) handleTurnChangeInput(deltaTime);
            break;

        case GameState.ROUND_END:
            inputHandler.clearPending(); // the banner can't be skipped
            break;

        case GameState.RESULTS:
            handleResultsInput(deltaTime);
            break;

        case GameState.PLAYING: {
            const pausePressed = inputHandler.consumeAction('pause');
            if (pausePressed || inputHandler.consumeAction('escape')) {
                pauseGame(inputHandler.pressedBy(pausePressed ? 'pause' : 'escape'));
                break;
            }
            if (resumeCountdown > 0) break; // multiplayer resume: 3, 2, 1
            // Training: Enter or controller View skips it
            const skipByEnter = inputHandler.consumeAction('enter');
            const skipByPad = inputHandler.consumeAction('skipTutorial');
            if ((skipByEnter || skipByPad) && tutorial.active) {
                skipTutorial();
                break;
            }
            for (const p of activePlayers()) {
                handleShipInput(p, deltaTime);
                if (currentGameState !== GameState.PLAYING) break; // the last life was lost
            }
            // One thrust loop, on while any ship thrusts
            const thrusting = players.some(p => p.ship && p.ship.isAlive && p.ship.isThrusting);
            if (thrusting && currentGameState === GameState.PLAYING && !audioManager.isMuted) audioManager.startThrustSound();
            else audioManager.stopThrustSound();
            break;
        }
        case GameState.PAUSED: {
            const pauseOptions = getPauseMenuOptions();
            if (pauseMenuSelectionIndex >= pauseOptions.length) pauseMenuSelectionIndex = 0;
            if (inputHandler.consumeAction('pause') || inputHandler.consumeAction('escape')) {
                console.log("Consumed pause/escape (resume)");
                resumeGame(); // anyone resumes; multiplayer counts down first
                break; // Exit switch after resuming
            }

            if (inputHandler.consumeAction('menuUp')) {
                pauseMenuSelectionIndex = (pauseMenuSelectionIndex - 1 + pauseOptions.length) % pauseOptions.length;
            }
            if (inputHandler.consumeAction('menuDown')) {
                pauseMenuSelectionIndex = (pauseMenuSelectionIndex + 1) % pauseOptions.length;
            }

            if (inputHandler.consumeAction('menuSelect')) {
                const selection = pauseOptions[pauseMenuSelectionIndex];
                console.log(`Pause menu selection: ${selection}`);
                if (isMultiplayer()) {
                    selectMultiplayerPauseOption(selection);
                    break;
                }
                switch (selection) {
                    case 'Resume':
                        resumeGame();
                        console.log("Game Resumed");
                        break;
                    case 'Restart':
                        saveAllUpgrades();
                        startGame(mode.id, lastLobby, { tutorial: tutorial.active }); // keeps the current mode
                        break;
                    case 'Main Menu':
                        currentGameState = GameState.MENU;
                        menuSelectionIndex = 0;
                        pausedGameExists = true; // Set the flag when returning to menu from pause
                        break;
                    case 'Skip Tutorial':
                        skipTutorial();
                        currentGameState = GameState.PLAYING;
                        break;
                }
            }
            break;
        }

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
                            FloatingTexts.spawn(viewWidth / 2, viewHeight / 2,
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
            if (inputHandler.consumeAction('key_T') || inputHandler.consumeAction('replayTutorial')) {
                replayTutorial();
                break;
            }
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
        settings.set('muted', !audioManager.isMuted); // persisted; the listener applies it
        applyMuted();
    }
}

// Move one player's ship (not while dead or waiting to respawn) and wrap it in the world.
function updateShip(p, deltaTime) {
    const ship = p.ship;
    if (!ship || !ship.isAlive || p.respawnTimer > 0) return;
    ship.update(deltaTime, viewWidth, viewHeight, audioManager);
    wrapWorldPosition(ship);
}

// Ships the camera follows: living ships that are not waiting to respawn
function cameraTargets() {
    return players.filter(p => p.ship && p.ship.isAlive && p.respawnTimer <= 0).map(p => p.ship);
}

// The camera follows the living ships (holds its position while there are none)
function updateCamera(deltaTime) {
    camera.update(cameraTargets(), deltaTime, cameraView());
}

function updateGame(deltaTime) {
    updateToasts(deltaTime);
    handleInput(deltaTime);
    syncStateTransition();
    syncTutorialDom();
    inputHandler.endFrame();
    if (currentGameState !== GameState.MENU && currentGameState !== GameState.PROMPT_USER) {
        for (const m of achievementManagers()) m.updateNotifications(deltaTime);
    }
    if (currentGameState === GameState.ROUND_END) {
        updateRoundEnd(deltaTime);
        return;
    }
    if (currentGameState !== GameState.PLAYING) {
        return;
    }
    if (resumeCountdown > 0) {
        // Multiplayer resume: the world waits for 3, 2, 1
        resumeCountdown = Math.max(0, resumeCountdown - deltaTime);
        return;
    }

    // --- Game Playing Logic ---

    for (const p of activePlayers()) {
        if (p.respawnTimer > 0) {
            p.respawnTimer -= deltaTime;
            if (p.respawnTimer <= 0 && p.lives > 0 && currentGameState !== GameState.GAME_OVER) {
                console.log("Respawn timer finished, attempting respawn...");
                respawnPlayer(p);
            }
        }
    }

    if (currentGameState === GameState.GAME_OVER) {
        return; // No updates if game is over
    }

    for (const p of activePlayers()) updateShip(p, deltaTime);
    updateCamera(deltaTime);

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
        bullet.update(deltaTime, viewWidth, viewHeight);
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
             ufo.update(deltaTime, viewWidth, viewHeight, nearestLivingShip(ufo.x, ufo.y, players, WORLD_WIDTH, WORLD_HEIGHT), bullets, audioManager, effectiveDifficulty, asteroids,
                 camera.cx - viewWidth / 2, camera.cy - viewHeight / 2);
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
        powerUp.update(deltaTime, viewWidth, viewHeight);
    });
    powerUps = powerUps.filter(p => p.isAlive);

    // Update active power-up timers (per player)
    for (const p of activePlayers()) tickPlayerPowerUps(p, deltaTime);

    // Spawn random power-ups periodically (DDA modifier affects spawn rate; none in training)
    if (!tutorial.active) powerUpSpawnTimer -= deltaTime;
    if (powerUpSpawnTimer <= 0) {
        const newPowerUp = PowerUp.spawnRandom(WORLD_WIDTH, WORLD_HEIGHT);
        newPowerUp.type = randomPowerUpType();
        powerUps.push(newPowerUp);
        // Apply DDA modifier: lower mod = faster spawns (helps struggling players)
        powerUpSpawnTimer = currentScaling().powerUpInterval * (mode.ddaEnabled ? DynamicDifficulty.powerUpSpawnMod : 1);
        console.log(`Spawned random power-up: ${newPowerUp.type.name}`);
    }

    // Magnet effect - attract green asteroids toward the magnet holder's ship
    for (const p of activePlayers()) applyMagnet(p, deltaTime);

    checkCollisions();

    bullets = bullets.filter(bullet => bullet.isAlive);
    asteroids = asteroids.filter(asteroid => asteroid.isAlive);
    ufos = ufos.filter(ufo => ufo.isAlive);

    if (tutorial.active) {
        // Training: no UFOs, level-ups, achievements or difficulty changes; the tutorial
        // spawns its own targets and may finish into Level 1 here.
        updateTutorial(deltaTime);
    } else {
        updateUfoSpawning(deltaTime);

        // Level up when all asteroids are cleared and boss is defeated (if present)
        const bossCleared = !currentBoss || !currentBoss.isAlive;
        if (mode.levelProgression && asteroids.length === 0 && ufos.length === 0 && bossCleared &&
            players.some(p => p.respawnTimer <= 0 && p.ship && p.ship.isAlive)) {
            levelUp();
        }

        for (const p of activePlayers()) checkPlayerAchievements(p);

        // Evaluate performance (team-wide; Take Turns: the active player's world) and adjust difficulty
        if (mode.ddaEnabled) DynamicDifficulty.evaluate(teamScore(activePlayers()));

        // Round timer and the mode's end conditions
        updateRound(deltaTime);
    }

    // Update visual effects systems
    for (const p of activePlayers()) showComboLost(p, p.combo.update(deltaTime));
    FloatingTexts.update(deltaTime);
    Particles.update(deltaTime);
    ScreenShake.update(deltaTime);

    // Update boss if present
    if (currentBoss && currentBoss.isAlive) {
        currentBoss.update(deltaTime, viewWidth, viewHeight, bossTarget(), bullets, audioManager);
        // Only wrap position during fighting phase (not during entry animation)
        if (currentBoss.phase === Boss.PHASES.FIGHTING) {
            wrapWorldPosition(currentBoss);
        }
    }

    // Take Turns: after a lost life the next player takes over once the explosion has played
    if (turn && turn.handover && currentGameState === GameState.PLAYING) {
        turn.handover.timer -= deltaTime;
        if (turn.handover.timer <= 0) handOverTurn();
    }

    updateUI();
}

// Combo count, multiplier and timer bar for one player (screen space, top centre)
function drawComboIndicator(p) {
    const combo = p.combo;
    if (combo.count < 2) return;
    ctx.textAlign = 'center';
    const comboAlpha = Math.min(1, combo.timer / combo.maxTime + 0.3);
    ctx.globalAlpha = comboAlpha;

    // Combo count and multiplier
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 24px Arial';
    ctx.fillText(`${combo.count}x COMBO`, viewWidth / 2, 80);

    // Multiplier indicator
    if (combo.multiplier > 1) {
        ctx.fillStyle = '#FF6600';
        ctx.font = 'bold 18px Arial';
        ctx.fillText(`${combo.multiplier}x SCORE`, viewWidth / 2, 105);
    }

    // Timer bar
    const timerWidth = 100 * (combo.timer / combo.maxTime);
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(viewWidth / 2 - 50, 115, timerWidth, 4);
    ctx.globalAlpha = 1;
}

// World-to-canvas transform for game objects: shake offset, zoom, then the camera position.
// At zoom 1 this is the old translate(-camera.x + shake, -camera.y + shake).
function applyCameraTransform(shakeX, shakeY) {
    if (camera.zoom === 1) {
        ctx.translate(-camera.x + shakeX, -camera.y + shakeY);
    } else {
        ctx.translate(shakeX, shakeY);
        ctx.scale(camera.zoom, camera.zoom);
        ctx.translate(-camera.x, -camera.y);
    }
}

// Canvas position of a ship, the short way round the world from the camera centre
function shipScreenPos(ship) {
    return {
        x: viewWidth / 2 + wrapDelta(ship.x - camera.cx, WORLD_WIDTH) * camera.zoom,
        y: viewHeight / 2 + wrapDelta(ship.y - camera.cy, WORLD_HEIGHT) * camera.zoom,
    };
}

// Every living ship that is not waiting to respawn (camera transform already applied)
function drawShips() {
    for (const p of players) {
        if (p.ship && p.ship.isAlive && p.respawnTimer <= 0) drawEntityWrapped(p.ship, ctx);
    }
}

// Shield ring around each shielded ship (screen space)
function drawShields() {
    for (const p of players) {
        const ship = p.ship;
        if (!(ship && ship.isAlive && p.powerUps.shield > 0)) continue;
        const screenPos = shipScreenPos(ship);
        ctx.strokeStyle = '#00FFFF';
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.5 + Math.sin(Date.now() / 100) * 0.3;
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, ship.radius + 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }
}

function renderGame() {
    // Logical-pixel transform every frame (also recovers from any unbalanced save/restore);
    // the camera translate composes on top of it.
    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
    // The starfield's gradient covers the whole view while playing/paused
    if (currentGameState !== GameState.PLAYING && currentGameState !== GameState.PAUSED &&
        currentGameState !== GameState.ROUND_END) {
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, viewWidth, viewHeight);
    }
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
            ctx.fillText("SPACE ADVENTURE", viewWidth / 2, viewHeight / 6);

            // Game description: a live icon before each line; shape words carry the meaning
            drawIconLine('green', `Collect smooth ${palette.collectWord} crystals for points!`, viewWidth / 2, viewHeight / 6 + 35, palette.collect);
            drawIconLine('red', `Avoid spiky ${palette.hazardWord} rocks - shoot them!`, viewWidth / 2, viewHeight / 6 + 58, palette.hazard);
            ctx.textAlign = 'center';

            ctx.font = '20px Arial';
            currentMenuOptions = visibleRows(mainMenuItems);

            // Fit all items between the description and the player/credits footer
            const menuStartY = viewHeight * 0.38;
            const menuLineHeight = Math.min(30, (viewHeight - 75 - menuStartY) / currentMenuOptions.length);

            // Adjust index bounds safely before rendering
            if (menuSelectionIndex >= currentMenuOptions.length) {
                menuSelectionIndex = 0;
            }

            currentMenuOptions.forEach((row, index) => {
                const isSelected = index === menuSelectionIndex;
                const itemY = menuStartY + index * menuLineHeight;
                ctx.fillStyle = isSelected ? 'yellow' : 'white';
                if (rowHasValue(row)) {
                    // "Difficulty: Medium" between arrows that show the row can be stepped
                    ctx.fillText(`${row.label()}: ${rowValue(row)}`, viewWidth / 2, itemY);
                    ctx.fillText('\u25C2', viewWidth * 0.27, itemY);
                    ctx.fillText('\u25B8', viewWidth * 0.73, itemY);
                } else {
                    ctx.fillText(row.label(), viewWidth / 2, itemY);
                }
                // Tapping an item highlights and selects it (value rows: left/right part steps)
                addRowTapRegion(viewWidth * 0.2, itemY - menuLineHeight * 0.7, viewWidth * 0.6, menuLineHeight,
                    row, index, (i) => { menuSelectionIndex = i; });
            });

            // Show current user and credits at bottom
            ctx.font = '16px Arial';
            ctx.fillStyle = '#888888';
            ctx.fillText(`Player: ${currentUser || 'None'}`, viewWidth / 2, viewHeight - 50);
            ctx.fillStyle = '#FFD700';
            ctx.font = 'bold 18px Arial';
            ctx.fillText(`Upgrade Credits: ${ShipUpgrades.currency}`, viewWidth / 2, viewHeight - 25);
            if (usingGamepad()) {
                ctx.font = '13px Arial';
                ctx.fillStyle = '#AAAAAA';
                ctx.fillText(`${padGlyph(GP.A)} Select   ${padGlyph(GP.B)} Back   \u25C2 \u25B8 Change`, viewWidth / 2, viewHeight - 6);
                if (audioLocked()) {
                    ctx.font = '15px Arial';
                    ctx.fillStyle = '#FFD700';
                    ctx.fillText('Tap or press a key to enable sound', viewWidth / 2, menuStartY - 32);
                }
            }
            break;

        case GameState.TUTORIAL_ASK:
            drawTutorialAsk();
            break;

        case GameState.PLAYING:
        case GameState.ROUND_END:
            // Draw starfield background (parallax effect)
            drawStarfield();

            // Apply camera transformation for game objects (with screen shake)
            ctx.save();
            applyCameraTransform(ScreenShake.offsetX, ScreenShake.offsetY);

            // Draw all entities with wrapping support for seamless scrolling
            drawShips();
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

            // Draw shield effect around ships if active (in screen space)
            drawShields();

            // Draw level up notification (screen-space, not world-space)
            drawLevelUpNotification();

            // Draw HUD elements (screen-space)
            drawRadar();
            drawActivePowerUps(hudPlayer());

            // Draw remaining asteroids count
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.font = '14px Arial';
            ctx.textAlign = 'left';
            ctx.fillText(`Asteroids: ${asteroids.length}`, 10, viewHeight - 10);

            // Draw Dynamic Difficulty Adjustment indicator (not during training)
            if (!tutorial.active && mode.ddaEnabled) {
                ctx.fillStyle = DynamicDifficulty.getAdjustmentColor();
                ctx.font = '12px Arial';
                ctx.textAlign = 'left';
                ctx.fillText(`Difficulty: ${DynamicDifficulty.getAdjustmentText()}`, 130, viewHeight - 10);
            }

            // Draw combo indicator (player 1's in single-player)
            drawComboIndicator(hudPlayer());

            // Draw floating texts (screen-space)
            FloatingTexts.draw(ctx);

            if (tutorial.active) drawTutorialOverlay();

            // Draw boss warning if boss is entering (limited time)
            if (currentBoss && currentBoss.isAlive && currentBoss.shouldShowWarning()) {
                ctx.fillStyle = '#FF0000';
                ctx.font = 'bold 36px Arial';
                ctx.textAlign = 'center';
                ctx.globalAlpha = 0.5 + Math.sin(Date.now() / 200) * 0.5;
                ctx.fillText('WARNING: BOSS APPROACHING!', viewWidth / 2, viewHeight / 2);
                ctx.globalAlpha = 1;
            }

            drawMultiplayerOverlay(); // whose turn, resume countdown, round-end banner
            break;

        case GameState.MP_MODE_SELECT:
            drawModeSelect();
            break;

        case GameState.LOBBY:
            if (lobby && lobby.kind === 'seats') drawSeatLobby();
            else if (lobby) drawCountLobby();
            break;

        case GameState.TURN_CHANGE:
            drawTurnChange();
            break;

        case GameState.RESULTS:
            drawResults();
            break;

        case GameState.PAUSED:
            // Draw starfield background
            drawStarfield();

            ctx.globalAlpha = 0.5;
            // Apply camera transformation for game objects
            ctx.save();
            applyCameraTransform(0, 0);

            // Draw all entities with wrapping support
            drawShips();
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

        case GameState.SETTINGS:
            drawSettingsScreen();
            break;

        case GameState.HELP:
            drawHelpScreen();
            addFullScreenTap(() => inputHandler.triggerAction('menuSelect'));
            // Registered after the full-screen region: taps are checked last-to-first
            drawHelpReplayButton();
            break;

        case GameState.GAME_OVER:
            drawCenterText("GAME OVER", `Final Score: ${finalScore}`);
            ctx.font = '20px Arial';
            ctx.fillText(inputHint("Press Space or Enter for Menu", "Tap for Menu", () => `Press ${padGlyph(GP.A)} for Menu`),
                viewWidth / 2, viewHeight / 2 + 60);
            addFullScreenTap(() => inputHandler.triggerAction('menuSelect'));
            break;
        default:
             console.error(`[renderGame] Encountered unknown game state: ${currentGameState}`);
             break;
    }

    if (currentGameState === GameState.PLAYING || currentGameState === GameState.PAUSED) {
        drawAchievementNotifications();
    }
    drawToasts();
}

// Wrap text into lines no wider than maxWidth (current ctx.font)
function wrapText(text, maxWidth) {
    const words = String(text).split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(next).width > maxWidth) {
            lines.push(line);
            line = word;
        } else {
            line = next;
        }
    }
    if (line) lines.push(line);
    return lines;
}

function drawButtonBox(x, y, w, h, label, selected, font = 'bold 20px Arial') {
    ctx.fillStyle = selected ? 'rgba(255, 255, 0, 0.25)' : 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = selected ? '#FFFF00' : 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = selected ? '#FFFF00' : '#FFFFFF';
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2);
    ctx.textBaseline = 'alphabetic';
}

// "First time? Play the tutorial / Skip" (tap, Enter/Esc, or controller Ⓐ/Ⓑ)
function drawTutorialAsk() {
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.font = '40px Arial';
    ctx.fillText('SPACE ADVENTURE', viewWidth / 2, viewHeight / 6);

    const w = Math.min(460, viewWidth - 40);
    const h = 270;
    const x = (viewWidth - w) / 2;
    const y = Math.max(viewHeight / 6 + 30, (viewHeight - h) / 2);
    ctx.fillStyle = 'rgba(0, 20, 40, 0.9)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#66CCFF';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 30px Arial';
    ctx.fillText('First time?', viewWidth / 2, y + 45);
    ctx.font = '16px Arial';
    ctx.fillStyle = '#CCCCCC';
    ctx.fillText('A short training flight shows you how to play.', viewWidth / 2, y + 75);

    const bw = w - 60;
    const bh = 50;
    const labels = ['Play the tutorial', 'Skip'];
    labels.forEach((label, i) => {
        const by = y + 100 + i * (bh + 12);
        drawButtonBox(x + 30, by, bw, bh, label, i === tutorialAskIndex);
        addTapRegion(x + 30, by, bw, bh, () => {
            tutorialAskIndex = i;
            inputHandler.triggerAction('menuSelect');
        });
    });

    ctx.textAlign = 'center';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#888888';
    ctx.fillText(inputHint('UP/DOWN to choose, ENTER to confirm, ESC to skip', 'Tap an option',
        () => `${padGlyph(GP.A)} Play the tutorial   ${padGlyph(GP.B)} Skip`), viewWidth / 2, y + h - 18);
}

// Training banner (top of the canvas, below the HUD line): title, instruction, progress
// dots and a Skip button; plus an arrow at the screen edge pointing at an off-screen target.
// The camera keeps the ship at the centre, so the banner never covers it.
function drawTutorialOverlay() {
    const text = tutorial.text;
    if (!text) return;
    const margin = 10;
    const x = margin;
    const w = viewWidth - margin * 2;
    const top = 48;
    const skipW = tutorial.noProgress ? 110 : 90;
    const skipH = tutorial.noProgress ? 46 : 38;
    const bodyFont = viewWidth < 500 ? '16px Arial' : '19px Arial';
    ctx.save();
    ctx.font = bodyFont;
    const lines = wrapText(text.body, w - skipW - 40);
    const h = 58 + lines.length * 24 + 14;

    ctx.fillStyle = 'rgba(0, 10, 30, 0.72)';
    ctx.fillRect(x, top, w, h);
    ctx.strokeStyle = 'rgba(102, 204, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, top, w, h);

    // Title and progress dots
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#66CCFF';
    ctx.font = 'bold 14px Arial';
    ctx.fillText('TRAINING', x + 15, top + 22);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 22px Arial';
    ctx.fillText(text.title, x + 15, top + 48);
    const { index, count } = tutorial.progress;
    const titleW = ctx.measureText(text.title).width;
    for (let i = 0; i < count; i++) {
        ctx.beginPath();
        ctx.arc(x + 30 + titleW + i * 16, top + 41, 5, 0, Math.PI * 2);
        if (i < index) { ctx.fillStyle = '#66CCFF'; ctx.fill(); }
        else if (i === index) { ctx.fillStyle = '#FFFF00'; ctx.fill(); }
        else { ctx.strokeStyle = '#888888'; ctx.lineWidth = 1.5; ctx.stroke(); }
    }

    // Instruction
    ctx.fillStyle = '#FFFFFF';
    ctx.font = bodyFont;
    lines.forEach((line, i) => ctx.fillText(line, x + 15, top + 76 + i * 24));

    // Skip button (more prominent after a while without progress)
    const sx = x + w - skipW - 10;
    const sy = top + (h - skipH) / 2;
    ctx.fillStyle = tutorial.noProgress ? 'rgba(255, 215, 0, 0.35)' : 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(sx, sy, skipW, skipH);
    ctx.strokeStyle = tutorial.noProgress ? '#FFD700' : 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sx, sy, skipW, skipH);
    ctx.fillStyle = tutorial.noProgress ? '#FFD700' : '#FFFFFF';
    ctx.font = 'bold 17px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Skip \u25B8', sx + skipW / 2, sy + skipH / 2);
    ctx.font = '11px Arial';
    ctx.fillStyle = '#AAAAAA';
    const skipKey = inputHint('Enter', '', () => padGlyph(GP.VIEW));
    if (skipKey) ctx.fillText(skipKey, sx + skipW / 2, sy + skipH + 9);
    addTapRegion(sx - 6, sy - 6, skipW + 12, skipH + 12, () => skipTutorial());
    ctx.restore();

    drawTutorialTargetArrow(top + h);
}

function drawTutorialTargetArrow(bannerBottom) {
    const ship = p1().ship;
    if (!tutorialTarget || !tutorialTarget.isAlive || !ship) return;
    const { dx, dy } = Entity.wrappedDelta(ship.x, ship.y, tutorialTarget.x, tutorialTarget.y);
    const cx = viewWidth / 2;
    const cy = viewHeight / 2;
    const r = tutorialTarget.radius;
    const sx = cx + dx;
    const sy = cy + dy;
    const minX = 30, maxX = viewWidth - 30, minY = bannerBottom + 25, maxY = viewHeight - 30;
    if (sx + r > 0 && sx - r < viewWidth && sy + r > bannerBottom && sy - r < viewHeight) return; // visible
    // Point on the inset rectangle along the ray from the ship
    const tx = dx > 0 ? (maxX - cx) / dx : dx < 0 ? (minX - cx) / dx : Infinity;
    const ty = dy > 0 ? (maxY - cy) / dy : dy < 0 ? (minY - cy) / dy : Infinity;
    const t = Math.min(tx, ty);
    const ax = cx + dx * t;
    const ay = cy + dy * t;
    const angle = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(angle);
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(Date.now() / 150);
    ctx.fillStyle = tutorialTarget.isGreen() ? palette.collect : palette.hazard;
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-10, -12);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-10, 12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

// Help screen: "▶ Replay tutorial" (also T or controller Y)
function drawHelpReplayButton() {
    const w = Math.min(300, viewWidth * 0.6);
    const h = 40;
    const x = (viewWidth - w) / 2;
    const y = viewHeight - 105;
    const key = inputHint(' (T)', '', () => ` (${padGlyph(GP.Y)})`);
    drawButtonBox(x, y, w, h, `\u25B6 Replay tutorial${key}`, false, 'bold 17px Arial');
    addTapRegion(x, y, w, h, () => replayTutorial());
}

function drawCenterText(line1, line2 = null) {
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.font = '48px Arial';
    ctx.fillText(line1, viewWidth / 2, viewHeight / 2 - (line2 ? 20 : 0));
    if (line2) {
        ctx.font = '24px Arial';
        ctx.fillText(line2, viewWidth / 2, viewHeight / 2 + 20);
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
        trackRenderPerformance(rawDeltaTime);
        updateGame(deltaTime);
        renderGame();
    } catch (error) {
        loopErrorCount++;
        if (loopErrorCount <= 5) console.error('[gameLoop] frame error (game continues):', error);
    }
    updateMusic();
}

// Every frame, in every state: follow the game's mood and schedule the next notes.
function updateMusic() {
    try {
        musicMood = selectMood({
            state: currentGameState === GameState.ROUND_END ? GameState.GAME_OVER : currentGameState,
            bossActive: !!(currentBoss && currentBoss.isAlive),
            lives: hudPlayer().lives,
            tutorialActive: tutorial.active,
        });
    } catch (e) { /* keep the previous mood */ }
    withMusic(m => { m.setMood(musicMood); m.update(); });
}

// --- Helper Functions ---

function createLevelAsteroids(isBossLevel = false) {
    console.log(`Creating asteroids for level ${level} (Difficulty: ${selectedDifficulty.name})${isBossLevel ? ' [BOSS LEVEL]' : ''}`);
    asteroids = [];

    // Calculate number of asteroids for this level (fewer during boss battles)
    // Single-player: BASE_ASTEROIDS_PER_LEVEL + (level - 1) * ASTEROIDS_PER_LEVEL_INCREASE
    let numAsteroids = currentScaling().asteroidCount;
    if (isBossLevel) {
        numAsteroids = Math.floor(numAsteroids * 0.4); // 40% of normal asteroids during boss fight
    }
    // Keep new asteroids away from every living ship (the world centre when there is none)
    const ships = livingPlayers(players).map(p => p.ship);
    const avoid = ships.length ? ships : [{ x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 }];

    // Apply DDA modifiers
    const speedMod = selectedDifficulty.asteroidSpeedMultiplier * DynamicDifficulty.asteroidSpeedMod;
    // Base green probability is 60%, modified by DDA
    const greenProbability = Math.min(0.85, Math.max(0.4, 0.6 * DynamicDifficulty.greenRatioMod));

    console.log(`Spawning ${numAsteroids} asteroids (speed: ${speedMod.toFixed(2)}x, green%: ${(greenProbability * 100).toFixed(0)}%)`);

    let greenCount = 0;
    for (let i = 0; i < numAsteroids; i++) {
        let x, y;
        let attempts = 0;

        // Find a position that's not too close to any ship (wrap-aware: an asteroid just
        // across the world edge is close too)
        do {
            x = randomRange(0, WORLD_WIDTH);
            y = randomRange(0, WORLD_HEIGHT);
            attempts++;
        } while (isNearAny(x, y, avoid, SAFE_SPAWN_RADIUS * 2, WORLD_WIDTH, WORLD_HEIGHT) && attempts < 20);

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

// One ship against power-ups, asteroids, UFOs and enemy bullets.
// Returns true when the ship was destroyed (the rest of the frame's checks wait, as before).
function checkShipCollisions(p) {
    const ship = p.ship;
    // Check ship collecting power-ups (always check, even when invulnerable)
    if (ship && ship.isAlive) {
        for (const powerUp of powerUps) {
            if (powerUp.isAlive && ship.collidesWith(powerUp)) {
                console.log(`Collected power-up: ${powerUp.type.name}`);
                activatePowerUp(p, powerUp.type);
                vibrate('powerUp');
                powerUp.isAlive = false;
            }
        }
    }

    if (ship && ship.isAlive && !ship.isInvulnerable) {
        const collectRadius = ship.radius * p.upgrades.getCollectionRadiusMult();
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
                // The mode decides what a collected green gives (single-player: points)
                const greenRule = asteroid.isGreen() && !tutorial.active
                    ? (mode.hooks.onCollectGreen(round, p) || { points: true }) : null;
                if (asteroid.isGreen() && tutorial.active) {
                    // Training: collect without score, credits, combo or achievements
                    asteroid.destroy();
                    Particles.collect(asteroid.x, asteroid.y, palette.collect);
                    if (audioManager) audioManager.play('collectGreen');
                    vibrate('collect');
                    queueTutorial(tutorial.notify('collectedGreen'));
                } else if (greenRule && !greenRule.points) {
                    // No points (e.g. Duel: a green gives shield time instead)
                    asteroid.destroy();
                    Particles.collect(asteroid.x, asteroid.y, palette.collect);
                    if (audioManager) audioManager.play('collectGreen');
                    vibrate('collect');
                    p.stats.greens++;
                    if (greenRule.shieldSeconds) {
                        p.powerUps.shield = Math.min(greenRule.shieldCap ?? Infinity, p.powerUps.shield + greenRule.shieldSeconds);
                    }
                } else if (asteroid.isGreen()) {
                    // GREEN asteroid: Collect it for points!
                    console.log("Collision: Ship <-> Green Asteroid (Collected!)");

                    // Calculate base score
                    let scoreGained = Math.round(asteroid.scoreValue * selectedDifficulty.scoreMultiplier);

                    // Apply score multiplier power-up
                    if (p.powerUps.score_multiplier > 0) {
                        scoreGained *= 2;
                    }

                    // Apply combo multiplier
                    const comboResult = p.combo.addCollection();
                    showComboMilestone(p, comboResult);
                    scoreGained *= p.combo.multiplier;

                    // Add streak bonus if any
                    if (comboResult.streakBonus > 0) {
                        scoreGained += comboResult.streakBonus;
                    }

                    // Points, plus credits for upgrades (10% of score)
                    awardPoints(p, scoreGained);
                    p.stats.greens++;
                    p.stats.bestCombo = Math.max(p.stats.bestCombo, p.combo.count);

                    asteroid.destroy();

                    // Visual effects
                    const screenPos = camera.worldToScreen(asteroid.x, asteroid.y);
                    Particles.collect(asteroid.x, asteroid.y, palette.collect);

                    // Floating score text
                    let scoreText = `+${scoreGained}`;
                    if (p.combo.multiplier > 1) {
                        scoreText += ` (${p.combo.multiplier}x)`;
                    }
                    FloatingTexts.spawn(screenPos.x, screenPos.y, scoreText, palette.collect, 18);

                    // Play collection sound
                    if (audioManager) {
                        audioManager.play('collectGreen');
                    }
                    vibrate('collect');
                    trackAchievement(p, 'trackAsteroidCollected');
                    if (mode.ddaEnabled) DynamicDifficulty.trackGreenCollected(p.combo.count);
                    if (greenRule.endRound) round.overtimeWinner = greenRule.winner; // e.g. Harvest overtime
                } else {
                    // RED asteroid: Lose a life (unless shield is active)!
                    if (p.powerUps.shield > 0) {
                        console.log("Collision: Ship <-> Red Asteroid (Shield blocked!)");
                        p.powerUps.shield = 0; // Shield breaks on impact
                        vibrate('shieldHit');
                        ship.makeInvulnerable(1); // Grace period so the fragments don't kill instantly
                        Particles.shatter(asteroid.x, asteroid.y, palette.hazard);
                        asteroid.split(asteroids, audioManager);
                        break; // split() appended to the array we're iterating
                    } else {
                        console.log("Collision: Ship <-> Red Asteroid (Damage!)");
                        handlePlayerDeath(p);
                        Particles.shatter(asteroid.x, asteroid.y, palette.hazard);
                        asteroid.split(asteroids, audioManager);
                        return true;
                    }
                }
            }
        }

        for (const ufo of ufos) {
            if (ufo.isAlive && ship.collidesWith(ufo)) {
                if (p.powerUps.shield > 0) {
                    console.log("Collision: Ship <-> UFO (Shield blocked!)");
                    p.powerUps.shield = 0;
                    vibrate('shieldHit');
                    ship.makeInvulnerable(1);
                    ufo.destroy(audioManager);
                } else {
                    console.log("Collision: Ship <-> UFO");
                    handlePlayerDeath(p);
                    ufo.destroy(audioManager);
                    return true;
                }
            }
        }

        for (const bullet of bullets) {
            if (bullet.isAlive && !bullet.isPlayerBullet && ship.collidesWith(bullet)) {
                if (p.powerUps.shield > 0) {
                    console.log("Collision: Ship <-> UFO Bullet (Shield blocked!)");
                    p.powerUps.shield = 0;
                    vibrate('shieldHit');
                    ship.makeInvulnerable(1);
                    bullet.destroy();
                } else {
                    console.log("Collision: Ship <-> UFO Bullet");
                    handlePlayerDeath(p);
                    bullet.destroy();
                    return true;
                }
            }
        }
    }
    return false;
}

function checkCollisions() {
    let shipDestroyed = false;
    for (const p of activePlayers()) {
        if (checkShipCollisions(p)) shipDestroyed = true;
    }
    if (shipDestroyed) return;

    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        if (!bullet.isAlive || !bullet.isPlayerBullet) continue;
        const shooter = bulletOwner(bullet);
        let bulletHit = false;
        for (let j = asteroids.length - 1; j >= 0; j--) {
            const asteroid = asteroids[j];
            if (!asteroid.isAlive) continue;
            if (bullet.collidesWith(asteroid)) {
                bullet.destroy();

                DynamicDifficulty.trackShotHit(); // Track bullet hit
                if (shooter) shooter.stats.hits++;
                if (asteroid.isGreen()) {
                    // Shooting green asteroids: NO points! (wasteful - should collect instead)
                    console.log("Collision: Player Bullet <-> Green Asteroid (Wasted!)");
                    Particles.spawn(asteroid.x, asteroid.y, 8, palette.collect, 90, 0.4, 2); // wasted crystal
                    asteroid.split(asteroids, audioManager); // Just destroys, no children
                    if (tutorial.active) queueTutorial(tutorial.notify('shotGreen'));
                    else if (shooter && (mode.hooks.onShootGreen(round, shooter) || {}).denied) {
                        // e.g. Harvest Race: shooting a green denies it to the other player
                        shooter.stats.greensDenied++;
                        const at = camera.worldToScreen(asteroid.x, asteroid.y);
                        FloatingTexts.spawn(at.x, at.y, 'DENIED', shooter.colour, 18);
                    }
                } else if (tutorial.active) {
                    // Training: the red target is gone; no power-ups, achievements or DDA
                    Particles.shatter(asteroid.x, asteroid.y, palette.hazard);
                    asteroid.split(asteroids, audioManager);
                    rumble('redDestroyed');
                    queueTutorial(tutorial.notify('destroyedRed'));
                } else {
                    // Shooting red asteroids: Good! They split but no points
                    console.log("Collision: Player Bullet <-> Red Asteroid (Destroyed!)");
                    // Chance to drop power-up from red asteroids
                    spawnPowerUpAt(asteroid.x, asteroid.y);
                    Particles.shatter(asteroid.x, asteroid.y, palette.hazard);
                    asteroid.split(asteroids, audioManager);
                    trackAchievement(shooter, 'trackAsteroidDestroyed');
                    if (shooter) shooter.stats.redsShot++;
                    DynamicDifficulty.trackRedDestroyed();
                    rumble('redDestroyed');
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
                if (shooter) shooter.stats.hits++;
                const scoreGained = Math.round(ufo.scoreValue * selectedDifficulty.scoreMultiplier);
                // Points and credits for the UFO kill (10% of score) go to the shooter
                awardPoints(shooter, scoreGained);
                if (shooter) shooter.stats.ufos++;
                // UFOs have higher chance to drop power-ups
                if (Math.random() < 0.5) {
                    spawnPowerUpAt(ufo.x, ufo.y);
                }
                ufo.destroy(audioManager);
                trackAchievement(shooter, 'trackUfoDestroyed');
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
                } else {
                    Particles.shatter(asteroid.x, asteroid.y, palette.hazard);
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
                const shooter = bulletOwner(bullet);
                bullet.destroy();
                DynamicDifficulty.trackShotHit();
                if (shooter) shooter.stats.hits++;

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
                    awardPoints(shooter, 200, 20); // 20 credits for a weak point
                    vibrate('bossWeakPoint');
                }

                if (bossDefeated) {
                    // Boss defeated!
                    console.log('Boss defeated! Awarding bonus score.');
                    vibrate('bossDefeated');
                    FloatingTexts.spawn(viewWidth / 2, viewHeight / 3,
                        `BOSS DEFEATED! +${currentBoss.scoreValue}`, '#FFD700', 36, 3);
                    // Big credit bonus for defeating boss (20% of boss score); with more
                    // players the bonus is split equally
                    const bossCredits = Math.ceil(currentBoss.scoreValue * 0.2);
                    for (const p of players) {
                        awardPoints(p, Math.round(currentBoss.scoreValue / players.length),
                            Math.ceil(bossCredits / players.length));
                    }
                    FloatingTexts.spawn(viewWidth / 2, viewHeight / 3 + 50,
                        `+${bossCredits} CREDITS!`, '#FFD700', 24, 3);
                    Particles.explode(currentBoss.x, currentBoss.y, '#FF00FF', 50);
                    Particles.explode(currentBoss.x, currentBoss.y, '#FFFF00', 40);
                    ScreenShake.trigger(20, 0.5);

                    // Drop multiple power-ups
                    for (let i = 0; i < 3; i++) {
                        const offsetX = (Math.random() - 0.5) * 100;
                        const offsetY = (Math.random() - 0.5) * 100;
                        const powerUp = new PowerUp(currentBoss.x + offsetX, currentBoss.y + offsetY);
                        powerUp.type = randomPowerUpType();
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

    // Boss bullets are added to the main bullets array in boss.update, so the ship-bullet
    // checks above already cover them. Last: ships crashing into the boss body.
    for (const p of activePlayers()) checkShipBossCollision(p);
}

// One ship against the boss body (elliptical saucer shape)
function checkShipBossCollision(p) {
    const ship = p.ship;
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
            if (p.powerUps.shield > 0) {
                p.powerUps.shield = 0;
                vibrate('shieldHit');
                console.log('Shield absorbed boss collision!');
                ship.isInvulnerable = true;
                ship.invulnerabilityTimer = 1;
            } else {
                handlePlayerDeath(p);
            }
        }
    }
}

function handlePlayerDeath(p, forced = false) {
    const ship = p.ship;
    let destroyed = forced;
    const shipX = ship ? ship.x : WORLD_WIDTH / 2;
    const shipY = ship ? ship.y : WORLD_HEIGHT / 2;

    if (ship && !forced) {
        destroyed = ship.destroy(audioManager, forced);
    }

    if (destroyed && tutorial.active) {
        // Training: gentle mistakes. No life lost; respawn at once, protected for 3 s.
        audioManager.stopThrustSound();
        Particles.explode(shipX, shipY, '#FFFFFF', 30);
        ScreenShake.trigger(8, 0.3);
        vibrate('shieldHit');
        queueTutorial(tutorial.notify('died'));
        return;
    }

    if (destroyed) {
        const unlimitedLives = mode.lives.type === 'unlimited';
        console.log(`Player death handled. Lives left: ${unlimitedLives ? 'unlimited' : p.lives - 1}`);
        audioManager.stopThrustSound();
        if (mode.ddaEnabled) DynamicDifficulty.onPlayerDeath(); // Immediate difficulty adjustment on death

        // Visual effects
        Particles.explode(shipX, shipY, '#FFFFFF', 30);
        ScreenShake.trigger(15, 0.5);
        showComboLost(p, p.combo.break());

        if (!unlimitedLives) p.lives--;
        p.stats.deaths++;
        updateUI();
        const decision = mode.hooks.onDeath(round, p, players) || {};
        const handOver = isTurns() && decision.turnChange && Number.isInteger(decision.nextIndex);
        if (decision.out || (!unlimitedLives && p.lives <= 0)) {
            // Out of lives: the round may be over (single-player: game over)
            p.out = true;
            const end = mode.hooks.checkEnd(round, players);
            if (end && end.ended) {
                endRound(end); // plays the game-over vibration
            } else {
                vibrate('lifeLost');
                p.ship = null; // out until revived or the round ends
                if (handOver) beginHandover(decision.nextIndex); // Take Turns: the next player's turn
            }
        } else if (handOver) {
            // Take Turns: a life lost hands the device to the next player with lives left
            vibrate('lifeLost');
            p.ship = null;
            p.respawnTimer = 0;
            beginHandover(decision.nextIndex);
        } else {
            vibrate('lifeLost');
            const delay = mode.respawn.delay ?? RESPAWN_DELAY;
            console.log(`Starting respawn timer (${delay}s)`);
            p.respawnTimer = delay;
            p.ship = null;
        }
    }
}

// Where a player's ship appears. Single-player: the world centre, as always. Several ships
// starting together line up around the centre; later respawns follow the mode's placement.
function respawnPoint(p, isInitialSpawn) {
    const centre = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
    if (!simultaneous()) return centre; // single-player and Take Turns: one ship per world
    if (isInitialSpawn) {
        return { x: centre.x + (p.slot - (players.length - 1) / 2) * 80, y: centre.y };
    }
    const hazards = [
        ...asteroids.filter(a => a.isAlive && !a.isGreen()),
        ...ufos.filter(u => u.isAlive),
        ...(currentBoss && currentBoss.isAlive ? [currentBoss] : []),
    ];
    switch (mode.respawn.placement) {
        case 'nearTeam': {
            const c = cameraCentre();
            return pickSpawnPoint(ringSpawnGrid(c.x, c.y, 150, WORLD_WIDTH, WORLD_HEIGHT), [], hazards,
                WORLD_WIDTH, WORLD_HEIGHT, { safeRadius: SAFE_SPAWN_RADIUS }) || centre;
        }
        case 'furthestFromOpponents': {
            const opponents = livingPlayers(players).filter(o => o !== p).map(o => o.ship);
            return pickSpawnPoint(worldSpawnGrid(WORLD_WIDTH, WORLD_HEIGHT), opponents, hazards,
                WORLD_WIDTH, WORLD_HEIGHT, { safeRadius: SAFE_SPAWN_RADIUS }) || centre;
        }
        default:
            return centre;
    }
}

function respawnPlayer(p, isInitialSpawn = false) {
    console.log(`respawnPlayer called. isInitialSpawn=${isInitialSpawn}, currentGameState=${currentGameState}, shipExists=${!!p.ship}, shipAlive=${p.ship?.isAlive}`);
    if (currentGameState !== GameState.GAME_OVER && (!p.ship || !p.ship.isAlive)) {
         console.log("Respawning Player - Conditions Met");

         // Spawn at the centre of the world (single-player) or where the mode says
         const spot = respawnPoint(p, isInitialSpawn);
         const centerX = spot.x;
         const centerY = spot.y;

         const ship = new PlayerShip(centerX, centerY);
         ship.ownerId = p.id;
         ship.bulletColour = players.length > 1 ? p.colour : null; // single-player bullets stay white
         p.ship = ship;
         applyShipModifiers(p);
         p.respawnTimer = 0;
         audioManager.stopThrustSound();

         // Make ship invulnerable after respawn (unless initial spawn)
         if (!isInitialSpawn) {
             const seconds = mode.respawn.invulnerability ?? 3; // 3 seconds unless the mode says otherwise
             ship.makeInvulnerable(seconds);
             console.log(`Ship made invulnerable for ${seconds} seconds`);
         }

         // Reset camera to player position (single-player; a shared camera keeps framing everyone)
         if (!simultaneous()) camera.reset(centerX, centerY, cameraView());
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
    vibrate('levelUp');

    // Reset boss defeated flag for new level
    bossDefeatedThisLevel = false;

    // Check if this is a boss level
    if (mode.bosses && level > 1 && level % BOSS_LEVEL_INTERVAL === 0) {
        // Spawn boss at top of visible area (in world coordinates)
        // (above the centre of the shared view: the ship in single-player)
        const centre = cameraCentre();
        const bossX = centre.x;
        // Target Y is 150px below top of visible screen in world coords
        const targetY = centre.y - viewHeight / 2 + 150;
        const bossLevel = Math.floor(level / BOSS_LEVEL_INTERVAL);
        currentBoss = new Boss(bossX, targetY, bossLevel);
        const scaling = currentScaling();
        currentBoss.applyScaling(scaling.bossHpMult, scaling.bossAttackMult); // x1 in single-player
        console.log(`BOSS BATTLE! Spawning level ${bossLevel} boss at target y=${targetY}!`);

        // Show boss warning
        FloatingTexts.spawn(viewWidth / 2, viewHeight / 2 - 50,
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
    for (const p of activePlayers()) checkPlayerAchievements(p);
}

// The mode says the round is over. Single-player goes to the Game Over screen; multiplayer
// saves credits and records, shows the round-end banner and then the Results screen.
function endRound(result) {
    lastRoundResult = result;
    if (!isMultiplayer()) {
        gameOver();
        return;
    }
    finishMultiplayerRound(result);
}

// Round clock and mode checks, once per frame while playing (not in training)
function updateRound(deltaTime) {
    if (!round || tutorial.active || currentGameState !== GameState.PLAYING) return;
    round.elapsed += deltaTime;
    if (round.timeLeft !== null) round.timeLeft = Math.max(0, round.timeLeft - deltaTime);
    if (round.phase === 'overtime' && round.overtimeLeft !== null) round.overtimeLeft = Math.max(0, round.overtimeLeft - deltaTime);
    mode.hooks.onTick(round, deltaTime, players);
    const end = mode.hooks.checkEnd(round, players);
    if (!end) return;
    if (end.ended) {
        endRound(end);
    } else if (end.startPhase) {
        round.phase = end.startPhase;
        round.overtimeLeft = end.duration ?? null;
    }
}

function gameOver() {
    console.log("Game Over!");
    finalScore = players.length === 1 ? p1().score : teamScore(players);
    currentGameState = GameState.GAME_OVER;
    gameOverInputDelay = 1;
    pausedGameExists = false;
    for (const p of players) {
        if (p.ship) p.ship.isThrusting = false;
    }
    audioManager.stopThrustSound();
    audioManager.stopUfoHum();
    // The game-over pattern (top priority) replaces whatever is running; nothing plays
    // after it because the game-over screen has no vibrating events.
    stopVibration();
    vibrate('gameOver');
    if (mode.leaderboard === 'highScores' && players.length === 1) checkAndAddHighScore(finalScore);

    // Save upgrade currency earned this session
    saveAllUpgrades();
    console.log(`Saved ${ShipUpgrades.currency} upgrade credits.`);

    // Clear boss if present
    currentBoss = null;
}

function checkAndAddHighScore(currentScore, username = currentUser) {
    if (!persistenceManager || !username || currentScore <= 0) return;
    const playerName = username.substring(0, 3).toUpperCase();
    const newEntry = { name: playerName, score: currentScore }; // Note: name here is just for display if needed, user is implicit

    // Load current user's scores for comparison
    let currentUserScores = persistenceManager.loadHighScores(username);

    let insertIndex = currentUserScores.findIndex(entry => currentScore > entry.score);
    if (insertIndex === -1 && currentUserScores.length < MAX_HIGH_SCORES) {
        insertIndex = currentUserScores.length;
    }

    if (insertIndex !== -1) {
        console.log(`New high score for ${username}: ${playerName} - ${currentScore}`);
        currentUserScores.splice(insertIndex, 0, newEntry);
        if (currentUserScores.length > MAX_HIGH_SCORES) {
            currentUserScores.pop();
        }
        // Save the updated list for the current user
        persistenceManager.saveHighScores(username, currentUserScores);
        // Update the local copy used by the game state if needed immediately
        if (username === currentUser) highScores = currentUserScores;
    }
}

function resetUfoSpawnTimer() {
    let interval = UFO_SPAWN_BASE_INTERVAL * currentScaling().ufoIntervalMult; // x1 in single-player
    interval *= selectedDifficulty.ufoSpawnMultiplier;
    interval *= DynamicDifficulty.ufoSpawnMod; // Apply DDA modifier
    interval *= Math.max(0.5, 1 - (level * 0.05));
    ufoSpawnTimer = interval * randomRange(0.75, 1.25);
    console.log(`Next UFO spawn timer set to ~${interval.toFixed(1)}s`);
}

function updateUfoSpawning(deltaTime) {
    if (currentGameState !== GameState.PLAYING) return;
    // Not while every ship is waiting to respawn
    if (!players.some(p => p.respawnTimer <= 0 && isLiving(p))) return;

    if (!mode.ufos.enabled || ufos.length >= currentScaling().ufoMaxActive) return;

    ufoSpawnTimer -= deltaTime;
    if (ufoSpawnTimer <= 0) {
        console.log("Attempting to spawn UFO");
        // Spawn UFO at a visible position near the edge of the current screen
        // Around the centre of the shared view (the ship in single-player)
        const centre = cameraCentre();
        const playerX = centre.x;
        const playerY = centre.y;

        // Spawn at edge of visible area
        const spawnSide = Math.floor(Math.random() * 4); // 0=top, 1=right, 2=bottom, 3=left
        let ufoX, ufoY;

        switch (spawnSide) {
            case 0: // Top
                ufoX = playerX + randomRange(-viewWidth / 2, viewWidth / 2);
                ufoY = playerY - viewHeight / 2 - 20;
                break;
            case 1: // Right
                ufoX = playerX + viewWidth / 2 + 20;
                ufoY = playerY + randomRange(-viewHeight / 2, viewHeight / 2);
                break;
            case 2: // Bottom
                ufoX = playerX + randomRange(-viewWidth / 2, viewWidth / 2);
                ufoY = playerY + viewHeight / 2 + 20;
                break;
            case 3: // Left
                ufoX = playerX - viewWidth / 2 - 20;
                ufoY = playerY + randomRange(-viewHeight / 2, viewHeight / 2);
                break;
        }

        // Wrap UFO spawn position to world bounds
        ufoX = ((ufoX % WORLD_WIDTH) + WORLD_WIDTH) % WORLD_WIDTH;
        ufoY = ((ufoY % WORLD_HEIGHT) + WORLD_HEIGHT) % WORLD_HEIGHT;

        // Create UFO at the calculated position
        const ufo = new UFO(viewWidth, viewHeight, playerX, playerY);
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
    const titleY = viewHeight / 6;
    ctx.fillText("HIGH SCORES (ALL USERS)", viewWidth / 2, titleY);

    ctx.font = '20px Arial';
    const listStartY = titleY + 60;
    const listLineHeight = 30;
    const rankX = viewWidth / 6;
    const nameX = viewWidth / 3;
    const scoreX = viewWidth * 4 / 5;
    const achievementSymbol = '*'; // Symbol for achievements

    if (!scoresToDisplay || scoresToDisplay.length === 0) {
        ctx.textAlign = 'center';
        ctx.fillText("No scores yet!", viewWidth / 2, listStartY);
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
    ctx.fillText(inputHint("Press Space/Enter/Esc to return", "Tap to return",
        () => `Press ${padGlyph(GP.A)} or ${padGlyph(GP.B)} to return`), viewWidth / 2, viewHeight - 40);
}

function drawAchievements() {
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.font = '36px Arial';
    const titleY = viewHeight / 8;
    ctx.fillText("ACHIEVEMENTS", viewWidth / 2, titleY);

    ctx.font = '18px Arial';
    ctx.textAlign = 'left';
    const listStartY = titleY + 50;
    const listLineHeight = 45;
    const nameX = viewWidth / 8;
    const descX = viewWidth / 8;
    const statusX = viewWidth * 7 / 8;

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
    ctx.fillText(inputHint("Press Space/Enter/Esc to return", "Tap to return",
        () => `Press ${padGlyph(GP.A)} or ${padGlyph(GP.B)} to return`), viewWidth / 2, viewHeight - 40);
}

// One centred line of text with a small asteroid icon in front of it (menu description)
function drawIconLine(type, text, centerX, y, color, font = '14px Arial', iconR = 7) {
    ctx.font = font;
    const w = ctx.measureText(text).width;
    const left = centerX - (w + iconR * 2 + 8) / 2;
    Asteroid.drawIcon?.(ctx, type, left + iconR, y - iconR * 0.7, iconR, palette);
    ctx.textAlign = 'left';
    ctx.fillStyle = color;
    ctx.fillText(text, left + iconR * 2 + 8, y);
}

// Settings screen: one row per setting, like the Upgrades screen. Tap the left/right part of
// a row (or press left/right) to change it; Enter or a centre tap steps forward.
function drawSettingsScreen() {
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.font = '36px Arial';
    const titleY = viewHeight * 0.14; // below the DOM HUD line
    ctx.fillText('SETTINGS', viewWidth / 2, titleY);

    const rows = visibleRows(settingsRows);
    if (settingsIndex >= rows.length) settingsIndex = 0;
    const listStartY = titleY + 70;
    const lineHeight = Math.min(55, (viewHeight - 90 - listStartY) / rows.length);
    const x = viewWidth * 0.1;
    const w = viewWidth * 0.8;

    rows.forEach((row, index) => {
        const isSelected = index === settingsIndex;
        const y = listStartY + index * lineHeight;
        const top = y - lineHeight * 0.62;
        const h = lineHeight - 5;
        if (isSelected) {
            ctx.fillStyle = 'rgba(255, 255, 0, 0.2)';
            ctx.fillRect(x, top, w, h);
        }
        ctx.fillStyle = isSelected ? '#FFFF00' : '#FFFFFF';
        ctx.font = 'bold 20px Arial';
        if (rowHasValue(row)) {
            ctx.textAlign = 'left';
            ctx.fillText(row.label(), x + 15, y);
            ctx.textAlign = 'right';
            ctx.fillText(`◂  ${rowValue(row)}  ▸`, x + w - 15, y);
        } else {
            ctx.textAlign = 'center';
            ctx.fillText(row.id === 'back' ? '< Back to Menu >' : row.label(), viewWidth / 2, y);
        }
        addRowTapRegion(x, top, w, h, row, index, (i) => { settingsIndex = i; });
    });

    ctx.textAlign = 'center';
    ctx.fillStyle = '#888888';
    ctx.font = '14px Arial';
    ctx.fillText(inputHint('UP/DOWN to choose, LEFT/RIGHT or ENTER to change, ESC to go back',
        'Tap the left or right side of a setting to change it',
        () => `\u25C2 \u25B8 Change   ${padGlyph(GP.A)} Select   ${padGlyph(GP.B)} Back`), viewWidth / 2, viewHeight - 30);
}

function drawUpgradesMenu() {
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, viewWidth, viewHeight);

    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.font = '36px Arial';
    const titleY = viewHeight / 10;
    ctx.fillText("SHIP UPGRADES", viewWidth / 2, titleY);

    // Show currency
    ctx.font = '24px Arial';
    ctx.fillStyle = '#FFD700';
    ctx.fillText(`Credits: ${ShipUpgrades.currency}`, viewWidth / 2, titleY + 40);

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
        const nameX = viewWidth * 0.1;
        addTapRegion(nameX - 10, yPos - 20, viewWidth * 0.8 + 20, listLineHeight - 5, () => {
            upgradeMenuIndex = index;
            inputHandler.triggerAction('menuSelect');
        });

        // Selection indicator
        if (isSelected) {
            ctx.fillStyle = 'rgba(255, 255, 0, 0.2)';
            ctx.fillRect(nameX - 10, yPos - 20, viewWidth * 0.8 + 20, listLineHeight - 5);
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
            ctx.fillText('MAXED', viewWidth * 0.9, yPos);
        } else {
            // Text cue as well as colour: unaffordable rows say how much is missing
            ctx.fillStyle = canAfford ? '#00FF00' : '#FF4444';
            ctx.fillText(canAfford ? `Cost: ${cost}` : `Cost: ${cost} (need ${cost - ShipUpgrades.currency})`, viewWidth * 0.9, yPos);
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
    ctx.fillText('< Back to Menu >', viewWidth / 2, backY);
    addTapRegion(viewWidth * 0.25, backY - 25, viewWidth * 0.5, 40, () => {
        upgradeMenuIndex = upgradeKeys.length;
        inputHandler.triggerAction('menuSelect');
    });

    ctx.fillStyle = '#888888';
    ctx.font = '14px Arial';
    ctx.fillText(`Earn credits by collecting ${palette.collectWord.toLowerCase()} crystals`, viewWidth / 2, viewHeight - 50);
    ctx.fillText(inputHint('Use UP/DOWN to navigate, ENTER to purchase (or click)', 'Tap an upgrade to purchase it',
        () => `${padGlyph(GP.A)} Buy   ${padGlyph(GP.B)} Back`), viewWidth / 2, viewHeight - 30);
}

function drawAchievementNotifications() {
    const notifications = achievementManagers().flatMap(m => m.getActiveNotifications());
    if (notifications.length > 0) {
        const startY = viewHeight * 0.85;
        const lineHeight = 30;
        ctx.textAlign = 'center';
        ctx.font = 'bold 20px Arial';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, startY - 25, viewWidth, notifications.length * lineHeight + 15);

        notifications.forEach((ach, index) => {
            ctx.fillStyle = 'yellow';
            ctx.fillText(`Achievement Unlocked: ${ach.name}`, viewWidth / 2, startY + index * lineHeight);
        });
    }
}

// The player who fired a bullet (null for enemy bullets or a player who has left)
function bulletOwner(bullet) {
    if (!bullet || !bullet.isPlayerBullet) return null;
    return players.find(p => p.id === bullet.ownerId) || null;
}

// World point at the centre of the view
function cameraCentre() {
    return { x: camera.cx, y: camera.cy };
}

// What the boss hovers around and attacks. Single-player passes the ship itself, exactly as
// before; with more players the boss hovers around the camera centre and rotates its attacks
// between the living ships (Boss.update accepts both).
function bossTarget() {
    if (!simultaneous()) return hudPlayer().ship;
    return { anchor: cameraCentre(), ships: livingPlayers(players).map(p => p.ship) };
}

// Every scoring event goes through here: the player's score and extra-life threshold, their
// achievements, then their upgrade credits (10% of the points unless given; only profiles
// with their own upgrades earn credits).
function awardPoints(p, points, credits = Math.ceil(points * 0.1)) {
    if (!p || points <= 0) return;
    p.score += points;
    if (p.score >= p.nextExtraLifeScore) {
        p.lives++;
        console.log(`Extra Life! Score: ${p.score}, Lives: ${p.lives}`);
        p.nextExtraLifeScore += Math.round(EXTRA_LIFE_SCORE * DynamicDifficulty.extraLifeThresholdMod);
    }
    updateUI();
    checkPlayerAchievements(p);
    if (credits > 0 && mode.earnsCredits && p.upgrades && p.upgrades.persistent) {
        p.upgrades.addCurrency(credits);
        p.stats.creditsEarned += credits;
    }
}

// Achievements: one manager per profiled player (player 1 uses the signed-in user's
// manager); guests have none.
function trackAchievement(p, method) {
    if (p && p.achievements) p.achievements[method]();
}
function checkPlayerAchievements(p) {
    if (p && p.achievements) p.achievements.checkUnlockConditions({ score: p.score, level: level, user: p.profile });
}

function drawPauseMenu() {
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(viewWidth * 0.25, viewHeight * 0.25, viewWidth * 0.5, viewHeight * 0.5);

    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.font = '36px Arial';
    const titleY = viewHeight * 0.35;
    ctx.fillText("PAUSED", viewWidth / 2, titleY);
    const byName = isMultiplayer() ? pausedByName() : null;
    if (byName) {
        ctx.font = '16px Arial';
        ctx.fillStyle = '#AAAAAA';
        ctx.fillText(`by ${byName}`, viewWidth / 2, titleY + 24);
        ctx.fillStyle = 'white';
    }

    ctx.font = '24px Arial';
    const pauseStartY = titleY + 60;
    const pauseLineHeight = 40;
    getPauseMenuOptions().forEach((option, index) => {
        ctx.fillStyle = index === pauseMenuSelectionIndex ? 'yellow' : 'white';
        const itemY = pauseStartY + index * pauseLineHeight;
        ctx.fillText(option, viewWidth / 2, itemY);
        addTapRegion(viewWidth * 0.25, itemY - pauseLineHeight * 0.7, viewWidth * 0.5, pauseLineHeight, () => {
            pauseMenuSelectionIndex = index;
            inputHandler.triggerAction('menuSelect');
        });
    });

    ctx.font = '16px Arial';
    ctx.fillStyle = 'lightgray';
    ctx.fillText(inputHint("(Press P or Esc to Resume)", "(Tap an option)",
        () => `${padGlyph(GP.A)} Select   ${padGlyph(GP.B)} Resume`), viewWidth / 2, viewHeight * 0.75 - 20);
}

// --- Multiplayer screens (canvas) ---

// Small ship icon in a player's colour (lobby cards, hand-over screen, results)
function drawShipIcon(x, y, size, colour, rotation = -Math.PI / 2) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.strokeStyle = colour;
    ctx.fillStyle = colour;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.7, -size * 0.6);
    ctx.lineTo(-size * 0.4, 0);
    ctx.lineTo(-size * 0.7, size * 0.6);
    ctx.closePath();
    ctx.globalAlpha = 0.35;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
    ctx.restore();
}

function drawScreenTitle(title, subtitle = null) {
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '36px Arial';
    const y = viewHeight * 0.12;
    ctx.fillText(title, viewWidth / 2, y);
    if (subtitle) {
        ctx.font = '16px Arial';
        ctx.fillStyle = '#AAAAAA';
        ctx.fillText(subtitle, viewWidth / 2, y + 28);
    }
    return y + (subtitle ? 50 : 30);
}

function drawHintLine(text, y = viewHeight - 20) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#888888';
    ctx.fillText(text, viewWidth / 2, y);
}

// Mode select: one box per playable mode (name + two lines of rules), then Back
function drawModeSelect() {
    const top = drawScreenTitle('MULTIPLAYER', 'Choose a mode');
    const rows = mpModeRows();
    if (mpModeIndex >= rows.length) mpModeIndex = 0;
    const w = Math.min(520, viewWidth - 60);
    const x = (viewWidth - w) / 2;
    let y = top + 10;
    rows.forEach((row, i) => {
        const selected = i === mpModeIndex;
        const isMode = row.id !== 'back';
        const h = isMode ? 96 : 48;
        drawButtonBox(x, y, w, h, '', selected);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = selected ? '#FFFF00' : '#FFFFFF';
        ctx.font = 'bold 24px Arial';
        if (isMode) {
            ctx.fillText(row.label(), x + w / 2, y + 34);
            ctx.font = '15px Arial';
            ctx.fillStyle = '#CCCCCC';
            (MP_MODE_INFO[row.id] || []).forEach((line, k) => ctx.fillText(line, x + w / 2, y + 60 + k * 20));
        } else {
            ctx.font = 'bold 20px Arial';
            ctx.fillText(row.label(), x + w / 2, y + 31);
        }
        addRowTapRegion(x, y, w, h, row, i, (k) => { mpModeIndex = k; });
        y += h + 14;
    });
    drawHintLine(inputHint('UP/DOWN to choose, ENTER to select, ESC to go back', 'Tap a mode',
        () => `${padGlyph(GP.A)} Select   ${padGlyph(GP.B)} Back`));
}

// Controller glyph once a controller is known, else the Xbox letter (Ⓐ, Ⓑ)
function lobbyPadGlyph(button, letter) {
    return inputHandler.gamepadInfo().connected ? padGlyph(button) : CIRCLED_LETTERS[letter];
}
const SOURCE_LABELS = {
    kbLeft: 'Keys: W A S D · SPACE',
    kbRight: 'Keys: ← ↑ → ↓ · ENTER',
};
function sourceLabel(source) {
    if (SOURCE_LABELS[source]) return SOURCE_LABELS[source];
    const m = /^pad:(\d+)$/.exec(source || '');
    if (m) return `Controller ${Number(m[1]) + 1}`;
    if (source && source.startsWith('touch:')) return source === 'touch:a' ? 'Touch left' : 'Touch right';
    return '';
}

// Seat lobby: a 2 x 2 grid of cards, one per seat (§10.2)
function drawSeatLobby() {
    const m = getMode(lobbyModeId);
    const top = drawScreenTitle(m ? m.name.toUpperCase() : 'LOBBY', 'Each player presses FIRE on their own keys or controller');
    const gap = 12;
    const cols = 2;
    const w = Math.min(300, (viewWidth - 40 - gap) / cols);
    const h = Math.min(170, (viewHeight - top - 150 - gap) / 2);
    const x0 = (viewWidth - (w * cols + gap)) / 2;
    const snapshot = inputHandler.seats.snapshot().seats;
    for (let seat = 0; seat < 4; seat++) {
        const x = x0 + (seat % cols) * (w + gap);
        const y = top + Math.floor(seat / cols) * (h + gap);
        drawLobbyCard(seat, x, y, w, h, lobby.cards[seat], snapshot[seat]);
    }
    const infoY = top + 2 * (h + gap) + 24;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const joined = joinedSeats(lobby).length;
    if (lobby.countdown !== null) {
        ctx.font = 'bold 30px Arial';
        ctx.fillStyle = '#FFD700';
        ctx.fillText(`Starting in ${Math.ceil(lobby.countdown)}`, viewWidth / 2, infoY);
    } else {
        ctx.font = '18px Arial';
        ctx.fillStyle = '#FFFFFF';
        const text = joined < lobby.min ? `Waiting for players (${joined}/${lobby.min})`
            : canStart(lobby) ? 'Get ready...' : 'Press FIRE again when ready';
        ctx.fillText(text, viewWidth / 2, infoY);
    }
    if (lobbyExitNotice > 0) {
        ctx.font = 'bold 16px Arial';
        ctx.fillStyle = '#FF9F1C';
        ctx.fillText('Players have joined: press Esc again to leave', viewWidth / 2, infoY + 26);
    }
    // Pass-and-play instead (touch, mouse)
    const bw = Math.min(360, viewWidth - 60);
    const bx = (viewWidth - bw) / 2;
    const by = viewHeight - 88;
    drawButtonBox(bx, by, bw, 36, 'Pass one device instead ▸', false, 'bold 16px Arial');
    addTapRegion(bx, by, bw, 36, () => openLobby(lobbyModeId, { kind: 'count' }));
    drawHintLine('Fire: join / ready   ↓ or S: leave   ← →: colour   ↑: name   Esc: back', viewHeight - 30);
    drawHintLine(`Controllers: ${lobbyPadGlyph(GP.A, 'A')} join / ready   ${lobbyPadGlyph(GP.B, 'B')} leave   D-pad colour and name`, viewHeight - 12);
}

function drawLobbyCard(seat, x, y, w, h, card, seatInfo) {
    const colour = seatInfo ? seatColour(seatInfo.colour) : '#555555';
    ctx.save();
    ctx.fillStyle = card ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.03)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = card ? colour : 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = card && card.ready ? 4 : 2;
    if (!card) ctx.setLineDash([6, 6]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = card ? colour : '#777777';
    ctx.font = 'bold 26px Arial';
    ctx.fillText(`P${seat + 1}`, x + 12, y + 32);
    if (card) {
        drawShipIcon(x + w - 30, y + 26, 14, colour);
        ctx.font = 'bold 20px Arial';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(card.name, x + 12, y + 62);
        ctx.font = '13px Arial';
        ctx.fillStyle = '#AAAAAA';
        ctx.fillText(sourceLabel(seatInfo && seatInfo.source), x + 12, y + 84);
        // Key-test lights: thrust, left, right, fire
        const lights = [['thrust', '▲'], ['rotateLeft', '◀'], ['rotateRight', '▶'], ['fire', '●']];
        lights.forEach(([action, glyph], i) => {
            const on = inputHandler.isPressed(action, seat);
            const lx = x + 22 + i * 30;
            const ly = y + h - 58;
            ctx.beginPath();
            ctx.arc(lx, ly, 10, 0, Math.PI * 2);
            ctx.fillStyle = on ? colour : 'rgba(255, 255, 255, 0.1)';
            ctx.fill();
            ctx.fillStyle = on ? '#000000' : '#888888';
            ctx.font = '11px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(glyph, lx, ly + 1);
        });
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.font = 'bold 16px Arial';
        ctx.fillStyle = card.ready ? '#00FF88' : '#FFD700';
        ctx.fillText(card.ready ? 'READY' : 'Joined – FIRE when ready', x + 12, y + h - 18);
    } else {
        ctx.font = '16px Arial';
        ctx.fillStyle = '#AAAAAA';
        ctx.fillText('Press FIRE to join', x + 12, y + 62);
        ctx.font = '12px Arial';
        ctx.fillStyle = '#777777';
        ctx.fillText(`Space · Enter · ${lobbyPadGlyph(GP.A, 'A')}`, x + 12, y + 84);
    }
    ctx.restore();
}

// Pass-and-play lobby: how many players, their names, Start (one shared input; works on touch)
function drawCountLobby() {
    const m = getMode(lobbyModeId);
    const top = drawScreenTitle(m ? m.name.toUpperCase() : 'LOBBY', 'How many players? Pass the device when it says GET READY');
    const rows = countLobbyRows();
    if (lobbyIndex >= rows.length) lobbyIndex = 0;
    const listStartY = top + 30;
    const lineHeight = Math.min(52, (viewHeight - 70 - listStartY) / rows.length);
    const x = viewWidth * 0.12;
    const w = viewWidth * 0.76;
    rows.forEach((row, index) => {
        const selected = index === lobbyIndex;
        const y = listStartY + index * lineHeight;
        const rowTop = y - lineHeight * 0.62;
        const h = lineHeight - 6;
        if (selected) {
            ctx.fillStyle = 'rgba(255, 255, 0, 0.2)';
            ctx.fillRect(x, rowTop, w, h);
        }
        ctx.textBaseline = 'alphabetic';
        ctx.font = 'bold 20px Arial';
        const nameRow = /^name\d$/.test(row.id);
        const colour = nameRow ? seatColour(Number(row.id.slice(4)) - 1) : null;
        ctx.fillStyle = selected ? '#FFFF00' : (colour || '#FFFFFF');
        if (rowHasValue(row)) {
            ctx.textAlign = 'left';
            ctx.fillText(row.label(), x + 15, y);
            ctx.textAlign = 'right';
            ctx.fillStyle = selected ? '#FFFF00' : '#FFFFFF';
            ctx.fillText(`◂  ${rowValue(row)}  ▸`, x + w - 15, y);
        } else {
            ctx.textAlign = 'center';
            ctx.fillText(row.id === 'start' ? '▶ Start' : row.label(), viewWidth / 2, y);
        }
        addRowTapRegion(x, rowTop, w, h, row, index, (i) => { lobbyIndex = i; });
    });
    drawHintLine(inputHint('UP/DOWN to choose, LEFT/RIGHT to change, ENTER to select, ESC to go back',
        'Tap the left or right side of a row to change it',
        () => `◂ ▸ Change   ${padGlyph(GP.A)} Select   ${padGlyph(GP.B)} Back`), viewHeight - 24);
}

// Take Turns hand-over: "PLAYER 2 – GET READY" (fire, tap or Ⓐ after 1 s)
function drawTurnChange() {
    const p = players[turn.index];
    const cx = viewWidth / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    drawShipIcon(cx, viewHeight * 0.2, 26, p.colour);
    ctx.fillStyle = p.colour;
    ctx.font = 'bold 44px Arial';
    ctx.fillText(`PLAYER ${turn.index + 1} – GET READY`, cx, viewHeight * 0.33, viewWidth - 30);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 30px Arial';
    ctx.fillText(p.name, cx, viewHeight * 0.33 + 44);
    const w = turn.worlds[turn.index];
    const lvl = turn.needsWorld ? (w ? w.level : 1) : level;
    ctx.font = '20px Arial';
    ctx.fillStyle = '#CCCCCC';
    ctx.fillText(`Score ${p.score}   Lives ${p.lives}   Level ${lvl}`, cx, viewHeight * 0.33 + 80);

    // Everyone's standing
    ctx.font = '16px Arial';
    players.forEach((q, i) => {
        const y = viewHeight * 0.58 + i * 24;
        ctx.fillStyle = i === turn.index ? q.colour : '#888888';
        const status = q.out ? 'OUT' : `${q.lives} ${q.lives === 1 ? 'life' : 'lives'}`;
        ctx.fillText(`P${i + 1} ${q.name}   ${q.score}   ${status}`, cx, y);
    });

    ctx.font = 'bold 20px Arial';
    if (turn.readyDelay > 0) {
        ctx.fillStyle = '#666666';
        ctx.fillText('Pass the device...', cx, viewHeight * 0.88);
    } else {
        ctx.fillStyle = '#FFD700';
        ctx.globalAlpha = 0.65 + 0.35 * Math.sin(Date.now() / 250);
        ctx.fillText(inputHint('Press FIRE or Enter to start', 'Tap to start', () => `Press ${padGlyph(GP.A)} to start`),
            cx, viewHeight * 0.88);
        ctx.globalAlpha = 1;
    }
    addFullScreenTap(() => inputHandler.triggerAction('menuSelect'));
}

// Over the playing field: whose turn (Take Turns), the resume countdown, the round-end banner
function drawMultiplayerOverlay() {
    if (!isMultiplayer()) return;
    ctx.save();
    if (isTurns() && currentGameState === GameState.PLAYING) {
        const p = players[turn.index];
        ctx.textAlign = 'right';
        ctx.textBaseline = 'alphabetic';
        ctx.font = 'bold 16px Arial';
        ctx.fillStyle = p.colour;
        ctx.fillText(`P${turn.index + 1} ${p.name}`, viewWidth - 10, viewHeight - 10);
    }
    if (resumeCountdown > 0 && currentGameState === GameState.PLAYING) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(0, 0, viewWidth, viewHeight);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 96px Arial';
        ctx.fillText(String(Math.ceil(resumeCountdown)), viewWidth / 2, viewHeight / 2);
        ctx.font = '20px Arial';
        ctx.fillText('Get ready', viewWidth / 2, viewHeight / 2 + 70);
    }
    if (currentGameState === GameState.ROUND_END) {
        const h = 120;
        const y = viewHeight / 2 - h / 2;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, y, viewWidth, h);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 40px Arial';
        ctx.fillText('ROUND OVER', viewWidth / 2, y + 42);
        ctx.fillStyle = '#FFD700';
        ctx.font = 'bold 26px Arial';
        ctx.fillText(resultBanner(lastResults), viewWidth / 2, y + 88);
    }
    ctx.restore();
}

// Results (§11): banner, one column per player (ranked), highlights, Rematch / Change mode / Main menu
function drawResults() {
    const r = lastResults;
    if (!r) return;
    const mins = Math.floor(r.duration / 60);
    const secs = String(Math.floor(r.duration % 60)).padStart(2, '0');
    const top = drawScreenTitle(resultBanner(r), `${r.modeName} · ${mins}:${secs}`);
    const rows = r.players;
    const labelW = Math.min(150, viewWidth * 0.24);
    const left = 16 + labelW;
    const colW = (viewWidth - left - 16) / Math.max(1, rows.length);
    const fields = [
        ['Score', (p) => p.score],
        ...(r.kind === 'turns' ? [['Level', (p) => p.level ?? '-']] : []),
        ['Greens', (p) => p.greens],
        ['Rocks shot', (p) => p.redsShot],
        ['UFOs', (p) => p.ufos],
        ['Deaths', (p) => p.deaths],
        ['Best combo', (p) => p.bestCombo],
        ['Accuracy', (p) => `${Math.round(p.accuracy * 100)}%`],
        ['Credits', (p) => (p.profile ? `+${p.credits}` : '-')],
    ];
    const lineH = Math.min(28, (viewHeight * 0.52) / (fields.length + 2));
    const headY = top + 10;
    ctx.textBaseline = 'alphabetic';
    rows.forEach((p, i) => {
        const cx = left + colW * i + colW / 2;
        ctx.textAlign = 'center';
        ctx.fillStyle = p.winner ? '#FFD700' : '#AAAAAA';
        ctx.font = 'bold 14px Arial';
        ctx.fillText(p.winner ? 'WINNER' : `#${i + 1}`, cx, headY);
        ctx.fillStyle = p.colour || '#FFFFFF';
        ctx.font = 'bold 18px Arial';
        ctx.fillText(p.name, cx, headY + 22, colW - 6);
        fields.forEach(([, get], k) => {
            ctx.fillStyle = k === 0 ? '#FFFFFF' : '#DDDDDD';
            ctx.font = k === 0 ? 'bold 18px Arial' : '16px Arial';
            ctx.fillText(String(get(p)), cx, headY + 22 + (k + 1) * lineH, colW - 6);
        });
    });
    ctx.textAlign = 'left';
    ctx.font = '15px Arial';
    ctx.fillStyle = '#999999';
    fields.forEach(([label], k) => ctx.fillText(label, 16, headY + 22 + (k + 1) * lineH));

    // Highlights and new achievements
    let y = headY + 22 + (fields.length + 1) * lineH + 8;
    ctx.textAlign = 'center';
    ctx.font = '15px Arial';
    const extra = [...r.highlights];
    rows.forEach(p => { if (p.newAchievements.length) extra.push(`${p.name}: ${p.newAchievements.join(', ')}`); });
    extra.slice(0, 4).forEach(line => {
        ctx.fillStyle = '#FFD700';
        ctx.fillText(line, viewWidth / 2, y, viewWidth - 30);
        y += 20;
    });

    // Buttons
    const n = RESULTS_BUTTONS.length;
    const gap = 10;
    const bw = Math.min(190, (viewWidth - 40 - gap * (n - 1)) / n);
    const bh = 48;
    const bx0 = (viewWidth - (bw * n + gap * (n - 1))) / 2;
    const by = viewHeight - 90;
    const waiting = resultsInputDelay > 0;
    RESULTS_BUTTONS.forEach((label, i) => {
        const bx = bx0 + i * (bw + gap);
        ctx.globalAlpha = waiting ? 0.4 : 1;
        drawButtonBox(bx, by, bw, bh, label, i === resultsIndex, 'bold 18px Arial');
        ctx.globalAlpha = 1;
        addTapRegion(bx, by, bw, bh, () => {
            resultsIndex = i;
            inputHandler.triggerAction('menuSelect');
        });
    });
    drawHintLine(inputHint('LEFT/RIGHT to choose, ENTER to select', 'Tap a button',
        () => `◂ ▸ Choose   ${padGlyph(GP.A)} Select`), viewHeight - 18);
}

// Read-only lobby copy for the test hook
function lobbySnapshot() {
    if (!lobby) return null;
    if (lobby.kind === 'count') {
        return {
            kind: 'count', modeId: lobbyModeId, count: lobby.count, index: lobbyIndex,
            names: lobby.names.slice(0, lobby.count).map(n => ({ ...n })),
            rows: countLobbyRows().map(r => r.id),
        };
    }
    const seats = inputHandler.seats.snapshot().seats;
    return {
        kind: 'seats', modeId: lobbyModeId, countdown: lobby.countdown, exitNotice: lobbyExitNotice,
        min: lobby.min, max: lobby.max, joined: joinedSeats(lobby).length, canStart: canStart(lobby),
        cards: lobby.cards.map((c, seat) => (c ? {
            seat, name: c.name, profile: c.profile, ready: c.ready,
            source: seats[seat] ? seats[seat].source : null,
            colour: seats[seat] ? seats[seat].colour : null,
            colourHex: seats[seat] ? seatColour(seats[seat].colour) : null,
        } : null)),
    };
}

// Small saucer icon matching UFO.draw (Help screen)
function drawUfoIcon(x, y, r) {
    ctx.save();
    ctx.strokeStyle = '#9933FF';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.2, r, r * 0.3, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x, y - r * 0.2, r * 0.55, r * 0.3, 0, Math.PI, 0);
    ctx.stroke();
    ctx.restore();
}

function drawHelpScreen() {
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.font = '28px Arial';
    const titleY = viewHeight * 0.12; // below the DOM HUD line
    ctx.fillText("SPACE ADVENTURE - HELP", viewWidth / 2, titleY);

    // Game rules section
    ctx.font = '16px Arial';
    ctx.textAlign = 'left';
    const rulesX = viewWidth / 10;
    let rulesY = titleY + 40;

    // One row per thing in space, each with its icon; shapes are named so colour is optional
    const iconR = 8;
    const textX = rulesX + iconR * 2 + 10;
    const rules = [
        { icon: 'green', color: palette.collect, name: `${palette.collectWord} crystals (smooth):`,
            text: "Fly INTO them to collect points. Don't shoot them." },
        { icon: 'red', color: palette.hazard, name: `${palette.hazardWord} rocks (spiky, X):`,
            text: "Dangerous! SHOOT them. Don't touch!" },
        { icon: 'ufo', color: '#9933FF', name: 'Aliens (purple UFOs):',
            text: `Shoot at you and ${palette.collectWord.toLowerCase()} crystals. Destroy them!` },
    ];
    rules.forEach((rule, i) => {
        const y = rulesY + i * 40;
        if (rule.icon === 'ufo') drawUfoIcon(rulesX + iconR, y - 5, iconR + 2);
        else Asteroid.drawIcon?.(ctx, rule.icon, rulesX + iconR, y - 5, iconR, palette);
        ctx.textAlign = 'left';
        ctx.font = 'bold 15px Arial';
        ctx.fillStyle = rule.color;
        ctx.fillText(rule.name, textX, y - 2);
        ctx.font = '14px Arial';
        ctx.fillStyle = 'white';
        ctx.fillText(rule.text, textX, y + 15);
    });
    rulesY += 2 * 40 + 12;

    // Controls section
    ctx.fillStyle = 'white';
    ctx.font = '20px Arial';
    rulesY += 35;
    ctx.fillText("CONTROLS", rulesX, rulesY);

    ctx.font = '14px Arial';
    const helpStartY = rulesY + 25;
    const helpLineHeight = 22;
    const controlsX = rulesX;
    const keysX = viewWidth / 2;

    const A = padGlyph(GP.A);
    const B = padGlyph(GP.B);
    const controls = usingGamepad() ? [
        { action: 'Steer', keys: 'Left stick (push fully to fly)' },
        { action: 'Rotate / Thrust', keys: 'D-pad \u2190 \u2192 / D-pad \u2191 or LT' },
        { action: 'Fire', keys: `${A} or RT` },
        { action: 'Hyperspace (Risky!)', keys: `${B} or D-pad \u2193` },
        { action: 'Pause Game', keys: 'Start (Menu button)' },
        { action: 'Skip tutorial / Mute', keys: 'View (in game / in menus)' },
        { action: 'Menus', keys: `Stick or D-pad, ${A} select, ${B} back` },
        { action: 'Sound', keys: 'Tap or press a key once to enable' },
    ] : isTouchDevice && controlMode === ControlMode.JOYSTICK ? [
        { action: 'Steer', keys: 'Drag on the left half of the screen' },
        { action: 'Thrust Forward', keys: 'Drag further out' },
        { action: 'Fire', keys: 'Red button' },
        { action: 'Hyperspace (Risky!)', keys: 'Star button' },
        { action: 'Pause Game', keys: 'Pause button (top right)' },
        { action: 'Controls, colours, sound, music', keys: 'Menu > Settings' },
        ...(haptics.supported ? [{ action: 'Vibration', keys: 'Menu > Settings' }] : []),
    ] : isTouchDevice ? [
        { action: 'Rotate Left/Right', keys: 'Arrow buttons (bottom left)' },
        { action: 'Thrust Forward', keys: 'Up arrow button' },
        { action: 'Fire', keys: 'Red button' },
        { action: 'Hyperspace (Risky!)', keys: 'Star button' },
        { action: 'Pause Game', keys: 'Pause button (top right)' },
        { action: 'Toggle Mute', keys: 'Speaker button (top right)' },
        { action: 'Controls, colours, sound, music', keys: 'Menu > Settings' },
        ...(haptics.supported ? [{ action: 'Vibration', keys: 'Menu > Settings' }] : []),
    ] : [
        { action: 'Rotate Left/Right', keys: 'Arrow Keys / A,D' },
        { action: 'Thrust Forward', keys: 'Up Arrow / W' },
        { action: 'Fire', keys: 'Spacebar' },
        { action: 'Hyperspace (Risky!)', keys: 'H / S / Down Arrow' },
        { action: 'Pause Game', keys: 'P / Escape' },
        { action: 'Toggle Mute', keys: 'M' },
        { action: 'Colours, sound, music', keys: 'Menu > Settings' },
        { action: 'Game controller', keys: 'Press any button to connect' },
    ];

    controls.forEach((ctrl, index) => {
        ctx.fillText(ctrl.action + ":", controlsX, helpStartY + index * helpLineHeight);
        ctx.fillText(ctrl.keys, keysX, helpStartY + index * helpLineHeight);
    });

    ctx.textAlign = 'center';
    ctx.font = '16px Arial';
    ctx.fillText(inputHint("Press Space/Enter/Esc to return", "Tap to return",
        () => `${padGlyph(GP.B)} Back   ${padGlyph(GP.Y)} Replay tutorial`), viewWidth / 2, viewHeight - 30);
}

// The username text field itself is a DOM form (see index.html) so touch devices get
// their on-screen keyboard; the canvas only draws the title around it.
function drawUserPrompt() {
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.font = '40px Arial';
    ctx.fillText("SPACE ADVENTURE", viewWidth / 2, viewHeight / 6);

    ctx.font = '18px Arial';
    ctx.fillStyle = '#AAAAAA';
    ctx.fillText(isTouchDevice ? "Tap the box, type a name, then tap OK" : "Type a name, then press Enter",
        viewWidth / 2, viewHeight * 0.7);
    if (usingGamepad()) {
        // A controller can't type
        ctx.fillStyle = '#FFD700';
        ctx.font = '16px Arial';
        ctx.fillText('Use keyboard or touch to enter a name', viewWidth / 2, viewHeight * 0.7 + 30);
        ctx.fillText(`or press ${padGlyph(GP.A)} to play as PLAYER1`, viewWidth / 2, viewHeight * 0.7 + 52);
    }
}

// Export necessary functions/variables if using modules elsewhere
// export { canvas, ctx, score, lives, level }; 