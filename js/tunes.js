// Built-in music tunes, as data for the tune-agnostic engine in music.js.
// Each tune defines, per mood (menu / calm / danger / boss): chord progressions in
// sections, bass/arpeggio/drum patterns, an optional melody, and a layer-gain table.
// Notes are MIDI numbers (60 = C4). Patterns are 16 steps (16th notes) per bar.

export const MOODS = Object.freeze(['menu', 'calm', 'danger', 'boss']);
export const LAYERS = Object.freeze(['pad', 'bass', 'arp', 'lead', 'bell', 'kick', 'snare', 'hat', 'pulse']);
export const STEPS_PER_BAR = 16;

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// 'A4' -> 69, 'C#5' -> 73, 'Bb3' -> 58
export function noteToMidi(name) {
    const m = /^([A-G])(#|b)?(-?\d)$/.exec(String(name).trim());
    if (!m) throw new Error(`Bad note name: ${name}`);
    const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
    return 12 * (Number(m[3]) + 1) + PC[m[1]] + acc;
}

export function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
}

// Melody bar: 'A4:4 C5:2 -:2 ...' (note:length in 16th steps, '-' = rest), 16 steps total.
export function parseBar(text) {
    const events = [];
    let step = 0;
    for (const tok of String(text).trim().split(/\s+/)) {
        const [name, lenStr] = tok.split(':');
        const len = Number(lenStr || 1);
        if (!Number.isInteger(len) || len <= 0) throw new Error(`Bad length in ${tok}`);
        if (name !== '-') events.push({ step, note: noteToMidi(name), dur: len });
        step += len;
    }
    if (step !== STEPS_PER_BAR) throw new Error(`Melody bar is ${step} steps, expected ${STEPS_PER_BAR}: ${text}`);
    return events;
}

// Drum/rhythm string: 'x' = hit, 'o' = soft hit, '.' = rest.
export function parseHits(pattern) {
    if (pattern.length !== STEPS_PER_BAR) throw new Error(`Pattern must be ${STEPS_PER_BAR} steps: ${pattern}`);
    return [...pattern].map(c => (c === 'x' ? 1 : c === 'o' ? 0.55 : 0));
}

function chord(name, notes, bass) {
    return Object.freeze({ name, notes: Object.freeze(notes.map(noteToMidi)), bass: noteToMidi(bass) });
}

const _ = null;

function drums(kick, snare, hat) {
    return Object.freeze({ kick: parseHits(kick), snare: parseHits(snare), hat: parseHits(hat) });
}

function melody(sections) {
    return Object.freeze(sections.map(bars => Object.freeze(bars.map(parseBar))));
}

// ---------------------------------------------------------------------------
// Synthwave: A minor, 96 BPM. Detuned saw pads, octave-pumping bass, echoing
// square arpeggios, a saw lead on the second pass, gated drums in boss fights.
// ---------------------------------------------------------------------------
const SW = {
    Am7: chord('Am7', ['A3', 'C4', 'E4', 'G4'], 'A2'),
    Fmaj7: chord('Fmaj7', ['F3', 'A3', 'C4', 'E4'], 'F2'),
    Cadd9: chord('Cadd9', ['G3', 'C4', 'D4', 'E4'], 'C3'),
    G: chord('G', ['G3', 'B3', 'D4', 'G4'], 'G2'),
    F: chord('F', ['F3', 'A3', 'C4', 'F4'], 'F2'),
    Em7: chord('Em7', ['G3', 'B3', 'D4', 'E4'], 'E2'),
    Dm7: chord('Dm7', ['F3', 'A3', 'C4', 'D4'], 'D2'),
    E: chord('E', ['G#3', 'B3', 'E4', 'G#4'], 'E2'),
    Esus: chord('Esus4', ['A3', 'B3', 'E4', 'A4'], 'E2'),
};

