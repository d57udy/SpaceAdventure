import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

for (const m of ['log', 'warn', 'error']) console[m] = () => {};

class FakeStorage {
    constructor() { this.map = new Map(); }
    getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
    setItem(k, v) { this.map.set(k, String(v)); }
    removeItem(k) { this.map.delete(k); }
    clear() { this.map.clear(); }
    get length() { return this.map.size; }
    key(i) { return [...this.map.keys()][i] ?? null; }
}
function installStorage(storage) {
    globalThis.window = { localStorage: storage };
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
}
let storage;
beforeEach(() => { storage = new FakeStorage(); installStorage(storage); });
installStorage(new FakeStorage());

const { PersistenceManager, insertHighScore } = await import('../../js/persistence.js');
const { createProgress3d, shipMods3d, creditsFor } = await import('../../js/3d/progress3d.js');
const { UpgradeState } = await import('../../js/upgrades.js');
const { AchievementManager } = await import('../../js/achievementManager.js');

function pm(user = 'ann') {
    const p = new PersistenceManager();
    if (user) p.setCurrentUser(user);
    return p;
}

test('insertHighScore: best first, top 10, place returned', () => {
    let board = [];
    for (const s of [100, 300, 200]) board = insertHighScore(board, { score: s }).scores;
    assert.deepEqual(board.map(e => e.score), [300, 200, 100]);
    const full = Array.from({ length: 10 }, (_, i) => ({ score: 1000 - i * 10 }));
    assert.equal(insertHighScore(full, { score: 5 }).index, -1, 'too low for a full board');
    const r = insertHighScore(full, { score: 995 });
    assert.equal(r.index, 1);
    assert.equal(r.scores.length, 10);
    assert.equal(r.scores[9].score, 920, 'lowest dropped');
    assert.equal(insertHighScore([{ score: 50 }], { score: 50 }).index, 1, 'a tie goes below');
    assert.equal(full.length, 10, 'input not changed');
});

test('credit rule: ceil(10 % of the points), as in 2D', () => {
    assert.equal(creditsFor(200), 20);
    assert.equal(creditsFor(25), 3);
    assert.equal(creditsFor(1), 1);
});

test('3D scores go to their own board; the 2D board is untouched', () => {
    const p = pm();
    p.saveHighScores('ann', [{ name: 'ANN', score: 900 }]);
    const g = createProgress3d({ persistence: p });
    g.startGame();
    g.awardPoints(500);
    g.setLevel(2);
    const { rank } = g.finishGame();
    assert.equal(rank, 0);
    assert.ok(storage.map.has('asteroids_highScores3d_ANN'));
    assert.deepEqual(p.loadHighScores('ann').map(e => e.score), [900]);
    const b = p.loadHighScores3d('ann');
    assert.equal(b.length, 1);
    assert.equal(b[0].score, 500);
    assert.equal(b[0].name, 'ANN');
    assert.equal(b[0].level, 2);
    assert.deepEqual(g.highScores().map(e => e.score), [500]);
});

test('3D board keeps the top 10 and combines users like 2D', () => {
    const p = pm();
    const g = createProgress3d({ persistence: p });
    for (let i = 1; i <= 12; i++) g.finishGame(i * 100);
    assert.equal(p.loadHighScores3d('ann').length, 10);
    assert.equal(p.loadHighScores3d('ann')[9].score, 300);
    assert.equal(g.qualifies(250), false);
    assert.equal(g.qualifies(350), true);
    p.setCurrentUser('bob');
    createProgress3d({ persistence: p }).finishGame(5000);
    const all = createProgress3d({ persistence: p }).allHighScores();
    assert.equal(all[0].score, 5000);
    assert.equal(all[0].user, 'bob');
    assert.equal(all.length, 11);
});

