// Look / steering models for the 3D prototype (docs/plans/06-3d-mode.md §1 and §8). Pure, DOM-free.
//
// Three control types (owner decision §8.1), all ending in one ship orientation quaternion
// (the ship is the camera, its nose points where you look):
//   direct    the phone's physical orientation IS the ship's orientation, all axes including
//             roll, 1:1, relative to a calibrated neutral pose (Recentre / double-tap / start)
//   rate      tilting the phone away from the neutral pose sets the rotation RATE about each
//             axis (pitch, yaw, roll), with a dead zone and a response curve
//   joystick  an on-screen stick (and mouse / keys / controller) sets pitch and yaw rates,
//             roll comes from two roll buttons (Q/E or A/D on a keyboard)
// Level horizon (all three): roll is blocked, "up" stays the world's up, pitch is limited to
// ±85°, yaw is free. Internally the ship then keeps yaw / pitch angles instead of a free
// quaternion, so it can never drift into a roll.
//
// Device pose: the deviceorientation angles become a quaternion with the three.js
// DeviceOrientationControls formula (compensating screen.orientation.angle), so the camera
// frame is the screen: looking out of the back of the phone, +Y towards the top of the
// screen as it is currently displayed. Only the RELATIVE rotation from the neutral pose is
// used, so the compass heading never matters.

import {
    DEG, clamp, wrapAngle, qIdentity, qMul, qConj, qNorm, qFromAxisAngle, qFromEulerYXZ,
    qToYawPitchRoll, qLocalDelta, forwardOf,
} from './math3d.js';

export const CONTROL_MODES = Object.freeze(['direct', 'rate', 'joystick']);
export const PITCH_LIMIT = 85 * DEG;

// Rate mode: tilt → rotation rate
export const RATE_TUNING = Object.freeze({
    dead: 4 * DEG,        // no rotation within ±4° of neutral
    full: 35 * DEG,       // full rate at 35° of tilt
    expo: 1.6,            // response curve (1 = linear; higher = finer control near neutral)
    maxPitchYaw: 100 * DEG, // rad/s at full tilt, sensitivity 5
    maxRoll: 140 * DEG,
});

// Joystick / controller: stick deflection (-1..1) → rotation rate
export const STICK_TUNING = Object.freeze({
    expo: 1.5,
    maxPitchYaw: 110 * DEG,
    maxRoll: 150 * DEG,
    mouseRadPerPx: 0.0022, // pointer-lock mouse: radians per pixel at sensitivity 5
});

/** Sensitivity setting 1..10 → multiplier (5 → 1.0). */
export function sensitivityFactor(s) {
    const n = Number.isFinite(s) ? clamp(s, 1, 10) : 5;
    return 0.4 + 0.12 * n;
}

// --- device pose ---------------------------------------------------------------------------

const Q_X_MINUS_90 = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]; // camera looks out of the back of the device

/**
 * deviceorientation alpha/beta/gamma (degrees) + screen orientation angle (degrees, 0, 90,
 * -90/270 or 180) → camera quaternion in a Y-up world. Same as three.js
 * DeviceOrientationControls: euler(beta, alpha, -gamma, 'YXZ') ⊗ Rx(-90°) ⊗ Rz(-screen).
 */
export function deviceQuat(alpha, beta, gamma, screenAngleDeg = 0) {
    const e = qFromEulerYXZ((beta || 0) * DEG, (alpha || 0) * DEG, -(gamma || 0) * DEG);
    const q = qMul(e, Q_X_MINUS_90);
    return qNorm(qMul(q, qFromAxisAngle([0, 0, 1], -(screenAngleDeg || 0) * DEG)));
}

/**
 * RelativeOrientationSensor quaternion ([x, y, z, w], referenceFrame 'screen', world Z up)
 * → the same Y-up camera quaternion as deviceQuat(): rotate the world by -90° about X.
 */
export function sensorQuatToWorld(sq) {
    return qNorm(qMul(Q_X_MINUS_90, sq));
}

/** Heading / elevation of a quaternion's forward axis (gravity based, ignores roll). */
export function yawPitchOfForward(q) {
    const f = forwardOf(q);
    return { yaw: Math.atan2(-f[0], -f[2]), pitch: Math.asin(clamp(f[1], -1, 1)) };
}

/** Rotation from the neutral pose to the current pose, in the neutral pose's own frame. */
export const relativeTo = (neutral, device) => qNorm(qMul(qConj(neutral), device));

/** Direct mode, free: base ⊗ (neutral⁻¹ ⊗ device). */
export function directOrientation(neutral, device, base = qIdentity()) {
    return qNorm(qMul(base, relativeTo(neutral, device)));
}

