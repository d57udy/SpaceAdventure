// Phone motion input for the 3D prototype: permission, screen angle and the latest device
// pose as a quaternion (look.js does the maths). Browser objects are injected (window), so
// the module can be loaded in Node; nothing happens until start() is called.
//
// - deviceorientation (all phones). It is the RELATIVE orientation (Android Chrome since 50;
//   iOS alpha starts at an arbitrary heading), so no compass and no magnetic jumps. The
//   compass-based 'deviceorientationabsolute' event is never used.
// - iPhone / iPad: DeviceOrientationEvent.requestPermission() must be called from a real tap
//   on a DOM button (call requestMotionPermission() synchronously inside the click handler).
// - Android Chrome: optional RelativeOrientationSensor (Generic Sensor API, referenceFrame
//   'screen'); used while it delivers readings, deviceorientation otherwise.

import { deviceQuat, sensorQuatToWorld } from './look.js';

/** Current screen rotation in degrees (0, 90, 180, 270 / -90). */
export function screenAngle(win = globalThis) {
    try {
        const a = win.screen && win.screen.orientation && win.screen.orientation.angle;
        if (Number.isFinite(a)) return a;
        const w = Number(win.orientation); // old iOS Safari
        if (Number.isFinite(w)) return w;
    } catch { /* ignore */ }
    return 0;
}

export function isPortrait(win = globalThis) {
    try { return win.innerHeight > win.innerWidth; } catch { return false; }
}

/** Does this browser need a permission tap before sending deviceorientation (iOS 13+)? */
export function motionPermissionNeeded(win = globalThis) {
    try {
        const D = win.DeviceOrientationEvent;
        return !!D && typeof D.requestPermission === 'function';
    } catch { return false; }
}

/**
 * Ask for motion access. Call synchronously from a DOM click handler.
 * Resolves 'granted' | 'denied' | 'not-required' (no prompt in this browser) | 'unavailable'.
 */
export function requestMotionPermission(win = globalThis) {
    let D;
    try { D = win.DeviceOrientationEvent; } catch { D = undefined; }
    if (!D) return Promise.resolve('unavailable');
    if (typeof D.requestPermission !== 'function') return Promise.resolve('not-required');
    let p;
    try { p = D.requestPermission(); } catch { return Promise.resolve('denied'); }
    return Promise.resolve(p).then((r) => (r === 'granted' ? 'granted' : 'denied'), () => 'denied');
}

/**
 * Latest device pose.
 * @param {object} [o]
 * @param {Window} [o.win]
 * @param {boolean} [o.preferSensor] - try RelativeOrientationSensor first (Android Chrome)
 * @param {() => number} [o.now]
 */
export function createOrientationSource({ win = globalThis, preferSensor = true, now = () => Date.now() } = {}) {
    const st = {
        running: false,
        eventCount: 0,
        sensorCount: 0,
        last: null,          // { alpha, beta, gamma }
        lastEventAt: 0,
        sensorQ: null,
        lastSensorAt: 0,
        sensorState: 'off',  // off | starting | running | error | unsupported
    };
    let sensor = null;

    function onOrientation(e) {
        if (!e || e.beta === null || e.beta === undefined || e.gamma === null || e.gamma === undefined) return;
        st.last = { alpha: e.alpha || 0, beta: e.beta, gamma: e.gamma };
        st.lastEventAt = now();
        st.eventCount++;
    }

    function startSensor() {
        const Ctor = win.RelativeOrientationSensor;
        if (typeof Ctor !== 'function') { st.sensorState = 'unsupported'; return; }
        try {
            sensor = new Ctor({ frequency: 60, referenceFrame: 'screen' });
            sensor.addEventListener('reading', () => {
                const q = sensor.quaternion;
                if (!q || q.length !== 4) return;
                st.sensorQ = sensorQuatToWorld([q[0], q[1], q[2], q[3]]);
                st.lastSensorAt = now();
                st.sensorCount++;
                st.sensorState = 'running';
            });
            sensor.addEventListener('error', () => { st.sensorState = 'error'; });
            st.sensorState = 'starting';
            sensor.start();
        } catch {
            st.sensorState = 'error';
            sensor = null;
        }
    }

    function sensorFresh() {
        return st.sensorState === 'running' && st.sensorQ && now() - st.lastSensorAt < 500;
    }

    return {
        start() {
            if (st.running) return;
            st.running = true;
            try { win.addEventListener('deviceorientation', onOrientation); } catch { /* ignore */ }
            if (preferSensor) startSensor();
        },
        stop() {
            st.running = false;
            try { win.removeEventListener('deviceorientation', onOrientation); } catch { /* ignore */ }
            try { if (sensor) sensor.stop(); } catch { /* ignore */ }
            sensor = null;
        },
        /** Has any pose arrived yet? */
        get hasData() { return !!(st.last || st.sensorQ); },
        /** 'sensor' | 'event' | null: which source quat() uses right now. */
        get source() { return sensorFresh() ? 'sensor' : st.last ? 'event' : null; },
        /** Current device quaternion (Y-up world, camera frame = screen), or null. */
        quat() {
            if (sensorFresh()) return st.sensorQ.slice();
            if (st.last) return deviceQuat(st.last.alpha, st.last.beta, st.last.gamma, screenAngle(win));
            return null;
        },
        snapshot() {
            return { ...st, last: st.last && { ...st.last }, sensorQ: undefined, source: this.source };
        },
    };
}
