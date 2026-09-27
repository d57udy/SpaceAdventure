// Per-player HUD panels for local multiplayer.
// formatSeatHud is pure; SeatHudView writes to DOM elements it is given and
// only touches the DOM when a value changed (keeps older iPads smooth).
// See docs/plans/05-local-multiplayer.md §11.

export const POWER_UP_INFO = Object.freeze({
    rapid_fire: { label: 'R', duration: 8 },
    triple_shot: { label: 'T', duration: 10 },
    shield: { label: 'S', duration: 6 },
    speed_boost: { label: '>', duration: 8 },
    magnet: { label: 'M', duration: 10 },
    score_multiplier: { label: '2x', duration: 12 },
});

export const COMBO_MIN_SHOWN = 2;
export const LIVES_ICON = '▲'; // ▲
export const MAX_LIFE_ICONS = 5;

const clamp01 = (v) => (v > 1 ? 1 : v > 0 ? v : 0);
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Turn a player's state into display strings.
 * @param {object} model
 * @param {number} [model.slot] - 0-based seat, shown as P1..P4
 * @param {string} [model.name]
 * @param {number} [model.score]
 * @param {string} [model.scoreText] - shown instead of the score when given
 * @param {number} [model.lives] - Infinity: unlimited
 * @param {Object<string,number>} [model.powerUps] - seconds left per power-up id
 * @param {Object<string,number>} [model.powerUpDurations] - overrides POWER_UP_INFO durations
 * @param {{count:number, multiplier:number, timer:number, maxTime:number}} [model.combo]
 * @param {string|null} [model.status] - explicit status text wins
 * @param {boolean} [model.paused]
 * @param {boolean} [model.out]
 * @param {number} [model.respawnTimer] - seconds
 * @returns {{name:string, score:string, lives:string, powerUps:Array<{id:string,label:string,frac:number}>,
 *            combo:{count:number, mult:number, frac:number}|null, status:string}}
 */
export function formatSeatHud(model = {}) {
    const slot = Number.isInteger(model.slot) ? model.slot : 0;
    const name = `P${slot + 1}${model.name ? ` ${String(model.name).toUpperCase()}` : ''}`;
    // scoreText replaces the number (e.g. Duel shows kills: "3 KILLS")
    const score = typeof model.scoreText === 'string' && model.scoreText
        ? model.scoreText
        : String(Math.max(0, Math.floor(Number(model.score) || 0)));

    let lives;
    if (model.lives === Infinity) {
        lives = `${LIVES_ICON} ∞`; // unlimited lives (Harvest, Duel)
    } else {
        const livesN = Math.max(0, Math.floor(Number(model.lives) || 0));
        lives = livesN > MAX_LIFE_ICONS ? `${LIVES_ICON} x${livesN}` : LIVES_ICON.repeat(livesN);
    }

    const powerUps = [];
    for (const [id, left] of Object.entries(model.powerUps || {})) {
        if (!(left > 0)) continue;
        const info = POWER_UP_INFO[id] || { label: id.slice(0, 2).toUpperCase(), duration: left };
        const duration = model.powerUpDurations?.[id] ?? info.duration;
        powerUps.push({ id, label: info.label, frac: round2(clamp01(duration > 0 ? left / duration : 1)) });
    }

    let combo = null;
    const c = model.combo;
    if (c && c.count >= COMBO_MIN_SHOWN) {
        combo = {
            count: c.count,
            mult: c.multiplier || 1,
            frac: round2(clamp01(c.maxTime > 0 ? c.timer / c.maxTime : 0)),
        };
    }

    let status = '';
    if (typeof model.status === 'string' && model.status) status = model.status;
    else if (model.paused) status = 'PAUSED';
    else if (model.out) status = 'OUT – fly near to revive';
    else if (model.respawnTimer > 0) status = `RESPAWN ${model.respawnTimer.toFixed(1)}s`;

    return { name, score, lives, powerUps, combo, status };
}

/**
 * Writes a formatted HUD into DOM elements. Elements are looked up once in
 * `root` by [data-hud="name|score|lives|powerUps|combo|comboBar|status"], or
 * passed in directly. Missing elements are skipped.
 *   const view = new SeatHudView(panel);
 *   view.update(formatSeatHud(model));
 * `writes` counts DOM writes (for tests and profiling).
 */