/** Direct mode, level horizon: heading and elevation change 1:1 with the phone's; no roll. */
export function directLevel(neutral, device, baseYaw = 0, basePitch = 0) {
    const n = yawPitchOfForward(neutral);
    const d = yawPitchOfForward(device);
    return {
        yaw: wrapAngle(baseYaw + d.yaw - n.yaw),
        pitch: clamp(basePitch + d.pitch - n.pitch, -PITCH_LIMIT, PITCH_LIMIT),
    };
}

/** Tilt of the phone away from neutral as pitch / yaw / roll angles (radians, neutral frame). */
export function deflection(neutral, device) {
    return qToYawPitchRoll(relativeTo(neutral, device));
}

/** Dead zone + response curve for one axis: angle (radians) → -1..1. */
export function shapeAxis(angle, { dead = RATE_TUNING.dead, full = RATE_TUNING.full, expo = RATE_TUNING.expo } = {}) {
    const a = Math.abs(angle);
    if (!(a > dead)) return 0;
    const t = Math.min(1, (a - dead) / Math.max(1e-6, full - dead));
    return Math.sign(angle) * Math.pow(t, expo);
}

/** Rate mode: tilt from neutral → { pitch, yaw, roll } rates in rad/s (same sense as the tilt). */
export function rateFromDeflection(defl, sensitivity = 5) {
    const k = sensitivityFactor(sensitivity);
    return {
        pitch: shapeAxis(defl.pitch) * RATE_TUNING.maxPitchYaw * k,
        yaw: shapeAxis(defl.yaw) * RATE_TUNING.maxPitchYaw * k,
        roll: shapeAxis(defl.roll) * RATE_TUNING.maxRoll * k,
    };
}

const curve = (v, expo) => Math.sign(v) * Math.pow(Math.min(1, Math.abs(v)), expo);

/**
 * Joystick: stick x (right +) / y (down +, like the screen) and roll input (-1 left .. +1
 * right) → rates in rad/s. Stick right turns right, stick up pulls the nose up.
 */
export function joystickRates(x, y, roll = 0, sensitivity = 5) {
    const k = sensitivityFactor(sensitivity);
    return {
        pitch: -curve(y || 0, STICK_TUNING.expo) * STICK_TUNING.maxPitchYaw * k,
        yaw: -curve(x || 0, STICK_TUNING.expo) * STICK_TUNING.maxPitchYaw * k,
        roll: -clamp(roll || 0, -1, 1) * STICK_TUNING.maxRoll * k,
    };
}

/** Pointer-lock mouse movement (pixels) → angle deltas (radians). Mouse up looks up. */
export function mouseDeltas(dx, dy, sensitivity = 5) {
    const k = STICK_TUNING.mouseRadPerPx * sensitivityFactor(sensitivity);
    return { pitch: -(dy || 0) * k, yaw: -(dx || 0) * k };
}

// --- look state ----------------------------------------------------------------------------

/**
 * @param {object} [o]
 * @param {'direct'|'rate'|'joystick'} [o.mode]
 * @param {boolean} [o.levelHorizon]
 * @param {number} [o.sensitivity] 1..10
 */
export function createLook({ mode = 'direct', levelHorizon = false, sensitivity = 5 } = {}) {
    return {
        mode: CONTROL_MODES.includes(mode) ? mode : 'direct',
        level: !!levelHorizon,
        sensitivity,
        q: qIdentity(),
        yaw: 0, pitch: 0,          // used while level horizon is on
        neutral: null,             // device quaternion of the neutral pose
        base: qIdentity(),         // direct mode: ship orientation at the neutral pose
        baseYaw: 0, basePitch: 0,  // direct mode with level horizon
        rates: { pitch: 0, yaw: 0, roll: 0 }, // last applied rates (HUD / tests)
    };
}

function syncLevelAngles(look) {
    const { yaw, pitch } = yawPitchOfForward(look.q);
    look.yaw = yaw;
    look.pitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
    look.q = qFromEulerYXZ(look.pitch, look.yaw, 0);
}

/** Direct mode: keep the current view and continue from the current phone pose (no jump). */
function anchor(look, device) {
    if (device) look.neutral = device.slice();
    look.base = look.q.slice();
    const yp = yawPitchOfForward(look.q);
    look.baseYaw = yp.yaw;
    look.basePitch = clamp(yp.pitch, -PITCH_LIMIT, PITCH_LIMIT);
}

