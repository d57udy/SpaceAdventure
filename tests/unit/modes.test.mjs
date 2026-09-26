import { test } from 'node:test';
import assert from 'node:assert/strict';

const { MODES, validateMode, scaleForPlayers, pickSpawnPoint, updateRevive, nextTurnIndex, worldSpawnGrid,
    ringSpawnGrid, REVIVE, getMode } = await import('../../js/modes.js');
const { createPlayer } = await import('../../js/players.js');

const two = () => [createPlayer({ id: 'a', slot: 0 }), createPlayer({ id: 'b', slot: 1 })];

test('every mode is valid', () => {
    assert.deepEqual(Object.keys(MODES), ['solo', 'turns', 'coop', 'harvest', 'duel', 'saucer', 'timeattack']);
    for (const [id, m] of Object.entries(MODES)) {
        assert.deepEqual(validateMode(m), [], id);
        assert.equal(m.id, id);
        assert.equal(getMode(id), m);
    }
});

test('schema check catches broken modes', () => {
    assert.ok(validateMode(null).length > 0);
    const broken = { ...MODES.harvest, field: null, respawn: { placement: 'nowhere' }, hooks: { ...MODES.harvest.hooks, checkEnd: 1 } };
    const errs = validateMode(broken);
    assert.ok(errs.some(e => e.includes('field')));
    assert.ok(errs.some(e => e.includes('placement')));
    assert.ok(errs.some(e => e.includes('checkEnd')));
    assert.ok(validateMode({ ...MODES.solo, players: { min: 3, max: 2 } }).length > 0);
    assert.ok(validateMode({ ...MODES.duel, earnsCredits: true }).length > 0);
});

test('solo scaling equals today', () => {
    for (let level = 1; level <= 12; level++) {
        assert.deepEqual(scaleForPlayers('solo', 1, level), {
            asteroidCount: 10 + 3 * (level - 1), bossHpMult: 1, bossAttackMult: 1,
            ufoIntervalMult: 1, ufoMaxActive: 1, powerUpInterval: 20
        });
        assert.deepEqual(scaleForPlayers(MODES.coop, 1, level), scaleForPlayers('solo', 1, level));
    }
});

test('2-player co-op scaling numbers', () => {
    const s = scaleForPlayers('coop', 2, 1);
    assert.equal(s.asteroidCount, 15);
    assert.equal(s.bossHpMult, 1.6);
    assert.equal(s.bossAttackMult, 1.25);
    assert.ok(Math.abs(1 / s.ufoIntervalMult - 1.5) < 1e-12);
    assert.equal(s.ufoMaxActive, 2);
    assert.equal(s.powerUpInterval, 16);
    assert.throws(() => scaleForPlayers('nope', 1, 1));
});

test('co-op ends only when all are out', () => {
    const ps = two();
    const end = MODES.coop.hooks.checkEnd;
    assert.equal(end({}, ps), null);
    ps[0].out = true;
    assert.equal(end({}, ps), null);
    ps[1].out = true;
    assert.equal(end({}, ps).outcome, 'gameOver');
    assert.equal(MODES.solo.hooks.checkEnd({}, [ps[0]]).ended, true);
});

test('Harvest: highest score wins at time up', () => {
    const ps = two();
    ps[0].score = 500; ps[1].score = 300;
    const end = MODES.harvest.hooks.checkEnd;
    assert.equal(end({ timeLeft: 10, phase: 'normal' }, ps), null);
    assert.deepEqual(end({ timeLeft: 0, phase: 'normal' }, ps), { ended: true, outcome: 'win', winners: ['a'] });
});

