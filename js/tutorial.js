// First-game tutorial ("Training" wave). DOM-free: the game notifies events, calls
// update(dt) each frame, and acts on the requests returned (spawns, respawns, finish).

export const TUTORIAL_VERSION = 1;

export const TUTORIAL_EVENTS = Object.freeze([
    'rotated', 'thrusted', 'collectedGreen', 'destroyedRed', 'shotGreen', 'died', 'confirm', 'targetLost',
]);

export const STEER_GOAL = Math.PI / 2; // radians of total (absolute) turning
export const THRUST_GOAL = 0.6; // seconds of thrust in total
export const COLLECT_GOAL = 2;
export const AVOID_SECONDS = 5;
export const DONE_SECONDS = 2;
export const NO_PROGRESS_SECONDS = 20;
export const TARGET_MAX_DISTANCE = 600; // px; a target further away respawns ahead
export const RESPAWN_INVULNERABLE_SECONDS = 3;

export const GREEN_TARGET = Object.freeze({ type: 'spawn', kind: 'green', size: 'medium', distanceAhead: 180, drift: 0 });
export const RED_TARGET = Object.freeze({ type: 'spawn', kind: 'red', size: 'small', distanceAhead: 260, drift: 25 });

export const STEPS = Object.freeze([
    { id: 'steer', goal: STEER_GOAL },
    { id: 'thrust', goal: THRUST_GOAL },
    { id: 'collect', goal: COLLECT_GOAL },
    { id: 'shoot', goal: 1 },
    { id: 'avoid', goal: AVOID_SECONDS },
    { id: 'done', goal: DONE_SECONDS },
].map(Object.freeze));

export const STEP_IDS = Object.freeze(STEPS.map(s => s.id));
export const INPUT_KINDS = Object.freeze(['keyboard', 'joystick', 'buttons', 'gamepad']);

// Which input wording to use. lastInputSource: 'keyboard' | 'mouse' | 'touch' | 'gamepad' | null.
export function detectInputKind({ lastInputSource = null, isTouchDevice = false, controlMode = 'joystick' } = {}) {
    const touchKind = controlMode === 'buttons' ? 'buttons' : 'joystick';
    switch (lastInputSource) {
        case 'gamepad': return 'gamepad';
        case 'keyboard':
        case 'mouse': return 'keyboard';
        case 'touch': return touchKind;
        default: return isTouchDevice ? touchKind : 'keyboard';
    }
}

const SEL = {
    stick: '#joystick-base',
    left: '#touch-left-btn',
    right: '#touch-right-btn',
    thrust: '#touch-thrust-btn',
    fire: '#touch-fire-btn',
    hyper: '#touch-hyper-btn',
};

const TITLES = {
    steer: 'Steer', thrust: 'Fly', collect: 'Collect GREEN', shoot: 'Shoot RED', avoid: 'Stay safe', done: 'Well done!',
};

const TEXTS = {
    steer: {
        keyboard: ['Turn with ← → (or A / D)', []],
        joystick: ['Drag anywhere on the left half to steer', [SEL.stick]],
        buttons: ['Use the arrow buttons to turn', [SEL.left, SEL.right]],
        gamepad: ['Tilt the left stick to steer', []],
    },
    thrust: {
        keyboard: ['Hold ↑ (or W) to fly', []],
        joystick: ['Drag further out to fly: past the dashed ring = thrust', [SEL.stick]],
        buttons: ['Hold ▲ to fly', [SEL.thrust]],
        gamepad: ['Push the stick all the way to fly', []],
    },
    collect: {
        all: ['Fly INTO the GREEN asteroid to collect it', []],
    },
    shoot: {
        keyboard: ['Press SPACE to shoot the RED one', []],
        joystick: ['Tap the red button to shoot RED', [SEL.fire]],
        buttons: ['Tap the red button to shoot RED', [SEL.fire]],
        gamepad: ['Press Ⓐ or RT to shoot RED', []],
    },
    avoid: {
        keyboard: ['Never touch RED or UFO shots. Emergency: H = hyperspace (risky)', []],
        joystick: ['Never touch RED or UFO shots. Emergency: ✱ button = hyperspace (risky)', [SEL.hyper]],
        buttons: ['Never touch RED or UFO shots. Emergency: ✱ button = hyperspace (risky)', [SEL.hyper]],
        gamepad: ['Never touch RED or UFO shots. Emergency: Ⓑ = hyperspace (risky)', []],
    },
    done: {
        all: ['Training complete! Level 1…', []],
    },
};

export const SHOT_GREEN_MESSAGE = "Don't shoot green, fly into it!";

// { title, body, highlight: [CSS selectors to pulse] } for a step and input kind.
export function tutorialText(stepId, inputKind = 'keyboard') {
    const entry = TEXTS[stepId];
    if (!entry) return { title: '', body: '', highlight: [] };
    const kind = INPUT_KINDS.includes(inputKind) ? inputKind : 'keyboard';
    const [body, highlight] = entry.all || entry[kind];
    return { title: TITLES[stepId], body, highlight: [...highlight] };
}

export class Tutorial {
    constructor() {
        this.reset();
    }

    reset() {
        this.active = false;
        this.finished = false;
        this.skipped = false;
        this.stepIndex = 0;
        this.amount = 0; // progress within the current step, in the step's units
        this.stepTime = 0; // seconds in the current step
        this.idleTime = 0; // seconds since the last progress
        this.noProgress = false; // true after NO_PROGRESS_SECONDS: make Skip prominent, repeat hint
        this.inputKind = 'keyboard';
        this.message = null; // { text, time } transient hint (e.g. shot a green)
        this.totalTime = 0;
        this._requests = [];
    }

