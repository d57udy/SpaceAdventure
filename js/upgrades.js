/**
 * Ship upgrades per profile (plan 05 §1.1). Replaces the ShipUpgrades singleton in main.js.
 *
 * Pure module: persistence is injected (any object with loadUpgrades(user) and
 * saveUpgrades(user, data), such as PersistenceManager).
 */

export const UPGRADE_DEFS = Object.freeze({
    collectionRadius: Object.freeze({
        name: 'Collection Radius', maxLevel: 5,
        cost: Object.freeze([500, 1000, 2000, 4000, 8000]),
        description: '+10% collection range per level'
    }),
    thrustPower: Object.freeze({
        name: 'Thrust Power', maxLevel: 5,
        cost: Object.freeze([500, 1000, 2000, 4000, 8000]),
        description: '+15% thrust speed per level'
    }),
    startingLives: Object.freeze({
        name: 'Starting Lives', maxLevel: 3,
        cost: Object.freeze([2000, 5000, 10000]),
        description: '+1 starting life per level'
    }),
    turnSpeed: Object.freeze({
        name: 'Turn Speed', maxLevel: 5,
        cost: Object.freeze([300, 600, 1200, 2400, 4800]),
        description: '+10% turn speed per level'
    }),
    powerUpDuration: Object.freeze({
        name: 'Power-Up Duration', maxLevel: 5,
        cost: Object.freeze([400, 800, 1600, 3200, 6400]),
        description: '+20% power-up duration per level'
    })
});

function zeroLevels() {
    const levels = {};
    for (const k of Object.keys(UPGRADE_DEFS)) levels[k] = 0;
    return levels;
}

export class UpgradeState {
    constructor() {
        this.upgrades = UPGRADE_DEFS;
        /** False for zero() states: they never load, save, earn or buy. */
        this.persistent = true;
        this.levels = zeroLevels();
        this.currency = 0;
    }

    /** Standard ship for guests and fairness modes. Never saves and stays at zero. */
    static zero() {
        const s = new UpgradeState();
        s.persistent = false;
        return s;
    }

    /** Resets to defaults first so a previous user's credits and levels never carry over. */
    load(persistenceManager, user) {
        if (!this.persistent || !persistenceManager || !user) return;
        const data = persistenceManager.loadUpgrades(user);
        this.reset();
        if (data) {
            this.levels = { ...this.levels, ...(data.levels || {}) };
            this.currency = data.currency || 0;
        }
    }

    save(persistenceManager, user) {
        if (!this.persistent || !persistenceManager || !user) return;
        persistenceManager.saveUpgrades(user, { levels: this.levels, currency: this.currency });
    }

    addCurrency(amount) {
        if (!this.persistent) return;
        this.currency += amount;
    }

    canAfford(upgradeKey) {
        const upgrade = this.upgrades[upgradeKey];
        if (!upgrade) return false;
        const currentLevel = this.levels[upgradeKey];
        if (currentLevel >= upgrade.maxLevel) return false;
        return this.currency >= upgrade.cost[currentLevel];
    }

    purchase(upgradeKey, persistenceManager, user) {
        if (!this.persistent || !this.canAfford(upgradeKey)) return false;
        const upgrade = this.upgrades[upgradeKey];
        this.currency -= upgrade.cost[this.levels[upgradeKey]];
        this.levels[upgradeKey]++;
        this.save(persistenceManager, user);
        return true;
    }

    getCollectionRadiusMult() { return 1 + this.levels.collectionRadius * 0.1; }
    getThrustMult() { return 1 + this.levels.thrustPower * 0.15; }
    getExtraStartingLives() { return this.levels.startingLives; }
    getTurnSpeedMult() { return 1 + this.levels.turnSpeed * 0.1; }
    getPowerUpDurationMult() { return 1 + this.levels.powerUpDuration * 0.2; }

    reset() {
        this.levels = zeroLevels();
        this.currency = 0;
    }
}