test('Harvest: tie -> overtime -> next green wins, else draw', () => {
    const ps = two();
    ps[0].score = 400; ps[1].score = 400;
    const h = MODES.harvest.hooks;
    const round = { timeLeft: 0, phase: 'normal' };
    assert.deepEqual(h.checkEnd(round, ps), { ended: false, startPhase: 'overtime', duration: 20 });
    round.phase = 'overtime'; round.overtimeLeft = 20; round.overtimeWinner = null;
    assert.equal(h.checkEnd(round, ps), null);
    const d = h.onCollectGreen(round, ps[1]);
    assert.deepEqual(d, { points: true, endRound: true, winner: 'b' });
    round.overtimeWinner = d.winner;
    assert.deepEqual(h.checkEnd(round, ps), { ended: true, outcome: 'win', winners: ['b'] });
    const r2 = { phase: 'overtime', overtimeLeft: 0, overtimeWinner: null };
    assert.deepEqual(h.checkEnd(r2, ps), { ended: true, outcome: 'draw', winners: [] });
    assert.deepEqual(h.onShootGreen({}, ps[0]), { denied: true });
    assert.deepEqual(h.onCollectGreen({ phase: 'normal' }, ps[0]), { points: true });
});

test('Duel: 5th kill wins; time cap; sudden death', () => {
    const ps = two();
    const end = MODES.duel.hooks.checkEnd;
    const round = { timeLeft: 100, phase: 'normal', target: 5 };
    ps[0].stats.kills = 4; ps[1].stats.kills = 3;
    assert.equal(end(round, ps), null);
    ps[0].stats.kills = 5;
    assert.deepEqual(end(round, ps), { ended: true, outcome: 'win', winners: ['a'] });
    // time cap with a leader
    ps[0].stats.kills = 2; ps[1].stats.kills = 3;
    assert.deepEqual(end({ timeLeft: 0, phase: 'normal', target: 5 }, ps), { ended: true, outcome: 'win', winners: ['b'] });
    // time cap tied -> sudden death, next kill wins
    ps[0].stats.kills = 3;
    assert.deepEqual(end({ timeLeft: 0, phase: 'normal', target: 5 }, ps), { ended: false, startPhase: 'suddenDeath', duration: null });
    assert.equal(end({ timeLeft: 0, phase: 'suddenDeath', target: 5 }, ps), null);
    ps[0].stats.kills = 4;
    assert.deepEqual(end({ timeLeft: 0, phase: 'suddenDeath', target: 5 }, ps), { ended: true, outcome: 'win', winners: ['a'] });
    // self-inflicted deaths score for nobody
    const k = MODES.duel.hooks.onKill;
    assert.equal(k({}, ps[0], ps[0]), null);
    assert.equal(k({}, null, ps[0]), null);
    assert.deepEqual(k({}, ps[0], ps[1]), { credit: 'a' });
    assert.deepEqual(MODES.duel.hooks.onCollectGreen({}, ps[0]), { points: false, shieldSeconds: 4, shieldCap: 8 });
});

test('Saucer: target score or time', () => {
    const ps = two();
    const end = MODES.saucer.hooks.checkEnd;
    const round = { timeLeft: 60, difficulty: 'medium' };
    ps[0].score = 2499;
    assert.equal(end(round, ps), null);
    ps[0].score = 2500;
    assert.deepEqual(end(round, ps), { ended: true, outcome: 'win', winners: ['a'] });
    ps[0].score = 1800;
    assert.deepEqual(end({ timeLeft: 60, difficulty: 'easy' }, ps).winners, ['a']);
    assert.equal(end({ timeLeft: 60, difficulty: 'hard' }, ps), null);
    assert.deepEqual(end({ timeLeft: 0, difficulty: 'hard' }, ps), { ended: true, outcome: 'win', winners: ['b'] });
    ps[0].out = true;
    assert.deepEqual(end({ timeLeft: 60, difficulty: 'hard' }, ps).winners, ['b']);
});

