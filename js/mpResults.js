// Multiplayer round results (pure: no DOM, no globals). See docs/plans/05-local-multiplayer.md §5, §11.
//
// buildResults() turns the mode's end decision ({ outcome, winners }) and the players into the
// `lastResults` record the Results screen shows and the history stores.

/** Accuracy 0..1 from shots and hits (0 without shots). */
export function accuracy(stats) {
    const shots = Number(stats && stats.shots) || 0;
    const hits = Number(stats && stats.hits) || 0;
    return shots > 0 ? Math.min(1, hits / shots) : 0;
}

/**
 * Players ranked for the Results screen: winners first, then by score (highest first),
 * then kills, then seat order. Returns new row objects; never mutates.
 * @param {Array<{id, slot, score, stats}>} rows
 * @param {string[]} winners
 */
export function rankRows(rows, winners = []) {
    const win = new Set(winners || []);
    return rows.slice().sort((a, b) =>
        (win.has(b.id) - win.has(a.id)) ||
        ((b.score || 0) - (a.score || 0)) ||
        ((b.kills || 0) - (a.kills || 0)) ||
        ((a.slot || 0) - (b.slot || 0)));
}

/** Highlight lines like "Most greens: BOB (7)" for stats where one player leads (value > 0). */
export function highlights(rows) {
    const cats = [
        ['greens', 'Most greens'],
        ['redsShot', 'Most rocks shot'],
        ['ufos', 'Most UFOs'],
        ['bestCombo', 'Best combo'],
        ['greensDenied', 'Most denials'],
        ['revivesGiven', 'Most revives'],
    ];
    const out = [];
    for (const [key, label] of cats) {
        let best = 0;
        let who = [];
        for (const r of rows) {
            const v = Number(r[key]) || 0;
            if (v > best) { best = v; who = [r]; } else if (v === best && v > 0) who.push(r);
        }
        if (best > 0 && who.length === 1) out.push(`${label}: ${who[0].name} (${best})`);
    }
    return out;
}

/**
 * @param {object} o
 * @param {{id, name, kind}} o.mode
 * @param {{outcome:string, winners:string[]}} o.result - from mode.hooks.checkEnd
 * @param {Array} o.players - js/players.js records (plus optional .level and .newAchievements)
 * @param {number} [o.duration] - seconds played
 * @param {number} [o.level] - level reached (team modes)
 * @param {string} [o.difficulty]
 * @param {number} [o.date] - ms timestamp
 */
export function buildResults({ mode, result, players, duration = 0, level = null, difficulty = null, date = Date.now() }) {
    const winners = (result && Array.isArray(result.winners)) ? result.winners.slice() : [];
    const rows = (players || []).map((p) => {
        const s = p.stats || {};
        return {
            id: p.id,
            slot: p.slot,
            name: p.name,
            profile: p.profile || null,
            colour: p.colour,
            score: p.score || 0,
            lives: p.lives || 0,
            level: Number.isFinite(p.level) ? p.level : level,
            kills: s.kills || 0,
            deaths: s.deaths || 0,
            greens: s.greens || 0,
            redsShot: s.redsShot || 0,
            ufos: s.ufos || 0,
            accuracy: accuracy(s),
            bestCombo: s.bestCombo || 0,
            revivesGiven: s.revivesGiven || 0,
            greensDenied: s.greensDenied || 0,
            credits: s.creditsEarned || 0,
            newAchievements: Array.isArray(p.newAchievements) ? p.newAchievements.slice() : [],
            winner: winners.includes(p.id),
        };
    });
    const ranked = rankRows(rows, winners);
    return {
        mode: mode ? mode.id : null,
        modeName: mode ? mode.name : null,
        kind: mode ? mode.kind : null,
        outcome: result ? result.outcome : null,
        winners,
        winnerNames: ranked.filter((r) => r.winner).map((r) => r.name),
        duration: Math.round((duration || 0) * 10) / 10,
        teamScore: rows.reduce((sum, r) => sum + r.score, 0),
        level,
        difficulty,
        date,
        players: ranked,
        highlights: highlights(rows),
    };
}

/** Headline for the Results screen and the round-end banner. */
export function resultBanner(results) {
    if (!results) return '';
    if (results.outcome === 'draw') return 'DRAW';
    if (results.kind === 'coop') return 'TEAM RESULT';
    const names = results.winnerNames || [];
    if (names.length === 1) return `${names[0]} WINS!`;
    if (names.length > 1) return `TIE: ${names.join(' & ')}`;
    return 'ROUND OVER';
}

/** Compact copy for the stored history (spaceAdventure_mp_history_v1). */
export function historyEntry(results) {
    return {
        mode: results.mode,
        outcome: results.outcome,
        date: results.date,
        duration: results.duration,
        difficulty: results.difficulty,
        teamScore: results.teamScore,
        winners: (results.players || []).filter((p) => p.winner).map((p) => p.name),
        players: (results.players || []).map((p) => ({ name: p.name, profile: p.profile, score: p.score, level: p.level })),
    };
}
