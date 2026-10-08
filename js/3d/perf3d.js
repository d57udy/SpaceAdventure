// Frame-rate check and graphics-context loss handling for the 3D game
// (docs/plans/06-3d-mode.md §3, plan 07 Phase 5). Pure: the game feeds frame times and
// context events and acts on the decisions.
//
// Frame rate: during the first seconds of play the monitor watches the frame rate. The
// renderer already lowers its render scale while slow; the monitor tells the game whether
// that is enough ('ok'), still under way ('lower-resolution'), or whether to offer 2D
// ('offer-2d': still below 30 fps at the lowest render scale).

export const PERF3D = Object.freeze({
    windowSeconds: 10,  // decide within this much play time
    warmup: 1.5,        // s ignored at the start (shader compiles, first uploads)
    sampleSeconds: 2,   // average over this much recent time
    okFps: 45,          // below this the render scale should go down
    offerFps: 30,       // below this at the lowest scale: offer 2D
    offerHold: 2,       // s it must stay that slow at the lowest scale
    maxFrame: 0.5,      // longer frames (tab hidden, debugger) are ignored
});

/**
 * @returns monitor with frame(dt, { renderScale, minScale }) -> decision, decline(), reset(),
 *   decision ('measuring' | 'lower-resolution' | 'ok' | 'offer-2d'), fps, final, snapshot()
 */
export function createPerfMonitor(opts = {}) {
    const P = { ...PERF3D, ...opts };
    let time = 0;
    let samples = []; // [time, dt]
    let sum = 0;
    let slowAtMin = 0;
    let decision = 'measuring';
    let final = false;

    function avgFps() {
        while (samples.length && time - samples[0][0] > P.sampleSeconds) sum -= samples.shift()[1];
        return sum > 0 ? samples.length / sum : 0;
    }

    const api = {
        get decision() { return decision; },
        get final() { return final; },
        get fps() { return avgFps(); },
        /**
         * One rendered frame. dt: seconds since the last frame. renderScale: the renderer's
         * current scale; minScale: its lowest. Returns the decision after this frame.
         */
        frame(dt, { renderScale = 1, minScale = 0.5 } = {}) {
            if (final) return decision;
            const d = Number(dt);
            if (!(d > 0) || d > P.maxFrame) return decision;
            time += d;
            if (time < P.warmup) return decision;
            samples.push([time, d]);
            sum += d;
            const fps = avgFps();
            const atMin = renderScale <= minScale + 1e-6;
            const enough = time - P.warmup >= Math.min(P.sampleSeconds, 1);
            if (!enough) return decision;
            if (fps < P.offerFps && atMin) slowAtMin += d;
            else slowAtMin = 0;
            if (slowAtMin >= P.offerHold) {
                decision = 'offer-2d';
                final = true;
            } else if (fps < P.okFps && !atMin) {
                decision = 'lower-resolution';
            } else if (time >= P.windowSeconds) {
                decision = 'ok';
                final = true;
            } else if (fps >= P.okFps) {
                decision = 'measuring';
            }
            return decision;
        },
        /** The player chose to stay in 3D after the offer: no more offers this session. */
        decline() {
            decision = 'ok';
            final = true;
        },
        reset() {
            time = 0; samples = []; sum = 0; slowAtMin = 0; decision = 'measuring'; final = false;
        },
        snapshot() {
            return { decision, final, fps: Math.round(avgFps() * 10) / 10, time: Math.round(time * 100) / 100 };
        },
    };
    return api;
}

// --- WebGL context loss ---

export const CONTEXT3D = Object.freeze({
    restoreWait: 10,   // s of VISIBLE time to wait for 'webglcontextrestored' before asking (a phone's GPU reset can take a while)
    maxLosses: 3,      // losses within lossWindow: the graphics are failing, back to 2D
    lossWindow: 60,    // s
});

export const CONTEXT_MESSAGES = Object.freeze({
    lost: 'Graphics reset. Restoring…',
    stuck: 'The graphics were reset and have not come back yet.',
    fallback: 'The graphics stopped working. Switched to the 2D game.',
});

/**
 * Decisions for 'webglcontextlost' / 'webglcontextrestored'. The page must call
 * event.preventDefault() on the lost event (otherwise the browser never restores it).
 *   lost(now)      -> { pause: true, message }   pause the game, show the message
 *   restored(now)  -> { rebuild: true }          rebuild renderer resources, keep the game
 *   tick(now, { visible }) ->
 *     { ask: true, message }        once per loss: no restore after restoreWait s of visible
 *                                   time (a hidden tab's wait doesn't count): ask the player to
 *                                   retry or switch to 2D
 *     { fallback: true, message }   once: lost maxLosses times within lossWindow: back to 2D
 *   retry()        -> start a new wait (the player chose Retry)
 */
export function createContextLossTracker(opts = {}) {
    const C = { ...CONTEXT3D, ...opts };
    let lostAt = null;
    let waited = 0;    // visible seconds since the loss
    let lastTick = null;
    let asked = false;
    let losses = [];
    let gaveUp = false;

    const api = {
        get isLost() { return lostAt !== null; },
        get gaveUp() { return gaveUp; },
        lost(now) {
            if (gaveUp) return { pause: true, message: CONTEXT_MESSAGES.fallback };
            lostAt = now;
            waited = 0;
            lastTick = now;
            asked = false;
            losses = losses.filter(t => now - t <= C.lossWindow);
            losses.push(now);
            return { pause: true, message: CONTEXT_MESSAGES.lost };
        },
        restored() {
            if (gaveUp || lostAt === null) return { rebuild: false };
            lostAt = null;
            asked = false;
            return { rebuild: true };
        },
        retry() {
            if (lostAt === null || gaveUp) return;
            waited = 0;
            asked = false;
        },
        tick(now, { visible = true } = {}) {
            if (gaveUp) return null;
            if (losses.filter(t => now - t <= C.lossWindow).length >= C.maxLosses) {
                gaveUp = true;
                return { fallback: true, message: CONTEXT_MESSAGES.fallback };
            }
            if (lostAt === null) return null;
            const dt = lastTick === null ? 0 : Math.max(0, now - lastTick);
            lastTick = now;
            if (visible) waited += dt;
            if (!asked && waited >= C.restoreWait) {
                asked = true;
                return { ask: true, message: CONTEXT_MESSAGES.stuck };
            }
            return null;
        },
        snapshot() {
            return { lost: lostAt !== null, losses: losses.length, gaveUp, waited: Math.round(waited * 100) / 100, asked };
        },
    };
    return api;
}
