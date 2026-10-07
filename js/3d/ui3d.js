// 3D menus and screens (docs/plans/07-3d-game.md §4, Phases 4 and 5): a DOM overlay drawn
// over the 3D page, built like the prototype's start screen. The document is injected, so
// the module runs on the fake DOM of the unit tests; nothing here touches the game itself.
//
// Screens (show(name, data)):
//   'menu'       Play, Settings, High Scores, Upgrades, Help, Profile, Switch to 2D; the
//                profile name and the version label. Without a profile (and no guest choice
//                yet this session) it opens 'profile' first.
//   'profile'    name entry with the 2D rules (js/names.js) and "Play as guest".
//   'tutorial'   "Play a short training?" before a new player's first game (Play asks
//                tutorialApi.shouldAsk, the answer goes to tutorialApi.recordAnswer).
//   'settings'   the 3D and shared settings as ◂ value ▸ rows (SETTINGS3D_ROWS); data.from
//                'pause' returns to the pause menu.
//   'highScores' the 3D board, all players or mine; data.highlight { user, score, rank }
//                marks an entry (the last game's entry is remembered and marked by default).
//   'upgrades'   the shared credits and upgrade levels; Buy uses UpgradeState.purchase.
//   'help'       controls per control type and input kind, radar, rules, power-ups;
//                data.input 'touch' | 'desktop' | 'controller' (◂ ▸ switch it).
//   'pause'      Resume, Restart, Settings, Quit to 3D menu.
//   'gameOver'   data { score, level }: calls progress.finishGame(score) (unless data.rank is
//                given) and progress.takeUnlocked(); shows the rank, credits and achievements.
//   'prompt'     prompt({ title, text, buttons, cancel }) resolves with the chosen button id.
//
// Input: navigate('up' | 'down' | 'left' | 'right'), select(), back() for a controller or any
// other source; the module also listens to keydown on the document (arrows, Enter, Space,
// Escape) while visible, unless created with keys: false. Taps and clicks work on every item.
// ◂ ▸ on a value row (and left / right while it has the focus) change the value; every value
// goes through settings.set, so it persists at once, then onSettingChange(key, value).
//
// While visible the root gets the class 'u3d-open' (the page hides its game buttons with it).
// hide() also closes an open prompt with its cancel answer.

import { sanitizeName, nameLength, NAME_MIN_LENGTH, NAME_MAX_LENGTH } from '../names.js';
import { SETTING_DEFS } from '../settings.js';
import { UPGRADE_DEFS } from '../upgrades.js';
import { MAX_HIGH_SCORES } from '../persistence.js';
import { tuneName } from '../tunes.js';
import { createProgress3d } from './progress3d.js';
import { shouldAskTutorial3d, recordTutorial3dAnswer } from './tutorial3d.js';

export const SCREENS = Object.freeze([
    'menu', 'profile', 'tutorial', 'settings', 'highScores', 'upgrades', 'help', 'pause', 'gameOver', 'prompt',
]);
export const INPUT_KINDS = Object.freeze(['touch', 'desktop', 'controller']);
const INPUT_LABELS = { touch: 'Touch', desktop: 'Keyboard and mouse', controller: 'Controller' };
const onOff = (v) => (v ? 'On' : 'Off');

/**
 * The Settings rows, in screen order. key: js/settings.js name; labels: value -> text;
 * step: change per ◂ / ▸ for numbers; next: the setting only applies to the next game.
 */
export const SETTINGS3D_ROWS = Object.freeze([
    { key: 'control3d', label: 'Control type', labels: { direct: 'Direct', rate: 'Rate', joystick: 'Joystick' } },
    { key: 'levelHorizon3d', label: 'Level horizon', format: onOff },
    { key: 'sensitivity3d', label: 'Sensitivity' },
    { key: 'invert3d', label: 'Invert up/down', format: onOff },
    { key: 'viewDistance3d', label: 'View distance', labels: { normal: 'Normal', far: 'Far', veryfar: 'Very far' }, next: true },
    { key: 'fov3d', label: 'Field of view', step: 5, format: (v) => `${v}°` },
    { key: 'vignette3d', label: 'Vignette in fast turns', format: onOff },
    { key: 'leftHanded3d', label: 'Left-handed layout', format: onOff },
    { key: 'difficulty', label: 'Difficulty', labels: { easy: 'Easy', medium: 'Medium', hard: 'Hard' }, next: true },
    { key: 'palette', label: 'Colours', labels: { standard: 'Standard', safe: 'Colour-safe' } },
    { key: 'haptics', label: 'Vibration', format: onOff },
    { key: 'musicTune', label: 'Music', format: tuneName },
    { key: 'musicVolume', label: 'Music volume' },
    { key: 'sfxVolume', label: 'Sound effects volume' },
    { key: 'rumble', label: 'Controller rumble', format: onOff },
].map(Object.freeze));

