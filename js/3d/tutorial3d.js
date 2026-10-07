// First-game tutorial for the 3D game (docs/plans/07-3d-game.md, Phase 5). DOM-free step
// machine like the 2D js/tutorial.js: the game notifies events, calls update(dt) each frame
// and acts on the requests returned (spawn a target, respawn, show a message, finish).
//
// Asked first, like 2D: only when the shared "Offer tutorial" setting is on and this user has
// never been asked about (or finished) the 3D tutorial. The record is per user and separate
// from 2D (PersistenceManager saveTutorial3dState / loadTutorial3dState), because the 3D
// controls are new even to a 2D veteran.

export const TUTORIAL3D_VERSION = 1;

export const TUTORIAL3D_EVENTS = Object.freeze([
    'looked', 'thrusted', 'collectedGreen', 'destroyedRed', 'radarSeen', 'shotGreen', 'died', 'confirm', 'targetLost',
]);

export const LOOK_GOAL = Math.PI / 2;   // radians of total turning (any axis)
export const THRUST_GOAL = 0.8;         // seconds of thrust in total
export const RADAR_MIN_SECONDS = 3;     // 'confirm' finishes the radar step after this long
export const DONE_SECONDS = 2;
export const NO_PROGRESS_SECONDS = 20;
export const TARGET_MAX_DISTANCE = 900; // world units; a target further away respawns ahead
export const RESPAWN_INVULNERABLE_SECONDS = 3;

// Spawn requests (world units in front of / behind the ship's nose)
export const GREEN_TARGET = Object.freeze({ type: 'spawn', kind: 'green', size: 'medium', ahead: 220, drift: 0 });
export const RED_TARGET = Object.freeze({ type: 'spawn', kind: 'red', size: 'medium', ahead: 320, drift: 15 });
// The radar step puts a crystal behind the ship: its dot starts in the REAR circle
export const RADAR_TARGET = Object.freeze({ type: 'spawn', kind: 'green', size: 'medium', ahead: -260, drift: 0 });

export const STEPS3D = Object.freeze([
    { id: 'look', goal: LOOK_GOAL },
    { id: 'thrust', goal: THRUST_GOAL },
    { id: 'collect', goal: 1 },
    { id: 'shoot', goal: 1 },
    { id: 'radar', goal: 1 },
    { id: 'done', goal: DONE_SECONDS },
].map(Object.freeze));

export const STEP3D_IDS = Object.freeze(STEPS3D.map(s => s.id));
export const CONTROL_TYPES = Object.freeze(['direct', 'rate', 'joystick']);
export const INPUT_KINDS3D = Object.freeze(['touch', 'desktop', 'controller']);

/** Which wording to use. lastInputSource: 'keyboard' | 'mouse' | 'touch' | 'gamepad' | null. */
export function detectInputKind3d({ lastInputSource = null, isTouchDevice = false } = {}) {
    if (lastInputSource === 'gamepad') return 'controller';
    if (lastInputSource === 'keyboard' || lastInputSource === 'mouse') return 'desktop';
    if (lastInputSource === 'touch') return 'touch';
    return isTouchDevice ? 'touch' : 'desktop';
}

const TITLES = {
    look: 'Look around', thrust: 'Fly', collect: 'Collect GREEN', shoot: 'Shoot RED', radar: 'Radar', done: 'Well done!',
};

// Look texts: touch wording depends on the control type; desktop and controller don't
const LOOK_TOUCH = {
    direct: 'Move the phone: the ship turns exactly as you turn it',
    rate: 'Tilt the phone away from where you held it: the further, the faster you turn',
    joystick: 'Drag on the left half of the screen to turn',
};

const TEXTS = {
    look: {
        desktop: 'Move the mouse to look around (click first to capture it)',
        controller: 'Turn with the left stick, roll with the right stick',
    },
    thrust: {
        touch: 'Hold THRUST to fly forward',
        desktop: 'Hold W (or ↑) to fly forward',
        controller: 'Hold RT (or LT) to fly forward',
    },
    collect: {
        all: 'Turn toward the GREEN crystal and fly INTO it',
    },
    shoot: {
        touch: 'Point the crosshair at the RED rock and tap FIRE',
        desktop: 'Point the crosshair at the RED rock and press SPACE (or click)',
        controller: 'Point the crosshair at the RED rock and press Ⓐ or RB',
    },
    radar: {
        all: 'Radar: the top circle shows what is IN FRONT, the bottom one what is BEHIND. A crystal is behind you: turn until its dot is in the middle of the top circle',
    },
    done: {
        all: 'Training complete! Level 1…',
    },
};

