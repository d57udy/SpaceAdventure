import { test } from 'node:test';
import assert from 'node:assert/strict';

const { PLAYER_COLOURS, Combo, createPlayer, tickPowerUps, livingPlayers, nearestLivingShip, teamScore, allOut } =
    await import('../../js/players.js');

const W = 1000, H = 800;
const ship = (x, y, extra = {}) => ({ x, y, isAlive: true, isInvulnerable: false, ...extra });

test('PLAYER_COLOURS has 4 distinct colours', () => {
    assert.equal(PLAYER_COLOURS.length, 4);
    assert.equal(new Set(PLAYER_COLOURS).size, 4);
});

test('combo thresholds: 5 -> 2x, 10 -> 3x, 20 -> 4x', () => {
    const c = new Combo();
    const mults = [];
    for (let i = 1; i <= 21; i++) mults[i] = c.addCollection().multiplier;
    assert.equal(mults[4], 1);
    assert.equal(mults[5], 2);
    assert.equal(mults[9], 2);
    assert.equal(mults[10], 3);
    assert.equal(mults[19], 3);
    assert.equal(mults[20], 4);
    assert.equal(c.multiplier, 4);
});

test('combo milestones give milestone*100 once each', () => {
    const c = new Combo();
    const bonuses = {};
    for (let i = 1; i <= 100; i++) {
        const r = c.addCollection();
        if (r.streakBonus) bonuses[r.milestone] = r.streakBonus;
    }
    assert.deepEqual(bonuses, { 5: 500, 10: 1000, 15: 1500, 25: 2500, 50: 5000, 100: 10000 });
});

test('combo expires after 3 s and reports lost only at 5+', () => {
    const c = new Combo();
    for (let i = 0; i < 5; i++) c.addCollection();
    assert.equal(c.update(2.9), null);
    const r = c.update(0.2);
    assert.deepEqual(r, { lost: true, count: 5 });
    assert.equal(c.count, 0);
    assert.equal(c.multiplier, 1);
    assert.equal(c.update(1), null);
    c.addCollection();
    assert.deepEqual(c.break(), { lost: false, count: 1 });
});

test('collection refreshes the combo timer', () => {
    const c = new Combo();
    c.addCollection();
    c.update(2.5);
    c.addCollection();
    assert.equal(c.update(2.5), null);
    assert.equal(c.count, 2);
});

test('milestones repeat after the combo breaks', () => {
    const c = new Combo();
    for (let i = 0; i < 4; i++) c.addCollection();
    assert.equal(c.addCollection().streakBonus, 500);
    c.break();
    for (let i = 0; i < 4; i++) c.addCollection();
    assert.equal(c.addCollection().streakBonus, 500);
});

test('createPlayer has the planned shape', () => {
    const p = createPlayer({ id: 'a', slot: 1, name: 'BOB', lives: 3 });
    assert.equal(p.colour, PLAYER_COLOURS[1]);
    assert.equal(p.score, 0);
    assert.equal(p.nextExtraLifeScore, 10000);
    assert.equal(p.out, false);
    assert.ok(p.combo instanceof Combo);
    assert.deepEqual(Object.keys(p.powerUps).sort(),
        ['magnet', 'rapid_fire', 'score_multiplier', 'shield', 'speed_boost', 'triple_shot']);
    for (const k of ['greens', 'redsShot', 'ufos', 'kills', 'deaths', 'shots', 'hits', 'bestCombo',
        'revivesGiven', 'greensDenied', 'creditsEarned']) assert.equal(p.stats[k], 0);
    const q = createPlayer({ slot: 0 });
    assert.notEqual(p.combo, q.combo);
    assert.notEqual(p.powerUps, q.powerUps);
});

test('power-up expiry is reported once', () => {
    const pu = { shield: 1, magnet: 5, rapid_fire: 0 };
    assert.deepEqual(tickPowerUps(pu, 0.5), []);
    assert.deepEqual(tickPowerUps(pu, 0.6), ['shield']);
    assert.equal(pu.shield, 0);
    assert.deepEqual(tickPowerUps(pu, 0.6), []);
    assert.deepEqual(tickPowerUps(pu, 10), ['magnet']);
    assert.deepEqual(tickPowerUps(pu, 10), []);
});

test('nearest living ship works across the wrap', () => {
    const a = createPlayer({ slot: 0 }); a.ship = ship(20, 400);
    const b = createPlayer({ slot: 1 }); b.ship = ship(900, 400);
    // from x=980, a at 20 is 40 away across the edge, b is 80 away
    assert.equal(nearestLivingShip(980, 400, [a, b], W, H), a.ship);
    assert.equal(nearestLivingShip(850, 400, [a, b], W, H), b.ship);
    // vertical wrap
    b.ship = ship(20, 780);
    assert.equal(nearestLivingShip(20, 10, [a, b], W, H), b.ship);
});

test('nearest living ship skips dead ships and out players', () => {
    const a = createPlayer({ slot: 0 }); a.ship = ship(10, 10, { isAlive: false });
    const b = createPlayer({ slot: 1 }); b.ship = ship(500, 500);
    const c = createPlayer({ slot: 2 }); c.ship = ship(12, 12); c.out = true;
    const d = createPlayer({ slot: 3 }); // no ship
    assert.equal(nearestLivingShip(0, 0, [a, b, c, d], W, H), b.ship);
    assert.equal(nearestLivingShip(0, 0, [a, c, d], W, H), null);
    assert.deepEqual(livingPlayers([a, b, c, d]), [b]);
});

test('nearest living ship prefers vulnerable ships', () => {
    const a = createPlayer({ slot: 0 }); a.ship = ship(10, 10, { isInvulnerable: true });
    const b = createPlayer({ slot: 1 }); b.ship = ship(500, 400);
    assert.equal(nearestLivingShip(0, 0, [a, b], W, H), b.ship);
    b.ship.isInvulnerable = true;
    assert.equal(nearestLivingShip(0, 0, [a, b], W, H), a.ship);
});

test('team score sums scores', () => {
    const ps = [createPlayer({ slot: 0 }), createPlayer({ slot: 1 })];
    ps[0].score = 1200; ps[1].score = 300;
    assert.equal(teamScore(ps), 1500);
    assert.equal(teamScore([]), 0);
});

test('allOut only when every player is out', () => {
    const ps = [createPlayer({ slot: 0 }), createPlayer({ slot: 1 })];
    assert.equal(allOut(ps), false);
    ps[0].out = true;
    assert.equal(allOut(ps), false);
    ps[1].out = true;
    assert.equal(allOut(ps), true);
    assert.equal(allOut([]), false);
});
