import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../js/3d/vendor/three.module.min.js';
import {
    deviceQuat, sensorQuatToWorld, createLook, stepLook, recentre, setMode, setLevelHorizon, lookAngles,
    directOrientation, directLevel, deflection, shapeAxis, rateFromDeflection, joystickRates, mouseDeltas,
    sensitivityFactor, yawPitchOfForward, PITCH_LIMIT, RATE_TUNING, CONTROL_MODES,
} from '../../js/3d/look.js';
import { DEG, qMul, qFromAxisAngle, qFromEulerYXZ, qAngle, qIdentity, forwardOf, upOf } from '../../js/3d/math3d.js';

const close = (a, b, eps = 1e-6, msg = '') => {
    if (Array.isArray(a)) a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < eps, `${msg} [${i}] ${a} vs ${b}`));
    else assert.ok(Math.abs(a - b) < eps, `${msg} ${a} vs ${b}`);
};
const sameRot = (a, b, eps = 1e-6, msg = "") => assert.ok(qAngle(a, b) < Math.max(eps, 1e-6), `${msg} angle ${qAngle(a, b)}`);

// Reference: three.js DeviceOrientationControls (removed from the examples in r134, PR 22654)
function threeReference(alpha, beta, gamma, orient) {
    const zee = new THREE.Vector3(0, 0, 1);
    const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(beta * DEG, alpha * DEG, -gamma * DEG, 'YXZ'));
    q.multiply(q1);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(zee, -orient * DEG));
    return [q.x, q.y, q.z, q.w];
}

test('deviceQuat matches the three.js DeviceOrientationControls formula (random poses, 4 screen angles)', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 400; i++) {
        const a = rnd() * 360, b = rnd() * 360 - 180, g = rnd() * 180 - 90;
        for (const s of [0, 90, -90, 180]) sameRot(deviceQuat(a, b, g, s), threeReference(a, b, g, s), 1e-6);
    }
});

test('deviceQuat known vectors: upright phone at each screen angle looks level with world up', () => {
    // portrait (0): beta 90; landscape top-left (90): gamma -90; landscape top-right (-90): gamma 90;
    // upside-down portrait (180): beta -90
    const cases = [
        { pose: [0, 90, 0, 0], fwd: [0, 0, -1] },
        { pose: [0, 0, -90, 90], fwd: [1, 0, 0] },
        { pose: [0, 0, 90, -90], fwd: [-1, 0, 0] },
        { pose: [0, 0, 90, 270], fwd: [-1, 0, 0] },
        { pose: [0, -90, 0, 180], fwd: [0, 0, 1] },
    ];
    for (const { pose, fwd } of cases) {
        const q = deviceQuat(...pose);
        close(forwardOf(q), fwd, 1e-9, `fwd ${pose}`);
        close(upOf(q), [0, 1, 0], 1e-9, `up ${pose}`);
    }
    // Flat on a table, screen up: the camera (out of the back) looks straight down
    close(forwardOf(deviceQuat(0, 0, 0, 0)), [0, -1, 0], 1e-9);
    // alpha +30 turns left
    close(forwardOf(deviceQuat(30, 90, 0, 0)), [-Math.sin(30 * DEG), 0, -Math.cos(30 * DEG)], 1e-9);
    // A landscape pose read with the wrong screen angle is upside down: compensation matters
    close(upOf(deviceQuat(0, 0, -90, -90)), [0, -1, 0], 1e-9);
});

test('sensorQuatToWorld: RelativeOrientationSensor identity (flat, screen up) looks down like deviceQuat', () => {
    sameRot(sensorQuatToWorld([0, 0, 0, 1]), deviceQuat(0, 0, 0, 0));
    // Upright portrait: rotate +90° about the device X axis in the Z-up world
    sameRot(sensorQuatToWorld(qFromAxisAngle([1, 0, 0], Math.PI / 2)), deviceQuat(0, 90, 0, 0));
});

const N = deviceQuat(20, 70, 10, 90); // some comfortable neutral pose

test('recentre makes the current pose the identity view (direct and joystick)', () => {
    for (const mode of ['direct', 'joystick']) {
        const look = createLook({ mode });
        stepLook(look, { device: N }, 1 / 60);
        look.q = qFromEulerYXZ(0.3, 0.5, 0.2);
        recentre(look, N);
        sameRot(look.q, qIdentity(), 1e-9, mode);
        stepLook(look, { device: N }, 1 / 60);
        sameRot(look.q, qIdentity(), 1e-9, mode);
        const a = lookAngles(look);
        close([a.yaw, a.pitch, a.roll], [0, 0, 0], 1e-6);
    }
});

test('first reading sets neutral: direct starts at identity', () => {
    const look = createLook({ mode: 'direct' });
    stepLook(look, { device: N });
    sameRot(look.q, qIdentity(), 1e-9);
});

