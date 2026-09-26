import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    Tutorial, STEPS, STEP_IDS, INPUT_KINDS, TUTORIAL_VERSION, TUTORIAL_EVENTS, tutorialText, detectInputKind,
    NO_PROGRESS_SECONDS, TARGET_MAX_DISTANCE, SHOT_GREEN_MESSAGE, GREEN_TARGET, RED_TARGET,
} from '../../js/tutorial.js';

const spawns = (reqs, kind) => reqs.filter(r => r.type === 'spawn' && (!kind || r.kind === kind));

function started() {
    const t = new Tutorial();
    const reqs = t.start();
    return { t, reqs };
}

// Drive the tutorial to a given step using the proper events.
function advanceTo(t, stepId) {
    const script = {
        steer: () => t.notify('rotated', { delta: Math.PI }),
        thrust: () => t.notify('thrusted', { dt: 1 }),
        collect: () => { t.notify('collectedGreen'); t.notify('collectedGreen'); },
        shoot: () => t.notify('destroyedRed'),
        avoid: () => t.notify('confirm'),
    };
    while (t.stepId !== stepId) script[t.stepId]();
}

test('constants and step order', () => {
    assert.equal(typeof TUTORIAL_VERSION, 'number');
    assert.deepEqual(STEP_IDS, ['steer', 'thrust', 'collect', 'shoot', 'avoid', 'done']);
    assert.equal(STEPS.length, 6);
    assert.deepEqual(INPUT_KINDS, ['keyboard', 'joystick', 'buttons', 'gamepad']);
    for (const e of ['rotated', 'thrusted', 'collectedGreen', 'destroyedRed', 'shotGreen', 'died', 'confirm']) {
        assert.ok(TUTORIAL_EVENTS.includes(e));
    }
});

test('start begins at steer and is active', () => {
    const t = new Tutorial();
    assert.equal(t.active, false);
    assert.equal(t.stepId, null);
    const reqs = t.start();
    assert.equal(t.active, true);
    assert.equal(t.finished, false);
    assert.equal(t.stepId, 'steer');
    assert.deepEqual(reqs, [{ type: 'step', stepId: 'steer' }]);
    assert.deepEqual(t.progress, { index: 0, count: 5, value: 0 });
});

test('each step advances only on its own event', () => {
    const others = {
        steer: [['thrusted', { dt: 5 }], ['collectedGreen'], ['destroyedRed'], ['confirm']],
        thrust: [['rotated', { delta: 10 }], ['collectedGreen'], ['destroyedRed'], ['confirm']],
        collect: [['rotated', { delta: 10 }], ['thrusted', { dt: 5 }], ['destroyedRed'], ['confirm'], ['shotGreen']],
        shoot: [['rotated', { delta: 10 }], ['thrusted', { dt: 5 }], ['collectedGreen'], ['confirm'], ['shotGreen']],
        avoid: [['rotated', { delta: 10 }], ['thrusted', { dt: 5 }], ['collectedGreen'], ['destroyedRed']],
    };
    for (const [stepId, events] of Object.entries(others)) {
        const { t } = started();
        advanceTo(t, stepId);
        for (const [e, d] of events) t.notify(e, d);
        assert.equal(t.stepId, stepId, `${stepId} must not advance on other events`);
    }
});

test('steer: rotation totals use absolute changes (wiggling counts)', () => {
    const { t } = started();
    for (let i = 0; i < 7; i++) t.notify('rotated', { delta: i % 2 ? -0.2 : 0.2 });
    assert.equal(t.stepId, 'steer');
    assert.ok(Math.abs(t.progress.value - 1.4 / (Math.PI / 2)) < 1e-9);
    t.notify('rotated', { delta: -0.2 }); // 1.6 rad > 90 degrees
    assert.equal(t.stepId, 'thrust');
});

test('thrust accumulates to 0.6 s', () => {
    const { t } = started();
    advanceTo(t, 'thrust');
    for (let i = 0; i < 5; i++) t.notify('thrusted', { dt: 0.1 });
    assert.equal(t.stepId, 'thrust');
    t.notify('thrusted', { dt: 0.1 });
    assert.equal(t.stepId, 'collect');
});

test('collect: spawns a green ahead, needs two, respawns one between', () => {
    const { t } = started();
    advanceTo(t, 'thrust');
    const reqs = t.notify('thrusted', { dt: 1 });
    assert.deepEqual(spawns(reqs), [{ ...GREEN_TARGET }]);
    assert.equal(GREEN_TARGET.distanceAhead, 180);
    assert.equal(GREEN_TARGET.size, 'medium');
    let r = t.notify('collectedGreen');
    assert.equal(t.stepId, 'collect');
    assert.equal(spawns(r, 'green').length, 1, 'next green appears');
    r = t.notify('collectedGreen');
    assert.equal(t.stepId, 'shoot');
    assert.equal(spawns(r, 'green').length, 0);
    assert.deepEqual(spawns(r, 'red'), [{ ...RED_TARGET }]);
    assert.equal(RED_TARGET.distanceAhead, 260);
    assert.equal(RED_TARGET.size, 'small');
    assert.ok(RED_TARGET.drift > 0, 'red drifts slowly sideways');
});

