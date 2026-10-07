import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

for (const m of ['log', 'warn', 'error']) console[m] = () => {};

class FakeStorage {
    constructor() { this.map = new Map(); }
    getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
    setItem(k, v) { this.map.set(k, String(v)); }
    removeItem(k) { this.map.delete(k); }
}
function installStorage(storage) {
    globalThis.window = { localStorage: storage };
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
}
let storage;
beforeEach(() => { storage = new FakeStorage(); installStorage(storage); });
installStorage(new FakeStorage());

const T = await import('../../js/3d/tutorial3d.js');
const { PersistenceManager } = await import('../../js/persistence.js');
const { createSettings } = await import('../../js/settings.js');
const { Tutorial3d, tutorial3dText, STEP3D_IDS } = T;

const types = (reqs) => reqs.map(r => r.type);

function runToStep(t, id) {
    while (t.stepId !== id) {
        switch (t.stepId) {
            case 'look': t.notify('looked', { delta: T.LOOK_GOAL }); break;
            case 'thrust': t.notify('thrusted', { dt: T.THRUST_GOAL }); break;
            case 'collect': t.notify('collectedGreen'); break;
            case 'shoot': t.notify('destroyedRed'); break;
            case 'radar': t.notify('radarSeen'); break;
            default: throw new Error(`stuck at ${t.stepId}`);
        }
    }
}

test('steps in order: look, thrust, collect, shoot, radar, done', () => {
    assert.deepEqual([...STEP3D_IDS], ['look', 'thrust', 'collect', 'shoot', 'radar', 'done']);
    const t = new Tutorial3d();
    assert.equal(t.stepId, null);
    const reqs = t.start({ control: 'rate', input: 'touch' });
    assert.deepEqual(reqs, [{ type: 'step', stepId: 'look' }]);
    assert.equal(t.control, 'rate');
    // Turning on any axis adds up (sign ignored)
    t.notify('looked', { delta: -0.5 });
    assert.equal(t.stepId, 'look');
    assert.ok(Math.abs(t.progress.value - 0.5 / T.LOOK_GOAL) < 1e-9);
    const r1 = t.notify('looked', { delta: T.LOOK_GOAL });
    assert.deepEqual(r1, [{ type: 'step', stepId: 'thrust' }]);
    t.notify('thrusted', { dt: 0.5 });
    const r2 = t.notify('thrusted', { dt: 0.5 });
    assert.equal(t.stepId, 'collect');
    assert.deepEqual(types(r2), ['step', 'spawn']);
    assert.equal(r2[1].kind, 'green');
    assert.ok(r2[1].ahead > 0);
    const r3 = t.notify('collectedGreen');
    assert.equal(t.stepId, 'shoot');
    assert.equal(r3[1].kind, 'red');
    const r4 = t.notify('destroyedRed');
    assert.equal(t.stepId, 'radar');
    assert.equal(r4[1].kind, 'green');
    assert.ok(r4[1].ahead < 0, 'the radar crystal starts behind the ship (rear circle)');
    t.notify('radarSeen');
    assert.equal(t.stepId, 'done');
    assert.deepEqual(t.update(1), []);
    assert.deepEqual(t.update(1.1), [{ type: 'finish', skipped: false }]);
    assert.equal(t.done, true);
    assert.equal(t.active, false);
});

test('events for other steps are ignored; nothing happens while inactive', () => {
    const t = new Tutorial3d();
    assert.deepEqual(t.notify('looked', { delta: 10 }), []);
    t.start();
    t.notify('destroyedRed');
    t.notify('collectedGreen');
    t.notify('radarSeen');
    t.notify('thrusted', { dt: 5 });
    assert.equal(t.stepId, 'look');
    t.notify('looked', { delta: 'x' });
    t.notify('looked', { delta: NaN });
    assert.equal(t.amount, 0);
});

test('radar step: collecting its crystal also counts; confirm only after a few seconds', () => {
    const t = new Tutorial3d();
    t.start();
    runToStep(t, 'radar');
    t.notify('confirm');
    assert.equal(t.stepId, 'radar', 'too early');
    t.update(T.RADAR_MIN_SECONDS);
    t.notify('confirm');
    assert.equal(t.stepId, 'done');
    const u = new Tutorial3d();
    u.start();
    runToStep(u, 'radar');
    u.notify('collectedGreen');
    assert.equal(u.stepId, 'done');
});

test('shooting a green: message and a new target; dying respawns without losing a life', () => {
    const t = new Tutorial3d();
    t.start();
    runToStep(t, 'collect');
    const r = t.notify('shotGreen');
    assert.deepEqual(types(r), ['message', 'spawn']);
    assert.equal(r[0].text, T.SHOT_GREEN_MESSAGE);
    assert.ok(t.message);
    t.update(3);
    assert.equal(t.message, null);
    runToStep(t, 'shoot');
    const d = t.notify('died', { targetGone: true });
    assert.deepEqual(d[0], { type: 'respawnPlayer', invulnerableSeconds: 3, loseLife: false });
    assert.equal(d[1].kind, 'red');
});

