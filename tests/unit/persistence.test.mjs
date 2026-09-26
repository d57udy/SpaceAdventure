import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Silence the module's console chatter
for (const m of ['log', 'warn', 'error']) console[m] = () => {};

class FakeStorage {
    constructor() { this.map = new Map(); }
    getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
    setItem(k, v) { this.map.set(k, String(v)); }
    removeItem(k) { this.map.delete(k); }
    clear() { this.map.clear(); }
}

function installStorage(storage) {
    globalThis.window = { localStorage: storage };
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
}

let storage;
beforeEach(() => {
    storage = new FakeStorage();
    installStorage(storage);
});

installStorage(new FakeStorage());
const { PersistenceManager } = await import('../../js/persistence.js');

test('high scores round-trip for a user (with user tag added, key upper-cased)', () => {
    const pm = new PersistenceManager();
    const scores = [{ score: 500, level: 2 }, { score: 100, level: 1 }];
    pm.saveHighScores('bob', scores);
    assert.ok(storage.map.has('asteroids_highScores_BOB'));
    assert.deepEqual(pm.loadHighScores('bob'), scores.map(s => ({ ...s, user: 'bob' })));
    // case-insensitive key
    assert.equal(pm.loadHighScores('BOB').length, 2);
});

test('loadHighScores filters corrupt entries', () => {
    const pm = new PersistenceManager();
    storage.setItem('asteroids_highScores_BOB', JSON.stringify([
        { score: 10 }, null, 5, { score: 'x' }, { score: NaN }, { name: 'no score' }, { score: 20 },
    ]));
    assert.deepEqual(pm.loadHighScores('bob').map(s => s.score), [10, 20]);
});

test('loadHighScores() with no user combines all known users sorted descending', () => {
    const pm = new PersistenceManager();
    pm.setCurrentUser('alice');
    pm.setCurrentUser('bob');
    pm.saveHighScores('alice', [{ score: 50 }, { score: 300 }]);
    pm.saveHighScores('bob', [{ score: 200 }]);
    const all = pm.loadHighScores();
    assert.deepEqual(all.map(s => [s.user, s.score]), [['alice', 300], ['bob', 200], ['alice', 50]]);
});

test('achievements round-trip as a Set', () => {
    const pm = new PersistenceManager();
    pm.saveAchievements('bob', new Set(['A', 'B']));
    const loaded = pm.loadAchievements('bob');
    assert.ok(loaded instanceof Set);
    assert.deepEqual([...loaded].sort(), ['A', 'B']);
});

test('loadAchievements drops non-string ids and returns map for all users', () => {
    const pm = new PersistenceManager();
    pm.setCurrentUser('alice');
    storage.setItem('asteroids_achievements_ALICE', JSON.stringify(['X', 3, null, 'Y']));
    assert.deepEqual([...pm.loadAchievements('alice')], ['X', 'Y']);
    const map = pm.loadAchievements();
    assert.deepEqual(Object.keys(map), ['alice']);
    assert.ok(map.alice instanceof Set);
});

test('upgrades round-trip and are sanitised', () => {
    const pm = new PersistenceManager();
    pm.saveUpgrades('bob', { levels: { speed: 2, fire: 1 }, currency: 150 });
    assert.deepEqual(pm.loadUpgrades('bob'), { levels: { speed: 2, fire: 1 }, currency: 150 });

    storage.setItem('asteroids_upgrades_BOB', JSON.stringify({ levels: { a: 'x', b: -3, c: 2.7 }, currency: 'lots' }));
    assert.deepEqual(pm.loadUpgrades('bob'), { levels: { a: 0, b: 0, c: 2 }, currency: 0 });

    storage.setItem('asteroids_upgrades_BOB', JSON.stringify({ currency: 5 }));
    assert.deepEqual(pm.loadUpgrades('bob'), { levels: undefined, currency: 5 });

    storage.setItem('asteroids_upgrades_BOB', JSON.stringify([1, 2]));
    assert.equal(pm.loadUpgrades('bob'), null);
    assert.equal(pm.loadUpgrades('nobody'), null);
});

