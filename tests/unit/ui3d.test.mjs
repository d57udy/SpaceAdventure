// The 3D menus and screens (js/3d/ui3d.js) on a minimal fake DOM, with the real settings,
// persistence, progress and tutorial modules over a fake localStorage.
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
let storage;
function installStorage(s) {
    storage = s;
    globalThis.window = { localStorage: s };
    Object.defineProperty(globalThis, 'localStorage', { value: s, configurable: true, writable: true });
}
installStorage(new FakeStorage());
beforeEach(() => installStorage(new FakeStorage()));

const { PersistenceManager } = await import('../../js/persistence.js');
const { createSettings } = await import('../../js/settings.js');
const { createProgress3d } = await import('../../js/3d/progress3d.js');
const {
    createUi3d, SETTINGS3D_ROWS, settingText, stepSetting, SCREENS, CONTROL_HELP,
} = await import('../../js/3d/ui3d.js');

// --- fake DOM: a tree of elements with the few members ui3d uses
function makeDoc() {
    const doc = { activeElement: null, listeners: {} };
    function makeEl(tag) {
        const l = {};
        let cls = new Set();
        const el = {
            tagName: tag.toUpperCase(), children: [], parentNode: null, attrs: {}, style: {}, value: '', disabled: false, type: '',
            _text: '', id: '',
            get className() { return [...cls].join(' '); },
            set className(v) { cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
            classList: {
                add: (...c) => c.forEach((x) => cls.add(x)),
                remove: (...c) => c.forEach((x) => cls.delete(x)),
                toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; if (v) cls.add(c); else cls.delete(c); return v; },
                contains: (c) => cls.has(c),
            },
            get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); },
            set textContent(v) { for (const c of this.children) c.parentNode = null; this.children = []; this._text = String(v); },
            appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
            removeChild(c) { el.children = el.children.filter((x) => x !== c); c.parentNode = null; return c; },
            setAttribute(k, v) { el.attrs[k] = String(v); },
            getAttribute(k) { return el.attrs[k] ?? null; },
            addEventListener(t, f) { (l[t] ||= []).push(f); },
            removeEventListener(t, f) { l[t] = (l[t] || []).filter((g) => g !== f); },
            fire(t, e = {}) { for (const f of l[t] || []) f({ target: el, preventDefault() {}, ...e }); },
            click() { if (!el.disabled) el.fire('click'); },
            focus() { doc.activeElement = el; el.fire('focus'); },
            scrollIntoView() {},
        };
        return el;
    }
    doc.createElement = makeEl;
    doc.head = makeEl('head');
    doc.body = makeEl('body');
    doc.addEventListener = (t, f) => { (doc.listeners[t] ||= []).push(f); };
    doc.removeEventListener = (t, f) => { doc.listeners[t] = (doc.listeners[t] || []).filter((g) => g !== f); };
    doc.key = (key, extra = {}) => {
        const e = { key, prevented: false, preventDefault() { e.prevented = true; }, stopPropagation() {}, ...extra };
        for (const f of doc.listeners.keydown || []) f(e);
        return e;
    };
    return doc;
}

function walk(el, fn) { fn(el); for (const c of el.children) walk(c, fn); }
function byU3d(root, id) {
    let out = null;
    walk(root, (e) => { if (!out && e.getAttribute('data-u3d') === id) out = e; });
    return out;
}
function findAll(root, pred) { const out = []; walk(root, (e) => { if (pred(e)) out.push(e); }); return out; }

function setup({ user = 'ann', progress, ...opts } = {}) {
    const doc = makeDoc();
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    const settings = createSettings({ storage });
    const persistence = new PersistenceManager();
    if (user) persistence.setCurrentUser(user);
    const calls = [];
    const log = (name) => (...a) => calls.push([name, ...a]);
    const ui = createUi3d({
        doc, root, settings, persistence, progress, version: 'v-test',
        onPlay: log('play'), onResume: log('resume'), onRestart: log('restart'), onQuit: log('quit'),
        onSwitch2d: log('switch2d'), onSettingChange: log('setting'), onProfileChange: log('profile'),
        ...opts,
    });
    const $ = (id) => byU3d(root, id);
    return { doc, root, settings, persistence, ui, calls, $, snap: () => ui.snapshot() };
}

