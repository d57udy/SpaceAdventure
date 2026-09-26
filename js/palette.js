// Colour palettes (pure data, DOM-free). Shapes always carry the collect/hazard meaning
// (smooth crystal vs spiky rock); the palette only changes colours and colour words.
//
// The palette id is stored through js/settings.js ('palette': 'standard' | 'safe').

export const PALETTE_KEY = 'spaceAdventure_palette';

function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbaFn(hex) {
    const [r, g, b] = hexToRgb(hex);
    return (alpha) => `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function makePalette(p) {
    return Object.freeze({
        ...p,
        seats: Object.freeze([...p.seats]),
        // Translucent versions for glows and fills: fn(alpha) -> 'rgba(...)'
        collectRgba: rgbaFn(p.collect),
        collectFill: rgbaFn(p.collectFillBase),
        hazardRgba: rgbaFn(p.hazard),
        hazardFill: rgbaFn(p.hazardFillBase),
    });
}

export const Palettes = Object.freeze({
    STANDARD: makePalette({
        id: 'standard',
        name: 'Standard',
        collect: '#00FF00',          // bright green crystal outline
        collectFillBase: '#00B400',  // translucent pulsing fill
        collectRadar: '#00FF00',
        hazard: '#CC0000',           // dark red rock outline
        hazardFillBase: '#3C0000',   // dark, nearly opaque fill
        hazardRadar: '#FF0000',
        collectWord: 'GREEN',
        hazardWord: 'RED',
        // Local multiplayer seat colours (05-local-multiplayer.md §10.3)
        seats: ['#33D6FF', '#FFA23A', '#FF66CC', '#FFFFFF'],
    }),
    // Blue/orange, based on Okabe-Ito. The hazard orange is darker than the Okabe-Ito
    // #FF9500 so collect and hazard still differ in brightness in grayscale (the plan's
    // 2:1 / CIE76 >= 20 check, tests/unit/palette.test.mjs); the radar keeps #FF9500.
    COLOUR_SAFE: makePalette({
        id: 'safe',
        name: 'Colour-safe',
        collect: '#3DB7FF',
        collectFillBase: '#1E8CD2',
        collectRadar: '#3DB7FF',
        hazard: '#C44A00',
        hazardFillBase: '#3A1800',
        hazardRadar: '#FF9500',
        collectWord: 'BLUE',
        hazardWord: 'ORANGE',
        seats: ['#FFFFFF', '#F0E442', '#FF66CC', '#C9B6FF'],
    }),
});

export const PALETTE_LIST = Object.freeze([Palettes.STANDARD, Palettes.COLOUR_SAFE]);

export function findPalette(id) {
    return PALETTE_LIST.find((p) => p.id === id) || Palettes.STANDARD;
}

export { hexToRgb };