test('direct follows the phone 1:1 on every axis including roll', () => {
    const look = createLook({ mode: 'direct' });
    stepLook(look, { device: N });
    for (const r of [qFromEulerYXZ(0.4, 0, 0), qFromEulerYXZ(0, -0.7, 0), qFromEulerYXZ(0, 0, 0.9), qFromEulerYXZ(0.2, 1.3, -0.5)]) {
        stepLook(look, { device: qMul(N, r) });
        sameRot(look.q, r, 1e-9);
    }
    const a = (stepLook(look, { device: qMul(N, qFromEulerYXZ(0, 0, 30 * DEG)) }), lookAngles(look));
    close(a.roll, 30, 1e-6);
    close(a.yaw, 0, 1e-6);
    // directOrientation helper with a base
    const base = qFromAxisAngle([0, 1, 0], 1);
    sameRot(directOrientation(N, qMul(N, qFromEulerYXZ(0, 0, 0.3)), base), qMul(base, qFromEulerYXZ(0, 0, 0.3)));
});

test('switching to direct keeps the current view (no jump)', () => {
    const look = createLook({ mode: 'joystick' });
    look.q = qFromEulerYXZ(0.2, 1.0, 0);
    const before = look.q.slice();
    setMode(look, 'direct', N);
    stepLook(look, { device: N });
    sameRot(look.q, before, 1e-9);
});

test('rate: tilt sets a rotation rate (dead zone, curve), integrated over time', () => {
    assert.equal(shapeAxis(3 * DEG), 0);
    assert.equal(shapeAxis(-3 * DEG), 0);
    close(shapeAxis(RATE_TUNING.full), 1);
    close(shapeAxis(-90 * DEG), -1);
    assert.ok(shapeAxis(10 * DEG) > 0 && shapeAxis(10 * DEG) < (10 - 4) / (35 - 4), 'curve is softer than linear');

    const look = createLook({ mode: 'rate' });
    stepLook(look, { device: N });
    // Inside the dead zone nothing moves
    for (let i = 0; i < 60; i++) stepLook(look, { device: qMul(N, qFromEulerYXZ(0, 3 * DEG, 0)) }, 1 / 60);
    sameRot(look.q, qIdentity(), 1e-9);
    // Full yaw tilt for 0.5 s turns left at the full rate
    const tilt = qMul(N, qFromEulerYXZ(0, 40 * DEG, 0));
    for (let i = 0; i < 30; i++) stepLook(look, { device: tilt }, 1 / 60);
    close(lookAngles(look).yaw, RATE_TUNING.maxPitchYaw / DEG * 0.5, 1e-6);
    close(lookAngles(look).pitch, 0, 1e-6);
    // Back to neutral: the heading stays
    stepLook(look, { device: N }, 1 / 60);
    const yaw = lookAngles(look).yaw;
    stepLook(look, { device: N }, 1);
    close(lookAngles(look).yaw, yaw, 1e-9);
    // Roll tilt rolls
    const r = rateFromDeflection(deflection(N, qMul(N, qFromEulerYXZ(0, 0, -20 * DEG))), 5);
    assert.ok(r.roll < 0 && r.yaw === 0 && r.pitch === 0);
    // Sensitivity scales rates
    assert.ok(sensitivityFactor(10) > sensitivityFactor(5) && sensitivityFactor(5) === 1);
});

test('rate: recentre zeroes the rates but keeps the heading', () => {
    const look = createLook({ mode: 'rate' });
    stepLook(look, { device: N });
    const tilt = qMul(N, qFromEulerYXZ(0, 20 * DEG, 0));
    for (let i = 0; i < 20; i++) stepLook(look, { device: tilt }, 1 / 60);
    const q = look.q.slice();
    recentre(look, tilt);
    stepLook(look, { device: tilt }, 1 / 60);
    sameRot(look.q, q, 1e-9);
});

test('joystick mapping: right turns right, up pulls the nose up, roll buttons roll', () => {
    const r = joystickRates(1, 0, 0);
    assert.ok(r.yaw < 0 && r.pitch === 0);
    assert.ok(joystickRates(0, -1, 0).pitch > 0);
    assert.ok(joystickRates(0, 0, 1).roll < 0, 'roll right');
    close(joystickRates(0.5, 0, 0).yaw, -Math.pow(0.5, 1.5) * joystickRates(1, 0, 0).yaw * -1, 1e-9);
    const look = createLook({ mode: 'joystick' });
    for (let i = 0; i < 30; i++) stepLook(look, { stickX: 1 }, 1 / 60);
    assert.ok(lookAngles(look).yaw < -10, 'turned right');
    const m = mouseDeltas(100, -50);
    assert.ok(m.yaw < 0 && m.pitch > 0);
    // joystick ignores the phone
    const look2 = createLook({ mode: 'joystick' });
    stepLook(look2, { device: N });
    stepLook(look2, { device: qMul(N, qFromEulerYXZ(0.5, 0.5, 0.5)) });
    sameRot(look2.q, qIdentity(), 1e-9);
});

