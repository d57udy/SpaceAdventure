const HIGH_SCORES_BASE_KEY = 'asteroids_highScores';
const ACHIEVEMENTS_BASE_KEY = 'asteroids_achievements';
const UPGRADES_BASE_KEY = 'asteroids_upgrades';
const TUTORIAL_BASE_KEY = 'asteroids_tutorial';
const CURRENT_USER_KEY = 'asteroids_currentUser';
const USER_LIST_KEY = 'asteroids_userList'; // Key for storing known usernames

export class PersistenceManager {
    constructor() {
        this.currentUser = undefined;
        if (!this.isLocalStorageAvailable()) {
            console.warn("localStorage is not available. High scores and achievements will not be saved.");
        }
    }

    isLocalStorageAvailable() {
        // Only probe read access: a write probe fails when storage is full (or in
        // old Safari private mode), which would wrongly hide existing saved data.
        // Individual writes are wrapped in try/catch anyway.
        try {
            const storage = window.localStorage;
            if (!storage) return false;
            storage.getItem('__testLocalStorage__');
            return true;
        } catch (e) {
            return false;
        }
    }

    // --- User Management --- 
    setCurrentUser(username) {
        // Keep the in-memory cache correct even if storage is unavailable
        this.currentUser = username ? username : null;
        if (!this.isLocalStorageAvailable()) return;
        try {
            if (username) {
                localStorage.setItem(CURRENT_USER_KEY, username);
                this.currentUser = username;
                this.addUserToList(username); // Add user to the list when set
                console.log(`Current user set to: ${username}`);
            } else {
                // Explicitly remove the key if username is null/undefined/empty
                localStorage.removeItem(CURRENT_USER_KEY);
                this.currentUser = null;
                console.log("Current user cleared.");
            }
        } catch (error) {
            console.error("Error setting/clearing current user:", error);
        }
    }

    getCurrentUser() {
        if (this.currentUser !== undefined) return this.currentUser; // Return cached if already determined (even null)
        if (!this.isLocalStorageAvailable()) return null;
        try {
            const user = localStorage.getItem(CURRENT_USER_KEY);
            // Return null if the stored value is null, undefined, or an empty string
            this.currentUser = (user && user.trim().length > 0) ? user : null;
            console.log(`Loaded current user from storage: ${this.currentUser}`);
            return this.currentUser;
        } catch (error) {
            console.error("Error getting current user:", error);
            this.currentUser = null; // Ensure cache is null on error
            return null;
        }
    }

    // Add a user to the list of known users
    addUserToList(username) {
        if (!this.isLocalStorageAvailable() || !username) return;
        try {
            let userList = this.getAllUsernames(); // Get current list
            // Data keys are upper-cased, so treat usernames case-insensitively
            const upper = username.toUpperCase();
            if (!userList.some(u => u.toUpperCase() === upper)) {
                userList.push(username);
                localStorage.setItem(USER_LIST_KEY, JSON.stringify(userList));
                console.log(`User ${username} added to list.`);
            }
        } catch (error) {
            console.error("Error adding user to list:", error);
        }
    }

    // Get the list of all known users
    getAllUsernames() {
        if (!this.isLocalStorageAvailable()) return [];
        try {
            const storedList = localStorage.getItem(USER_LIST_KEY);
            if (storedList) {
                const list = JSON.parse(storedList);
                if (Array.isArray(list)) {
                    // Drop corrupt entries and case-insensitive duplicates (data keys are
                    // upper-cased, so 'bob' and 'BOB' share data and would double-count)
                    const seen = new Set();
                    return list.filter(u => {
                        if (typeof u !== 'string' || u.trim().length === 0) return false;
                        const upper = u.toUpperCase();
                        if (seen.has(upper)) return false;
                        seen.add(upper);
                        return true;
                    });
                }
            }
        } catch (error) {
            console.error("Error loading user list:", error);
        }
        return []; // Return empty array on error or if not found
    }

    // --- Data Management (User Specific & Combined) --- 

    _getUserSpecificKey(baseKey, username) {
        if (!username || typeof username !== 'string') {
            console.warn(`Cannot generate key for base ${baseKey} without a username.`);
            return null;
        }
        // Simple key generation: base_USERNAME
        return `${baseKey}_${username.toUpperCase()}`;
    }