    get stepId() {
        return this.active || this.finished ? STEP_IDS[this.stepIndex] : null;
    }

    get step() {
        return STEPS[this.stepIndex];
    }

    // { index, count, value } where count is the number of real steps (dots, excluding
    // 'done') and value is 0..1 through the current step.
    get progress() {
        const step = this.step;
        return {
            index: this.stepIndex,
            count: STEPS.length - 1,
            value: step ? Math.min(1, this.amount / step.goal) : 1,
        };
    }

    get text() {
        return this.stepId ? tutorialText(this.stepId, this.inputKind) : null;
    }

    _push(req) {
        this._requests.push(req);
    }

    // Requests queued since the last call: spawn / respawnPlayer / message / hint / finish.
    drainRequests() {
        const out = this._requests;
        this._requests = [];
        return out;
    }

    start() {
        this.reset();
        this.active = true;
        this._enterStep(0);
        return this.drainRequests();
    }

    _enterStep(index) {
        this.stepIndex = index;
        this.amount = 0;
        this.stepTime = 0;
        this.idleTime = 0;
        this.noProgress = false;
        const id = STEP_IDS[index];
        this._push({ type: 'step', stepId: id });
        if (id === 'collect') this._push({ ...GREEN_TARGET });
        if (id === 'shoot') this._push({ ...RED_TARGET });
    }

    _advance() {
        if (this.stepIndex < STEPS.length - 1) this._enterStep(this.stepIndex + 1);
    }

    _progressed(amount) {
        this.amount += amount;
        this.idleTime = 0;
        this.noProgress = false;
        if (this.amount >= this.step.goal - 1e-9) this._advance();
    }

    // Tell the tutorial what happened. Returns the requests this caused.
    //   rotated { delta }       radians turned this frame (sign ignored)
    //   thrusted { dt }         seconds of thrust this frame
    //   collectedGreen, destroyedRed, shotGreen, died, confirm (fire/select), targetLost
    notify(event, data = {}) {
        if (!this.active) return [];
        const id = this.stepId;
        switch (event) {
            case 'rotated':
                if (id === 'steer') {
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
                if (id === 'collect') {
                    this._progressed(1);
                    if (this.stepId === 'collect') this._push({ ...GREEN_TARGET });
                }
                break;
            case 'destroyedRed':
                if (id === 'shoot') this._progressed(1);
                break;
            case 'shotGreen':
                this.message = { text: SHOT_GREEN_MESSAGE, time: 2.5 };
                this._push({ type: 'message', text: SHOT_GREEN_MESSAGE });
                if (id === 'collect') this._push({ ...GREEN_TARGET });
                break;
            case 'died':
                this._push({ type: 'respawnPlayer', invulnerableSeconds: RESPAWN_INVULNERABLE_SECONDS, loseLife: false });
                if (id === 'shoot' && data.targetGone) this._push({ ...RED_TARGET });
                break;
            case 'confirm':
                if (id === 'avoid') this._advance();
                break;
            case 'targetLost':
                // The game reports a target further than TARGET_MAX_DISTANCE (or destroyed off-step)
                if (id === 'collect') this._push({ ...GREEN_TARGET, replace: true });
                if (id === 'shoot') this._push({ ...RED_TARGET, replace: true });
                break;
            default:
                break;
        }
        return this.drainRequests();
    }

    // Per frame. opts: { inputKind, targetDistance } (distance of the current target, px).
    update(dt, { inputKind, targetDistance } = {}) {
        if (inputKind && INPUT_KINDS.includes(inputKind)) this.inputKind = inputKind;
        if (!this.active) return this.drainRequests();
        dt = Math.max(0, Number(dt) || 0);
        this.stepTime += dt;
        this.totalTime += dt;
        if (this.message) {
            this.message.time -= dt;
            if (this.message.time <= 0) this.message = null;
        }
        const id = this.stepId;
        if (id === 'avoid') {
            this.amount = this.stepTime;
            if (this.stepTime >= AVOID_SECONDS) this._advance();
        } else if (id === 'done') {
            this.amount = this.stepTime;
            if (this.stepTime >= DONE_SECONDS) this._finish(false);
        } else {
            if (Number.isFinite(targetDistance) && targetDistance > TARGET_MAX_DISTANCE &&
                (id === 'collect' || id === 'shoot')) {
                this._push({ ...(id === 'collect' ? GREEN_TARGET : RED_TARGET), replace: true });
            }
            this.idleTime += dt;
            if (this.idleTime >= NO_PROGRESS_SECONDS) {
                this.noProgress = true;
                this.idleTime = 0;
                this._push({ type: 'hint', stepId: id, text: tutorialText(id, this.inputKind).body });
            }
        }
        return this.drainRequests();
    }

    _finish(skipped) {
        this.active = false;
        this.finished = true;
        this.skipped = skipped;
        this.stepIndex = STEPS.length - 1;
        this._push({ type: 'finish', skipped });
    }

    // Skip button, T, controller View, or the pause-menu item. Returns requests.
    skip() {
        if (!this.active) return [];
        this._finish(true);
        return this.drainRequests();
    }

    // Snapshot for the test hook.
    snapshot() {
        return {
            active: this.active, finished: this.finished, skipped: this.skipped,
            step: this.stepId, inputKind: this.inputKind, progress: this.progress, noProgress: this.noProgress,
        };
    }
}