/** The text a Settings row shows for a value. */
export function settingText(key, value) {
    const row = SETTINGS3D_ROWS.find((r) => r.key === key);
    if (!row) return String(value);
    if (row.labels) return row.labels[value] ?? String(value);
    if (row.format) return row.format(value);
    return String(value);
}

/**
 * One ◂ / ▸ step of a setting through the settings object (persists). Enums cycle, booleans
 * toggle, numbers move by the row's step and clamp. Returns the value now in effect.
 */
export function stepSetting(settings, key, dir) {
    const def = SETTING_DEFS[key];
    if (!def || !settings) return undefined;
    const row = SETTINGS3D_ROWS.find((r) => r.key === key);
    if (def.type === 'int') return settings.set(key, settings.get(key) + (dir < 0 ? -1 : 1) * ((row && row.step) || 1));
    return settings.cycle(key, dir);
}

// --- Help texts (controls as js/3d/proto3d.js and js/3d/tutorial3d.js wire them)
export const CONTROL_HELP = Object.freeze({
    touch: Object.freeze({
        direct: 'Direct: the phone is the ship. Turn, tilt and roll the phone and the ship does the same.',
        rate: 'Rate: tilt the phone away from where you held it at the start to keep turning; the further, the faster.',
        joystick: 'Joystick: drag on the left half of the screen to turn, ⟲ ⟳ to roll (when Level horizon is off).',
        common: 'Hold THRUST to fly, hold FIRE to shoot, the small button next to Fire jumps to hyperspace. Recentre (or a double tap) makes the way you hold the phone "straight ahead". II pauses.',
    }),
    desktop: Object.freeze({
        all: 'Click to capture the mouse, then move it to look around. W or ↑ thrust, Space, F or click fire, A/D or Q/E roll, ← → ↓ turn, H hyperspace, R recentre, Esc or P pause.',
    }),
    controller: Object.freeze({
        all: 'Left stick turns, right stick rolls. RT (or LT) thrust, Ⓐ or RB fire, Ⓑ hyperspace, Start pauses. In menus: the stick or D-pad moves, Ⓐ selects, Ⓑ goes back.',
    }),
});

export const RADAR_HELP = 'The two circles on the right are the radar: the top one shows what is in front of you, the bottom one what is behind. '
    + 'The middle of the top circle is straight ahead. Green dots are crystals, red dots rocks; a flashing dot is on a collision course. '
    + 'A saucer is a UFO, a ring the boss, a square a power-up, and a faint ring on the rim a cluster beyond the view distance. '
    + 'Once 5 or fewer rocks are left, all of them show, with arrows at the screen edge.';

export const RULES_HELP = Object.freeze([
    'Clear every red rock and every green crystal to finish a level.',
    'Fly into green crystals to collect them for points. Shooting a green crystal destroys it with no points: it is wasted.',
    'Shoot red rocks: they split into smaller ones. Touching a red rock costs a life.',
    'UFOs appear from time to time and shoot at you and at crystals. A UFO bullet or ramming a UFO costs a life.',
    'Every 2 levels a boss arrives: destroy its glowing weak points.',
    'An extra life every 10000 points. Collecting quickly builds a combo multiplier.',
]);

export const POWERUP_HELP = Object.freeze([
    ['Rapid Fire', 'shoot much faster'],
    ['Triple Shot', 'three bullets at once'],
    ['Shield', 'a bubble that absorbs one hit'],
    ['Speed Boost', 'more thrust and top speed'],
    ['Magnet', 'pulls nearby crystals to you'],
    ['Extra Life', 'one more life'],
    ['2x Score', 'double points for a while'],
].map(Object.freeze));