    saveHighScores(username, scores) {
        const key = this._getUserSpecificKey(HIGH_SCORES_BASE_KEY, username);
        if (!key || !this.isLocalStorageAvailable()) return;
        try {
            localStorage.setItem(key, JSON.stringify(scores));
            console.log(`High scores saved for user: ${username}`);
        } catch (error) {
            console.error(`Error saving high scores for ${username}:`, error);
        }
    }

    // Load scores either for a specific user or all users
    loadHighScores(username = null) {
        if (username) {
            // Load for specific user (existing logic)
            const key = this._getUserSpecificKey(HIGH_SCORES_BASE_KEY, username);
            if (!key || !this.isLocalStorageAvailable()) return [];
            try {
                const storedScores = localStorage.getItem(key);
                if (storedScores) {
                    const scores = JSON.parse(storedScores);
                    if (Array.isArray(scores)) {
                        console.log(`High scores loaded for user: ${username}`);
                        // Add username to each entry for consistency when combining later.
                        // Skip corrupt entries (non-objects / non-numeric scores).
                        return scores
                            .filter(s => s && typeof s === 'object' && Number.isFinite(s.score))
                            .map(s => ({ ...s, user: username }));
                    }
                    console.warn(`Invalid high score data found for user ${username}.`);
                }
            } catch (error) {
                console.error(`Error loading high scores for ${username}:`, error);
            }
            return [];
        } else {
            // Load for ALL users
            console.log("Loading high scores for all users...");
            const allUsernames = this.getAllUsernames();
            let combinedScores = [];
            allUsernames.forEach(user => {
                const userScores = this.loadHighScores(user); // Recursive call for specific user
                combinedScores = combinedScores.concat(userScores);
            });
            // Sort combined scores descending
            combinedScores.sort((a, b) => b.score - a.score);
            // Trim to max length (optional, could be done in main.js)
            // combinedScores = combinedScores.slice(0, MAX_HIGH_SCORES);
            console.log("Combined high scores loaded.");
            return combinedScores;
        }
    }

    saveAchievements(username, unlockedAchievementIds) {
        const key = this._getUserSpecificKey(ACHIEVEMENTS_BASE_KEY, username);
        if (!key || !this.isLocalStorageAvailable()) return;
        try {
            localStorage.setItem(key, JSON.stringify(Array.from(unlockedAchievementIds)));
            console.log(`Achievements saved for user: ${username}`);
        } catch (error) {
            console.error(`Error saving achievements for ${username}:`, error);
        }
    }

    // Load achievements for a specific user or all users (returns a map)
    loadAchievements(username = null) {
        if (username) {
            // Load for specific user (existing logic)
            const key = this._getUserSpecificKey(ACHIEVEMENTS_BASE_KEY, username);
            if (!key || !this.isLocalStorageAvailable()) return new Set();
            try {
                const storedAchievements = localStorage.getItem(key);
                if (storedAchievements) {
                    const ids = JSON.parse(storedAchievements);
                    if (Array.isArray(ids)) {
                        console.log(`Achievements loaded for user: ${username}`);
                        return new Set(ids.filter(id => typeof id === 'string'));
                    }
                     console.warn(`Invalid achievement data found for user ${username}.`);
                }
            } catch (error) {
                console.error(`Error loading achievements for ${username}:`, error);
            }
            return new Set();
        } else {
            // Load for ALL users into a map
            console.log("Loading achievements for all users...");
            const allUsernames = this.getAllUsernames();
            const achievementsMap = {};
            allUsernames.forEach(user => {
                achievementsMap[user] = this.loadAchievements(user); // Recursive call
            });
            console.log("Combined achievements map loaded.");
            return achievementsMap;
        }
    }

    // --- Upgrades ---
    saveUpgrades(username, upgradeData) {
        const key = this._getUserSpecificKey(UPGRADES_BASE_KEY, username);
        if (!key || !this.isLocalStorageAvailable()) return;
        try {
            localStorage.setItem(key, JSON.stringify(upgradeData));
            console.log(`Upgrades saved for user: ${username}`);
        } catch (error) {
            console.error(`Error saving upgrades for ${username}:`, error);
        }
    }