export class SeatHudView {
    constructor(root, elements = null) {
        this.root = root;
        const find = (key) => (elements && key in elements
            ? elements[key]
            : root?.querySelector?.(`[data-hud="${key}"]`) ?? null);
        this.el = {
            name: find('name'),
            score: find('score'),
            lives: find('lives'),
            powerUps: find('powerUps'),
            combo: find('combo'),
            comboBar: find('comboBar'),
            status: find('status'),
        };
        this.chips = new Map(); // id → { chip, bar, frac }
        this.last = {};
        this.writes = 0;
    }

    setText(key, value) {
        if (this.last[key] === value) return;
        this.last[key] = value;
        const el = this.el[key];
        if (el) {
            el.textContent = value;
            this.writes++;
        }
    }

    setStyle(el, prop, value, cacheKey) {
        if (this.last[cacheKey] === value) return;
        this.last[cacheKey] = value;
        if (el && el.style) {
            el.style[prop] = value;
            this.writes++;
        }
    }

    /** Apply a formatSeatHud() result. */
    update(hud) {
        this.setText('name', hud.name);
        this.setText('score', hud.score);
        this.setText('lives', hud.lives);
        this.setText('status', hud.status);
        this.setStyle(this.el.status, 'display', hud.status ? '' : 'none', 'statusDisplay');

        if (hud.combo) {
            this.setText('combo', hud.combo.mult > 1
                ? `${hud.combo.count}x COMBO · ${hud.combo.mult}x`
                : `${hud.combo.count}x COMBO`);
            this.setStyle(this.el.comboBar, 'width', `${Math.round(hud.combo.frac * 100)}%`, 'comboWidth');
        } else {
            this.setText('combo', '');
            this.setStyle(this.el.comboBar, 'width', '0%', 'comboWidth');
        }
        this.setStyle(this.el.combo, 'display', hud.combo ? '' : 'none', 'comboDisplay');

        this.updateChips(hud.powerUps || []);
    }

    updateChips(list) {
        const container = this.el.powerUps;
        if (!container) return;
        const seen = new Set();
        for (const p of list) {
            seen.add(p.id);
            let chip = this.chips.get(p.id);
            if (!chip) {
                const doc = container.ownerDocument;
                const el = doc.createElement('span');
                el.className = 'hud-chip';
                el.setAttribute('data-power-up', p.id);
                const label = doc.createElement('span');
                label.className = 'hud-chip-label';
                label.textContent = p.label;
                const bar = doc.createElement('span');
                bar.className = 'hud-chip-bar';
                el.appendChild(label);
                el.appendChild(bar);
                container.appendChild(el);
                this.writes++;
                chip = { el, bar, width: null };
                this.chips.set(p.id, chip);
            }
            const width = `${Math.round(p.frac * 100)}%`;
            if (chip.width !== width) {
                chip.width = width;
                chip.bar.style.width = width;
                this.writes++;
            }
        }
        for (const [id, chip] of this.chips) {
            if (!seen.has(id)) {
                container.removeChild(chip.el);
                this.chips.delete(id);
                this.writes++;
            }
        }
    }
}

/**
 * The single-player HUD line (#score, #lives, ...): keeps its elements and writes a text or
 * style only when it changed. updateUI runs every frame; rewriting unchanged DOM each frame
 * costs layout work on older devices.
 */
export class CachedDomWriter {
    /** @param {Object<string, {textContent:string, style?:object}|null>} elements */
    constructor(elements = {}) {
        this.el = { ...elements };
        this.last = {};
        this.writes = 0;
    }

    text(key, value) {
        const v = String(value);
        const cacheKey = `text:${key}`;
        if (this.last[cacheKey] === v) return false;
        const el = this.el[key];
        if (!el) return false;
        this.last[cacheKey] = v;
        el.textContent = v;
        this.writes++;
        return true;
    }

    style(key, prop, value) {
        const cacheKey = `style:${key}:${prop}`;
        if (this.last[cacheKey] === value) return false;
        const el = this.el[key];
        if (!el || !el.style) return false;
        this.last[cacheKey] = value;
        el.style[prop] = value;
        this.writes++;
        return true;
    }
}