const HIGHLIGHT = {
    look: { touch: { joystick: ['#p3-stick-zone'] } },
    thrust: { touch: ['#p3-thrust'] },
    shoot: { touch: ['#p3-fire'] },
    radar: { all: ['radar'] }, // the HUD draws the radar circles; 'radar' asks it to pulse them
};

export const SHOT_GREEN_MESSAGE = "Don't shoot green, fly into it!";

/**
 * { title, body, highlight } for a step, control type and input kind. highlight: CSS
 * selectors of DOM controls to pulse, or 'radar' for the HUD radar.
 */
export function tutorial3dText(stepId, { control = 'direct', input = 'touch' } = {}) {
    const entry = TEXTS[stepId];
    if (!entry) return { title: '', body: '', highlight: [] };
    const kind = INPUT_KINDS3D.includes(input) ? input : 'touch';
    const ctl = CONTROL_TYPES.includes(control) ? control : 'direct';
    let body;
    if (stepId === 'look' && kind === 'touch') body = LOOK_TOUCH[ctl];
    else body = entry.all || entry[kind];
    const h = HIGHLIGHT[stepId];
    let highlight = [];
    if (h) {
        const byKind = h.all || h[kind] || [];
        highlight = Array.isArray(byKind) ? byKind : (byKind[ctl] || []);
    }
    return { title: TITLES[stepId], body, highlight: [...highlight] };
}

export class Tutorial3d {
    constructor() {
        this.reset();
    }

    reset() {
        this.active = false;
        this.finished = false;
        this.skipped = false;
        this.stepIndex = 0;
        this.amount = 0;
        this.stepTime = 0;
        this.idleTime = 0;
        this.noProgress = false;
        this.control = 'direct';
        this.input = 'touch';
        this.message = null;
        this.totalTime = 0;
        this._requests = [];
    }

    get stepId() {
        return this.active || this.finished ? STEP3D_IDS[this.stepIndex] : null;
    }

    get done() {
        return this.finished;
    }

    get step() {
        return STEPS3D[this.stepIndex];
    }

    /** { index, count, value }: count excludes 'done'; value 0..1 through the current step. */
    get progress() {
        const step = this.step;
        return {
            index: this.stepIndex,
            count: STEPS3D.length - 1,
            value: step ? Math.min(1, this.amount / step.goal) : 1,
        };
    }

    get text() {
        return this.stepId ? tutorial3dText(this.stepId, { control: this.control, input: this.input }) : null;
    }

    _push(req) {
        this._requests.push(req);
    }

    /** Requests since the last call: step / spawn / message / hint / respawnPlayer / finish. */
    drainRequests() {
        const out = this._requests;
        this._requests = [];
        return out;
    }

    /** opts: { control, input } (the current control type and input kind). */
    start({ control, input } = {}) {
        this.reset();
        this._setContext(control, input);
        this.active = true;
        this._enterStep(0);
        return this.drainRequests();
    }

    _setContext(control, input) {
        if (CONTROL_TYPES.includes(control)) this.control = control;
        if (INPUT_KINDS3D.includes(input)) this.input = input;
    }

    _enterStep(index) {
        this.stepIndex = index;
        this.amount = 0;
        this.stepTime = 0;
        this.idleTime = 0;
        this.noProgress = false;
        const id = STEP3D_IDS[index];
        this._push({ type: 'step', stepId: id });
        if (id === 'collect') this._push({ ...GREEN_TARGET });
        if (id === 'shoot') this._push({ ...RED_TARGET });
        if (id === 'radar') this._push({ ...RADAR_TARGET });
    }

    _advance() {
        if (this.stepIndex < STEPS3D.length - 1) this._enterStep(this.stepIndex + 1);
    }

    _progressed(amount) {
        this.amount += amount;
        this.idleTime = 0;
        this.noProgress = false;
        if (this.amount >= this.step.goal - 1e-9) this._advance();
    }

    _targetFor(id) {
        if (id === 'collect') return GREEN_TARGET;
        if (id === 'shoot') return RED_TARGET;
        if (id === 'radar') return RADAR_TARGET;
        return null;
    }