const synthwave = {
    id: 'synthwave',
    name: 'Synthwave',
    bpm: 96,
    progressions: {
        menu: [[SW.Am7, SW.Am7, SW.Fmaj7, SW.Fmaj7], [SW.Cadd9, SW.Cadd9, SW.G, SW.G]],
        calm: [[SW.Am7, SW.Fmaj7, SW.Cadd9, SW.G], [SW.F, SW.G, SW.Em7, SW.Am7]],
        danger: [[SW.Am7, SW.Am7, SW.F, SW.E]],
        boss: [[SW.Am7, SW.F, SW.Dm7, SW.E], [SW.Am7, SW.F, SW.Dm7, SW.Esus]],
    },
    pad: { patterns: {} },
    bass: {
        patterns: {
            default: [0, _, 12, _, 0, _, 12, _, 0, _, 12, _, 0, _, 12, 7],
            danger: [0, _, _, 0, _, _, 0, _, 0, _, _, 0, _, _, 12, _],
            boss: [0, _, 12, _, 0, _, 12, _, 0, _, 12, _, 0, 12, 0, 12],
        },
    },
    arp: {
        patterns: [
            [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1],
            [0, 2, 4, 2, 1, 3, 5, 3, 0, 2, 4, 2, 1, 3, 5, 3],
            [4, 3, 2, 0, 5, 4, 2, 1, 4, 3, 2, 0, 6, 5, 3, 2],
        ],
        stride: { calm: 2, danger: 2, boss: 1 },
        octave: 12,
    },
    lead: {
        startBar: 4, // second half of each 8-bar block (call and response with the arp)
        melodies: {
            calm: melody([
                ['E5:4 D5:2 C5:2 B4:4 C5:4', 'A4:6 C5:2 F5:4 E5:4', 'E5:4 D5:2 C5:2 D5:4 E5:4', 'D5:8 B4:4 G4:4'],
                ['A4:4 C5:4 A4:2 G4:2 F4:4', 'G4:4 B4:4 D5:6 -:2', 'E5:4 D5:2 B4:2 G4:4 B4:4', 'A4:12 -:4'],
            ]),
        },
    },
    drums: {
        calm: drums('................', '................', '..x...x...x...x.'),
        danger: drums('x.......x.......', '................', '..x...x...x...x.'),
        boss: drums('x...x...x...x...', '....x.......x...', 'x.x.x.x.x.x.x.x.'),
        fill: { boss: '............x.xx' },
        ghostHat: { calm: 0.12, boss: 0.25 },
    },
    pulse: parseHits('x..o....x..o....'),
    bells: { prob: {}, octave: 24 },
    voices: {
        pad: { type: 'sawtooth', osc: 2, detune: 9, attack: 0.6, release: 1.6, gate: 1, gain: 0.026, filter: { type: 'lowpass', freq: 1500, q: 0.7 }, echo: 0 },
        bass: { type: 'sawtooth', attack: 0.005, release: 0.08, gate: 0.75, gain: 0.11, filter: { type: 'lowpass', freq: 650, q: 3 }, echo: 0 },
        arp: { type: 'square', attack: 0.003, release: 0.12, gate: 0.45, gain: 0.03, filter: { type: 'lowpass', freq: 2200, q: 1.5 }, echo: 0.45 },
        lead: { type: 'sawtooth', osc: 2, detune: 5, attack: 0.03, release: 0.35, gate: 0.9, gain: 0.03, filter: { type: 'lowpass', freq: 2600, q: 1 }, echo: 0.35 },
        kick: { type: 'sine', drum: 'kick', startFreq: 150, endFreq: 42, sweep: 0.12, decay: 0.38, gain: 0.45 },
        snare: { drum: 'noise', tone: 185, decay: 0.24, gain: 0.14, filter: { type: 'highpass', freq: 1400, q: 0.7 }, echo: 0.2 },
        hat: { drum: 'noise', decay: 0.045, gain: 0.05, filter: { type: 'highpass', freq: 7500, q: 0.7 } },
        pulse: { type: 'sine', drum: 'kick', startFreq: 75, endFreq: 42, sweep: 0.09, decay: 0.28, gain: 0.3 },
    },
    layers: {
        menu: { pad: 0.9 },
        calm: { pad: 0.7, bass: 0.75, arp: 0.5, lead: 0.55, hat: 0.5 },
        danger: { pad: 0.6, bass: 0.9, arp: 0.35, hat: 0.5, kick: 0.5, pulse: 0.9 },
        boss: { pad: 0.5, bass: 1, arp: 0.6, kick: 1, snare: 0.8, hat: 0.7 },
    },
    filterScale: { menu: 0.7, calm: 1, danger: 0.55, boss: 1.35 },
    echo: { steps: 3, feedback: 0.32, wet: 0.3 },
    gameOver: { voice: 'lead', melody: 'E5:2 D5:2 C5:2 B4:2 A4:8', chord: SW.Am7 },
    preview: { bar: 4, bars: 2 },
};

