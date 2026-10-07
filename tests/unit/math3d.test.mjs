import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../js/3d/vendor/three.module.min.js';
import {
    DEG, wrapAngle, qIdentity, qMul, qConj, qNorm, qFromAxisAngle, qRotate, qFromEulerYXZ, qToYawPitchRoll,
    forwardOf, upOf, rightOf, qSlerp, qAngle, qLocalDelta, vCross, vNorm, vLen,
} from '../../js/3d/math3d.js';

const close = (a, b, eps = 1e-9, msg) => {
    if (Array.isArray(a)) a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < eps, `${msg || ''} [${i}] ${v} vs ${b[i]} (${a} vs ${b})`));
    else assert.ok(Math.abs(a - b) < eps, `${msg || ''} ${a} vs ${b}`);
};
const sameRot = (a, b, eps = 1e-9) => close(qAngle(a, b), 0, 1e-6);

test('identity, conjugate and multiplication', () => {
    const q = qFromAxisAngle([1, 2, 3], 0.7);
    sameRot(qMul(q, qIdentity()), q);
    sameRot(qMul(q, qConj(q)), qIdentity());
    close(qRotate(qMul(qConj(q), q), [1, 0, 0]), [1, 0, 0]);
});

test('axis-angle rotations match the right-hand rule', () => {
    close(qRotate(qFromAxisAngle([0, 1, 0], Math.PI / 2), [0, 0, -1]), [-1, 0, 0]); // yaw +90: nose left
    close(qRotate(qFromAxisAngle([1, 0, 0], Math.PI / 2), [0, 0, -1]), [0, 1, 0]);  // pitch +90: nose up
    close(qRotate(qFromAxisAngle([0, 0, 1], Math.PI / 2), [0, 1, 0]), [-1, 0, 0]);  // roll +90: up to the left
});

test('qMul applies the right operand first (matches three.js)', () => {
    const a = qFromAxisAngle([0, 1, 0], 0.4), b = qFromAxisAngle([1, 0, 0], 0.9);
    const ta = new THREE.Quaternion(...a), tb = new THREE.Quaternion(...b);
    const t = ta.clone().multiply(tb);
    close(qMul(a, b), [t.x, t.y, t.z, t.w]);
    const v = new THREE.Vector3(0.3, -0.2, 0.9).applyQuaternion(t);
    close(qRotate(qMul(a, b), [0.3, -0.2, 0.9]), [v.x, v.y, v.z]);
});

test("Euler 'YXZ' round trip and agreement with three.js", () => {
    for (const [p, y, r] of [[0.1, 0.2, 0.3], [-1.2, 2.9, -0.4], [1.4, -3, 2.5], [0, 0, 0]]) {
        const q = qFromEulerYXZ(p, y, r);
        const t = new THREE.Quaternion().setFromEuler(new THREE.Euler(p, y, r, 'YXZ'));
        close(q, [t.x, t.y, t.z, t.w]);
        const e = qToYawPitchRoll(q);
        sameRot(qFromEulerYXZ(e.pitch, e.yaw, e.roll), q);
        close([e.pitch, e.yaw, e.roll], [p, y, r], 1e-9);
    }
});

test('forward / up / right of the identity are -Z / +Y / +X', () => {
    close(forwardOf(qIdentity()), [0, 0, -1]);
    close(upOf(qIdentity()), [0, 1, 0]);
    close(rightOf(qIdentity()), [1, 0, 0]);
    const q = qFromEulerYXZ(0.3, 1.1, -0.6);
    close(vCross(rightOf(q), upOf(q)), vScaleNeg(forwardOf(q)));
});
const vScaleNeg = (v) => v.map((x) => -x);

test('slerp ends, midpoint and angle', () => {
    const a = qIdentity(), b = qFromAxisAngle([0, 1, 0], 1);
    sameRot(qSlerp(a, b, 0), a);
    sameRot(qSlerp(a, b, 1), b);
    sameRot(qSlerp(a, b, 0.5), qFromAxisAngle([0, 1, 0], 0.5));
    close(qAngle(a, b), 1, 1e-9);
});

test('local delta: pitch, yaw and roll in the ship frame', () => {
    const q = qFromAxisAngle([0, 1, 0], Math.PI / 2); // facing -X
    const up = qMul(q, qLocalDelta(Math.PI / 2, 0, 0)); // pitch up in the ship frame
    close(forwardOf(up), [0, 1, 0]);
    sameRot(qLocalDelta(0, 0, 0), qIdentity());
    close(vLen(qNorm(qLocalDelta(0.1, 0.2, 0.3)).slice(0, 3)) > 0 ? 1 : 0, 1);
});

test('wrapAngle', () => {
    close(wrapAngle(3 * Math.PI / 2), -Math.PI / 2);
    close(wrapAngle(-3 * Math.PI / 2), Math.PI / 2);
    close(wrapAngle(0.5), 0.5);
    assert.ok(DEG > 0 && vNorm([0, 0, 0]).every((v) => v === 0));
});
