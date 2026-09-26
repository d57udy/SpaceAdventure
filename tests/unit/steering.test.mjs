import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    angleDiff,
    applyJoystickSteering,
    JOYSTICK_DEADZONE,
    JOYSTICK_THRUST_START,
    JOYSTICK_MAX_THRUST_ANGLE,
} from '../../js/steering.js';

const EPS = 1e-9;
const close = (actual, expected, msg, eps = EPS) =>
    assert.ok(Math.abs(actual - expected) < eps, `${msg ?? ''} expected ${expected}, got ${actual}`);

// Fake ship: turns at 2*PI rad/s (like the real rotate(dir, dt)) and records thrust calls
function makeShip(rotation = 0) {
    return {
        rotation,
        rotateCalls: [],
        thrustCalls: [],
        rotate(dir, dt) { this.rotateCalls.push([dir, dt]); this.rotation += dir * 2 * Math.PI * dt; },
        thrust(dt) { this.thrustCalls.push(dt); },
    };
}

const stick = (angle, magnitude, active = true) => ({ active, angle, magnitude });
// Angular distance between two headings, ignoring full turns
const heading = (a, b) => Math.abs(angleDiff(a, b));

// --- constants ---------------------------------------------------------------

test('constants are sane', () => {
    assert.ok(JOYSTICK_DEADZONE > 0 && JOYSTICK_DEADZONE < JOYSTICK_THRUST_START);
    assert.ok(JOYSTICK_THRUST_START < 1);
    close(JOYSTICK_MAX_THRUST_ANGLE, Math.PI / 2);
});

// --- angleDiff ---------------------------------------------------------------

test('angleDiff: simple signed differences', () => {
    close(angleDiff(0, 1), 1);
    close(angleDiff(1, 0), -1);
    close(angleDiff(0, 0), 0);
    close(angleDiff(0.5, 0.5), 0);
});

test('angleDiff: wraps across the ±PI seam the short way', () => {
    close(angleDiff(3, -3), 2 * Math.PI - 6); // ~ +0.283
    assert.ok(angleDiff(3, -3) > 0.28 && angleDiff(3, -3) < 0.29);
    close(angleDiff(-3, 3), -(2 * Math.PI - 6));
});

test('angleDiff: result always within (-PI, PI], full turns ignored', () => {
    close(angleDiff(0, 2 * Math.PI), 0);
    close(angleDiff(0, 4 * Math.PI + 0.1), 0.1);
    close(angleDiff(10 * Math.PI, 0.2), 0.2, undefined, 1e-9);
    for (let a = -10; a <= 10; a += 0.37) {
        for (let b = -10; b <= 10; b += 0.53) {
            const d = angleDiff(a, b);
            assert.ok(d > -Math.PI - EPS && d <= Math.PI + EPS, `angleDiff(${a}, ${b}) = ${d}`);
            // adding d to a lands on b (mod 2PI)
            close(Math.cos(a + d), Math.cos(b), undefined, 1e-9);
            close(Math.sin(a + d), Math.sin(b), undefined, 1e-9);
        }
    }
});

test('angleDiff: exactly opposite is +PI (upper bound inclusive)', () => {
    close(Math.abs(angleDiff(0, Math.PI)), Math.PI);
    assert.ok(angleDiff(0, Math.PI) > 0);
});

// --- applyJoystickSteering: inactive / deadzone ------------------------------

test('no stick, inactive stick or magnitude below deadzone does nothing', () => {
    for (const s of [null, undefined, stick(1, 1, false), stick(1, JOYSTICK_DEADZONE - 0.01), stick(1, 0)]) {
        const ship = makeShip(0);
        assert.equal(applyJoystickSteering(ship, s, 0.016, 0.016), false);
        assert.equal(ship.rotation, 0);
        assert.equal(ship.rotateCalls.length, 0);
        assert.equal(ship.thrustCalls.length, 0);
    }
});

test('magnitude exactly at the deadzone steers (deadzone is exclusive below)', () => {
    const ship = makeShip(0);
    applyJoystickSteering(ship, stick(1, JOYSTICK_DEADZONE), 0.016, 0.016);
    assert.ok(ship.rotation > 0);
});

// --- rotation ---------------------------------------------------------------

test('rotates clockwise (positive) toward a target at a positive angle', () => {
    const ship = makeShip(0);
    applyJoystickSteering(ship, stick(1, 0.3), 0.01, 0.01);
    close(ship.rotation, 2 * Math.PI * 0.01);
    assert.deepEqual(ship.rotateCalls, [[1, 0.01]]);
});

test('rotates counter-clockwise (negative) toward a target at a negative angle', () => {
    const ship = makeShip(0);
    applyJoystickSteering(ship, stick(-1, 0.3), 0.01, 0.01);
    close(ship.rotation, -2 * Math.PI * 0.01);
    assert.deepEqual(ship.rotateCalls, [[-1, 0.01]]);
});

test('takes the shortest direction across the ±PI seam', () => {
    // Facing 3 rad, stick at -3 rad: shortest is +0.283 (increase rotation)
    const cw = makeShip(3);
    applyJoystickSteering(cw, stick(-3, 0.3), 0.01, 0.01);
    assert.ok(cw.rotation > 3, `expected increase, got ${cw.rotation}`);
    // Facing -3 rad, stick at 3 rad: shortest is -0.283 (decrease rotation)
    const ccw = makeShip(-3);
    applyJoystickSteering(ccw, stick(3, 0.3), 0.01, 0.01);
    assert.ok(ccw.rotation < -3, `expected decrease, got ${ccw.rotation}`);
});

