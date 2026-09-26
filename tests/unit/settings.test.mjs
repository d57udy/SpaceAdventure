import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    createSettings, SETTING_DEFS, SETTING_NAMES, SETTINGS_PREFIX, settingKey, defaultSettings, validateSetting,
} from '../../js/settings.js';

class FakeStorage {
    constructor(init = {}) { this.map = new Map(Object.entries(init)); this.writes = 0; }
    getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
    setItem(k, v) { this.writes++; this.map.set(k, String(v)); }
    removeItem(k) { this.map.delete(k); }
}

class ThrowingStorage {
    getItem() { throw new Error('SecurityError'); }
    setItem() { throw new Error('QuotaExceededError'); }
}

test('defaults', () => {
    const s = createSettings({ storage: new FakeStorage() });
    assert.deepEqual(s.all(), {
        controlMode: 'joystick', palette: 'standard', haptics: true, musicTune: 'synthwave',
        musicVolume: 5, sfxVolume: 10, rumble: true, offerTutorial: true, muted: false,
        mpLayout: 'auto', mpAutoFire: false, renderQuality: 'auto',
    });
    assert.deepEqual(defaultSettings(), s.all());
    assert.deepEqual([...SETTING_NAMES].sort(), Object.keys(s.all()).sort());
});

test('keys use the spaceAdventure_ prefix; controlMode keeps its existing key', () => {
    assert.equal(SETTINGS_PREFIX, 'spaceAdventure_');
    assert.equal(settingKey('controlMode'), 'spaceAdventure_controlMode');
    assert.equal(settingKey('musicTune'), 'spaceAdventure_musicTune');
    assert.equal(settingKey('haptics'), 'spaceAdventure_haptics');
    for (const n of SETTING_NAMES) assert.ok(settingKey(n).startsWith('spaceAdventure_'));
});

test('existing stored controlMode (plain id string) is read and written compatibly', () => {
    const storage = new FakeStorage({ spaceAdventure_controlMode: 'buttons' });
    const s = createSettings({ storage });
    assert.equal(s.get('controlMode'), 'buttons');
    s.set('controlMode', 'joystick');
    assert.equal(storage.getItem('spaceAdventure_controlMode'), 'joystick');
});

test('set persists and round-trips through a new instance', () => {
    const storage = new FakeStorage();
    const s = createSettings({ storage });
    s.set('musicTune', 'chiptune');
    s.set('musicVolume', 7);
    s.set('haptics', false);
    s.set('muted', true);
    s.set('palette', 'safe');
    s.set('mpLayout', 'facing');
    s.set('renderQuality', 'fast');
    assert.equal(storage.getItem('spaceAdventure_musicTune'), 'chiptune');
    assert.equal(storage.getItem('spaceAdventure_musicVolume'), '7');
    assert.equal(storage.getItem('spaceAdventure_haptics'), 'false');
    const s2 = createSettings({ storage });
    assert.equal(s2.get('musicTune'), 'chiptune');
    assert.equal(s2.get('musicVolume'), 7);
    assert.equal(s2.get('haptics'), false);
    assert.equal(s2.get('muted'), true);
    assert.equal(s2.get('palette'), 'safe');
    assert.equal(s2.get('mpLayout'), 'facing');
    assert.equal(s2.get('renderQuality'), 'fast');
});

test('volumes are clamped and rounded to 0..10', () => {
    const s = createSettings({ storage: new FakeStorage() });
    assert.equal(s.set('musicVolume', 42), 10);
    assert.equal(s.set('musicVolume', -3), 0);
    assert.equal(s.set('sfxVolume', 6.6), 7);
    assert.equal(s.set('sfxVolume', '4'), 4);
    assert.equal(s.set('sfxVolume', 'loud'), 4, 'invalid keeps the current value');
    assert.equal(s.set('sfxVolume', NaN), 4);
    assert.equal(s.set('sfxVolume', Infinity), 4);
    assert.equal(s.get('sfxVolume'), 4);
});

test('invalid enum and boolean values are rejected', () => {
    const storage = new FakeStorage();
    const s = createSettings({ storage });
    assert.equal(s.set('musicTune', 'polka'), 'synthwave');
    assert.equal(s.set('controlMode', 'JOYSTICK'), 'joystick');
    assert.equal(s.set('haptics', 'maybe'), true);
    assert.equal(s.set('haptics', 'off'), false);
    assert.equal(s.set('haptics', 1), true);
    assert.equal(s.set('palette', null), 'standard');
    assert.equal(storage.getItem('spaceAdventure_musicTune'), null, 'nothing written for rejected values');
});

