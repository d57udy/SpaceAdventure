import { test } from 'node:test';
import assert from 'node:assert/strict';

const { UpgradeState, UPGRADE_DEFS } = await import('../../js/upgrades.js');

function fakePersistence(initial = {}) {
    const store = { ...initial };
    return {
        store,
        saves: 0,
        loadUpgrades(user) { return store[user] ? structuredClone(store[user]) : null; },
        saveUpgrades(user, data) { this.saves++; store[user] = structuredClone(data); }
    };
}

test('multipliers match ShipUpgrades', () => {
    const u = new UpgradeState();
    assert.equal(u.getCollectionRadiusMult(), 1);
    assert.equal(u.getThrustMult(), 1);
    assert.equal(u.getExtraStartingLives(), 0);
    assert.equal(u.getTurnSpeedMult(), 1);
    assert.equal(u.getPowerUpDurationMult(), 1);
    u.levels = { collectionRadius: 3, thrustPower: 2, startingLives: 2, turnSpeed: 5, powerUpDuration: 4 };
    assert.equal(u.getCollectionRadiusMult(), 1 + 3 * 0.1);
    assert.equal(u.getThrustMult(), 1 + 2 * 0.15);
    assert.equal(u.getExtraStartingLives(), 2);
    assert.equal(u.getTurnSpeedMult(), 1 + 5 * 0.1);
    assert.equal(u.getPowerUpDurationMult(), 1 + 4 * 0.2);
});

test('definitions match today', () => {
    assert.deepEqual(Object.keys(UPGRADE_DEFS), ['collectionRadius', 'thrustPower', 'startingLives', 'turnSpeed', 'powerUpDuration']);
    assert.deepEqual([...UPGRADE_DEFS.startingLives.cost], [2000, 5000, 10000]);
    assert.equal(UPGRADE_DEFS.startingLives.maxLevel, 3);
    assert.deepEqual([...UPGRADE_DEFS.turnSpeed.cost], [300, 600, 1200, 2400, 4800]);
});

test('purchase deducts credits, raises level and saves', () => {
    const pm = fakePersistence();
    const u = new UpgradeState();
    u.addCurrency(1200);
    assert.equal(u.canAfford('turnSpeed'), true);
    assert.equal(u.purchase('turnSpeed', pm, 'ANN'), true);
    assert.equal(u.currency, 900);
    assert.equal(u.levels.turnSpeed, 1);
    assert.equal(pm.saves, 1);
    assert.deepEqual(pm.store.ANN, { levels: u.levels, currency: 900 });
    assert.equal(u.purchase('startingLives', pm, 'ANN'), false);
    assert.equal(u.currency, 900);
    assert.equal(pm.saves, 1);
});

test('cannot buy past max level', () => {
    const u = new UpgradeState();
    u.addCurrency(1e9);
    for (let i = 0; i < 3; i++) assert.equal(u.purchase('startingLives', null, null), true);
    assert.equal(u.canAfford('startingLives'), false);
    assert.equal(u.purchase('startingLives', null, null), false);
    assert.equal(u.canAfford('nope'), false);
});

test('loading resets first, then merges saved data', () => {
    const pm = fakePersistence({ BOB: { levels: { thrustPower: 2 }, currency: 50 } });
    const u = new UpgradeState();
    u.levels.turnSpeed = 4; u.currency = 9999;
    u.load(pm, 'BOB');
    assert.equal(u.levels.turnSpeed, 0);
    assert.equal(u.levels.thrustPower, 2);
    assert.equal(u.currency, 50);
    // user with no saved data: fully reset
    u.load(pm, 'NEW');
    assert.deepEqual(u.levels, { collectionRadius: 0, thrustPower: 0, startingLives: 0, turnSpeed: 0, powerUpDuration: 0 });
    assert.equal(u.currency, 0);
});

test('load/save without persistence or user are no-ops', () => {
    const u = new UpgradeState();
    u.currency = 10;
    u.load(null, 'X');
    u.load(fakePersistence(), '');
    assert.equal(u.currency, 10);
    u.save(null, 'X');
});

test('zero state never saves and stays at zero', () => {
    const pm = fakePersistence({ BOB: { levels: { thrustPower: 5 }, currency: 99999 } });
    const z = UpgradeState.zero();
    z.load(pm, 'BOB');
    z.addCurrency(100000);
    assert.equal(z.purchase('thrustPower', pm, 'BOB'), false);
    z.save(pm, 'BOB');
    assert.equal(pm.saves, 0);
    assert.equal(z.currency, 0);
    assert.equal(z.getThrustMult(), 1);
    assert.equal(z.getExtraStartingLives(), 0);
});

test('instances are independent', () => {
    const a = new UpgradeState(), b = new UpgradeState();
    a.levels.thrustPower = 3;
    assert.equal(b.levels.thrustPower, 0);
});

test('reset clears levels and currency', () => {
    const u = new UpgradeState();
    u.addCurrency(500); u.levels.turnSpeed = 2;
    u.reset();
    assert.equal(u.currency, 0);
    assert.equal(u.levels.turnSpeed, 0);
});
