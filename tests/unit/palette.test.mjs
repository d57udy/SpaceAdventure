import { test } from 'node:test';
import assert from 'node:assert/strict';

const { Palettes, PALETTE_LIST, PALETTE_KEY, findPalette, hexToRgb } = await import('../../js/palette.js');
const { SETTING_DEFS } = await import('../../js/settings.js');

const HEX = /^#[0-9A-F]{6}$/i;
const COLOUR_KEYS = ['collect', 'collectFillBase', 'collectRadar', 'hazard', 'hazardFillBase', 'hazardRadar'];
const BACKGROUND = '#000000'; // canvas clear colour (the starfield gradient is near black)

// --- Colour science helpers -------------------------------------------------------

const toLinear = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const toSrgb = (c) => { c = Math.min(1, Math.max(0, c)); return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055); };

// Machado, Oliveira & Fernandes (2009), severity 1.0, applied to linear RGB
const MACHADO = {
    protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};

/** Simulate a vision type; returns sRGB [0..255] triple. */
function simulate(hex, kind) {
    const lin = hexToRgb(hex).map(toLinear);
    let out;
    if (kind === 'normal') out = lin;
    else if (kind === 'grayscale') {
        const y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
        out = [y, y, y];
    } else {
        const m = MACHADO[kind];
        out = m.map((row) => row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]);
    }
    return out.map(toSrgb);
}