test('uses turnTime (not deltaTime) for the rotation step', () => {
    const ship = makeShip(0);
    applyJoystickSteering(ship, stick(2, 0.3), 0.5, 0.02);
    assert.deepEqual(ship.rotateCalls, [[1, 0.02]]);
    close(ship.rotation, 2 * Math.PI * 0.02);
});

test('never overshoots: a large step snaps exactly to the target', () => {
    const ship = makeShip(0);
    applyJoystickSteering(ship, stick(0.3, 0.3), 1, 1);
    close(ship.rotation, 0.3);

    const neg = makeShip(0.5);
    applyJoystickSteering(neg, stick(-0.2, 0.3), 1, 1);
    close(neg.rotation, -0.2);
});

test('never overshoots across the seam: lands on the target heading', () => {
    const ship = makeShip(3);
    applyJoystickSteering(ship, stick(-3, 0.3), 1, 1);
    close(heading(ship.rotation, -3), 0);
    close(ship.rotation, 3 + (2 * Math.PI - 6)); // stays continuous, not wrapped
});

test('step exactly equal to the remaining angle lands on the target', () => {
    const ship = makeShip(0);
    const dt = 0.05;
    const target = 2 * Math.PI * dt;
    applyJoystickSteering(ship, stick(target, 0.3), dt, dt);
    close(ship.rotation, target);
});

test('already aligned: no rotation', () => {
    const ship = makeShip(1.2);
    applyJoystickSteering(ship, stick(1.2, 0.3), 0.016, 0.016);
    close(ship.rotation, 1.2);
});

test('repeated small steps converge on the target without oscillating', () => {
    const ship = makeShip(0);
    const target = 2.5;
    let prevDist = Infinity;
    for (let i = 0; i < 200; i++) {
        applyJoystickSteering(ship, stick(target, 0.3), 0.016, 0.016);
        const dist = heading(ship.rotation, target);
        assert.ok(dist <= prevDist + EPS, 'distance must never grow');
        prevDist = dist;
    }
    close(heading(ship.rotation, target), 0);
});

// --- thrust -----------------------------------------------------------------

test('no thrust when magnitude <= JOYSTICK_THRUST_START (even when aligned)', () => {
    for (const m of [JOYSTICK_DEADZONE, 0.3, JOYSTICK_THRUST_START]) {
        const ship = makeShip(0);
        assert.equal(applyJoystickSteering(ship, stick(0, m), 0.016, 0.016), false, `m=${m}`);
        assert.equal(ship.thrustCalls.length, 0);
    }
});

test('no thrust while facing more than 90° away from the stick', () => {
    // Facing 0, stick behind (PI) with a tiny turn step: still ~180° away
    const ship = makeShip(0);
    assert.equal(applyJoystickSteering(ship, stick(Math.PI, 1), 0.016, 0.001), false);
    assert.equal(ship.thrustCalls.length, 0);
    // Just over 90° after the turn step
    const side = makeShip(0);
    assert.equal(applyJoystickSteering(side, stick(Math.PI / 2 + 0.2, 1), 0.016, 0.001), false);
    assert.equal(side.thrustCalls.length, 0);
});

test('thrusts once the turn step brings the ship within 90°', () => {
    // 100° away but a turn step of 0.05s (18°) brings it to 82°
    const ship = makeShip(0);
    const target = (100 * Math.PI) / 180;
    assert.equal(applyJoystickSteering(ship, stick(target, 1), 0.016, 0.05), true);
    assert.equal(ship.thrustCalls.length, 1);
});

test('thrusts when aligned; strength scales with magnitude', () => {
    const dt = 0.02;
    const full = makeShip(0);
    assert.equal(applyJoystickSteering(full, stick(0, 1), dt, dt), true);
    close(full.thrustCalls[0], dt);

    const low = makeShip(0);
    assert.equal(applyJoystickSteering(low, stick(0, JOYSTICK_THRUST_START + 1e-6), dt, dt), true);
    close(low.thrustCalls[0], 0.4 * dt, undefined, 1e-7);

    const mid = makeShip(0);
    const m = (JOYSTICK_THRUST_START + 1) / 2; // strength 0.5
    applyJoystickSteering(mid, stick(0, m), dt, dt);
    close(mid.thrustCalls[0], 0.7 * dt);

    // monotonic in magnitude
    let prev = 0;
    for (let mag = JOYSTICK_THRUST_START + 0.01; mag <= 1; mag += 0.05) {
        const s = makeShip(0);
        applyJoystickSteering(s, stick(0, mag), dt, dt);
        assert.ok(s.thrustCalls[0] > prev);
        prev = s.thrustCalls[0];
    }
});

test('thrustScale is passed through to thrust()', () => {
    const dt = 0.02;
    const ship = makeShip(0);
    applyJoystickSteering(ship, stick(0, 1), dt, dt, 0.5);
    close(ship.thrustCalls[0], dt * 0.5);

    const low = makeShip(0);
    applyJoystickSteering(low, stick(0, JOYSTICK_THRUST_START + 1e-6), dt, dt, 3);
    close(low.thrustCalls[0], 0.4 * dt * 3, undefined, 1e-7);
});

test('thrust uses deltaTime (not turnTime)', () => {
    const ship = makeShip(0);
    applyJoystickSteering(ship, stick(0, 1), 0.1, 0.001);
    close(ship.thrustCalls[0], 0.1);
});

test('return value: true only when it thrusted', () => {
    assert.equal(applyJoystickSteering(makeShip(0), stick(0, 1), 0.016, 0.016), true);
    assert.equal(applyJoystickSteering(makeShip(0), stick(0, 0.3), 0.016, 0.016), false);
    assert.equal(applyJoystickSteering(makeShip(0), stick(Math.PI, 1), 0.016, 0.001), false);
    assert.equal(applyJoystickSteering(makeShip(0), stick(0, 1, false), 0.016, 0.016), false);
});