test('corrupt JSON does not throw and yields defaults', () => {
    const pm = new PersistenceManager();
    for (const k of ['asteroids_highScores_BOB', 'asteroids_achievements_BOB', 'asteroids_upgrades_BOB', 'asteroids_userList']) {
        storage.setItem(k, '{not json');
    }
    assert.deepEqual(pm.loadHighScores('bob'), []);
    assert.deepEqual([...pm.loadAchievements('bob')], []);
    assert.equal(pm.loadUpgrades('bob'), null);
    assert.deepEqual(pm.getAllUsernames(), []);
    assert.deepEqual(pm.loadHighScores(), []);
});

test('valid JSON of the wrong shape yields defaults', () => {
    const pm = new PersistenceManager();
    storage.setItem('asteroids_highScores_BOB', '{"a":1}');
    storage.setItem('asteroids_achievements_BOB', '"str"');
    storage.setItem('asteroids_userList', '{"x":1}');
    assert.deepEqual(pm.loadHighScores('bob'), []);
    assert.deepEqual([...pm.loadAchievements('bob')], []);
    assert.deepEqual(pm.getAllUsernames(), []);
});

test('missing username: save is a no-op and loads return defaults', () => {
    const pm = new PersistenceManager();
    pm.saveHighScores(null, [{ score: 1 }]);
    pm.saveAchievements('', new Set(['A']));
    pm.saveUpgrades(undefined, { currency: 1 });
    assert.equal(storage.map.size, 0);
    assert.equal(pm.loadUpgrades(null), null);
});

test('user list: case-insensitive dedupe and corrupt entries dropped', () => {
    const pm = new PersistenceManager();
    pm.addUserToList('bob');
    pm.addUserToList('BOB');
    pm.addUserToList('alice');
    assert.deepEqual(pm.getAllUsernames(), ['bob', 'alice']);
    storage.setItem('asteroids_userList', JSON.stringify(['a', 'A', '', '  ', 5, null, 'b']));
    assert.deepEqual(pm.getAllUsernames(), ['a', 'b']);
});

test('current user: set, cached, cleared, and loaded from storage', () => {
    const pm = new PersistenceManager();
    assert.equal(pm.getCurrentUser(), null); // nothing stored
    pm.setCurrentUser('carol');
    assert.equal(pm.getCurrentUser(), 'carol');
    assert.equal(storage.getItem('asteroids_currentUser'), 'carol');
    assert.deepEqual(pm.getAllUsernames(), ['carol']);

    const pm2 = new PersistenceManager();
    assert.equal(pm2.getCurrentUser(), 'carol');

    pm.setCurrentUser(null);
    assert.equal(pm.getCurrentUser(), null);
    assert.equal(storage.getItem('asteroids_currentUser'), null);

    storage.setItem('asteroids_currentUser', '   ');
    assert.equal(new PersistenceManager().getCurrentUser(), null);
});

test('resetUserData removes the user data and clears current user', () => {
    const pm = new PersistenceManager();
    pm.setCurrentUser('dave');
    pm.saveHighScores('dave', [{ score: 1 }]);
    pm.saveAchievements('dave', new Set(['A']));
    pm.saveUpgrades('dave', { currency: 3 });
    pm.resetUserData('dave');
    assert.deepEqual(pm.loadHighScores('dave'), []);
    assert.equal(pm.loadAchievements('dave').size, 0);
    assert.equal(pm.loadUpgrades('dave'), null);
    assert.equal(pm.getCurrentUser(), null);
    assert.equal(storage.getItem('asteroids_currentUser'), null);
});

// --- Storage failures -------------------------------------------------------

test('localStorage whose writes throw (quota / private mode) does not throw', () => {
    const throwing = new FakeStorage();
    throwing.setItem = () => { throw new Error('QuotaExceededError'); };
    installStorage(throwing);
    const pm = new PersistenceManager();
    assert.doesNotThrow(() => {
        pm.setCurrentUser('eve');
        pm.saveHighScores('eve', [{ score: 1 }]);
        pm.saveAchievements('eve', new Set(['A']));
        pm.saveUpgrades('eve', { currency: 1 });
        pm.resetUserData('eve');
    });
    assert.deepEqual(pm.loadHighScores('eve'), []);
    // current user is still tracked in memory
    const pm2 = new PersistenceManager();
    pm2.setCurrentUser('eve');
    assert.equal(pm2.getCurrentUser(), 'eve');
});