test('corrupt stored values fall back to defaults', () => {
    const storage = new FakeStorage({
        spaceAdventure_musicTune: 'dubstep',
        spaceAdventure_musicVolume: 'NaN',
        spaceAdventure_sfxVolume: '99',
        spaceAdventure_haptics: '{bad json',
        spaceAdventure_controlMode: '',
    });
    const s = createSettings({ storage });
    assert.equal(s.get('musicTune'), 'synthwave');
    assert.equal(s.get('musicVolume'), 5);
    assert.equal(s.get('sfxVolume'), 10, 'out-of-range stored numbers are clamped');
    assert.equal(s.get('haptics'), true);
    assert.equal(s.get('controlMode'), 'joystick');
});

test('musicTune off is remembered', () => {
    const storage = new FakeStorage();
    createSettings({ storage }).set('musicTune', 'off');
    assert.equal(createSettings({ storage }).get('musicTune'), 'off');
});

test('storage that throws (privacy mode) keeps working in memory', () => {
    const s = createSettings({ storage: new ThrowingStorage() });
    assert.equal(s.get('musicVolume'), 5);
    assert.equal(s.set('musicVolume', 3), 3);
    assert.equal(s.get('musicVolume'), 3);
});

test('no storage at all works', () => {
    const s = createSettings({ storage: null });
    assert.equal(s.set('muted', true), true);
    assert.equal(s.get('muted'), true);
});

test('default storage falls back to globalThis.localStorage when present', () => {
    const storage = new FakeStorage({ spaceAdventure_palette: 'safe' });
    const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
    try {
        const s = createSettings();
        assert.equal(s.get('palette'), 'safe');
        s.set('rumble', false);
        assert.equal(storage.getItem('spaceAdventure_rumble'), 'false');
    } finally {
        if (had) Object.defineProperty(globalThis, 'localStorage', had);
        else delete globalThis.localStorage;
    }
});

test('onChange fires only on effective changes and can unsubscribe', () => {
    const s = createSettings({ storage: new FakeStorage() });
    const calls = [];
    const off = s.onChange((name, value, old) => calls.push([name, value, old]));
    s.set('musicVolume', 8);
    s.set('musicVolume', 8);
    s.set('musicVolume', 'bad');
    s.set('palette', 'safe');
    assert.deepEqual(calls, [['musicVolume', 8, 5], ['palette', 'safe', 'standard']]);
    off();
    s.set('palette', 'standard');
    assert.equal(calls.length, 2);
});

test('a throwing listener does not break other listeners or set()', () => {
    const s = createSettings({ storage: new FakeStorage() });
    const seen = [];
    s.onChange(() => { throw new Error('boom'); });
    s.onChange((n) => seen.push(n));
    assert.equal(s.set('muted', true), true);
    assert.deepEqual(seen, ['muted']);
});

test('unknown settings are ignored', () => {
    const storage = new FakeStorage();
    const s = createSettings({ storage });
    assert.equal(s.get('nope'), undefined);
    assert.equal(s.set('nope', 1), undefined);
    assert.equal(storage.writes, 0);
    assert.equal(validateSetting('nope', 1).ok, false);
    assert.equal(s.get('hasOwnProperty'), undefined);
});

test('cycle steps like a Settings row', () => {
    const s = createSettings({ storage: new FakeStorage() });
    assert.equal(s.cycle('musicTune'), 'ambient');
    assert.equal(s.cycle('musicTune'), 'chiptune');
    assert.equal(s.cycle('musicTune'), 'off');
    assert.equal(s.cycle('musicTune'), 'synthwave');
    assert.equal(s.cycle('musicTune', -1), 'off');
    assert.equal(s.cycle('haptics'), false);
    assert.equal(s.cycle('haptics'), true);
    s.set('musicVolume', 10);
    assert.equal(s.cycle('musicVolume', 1), 10, 'volume clamps rather than wrapping');
    assert.equal(s.cycle('musicVolume', -1), 9);
    assert.equal(s.cycle('nope'), undefined);
});

test('reset restores defaults (one or all)', () => {
    const storage = new FakeStorage();
    const s = createSettings({ storage });
    s.set('musicVolume', 1);
    s.set('palette', 'safe');
    assert.equal(s.reset('musicVolume'), 5);
    assert.equal(s.get('palette'), 'safe');
    s.reset();
    assert.deepEqual(s.all(), defaultSettings());
    assert.equal(createSettings({ storage }).get('palette'), 'standard');
});

test('all() returns a copy', () => {
    const s = createSettings({ storage: new FakeStorage() });
    const a = s.all();
    a.musicVolume = 0;
    assert.equal(s.get('musicVolume'), 5);
});

test('reload picks up external changes', () => {
    const storage = new FakeStorage();
    const s = createSettings({ storage });
    storage.setItem('spaceAdventure_musicVolume', '2');
    s.reload();
    assert.equal(s.get('musicVolume'), 2);
});

test('SETTING_DEFS is frozen and every default is valid', () => {
    assert.ok(Object.isFrozen(SETTING_DEFS));
    for (const n of SETTING_NAMES) {
        const r = validateSetting(n, SETTING_DEFS[n].default);
        assert.ok(r.ok, n);
        assert.equal(r.value, SETTING_DEFS[n].default);
    }
});