    /**
     * Tell the tutorial what happened. Returns the requests this caused.
     *   looked { delta }    radians the ship turned this frame (any axis, sign ignored)
     *   thrusted { dt }     seconds of thrust this frame
     *   collectedGreen, destroyedRed, shotGreen, died { targetGone }, targetLost
     *   radarSeen           the tutorial crystal's dot reached the centre of the FRONT circle
     *   confirm             fire / tap (finishes the radar step after RADAR_MIN_SECONDS)
     */
    notify(event, data = {}) {
        if (!this.active) return [];
        const id = this.stepId;
        switch (event) {
            case 'looked':
                if (id === 'look') {
                    const d = Math.abs(Number(data.delta) || 0);
                    if (d > 0) this._progressed(d);
                }
                break;
            case 'thrusted':
                if (id === 'thrust') {
                    const dt = Math.max(0, Number(data.dt) || 0);
                    if (dt > 0) this._progressed(dt);
                }
                break;
            case 'collectedGreen':
                if (id === 'collect') this._progressed(1);
                // Collecting the radar crystal also proves the radar was read
                else if (id === 'radar') this._progressed(1);
                break;
            case 'destroyedRed':
                if (id === 'shoot') this._progressed(1);
                break;
            case 'radarSeen':
                if (id === 'radar') this._progressed(1);
                break;
            case 'shotGreen':
                this.message = { text: SHOT_GREEN_MESSAGE, time: 2.5 };
                this._push({ type: 'message', text: SHOT_GREEN_MESSAGE });
                if (id === 'collect' || id === 'radar') this._push({ ...this._targetFor(id) });
                break;
            case 'died':
                this._push({ type: 'respawnPlayer', invulnerableSeconds: RESPAWN_INVULNERABLE_SECONDS, loseLife: false });
                if (id === 'shoot' && data.targetGone) this._push({ ...RED_TARGET });
                break;
            case 'confirm':
                if (id === 'radar' && this.stepTime >= RADAR_MIN_SECONDS) this._progressed(1);
                break;
            case 'targetLost': {
                const t = this._targetFor(id);
                if (t) this._push({ ...t, replace: true });
                break;
            }
            default:
                break;
        }
        return this.drainRequests();
    }

    /** Per frame. opts: { control, input, targetDistance } (world units to the current target). */
    update(dt, { control, input, targetDistance } = {}) {
        this._setContext(control, input);
        if (!this.active) return this.drainRequests();
        dt = Math.max(0, Number(dt) || 0);
        this.stepTime += dt;
        this.totalTime += dt;
        if (this.message) {
            this.message.time -= dt;
            if (this.message.time <= 0) this.message = null;
        }
        const id = this.stepId;
        if (id === 'done') {
            this.amount = this.stepTime;
            if (this.stepTime >= DONE_SECONDS) this._finish(false);
        } else {
            const t = this._targetFor(id);
            if (t && Number.isFinite(targetDistance) && targetDistance > TARGET_MAX_DISTANCE) {
                this._push({ ...t, replace: true });
            }
            this.idleTime += dt;
            if (this.idleTime >= NO_PROGRESS_SECONDS) {
                this.noProgress = true;
                this.idleTime = 0;
                this._push({ type: 'hint', stepId: id, text: this.text.body });
            }
        }
        return this.drainRequests();
    }

    _finish(skipped) {
        this.active = false;
        this.finished = true;
        this.skipped = skipped;
        this.stepIndex = STEPS3D.length - 1;
        this._push({ type: 'finish', skipped });
    }

    /** Skip button, pause-menu item or controller View. Returns requests. */
    skip() {
        if (!this.active) return [];
        this._finish(true);
        return this.drainRequests();
    }

    snapshot() {
        return {
            active: this.active, finished: this.finished, skipped: this.skipped, step: this.stepId,
            control: this.control, input: this.input, progress: this.progress, noProgress: this.noProgress,
        };
    }
}

// --- Asking first (like 2D shouldAskTutorial / answerTutorialAsk / tutorial finish) ---

/** Ask before this user's first 3D game? settings: js/settings.js; persistence: PersistenceManager. */
export function shouldAskTutorial3d({ settings, persistence, user }) {
    if (!user || !persistence || !settings || !settings.get('offerTutorial')) return false;
    const rec = persistence.loadTutorial3dState(user);
    return !(rec && (rec.asked || rec.done));
}

/** The answer to "Play a short training?" (play: true = yes). */
export function recordTutorial3dAnswer({ persistence, user }, play) {
    if (!user || !persistence) return;
    persistence.saveTutorial3dState(user, { asked: true, done: false, skipped: !play, version: TUTORIAL3D_VERSION });
}

/** The tutorial finished (or was skipped part way). */
export function recordTutorial3dDone({ persistence, user }, skipped = false) {
    if (!user || !persistence) return;
    persistence.saveTutorial3dState(user, { asked: true, done: true, skipped, version: TUTORIAL3D_VERSION });
}
