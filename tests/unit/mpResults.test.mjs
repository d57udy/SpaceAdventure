import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accuracy, rankRows, highlights, buildResults, resultBanner, historyEntry } from '../../js/mpResults.js';
import { createPlayer } from '../../js/players.js';

function player(slot, name, score, stats = {}, profile = name) {
    const p = createPlayer({ slot, name, profile });
    p.score = score;
    Object.assign(p.stats, stats);
    return p;
}

test('accuracy is hits / shots, 0 without shots, capped at 1', () => {
    assert.equal(accuracy({ shots: 0, hits: 0 }), 0);
    assert.equal(accuracy({ shots: 4, hits: 1 }), 0.25);
    assert.equal(accuracy({ shots: 2, hits: 5 }), 1);
    assert.equal(accuracy(null), 0);
});

test('rankRows: winners first, then score, kills, seat; inputs untouched', () => {
    const rows = [
        { id: 'p1', slot: 0, score: 50 }, { id: 'p2', slot: 1, score: 90 },
        { id: 'p3', slot: 2, score: 90, kills: 2 }, { id: 'p4', slot: 3, score: 10 },
    ];
    const copy = JSON.parse(JSON.stringify(rows));
    assert.deepEqual(rankRows(rows).map(r => r.id), ['p3', 'p2', 'p1', 'p4']);
    assert.deepEqual(rankRows(rows, ['p4']).map(r => r.id), ['p4', 'p3', 'p2', 'p1']);
    assert.deepEqual(rows, copy);
});

test('highlights name a single leader per stat', () => {
    const lines = highlights([
        { name: 'ANN', greens: 7, redsShot: 2, ufos: 0, bestCombo: 5 },
        { name: 'BOB', greens: 3, redsShot: 2, ufos: 1, bestCombo: 0 },
    ]);
    assert.deepEqual(lines, ['Most greens: ANN (7)', 'Most UFOs: BOB (1)', 'Best combo: ANN (5)']);
    assert.deepEqual(highlights([]), []);
});

test('buildResults: Take Turns ranked by score with per-player rows', () => {
    const a = player(0, 'TESTER', 120, { greens: 3, shots: 10, hits: 4, deaths: 2, creditsEarned: 12 });
    const b = player(1, 'ALICE', 480, { greens: 9, deaths: 2, bestCombo: 6, creditsEarned: 48 });
    a.level = 2;
    b.level = 3;
    b.newAchievements = ['First Contact'];
    const mode = { id: 'turns', name: 'Take Turns', kind: 'turns' };
    const r = buildResults({ mode, result: { outcome: 'win', winners: ['p2'] }, players: [a, b], duration: 93.44, difficulty: 'hard', date: 5 });
    assert.equal(r.mode, 'turns');
    assert.equal(r.modeName, 'Take Turns');
    assert.equal(r.outcome, 'win');
    assert.deepEqual(r.winnerNames, ['ALICE']);
    assert.equal(r.duration, 93.4);
    assert.equal(r.teamScore, 600);
    assert.equal(r.date, 5);
    assert.deepEqual(r.players.map(p => [p.name, p.score, p.level, p.winner]), [['ALICE', 480, 3, true], ['TESTER', 120, 2, false]]);
    assert.equal(r.players[1].accuracy, 0.4);
    assert.equal(r.players[0].credits, 48);
    assert.deepEqual(r.players[0].newAchievements, ['First Contact']);
    assert.ok(r.highlights.includes('Most greens: ALICE (9)'));
    assert.equal(resultBanner(r), 'ALICE WINS!');
});

test('result banners: draw, tie, team, none', () => {
    assert.equal(resultBanner(null), '');
    assert.equal(resultBanner({ outcome: 'draw', winnerNames: [] }), 'DRAW');
    assert.equal(resultBanner({ outcome: 'win', kind: 'turns', winnerNames: ['A', 'B'] }), 'TIE: A & B');
    assert.equal(resultBanner({ outcome: 'gameOver', kind: 'coop', winnerNames: ['A'] }), 'TEAM RESULT');
    assert.equal(resultBanner({ outcome: 'gameOver', kind: 'versus', winnerNames: [] }), 'ROUND OVER');
});

test('history entry is compact and keeps profiles (guests null)', () => {
    const r = buildResults({
        mode: { id: 'turns', name: 'Take Turns', kind: 'turns' }, result: { outcome: 'win', winners: ['p1'] },
        players: [player(0, 'TESTER', 10), player(1, 'Guest 2', 0, {}, null)], duration: 10, date: 1,
    });
    assert.deepEqual(historyEntry(r), {
        mode: 'turns', outcome: 'win', date: 1, duration: 10, difficulty: null, teamScore: 10, winners: ['TESTER'],
        players: [{ name: 'TESTER', profile: 'TESTER', score: 10, level: null }, { name: 'Guest 2', profile: null, score: 0, level: null }],
    });
});
