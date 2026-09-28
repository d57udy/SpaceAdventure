// Back button / history handling (js/backNav.js): the pure state rules and the controller
// with a fake History.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wantsGuard, backAction, isGuardState, createBackNav, GUARD_KEY } from '../../js/backNav.js';

test('wantsGuard: only the main menu and the first name prompt are roots', () => {
    assert.equal(wantsGuard('menu'), false);
    assert.equal(wantsGuard('prompt_user'), false);
    assert.equal(wantsGuard('menu', { resetConfirm: true }), true); // the Reset dialog backs out
    for (const s of ['playing', 'paused', 'settings', 'help', 'high_scores', 'achievements', 'upgrades',
        'tutorial_ask', 'game_over', 'mp_mode_select', 'lobby', 'turn_change', 'round_end', 'results', 'ta_setup']) {
        assert.equal(wantsGuard(s), true, s);
    }
});

test('backAction: pause in play, own Escape in sub-screens, menu, none, leave', () => {
    assert.equal(backAction('playing'), 'pause');
    assert.equal(backAction('paused'), 'none');
    assert.equal(backAction('round_end'), 'none');
    for (const s of ['settings', 'help', 'high_scores', 'achievements', 'upgrades', 'mp_mode_select',
        'lobby', 'turn_change', 'results', 'ta_setup']) {
        assert.equal(backAction(s), 'escape', s);
    }
    assert.equal(backAction('tutorial_ask'), 'menu');
    assert.equal(backAction('game_over'), 'menu');
    assert.equal(backAction('menu'), 'leave');
    assert.equal(backAction('prompt_user'), 'leave');
    assert.equal(backAction('menu', { resetConfirm: true }), 'escape');
});

test('isGuardState', () => {
    assert.equal(isGuardState({ [GUARD_KEY]: true }), true);
    assert.equal(isGuardState(null), false);
    assert.equal(isGuardState({ other: 1 }), false);
    assert.equal(isGuardState('x'), false);
});

// A same-document History: entries with states; back() fires popstate asynchronously in a
// browser, here when the test calls flush().
function fakeHistory(initialState = null) {
    const h = {
        entries: [{ state: initialState, url: 'https://x.test/app/?a=1#h' }],
        index: 0,
        queued: [],
        listeners: [],
        get state() { return this.entries[this.index].state; },
        get length() { return this.entries.length; },
        pushState(state, _t, url) {
            this.entries.length = this.index + 1;
            this.entries.push({ state, url });
            this.index++;
        },
        replaceState(state, _t, url) { this.entries[this.index] = { state, url }; },
        back() { this.queued.push(-1); },
        // The user presses Back
        userBack() { this.back(); this.flush(); },
        flush() {
            while (this.queued.length) {
                const d = this.queued.shift();
                const i = this.index + d;
                if (i < 0) continue; // would leave the page
                this.index = i;
                for (const fn of this.listeners) fn({ state: this.state });
            }
        },
    };
    return h;
}

function setup({ state = 'menu', initialState = null, resetConfirm = false } = {}) {
    const history = fakeHistory(initialState);
    const ctx = { state, resetConfirm };
    const backs = [];
    let t = 1000;
    const nav = createBackNav({
        history,
        getUrl: () => history.entries[history.index].url,
        listen: (type, fn) => { if (type === 'popstate') history.listeners.push(fn); },
        getContext: () => ctx,
        onBack: (a) => backs.push(a),
        now: () => t,
    });
    return { history, ctx, backs, nav, advance: (ms) => { t += ms; } };
}

test('menu: no guard, Back leaves the page', () => {
    const { history, nav, backs } = setup();
    nav.sync();
    assert.equal(history.length, 1);
    history.userBack();
    assert.equal(history.index, 0); // nothing to pop: the browser leaves
    assert.deepEqual(backs, []);
});

