// Player names (the username prompt, profiles, high scores, ghosts). Pure, no DOM.
//
// A name is 3 to 10 letters or digits in any script ("JÜRGEN", "ZOË", "ŁUKASZ", "ΝΊΚΟΣ",
// "さくら"). Input is NFC-normalised (a composed "Ü" and "U" + combining diaeresis are the
// same name) and upper-cased with toUpperCase(), not toLocaleUpperCase(): the result is the
// same on every device, so a name typed on a Turkish-locale tablet opens the same save slot
// everywhere (persistence.js, ghost.js and lobby.js all compare with toUpperCase()).
// Lengths count code points, not UTF-16 units.

export const NAME_MIN_LENGTH = 3;
export const NAME_MAX_LENGTH = 10;

// Letters (any script), combining marks that NFC could not compose, and digits (any script)
const NAME_CHAR = /^[\p{L}\p{M}\p{N}]$/u;

/** Number of characters (code points) in a name. */
export function nameLength(value) {
    return Array.from(String(value ?? '')).length;
}

/** True for one character that may appear in a name (a letter, mark or digit). */
export function isNameChar(ch) {
    return typeof ch === 'string' && NAME_CHAR.test(ch);
}

/**
 * Clean a typed name: NFC, upper case, letters/digits only, at most 10 code points.
 * A leading combining mark (nothing to attach to) is dropped.
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeName(value) {
    const upper = String(value ?? '').normalize('NFC').toUpperCase().normalize('NFC');
    const out = [];
    for (const ch of upper) {
        if (!isNameChar(ch)) continue;
        if (out.length === 0 && /^\p{M}$/u.test(ch)) continue;
        out.push(ch);
        if (out.length >= NAME_MAX_LENGTH) break;
    }
    return out.join('');
}

/** True when the (already sanitised) name is long enough and short enough. */
export function isValidName(value) {
    const n = nameLength(value);
    return typeof value === 'string' && n >= NAME_MIN_LENGTH && n <= NAME_MAX_LENGTH
        && sanitizeName(value) === value;
}

/** The first `count` characters (code points) in upper case, e.g. "JÜR" for high-score rows. */
export function nameInitials(value, count = 3) {
    return Array.from(String(value ?? '')).slice(0, Math.max(0, count)).join('').toUpperCase();
}