/**
 * Recentre: the current phone pose becomes neutral. Direct and Joystick also straighten
 * the view to "forward" (identity); Rate keeps the heading (the tilt rates go to zero).
 */
export function recentre(look, device) {
    if (device) look.neutral = device.slice();
    if (look.mode !== 'rate') {
        look.q = qIdentity();
        look.base = qIdentity();
        look.yaw = look.pitch = look.baseYaw = look.basePitch = 0;
    }
    look.rates = { pitch: 0, yaw: 0, roll: 0 };
}

/**
 * First reading after a start without one (the grace period): it becomes the neutral pose.
 * Direct keeps the current view (no jump), Rate starts with zero tilt. No-op once calibrated.
 */
export function calibrate(look, device) {
    if (!device || look.neutral) return;
    if (look.mode === 'direct') anchor(look, device);
    else look.neutral = device.slice();
}

export function setMode(look, mode, device) {
    if (!CONTROL_MODES.includes(mode) || mode === look.mode) return;
    look.mode = mode;
    if (mode === 'direct') anchor(look, device);
    else if (mode === 'rate' && device) look.neutral = device.slice();
}

export function setLevelHorizon(look, on, device) {
    look.level = !!on;
    if (look.level) syncLevelAngles(look);
    if (look.mode === 'direct') anchor(look, device || look.neutral);
}

/** Apply local angle deltas (radians) to the free or level orientation. */
function applyDeltas(look, dPitch, dYaw, dRoll) {
    if (look.level) {
        look.yaw = wrapAngle(look.yaw + dYaw);
        look.pitch = clamp(look.pitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT);
        look.q = qFromEulerYXZ(look.pitch, look.yaw, 0);
    } else if (dPitch || dYaw || dRoll) {
        look.q = qNorm(qMul(look.q, qLocalDelta(dPitch, dYaw, dRoll)));
    }
}

/**
 * Advance the look state by dt seconds.
 * @param {object} look - from createLook()
 * @param {object} input
 * @param {number[]|null} [input.device] - current device quaternion (deviceQuat), null if none
 * @param {number} [input.stickX] [input.stickY] - on-screen joystick / controller left stick, -1..1
 * @param {number} [input.roll] - -1 (roll left) .. +1 (roll right), buttons / keys / right stick
 * @param {number} [input.mouseDX] [input.mouseDY] - pointer-lock pixels since the last step
 * @param {number} dt - seconds
 */
export function stepLook(look, input = {}, dt = 1 / 60) {
    const device = input.device || null;
    if (device && !look.neutral) recentre(look, device); // first reading sets the neutral pose
    const m = mouseDeltas(input.mouseDX, input.mouseDY, look.sensitivity);
    // Manual inputs work in every mode (joystick, controller, keys, mouse)
    const manual = joystickRates(input.stickX, input.stickY, input.roll, look.sensitivity);

    if (look.mode === 'direct' && device && look.neutral) {
        // Manual input nudges the base orientation; the phone then drives it 1:1
        if (look.level) {
            look.baseYaw = wrapAngle(look.baseYaw + manual.yaw * dt + m.yaw);
            look.basePitch = clamp(look.basePitch + manual.pitch * dt + m.pitch, -PITCH_LIMIT, PITCH_LIMIT);
            const a = directLevel(look.neutral, device, look.baseYaw, look.basePitch);
            look.yaw = a.yaw;
            look.pitch = a.pitch;
            look.q = qFromEulerYXZ(a.pitch, a.yaw, 0);
        } else {
            const d = qLocalDelta(manual.pitch * dt + m.pitch, manual.yaw * dt + m.yaw, manual.roll * dt);
            look.base = qNorm(qMul(look.base, d));
            look.q = directOrientation(look.neutral, device, look.base);
        }
        look.rates = manual;
        return look;
    }

    let rates = manual;
    if (look.mode === 'rate' && device && look.neutral) {
        const r = rateFromDeflection(deflection(look.neutral, device), look.sensitivity);
        rates = { pitch: r.pitch + manual.pitch, yaw: r.yaw + manual.yaw, roll: r.roll + manual.roll };
    }
    look.rates = rates;
    applyDeltas(look, rates.pitch * dt + m.pitch, rates.yaw * dt + m.yaw, look.level ? 0 : rates.roll * dt);
    return look;
}

/** Yaw / pitch / roll in degrees of the current ship orientation (HUD, test hook). */
export function lookAngles(look) {
    const e = qToYawPitchRoll(look.q);
    return { yaw: e.yaw / DEG, pitch: e.pitch / DEG, roll: e.roll / DEG };
}