test('CSS injected once per document; overlay hidden until shown', () => {
    const { doc, root, ui, snap } = setup();
    assert.equal(doc.head.children.length, 1);
    assert.match(doc.head.children[0].textContent, /#u3d/);
    assert.match(doc.head.children[0].textContent, /safe-area-inset/);
    createUi3d({ doc, root: doc.createElement('div'), settings: createSettings({ storage }), keys: false });
    assert.equal(doc.head.children.length, 1, 'a second ui on the same document adds no CSS');
    assert.equal(ui.overlay.className, 'u3d-hidden');
    assert.equal(snap().visible, false);
    assert.equal(ui.current, null);
    assert.equal(root.classList.contains('u3d-open'), false);
    assert.ok(SCREENS.includes('menu') && SCREENS.includes('prompt'));
});

test('main menu: items, profile name, version, Switch to 2D', () => {
    const { ui, $, calls, root, snap } = setup();
    ui.show('menu');
    const s = snap();
    assert.equal(s.screen, 'menu');
    assert.equal(root.classList.contains('u3d-open'), true);
    assert.deepEqual(s.items.map((i) => i.id), ['play', 'settings', 'highscores', 'upgrades', 'help', 'profile', 'switch2d']);
    assert.equal(s.focus, 'play');
    assert.equal(s.view.profile, 'ann');
    assert.equal(s.view.version, 'v-test');
    assert.match(ui.overlay.textContent, /Pilot: ann/);
    assert.match(ui.overlay.textContent, /v-test/);
    $('switch2d').click();
    assert.deepEqual(calls.at(-1), ['switch2d']);
});

test('navigation: up / down wrap, left / right move between buttons, select activates', () => {
    const { ui, snap, calls } = setup();
    ui.show('menu');
    ui.navigate('up');
    assert.equal(snap().focus, 'switch2d', 'up from the first wraps to the last');
    ui.navigate('down');
    assert.equal(snap().focus, 'play');
    ui.navigate('right');
    ui.navigate('right');
    assert.equal(snap().focus, 'highscores');
    ui.navigate('left');
    assert.equal(snap().focus, 'settings');
    assert.ok(ui.overlay.children[0].children.length > 0);
    ui.select();
    assert.equal(ui.current, 'settings');
    assert.equal(ui.back(), true);
    assert.equal(ui.current, 'menu');
    assert.equal(ui.back(), false, 'nothing behind the menu');
    ui.hide();
    assert.equal(ui.navigate('down'), false, 'hidden: input ignored');
    assert.equal(ui.select(), false);
    assert.equal(calls.length, 0);
});

test('keyboard: arrows, Enter, Escape; ignored while hidden', () => {
    const { ui, doc, snap } = setup();
    assert.equal(doc.key('Enter').prevented, false, 'hidden');
    ui.show('menu');
    assert.equal(doc.key('ArrowDown').prevented, true);
    assert.equal(snap().focus, 'settings');
    doc.key('Enter');
    assert.equal(ui.current, 'settings');
    doc.key('Enter', { repeat: true });
    doc.key('Escape');
    assert.equal(ui.current, 'menu');
    assert.equal(snap().focus, 'settings', 'back restores the focus on the item that opened the screen');
    doc.key(' ');
    assert.equal(ui.current, 'settings', 'Space selects too');
});

test('no profile: name screen first, 2D name rules, then the menu', () => {
    const { ui, $, snap, persistence, calls, doc } = setup({ user: null });
    ui.show('menu');
    assert.equal(ui.current, 'profile');
    assert.deepEqual(snap().items.map((i) => i.id), ['name', 'name-ok', 'guest']);
    assert.equal(ui.back(), false, 'a name or guest first');
    const input = $('name');
    input.value = 'ü-1';
    input.fire('input', {});
    assert.equal(input.value, 'Ü1', 'sanitised like 2D (upper case, letters and digits)');
    doc.key('Enter');
    assert.equal(ui.current, 'profile');
    assert.match(snap().view.error, /at least 3/);
    const input2 = $('name');
    input2.value = 'jürgen';
    input2.fire('input', {});
    $('name-ok').click();
    assert.equal(ui.current, 'menu');
    assert.equal(persistence.getCurrentUser(), 'JÜRGEN');
    assert.equal(snap().profile, 'JÜRGEN');
    assert.equal(ui.progress.user, 'JÜRGEN', 'progress rebuilt for the new profile');
    assert.equal(calls.at(-1)[0], 'profile');
    assert.equal(calls.at(-1)[1], 'JÜRGEN');
});

test('composition is not cleaned until it ends', () => {
    const { ui, $ } = setup({ user: null });
    ui.show('profile');
    const input = $('name');
    input.value = 'さく';
    input.fire('input', { isComposing: true });
    assert.equal(input.value, 'さく');
    input.value = 'さくら!';
    input.fire('compositionend');
    assert.equal(input.value, 'さくら');
});

test('guest: Play as guest, menu shows Guest, guests cannot buy upgrades or keep scores', () => {
    const { ui, $, snap, persistence, calls } = setup({ user: null });
    ui.show('menu');
    $('guest').click();
    assert.equal(ui.current, 'menu');
    assert.equal(ui.guest, true);
    assert.equal(snap().guest, true);
    assert.match(ui.overlay.textContent, /Pilot: Guest/);
    assert.deepEqual(calls.at(-1), ['profile', null, ui.progress]);
    ui.show('menu');
    assert.equal(ui.current, 'menu', 'not asked again this session');
    ui.show('upgrades');
    assert.equal(snap().view.canBuy, false);
    assert.ok(snap().items.filter((i) => i.id.startsWith('buy-')).every((i) => i.disabled));
    assert.equal(persistence.getCurrentUser(), null);
});

test('Change pilot from a named profile; guest signs out', () => {
    const { ui, $, persistence } = setup();
    ui.show('menu');
    $('profile').click();
    assert.equal(ui.current, 'profile');
    assert.equal($('name').value, 'ann', 'the current name is prefilled');
    assert.equal(ui.back(), true);
    assert.equal(ui.current, 'menu');
    $('profile').click();
    $('guest').click();
    assert.equal(persistence.getCurrentUser(), null);
    assert.equal(ui.progress.user, null);
});

test('settings: every 3D and shared key, values persist through the settings object', () => {
    const { ui, snap, calls, settings, $ } = setup();
    ui.show('settings', { from: 'menu' });
    const ids = snap().items.filter((i) => i.kind === 'row').map((i) => i.id.slice(4));
    assert.deepEqual(ids, [
        'control3d', 'levelHorizon3d', 'sensitivity3d', 'invert3d', 'viewDistance3d', 'fov3d', 'vignette3d', 'leftHanded3d',
        'difficulty', 'palette', 'haptics', 'musicTune', 'musicVolume', 'sfxVolume', 'rumble', 'debug3d',
    ]);
    assert.deepEqual(ids, SETTINGS3D_ROWS.map((r) => r.key));
    assert.equal(snap().focus, 'set-control3d');
    ui.navigate('right');
    assert.equal(settings.get('control3d'), 'rate');
    assert.deepEqual(calls.at(-1), ['setting', 'control3d', 'rate']);
    assert.equal(storage.getItem('spaceAdventure_control3d'), 'rate');
    assert.equal(snap().view.from, 'menu');
    assert.match(ui.overlay.textContent, /Rate: tilt the phone/, 'the hint follows the control type');
    ui.navigate('left');
    ui.navigate('left');
    assert.equal(settings.get('control3d'), 'joystick', 'enums wrap');
    // Field of view: steps of 5, clamped to 60..95, default 70
    assert.equal(settings.get('fov3d'), 70);
    const fovRow = $('set-fov3d');
    const [less, , more] = fovRow.children;
    for (let i = 0; i < 9; i++) more.click();
    assert.equal(settings.get('fov3d'), 95);
    assert.equal(snap().focus, 'set-fov3d', 'a tap moves the focus to its row');
    for (let i = 0; i < 9; i++) less.click();
    assert.equal(settings.get('fov3d'), 60);
    assert.match(fovRow.textContent, /60°/);
    // Booleans toggle; the middle of the row steps forward
    const mid = $('set-invert3d').children[1];
    mid.click();
    assert.equal(settings.get('invert3d'), true);
    assert.equal(storage.getItem('spaceAdventure_invert3d'), 'true');
    // Volumes clamp
    while (snap().focus !== 'set-sfxVolume') ui.navigate('down');
    ui.navigate('right');
    assert.equal(settings.get('sfxVolume'), 10);
    ui.select();
    assert.equal(settings.get('sfxVolume'), 10);
    ui.navigate('left');
    assert.equal(settings.get('sfxVolume'), 9);
    // A fresh settings object reads the same values back
    const again = createSettings({ storage });
    assert.equal(again.get('fov3d'), 60);
    assert.equal(again.get('control3d'), 'joystick');
    assert.equal(again.get('sfxVolume'), 9);
    assert.equal(snap().items.find((i) => i.id === 'set-sfxVolume').value, 9);
    ui.back();
    assert.equal(ui.current, 'menu');
});

test('setting labels and steps', () => {
    const settings = createSettings({ storage });
    assert.equal(settingText('viewDistance3d', 'veryfar'), 'Very far');
    assert.equal(settingText('palette', 'safe'), 'Colour-safe');
    assert.equal(settingText('difficulty', 'hard'), 'Hard');
    assert.equal(settingText('musicTune', 'off'), 'Off');
    assert.equal(settingText('haptics', false), 'Off');
    assert.equal(settingText('fov3d', 75), '75°');
    assert.equal(stepSetting(settings, 'difficulty', 1), 'hard');
    assert.equal(stepSetting(settings, 'difficulty', 1), 'easy');
    assert.equal(stepSetting(settings, 'viewDistance3d', -1), 'normal');
    assert.equal(stepSetting(settings, 'nope', 1), undefined);
    assert.equal(settings.get('difficulty'), 'easy');
});

test('tutorial offer on Play for a new player, once', () => {
    const { ui, $, calls, persistence, settings } = setup();
    ui.show('menu');
    $('play').click();
    assert.equal(ui.current, 'tutorial');
    $('tutorial-yes').click();
    assert.equal(ui.current, null, 'hidden for play');
    assert.equal(calls.at(-1)[0], 'play');
    assert.equal(calls.at(-1)[1].tutorial, true);
    assert.equal(calls.at(-1)[1].user, 'ann');
    assert.ok(calls.at(-1)[1].progress);
    assert.equal(persistence.loadTutorial3dState('ann').asked, true);
    ui.show('menu');
    $('play').click();
    assert.equal(ui.current, null, 'not asked again');
    assert.equal(calls.at(-1)[1].tutorial, false);
    // Another new pilot says no; Offer tutorial off never asks
    persistence.setCurrentUser('bob');
    ui.show('menu');
    $('play').click();
    $('tutorial-no').click();
    assert.equal(calls.at(-1)[1].tutorial, false);
    assert.equal(persistence.loadTutorial3dState('bob').skipped, true);
    settings.set('offerTutorial', false);
    persistence.setCurrentUser('cat');
    ui.show('menu');
    $('play').click();
    assert.equal(ui.current, null);
    // Guests are never asked; Back from the offer returns to the menu
    installStorage(new FakeStorage());
    const g = setup({ user: null });
    g.ui.show('menu');
    g.$('guest').click();
    g.$('play').click();
    assert.equal(g.calls.at(-1)[0], 'play');
    const t = setup({ user: 'dan' });
    t.ui.show('menu');
    t.$('play').click();
    assert.equal(t.ui.back(), true);
    assert.equal(t.ui.current, 'menu');
});

test('injected tutorial api', () => {
    const asked = [];
    const { ui, $, calls } = setup({
        tutorialApi: { shouldAsk: () => true, recordAnswer: (ctx, play) => asked.push([ctx.user, play]) },
    });
    ui.show('menu');
    $('play').click();
    $('tutorial-no').click();
    assert.deepEqual(asked, [['ann', false]]);
    assert.equal(calls.at(-1)[1].tutorial, false);
});

test('game over: finishGame rank, credits, achievements; Play again and Menu', () => {
    const { ui, $, snap, calls, persistence } = setup();
    persistence.saveHighScores3d('ann', [{ name: 'ANN', score: 900, level: 3 }, { name: 'ANN', score: 100, level: 1 }]);
    const p = ui.progress;
    p.startGame();
    p.setLevel(3); // unlocks LEVEL_3
    p.awardPoints(500);
    ui.show('gameOver', { score: 500, level: 3 });
    const v = snap().view;
    assert.equal(v.score, 500);
    assert.equal(v.level, 3);
    assert.equal(v.rank, 1, 'second place on the board');
    assert.equal(v.newHigh, true);
    assert.equal(v.credits, 50, '10 % of the points');
    assert.ok(v.unlocked.includes('Getting Started'), v.unlocked.join());
    assert.match(ui.overlay.textContent, /New high score! Place 2/);
    assert.deepEqual(persistence.loadHighScores3d('ann').map((e) => e.score), [900, 500, 100]);
    assert.deepEqual(p.takeUnlocked(), [], 'achievements taken once');
    assert.deepEqual(snap().items.map((i) => i.id), ['again', 'highscores', 'menu']);
    // High Scores from game over: the new entry highlighted; Back returns to game over
    $('highscores').click();
    assert.equal(ui.current, 'highScores');
    assert.equal(snap().view.rows[snap().view.highlight].score, 500);
    ui.back();
    assert.equal(ui.current, 'gameOver');
    assert.equal(persistence.loadHighScores3d('ann').length, 3, 'going back does not save the game twice');
    $('again').click();
    assert.equal(ui.current, null);
    assert.deepEqual([calls.at(-1)[0], calls.at(-1)[1].again, calls.at(-1)[1].tutorial], ['play', true, false]);
    ui.show('gameOver', { score: 50, level: 1, rank: -1, credits: 5, unlocked: [] });
    assert.equal(snap().view.newHigh, false);
    assert.deepEqual(snap().items.map((i) => i.id), ['again', 'menu']);
    assert.equal(ui.back(), true);
    assert.equal(ui.current, 'menu');
});

test('game over as a guest: nothing saved', () => {
    const { ui, $, snap, persistence } = setup({ user: null });
    ui.show('menu');
    $('guest').click();
    ui.show('gameOver', { score: 800, level: 2 });
    assert.equal(snap().view.rank, -1);
    assert.equal(snap().view.guest, true);
    assert.match(ui.overlay.textContent, /guest/);
    assert.deepEqual(persistence.loadHighScores3d(), []);
});

test('high scores: all pilots and mine, last entry highlighted from the menu', () => {
    const { ui, $, snap, persistence } = setup();
    persistence.setCurrentUser('bob');
    persistence.saveHighScores3d('bob', [{ name: 'BOB', score: 2000, level: 5 }]);
    persistence.setCurrentUser('ann');
    persistence.saveHighScores3d('ann', [{ name: 'ANN', score: 300, level: 2 }]);
    ui.show('highScores');
    let v = snap().view;
    assert.equal(v.board, 'all');
    assert.deepEqual(v.rows.map((r) => r.score), [2000, 300]);
    assert.equal(v.highlight, -1, 'no game yet');
    ui.show('gameOver', { score: 1000, level: 4 });
    ui.show('menu');
    $('highscores').click();
    v = snap().view;
    assert.deepEqual(v.rows.map((r) => [r.user, r.score]), [['bob', 2000], ['ann', 1000], ['ann', 300]]);
    assert.equal(v.highlight, 1);
    const hl = findAll(ui.overlay, (e) => e.tagName === 'TR' && e.classList.contains('u3d-hl'));
    assert.equal(hl.length, 1);
    assert.match(hl[0].textContent, /1000/);
    $('hs-view').click();
    v = snap().view;
    assert.equal(v.board, 'mine');
    assert.deepEqual(v.rows.map((r) => r.score), [1000, 300]);
    assert.equal(v.highlight, 0);
    assert.equal(snap().focus, 'hs-view', 'focus stays on the switch');
    ui.show('highScores', { highlight: null });
    assert.equal(snap().view.highlight, -1, 'highlight can be turned off');
    ui.back();
    assert.equal(ui.current, 'menu');
});

test('upgrades: shared credits and levels, Buy through UpgradeState', () => {
    const { ui, $, snap, persistence } = setup();
    persistence.saveUpgrades('ann', { levels: { turnSpeed: 1 }, currency: 700 });
    ui.show('menu');
    $('profile').click();
    $('name').value = 'ann';
    $('name').fire('input', {});
    $('name-ok').click(); // reloads progress (and the upgrades) for ann
    $('upgrades').click();
    let v = snap().view;
    assert.equal(v.canBuy, true);
    assert.equal(v.credits, 700);
    assert.equal(v.levels.turnSpeed, 1);
    const item = (id) => snap().items.find((i) => i.id === id);
    assert.equal(item('buy-turnSpeed').label, 'Buy 600');
    assert.equal(item('buy-turnSpeed').disabled, false);
    assert.equal(item('buy-startingLives').disabled, true, 'too expensive');
    $('buy-turnSpeed').click();
    v = snap().view;
    assert.equal(v.credits, 100);
    assert.equal(v.levels.turnSpeed, 2);
    assert.equal(snap().focus, 'buy-turnSpeed');
    assert.deepEqual(persistence.loadUpgrades('ann'), { levels: { ...persistence.loadUpgrades('ann').levels, turnSpeed: 2 }, currency: 100 });
    $('buy-startingLives').click();
    assert.equal(snap().view.credits, 100, 'a disabled Buy does nothing');
    ui.back();
    assert.equal(ui.current, 'menu');
});

test('pause menu: Resume, Restart, Settings (back to pause), Quit to the menu', () => {
    const { ui, $, snap, calls } = setup();
    ui.show('pause');
    assert.deepEqual(snap().items.map((i) => i.id), ['resume', 'restart', 'settings', 'quit']);
    $('resume').click();
    assert.equal(ui.current, null);
    assert.deepEqual(calls.at(-1), ['resume']);
    ui.show('pause');
    $('restart').click();
    assert.equal(ui.current, null);
    assert.deepEqual(calls.at(-1), ['restart']);
    ui.show('pause');
    $('settings').click();
    assert.equal(ui.current, 'settings');
    assert.equal(snap().view.from, 'pause');
    assert.match(ui.overlay.textContent, /apply to the next game/);
    ui.back();
    assert.equal(ui.current, 'pause');
    assert.equal(snap().focus, 'settings');
    $('quit').click();
    assert.deepEqual(calls.at(-1), ['quit']);
    assert.equal(ui.current, 'menu');
    ui.show('pause');
    ui.back();
    assert.deepEqual(calls.at(-1), ['resume'], 'Esc / Ⓑ resumes');
    assert.equal(ui.current, null);
});

test('help: controls per input kind and control type, radar, rules, power-ups', () => {
    const { ui, $, snap, settings } = setup({ inputKind: () => 'touch' });
    settings.set('control3d', 'joystick');
    ui.show('help', { input: 'touch' });
    let v = snap().view;
    assert.equal(v.input, 'touch');
    assert.equal(v.controls[0], CONTROL_HELP.touch.joystick);
    const text = ui.overlay.textContent;
    for (const re of [/Radar/, /top one shows what is in front/, /Clear every red rock and every green crystal/, /wasted/, /UFO/, /boss/, /Rapid Fire/, /Triple Shot/, /Shield/, /Speed Boost/, /Magnet/, /Extra Life/, /2x Score/]) {
        assert.match(text, re);
    }
    $('help-desktop').click();
    v = snap().view;
    assert.equal(v.input, 'desktop');
    assert.match(v.controls[0], /W or ↑ thrust/);
    assert.equal(snap().focus, 'help-desktop');
    assert.equal($('help-desktop').getAttribute('aria-pressed'), 'true');
    ui.navigate('right');
    ui.select();
    assert.equal(snap().view.input, 'controller');
    assert.match(snap().view.controls[0], /Left stick/);
    ui.back();
    assert.equal(ui.current, 'menu');
});

test('prompt: resolves with the chosen button, Back gives the cancel id, previous screen returns', async () => {
    const { ui, $, snap } = setup();
    ui.show('menu');
    const p = ui.prompt({ title: 'Switch to 2D?', text: 'This device draws 3D slowly.\nThe 2D game runs smoothly.', buttons: [{ id: 'yes', label: 'Switch to 2D' }, { id: 'no', label: 'Stay in 3D' }] });
    assert.equal(ui.current, 'prompt');
    assert.deepEqual(snap().view.buttons, ['yes', 'no']);
    assert.equal(snap().view.cancel, 'no');
    assert.match(ui.overlay.textContent, /draws 3D slowly/);
    $('prompt-yes').click();
    assert.equal(await p, 'yes');
    assert.equal(ui.current, 'menu');
    // Esc picks the cancel answer; a second prompt waits for the first
    const a = ui.prompt({ title: 'Motion', text: 'Allow motion?', buttons: ['Allow', 'Later'] });
    const b = ui.prompt({ title: 'Graphics reset', buttons: ['OK'] });
    assert.equal(snap().prompts, 2);
    assert.equal(snap().view.title, 'Motion');
    ui.back();
    assert.equal(await a, 'Later');
    assert.equal(snap().view.title, 'Graphics reset');
    ui.select();
    assert.equal(await b, 'OK');
    assert.equal(ui.current, 'menu');
    // While hidden: the prompt shows alone and hides again; hide() answers with cancel
    ui.hide();
    const c = ui.prompt({ title: 'Context lost', buttons: ['Reload', 'Cancel'], cancel: 'Cancel' });
    assert.equal(ui.current, 'prompt');
    ui.select();
    assert.equal(await c, 'Reload');
    assert.equal(ui.current, null);
    const d = ui.prompt({ title: 'X', buttons: ['A', 'B'] });
    ui.show('pause'); // the prompt stays on top; pause appears after it
    assert.equal(ui.current, 'prompt');
    ui.select();
    assert.equal(await d, 'A');
    assert.equal(ui.current, 'pause');
    const e = ui.prompt({ title: 'Y', buttons: ['A', 'B'] });
    ui.hide();
    assert.equal(await e, 'B');
});

test('screen callback, unknown screen, destroy removes the overlay and keys', () => {
    const seen = [];
    const { ui, root, doc } = setup({ onScreen: (s) => seen.push(s) });
    ui.show('menu');
    ui.hide();
    assert.deepEqual(seen, ['menu', null]);
    assert.throws(() => ui.show('nope'), /unknown screen/);
    assert.ok(root.children.includes(ui.overlay));
    ui.destroy();
    assert.ok(!root.children.includes(ui.overlay));
    assert.equal((doc.listeners.keydown || []).length, 0);
});

test('keys: false leaves the keyboard to the page (handleKey still works)', () => {
    const { ui, doc, snap } = setup({ keys: false });
    ui.show('menu');
    doc.key('ArrowDown');
    assert.equal(snap().focus, 'play');
    const e = { key: 'ArrowDown', preventDefault() { this.p = true; } };
    ui.handleKey(e);
    assert.equal(snap().focus, 'settings');
    assert.equal(e.p, true);
});

test('a given progress object is used until the profile changes', () => {
    const persistence = new PersistenceManager();
    persistence.setCurrentUser('eve');
    const progress = createProgress3d({ persistence });
    const { ui } = setup({ user: 'eve', progress });
    assert.equal(ui.progress, progress);
});

test('name field: no automatic focus on touch, Space types, left / right move the caret', () => {
    const t = setup({ user: null, isTouch: () => true });
    t.ui.show('menu');
    assert.equal(t.snap().focus, 'name');
    assert.notEqual(t.doc.activeElement, t.$('name'), 'no on-screen keyboard until tapped');
    assert.equal(t.doc.key(' ').prevented, false);
    assert.equal(t.doc.key('ArrowLeft').prevented, false);
    assert.equal(t.ui.current, 'profile');
    installStorage(new FakeStorage());
    const d = setup({ user: null });
    d.ui.show('menu');
    assert.equal(d.doc.activeElement, d.$('name'), 'desktop: focused for typing');
    d.doc.key('ArrowDown');
    assert.equal(d.snap().focus, 'name-ok');
});