const CSS = `
#u3d { position: absolute; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,12,0.78); overflow: auto; color: #fff; font-family: Arial, sans-serif; touch-action: manipulation;
  padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
  box-sizing: border-box; user-select: none; -webkit-user-select: none; }
#u3d.u3d-hidden { display: none !important; }
#u3d .u3d-panel { max-width: 760px; width: calc(100% - 32px); max-height: 100%; overflow-y: auto; padding: 10px 16px;
  box-sizing: border-box; text-align: center; }
#u3d h1 { font-size: 24px; margin: 4px 0 2px; color: #9fffd0; }
#u3d h2 { font-size: 16px; margin: 10px 0 4px; color: #9fffd0; }
#u3d p { margin: 6px 0; font-size: 14px; color: #c8d8e8; line-height: 1.35; }
#u3d .u3d-left { text-align: left; }
#u3d .u3d-sub { color: #9fb4c8; font-size: 13px; }
#u3d .u3d-msg { color: #ffd27a; min-height: 1.2em; }
#u3d .u3d-big { font-size: 20px; color: #fff; font-weight: bold; }
#u3d .u3d-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px; margin: 8px 0; }
#u3d .u3d-rows { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 6px 12px; margin: 8px 0; }
#u3d .u3d-bar { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin: 8px 0; }
#u3d button, #u3d input { font: inherit; color: #fff; -webkit-tap-highlight-color: transparent; }
#u3d button { cursor: pointer; min-height: 44px; min-width: 44px; padding: 0 14px; border-radius: 10px;
  background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.35); font-size: 15px;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9); }
#u3d button:disabled { opacity: 0.45; cursor: default; }
#u3d button.u3d-primary { min-height: 52px; font-size: 18px; font-weight: bold; background: #1f8a5a; border: 2px solid #8fffc8; }
#u3d .u3d-focus, #u3d button:focus-visible, #u3d input:focus-visible { outline: 3px solid #ffd27a; outline-offset: 2px; }
#u3d .u3d-row { display: flex; align-items: center; min-height: 48px; border-radius: 10px; background: rgba(255,255,255,0.05); }
#u3d .u3d-row button { flex: 0 0 48px; padding: 0; font-size: 20px; background: transparent; border: none; }
#u3d .u3d-row .u3d-mid { flex: 1 1 auto; display: flex; justify-content: space-between; gap: 8px; padding: 0 6px;
  font-size: 15px; border: none; background: transparent; min-height: 48px; align-items: center; }
#u3d .u3d-val { color: #9fffd0; font-weight: bold; }
#u3d input { min-height: 48px; width: min(320px, 100%); box-sizing: border-box; padding: 0 12px; font-size: 20px;
  text-transform: uppercase; text-align: center; letter-spacing: 2px; border-radius: 10px;
  background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.5); }
#u3d table { margin: 6px auto; border-collapse: collapse; font-size: 15px; min-width: min(420px, 100%); }
#u3d td, #u3d th { padding: 4px 10px; text-align: left; }
#u3d th { color: #9fb4c8; font-weight: normal; font-size: 13px; }
#u3d td.u3d-num, #u3d th.u3d-num { text-align: right; }
#u3d tr.u3d-hl td { background: rgba(255,210,122,0.25); color: #ffd27a; font-weight: bold; }
#u3d .u3d-upg { display: flex; align-items: center; gap: 10px; text-align: left; padding: 4px 8px; border-radius: 10px;
  background: rgba(255,255,255,0.05); }
#u3d .u3d-upg div { flex: 1 1 auto; }
#u3d .u3d-version { margin-top: 10px; color: #6f8396; font-size: 12px; }
@media (max-height: 500px) {
  #u3d h1 { font-size: 20px; margin: 2px 0; }
  #u3d .u3d-panel { padding: 6px 12px; }
  #u3d p { margin: 4px 0; }
}
`;

const styled = new WeakSet(); // documents the CSS is already in

const noop = () => {};

/**
 * @param {object} o
 * @param {Document} o.doc
 * @param {Element} o.root - the 3D page's root; the overlay #u3d is appended to it
 * @param {object} o.settings - js/settings.js createSettings()
 * @param {object} [o.progress] - a createProgress3d() for the current profile (default: built here)
 * @param {Function} [o.createProgress] - ({ persistence, user }) => progress, after a profile change
 * @param {object} [o.persistence] - PersistenceManager (current user, high scores, tutorial record)
 * @param {object} [o.tutorialApi] - { shouldAsk({ settings, persistence, user }), recordAnswer({ persistence, user }, play) }
 * @param {string} [o.version] - build version label for the menu
 * @param {Function} [o.inputKind] - () => 'touch' | 'desktop' | 'controller' (Help's first tab)
 * @param {boolean} [o.keys] - listen to keydown on the document (default true)
 * @param {Function} [o.isTouch] - () => true on touch devices: the name field is not focused by itself
 * @param {Function} [o.onPlay] - ({ tutorial, again, user, progress }) after Play (the overlay hides first)
 * @param {Function} [o.onResume] / onRestart / onQuit - pause menu (Quit then shows the menu)
 * @param {Function} [o.onSwitch2d] - Switch to 2D (the page opens URL_2D)
 * @param {Function} [o.onSettingChange] - (key, value) after a Settings row changed a value
 * @param {Function} [o.onProfileChange] - (user | null, progress) after a name or guest choice
 * @param {Function} [o.onScreen] - (screen | null) after every show / hide
 */