// ---------------------------------------------------------------------------
// Ambient: E minor, 70 BPM. Slow evolving extended chords, sparse echoing bells,
// long bass notes; drums only appear for danger and boss.
// ---------------------------------------------------------------------------
const AM = {
    Em9: chord('Em9', ['G3', 'B3', 'D4', 'F#4'], 'E2'),
    Cmaj9: chord('Cmaj9', ['E3', 'G3', 'B3', 'D4'], 'C2'),
    Gadd9: chord('Gadd9', ['G3', 'A3', 'B3', 'D4'], 'G2'),
    Dadd9: chord('Dadd9', ['F#3', 'A3', 'D4', 'E4'], 'D2'),
    Am9: chord('Am9', ['G3', 'B3', 'C4', 'E4'], 'A2'),
    Bm7: chord('Bm7', ['F#3', 'A3', 'B3', 'D4'], 'B1'),
    B7: chord('B7', ['F#3', 'A3', 'B3', 'D#4'], 'B1'),
    Em: chord('Em', ['G3', 'B3', 'E4', 'G4'], 'E2'),
    C: chord('C', ['G3', 'C4', 'E4', 'G4'], 'C2'),
    Am: chord('Am', ['A3', 'C4', 'E4', 'A4'], 'A2'),
    B: chord('B', ['F#3', 'B3', 'D#4', 'F#4'], 'B1'),
};

