// Device-level settings (not per player): defaults, validation and persistence.
// DOM-free; storage is injected (defaults to globalThis.localStorage when available).
// Every key is prefixed 'spaceAdventure_'. Values are stored as plain strings so the
// existing 'spaceAdventure_controlMode' entry ('joystick' | 'buttons') stays compatible.

export const SETTINGS_PREFIX = 'spaceAdventure_';

const enumDef = (values, def) => ({ type: 'enum', values, default: def });
const boolDef = (def) => ({ type: 'bool', default: def });
const intDef = (min, max, def) => ({ type: 'int', min, max, default: def });

export const SETTING_DEFS = Object.freeze({
    controlMode: enumDef(['joystick', 'buttons'], 'joystick'),
    palette: enumDef(['standard', 'safe'], 'standard'),
    haptics: boolDef(true),
    musicTune: enumDef(['off', 'synthwave', 'ambient', 'chiptune'], 'synthwave'),
    musicVolume: intDef(0, 10, 5),
    sfxVolume: intDef(0, 10, 10),
    rumble: boolDef(true),
    offerTutorial: boolDef(true),
    muted: boolDef(false),
    mpLayout: enumDef(['auto', 'sides', 'facing'], 'auto'),
    mpAutoFire: boolDef(false),
    mpFireSideA: enumDef(['outer', 'inner'], 'outer'), // touch player in zone a (left / bottom)
    mpFireSideB: enumDef(['outer', 'inner'], 'outer'), // touch player in zone b (right / top)
    mpStereo: boolDef(true), // pan each player's sounds to their side (side by side)
    renderQuality: enumDef(['auto', 'sharp', 'fast'], 'auto'),
    // 3D cockpit prototype (?3d=1, docs/plans/06-3d-mode.md §8)
    control3d: enumDef(['direct', 'rate', 'joystick'], 'direct'),
    levelHorizon3d: boolDef(false),
    sensitivity3d: intDef(1, 10, 5),
    sensor3d: enumDef(['auto', 'event'], 'auto'), // auto: RelativeOrientationSensor when available
});

export const SETTING_NAMES = Object.freeze(Object.keys(SETTING_DEFS));

// Storage key for a setting name, e.g. 'musicVolume' -> 'spaceAdventure_musicVolume'.
export function settingKey(name) {
    return SETTINGS_PREFIX + name;
}

export function defaultSettings() {
    const out = {};
    for (const name of SETTING_NAMES) out[name] = SETTING_DEFS[name].default;
    return out;
}

// Normalise a value for a setting. Returns { ok, value }: numbers are rounded and
// clamped, booleans accept true/false and 'true'/'false'/'1'/'0'/'on'/'off',
// enums must match one of their values exactly. Invalid input gives ok=false.
export function validateSetting(name, value) {
    const def = SETTING_DEFS[name];
    if (!def) return { ok: false, value: undefined };
    switch (def.type) {
        case 'enum':
            return def.values.includes(value) ? { ok: true, value } : { ok: false, value: def.default };
        case 'bool': {
            if (typeof value === 'boolean') return { ok: true, value };
            if (value === 1 || value === 0) return { ok: true, value: value === 1 };
            if (typeof value === 'string') {
                const v = value.trim().toLowerCase();
                if (v === 'true' || v === '1' || v === 'on') return { ok: true, value: true };
                if (v === 'false' || v === '0' || v === 'off') return { ok: true, value: false };
            }
            return { ok: false, value: def.default };
        }
        case 'int': {
            const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
            if (typeof n !== 'number' || !Number.isFinite(n)) return { ok: false, value: def.default };
            return { ok: true, value: Math.min(def.max, Math.max(def.min, Math.round(n))) };
        }
        default:
            return { ok: false, value: def.default };
    }
}

function defaultStorage() {
    try {
        return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null;
    } catch (e) {
        return null; // Accessing localStorage can throw (privacy mode, sandboxed iframes)
    }
}

export function createSettings({ storage = defaultStorage() } = {}) {
    const values = defaultSettings();
    const listeners = new Set();

    function readStored(name) {
        if (!storage) return;
        let raw = null;
        try { raw = storage.getItem(settingKey(name)); } catch (e) { return; }
        if (raw === null || raw === undefined) return;
        const { ok, value } = validateSetting(name, raw);
        if (ok) values[name] = value;
    }

    function persist(name, value) {
        if (!storage) return false;
        try {
            storage.setItem(settingKey(name), String(value));
            return true;
        } catch (e) {
            return false; // Quota or privacy mode: keep the in-memory value
        }
    }

    function emit(name, value, oldValue) {
        for (const fn of [...listeners]) {
            try { fn(name, value, oldValue); } catch (e) { /* a broken listener must not break settings */ }
        }
    }

    function reload() {
        Object.assign(values, defaultSettings());
        for (const name of SETTING_NAMES) readStored(name);
    }

    reload();

    const api = {
        get(name) {
            return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined;
        },
        // Validates/clamps, persists and notifies. Returns the value now in effect
        // (unchanged when the input was invalid), or undefined for an unknown name.
        set(name, value) {
            if (!SETTING_DEFS[name]) return undefined;
            const { ok, value: v } = validateSetting(name, value);
            if (!ok) return values[name];
            const old = values[name];
            values[name] = v;
            persist(name, v);
            if (old !== v) emit(name, v, old);
            return v;
        },
        // Step a setting the way a Settings row does: enums cycle (wrapping), numbers
        // move by `dir` and clamp, booleans toggle. Returns the new value.
        cycle(name, dir = 1) {
            const def = SETTING_DEFS[name];
            if (!def) return undefined;
            const cur = values[name];
            if (def.type === 'bool') return api.set(name, !cur);
            if (def.type === 'int') return api.set(name, cur + (dir < 0 ? -1 : 1));
            const i = def.values.indexOf(cur);
            const n = def.values.length;
            return api.set(name, def.values[(i + (dir < 0 ? -1 : 1) + n) % n]);
        },
        reset(name) {
            if (name !== undefined) {
                if (!SETTING_DEFS[name]) return undefined;
                return api.set(name, SETTING_DEFS[name].default);
            }
            for (const n of SETTING_NAMES) api.set(n, SETTING_DEFS[n].default);
            return api.all();
        },
        all() {
            return { ...values };
        },
        // fn(name, value, oldValue) after every effective change. Returns an unsubscribe function.
        onChange(fn) {
            if (typeof fn !== 'function') return () => {};
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        reload,
    };
    return api;
}