export function createUi3d({
    doc, root, settings, progress = null, createProgress = createProgress3d, persistence = null,
    tutorialApi = { shouldAsk: shouldAskTutorial3d, recordAnswer: recordTutorial3dAnswer },
    version = '', inputKind = () => 'touch', keys = true, isTouch = () => false,
    onPlay = noop, onResume = noop, onRestart = noop, onQuit = noop, onSwitch2d = noop,
    onSettingChange = noop, onProfileChange = noop, onScreen = noop,
} = {}) {
    if (!styled.has(doc)) {
        const style = doc.createElement('style');
        style.textContent = CSS;
        doc.head.appendChild(style);
        styled.add(doc);
    }
    const overlay = doc.createElement('div');
    overlay.id = 'u3d';
    overlay.className = 'u3d-hidden';
    const panel = doc.createElement('div');
    panel.className = 'u3d-panel';
    overlay.appendChild(panel);
    root.appendChild(overlay);

    const user = () => (persistence && persistence.getCurrentUser ? persistence.getCurrentUser() : null);
    if (!progress && createProgress && persistence) progress = createProgress({ persistence, user: user() });

    // --- state
    let screen = null; // null while hidden
    let data = {};
    let items = []; // focusable items in navigation order: { id, el, kind, label, activate, step, update }
    let focus = 0;
    let guest = false; // "Play as guest" chosen this session
    let lastEntry = null; // { user, score, rank } of the last game on the board
    let hsView = 'all';
    let promptState = null; // { title, text, buttons, cancel, resolve, prev }
    const promptQueue = [];
    let view = {}; // what the current screen shows (snapshot)
    let nameValue = '';
    let nameError = '';

    // --- DOM helpers
    function el(tag, cls, text) {
        const e = doc.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }
    const add = (parent, child) => { parent.appendChild(child); return child; };
    const heading = (text) => add(panel, el('h1', '', text));
    const para = (text, cls = '', parent = panel) => add(parent, el('p', cls, text));

    function setFocus(i) {
        if (!items.length) { focus = 0; return; }
        focus = ((i % items.length) + items.length) % items.length;
        items.forEach((it, j) => it.el.classList.toggle('u3d-focus', j === focus));
        const it = items[focus];
        if (it.kind === 'input' && isTouch()) return; // no on-screen keyboard until the field is tapped
        try { if (it.el.focus) it.el.focus({ preventScroll: true }); } catch { /* ignore */ }
        try { if (it.el.scrollIntoView) it.el.scrollIntoView({ block: 'nearest' }); } catch { /* ignore */ }
    }
    const focusItem = (it) => { const i = items.indexOf(it); if (i >= 0 && i !== focus) setFocus(i); };

    /** A focusable button; activate() runs on Enter, Ⓐ, a tap or a click. */
    function button(parent, id, label, activate, { cls = '', disabled = false } = {}) {
        const b = add(parent, el('button', cls, label));
        b.type = 'button';
        b.id = 'u3d-' + id;
        b.setAttribute('data-u3d', id);
        if (disabled) b.disabled = true;
        const it = { id, el: b, kind: 'button', label, disabled, activate: () => { if (!it.disabled) activate(); } };
        b.addEventListener('click', () => { focusItem(it); it.activate(); });
        items.push(it);
        return it;
    }

    /** A "◂ label value ▸" settings row: one item; left / right and the arrows step it. */
    function valueRow(parent, row) {
        const wrap = add(parent, el('div', 'u3d-row'));
        wrap.id = 'u3d-set-' + row.key;
        wrap.setAttribute('data-u3d', 'set-' + row.key);
        wrap.setAttribute('role', 'group');
        wrap.setAttribute('aria-label', row.label);
        const less = add(wrap, el('button', '', '◂'));
        less.type = 'button';
        less.setAttribute('aria-label', row.label + ': previous');
        const mid = add(wrap, el('button', 'u3d-mid'));
        mid.type = 'button';
        add(mid, el('span', '', row.label));
        const val = add(mid, el('span', 'u3d-val'));
        const more = add(wrap, el('button', '', '▸'));
        more.type = 'button';
        more.setAttribute('aria-label', row.label + ': next');
        const it = {
            id: 'set-' + row.key, el: wrap, kind: 'row', label: row.label, key: row.key,
            update() { it.value = settings.get(row.key); val.textContent = settingText(row.key, it.value); },
            step(dir) {
                const v = stepSetting(settings, row.key, dir);
                it.update();
                try { onSettingChange(row.key, v); } catch { /* the page's handler must not break the menu */ }
                if (row.key === 'control3d' && view.hintEl) view.hintEl.textContent = controlHint();
            },
            activate: () => it.step(1),
        };
        less.addEventListener('click', () => { focusItem(it); it.step(-1); });
        more.addEventListener('click', () => { focusItem(it); it.step(1); });
        mid.addEventListener('click', () => { focusItem(it); it.step(1); });
        it.update();
        items.push(it);
        return it;
    }

    const profileLabel = () => user() || 'Guest';
    const needsProfile = () => !user() && !guest;
    const controlHint = () => CONTROL_HELP.touch[settings.get('control3d')] || '';

    // --- screens
    const build = {
        menu() {
            heading('Space Adventure 3D');
            para(`Pilot: ${profileLabel()}`, 'u3d-sub');
            const grid = add(panel, el('div', 'u3d-grid'));
            button(grid, 'play', 'Play', startPlay, { cls: 'u3d-primary' });
            button(grid, 'settings', 'Settings', () => show('settings', { from: 'menu' }));
            button(grid, 'highscores', 'High Scores', () => show('highScores', { from: 'menu' }));
            button(grid, 'upgrades', 'Upgrades', () => show('upgrades', { from: 'menu' }));
            button(grid, 'help', 'Help', () => show('help', { from: 'menu' }));
            button(grid, 'profile', user() ? 'Change pilot' : 'Enter a name', () => show('profile', { next: 'menu' }));
            button(grid, 'switch2d', 'Switch to 2D', () => onSwitch2d());
            if (version) add(panel, el('div', 'u3d-version', version));
            view = { profile: user(), guest: !user(), version };
        },
        profile() {
            heading('Who is flying?');
            para(`A name of ${NAME_MIN_LENGTH} to ${NAME_MAX_LENGTH} letters or digits keeps your high scores, credits and upgrades (shared with 2D).`);
            const input = add(panel, el('input'));
            input.id = 'u3d-name';
            input.type = 'text';
            input.setAttribute('data-u3d', 'name');
            input.setAttribute('maxlength', String(NAME_MAX_LENGTH * 2));
            input.setAttribute('autocomplete', 'off');
            input.setAttribute('autocapitalize', 'characters');
            input.setAttribute('spellcheck', 'false');
            input.setAttribute('aria-label', 'Pilot name');
            input.value = nameValue || user() || '';
            nameValue = input.value;
            const clean = () => {
                const v = sanitizeName(input.value);
                if (input.value !== v) input.value = v;
                nameValue = v;
            };
            // Not while an input method composes (as 2D): the composition's end cleans it
            input.addEventListener('input', (e) => { if (!(e && e.isComposing)) clean(); });
            input.addEventListener('compositionend', clean);
            const it = { id: 'name', el: input, kind: 'input', label: 'Pilot name', activate: () => submitName() };
            input.addEventListener('focus', () => focusItem(it));
            items.push(it);
            const msg = para(nameError, 'u3d-msg');
            msg.setAttribute('role', 'status');
            const bar = add(panel, el('div', 'u3d-bar'));
            button(bar, 'name-ok', 'OK', () => submitName(), { cls: 'u3d-primary' });
            button(bar, 'guest', 'Play as guest', () => chooseGuest());
            view = { name: nameValue, error: nameError };
        },
        tutorial() {
            heading('First flight in 3D?');
            para('A short training shows how to look around, fly, collect crystals, shoot rocks and read the radar.');
            const bar = add(panel, el('div', 'u3d-bar'));
            button(bar, 'tutorial-yes', 'Yes, show me', () => answerTutorial(true), { cls: 'u3d-primary' });
            button(bar, 'tutorial-no', 'No, just play', () => answerTutorial(false));
            button(bar, 'back', 'Back', () => show('menu'));
            view = {};
        },
        settings() {
            heading('Settings');
            const hint = para(controlHint(), 'u3d-sub');
            if (data.from === 'pause') para('View distance and difficulty apply to the next game.', 'u3d-sub');
            const rows = add(panel, el('div', 'u3d-rows'));
            for (const row of SETTINGS3D_ROWS) valueRow(rows, row);
            const bar = add(panel, el('div', 'u3d-bar'));
            button(bar, 'back', 'Back', () => back());
            view = { from: data.from || 'menu', hintEl: hint };
        },
        highScores() {
            heading('3D High Scores');
            const mine = hsView === 'mine';
            const rows = (progress ? (mine ? progress.highScores() : progress.allHighScores()) : []).slice(0, MAX_HIGH_SCORES);
            const hl = data.highlight !== undefined ? data.highlight : lastEntry;
            let hlIndex = -1;
            if (hl) {
                if (mine) hlIndex = hl.user === user() ? hl.rank : -1;
                else hlIndex = rows.findIndex((r) => r.user === hl.user && r.score === hl.score);
            }
            para(mine ? `Best games of ${profileLabel()}` : 'Best games of every pilot on this device', 'u3d-sub');
            if (!rows.length) para(mine && !user() ? 'Guests have no board: enter a name to keep your scores.' : 'No 3D games yet.');
            else {
                const table = add(panel, el('table'));
                const head = add(table, el('tr'));
                add(head, el('th', 'u3d-num', '#'));
                add(head, el('th', '', 'Name'));
                add(head, el('th', 'u3d-num', 'Score'));
                add(head, el('th', 'u3d-num', 'Level'));
                rows.forEach((r, i) => {
                    const tr = add(table, el('tr', i === hlIndex ? 'u3d-hl' : ''));
                    add(tr, el('td', 'u3d-num', String(i + 1)));
                    add(tr, el('td', '', String(r.name || r.user || '')));
                    add(tr, el('td', 'u3d-num', String(r.score)));
                    add(tr, el('td', 'u3d-num', r.level ? String(r.level) : ''));
                });
            }
            const bar = add(panel, el('div', 'u3d-bar'));
            button(bar, 'hs-view', mine ? 'Show all pilots' : 'Show mine', () => { hsView = mine ? 'all' : 'mine'; rerender('hs-view'); });
            button(bar, 'back', 'Back', () => back());
            view = {
                board: hsView, highlight: hlIndex,
                rows: rows.map((r) => ({ name: r.name, user: r.user, score: r.score, level: r.level })),
            };
        },
        upgrades() {
            heading('Upgrades');
            const u = progress && progress.upgrades;
            const canBuy = !!(u && u.persistent && user());
            para(canBuy ? `Credits: ${u.currency}` : 'Guests fly a standard ship: enter a name to earn credits and buy upgrades.', canBuy ? 'u3d-big' : '');
            para('Credits and upgrades are shared with the 2D game.', 'u3d-sub');
            const levels = {};
            for (const [key, def] of Object.entries(UPGRADE_DEFS)) {
                const lv = u ? u.levels[key] || 0 : 0;
                levels[key] = lv;
                const box = add(panel, el('div', 'u3d-upg'));
                const text = add(box, el('div'));
                add(text, el('strong', '', `${def.name}  ${lv}/${def.maxLevel}`));
                add(text, el('div', 'u3d-sub', def.description));
                const max = lv >= def.maxLevel;
                const label = max ? 'Max' : `Buy ${def.cost[lv]}`;
                button(box, 'buy-' + key, label, () => {
                    if (u.purchase(key, persistence, user())) rerender('buy-' + key);
                }, { disabled: !canBuy || max || !u.canAfford(key) });
            }
            const bar = add(panel, el('div', 'u3d-bar'));
            button(bar, 'back', 'Back', () => back());
            view = { credits: canBuy ? u.currency : 0, canBuy, levels };
        },
        help() {
            const kind = INPUT_KINDS.includes(data.input) ? data.input : 'touch';
            heading('How to play');
            const tabs = add(panel, el('div', 'u3d-bar'));
            for (const k of INPUT_KINDS) {
                const it = button(tabs, 'help-' + k, INPUT_LABELS[k], () => rerender('help-' + k, { ...data, input: k }));
                it.el.setAttribute('aria-pressed', String(k === kind));
                it.tabs = true;
            }
            const body = add(panel, el('div', 'u3d-left'));
            add(body, el('h2', '', 'Controls'));
            const control = settings.get('control3d');
            const lines = kind === 'touch'
                ? [CONTROL_HELP.touch[control], CONTROL_HELP.touch.common, 'Other control types: change Control type in Settings.']
                : [CONTROL_HELP[kind].all];
            for (const l of lines) para(l, '', body);
            add(body, el('h2', '', 'Radar'));
            para(RADAR_HELP, '', body);
            add(body, el('h2', '', 'Rules'));
            for (const l of RULES_HELP) para(l, '', body);
            add(body, el('h2', '', 'Power-ups'));
            for (const [name, what] of POWERUP_HELP) para(`${name}: ${what}.`, '', body);
            const bar = add(panel, el('div', 'u3d-bar'));
            button(bar, 'back', 'Back', () => back());
            view = { input: kind, control, controls: lines };
        },
        pause() {
            heading('Paused');
            const grid = add(panel, el('div', 'u3d-grid'));
            button(grid, 'resume', 'Resume', () => { hide(); onResume(); }, { cls: 'u3d-primary' });
            button(grid, 'restart', 'Restart', () => { hide(); onRestart(); });
            button(grid, 'settings', 'Settings', () => show('settings', { from: 'pause' }));
            button(grid, 'quit', 'Quit to 3D menu', () => { onQuit(); show('menu'); });
            view = {};
        },
        gameOver() {
            const score = Math.max(0, Math.floor(Number(data.score) || 0));
            const level = data.level || (progress ? progress.level : 1);
            heading('Game over');
            para(`Score ${score}   Level ${level}`, 'u3d-big');
            const rank = data.rank;
            if (rank >= 0) para(`New high score! Place ${rank + 1} on your 3D board.`, 'u3d-msg');
            if (!user()) para('Playing as a guest: enter a name to keep scores and earn credits.', 'u3d-sub');
            else para(`Credits earned: ${data.credits}`, '');
            if (data.unlocked.length) {
                add(panel, el('h2', '', 'Achievements unlocked'));
                for (const a of data.unlocked) para(a.description ? `${a.name}: ${a.description}` : a.name);
            }
            const bar = add(panel, el('div', 'u3d-bar'));
            button(bar, 'again', 'Play again', () => launch({ tutorial: false, again: true }), { cls: 'u3d-primary' });
            if (rank >= 0) button(bar, 'highscores', 'High Scores', () => show('highScores', { from: 'gameOver' }));
            button(bar, 'menu', 'Menu', () => show('menu'));
            view = {
                score, level, rank, newHigh: rank >= 0, credits: data.credits, guest: !user(),
                unlocked: data.unlocked.map((a) => a.name),
            };
        },
        prompt() {
            const p = promptState;
            heading(p.title || '');
            if (p.text) for (const line of String(p.text).split('\n')) para(line);
            const bar = add(panel, el('div', 'u3d-bar'));
            p.buttons.forEach((b, i) => button(bar, 'prompt-' + b.id, b.label, () => closePrompt(b.id), { cls: i === 0 ? 'u3d-primary' : '' }));
            view = { title: p.title || '', text: p.text || '', buttons: p.buttons.map((b) => b.id), cancel: p.cancel };
        },
    };

    // --- flows
    function rebuildProgress() {
        if (createProgress && persistence) progress = createProgress({ persistence, user: user() });
        try { onProfileChange(user(), progress); } catch { /* ignore */ }
    }
    function submitName() {
        const name = sanitizeName(nameValue);
        if (nameLength(name) < NAME_MIN_LENGTH) {
            nameError = `Please use at least ${NAME_MIN_LENGTH} letters or digits.`;
            rerender('name');
            return false;
        }
        nameError = '';
        nameValue = '';
        if (persistence) persistence.setCurrentUser(name);
        guest = false;
        rebuildProgress();
        show(data.next || 'menu');
        return true;
    }
    function chooseGuest() {
        nameError = '';
        nameValue = '';
        if (persistence && user()) persistence.setCurrentUser(null);
        guest = true;
        rebuildProgress();
        show(data.next || 'menu');
    }
    function startPlay() {
        const ask = !!(tutorialApi && tutorialApi.shouldAsk && tutorialApi.shouldAsk({ settings, persistence, user: user() }));
        if (ask) show('tutorial');
        else launch({ tutorial: false });
    }
    function answerTutorial(play) {
        if (tutorialApi && tutorialApi.recordAnswer) tutorialApi.recordAnswer({ persistence, user: user() }, play);
        launch({ tutorial: play });
    }
    function launch({ tutorial = false, again = false } = {}) {
        hide();
        onPlay({ tutorial, again, user: user(), progress });
    }

    // --- prompts
    function prompt({ title = '', text = '', buttons = ['OK'], cancel } = {}) {
        const list = (buttons.length ? buttons : ['OK']).map((b) => (typeof b === 'string' ? { id: b, label: b } : { id: b.id, label: b.label ?? b.id }));
        return new Promise((resolve) => {
            const p = { title, text, buttons: list, cancel: cancel ?? list[list.length - 1].id, resolve, prev: null };
            if (promptState) { promptQueue.push(p); return; }
            openPrompt(p);
        });
    }
    function openPrompt(p) {
        p.prev = screen && screen !== 'prompt' ? { screen, data } : null;
        promptState = p;
        render('prompt', {});
    }
    function closePrompt(id) {
        const p = promptState;
        if (!p) return;
        promptState = null;
        const next = promptQueue.shift();
        if (next) { next.prev = p.prev; promptState = next; render('prompt', {}); }
        else if (p.prev) render(p.prev.screen, p.prev.data);
        else hideOverlay();
        p.resolve(id);
    }

    // --- show / hide
    function render(name, d, focusId = null) {
        screen = name;
        data = d || {};
        items = [];
        view = {};
        panel.textContent = '';
        build[name]();
        overlay.className = '';
        overlay.setAttribute('data-screen', name);
        root.classList.add('u3d-open');
        const i = focusId ? items.findIndex((it) => it.id === focusId) : -1;
        setFocus(i >= 0 ? i : Math.max(0, items.findIndex((it) => !it.disabled)));
        try { onScreen(name); } catch { /* ignore */ }
    }
    /** Same screen again (a value changed), keeping the focus on `focusId`. */
    function rerender(focusId, d = data) { render(screen, d, focusId); }

    function show(name, d = {}) {
        if (!build[name] || name === 'prompt') throw new Error(`ui3d: unknown screen ${name}`);
        if (name === 'menu' && needsProfile()) { name = 'profile'; d = { next: 'menu' }; }
        if (name === 'gameOver') d = finishData(d);
        // Sub-screens opened from another screen go back to it (with its data)
        if (d.from && screen && screen !== 'prompt') d = { ...d, back: { screen, data, focus: items[focus] ? items[focus].id : null } };
        if (name === 'profile') { nameError = ''; nameValue = ''; }
        if (promptState) { promptState.prev = { screen: name, data: d }; return; } // the prompt stays on top
        render(name, d);
    }
    /** Game over: the board, credits and achievements, once per game. */
    function finishData(d) {
        const score = Math.max(0, Math.floor(Number(d.score) || 0));
        let rank = d.rank;
        if (rank === undefined) rank = progress && progress.finishGame ? progress.finishGame(score).rank : -1;
        const credits = d.credits !== undefined ? d.credits : (progress ? progress.creditsEarned || 0 : 0);
        const unlocked = d.unlocked || (progress && progress.takeUnlocked ? progress.takeUnlocked() : []);
        if (rank >= 0) lastEntry = { user: user(), score, rank };
        return { ...d, score, rank, credits, unlocked };
    }
    function hideOverlay() {
        screen = null;
        data = {};
        items = [];
        view = {};
        panel.textContent = '';
        overlay.className = 'u3d-hidden';
        root.classList.remove('u3d-open');
        try { onScreen(null); } catch { /* ignore */ }
    }
    /** Hide the overlay; open prompts answer with their cancel id. */
    function hide() {
        const pending = [promptState, ...promptQueue].filter(Boolean);
        promptState = null;
        promptQueue.length = 0;
        hideOverlay();
        for (const p of pending) p.resolve(p.cancel);
    }

    // --- input
    /** Move the focus ('up' | 'down' | 'left' | 'right'); left / right step a value row. */
    function navigate(dir) {
        if (!screen || !items.length) return false;
        const it = items[focus];
        if (dir === 'left' || dir === 'right') {
            const d = dir === 'left' ? -1 : 1;
            if (it.kind === 'row') { it.step(d); return true; }
            if (it.kind === 'input') return false; // the caret moves
            setFocus(focus + d);
            return true;
        }
        if (dir === 'up' || dir === 'down') { setFocus(focus + (dir === 'up' ? -1 : 1)); return true; }
        return false;
    }
    /** Activate the focused item (Enter, Ⓐ). */
    function select() {
        if (!screen || !items.length) return false;
        items[focus].activate();
        return true;
    }
    /** Esc, Ⓑ: one screen back. Returns false where there is nothing to go back to. */
    function back() {
        switch (screen) {
            case 'prompt': closePrompt(promptState.cancel); return true;
            case 'pause': hide(); onResume(); return true;
            case 'gameOver': case 'tutorial': show('menu'); return true;
            case 'profile':
                if (needsProfile()) return false; // a name or guest first
                show(data.next || 'menu');
                return true;
            case 'settings': case 'highScores': case 'upgrades': case 'help':
                if (data.back) render(data.back.screen, data.back.data, data.back.focus);
                else show('menu');
                return true;
            default: return false;
        }
    }

    function onKey(e) {
        if (!screen) return;
        const k = e.key || e.code;
        const inInput = items[focus] && items[focus].kind === 'input';
        let done = false;
        if (k === 'ArrowUp') done = navigate('up');
        else if (k === 'ArrowDown') done = navigate('down');
        else if (k === 'ArrowLeft') done = navigate('left');
        else if (k === 'ArrowRight') done = navigate('right');
        else if (k === 'Enter' || k === 'NumpadEnter' || ((k === ' ' || k === 'Spacebar' || k === 'Space') && !inInput)) {
            if (!e.repeat) done = select();
            else done = true;
        } else if (k === 'Escape' || k === 'Esc') done = back() || true;
        if (done) {
            if (e.preventDefault) e.preventDefault();
            if (e.stopPropagation) e.stopPropagation();
        }
    }
    if (keys) doc.addEventListener('keydown', onKey);

    function snapshot() {
        const { hintEl, ...shown } = view;
        return {
            visible: !!screen,
            screen,
            focus: items[focus] ? items[focus].id : null,
            items: items.map((it) => ({
                id: it.id, kind: it.kind, label: it.label, disabled: !!it.disabled,
                ...(it.kind === 'row' ? { value: it.value } : {}),
            })),
            profile: user(),
            guest: !user(),
            prompts: (promptState ? 1 : 0) + promptQueue.length,
            view: shown,
        };
    }

    function destroy() {
        hide();
        if (keys) doc.removeEventListener('keydown', onKey);
        if (overlay.parentNode && overlay.parentNode.removeChild) overlay.parentNode.removeChild(overlay);
        else if (root.removeChild) root.removeChild(overlay);
    }

    return {
        show, hide, navigate, select, back, prompt, snapshot, destroy, handleKey: onKey,
        get current() { return screen; },
        get visible() { return !!screen; },
        get progress() { return progress; },
        get guest() { return guest; },
        overlay,
    };
}
