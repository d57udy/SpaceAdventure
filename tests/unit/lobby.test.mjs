import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SeatTable } from '../../js/seats.js';
import {
    LOBBY_COUNTDOWN, lobbyAction, guestName, createSeatLobby, handleLobbyEvent, tickLobby, canStart, joinedSeats,
    nameOptions, cycleSeatName, seatLineup, restoreSeatLineup, createCountLobby, setPlayerCount, changePlayerCount,
    countNameOptions, cycleCountName, countLineup, restoreCountLineup, serializeLineup, parseLineup,
} from '../../js/lobby.js';

function seatLobby(opts = {}) {
    const seats = new SeatTable();
    seats.setMerged(false);
    return createSeatLobby({ seats, currentUser: 'TESTER', profiles: ['TESTER', 'ALICE', 'BOB'], ...opts });
}
const ev = (source, action) => ({ source, action, seat: null });

test('lobby actions from keyboard seat actions and controller menu actions', () => {
    assert.equal(lobbyAction('fire'), 'fire');
    assert.equal(lobbyAction('menuSelect'), 'fire');
    assert.equal(lobbyAction('hyperspace'), 'back');
    assert.equal(lobbyAction('rotateLeft'), 'colourPrev');
    assert.equal(lobbyAction('menuRight'), 'colourNext');
    assert.equal(lobbyAction('thrust'), 'name');
    assert.equal(lobbyAction('pause'), null);
    assert.equal(guestName(1), 'Guest 2');
});

test('fire joins the lowest free seat; the first to join gets the signed-in profile', () => {
    const l = seatLobby();
    assert.deepEqual(handleLobbyEvent(l, ev('kbRight', 'fire')), { type: 'joined', seat: 0 });
    assert.deepEqual(handleLobbyEvent(l, ev('kbLeft', 'fire')), { type: 'joined', seat: 1 });
    assert.deepEqual(l.cards[0], { name: 'TESTER', profile: 'TESTER', ready: false });
    assert.deepEqual(l.cards[1], { name: 'Guest 2', profile: null, ready: false });
    assert.equal(l.seats.seatOf('kbRight'), 0);
    assert.deepEqual(joinedSeats(l), [0, 1]);
});

test('non-fire input from an unjoined source is ignored', () => {
    const l = seatLobby();
    assert.equal(handleLobbyEvent(l, ev('kbLeft', 'thrust')), null);
    assert.equal(handleLobbyEvent(l, ev('kbLeft', 'hyperspace')), null);
    assert.equal(handleLobbyEvent(l, ev('kbLeft', 'bogus')), null);
    assert.deepEqual(joinedSeats(l), []);
});

test('fire readies, hyperspace unreadies then leaves', () => {
    const l = seatLobby();
    handleLobbyEvent(l, ev('kbLeft', 'fire'));
    assert.deepEqual(handleLobbyEvent(l, ev('kbLeft', 'fire')), { type: 'ready', seat: 0 });
    assert.equal(handleLobbyEvent(l, ev('kbLeft', 'fire')), null); // already ready
    assert.deepEqual(handleLobbyEvent(l, ev('kbLeft', 'hyperspace')), { type: 'unready', seat: 0 });
    assert.deepEqual(handleLobbyEvent(l, ev('kbLeft', 'hyperspace')), { type: 'left', seat: 0 });
    assert.equal(l.cards[0], null);
    assert.equal(l.seats.seatOf('kbLeft'), null);
});

test('the lobby is full at the mode maximum; a 5th input is ignored', () => {
    const l = seatLobby();
    for (const s of ['kbLeft', 'kbRight', 'pad:0', 'pad:1']) assert.equal(handleLobbyEvent(l, ev(s, 'fire')).type, 'joined');
    assert.deepEqual(handleLobbyEvent(l, ev('pad:2', 'fire')), { type: 'full', seat: null });
    assert.equal(l.seats.seatOf('pad:2'), null);
    const two = seatLobby({ max: 2 });
    handleLobbyEvent(two, ev('kbLeft', 'fire'));
    handleLobbyEvent(two, ev('kbRight', 'fire'));
    assert.equal(handleLobbyEvent(two, ev('pad:0', 'fire')).type, 'full');
});

