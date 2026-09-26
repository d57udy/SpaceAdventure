import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    MP_KEYS, addHistory, addToBoard, qualifiesForBoard, rivalryKey, recordRivalry, filterUser,
    filterBoard, filterRivalry, ghostKeysForUser, parseOrEmpty, isGuestEntry, isHistory, isBoard, isRivalry,
} from '../../js/mpRecords.js';

const entry = (score, names = ['ALICE']) => ({
    score, players: names.map((n) => (n.startsWith('Guest') ? { name: n, profile: null } : { name: n, profile: n })),
});

test('storage keys follow plan §6', () => {
    assert.equal(MP_KEYS.history, 'spaceAdventure_mp_history_v1');
    assert.equal(MP_KEYS.boardCoop, 'spaceAdventure_mp_board_coop_v1');
    assert.equal(MP_KEYS.boardHarvest, 'spaceAdventure_mp_board_harvest_v1');
    assert.equal(MP_KEYS.rivalry, 'spaceAdventure_mp_rivalry_v1');
});

test('history keeps the newest 20, newest first, without mutating the input', () => {
    let list = [];
    for (let i = 0; i < 25; i++) list = addHistory(list, { id: i });
    assert.equal(list.length, 20);
    assert.equal(list[0].id, 24);
    assert.equal(list[19].id, 5);
    const before = [{ id: 'a' }];
    const after = addHistory(before, { id: 'b' }, 1);
    assert.deepEqual(before, [{ id: 'a' }]);
    assert.deepEqual(after, [{ id: 'b' }]);
    assert.deepEqual(addHistory(null, { id: 1 }), [{ id: 1 }]);
});

test('leaderboard insert keeps order and trims to 10', () => {
    let board = [];
    for (const s of [500, 100, 900, 300, 700, 200, 800, 400, 600, 1000, 50, 650]) {
        board = addToBoard(board, entry(s), 'score');
    }
    assert.equal(board.length, 10);
    assert.deepEqual(board.map((e) => e.score), [1000, 900, 800, 700, 650, 600, 500, 400, 300, 200]);
    // Tie goes after the existing entry
    const tied = addToBoard(board, { ...entry(700, ['BOB']) }, 'score');
    assert.equal(tied[3].players[0].name, 'ALICE');
    assert.equal(tied[4].players[0].name, 'BOB');
    // Too low: unchanged
    assert.deepEqual(addToBoard(board, entry(10)), board);
    // Other sort key and max
    const byLevel = addToBoard(addToBoard([], { level: 3, profile: 'A', score: 0 }, 'level', 1), { level: 5, profile: 'B', score: 0 }, 'level', 1);
    assert.deepEqual(byLevel.map((e) => e.level), [5]);
    // Input not mutated
    const copy = JSON.parse(JSON.stringify(board));
    addToBoard(board, entry(5000));
    assert.deepEqual(board, copy);
});

test('qualifiesForBoard', () => {
    const board = Array.from({ length: 10 }, (_, i) => entry(1000 - i * 100));
    assert.equal(qualifiesForBoard(board, 101), true);
    assert.equal(qualifiesForBoard(board, 100), false);
    assert.equal(qualifiesForBoard([], 0), true);
});

test('guests are excluded from boards', () => {
    assert.deepEqual(addToBoard([], { score: 999, profile: null, name: 'Guest 2' }), []);
    assert.deepEqual(addToBoard([], entry(999, ['Guest 2', 'Guest 3'])), []);
    // A team with at least one profile counts
    assert.equal(addToBoard([], entry(999, ['ALICE', 'Guest 2'])).length, 1);
    assert.equal(isGuestEntry({ profile: 'ALICE' }), false);
    assert.equal(isGuestEntry({ profile: null }), true);
});

test('rivalry keys are sorted and uppercased', () => {
    assert.equal(rivalryKey('bob', 'Alice'), 'ALICE|BOB');
    assert.equal(rivalryKey('Alice', 'bob'), 'ALICE|BOB');
    assert.equal(rivalryKey('zed', 'ZED'), 'ZED|ZED');
});

