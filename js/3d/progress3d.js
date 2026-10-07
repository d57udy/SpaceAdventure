// 3D progression bridge (docs/plans/07-3d-game.md §4): a separate 3D high-score board, and
// the 2D game's credits, upgrades and achievements shared through the same modules and keys.
// DOM-free: storage comes in through the injected PersistenceManager (js/persistence.js).
//
// Credit rule (as 2D js/main.js awardPoints): every scoring event earns ceil(10 % of the
// points) in upgrade credits unless a different amount is given (2D: 20 per boss weak point,
// 20 % of the boss score for the boss). Only a signed-in profile earns credits.

import { UpgradeState } from '../upgrades.js';
import { AchievementManager } from '../achievementManager.js';
import { insertHighScore, MAX_HIGH_SCORES } from '../persistence.js';
import { nameInitials } from '../names.js';

/** Default credits for a scoring event (2D awardPoints). */
export const creditsFor = (points) => Math.ceil(points * 0.1);

/**
 * Upgrade levels as 3D ship multipliers (plan 07 §3). Direct control follows the phone 1:1,
 * so turnRateMult only applies to Rate and Joystick.
 */
export function shipMods3d(upgrades) {
    const u = upgrades || UpgradeState.zero();
    return {
        pickupRadiusMult: u.getCollectionRadiusMult(),
        accelMult: u.getThrustMult(),
        extraLives: u.getExtraStartingLives(),
        turnRateMult: u.getTurnSpeedMult(),
        powerUpDurationMult: u.getPowerUpDurationMult(),
    };
}

/**
 * @param {object} o
 * @param {object} o.persistence - a PersistenceManager (or the same API)
 * @param {string|null} [o.user] - profile; default: the persistence's current user. null = guest
 * @param {object} [o.achievementDefs] - override the achievement definitions (tests)
 */
export function createProgress3d({ persistence, user, achievementDefs } = {}) {
    const profile = user !== undefined ? user : (persistence && persistence.getCurrentUser ? persistence.getCurrentUser() : null);
    const upgrades = profile ? new UpgradeState() : UpgradeState.zero();
    if (profile) upgrades.load(persistence, profile);
    const achievements = new AchievementManager(persistence);
    if (achievementDefs) achievements.definitions = achievementDefs;
    achievements.loadUserAchievements(profile || null);

    let score = 0;
    let level = 1;
    let creditsEarned = 0;

    const api = {
        user: profile || null,
        upgrades,
        achievements,
        get score() { return score; },
        get level() { return level; },
        get creditsEarned() { return creditsEarned; },
        /** Upgrade levels as 3D multipliers. */
        ship() { return shipMods3d(upgrades); },
        /** Starting lives for a difficulty's base lives (plus the Starting Lives upgrade). */
        startingLives(base) { return base + upgrades.getExtraStartingLives(); },
        /** A new 3D game: session counters reset; credits, upgrades and achievements stay. */
        startGame() {
            score = 0;
            level = 1;
            creditsEarned = 0;
            achievements.resetSessionStats();
        },
        /** A scoring event: total score (for achievements) and credits. */
        awardPoints(points, credits = creditsFor(points)) {
            if (!(points > 0)) return;
            score += points;
            achievements.checkUnlockConditions({ score, level });
            if (credits > 0 && profile && upgrades.persistent) {
                upgrades.addCurrency(credits);
                creditsEarned += credits;
            }
        },
        /** Credits without points (rare; e.g. a bonus). */
        addCredits(credits) {
            if (credits > 0 && profile && upgrades.persistent) {
                upgrades.addCurrency(credits);
                creditsEarned += credits;
            }
        },
        setLevel(n) {
            level = n;
            achievements.checkUnlockConditions({ score, level });
        },
        trackRockDestroyed() { achievements.trackAsteroidDestroyed(); },
        trackUfoDestroyed() { achievements.trackUfoDestroyed(); },
        trackCrystalCollected() { achievements.trackAsteroidCollected(); },
        /** Achievements unlocked since the last call (for a toast). */
        takeUnlocked() {
            const out = achievements.recentlyUnlocked.slice();
            achievements.recentlyUnlocked = [];
            return out;
        },
        /** Save credits now (pause, page hidden). */
        save() {
            if (profile) upgrades.save(persistence, profile);
        },
        /** Would this score make the 3D board? */
        qualifies(finalScore) {
            if (!profile || !(finalScore > 0)) return false;
            return insertHighScore(persistence.loadHighScores3d(profile), { score: finalScore }).index !== -1;
        },
        /**
         * End of a 3D game: save credits and add the score to the 3D board.
         * @returns {{ rank: number }} 0-based place on the user's 3D board, -1 when not on it
         */
        finishGame(finalScore = score, { name } = {}) {
            api.save();
            if (!profile || !(finalScore > 0)) return { rank: -1 };
            const entry = { name: nameInitials(name || profile, 3), score: finalScore, level };
            const { scores, index } = insertHighScore(persistence.loadHighScores3d(profile), entry, MAX_HIGH_SCORES);
            if (index !== -1) persistence.saveHighScores3d(profile, scores);
            return { rank: index };
        },
        /** This user's 3D board (best first). */
        highScores() { return profile ? persistence.loadHighScores3d(profile) : []; },
        /** Every user's 3D board combined (best first), as the 2D High Scores screen shows. */
        allHighScores() { return persistence.loadHighScores3d(); },
    };
    return api;
}
