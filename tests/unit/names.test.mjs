// Player names: Unicode letters and digits, NFC, 3-10 code points (js/names.js), and the
// storage keys, lobby profiles and ghost keys that use them.
import { test } from 'node:test';
import assert from 'node:assert/strict';

for (const m of ['log', 'warn', 'error']) console[m] = () => {};

const {
    sanitizeName, nameLength, isValidName, isNameChar, nameInitials, NAME_MIN_LENGTH, NAME_MAX_LENGTH,
} = await import('../../js/names.js');

test('limits', () => {
    assert.equal(NAME_MIN_LENGTH, 3);
    assert.equal(NAME_MAX_LENGTH, 10);
});

test('ASCII behaves as before: upper case, letters and digits only, 10 max', () => {
    assert.equal(sanitizeName('ab-c d_1!23456789'), 'ABCD123456');
    assert.equal(sanitizeName('pilot7'), 'PILOT7');
    assert.equal(sanitizeName(''), '');
    assert.equal(sanitizeName(null), '');
    assert.equal(sanitizeName(undefined), '');
});

test('Unicode letters are kept (not stripped), upper-cased', () => {
    assert.equal(sanitizeName('Jürgen'), 'JÜRGEN');
    assert.equal(sanitizeName('zoë'), 'ZOË');
    assert.equal(sanitizeName('łukasz'), 'ŁUKASZ');
    assert.equal(sanitizeName('νίκος'), 'ΝΊΚΟΣ');
    assert.equal(sanitizeName('さくら'), 'さくら'); // no case: unchanged
    assert.equal(sanitizeName('Ана-Мария'), 'АНАМАРИЯ');
    assert.equal(sanitizeName('José 2'), 'JOSÉ2');
});

test('NFC: decomposed and composed input give the same name', () => {
    const decomposed = 'Jürgen'; // u + combining diaeresis
    const composed = 'Jürgen';
    assert.notEqual(decomposed, composed);
    assert.equal(sanitizeName(decomposed), sanitizeName(composed));
    assert.equal(sanitizeName(decomposed), 'JÜRGEN');
    assert.equal(nameLength(sanitizeName(decomposed)), 6);
});

test('symbols, spaces, punctuation and emoji are removed; a leading combining mark too', () => {
    assert.equal(sanitizeName('A😀B★C'), 'ABC');
    assert.equal(sanitizeName('́abc'), 'ABC');
    assert.equal(sanitizeName('a b\tc\n'), 'ABC');
    assert.equal(isNameChar('😀'), false);
    assert.equal(isNameChar('ü'), true);
    assert.equal(isNameChar('٣'), true); // Arabic-Indic digit
    assert.equal(isNameChar('_'), false);
});

test('length counts code points (not UTF-16 units) and caps at 10', () => {
    const astral = '\u{20000}'; // a CJK Extension B letter: 2 UTF-16 units, 1 code point
    assert.equal(astral.length, 2);
    assert.equal(nameLength(astral + astral + astral), 3);
    assert.equal(sanitizeName(astral.repeat(12)), astral.repeat(10));
    assert.equal(sanitizeName('äöüäöüäöüäöü'), 'ÄÖÜÄÖÜÄÖÜÄ');
    assert.equal(nameLength(sanitizeName('äöüäöüäöüäöü')), 10);
});

test('isValidName: 3-10 characters, already clean', () => {
    assert.equal(isValidName('JÜR'), true);
    assert.equal(isValidName('ÄÖÜÄÖÜÄÖÜÄ'), true);
    assert.equal(isValidName('JÜ'), false);
    assert.equal(isValidName('jürgen'), false); // not upper case
    assert.equal(isValidName('ÄÖÜÄÖÜÄÖÜÄÖ'), false);
    assert.equal(isValidName(42), false);
});

test('nameInitials takes whole characters', () => {
    assert.equal(nameInitials('JÜRGEN'), 'JÜR');
    assert.equal(nameInitials('\u{20000}\u{20001}\u{20002}\u{20003}'), '\u{20000}\u{20001}\u{20002}');
    assert.equal(nameInitials('ab'), 'AB');
    assert.equal(nameInitials(null), '');
});

test('upper-casing is locale independent (same save slot on every device)', () => {
    // toUpperCase, not toLocaleUpperCase: "i" is "I" even on a Turkish-locale device
    assert.equal(sanitizeName('ilkin'), 'ILKIN');
    assert.equal(sanitizeName('straße'), 'STRASSE');
});

// --- Where names are used ------------------------------------------------------------

class FakeStorage {
    constructor() { this.map = new Map(); }
    getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
    setItem(k, v) { this.map.set(k, String(v)); }
    removeItem(k) { this.map.delete(k); }
    key(i) { return [...this.map.keys()][i] ?? null; }
    get length() { return this.map.size; }
    clear() { this.map.clear(); }
}

test('persistence: a Unicode name round-trips its current user, list and per-user keys', async () => {
    const storage = new FakeStorage();
    globalThis.window = { localStorage: storage };
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
    const { PersistenceManager } = await import('../../js/persistence.js');
    const pm = new PersistenceManager();
    const name = sanitizeName('Jürgen');
    pm.setCurrentUser(name);
    assert.equal(pm.getCurrentUser(), 'JÜRGEN');
    assert.ok(pm.getAllUsernames().includes('JÜRGEN'));
    pm.saveHighScores(name, [{ score: 120, level: 2 }]);
    assert.ok(storage.map.has('asteroids_highScores_JÜRGEN'));
    assert.equal(pm.loadHighScores('JÜRGEN')[0].score, 120);
    // The same name, typed decomposed, finds the same data once sanitised
    assert.equal(pm.loadHighScores(sanitizeName('Jürgen'))[0].score, 120);
});

test('ghost keys: a Unicode owner is written, parsed and listed', async () => {
    const { ghostStorageKey } = await import('../../js/ghost.js');
    const TA = await import('../../js/timeAttack.js');
    const { ghostKeysForUser } = await import('../../js/mpRecords.js');
    const key = ghostStorageKey('ZOË', 4, 'Hard');
    assert.deepEqual(TA.parseGhostKey(key), { owner: 'ZOË', course: 4, difficulty: 'hard' });
    assert.deepEqual(TA.ghostKeysForCourse([key, ghostStorageKey('BOB', 4, 'hard')], 4, 'hard').length, 2);
    assert.deepEqual(ghostKeysForUser([key, ghostStorageKey('BOB', 4, 'hard')], 'zoë'), [key]);
    assert.deepEqual(TA.parseGhostKey(ghostStorageKey('\u{20000}AB', 1, 'easy')).owner, '\u{20000}AB');
});

test('lobby: seats cycle through Unicode profiles; case-insensitive duplicates are merged', async () => {
    const { createSeatLobby, nameOptions } = await import('../../js/lobby.js');
    const lobby = createSeatLobby({ seats: null, currentUser: 'JÜRGEN', profiles: ['JÜRGEN', 'ZOË', 'jürgen'] });
    assert.deepEqual(lobby.profiles, ['JÜRGEN', 'ZOË']);
    lobby.cards[0] = { name: 'ZOË', profile: 'zoë', ready: false }; // taken by seat 0, any case
    const names = nameOptions(lobby, 1).map((o) => o.profile).filter(Boolean);
    assert.deepEqual(names, ['JÜRGEN']);
});