test('credits, upgrades and achievements are shared between 2D and 3D', () => {
    const p = pm();
    // A 2D session earns credits and buys an upgrade
    const u2d = new UpgradeState();
    u2d.load(p, 'ann');
    u2d.addCurrency(1000);
    assert.ok(u2d.purchase('thrustPower', p, 'ann')); // costs 500
    u2d.save(p, 'ann');
    const a2d = new AchievementManager(p);
    a2d.loadUserAchievements('ann');
    a2d.checkUnlockConditions({ score: 10000 });
    assert.ok(a2d.isUnlocked('SCORE_10K'));

    // 3D sees them and adds to the same credits
    const g = createProgress3d({ persistence: p });
    assert.equal(g.upgrades.currency, 500);
    assert.ok(g.achievements.isUnlocked('SCORE_10K'));
    assert.ok(Math.abs(g.ship().accelMult - 1.15) < 1e-9);
    g.startGame();
    g.awardPoints(200); // +20
    g.awardPoints(100, 0); // no credits
    assert.equal(g.creditsEarned, 20);
    g.setLevel(3);
    assert.ok(g.achievements.isUnlocked('LEVEL_3'));
    for (let i = 0; i < 50; i++) g.trackRockDestroyed();
    assert.ok(g.achievements.isUnlocked('ASTEROIDS_50'));
    g.trackUfoDestroyed();
    assert.ok(g.achievements.isUnlocked('UFO_DESTROY_1'));
    g.finishGame();

    // Back in 2D: the credits and achievements earned in 3D are there
    const back = new UpgradeState();
    back.load(p, 'ann');
    assert.equal(back.currency, 520);
    assert.equal(back.levels.thrustPower, 1);
    const a = new AchievementManager(p);
    a.loadUserAchievements('ann');
    for (const id of ['SCORE_10K', 'LEVEL_3', 'ASTEROIDS_50', 'UFO_DESTROY_1']) assert.ok(a.isUnlocked(id), id);
    // ...and the 2D board is still empty
    assert.deepEqual(p.loadHighScores('ann'), []);
});

test('takeUnlocked hands out new achievements once', () => {
    const g = createProgress3d({ persistence: pm() });
    g.startGame();
    g.setLevel(3);
    const first = g.takeUnlocked();
    assert.deepEqual(first.map(a => a.id), ['LEVEL_3']);
    assert.deepEqual(g.takeUnlocked(), []);
});

test('a guest (no profile) earns nothing and saves nothing', () => {
    const p = pm(null);
    const g = createProgress3d({ persistence: p, user: null });
    g.startGame();
    g.awardPoints(1000);
    assert.equal(g.creditsEarned, 0);
    assert.equal(g.upgrades.currency, 0);
    assert.deepEqual(g.finishGame(), { rank: -1 });
    assert.equal(g.qualifies(1000), false);
    assert.deepEqual(g.highScores(), []);
    assert.equal([...storage.map.keys()].some(k => k.startsWith('asteroids_highScores3d')), false);
});

test('startGame resets the session but keeps credits', () => {
    const g = createProgress3d({ persistence: pm() });
    g.awardPoints(1000);
    g.setLevel(4);
    g.startGame();
    assert.equal(g.score, 0);
    assert.equal(g.level, 1);
    assert.equal(g.creditsEarned, 0);
    assert.equal(g.upgrades.currency, 100);
    g.save();
    assert.equal(new PersistenceManager().loadUpgrades('ann').currency, 100);
});

test('ship mods: upgrade levels as multipliers; zero ship without upgrades', () => {
    const u = new UpgradeState();
    u.levels = { collectionRadius: 2, thrustPower: 1, startingLives: 3, turnSpeed: 5, powerUpDuration: 1 };
    const m = shipMods3d(u);
    assert.ok(Math.abs(m.pickupRadiusMult - 1.2) < 1e-9);
    assert.ok(Math.abs(m.accelMult - 1.15) < 1e-9);
    assert.equal(m.extraLives, 3);
    assert.ok(Math.abs(m.turnRateMult - 1.5) < 1e-9);
    assert.ok(Math.abs(m.powerUpDurationMult - 1.2) < 1e-9);
    assert.deepEqual(shipMods3d(null), { pickupRadiusMult: 1, accelMult: 1, extraLives: 0, turnRateMult: 1, powerUpDurationMult: 1 });
    const g = createProgress3d({ persistence: pm() });
    assert.equal(g.startingLives(3), 3);
});

test('reset user data removes the 3D board too', () => {
    const p = pm();
    createProgress3d({ persistence: p }).finishGame(400);
    p.resetUserData('ann');
    assert.equal(storage.map.has('asteroids_highScores3d_ANN'), false);
});