test('colour cycling skips colours other seats hold; ready players keep theirs', () => {
    const l = seatLobby();
    handleLobbyEvent(l, ev('kbLeft', 'fire'));
    handleLobbyEvent(l, ev('kbRight', 'fire'));
    assert.deepEqual([l.seats.colourOf(0), l.seats.colourOf(1)], [0, 1]);
    assert.equal(handleLobbyEvent(l, ev('kbLeft', 'rotateRight')).type, 'colour');
    assert.equal(l.seats.colourOf(0), 2);
    handleLobbyEvent(l, ev('kbRight', 'rotateLeft'));
    assert.equal(l.seats.colourOf(1), 0);
    handleLobbyEvent(l, ev('kbLeft', 'fire')); // ready
    assert.equal(handleLobbyEvent(l, ev('kbLeft', 'rotateRight')), null);
    assert.equal(l.seats.colourOf(0), 2);
});

test('names cycle through Guest N and profiles no other seat uses', () => {
    const l = seatLobby();
    handleLobbyEvent(l, ev('kbLeft', 'fire'));
    handleLobbyEvent(l, ev('kbRight', 'fire'));
    assert.deepEqual(nameOptions(l, 1).map(o => o.name), ['Guest 2', 'ALICE', 'BOB']);
    handleLobbyEvent(l, ev('kbRight', 'thrust'));
    assert.deepEqual(l.cards[1], { name: 'ALICE', profile: 'ALICE', ready: false });
    handleLobbyEvent(l, ev('kbRight', 'thrust'));
    assert.equal(l.cards[1].name, 'BOB');
    handleLobbyEvent(l, ev('kbRight', 'thrust'));
    assert.equal(l.cards[1].name, 'Guest 2');
    cycleSeatName(l, 1, -1);
    assert.equal(l.cards[1].name, 'BOB');
    // Seat 0 gives up TESTER; seat 1 can take it
    cycleSeatName(l, 0, -1);
    assert.equal(l.cards[0].name, 'Guest 1');
    assert.ok(nameOptions(l, 1).some(o => o.profile === 'TESTER'));
});

test('a profile is never offered twice (case-insensitive)', () => {
    const seats = new SeatTable();
    seats.setMerged(false);
    const l = createSeatLobby({ seats, currentUser: 'tester', profiles: ['TESTER', 'Tester', 'ALICE'] });
    assert.deepEqual(l.profiles, ['tester', 'ALICE']);
    handleLobbyEvent(l, ev('kbLeft', 'fire'));
    handleLobbyEvent(l, ev('kbRight', 'fire'));
    assert.deepEqual(nameOptions(l, 1).map(o => o.name), ['Guest 2', 'ALICE']);
});

test('countdown: starts with at least 2 players all ready, any change cancels, fires start at 0', () => {
    const l = seatLobby();
    handleLobbyEvent(l, ev('kbLeft', 'fire'));
    handleLobbyEvent(l, ev('kbLeft', 'fire'));
    assert.equal(canStart(l), false); // one player
    assert.equal(tickLobby(l, 0.1), null);
    assert.equal(l.countdown, null);
    handleLobbyEvent(l, ev('kbRight', 'fire'));
    handleLobbyEvent(l, ev('kbRight', 'fire'));
    assert.equal(canStart(l), true);
    assert.equal(tickLobby(l, 1), null);
    assert.equal(l.countdown, LOBBY_COUNTDOWN - 1);
    handleLobbyEvent(l, ev('kbRight', 'hyperspace')); // unready
    assert.equal(l.countdown, null);
    assert.equal(tickLobby(l, 1), null);
    handleLobbyEvent(l, ev('kbRight', 'fire'));
    tickLobby(l, 1);
    handleLobbyEvent(l, ev('pad:0', 'fire')); // someone joins: cancelled
    assert.equal(l.countdown, null);
    assert.equal(tickLobby(l, 1), null); // pad:0 not ready yet
    handleLobbyEvent(l, ev('pad:0', 'fire'));
    assert.equal(tickLobby(l, 2), null);
    assert.equal(tickLobby(l, 1.01), 'start');
});

test('line-up in seat order; restore rebuilds seats, sources, colours and names, not ready', () => {
    const l = seatLobby();
    handleLobbyEvent(l, ev('kbRight', 'fire'));
    handleLobbyEvent(l, ev('kbLeft', 'fire'));
    handleLobbyEvent(l, ev('kbLeft', 'rotateLeft')); // colour 1 -> 3 (0 taken)
    handleLobbyEvent(l, ev('kbLeft', 'thrust')); // ALICE
    handleLobbyEvent(l, ev('kbLeft', 'fire'));
    const lineup = seatLineup(l);
    assert.deepEqual(lineup, [
        { seat: 0, source: 'kbRight', colour: 0, name: 'TESTER', profile: 'TESTER' },
        { seat: 1, source: 'kbLeft', colour: 3, name: 'ALICE', profile: 'ALICE' },
    ]);
    const again = seatLobby();
    handleLobbyEvent(again, ev('pad:3', 'fire')); // cleared by the restore
    restoreSeatLineup(again, lineup);
    assert.deepEqual(seatLineup(again), lineup);
    assert.ok(again.cards.every(c => !c || !c.ready));
    assert.equal(again.seats.seatOf('pad:3'), null);
    assert.equal(again.seats.seatOf('kbLeft'), 1);
});