const ambient = {
    id: 'ambient',
    name: 'Ambient',
    bpm: 70,
    progressions: {
        menu: [[AM.Em9, AM.Em9, AM.Cmaj9, AM.Cmaj9]],
        calm: [[AM.Em9, AM.Cmaj9, AM.Gadd9, AM.Dadd9], [AM.Am9, AM.Cmaj9, AM.Em9, AM.Bm7]],
        danger: [[AM.Em9, AM.Em9, AM.Cmaj9, AM.B7]],
        boss: [[AM.Em, AM.C, AM.Am, AM.B]],
    },
    pad: { patterns: {} },
    bass: {
        patterns: {
            default: [0, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
            danger: [0, _, _, _, _, _, _, _, 0, _, _, _, _, _, 7, _],
            boss: [0, _, _, 0, _, _, 0, _, 0, _, _, 0, _, _, 12, _],
        },
    },
    arp: {
        patterns: [
            [0, 2, 4, 6, 4, 2, 0, 2, 1, 3, 5, 7, 5, 3, 1, 3],
            [4, 2, 0, 2, 5, 3, 1, 3, 4, 2, 0, 2, 6, 4, 2, 4],
            [0, 1, 2, 4, 2, 1, 0, 1, 3, 4, 5, 7, 5, 4, 3, 1],
        ],
        stride: { boss: 2 },
        octave: 12,
    },
    lead: { startBar: 0, melodies: {} },
    drums: {
        danger: drums('................', '................', 'o...o...o...o...'),
        boss: drums('x.......x..x....', '....x.......x...', 'x.o.x.o.x.o.x.o.'),
        fill: { boss: '..............xo' },
        ghostHat: {},
    },
    pulse: parseHits('x..o............'),
    bells: { prob: { menu: 0.06, calm: 0.12, danger: 0.05, boss: 0 }, octave: 24 },
    voices: {
        pad: { type: 'sawtooth', osc: 2, detune: 12, attack: 1.6, release: 3.2, gate: 1, gain: 0.022, filter: { type: 'lowpass', freq: 950, q: 0.6 }, sweep: 0.45, echo: 0.15 },
        bass: { type: 'sine', attack: 0.25, release: 1.4, gate: 0.95, gain: 0.16, echo: 0 },
        arp: { type: 'triangle', attack: 0.005, release: 0.4, gate: 0.6, gain: 0.05, filter: { type: 'lowpass', freq: 2400, q: 0.7 }, echo: 0.5 },
        bell: { type: 'sine', partial: 3, partialGain: 0.22, attack: 0.004, decay: 2.2, gain: 0.045, echo: 0.6 },
        kick: { type: 'sine', drum: 'kick', startFreq: 120, endFreq: 38, sweep: 0.14, decay: 0.45, gain: 0.4 },
        snare: { drum: 'noise', decay: 0.3, gain: 0.1, filter: { type: 'bandpass', freq: 1800, q: 0.8 }, echo: 0.4 },
        hat: { drum: 'noise', decay: 0.06, gain: 0.04, filter: { type: 'highpass', freq: 8000, q: 0.7 }, echo: 0.3 },
        pulse: { type: 'sine', drum: 'kick', startFreq: 65, endFreq: 40, sweep: 0.1, decay: 0.3, gain: 0.3 },
    },
    layers: {
        menu: { pad: 0.9, bell: 0.4 },
        calm: { pad: 0.8, bass: 0.6, bell: 0.6 },
        danger: { pad: 0.7, bass: 0.75, bell: 0.3, hat: 0.4, pulse: 0.9 },
        boss: { pad: 0.55, bass: 0.85, arp: 0.55, kick: 0.9, snare: 0.6, hat: 0.6 },
    },
    filterScale: { menu: 0.8, calm: 1, danger: 0.6, boss: 1.5 },
    echo: { steps: 6, feedback: 0.42, wet: 0.35 },
    gameOver: { voice: 'bell', melody: 'B5:2 G5:2 E5:2 D5:2 B4:8', chord: AM.Em9 },
    preview: { bar: 0, bars: 1 },
};

// ---------------------------------------------------------------------------
// Chiptune: D minor, 132 BPM. Square lead and arpeggios, triangle bass,
// noise percussion, in the style of 8-bit consoles.
// ---------------------------------------------------------------------------
const CH = {
    Dm: chord('Dm', ['D4', 'F4', 'A4'], 'D2'),
    Bb: chord('Bb', ['D4', 'F4', 'Bb4'], 'Bb1'),
    F: chord('F', ['C4', 'F4', 'A4'], 'F2'),
    C: chord('C', ['C4', 'E4', 'G4'], 'C2'),
    Gm: chord('Gm', ['D4', 'G4', 'Bb4'], 'G1'),
    Am: chord('Am', ['C4', 'E4', 'A4'], 'A1'),
    A: chord('A', ['C#4', 'E4', 'A4'], 'A1'),
};

const chiptune = {
    id: 'chiptune',
    name: 'Chiptune',
    bpm: 132,
    progressions: {
        menu: [[CH.Dm, CH.Dm, CH.Bb, CH.Bb], [CH.F, CH.F, CH.C, CH.C]],
        calm: [[CH.Dm, CH.Bb, CH.F, CH.C], [CH.Bb, CH.C, CH.Am, CH.Dm]],
        danger: [[CH.Dm, CH.Dm, CH.Bb, CH.A]],
        boss: [[CH.Dm, CH.Bb, CH.Gm, CH.A]],
    },
    pad: { patterns: { calm: parseHits('....x.......x...'), danger: parseHits('....x.......x...') }, dur: 2 },
    bass: {
        patterns: {
            default: [0, _, 12, _, 0, _, 12, _, 0, _, 12, _, 0, _, 12, _],
            danger: [0, _, 0, _, _, _, 0, _, 0, _, 0, _, _, _, 12, _],
            boss: [0, _, 12, _, 0, _, 12, _, 0, _, 12, _, 0, 12, 7, 12],
        },
    },
    arp: {
        patterns: [
            [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3],
            [0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 1, 3, 2, 1, 0],
            [2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 5, 3],
        ],
        stride: { calm: 2, danger: 2, boss: 1 },
        octave: 12,
    },
    lead: {
        startBar: 4,
        melodies: {
            calm: melody([
                ['D5:2 F5:2 A5:4 G5:2 F5:2 E5:2 F5:2', 'D5:6 C5:2 Bb4:4 D5:4', 'C5:2 F5:2 A5:2 C6:2 A5:4 F5:4', 'G5:4 E5:4 C5:2 D5:2 E5:4'],
                ['F5:4 D5:2 F5:2 Bb5:6 A5:2', 'G5:4 E5:2 G5:2 C6:4 Bb5:4', 'A5:4 E5:2 C5:2 E5:4 A5:4', 'F5:2 E5:2 D5:12'],
            ]),
        },
    },
    drums: {
        calm: drums('x.......x.......', '................', '..x...x...x...x.'),
        danger: drums('x.......x.......', '................', 'x...x...x...x...'),
        boss: drums('x...x...x...x...', '....x.......x...', '..x...x...x...x.'),
        fill: { boss: '............xxxx' },
        ghostHat: {},
    },
    pulse: parseHits('x..o....x..o....'),
    bells: { prob: {}, octave: 24 },
    voices: {
        pad: { type: 'square', osc: 1, attack: 0.005, release: 0.08, gate: 0.8, gain: 0.014, filter: { type: 'lowpass', freq: 1800, q: 0.7 }, echo: 0 },
        bass: { type: 'triangle', attack: 0.003, release: 0.03, gate: 0.85, gain: 0.2, echo: 0 },
        arp: { type: 'square', attack: 0.002, release: 0.02, gate: 0.9, gain: 0.022, filter: { type: 'lowpass', freq: 3800, q: 0.7 }, echo: 0.15 },
        lead: { type: 'square', attack: 0.004, release: 0.05, gate: 0.85, gain: 0.03, filter: { type: 'lowpass', freq: 4200, q: 0.7 }, echo: 0.2 },
        bell: { type: 'triangle', attack: 0.002, decay: 0.5, gain: 0.04 },
        kick: { type: 'triangle', drum: 'kick', startFreq: 180, endFreq: 45, sweep: 0.08, decay: 0.16, gain: 0.45 },
        snare: { drum: 'noise', decay: 0.12, gain: 0.12, filter: { type: 'highpass', freq: 1500, q: 0.7 } },
        hat: { drum: 'noise', decay: 0.03, gain: 0.045, filter: { type: 'highpass', freq: 8500, q: 0.7 } },
        pulse: { type: 'triangle', drum: 'kick', startFreq: 95, endFreq: 50, sweep: 0.08, decay: 0.2, gain: 0.3 },
    },
    layers: {
        menu: { pad: 0.9, arp: 0.25 },
        calm: { pad: 0.6, bass: 0.8, arp: 0.45, lead: 0.6, kick: 0.4, hat: 0.5 },
        danger: { pad: 0.5, bass: 0.9, arp: 0.5, hat: 0.5, kick: 0.5, pulse: 0.8 },
        boss: { bass: 1, arp: 0.6, kick: 0.9, snare: 0.7, hat: 0.6 }, // the 16th arp carries the chords
    },
    filterScale: { menu: 0.8, calm: 1, danger: 0.6, boss: 1.2 },
    echo: { steps: 3, feedback: 0.2, wet: 0.2 },
    gameOver: { voice: 'lead', melody: 'A5:2 F5:2 D5:2 A4:2 D4:8', chord: CH.Dm },
    preview: { bar: 4, bars: 2 },
};
// Chiptune menu: slow quarter-note arpeggio for a little motion under the pad.
chiptune.arp.stride.menu = 4;

function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
        Object.freeze(o);
        for (const k of Object.keys(o)) deepFreeze(o[k]);
    }
    return o;
}

// Pre-parse the game-over phrases so the engine gets MIDI events.
for (const t of [synthwave, ambient, chiptune]) {
    t.gameOver.events = parseBar(t.gameOver.melody);
}

export const TUNES = deepFreeze({ synthwave, ambient, chiptune });
export const TUNE_IDS = Object.freeze(Object.keys(TUNES));
export const TUNE_OPTIONS = Object.freeze(['off', ...TUNE_IDS]);

export function tuneName(id) {
    return id === 'off' ? 'Off' : (TUNES[id] ? TUNES[id].name : 'Off');
}