test('shooting a green shows the hint and spawns a new one', () => {
    const { t } = started();
    advanceTo(t, 'collect');
    const r = t.notify('shotGreen');
    assert.equal(t.stepId, 'collect');
    assert.ok(r.some(x => x.type === 'message' && x.text === SHOT_GREEN_MESSAGE));
    assert.equal(spawns(r, 'green').length, 1);
    assert.equal(t.message.text, SHOT_GREEN_MESSAGE);
    t.update(3);
    assert.equal(t.message, null, 'hint times out');
});

test('dying requests an immediate respawn with invulnerability and no life lost', () => {
    const { t } = started();
    advanceTo(t, 'shoot');
    const r = t.notify('died');
    assert.deepEqual(r.find(x => x.type === 'respawnPlayer'), { type: 'respawnPlayer', invulnerableSeconds: 3, loseLife: false });
    assert.equal(t.stepId, 'shoot');
});

test('avoid: advances after 5 s or on confirm; done finishes after 2 s', () => {
    let { t } = started();
    advanceTo(t, 'avoid');
    t.update(4.9);
    assert.equal(t.stepId, 'avoid');
    t.update(0.2);
    assert.equal(t.stepId, 'done');
    t.update(1.9);
    assert.equal(t.finished, false);
    const r = t.update(0.2);
    assert.equal(t.finished, true);
    assert.equal(t.active, false);
    assert.equal(t.skipped, false);
    assert.deepEqual(r.filter(x => x.type === 'finish'), [{ type: 'finish', skipped: false }]);

    ({ t } = started());
    advanceTo(t, 'avoid');
    t.notify('confirm');
    assert.equal(t.stepId, 'done');
});

test('full run-through emits the steps in order', () => {
    const { t } = started();
    const seen = ['steer'];
    const collect = reqs => reqs.filter(r => r.type === 'step').forEach(r => seen.push(r.stepId));
    collect(t.notify('rotated', { delta: 2 }));
    collect(t.notify('thrusted', { dt: 0.7 }));
    collect(t.notify('collectedGreen'));
    collect(t.notify('collectedGreen'));
    collect(t.notify('destroyedRed'));
    collect(t.update(5));
    collect(t.update(2));
    assert.deepEqual(seen, STEP_IDS);
    assert.equal(t.finished, true);
});

test('skip finishes immediately', () => {
    const { t } = started();
    advanceTo(t, 'collect');
    const r = t.skip();
    assert.equal(t.finished, true);
    assert.equal(t.skipped, true);
    assert.equal(t.active, false);
    assert.deepEqual(r, [{ type: 'finish', skipped: true }]);
    assert.deepEqual(t.skip(), [], 'second skip is a no-op');
    assert.deepEqual(t.notify('collectedGreen'), [], 'events ignored after finishing');
});

test('20 s without progress flags a prominent Skip and repeats the hint', () => {
    const { t } = started();
    t.update(10, { inputKind: 'gamepad' });
    assert.equal(t.noProgress, false);
    const r = t.update(NO_PROGRESS_SECONDS - 10 + 0.01);
    assert.equal(t.noProgress, true);
    const hint = r.find(x => x.type === 'hint');
    assert.equal(hint.stepId, 'steer');
    assert.equal(hint.text, tutorialText('steer', 'gamepad').body);
    t.notify('rotated', { delta: 0.1 });
    assert.equal(t.noProgress, false, 'progress clears the flag');
});

test('progress resets the no-progress timer', () => {
    const { t } = started();
    for (let i = 0; i < 5; i++) {
        t.update(15);
        t.notify('rotated', { delta: 0.05 });
    }
    assert.equal(t.noProgress, false);
});

test('a target drifting too far away respawns ahead', () => {
    const { t } = started();
    advanceTo(t, 'collect');
    let r = t.update(0.016, { targetDistance: TARGET_MAX_DISTANCE - 1 });
    assert.equal(spawns(r).length, 0);
    r = t.update(0.016, { targetDistance: TARGET_MAX_DISTANCE + 50 });
    assert.deepEqual(spawns(r), [{ ...GREEN_TARGET, replace: true }]);
    advanceTo(t, 'shoot');
    r = t.notify('targetLost');
    assert.deepEqual(spawns(r), [{ ...RED_TARGET, replace: true }]);
});

