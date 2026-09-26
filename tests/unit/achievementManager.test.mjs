import { test } from 'node:test';
import assert from 'node:assert/strict';

console.log = () => {};

const { AchievementManager } = await import('../../js/achievementManager.js');
const { Achievements } = await import('../../js/achievements.js');

function fakePersistence(initial = {}) {
    const store = Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, new Set(v)]));
    const saves = [];
    return {
        saves,
        loadAchievements: (u) => new Set(store[u] || []),
        saveAchievements: (u, ids) => { store[u] = new Set(ids); saves.push([u, [...ids]]); },
    };
}

const statDefs = Object.values(Achievements).filter(a => a.condition?.type === 'stat');
const firstAsteroidStat = statDefs
    .filter(a => a.condition.stat === 'asteroidsDestroyed')
    .sort((a, b) => a.condition.value - b.condition.value)[0];

test('no tracking or unlocking without a current user', () => {
    const pm = fakePersistence();
    const am = new AchievementManager(pm);
    am.trackAsteroidDestroyed();
    am.checkUnlockConditions({ score: 1e9, level: 99 });
    assert.equal(am.sessionStats.asteroidsDestroyed, 0);
    assert.equal(am.unlockedAchievementIds.size, 0);
    assert.equal(pm.saves.length, 0);
});

test('loadUserAchievements loads persisted ids and resets session stats', () => {
    const pm = fakePersistence({ bob: ['SCORE_10K'] });
    const am = new AchievementManager(pm);
    am.sessionStats.asteroidsDestroyed = 5;
    am.loadUserAchievements('bob');
    assert.equal(am.currentUser, 'bob');
    assert.equal(am.isUnlocked('SCORE_10K'), true);
    assert.equal(am.sessionStats.asteroidsDestroyed, 0);
    am.loadUserAchievements(null);
    assert.equal(am.unlockedAchievementIds.size, 0);
});

test('score/level conditions unlock, persist, and notify', () => {
    const pm = fakePersistence();
    const am = new AchievementManager(pm);
    am.loadUserAchievements('bob');
    am.checkUnlockConditions({ score: 9999, level: 1 });
    assert.equal(am.isUnlocked('SCORE_10K'), false);
    am.checkUnlockConditions({ score: 10000, level: 3 });
    assert.equal(am.isUnlocked('SCORE_10K'), true);
    assert.equal(am.isUnlocked('LEVEL_3'), true);
    assert.equal(am.isUnlocked('SCORE_50K'), false);
    const names = am.getActiveNotifications().map(a => a.id);
    assert.ok(names.includes('SCORE_10K') && names.includes('LEVEL_3'));
    const [user, ids] = pm.saves.at(-1);
    assert.equal(user, 'bob');
    assert.ok(ids.includes('SCORE_10K') && ids.includes('LEVEL_3'));
});

test('already-unlocked achievements are not re-unlocked', () => {
    const pm = fakePersistence({ bob: ['SCORE_10K'] });
    const am = new AchievementManager(pm);
    am.loadUserAchievements('bob');
    am.checkUnlockConditions({ score: 20000 });
    assert.equal(am.getActiveNotifications().length, 0);
    assert.equal(pm.saves.length, 0);
});

test('stat-based achievement unlocks via trackAsteroidDestroyed', { skip: !firstAsteroidStat && 'no asteroidsDestroyed stat achievement' }, () => {
    const am = new AchievementManager(fakePersistence());
    am.loadUserAchievements('bob');
    const n = firstAsteroidStat.condition.value;
    for (let i = 0; i < n - 1; i++) am.trackAsteroidDestroyed();
    assert.equal(am.isUnlocked(firstAsteroidStat.id), false);
    am.trackAsteroidDestroyed();
    assert.equal(am.sessionStats.asteroidsDestroyed, n);
    assert.equal(am.isUnlocked(firstAsteroidStat.id), true);
});

test('isConditionMet handles unknown/missing conditions and stats', () => {
    const am = new AchievementManager(null);
    assert.equal(am.isConditionMet(null, {}), false);
    assert.equal(am.isConditionMet({ type: 'weird', value: 0 }, {}), false);
    assert.equal(am.isConditionMet({ type: 'score', value: 0 }, {}), false);
    assert.equal(am.isConditionMet({ type: 'stat', stat: 'nope', value: 0 }, {}), false);
    assert.equal(am.isConditionMet({ type: 'stat', stat: 'ufosDestroyed', value: 0 }, {}), true);
});

test('notifications expire after NOTIFICATION_DURATION', () => {
    const am = new AchievementManager(null); // works without persistence
    am.loadUserAchievements('bob');
    am.checkUnlockConditions({ level: 3 });
    assert.equal(am.getActiveNotifications().length, 1);
    am.updateNotifications(2.9);
    assert.equal(am.getActiveNotifications().length, 1);
    am.updateNotifications(0.2);
    assert.equal(am.getActiveNotifications().length, 0);
    assert.equal(am.recentlyUnlocked.length, 0);
});

test('getAllAchievementsStatus lists every definition sorted by name with unlocked flag', () => {
    const am = new AchievementManager(fakePersistence({ bob: ['LEVEL_3'] }));
    am.loadUserAchievements('bob');
    const status = am.getAllAchievementsStatus();
    assert.equal(status.length, Object.keys(Achievements).length);
    const names = status.map(s => s.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
    assert.equal(status.find(s => s.id === 'LEVEL_3').unlocked, true);
    assert.equal(status.filter(s => s.unlocked).length, 1);
});

test('achievement definitions have unique ids matching their keys', () => {
    for (const [key, a] of Object.entries(Achievements)) {
        assert.equal(a.id, key);
        assert.equal(typeof a.name, 'string');
        assert.ok(a.condition && typeof a.condition.type === 'string');
    }
});