test('recordRivalry counts wins and draws per pair and mode', () => {
    let r = {};
    r = recordRivalry(r, 'duel', ['Alice', 'Bob'], 'bob');
    r = recordRivalry(r, 'duel', ['Bob', 'Alice'], 'Alice');
    r = recordRivalry(r, 'duel', ['Alice', 'Bob'], 'Bob');
    r = recordRivalry(r, 'duel', ['Alice', 'Bob'], null);
    r = recordRivalry(r, 'harvest', ['Alice', 'Bob'], 'ALICE');
    assert.deepEqual(r['ALICE|BOB'].duel, { wins: { BOB: 2, ALICE: 1 }, draws: 1, played: 4 });
    assert.deepEqual(r['ALICE|BOB'].harvest, { wins: { ALICE: 1 }, draws: 0, played: 1 });
    // Input not mutated
    const before = JSON.parse(JSON.stringify(r));
    recordRivalry(r, 'duel', ['Alice', 'Bob'], 'Alice');
    assert.deepEqual(r, before);
});

test('guests are excluded from rivalries', () => {
    const r = recordRivalry({}, 'duel', [{ name: 'ALICE', profile: 'ALICE' }, { name: 'Guest 2', profile: null }], 'ALICE');
    assert.deepEqual(r, {});
    const r3 = recordRivalry({}, 'duel', [
        { name: 'ALICE', profile: 'ALICE' }, { name: 'Guest 2', profile: null }, { name: 'CARL', profile: 'CARL' },
    ], 'CARL');
    assert.deepEqual(Object.keys(r3), ['ALICE|CARL']);
});

test('reset filtering removes the user from boards and rivalries only', () => {
    const records = {
        history: [{ id: 1, players: [{ name: 'ALICE', profile: 'ALICE' }] }],
        boards: {
            coop: [entry(900, ['ALICE', 'BOB']), entry(800, ['BOB', 'CARL']), entry(700, ['alice'])],
            harvest: [{ score: 50, profile: 'Alice' }, { score: 40, profile: 'BOB' }],
        },
        rivalry: recordRivalry(recordRivalry({}, 'duel', ['ALICE', 'BOB'], 'ALICE'), 'duel', ['BOB', 'CARL'], null),
    };
    const out = filterUser(records, 'alice');
    assert.deepEqual(out.boards.coop.map((e) => e.score), [800]);
    assert.deepEqual(out.boards.harvest.map((e) => e.score), [40]);
    assert.deepEqual(Object.keys(out.rivalry), ['BOB|CARL']);
    assert.deepEqual(out.history, records.history);
    // Input untouched
    assert.equal(records.boards.coop.length, 3);
    assert.equal(Object.keys(records.rivalry).length, 2);
    assert.equal(filterBoard(null, 'x').length, 0);
    assert.deepEqual(filterRivalry(null, 'x'), {});
    assert.deepEqual(filterUser({ rivalry: {} }, 'x'), { rivalry: {} });
});

test('ghost keys for a user', () => {
    const keys = [
        'spaceAdventure_ghost_v1_ALICE_1_medium', 'spaceAdventure_ghost_v1_ALICE_10_hard',
        'spaceAdventure_ghost_v1_ALICEB_1_medium', 'spaceAdventure_ghost_v1_BOB_1_medium', 'asteroids_highscores',
    ];
    assert.deepEqual(ghostKeysForUser(keys, 'alice'), keys.slice(0, 2));
});

test('corrupt data parses to empty', () => {
    assert.deepEqual(parseOrEmpty(null, isHistory), []);
    assert.deepEqual(parseOrEmpty('', isHistory), []);
    assert.deepEqual(parseOrEmpty('{not json', isHistory), []);
    assert.deepEqual(parseOrEmpty('{"a":1}', isHistory), []);
    assert.deepEqual(parseOrEmpty('[1,2]', isHistory), []);
    assert.deepEqual(parseOrEmpty('[{"score":"x"}]', isBoard), []);
    assert.deepEqual(parseOrEmpty('[{"score":5}]', isBoard), [{ score: 5 }]);
    assert.deepEqual(parseOrEmpty('[]', isRivalry, {}), {});
    assert.deepEqual(parseOrEmpty('{"A|B":5}', isRivalry, {}), {});
    assert.deepEqual(parseOrEmpty('{"A|B":{"duel":{}}}', isRivalry, {}), { 'A|B': { duel: {} } });
});
