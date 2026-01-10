import { Achievements } from './achievements.js';

export class AchievementManager {
    constructor(persistenceManager) {
        this.persistenceManager = persistenceManager;
        this.currentUser = null; // Will be set by main.js
        this.unlockedAchievementIds = new Set(); // Start empty until user is loaded
        this.definitions = Achievements;
        this.sessionStats = {
            asteroidsDestroyed: 0,
            ufosDestroyed: 0,
            asteroidsCollected: 0,  // Green asteroids collected
        };
        this.recentlyUnlocked = [];
        this.notificationTimer = 0;
        this.NOTIFICATION_DURATION = 3;
        console.log("AchievementManager initialized (waiting for user data).");
    }

    // Call this when the user is identified or changes
    loadUserAchievements(username) {
        this.currentUser = username;
        this.unlockedAchievementIds = this.persistenceManager && this.currentUser
            ? this.persistenceManager.loadAchievements(this.currentUser)
            : new Set();
        this.resetSessionStats();
        console.log(`Achievements loaded for user: ${this.currentUser || 'None'}. Unlocked:`, this.unlockedAchievementIds);
    }

    resetSessionStats() {
        console.log("Resetting achievement session stats.");
        for (const key in this.sessionStats) {
            this.sessionStats[key] = 0;
        }
        this.recentlyUnlocked = [];
        this.notificationTimer = 0;
    }

    // Note: resetAllAchievements is now handled by resetUserData in main.js
    // It will call loadUserAchievements after resetting in PersistenceManager

    // --- Stat Update Methods --- Call these from main game logic ---
    trackAsteroidDestroyed() {
        if (!this.currentUser) return; // Don't track if no user
        this.sessionStats.asteroidsDestroyed++;
        this.checkUnlockConditions();
    }

    trackUfoDestroyed() {
        if (!this.currentUser) return;
        this.sessionStats.ufosDestroyed++;
        this.checkUnlockConditions();
    }

    trackAsteroidCollected() {
        if (!this.currentUser) return;
        this.sessionStats.asteroidsCollected++;
        this.checkUnlockConditions();
    }

    // Call this periodically or when stats change significantly
    checkUnlockConditions(gameState = {}) {
         if (!this.currentUser) return; // Need a user context
        let newUnlockOccurred = false;
        // Ensure gameState includes user
        const stateWithUser = { ...gameState, user: this.currentUser };

        for (const key in this.definitions) {
            const achievement = this.definitions[key];
            if (!this.unlockedAchievementIds.has(achievement.id)) {
                if (this.isConditionMet(achievement.condition, stateWithUser)) {
                    this.unlockAchievement(achievement);
                    newUnlockOccurred = true;
                }
            }
        }
        if (newUnlockOccurred && this.persistenceManager) {
            this.persistenceManager.saveAchievements(this.currentUser, this.unlockedAchievementIds);
        }
    }

    isConditionMet(condition, gameState) {
        if (!condition || !gameState) return false;
        // Pass through gameState which includes user, score, level etc.
        switch (condition.type) {
            case 'score':
                return gameState.score !== undefined && gameState.score >= condition.value;
            case 'level':
                return gameState.level !== undefined && gameState.level >= condition.value;
            case 'stat':
                return this.sessionStats[condition.stat] !== undefined &&
                       this.sessionStats[condition.stat] >= condition.value;
            default:
                return false;
        }
    }

    unlockAchievement(achievement) {
        if (!this.currentUser || this.unlockedAchievementIds.has(achievement.id)) return;

        console.log(`%cAchievement Unlocked [${this.currentUser}]: ${achievement.name}!`, 'color: yellow; font-weight: bold;');
        this.unlockedAchievementIds.add(achievement.id);
        this.recentlyUnlocked.push(achievement);
        this.notificationTimer = this.NOTIFICATION_DURATION;
        // Save immediately on unlock
        if (this.persistenceManager) {
            this.persistenceManager.saveAchievements(this.currentUser, this.unlockedAchievementIds);
        }
    }

    // Update notification timer (call from main game loop)
    updateNotifications(deltaTime) {
        if (this.notificationTimer > 0) {
            this.notificationTimer -= deltaTime;
            if (this.notificationTimer <= 0) {
                this.recentlyUnlocked = []; // Clear notifications after timer expires
            }
        }
    }

    // Get notifications for rendering
    getActiveNotifications() {
        return this.notificationTimer > 0 ? this.recentlyUnlocked : [];
    }

    isUnlocked(achievementId) {
        return this.unlockedAchievementIds.has(achievementId);
    }

    getAllAchievementsStatus() {
        const status = [];
        for (const key in this.definitions) {
            const achievement = this.definitions[key];
            status.push({
                ...achievement,
                unlocked: this.isUnlocked(achievement.id)
            });
        }
        // Optionally sort them (e.g., unlocked first or by name)
        status.sort((a, b) => a.name.localeCompare(b.name));
        return status;
    }
} 