test('Settings: a guard is pushed (same URL); Back runs the screen\'s Escape and returns to the menu', () => {
    const { history, ctx, nav, backs } = setup();
    ctx.state = 'settings';
    nav.sync();
    nav.sync(); // idempotent
    assert.equal(history.length, 2);
    assert.equal(isGuardState(history.state), true);
    assert.equal(history.entries[1].url, history.entries[0].url, 'the URL stays the same');
    history.userBack();
    assert.deepEqual(backs, ['escape']);
    ctx.state = 'menu'; // the game handles Escape
    nav.sync();
    assert.equal(history.index, 0);
    assert.equal(history.queued.length, 0, 'no extra back() from the menu');
    assert.equal(nav.snapshot().guarded, false);
});

test('playing: Back pauses and the guard comes back (a second Back stays in the game)', () => {
    const { history, ctx, nav, backs } = setup();
    ctx.state = 'playing';
    nav.sync();
    history.userBack();
    assert.deepEqual(backs, ['pause']);
    ctx.state = 'paused';
    nav.sync();
    assert.equal(isGuardState(history.state), true, 're-pushed');
    assert.equal(history.index, 1);
    history.userBack(); // Back while paused: stays paused
    assert.deepEqual(backs, ['pause']);
    nav.sync();
    assert.equal(isGuardState(history.state), true);
});

test('returning to the menu in-game removes the guard with history.back() and ignores its popstate', () => {
    const { history, ctx, nav, backs } = setup();
    ctx.state = 'help';
    nav.sync();
    ctx.state = 'menu';
    nav.sync();
    assert.equal(history.queued.length, 1, 'history.back() once');
    nav.sync(); // pending: nothing more
    assert.equal(history.queued.length, 1);
    ctx.state = 'settings'; // the user opens another screen before the popstate lands
    nav.sync();
    assert.equal(history.length, 2, 'no push while our back() is pending');
    history.flush();
    assert.deepEqual(backs, [], 'our own back() is not a Back press');
    nav.sync();
    assert.equal(isGuardState(history.state), true, 'pushed after it landed');
    assert.equal(history.index, 1);
});

test('a pending back() that never lands times out', () => {
    const { history, ctx, nav, advance } = setup();
    ctx.state = 'help';
    nav.sync();
    ctx.state = 'menu';
    nav.sync();
    history.queued.length = 0; // lost
    ctx.state = 'settings';
    advance(2000);
    nav.sync();
    assert.equal(nav.snapshot().pendingBack, 0);
    assert.equal(nav.snapshot().pushes, 2);
});

test('Reset dialog in the menu: Back cancels it (escape)', () => {
    const { history, ctx, nav, backs } = setup({ resetConfirm: true });
    nav.sync();
    assert.equal(history.length, 2);
    history.userBack();
    assert.deepEqual(backs, ['escape']);
});

test('tutorial question and Game Over: Back goes to the menu', () => {
    const { history, ctx, nav, backs } = setup();
    ctx.state = 'tutorial_ask';
    nav.sync();
    history.userBack();
    ctx.state = 'game_over';
    nav.sync();
    history.userBack();
    assert.deepEqual(backs, ['menu', 'menu']);
});

test('a reload keeps history.state: a stale guard is replaced, never popped', () => {
    const { history, nav } = setup({ initialState: { [GUARD_KEY]: true } });
    assert.equal(isGuardState(history.state), false);
    assert.equal(history.queued.length, 0);
    nav.sync();
    assert.equal(history.length, 1);
});

test('no History API or a throwing one: never throws', () => {
    const nav = createBackNav({ history: null, getUrl: () => '', listen: () => {}, getContext: () => ({ state: 'playing' }), onBack: () => {} });
    nav.sync();
    assert.equal(nav.snapshot().supported, false);
    const bad = {
        state: null,
        pushState() { throw new Error('SecurityError'); },
        replaceState() { throw new Error('SecurityError'); },
        back() { throw new Error('nope'); },
    };
    const nav2 = createBackNav({ history: bad, getUrl: () => '', listen: () => {}, getContext: () => ({ state: 'playing' }), onBack: () => {} });
    assert.doesNotThrow(() => nav2.sync());
});