test('localStorage whose every method throws does not throw', () => {
    const broken = {
        getItem() { throw new Error('SecurityError'); },
        setItem() { throw new Error('SecurityError'); },
        removeItem() { throw new Error('SecurityError'); },
    };
    installStorage(broken);
    const pm = new PersistenceManager();
    assert.equal(pm.isLocalStorageAvailable(), false);
    assert.doesNotThrow(() => {
        pm.setCurrentUser('eve');
        pm.saveHighScores('eve', [{ score: 1 }]);
        pm.saveAchievements('eve', new Set());
        pm.saveUpgrades('eve', {});
        pm.resetUserData('eve');
    });
    assert.equal(pm.getCurrentUser(), 'eve'); // in-memory cache
    assert.deepEqual(pm.loadHighScores('eve'), []);
    assert.deepEqual(pm.loadHighScores(), []);
    assert.equal(pm.loadAchievements('eve').size, 0);
    assert.deepEqual(pm.loadAchievements(), {});
    assert.equal(pm.loadUpgrades('eve'), null);
    assert.deepEqual(pm.getAllUsernames(), []);
});

test('accessing window.localStorage itself throwing is handled', () => {
    globalThis.window = {};
    Object.defineProperty(globalThis.window, 'localStorage', { get() { throw new Error('denied'); } });
    const pm = new PersistenceManager();
    assert.equal(pm.isLocalStorageAvailable(), false);
    assert.equal(pm.getCurrentUser(), null);
    assert.deepEqual(pm.loadHighScores('x'), []);
});

test('resetUserData with different casing also clears the matching current user', () => {
    const pm = new PersistenceManager();
    pm.setCurrentUser('bob');
    pm.saveHighScores('bob', [{ score: 1 }]);
    pm.resetUserData('BOB');
    assert.deepEqual(pm.loadHighScores('bob'), []); // data is gone...
    assert.equal(pm.getCurrentUser(), null);        // ...but current user remains 'bob'
});

test('tutorial state round-trips per user (key upper-cased) and defaults to null', () => {
    const pm = new PersistenceManager();
    assert.equal(pm.loadTutorialState('bob'), null);
    pm.saveTutorialState('bob', { asked: true, done: false, version: 1 });
    assert.ok(storage.map.has('asteroids_tutorial_BOB'));
    assert.deepEqual(pm.loadTutorialState('BOB'), { asked: true, done: false, skipped: false, version: 1 });
    pm.saveTutorialState('bob', { done: true, skipped: true, version: 1 });
    assert.deepEqual(pm.loadTutorialState('bob'), { asked: true, done: true, skipped: true, version: 1 });
    assert.equal(pm.loadTutorialState('alice'), null, 'other users are unaffected');
});

test('corrupt tutorial state loads as null (or sanitised)', () => {
    const pm = new PersistenceManager();
    for (const bad of ['{nope', '[1,2]', 'null', '42']) {
        storage.setItem('asteroids_tutorial_BOB', bad);
        assert.equal(pm.loadTutorialState('bob'), null, bad);
    }
    storage.setItem('asteroids_tutorial_BOB', JSON.stringify({ done: 'yes', version: 'x' }));
    assert.deepEqual(pm.loadTutorialState('bob'), { asked: false, done: false, skipped: false, version: 1 });
    assert.equal(pm.loadTutorialState(null), null);
});

test('resetUserData removes the tutorial state so the tutorial is offered again', () => {
    const pm = new PersistenceManager();
    pm.setCurrentUser('bob');
    pm.saveTutorialState('bob', { done: true });
    pm.saveTutorialState('alice', { done: true });
    pm.resetUserData('bob');
    assert.equal(pm.loadTutorialState('bob'), null);
    assert.ok(pm.loadTutorialState('alice').done);
});

// Storage with key()/length, like the browser's (for listKeys and ghost removal)
class ListingStorage extends FakeStorage {
    get length() { return this.map.size; }
    key(i) { return [...this.map.keys()][i] ?? null; }
}