test('Take Turns and Time Attack end conditions', () => {
    const ps = two();
    ps[0].score = 100; ps[1].score = 900;
    ps[0].lives = 0; ps[0].out = true;
    assert.equal(nextTurnIndex(ps, 1), 1);
    assert.equal(nextTurnIndex(ps, 0), 1);
    assert.deepEqual(MODES.turns.hooks.onDeath({}, ps[1], ps), { turnChange: false, nextIndex: 1, minDelay: 1 });
    ps[0].out = false; ps[0].lives = 2;
    assert.deepEqual(MODES.turns.hooks.onDeath({}, ps[1], ps), { turnChange: true, nextIndex: 0, minDelay: 1 });
    assert.equal(MODES.turns.hooks.checkEnd({}, ps), null);
    ps[0].out = true; ps[1].out = true;
    assert.equal(nextTurnIndex(ps, 0), -1);
    assert.deepEqual(MODES.turns.hooks.checkEnd({}, ps), { ended: true, outcome: 'win', winners: ['b'] });
    const solo = [createPlayer({ id: 'a' })];
    assert.equal(MODES.timeattack.hooks.checkEnd({ timeLeft: 5 }, solo), null);
    assert.equal(MODES.timeattack.hooks.checkEnd({ timeLeft: 0 }, solo).ended, true);
});

test('respawn point furthest from the opponent, avoiding hazards', () => {
    const W = 1200, H = 900;
    const grid = worldSpawnGrid(W, H, 4, 4);
    assert.equal(grid.length, 16);
    const opp = [{ x: 150, y: 112.5 }];
    // Furthest cell from (150,112.5) wrap-aware is (750, 562.5).
    assert.deepEqual(pickSpawnPoint(grid, opp, [], W, H), { x: 750, y: 562.5 });
    // A hazard on that cell moves the pick to another far, safe cell.
    const hz = [{ x: 750, y: 562.5, radius: 40 }];
    const p = pickSpawnPoint(grid, opp, hz, W, H);
    assert.notDeepEqual(p, { x: 750, y: 562.5 });
    assert.ok(Math.hypot(p.x - 750, p.y - 562.5) - 40 >= 150);
    // Wrap-aware: an opponent near the far corner is close to the origin cell too.
    const q = pickSpawnPoint(grid, [{ x: 1190, y: 890 }], [], W, H);
    assert.deepEqual(q, { x: 450, y: 337.5 });
    // No safe point at all: most clearance wins.
    const everywhere = grid.map(g => ({ x: g.x, y: g.y, radius: 10 }));
    everywhere.shift();
    assert.deepEqual(pickSpawnPoint(grid, opp, everywhere, W, H, { safeRadius: 10000 }), grid[0]);
    // No opponents (nearTeam): clearest ring point.
    const ring = ringSpawnGrid(600, 450, 100, W, H, 8);
    assert.equal(ring.length, 8);
    const r = pickSpawnPoint(ring, [], [{ x: 700, y: 450 }], W, H);
    assert.ok(Math.abs(r.x - 500) < 1e-9 && Math.abs(r.y - 450) < 1e-9);
    assert.equal(pickSpawnPoint([], opp, [], W, H), null);
});

test('revive rules', () => {
    let s = { progress: 0 };
    // needs 2 lives
    s = updateRevive(s, 0.5, true, 1);
    assert.deepEqual(s, { progress: 0, completed: false, blocked: true });
    // fills while in range
    s = updateRevive(s, 1.0, true, 2);
    assert.equal(s.progress, 1.0);
    // drains twice as fast out of range
    s = updateRevive(s, 0.25, false, 2);
    assert.equal(s.progress, 0.5);
    assert.equal(s.blocked, false);
    s = updateRevive(s, 1, false, 2);
    assert.equal(s.progress, 0);
    // completes at 2 s
    s = updateRevive({ progress: 0 }, 1.0, true, 3);
    s = updateRevive(s, 0.99, true, 3);
    assert.equal(s.completed, false);
    s = updateRevive(s, 0.01, true, 3);
    assert.equal(s.completed, true);
    assert.equal(s.progress, 0);
    assert.equal(REVIVE.radius, 70);
    assert.equal(MODES.coop.revive, REVIVE);
});