test('update records the input kind and ignores unknown kinds', () => {
    const { t } = started();
    t.update(0.1, { inputKind: 'buttons' });
    assert.equal(t.inputKind, 'buttons');
    t.update(0.1, { inputKind: 'telepathy' });
    assert.equal(t.inputKind, 'buttons');
    assert.equal(t.text.body, tutorialText('steer', 'buttons').body);
});

test('every step x input kind has non-empty text and the right highlight', () => {
    const expectHighlight = {
        steer: { keyboard: [], joystick: ['#joystick-base'], buttons: ['#touch-left-btn', '#touch-right-btn'], gamepad: [] },
        thrust: { keyboard: [], joystick: ['#joystick-base'], buttons: ['#touch-thrust-btn'], gamepad: [] },
        collect: { keyboard: [], joystick: [], buttons: [], gamepad: [] },
        shoot: { keyboard: [], joystick: ['#touch-fire-btn'], buttons: ['#touch-fire-btn'], gamepad: [] },
        avoid: { keyboard: [], joystick: ['#touch-hyper-btn'], buttons: ['#touch-hyper-btn'], gamepad: [] },
        done: { keyboard: [], joystick: [], buttons: [], gamepad: [] },
    };
    for (const step of STEP_IDS) {
        for (const kind of INPUT_KINDS) {
            const x = tutorialText(step, kind);
            assert.ok(x.title.length > 0, `${step}/${kind} title`);
            assert.ok(x.body.length > 0, `${step}/${kind} body`);
            assert.deepEqual(x.highlight, expectHighlight[step][kind], `${step}/${kind} highlight`);
        }
    }
});

test('texts match the device', () => {
    assert.match(tutorialText('steer', 'keyboard').body, /←|A \/ D/);
    assert.match(tutorialText('steer', 'joystick').body, /Drag/);
    assert.match(tutorialText('steer', 'gamepad').body, /stick/);
    assert.match(tutorialText('shoot', 'keyboard').body, /SPACE/);
    assert.match(tutorialText('shoot', 'gamepad').body, /Ⓐ|RT/);
    assert.match(tutorialText('avoid', 'keyboard').body, /H = hyperspace/);
    assert.match(tutorialText('avoid', 'gamepad').body, /Ⓑ/);
    assert.match(tutorialText('collect', 'buttons').body, /GREEN/);
    assert.match(tutorialText('done', 'keyboard').body, /Level 1/);
    // unknown step / kind
    assert.deepEqual(tutorialText('nope', 'keyboard'), { title: '', body: '', highlight: [] });
    assert.equal(tutorialText('steer', 'weird').body, tutorialText('steer', 'keyboard').body);
    // returned highlight arrays are copies
    tutorialText('steer', 'buttons').highlight.push('#x');
    assert.equal(tutorialText('steer', 'buttons').highlight.length, 2);
});

test('detectInputKind covers all combinations', () => {
    const sources = [null, undefined, 'keyboard', 'mouse', 'touch', 'gamepad', 'other'];
    for (const src of sources) {
        for (const isTouchDevice of [false, true]) {
            for (const controlMode of ['joystick', 'buttons', undefined]) {
                const k = detectInputKind({ lastInputSource: src, isTouchDevice, controlMode });
                let expected;
                const touchKind = controlMode === 'buttons' ? 'buttons' : 'joystick';
                if (src === 'gamepad') expected = 'gamepad';
                else if (src === 'keyboard' || src === 'mouse') expected = 'keyboard';
                else if (src === 'touch') expected = touchKind;
                else expected = isTouchDevice ? touchKind : 'keyboard';
                assert.equal(k, expected, JSON.stringify({ src, isTouchDevice, controlMode }));
                assert.ok(INPUT_KINDS.includes(k));
            }
        }
    }
    assert.equal(detectInputKind(), 'keyboard');
});

test('restart resets everything', () => {
    const { t } = started();
    advanceTo(t, 'shoot');
    t.skip();
    t.start();
    assert.equal(t.stepId, 'steer');
    assert.equal(t.finished, false);
    assert.equal(t.skipped, false);
    assert.equal(t.progress.value, 0);
});

test('bad event data is ignored safely', () => {
    const { t } = started();
    t.notify('rotated', {});
    t.notify('rotated', { delta: 'x' });
    t.notify('rotated');
    t.notify('unknownEvent');
    t.update(NaN);
    assert.equal(t.stepId, 'steer');
    assert.equal(t.progress.value, 0);
});

test('snapshot for the test hook', () => {
    const { t } = started();
    t.update(0.1, { inputKind: 'joystick' });
    const s = t.snapshot();
    assert.equal(s.active, true);
    assert.equal(s.step, 'steer');
    assert.equal(s.inputKind, 'joystick');
    assert.equal(s.finished, false);
});