test('loadJson / saveJson round-trip; missing, corrupt or invalid data gives the fallback', () => {
    const pm = new PersistenceManager();
    assert.equal(pm.saveJson('spaceAdventure_mp_history_v1', [{ mode: 'turns' }]), true);
    assert.deepEqual(pm.loadJson('spaceAdventure_mp_history_v1', Array.isArray, []), [{ mode: 'turns' }]);
    assert.deepEqual(pm.loadJson('missing', Array.isArray, []), []);
    storage.setItem('bad', '{oops');
    assert.equal(pm.loadJson('bad', () => true, null), null);
    storage.setItem('wrong', '{"a":1}');
    assert.deepEqual(pm.loadJson('wrong', Array.isArray, []), []);
    pm.removeKey('spaceAdventure_mp_history_v1');
    assert.equal(storage.getItem('spaceAdventure_mp_history_v1'), null);
});

test('saveJson returns false when the write throws', () => {
    const pm = new PersistenceManager();
    storage.setItem = () => { throw new Error('quota'); };
    assert.equal(pm.saveJson('k', { a: 1 }), false);
});

test('listKeys uses key()/length and is empty when storage cannot list', () => {
    const s = new ListingStorage();
    installStorage(s);
    s.setItem('a', '1');
    s.setItem('b', '2');
    assert.deepEqual(new PersistenceManager().listKeys(), ['a', 'b']);
    installStorage(new FakeStorage());
    assert.deepEqual(new PersistenceManager().listKeys(), []);
});

test('resetUserData filters the user out of multiplayer boards, rivalries and ghosts; history stays', () => {
    const s = new ListingStorage();
    installStorage(s);
    const pm = new PersistenceManager();
    const coop = [
        { score: 900, players: [{ name: 'BOB', profile: 'BOB' }, { name: 'ANN', profile: 'ANN' }] },
        { score: 500, players: [{ name: 'ANN', profile: 'ANN' }, { name: 'Guest 2', profile: null }] },
    ];
    const harvest = [{ score: 70, name: 'bob', profile: 'bob' }, { score: 60, name: 'ANN', profile: 'ANN' }];
    const rivalry = { 'ANN|BOB': { harvest: { wins: { BOB: 1 }, draws: 0, played: 1 } }, 'ANN|CAT': { duel: { wins: {}, draws: 1, played: 1 } } };
    const history = [{ mode: 'turns', players: [{ name: 'BOB', profile: 'BOB' }] }];
    s.setItem('spaceAdventure_mp_board_coop_v1', JSON.stringify(coop));
    s.setItem('spaceAdventure_mp_board_harvest_v1', JSON.stringify(harvest));
    s.setItem('spaceAdventure_mp_rivalry_v1', JSON.stringify(rivalry));
    s.setItem('spaceAdventure_mp_history_v1', JSON.stringify(history));
    s.setItem('spaceAdventure_ghost_v1_BOB_1_medium', '{}');
    s.setItem('spaceAdventure_ghost_v1_BOBBY_1_medium', '{}');
    s.setItem('spaceAdventure_ghost_v1_ANN_1_medium', '{}');
    pm.resetUserData('Bob');
    assert.deepEqual(JSON.parse(s.getItem('spaceAdventure_mp_board_coop_v1')).map(e => e.score), [500]);
    assert.deepEqual(JSON.parse(s.getItem('spaceAdventure_mp_board_harvest_v1')).map(e => e.name), ['ANN']);
    assert.deepEqual(Object.keys(JSON.parse(s.getItem('spaceAdventure_mp_rivalry_v1'))), ['ANN|CAT']);
    assert.deepEqual(JSON.parse(s.getItem('spaceAdventure_mp_history_v1')), history);
    assert.equal(s.getItem('spaceAdventure_ghost_v1_BOB_1_medium'), null);
    assert.equal(s.getItem('spaceAdventure_ghost_v1_BOBBY_1_medium'), '{}');
    assert.equal(s.getItem('spaceAdventure_ghost_v1_ANN_1_medium'), '{}');
});

test('resetUserData leaves missing or corrupt multiplayer records alone', () => {
    const pm = new PersistenceManager();
    storage.setItem('spaceAdventure_mp_rivalry_v1', 'not json');
    pm.resetUserData('BOB');
    assert.equal(storage.getItem('spaceAdventure_mp_rivalry_v1'), 'not json');
    assert.equal(storage.getItem('spaceAdventure_mp_board_coop_v1'), null);
});