test('level horizon removes roll and clamps pitch in every mode', () => {
    for (const mode of CONTROL_MODES) {
        const look = createLook({ mode, levelHorizon: true });
        stepLook(look, { device: N });
        const rolled = qMul(N, qFromEulerYXZ(1.5, 0.6, 0.8)); // big pitch + yaw + roll
        for (let i = 0; i < 240; i++) stepLook(look, { device: rolled, stickX: 0.4, stickY: -1, roll: 1 }, 1 / 60);
        const a = lookAngles(look);
        close(a.roll, 0, 1e-6, `${mode} roll`);
        assert.ok(Math.abs(a.pitch) <= PITCH_LIMIT / DEG + 1e-6, `${mode} pitch ${a.pitch}`);
        assert.ok(Math.abs(a.pitch) > 80, `${mode} pitch reaches the limit (${a.pitch})`);
        // No sideways tilt: the ship's right vector (forward x up) stays horizontal
        const rr = (q) => { const f = forwardOf(q), u = upOf(q); return [f[1] * u[2] - f[2] * u[1], f[2] * u[0] - f[0] * u[2], f[0] * u[1] - f[1] * u[0]]; };
        close(rr(look.q)[1], 0, 1e-6, `${mode} right vector horizontal`);
    }
});

test('level horizon in direct mode: heading and elevation follow the phone, roll ignored', () => {
    const look = createLook({ mode: 'direct', levelHorizon: true });
    const n = deviceQuat(0, 0, -90, 90); // upright landscape
    stepLook(look, { device: n });
    // Turn the body 30° left and tilt the phone 20° up, with some steering-wheel roll
    const d = qMul(qMul(qFromAxisAngle([0, 1, 0], 30 * DEG), n), qFromEulerYXZ(20 * DEG, 0, 25 * DEG));
    stepLook(look, { device: d });
    const a = lookAngles(look);
    close(a.roll, 0, 1e-6);
    const yp = yawPitchOfForward(d), yn = yawPitchOfForward(n);
    close(a.yaw, (yp.yaw - yn.yaw) / DEG, 1e-6);
    close(a.pitch, (yp.pitch - yn.pitch) / DEG, 1e-6);
    const lv = directLevel(n, d);
    close(lv.yaw, yp.yaw - yn.yaw, 1e-9);
    // Turning the level horizon off and on keeps the heading (roll snaps to 0 only)
    setLevelHorizon(look, false, d);
    stepLook(look, { device: d });
    close(lookAngles(look).yaw, a.yaw, 1e-6);
    setLevelHorizon(look, true, d);
    stepLook(look, { device: d });
    close(lookAngles(look).yaw, a.yaw, 1e-6);
});

test('switching level horizon on in rate mode keeps the heading and drops roll', () => {
    const look = createLook({ mode: 'rate' });
    look.q = qFromEulerYXZ(0.3, 1.2, 0.7);
    setLevelHorizon(look, true);
    const a = lookAngles(look);
    close(a.roll, 0, 1e-9);
    close(forwardOf(look.q), forwardOf(qFromEulerYXZ(0.3, 1.2, 0.7)), 0.25);
});

test('invert up/down flips stick and mouse pitch; the Turn Speed upgrade scales Joystick and Rate, not Direct', async () => {
    const L = await import('../../js/3d/look.js');
    const up = L.createLook({ mode: 'joystick' });
    L.stepLook(up, { stickY: -1 }, 0.1);
    const inv = L.createLook({ mode: 'joystick', invert: true });
    L.stepLook(inv, { stickY: -1 }, 0.1);
    assert.ok(up.rates.pitch > 0 && Math.abs(inv.rates.pitch + up.rates.pitch) < 1e-9);
    const m = L.createLook({ mode: 'joystick', invert: true });
    L.stepLook(m, { mouseDY: -10 }, 0.1);
    assert.ok(L.lookAngles(m).pitch < 0, 'mouse up looks down when inverted');
    const plain = L.createLook({ mode: 'joystick' });
    L.stepLook(plain, { stickX: 1 }, 0.1);
    const fast = L.createLook({ mode: 'joystick', turnRateMult: 1.3 });
    L.stepLook(fast, { stickX: 1 }, 0.1);
    assert.ok(Math.abs(fast.rates.yaw / plain.rates.yaw - 1.3) < 1e-9);
    // Direct follows the phone 1:1 whatever the upgrade
    const N = L.deviceQuat(0, 90, 0, 0);
    const D = L.deviceQuat(30, 90, 0, 0);
    const d1 = L.createLook({ mode: 'direct' });
    const d2 = L.createLook({ mode: 'direct', turnRateMult: 1.5 });
    for (const d of [d1, d2]) { L.stepLook(d, { device: N }, 0.016); L.stepLook(d, { device: D }, 0.016); }
    assert.deepEqual(d1.q.map((v) => v.toFixed(9)), d2.q.map((v) => v.toFixed(9)));
});