function luminance(rgb) {
    const [r, g, b] = rgb.map(toLinear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function toLab(rgb) {
    const [r, g, b] = rgb.map(toLinear);
    const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE76(a, b) {
    const la = toLab(a), lb = toLab(b);
    return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

const VISIONS = ['normal', 'protanopia', 'deuteranopia', 'tritanopia', 'grayscale'];

/** Distinguishable: luminance contrast >= 2:1 or colour difference >= minDeltaE. */
function distinguishable(hexA, hexB, kind, minDeltaE = 20) {
    const a = simulate(hexA, kind), b = simulate(hexB, kind);
    const c = contrast(a, b), d = deltaE76(a, b);
    return { ok: c >= 2 || d >= minDeltaE, contrast: c, deltaE: d };
}

// --- Tests ------------------------------------------------------------------------

test('palette ids match the settings.js palette values and the storage key', () => {
    assert.deepEqual(PALETTE_LIST.map((p) => p.id), SETTING_DEFS.palette.values);
    assert.equal(PALETTE_KEY, 'spaceAdventure_palette');
    assert.equal(Palettes.STANDARD.id, SETTING_DEFS.palette.default);
});

test('findPalette finds by id and falls back to STANDARD', () => {
    assert.equal(findPalette('standard'), Palettes.STANDARD);
    assert.equal(findPalette('safe'), Palettes.COLOUR_SAFE);
    for (const bad of [undefined, null, '', 'bogus', 'STANDARD', 42]) {
        assert.equal(findPalette(bad), Palettes.STANDARD, String(bad));
    }
});

test('every palette has all keys with valid hex colours, words and 4 seat colours', () => {
    for (const p of PALETTE_LIST) {
        assert.equal(typeof p.name, 'string');
        for (const k of COLOUR_KEYS) assert.match(p[k], HEX, `${p.id}.${k}`);
        assert.match(p.collectWord, /^[A-Z]+$/);
        assert.match(p.hazardWord, /^[A-Z]+$/);
        assert.notEqual(p.collectWord, p.hazardWord);
        assert.equal(p.seats.length, 4);
        for (const s of p.seats) assert.match(s, HEX);
        assert.equal(new Set(p.seats).size, 4, `${p.id} seats are distinct`);
        assert.match(p.collectRgba(0.5), /^rgba\(\d+, \d+, \d+, 0\.5\)$/);
        assert.match(p.hazardFill(0.9), /^rgba\(\d+, \d+, \d+, 0\.9\)$/);
        assert.ok(Object.isFrozen(p));
    }
});

test('palette values from the plan (01 Item 1, 05 §10.3)', () => {
    const s = Palettes.STANDARD, c = Palettes.COLOUR_SAFE;
    assert.equal(s.collect, '#00FF00');
    assert.equal(s.hazard, '#CC0000');
    assert.equal(s.hazardRadar, '#FF0000');
    assert.deepEqual([s.collectWord, s.hazardWord], ['GREEN', 'RED']);
    assert.equal(c.collect, '#3DB7FF');
    assert.equal(c.hazardRadar, '#FF9500');
    assert.deepEqual([c.collectWord, c.hazardWord], ['BLUE', 'ORANGE']);
    assert.deepEqual([...s.seats], ['#33D6FF', '#FFA23A', '#FF66CC', '#FFFFFF']);
    assert.deepEqual([...c.seats], ['#FFFFFF', '#F0E442', '#FF66CC', '#C9B6FF']);
});

test('simulation sanity: white stays white, red and green merge for deuteranopes', () => {
    for (const k of VISIONS) {
        const w = simulate('#FFFFFF', k);
        for (const ch of w) assert.ok(ch > 250, `${k} white ${w}`);
    }
    // Pure red vs pure green: very different for normal vision, much closer for deuteranopia
    const normal = deltaE76(simulate('#FF0000', 'normal'), simulate('#00FF00', 'normal'));
    const deut = deltaE76(simulate('#FF0000', 'deuteranopia'), simulate('#00FF00', 'deuteranopia'));
    assert.ok(deut < normal / 2, `normal ${normal} deut ${deut}`);
});

// Seat colours (05 §10.3) are never the only cue (player number, hull mark, numbered
// radar markers), so they get a lower bar and no grayscale check. Known close pairs are
// listed explicitly so any new clash fails the test.
const CVD = ['normal', 'protanopia', 'deuteranopia', 'tritanopia'];
const KNOWN_CLOSE_SEAT_PAIRS = new Set([
    // Colour-safe lavender seat vs the blue crystal for protanopes (dE ~6.5)
    'safe|protanopia|#C9B6FF|#3DB7FF',
]);

for (const p of PALETTE_LIST) {
    for (const kind of VISIONS) {
        test(`${p.id}: collect vs hazard distinguishable (${kind})`, () => {
            const r = distinguishable(p.collect, p.hazard, kind);
            assert.ok(r.ok, `${p.collect} vs ${p.hazard}: contrast ${r.contrast.toFixed(2)}, dE ${r.deltaE.toFixed(1)}`);
        });

        test(`${p.id}: collect and hazard stand out from the background (${kind})`, () => {
            // Colour-safe keeps 3:1 (WCAG non-text contrast) for every vision type. Standard
            // dark red drops to about 2.4:1 for protanopes; that is what Colour-safe is for.
            const min = p.id === 'standard' ? 2 : 3;
            for (const col of [p.collect, p.hazard, p.collectRadar, p.hazardRadar]) {
                const c = contrast(simulate(col, kind), simulate(BACKGROUND, kind));
                assert.ok(c >= min, `${col} on ${BACKGROUND}: ${c.toFixed(2)}`);
            }
        });
    }

    for (const kind of CVD) {
        // Radar markers also differ in shape (dot vs x), and the radar hazard colour is
        // brighter than the rock outline, so grayscale is not required here.
        test(`${p.id}: radar collect vs hazard distinguishable (${kind})`, () => {
            const r = distinguishable(p.collectRadar, p.hazardRadar, kind);
            assert.ok(r.ok, `${p.collectRadar} vs ${p.hazardRadar}: dE ${r.deltaE.toFixed(1)}`);
        });

        test(`${p.id}: seat colours differ from each other and from collect/hazard (${kind})`, () => {
            const seats = p.seats;
            const clashes = [];
            for (let i = 0; i < seats.length; i++) {
                for (let j = i + 1; j < seats.length; j++) {
                    if (!distinguishable(seats[i], seats[j], kind, 10).ok) clashes.push(`${p.id}|${kind}|${seats[i]}|${seats[j]}`);
                }
                for (const other of [p.collect, p.hazard]) {
                    if (!distinguishable(seats[i], other, kind, 10).ok) clashes.push(`${p.id}|${kind}|${seats[i]}|${other}`);
                }
            }
            const unexpected = clashes.filter((c) => !KNOWN_CLOSE_SEAT_PAIRS.has(c));
            assert.deepEqual(unexpected, []);
        });
    }
}

test('known close seat pairs are still close (remove them from the list once fixed)', () => {
    for (const key of KNOWN_CLOSE_SEAT_PAIRS) {
        const [, kind, a, b] = key.split('|');
        assert.equal(distinguishable(a, b, kind, 10).ok, false, key);
    }
});