    loadUpgrades(username) {
        const key = this._getUserSpecificKey(UPGRADES_BASE_KEY, username);
        if (!key || !this.isLocalStorageAvailable()) return null;
        try {
            const storedUpgrades = localStorage.getItem(key);
            if (storedUpgrades) {
                const data = JSON.parse(storedUpgrades);
                if (!data || typeof data !== 'object' || Array.isArray(data)) {
                    console.warn(`Invalid upgrade data found for user ${username}.`);
                    return null;
                }
                // Sanitize numeric fields so corrupt values can't produce NaN in the game
                let levels; // left undefined if missing so callers keep their defaults
                if (data.levels && typeof data.levels === 'object') {
                    levels = {};
                    for (const key in data.levels) {
                        const lvl = Number(data.levels[key]);
                        levels[key] = Number.isFinite(lvl) && lvl > 0 ? Math.floor(lvl) : 0;
                    }
                }
                const currency = Number(data.currency);
                console.log(`Upgrades loaded for user: ${username}`);
                return {
                    levels,
                    currency: Number.isFinite(currency) && currency > 0 ? currency : 0
                };
            }
        } catch (error) {
            console.error(`Error loading upgrades for ${username}:`, error);
        }
        return null;
    }

    // --- Tutorial (first-game training) ---
    // { asked, done, skipped, version } per user; null when never offered (or corrupt).
    saveTutorialState(username, { asked = true, done = false, skipped = false, version = 1 } = {}) {
        const key = this._getUserSpecificKey(TUTORIAL_BASE_KEY, username);
        if (!key || !this.isLocalStorageAvailable()) return;
        try {
            localStorage.setItem(key, JSON.stringify({
                asked: !!asked, done: !!done, skipped: !!skipped,
                version: Number.isFinite(Number(version)) ? Number(version) : 1,
            }));
        } catch (error) {
            console.error(`Error saving tutorial state for ${username}:`, error);
        }
    }

    loadTutorialState(username) {
        const key = this._getUserSpecificKey(TUTORIAL_BASE_KEY, username);
        if (!key || !this.isLocalStorageAvailable()) return null;
        try {
            const stored = localStorage.getItem(key);
            if (!stored) return null;
            const data = JSON.parse(stored);
            if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
            const version = Number(data.version);
            return {
                asked: data.asked === true || data.done === true,
                done: data.done === true,
                skipped: data.skipped === true,
                version: Number.isFinite(version) ? version : 1,
            };
        } catch (error) {
            console.error(`Error loading tutorial state for ${username}:`, error);
            return null;
        }
    }

    // --- Reset ---
    resetUserData(username) {
        if (!username || !this.isLocalStorageAvailable()) return;
        console.warn(`Resetting all data for user: ${username}`);
        try {
            const hsKey = this._getUserSpecificKey(HIGH_SCORES_BASE_KEY, username);
            const acKey = this._getUserSpecificKey(ACHIEVEMENTS_BASE_KEY, username);
            const upKey = this._getUserSpecificKey(UPGRADES_BASE_KEY, username);
            const tuKey = this._getUserSpecificKey(TUTORIAL_BASE_KEY, username);
            if (hsKey) localStorage.removeItem(hsKey);
            if (tuKey) localStorage.removeItem(tuKey); // the tutorial is offered again
            if (acKey) localStorage.removeItem(acKey);
            if (upKey) localStorage.removeItem(upKey);
            console.log(`Data reset for user: ${username}`);
            // After resetting, if it was the current user, clear the current user setting
            const sameUser = (name) => typeof name === 'string' && name.toUpperCase() === username.toUpperCase();
            if (sameUser(this.currentUser)) {
                this.setCurrentUser(null);
            }
            // If resetting the currently active user, also clear the global user setting
            if (sameUser(localStorage.getItem(CURRENT_USER_KEY))) {
                localStorage.removeItem(CURRENT_USER_KEY);
                this.currentUser = null; // Update internal cache
            }
        } catch (error) {
            console.error(`Error resetting data for user ${username}:`, error);
        }
    }
} 