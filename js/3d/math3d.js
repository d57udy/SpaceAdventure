// 3D maths for the cockpit prototype (docs/plans/06-3d-mode.md §3). Pure, DOM-free, no three.js.
//
// Conventions (the same as three.js, so render3d.js can copy values straight across):
//   vectors     [x, y, z]            right-handed, +Y up
//   quaternions [x, y, z, w]         unit length, q ⊗ v rotates a vector from the ship frame
//                                    into the world frame
//   ship/camera frame                looks along -Z, up is +Y, right is +X
//   Euler angles 'YXZ'               yaw about Y, then pitch about X, then roll about Z (radians)
//                                    yaw > 0 turns left, pitch > 0 looks up, roll > 0 banks left

export const DEG = Math.PI / 180;
export const EPS = 1e-9;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Angle wrapped into [-PI, PI). */
export function wrapAngle(a) {
    const t = (a + Math.PI) % (2 * Math.PI);
    return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
}

// --- vectors -------------------------------------------------------------------------------

export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const vAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vScale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const vAddScaled = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const vDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vCross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];
export const vLen = (a) => Math.hypot(a[0], a[1], a[2]);
export const vLenSq = (a) => a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
export function vNorm(a) {
    const l = vLen(a);
    return l < EPS ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
}

// --- quaternions ---------------------------------------------------------------------------

export const qIdentity = () => [0, 0, 0, 1];

export function qNorm(q) {
    const l = Math.hypot(q[0], q[1], q[2], q[3]);
    return l < EPS ? [0, 0, 0, 1] : [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** Hamilton product a ⊗ b (apply b first, then a). */
export function qMul(a, b) {
    const [ax, ay, az, aw] = a;
    const [bx, by, bz, bw] = b;
    return [
        ax * bw + aw * bx + ay * bz - az * by,
        ay * bw + aw * by + az * bx - ax * bz,
        az * bw + aw * bz + ax * by - ay * bx,
        aw * bw - ax * bx - ay * by - az * bz,
    ];
}

/** Inverse of a unit quaternion (the conjugate). */
export const qConj = (q) => [-q[0], -q[1], -q[2], q[3]];

export function qFromAxisAngle(axis, angle) {
    const n = vNorm(axis);
    const s = Math.sin(angle / 2);
    return [n[0] * s, n[1] * s, n[2] * s, Math.cos(angle / 2)];
}

/** Rotate vector v by unit quaternion q. */
export function qRotate(q, v) {
    const [qx, qy, qz, qw] = q;
    const [x, y, z] = v;
    // t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);
    return [
        x + qw * tx + (qy * tz - qz * ty),
        y + qw * ty + (qz * tx - qx * tz),
        z + qw * tz + (qx * ty - qy * tx),
    ];
}

/** Quaternion from Euler angles in 'YXZ' order (the same as three.js setFromEuler with 'YXZ'). */
export function qFromEulerYXZ(pitch, yaw, roll) {
    const c1 = Math.cos(pitch / 2), s1 = Math.sin(pitch / 2);
    const c2 = Math.cos(yaw / 2), s2 = Math.sin(yaw / 2);
    const c3 = Math.cos(roll / 2), s3 = Math.sin(roll / 2);
    return [
        s1 * c2 * c3 + c1 * s2 * s3,
        c1 * s2 * c3 - s1 * c2 * s3,
        c1 * c2 * s3 - s1 * s2 * c3,
        c1 * c2 * c3 + s1 * s2 * s3,
    ];
}

/** Yaw / pitch / roll (radians, 'YXZ') of a unit quaternion. Pitch in [-PI/2, PI/2]. */
export function qToYawPitchRoll(q) {
    const [x, y, z, w] = q;
    // Rotation matrix elements needed for 'YXZ' (see three.js Euler.setFromRotationMatrix)
    const m13 = 2 * (x * z + w * y);
    const m22 = 1 - 2 * (x * x + z * z);
    const m23 = 2 * (y * z - w * x);
    const m33 = 1 - 2 * (x * x + y * y);
    const m21 = 2 * (x * y + w * z);
    const m11 = 1 - 2 * (y * y + z * z);
    const m31 = 2 * (x * z - w * y);
    const pitch = Math.asin(clamp(-m23, -1, 1));
    let yaw, roll;
    if (Math.abs(m23) < 0.9999999) {
        yaw = Math.atan2(m13, m33);
        roll = Math.atan2(m21, m22);
    } else {
        yaw = Math.atan2(-m31, m11);
        roll = 0;
    }
    return { yaw, pitch, roll };
}

export const forwardOf = (q) => qRotate(q, [0, 0, -1]);
export const upOf = (q) => qRotate(q, [0, 1, 0]);
export const rightOf = (q) => qRotate(q, [1, 0, 0]);

/** Spherical interpolation between unit quaternions. */
export function qSlerp(a, b, t) {
    let [bx, by, bz, bw] = b;
    let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
    if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    if (cos > 0.9995) {
        return qNorm([
            a[0] + (bx - a[0]) * t, a[1] + (by - a[1]) * t,
            a[2] + (bz - a[2]) * t, a[3] + (bw - a[3]) * t,
        ]);
    }
    const th = Math.acos(cos);
    const s = Math.sin(th);
    const wa = Math.sin((1 - t) * th) / s;
    const wb = Math.sin(t * th) / s;
    return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}

/** Angle (radians, 0..PI) of the rotation between two unit quaternions. */
export function qAngle(a, b) {
    const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
    return 2 * Math.acos(clamp(d, 0, 1));
}

/**
 * Small rotation in the ship's own frame (radians): pitch about +X (nose up), yaw about +Y
 * (nose left), roll about +Z (bank left). Post-multiply: qNext = q ⊗ qLocalDelta(...).
 */
export function qLocalDelta(dPitch, dYaw, dRoll) {
    const rx = dPitch, ry = dYaw, rz = dRoll;
    const angle = Math.hypot(rx, ry, rz);
    if (angle < EPS) return [0, 0, 0, 1];
    return qFromAxisAngle([rx / angle, ry / angle, rz / angle], angle);
}