test('a target too far away (or lost) is replaced ahead', () => {
    const t = new Tutorial3d();
    t.start();
    runToStep(t, 'shoot');
    assert.deepEqual(t.update(0.1, { targetDistance: 100 }), []);
    const r = t.update(0.1, { targetDistance: T.TARGET_MAX_DISTANCE + 1 });
    assert.equal(r[0].kind, 'red');
    assert.equal(r[0].replace, true);
    const l = t.notify('targetLost');
    assert.equal(l[0].replace, true);
    runToStep(t, 'radar');
    assert.equal(t.notify('targetLost')[0].ahead, T.RADAR_TARGET.ahead);
});

test('no progress for 20 s: a hint with the current text and noProgress', () => {
    const t = new Tutorial3d();
    t.start({ control: 'joystick', input: 'touch' });
    assert.deepEqual(t.update(19), []);
    const r = t.update(1);
    assert.equal(r[0].type, 'hint');
    assert.equal(r[0].stepId, 'look');
    assert.match(r[0].text, /Drag/);
    assert.equal(t.noProgress, true);
    t.notify('looked', { delta: 0.1 });
    assert.equal(t.noProgress, false);
});

test('skip finishes at once; the snapshot reports it', () => {
    const t = new Tutorial3d();
    t.start();
    assert.deepEqual(t.skip(), [{ type: 'finish', skipped: true }]);
    assert.deepEqual(t.skip(), []);
    const s = t.snapshot();
    assert.equal(s.finished, true);
    assert.equal(s.skipped, true);
    assert.equal(s.step, 'done');
});

test('texts per control type and input kind', () => {
    const look = (control, input) => tutorial3dText('look', { control, input });
    assert.match(look('direct', 'touch').body, /Move the phone/);
    assert.match(look('rate', 'touch').body, /Tilt the phone/);
    assert.match(look('joystick', 'touch').body, /Drag/);
    assert.deepEqual(look('joystick', 'touch').highlight, ['#p3-stick-zone']);
    assert.deepEqual(look('direct', 'touch').highlight, []);
    assert.match(look('direct', 'desktop').body, /mouse/);
    assert.match(look('rate', 'controller').body, /left stick/);
    assert.deepEqual(tutorial3dText('thrust', { input: 'touch' }).highlight, ['#p3-thrust']);
    assert.match(tutorial3dText('thrust', { input: 'desktop' }).body, /W/);
    assert.match(tutorial3dText('shoot', { input: 'controller' }).body, /Ⓐ/);
    assert.deepEqual(tutorial3dText('shoot', { input: 'touch' }).highlight, ['#p3-fire']);
    assert.match(tutorial3dText('radar').body, /top circle/);
    assert.deepEqual(tutorial3dText('radar').highlight, ['radar']);
    assert.equal(tutorial3dText('radar').title, 'Radar');
    // Unknown values fall back
    assert.match(look('nope', 'nope').body, /Move the phone/);
    assert.deepEqual(tutorial3dText('nope'), { title: '', body: '', highlight: [] });
    for (const id of STEP3D_IDS) {
        for (const control of T.CONTROL_TYPES) {
            for (const input of T.INPUT_KINDS3D) {
                const x = tutorial3dText(id, { control, input });
                assert.ok(x.title && x.body, `${id} ${control} ${input}`);
            }
        }
    }
    // The live text follows update()'s context
    const t = new Tutorial3d();
    t.start({ control: 'direct', input: 'touch' });
    t.update(0.01, { input: 'desktop' });
    assert.match(t.text.body, /mouse/);
});

test('detectInputKind3d', () => {
    assert.equal(T.detectInputKind3d({ lastInputSource: 'gamepad' }), 'controller');
    assert.equal(T.detectInputKind3d({ lastInputSource: 'mouse', isTouchDevice: true }), 'desktop');
    assert.equal(T.detectInputKind3d({ lastInputSource: 'touch' }), 'touch');
    assert.equal(T.detectInputKind3d({ isTouchDevice: true }), 'touch');
    assert.equal(T.detectInputKind3d({}), 'desktop');
});

test('asks first: Offer tutorial on, a user, never asked about the 3D tutorial', () => {
    const persistence = new PersistenceManager();
    const settings = createSettings({ storage });
    const ctx = { settings, persistence, user: 'ann' };
    assert.equal(T.shouldAskTutorial3d(ctx), true);
    assert.equal(T.shouldAskTutorial3d({ ...ctx, user: null }), false);
    // The 2D tutorial record doesn't count for 3D
    persistence.saveTutorialState('ann', { asked: true, done: true });
    assert.equal(T.shouldAskTutorial3d(ctx), true);
    T.recordTutorial3dAnswer(ctx, false);
    assert.equal(T.shouldAskTutorial3d(ctx), false);
    assert.deepEqual(persistence.loadTutorial3dState('ann'), { asked: true, done: false, skipped: true, version: 1 });
    T.recordTutorial3dDone(ctx, false);
    assert.equal(persistence.loadTutorial3dState('ann').done, true);
    assert.ok(storage.map.has('asteroids_tutorial3d_ANN'));
    // Offer tutorial off: never asked
    settings.set('offerTutorial', false);
    assert.equal(T.shouldAskTutorial3d({ ...ctx, user: 'bob' }), false);
    // Reset Data clears the 3D record too
    persistence.resetUserData('ann');
    assert.equal(persistence.loadTutorial3dState('ann'), null);
    T.recordTutorial3dAnswer({ persistence, user: null }, true); // no user: nothing saved
});
