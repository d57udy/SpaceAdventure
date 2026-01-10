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

// Game States Enum
const GameState = {
    PROMPT_USER: 'prompt_user',
    MENU: 'menu',
    PLAYING: 'playing',
    PAUSED: 'paused',
    HIGH_SCORES: 'high_scores',
    ACHIEVEMENTS: 'achievements',
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
let score = 0;
let lives = Difficulty.MEDIUM.startingLives; // Default before selection
let level = 1;
let currentGameState = GameState.PROMPT_USER;
let selectedDifficulty = Difficulty.MEDIUM; // Default difficulty
let menuSelectionIndex = 0; // For menu navigation (0: Start, 1: High Scores, 2: Achievements, 3: Help, 4: Reset Data, 5: Easy, 6: Medium, 7: Hard)
const menuOptionBaseTexts = ['Start', 'High Scores', 'Achievements', 'Help', 'Reset Data', 'Change User'];
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
    inputHandler = new InputHandler();
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

    // Audio context resume listener
    const resumeAudio = () => {
        audioManager.resumeContext();
        document.removeEventListener('click', resumeAudio);
        document.removeEventListener('keydown', resumeAudio);
    };
    document.addEventListener('click', resumeAudio);
    document.addEventListener('keydown', resumeAudio);

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
    lives = selectedDifficulty.startingLives;
    level = 1;
    nextExtraLifeScore = EXTRA_LIFE_SCORE;
    bullets = [];
    asteroids = [];
    ufos = [];

    // Generate starfield for the world
    generateStars();

    // Initialize camera at center of the world
    Camera.reset(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, canvas.width, canvas.height);

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
function handlePromptInput() {
    if (currentGameState !== GameState.PROMPT_USER) return;

    const pressedChar = inputHandler.consumeLastCharKey();
    if (pressedChar && promptInput.length < 10) {
        promptInput += pressedChar;
    }
    if (inputHandler.consumeAction('backspace') && promptInput.length > 0) {
        promptInput = promptInput.slice(0, -1);
    }
    if (inputHandler.consumeAction('enter') && promptInput.trim().length >= 3) { // Require min length 3
        const newUser = promptInput.trim();
        console.log(`User entered: ${newUser}`);
        loadUserData(newUser);
        currentGameState = GameState.MENU;
        promptInput = "";
    }
}

// --- Main Update and Render Loop ---

function resizeCanvas() {
    // Make canvas fill most of the smaller dimension
    const size = Math.min(window.innerWidth, window.innerHeight) * 0.9;
    canvas.width = size;
    canvas.height = size;

    // Update world dimensions based on canvas size (5x5 screens)
    WORLD_WIDTH = canvas.width * WORLD_SCREENS_X;
    WORLD_HEIGHT = canvas.height * WORLD_SCREENS_Y;

    console.log(`Canvas resized to: ${canvas.width}x${canvas.height}`);
    console.log(`World size: ${WORLD_WIDTH}x${WORLD_HEIGHT}`);
}

function updateUI() {
    const scoreElement = document.getElementById('score');
    const livesElement = document.getElementById('lives');
    const levelElement = document.getElementById('level');
    const userElement = document.getElementById('user-display'); // Get user display element

    if (scoreElement) scoreElement.textContent = `Score: ${score}`;
    if (livesElement) livesElement.textContent = `Lives: ${lives}`;
    if (levelElement) levelElement.textContent = `Level: ${level}`;
    // Update user display, show placeholder if no user
    if (userElement) {
        userElement.textContent = `User: ${currentUser || '---'}`;
        userElement.style.display = (currentGameState === GameState.PROMPT_USER) ? 'none' : 'block'; // Hide in prompt state
    }
}

function handleInput(deltaTime) {
    audioManager.resumeContext();

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
                    // Handle string options (High Scores, Achievements, Help, Reset, Change User)
                    switch (selectedOption) {
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
                        case 'Reset Data':
                            if (currentUser && confirm(`Are you sure you want to reset all data for user '${currentUser}'?`)) {
                                console.log(`Resetting data for user: ${currentUser}`);
                                persistenceManager.resetUserData(currentUser);
                                highScores = [];
                                achievementManager.loadUserAchievements(currentUser);
                                alert("User data reset.");
                            }
                            break;
                        case 'Change User':
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
            if (!currentUser || !ship || !ship.isAlive) return;
            if (inputHandler.isPressed('rotateLeft')) ship.rotate(-1, deltaTime);
            if (inputHandler.isPressed('rotateRight')) ship.rotate(1, deltaTime);
            if (inputHandler.isPressed('thrust')) ship.thrust(deltaTime);
            else ship.isThrusting = false;

            // Log fire button state and then attempt fire
            const firePressed = inputHandler.isPressed('fire');
            console.log(`PLAYING Input Check: firePressed=${firePressed}`); // Keep log active
            if (firePressed) {
                ship.fire(bullets, audioManager);
            }

            if (inputHandler.consumeAction('hyperspace')) {
                if (ship.hyperspace(canvas.width, canvas.height, asteroids, ufos, audioManager)) {
                    if (!ship.isAlive) handlePlayerDeath(true);
                }
            }
            if (inputHandler.consumeAction('pause') || inputHandler.consumeAction('escape')) {
                console.log("Consumed pause/escape (to PAUSED)");
                currentGameState = GameState.PAUSED;
                pauseMenuSelectionIndex = 0; // Reset pause menu selection when pausing
                audioManager.stopThrustSound();
                audioManager.stopUfoHum();
                console.log("Game Paused");
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
            if (inputHandler.consumeAction('menuSelect')) {
                 currentGameState = GameState.MENU;
                 menuSelectionIndex = 0;
                 pausedGameExists = false;
            }
            break;
    }

    // Global Mute Toggle
    if (inputHandler.consumeAction('toggleMute')) {
        audioManager.toggleMute();
    }
}

function updateGame(deltaTime) {
    handleInput(deltaTime);
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
    ufos.forEach(ufo => {
        if(ufo.isAlive) {
             ufo.update(deltaTime, canvas.width, canvas.height, ship, bullets, audioManager, selectedDifficulty, asteroids, Camera.x, Camera.y);
             wrapWorldPosition(ufo);
             if (ufo.isOnScreen) {
                 visibleUfoExists = true;
             }
        }
    });

    // Only play UFO hum when a UFO is actually visible on screen
    if (visibleUfoExists && !audioManager.isMuted) audioManager.startUfoHum();
    else audioManager.stopUfoHum();

    checkCollisions();

    bullets = bullets.filter(bullet => bullet.isAlive);
    asteroids = asteroids.filter(asteroid => asteroid.isAlive);
    ufos = ufos.filter(ufo => ufo.isAlive);

    updateUfoSpawning(deltaTime);

    // Level up when all asteroids are cleared (classic Asteroids style)
    if (asteroids.length === 0 && ufos.length === 0 && respawnTimer <= 0 && ship && ship.isAlive) {
        levelUp();
    }

    const currentSnapshot = { score: score, level: level, user: currentUser };
    achievementManager.checkUnlockConditions(currentSnapshot);

    updateUI();
}

function renderGame() {
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // console.log(`[renderGame] Current state: ${currentGameState}`); // Optional: Log state every frame
    switch (currentGameState) {
        case GameState.PROMPT_USER:
            console.log("[renderGame] Calling drawUserPrompt"); // Log drawing call
            drawUserPrompt();
            break;
        case GameState.MENU:
            console.log("[renderGame] Rendering MENU state"); // Log drawing call
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
            const menuStartY = canvas.height * 0.45;
            const menuLineHeight = 30;

            // Regenerate options based on paused state for render
            currentMenuOptions = [...menuOptionBaseTexts];
            if (pausedGameExists) currentMenuOptions[0] = 'Resume';
            else currentMenuOptions[0] = 'Start';
            currentMenuOptions.push(...Object.values(Difficulty)); // Add difficulties

            // Adjust index bounds safely before rendering
             if (menuSelectionIndex >= currentMenuOptions.length) {
                menuSelectionIndex = 0;
             }

            currentMenuOptions.forEach((option, index) => {
                const isSelected = index === menuSelectionIndex;
                ctx.fillStyle = isSelected ? 'yellow' : 'white';
                let text = '';
                if (typeof option === 'string') {
                    text = option;
                } else { // Difficulty object
                    text = option.name;
                    if (option === selectedDifficulty) {
                        text += " (Selected)";
                        if (!isSelected) ctx.fillStyle = 'cyan';
                    }
                }
                ctx.fillText(text, canvas.width / 2, menuStartY + index * menuLineHeight);
            });
            break;

        case GameState.PLAYING:
            // Draw starfield background (parallax effect)
            drawStarfield();

            // Apply camera transformation for game objects
            ctx.save();
            ctx.translate(-Camera.x, -Camera.y);

            // Draw all entities with wrapping support for seamless scrolling
            if (ship && ship.isAlive && respawnTimer <= 0) drawEntityWrapped(ship, ctx);
            asteroids.forEach(asteroid => drawEntityWrapped(asteroid, ctx));
            bullets.forEach(bullet => drawEntityWrapped(bullet, ctx));
            ufos.forEach(ufo => drawEntityWrapped(ufo, ctx));

            ctx.restore();

            // Draw level up notification (screen-space, not world-space)
            drawLevelUpNotification();

            // Draw remaining asteroids count
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.font = '14px Arial';
            ctx.textAlign = 'left';
            ctx.fillText(`Asteroids: ${asteroids.length}`, 10, canvas.height - 10);

            drawAchievementNotifications();
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
            drawAchievementNotifications();
            break;

        case GameState.HIGH_SCORES:
            drawHighScores(allHighScores, allAchievements);
            break;

        case GameState.ACHIEVEMENTS:
            drawAchievements();
            break;

        case GameState.HELP:
            drawHelpScreen();
            break;

        case GameState.GAME_OVER:
            drawCenterText("GAME OVER", `Final Score: ${finalScore}`);
            ctx.font = '20px Arial';
            ctx.fillText("Press Space or Enter for Menu", canvas.width / 2, canvas.height / 2 + 60);
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
function gameLoop(timestamp = 0) {
    const rawDeltaTime = (timestamp - lastTime) / 1000;
    const deltaTime = Math.min(rawDeltaTime, 1 / 20);
    lastTime = timestamp;
    updateGame(deltaTime);
    renderGame();
    requestAnimationFrame(gameLoop);
}

// --- Helper Functions ---

function createLevelAsteroids() {
    console.log(`Creating asteroids for level ${level} (Difficulty: ${selectedDifficulty.name})`);
    asteroids = [];

    // Calculate number of asteroids for this level
    const numAsteroids = BASE_ASTEROIDS_PER_LEVEL + (level - 1) * ASTEROIDS_PER_LEVEL_INCREASE;
    const playerX = ship ? ship.x : WORLD_WIDTH / 2;
    const playerY = ship ? ship.y : WORLD_HEIGHT / 2;

    console.log(`Spawning ${numAsteroids} asteroids across ${WORLD_SCREENS_X}x${WORLD_SCREENS_Y} world`);

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

        asteroids.push(new Asteroid(x, y, size, null, selectedDifficulty.asteroidSpeedMultiplier));
    }
}

function checkCollisions() {
    if (ship && ship.isAlive && !ship.isInvulnerable) {
        for (const asteroid of asteroids) {
            if (asteroid.isAlive && ship.collidesWith(asteroid)) {
                if (asteroid.isGreen()) {
                    // GREEN asteroid: Collect it for points!
                    console.log("Collision: Ship <-> Green Asteroid (Collected!)");
                    const scoreGained = Math.round(asteroid.scoreValue * selectedDifficulty.scoreMultiplier);
                    updateScore(scoreGained);
                    asteroid.destroy();
                    // Play collection sound
                    if (audioManager) {
                        audioManager.play('collectGreen');
                    }
                    achievementManager.trackAsteroidCollected();
                } else {
                    // RED asteroid: Lose a life!
                    console.log("Collision: Ship <-> Red Asteroid (Damage!)");
                    handlePlayerDeath();
                    asteroid.split(asteroids, audioManager);
                    return;
                }
            }
        }

        for (const ufo of ufos) {
            if (ufo.isAlive && ship.collidesWith(ufo)) {
                console.log("Collision: Ship <-> UFO");
                handlePlayerDeath();
                ufo.destroy(audioManager);
                return;
            }
        }

        for (const bullet of bullets) {
            if (bullet.isAlive && !bullet.isPlayerBullet && ship.collidesWith(bullet)) {
                console.log("Collision: Ship <-> UFO Bullet");
                handlePlayerDeath();
                bullet.destroy();
                return;
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

                if (asteroid.isGreen()) {
                    // Shooting green asteroids: NO points! (wasteful - should collect instead)
                    console.log("Collision: Player Bullet <-> Green Asteroid (Wasted!)");
                    asteroid.split(asteroids, audioManager); // Just destroys, no children
                } else {
                    // Shooting red asteroids: Good! They split but no points
                    console.log("Collision: Player Bullet <-> Red Asteroid (Destroyed!)");
                    asteroid.split(asteroids, audioManager);
                    achievementManager.trackAsteroidDestroyed();
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
                const scoreGained = Math.round(ufo.scoreValue * selectedDifficulty.scoreMultiplier);
                updateScore(scoreGained);
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
}

function handlePlayerDeath(forced = false) {
    let destroyed = forced;
    if (ship && !forced) {
        destroyed = ship.destroy(audioManager, forced);
    }

    if (destroyed) {
        console.log(`Player death handled. Lives left: ${lives - 1}`);
        audioManager.stopThrustSound();
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
         respawnTimer = 0;
         audioManager.stopThrustSound();

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

    // Create new asteroids for this level
    createLevelAsteroids();

    // Reset UFO spawn timer for new level
    resetUfoSpawnTimer();

    updateUI();
    achievementManager.checkUnlockConditions({ score: score, level: level, user: currentUser });
}

function gameOver() {
    console.log("Game Over!");
    finalScore = score;
    currentGameState = GameState.GAME_OVER;
    pausedGameExists = false;
    if(ship) {
        ship.isThrusting = false;
    }
    audioManager.stopThrustSound();
    audioManager.stopUfoHum();
    checkAndAddHighScore(finalScore);
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
    ctx.fillText("Press Space/Enter/Esc to return", canvas.width / 2, canvas.height - 40);
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
    ctx.fillText("Press Space/Enter/Esc to return", canvas.width / 2, canvas.height - 40);
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
        nextExtraLifeScore += EXTRA_LIFE_SCORE;
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
        ctx.fillText(option, canvas.width / 2, pauseStartY + index * pauseLineHeight);
    });

    ctx.font = '16px Arial';
    ctx.fillStyle = 'lightgray';
    ctx.fillText("(Press P or Esc to Resume)", canvas.width / 2, canvas.height * 0.75 - 20);
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

    const controls = [
        { action: 'Rotate Left/Right', keys: 'Arrow Keys / A,D' },
        { action: 'Thrust Forward', keys: 'Up Arrow / W' },
        { action: 'Fire', keys: 'Spacebar' },
        { action: 'Hyperspace (Risky!)', keys: 'H' },
        { action: 'Pause Game', keys: 'P / Escape' },
        { action: 'Toggle Mute', keys: 'M' },
    ];

    controls.forEach((ctrl, index) => {
        ctx.fillText(ctrl.action + ":", controlsX, helpStartY + index * helpLineHeight);
        ctx.fillText(ctrl.keys, keysX, helpStartY + index * helpLineHeight);
    });

    ctx.textAlign = 'center';
    ctx.font = '16px Arial';
    ctx.fillText("Press Space/Enter/Esc to return", canvas.width / 2, canvas.height - 30);
}

function drawUserPrompt() {
    console.log("[drawUserPrompt] Drawing prompt screen"); // Log drawing execution
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.font = '24px Arial';
    ctx.fillText("Enter Username (3-10 chars):", canvas.width / 2, canvas.height / 3);

    ctx.font = '30px Arial';
    ctx.fillStyle = 'yellow';
    const showCursor = Math.floor(Date.now() / 500) % 2 === 0;
    const textToDraw = promptInput + (showCursor ? '_' : '');
    ctx.fillText(textToDraw, canvas.width / 2, canvas.height / 2);

    ctx.font = '18px Arial';
    ctx.fillStyle = 'white';
    ctx.fillText("(Press Enter when done)", canvas.width / 2, canvas.height / 2 + 40);
}

// Export necessary functions/variables if using modules elsewhere
// export { canvas, ctx, score, lives, level }; 