test('restore drops bad entries and turns unknown or duplicate profiles into guests', () => {
    const l = seatLobby();
    restoreSeatLineup(l, [
        { seat: 0, source: 'kbLeft', colour: 2, name: 'ZED', profile: 'ZED' },
        { seat: 1, source: 'kbLeft', colour: 1, name: 'dup source', profile: null },
        { seat: 2, source: 'kbRight', colour: 1, name: 'ALICE', profile: 'ALICE' },
        { seat: 3, source: 'pad:0', colour: 3, name: 'ALICE', profile: 'ALICE' },
        { seat: 7, source: 'pad:1' }, null, { seat: 1 },
    ]);
    assert.deepEqual(seatLineup(l).map(e => [e.seat, e.source, e.name]), [
        [0, 'kbLeft', 'Guest 1'], [2, 'kbRight', 'ALICE'], [3, 'pad:0', 'Guest 4'],
    ]);
});

test('count lobby: 2 to 4 players, P1 is the signed-in user, names cycle', () => {
    const l = createCountLobby({ currentUser: 'TESTER', profiles: ['ALICE'] });
    assert.equal(l.count, 2);
    assert.deepEqual(countLineup(l).map(e => e.name), ['TESTER', 'Guest 2']);
    assert.equal(changePlayerCount(l, 1), 3);
    assert.equal(changePlayerCount(l, 1), 4);
    assert.equal(changePlayerCount(l, 1), 2); // wraps
    assert.equal(changePlayerCount(l, -1), 4);
    assert.equal(setPlayerCount(l, 9), 4);
    assert.equal(setPlayerCount(l, 0), 2);
    assert.deepEqual(countNameOptions(l, 1).map(o => o.name), ['Guest 2', 'ALICE']); // TESTER is P1's
    cycleCountName(l, 1, 1);
    assert.deepEqual(l.names[1], { name: 'ALICE', profile: 'ALICE' });
    cycleCountName(l, 0, 1); // TESTER -> ... skips ALICE (P2 has it) -> Guest 1
    assert.equal(l.names[0].name, 'Guest 1');
    assert.deepEqual(countLineup(l).map(e => [e.seat, e.name, e.profile, e.colour]), [
        [0, 'Guest 1', null, 0], [1, 'ALICE', 'ALICE', 1],
    ]);
});

test('count lobby restore and duplicate protection', () => {
    const l = createCountLobby({ currentUser: 'TESTER', profiles: ['ALICE'] });
    restoreCountLineup(l, [{ seat: 0, name: 'ALICE', profile: 'ALICE' }, { seat: 1, name: 'x', profile: null }, { seat: 2, name: 'NOPE', profile: 'NOPE' }]);
    assert.equal(l.count, 3);
    assert.deepEqual(countLineup(l).map(e => e.name), ['ALICE', 'Guest 2', 'Guest 3']);
    l.names[1] = { name: 'ALICE', profile: 'ALICE' }; // a stale duplicate
    assert.deepEqual(countLineup(l).map(e => e.name), ['ALICE', 'Guest 2', 'Guest 3']);
});

test('saved line-up round trip; corrupt data gives null', () => {
    const lineup = [{ seat: 0, source: 'kbLeft', colour: 2, name: 'TESTER', profile: 'TESTER' },
        { seat: 1, source: null, colour: 1, name: 'Guest 2', profile: null }];
    assert.deepEqual(parseLineup(serializeLineup('turns', 'seats', lineup)), { modeId: 'turns', kind: 'seats', players: lineup });
    assert.equal(parseLineup(null), null);
    assert.equal(parseLineup('{nope'), null);
    assert.equal(parseLineup(JSON.stringify({ modeId: 'turns', kind: 'other', players: [] })), null);
    assert.equal(parseLineup(JSON.stringify({ modeId: 'turns', kind: 'count' })), null);
    assert.deepEqual(parseLineup(JSON.stringify({ modeId: 'turns', kind: 'count', players: [null, { seat: 'x' }, { seat: 1 }] })).players,
        [{ seat: 1, source: null, colour: 1, name: 'Guest 2', profile: null }]);
});
