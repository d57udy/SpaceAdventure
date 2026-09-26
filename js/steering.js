// Drag-to-steer maths, kept free of DOM/game globals so it can be unit tested.

export const JOYSTICK_DEADZONE = 0.2; // Ignore tiny drags (fraction of the stick radius)
export const JOYSTICK_THRUST_START = 0.45; // Drag further than this to thrust
export const JOYSTICK_MAX_THRUST_ANGLE = Math.PI / 2; // Only thrust once roughly facing the drag direction

// Signed shortest angle from `from` to `to`, in (-PI, PI]
export function angleDiff(from, to) {
    return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

// Turn the ship toward the stick direction at its normal turn speed (never overshooting)
// and thrust proportionally once the drag is long enough and the ship roughly faces it.
// `ship` needs rotation, rotate(direction, dt) and thrust(dt). Returns true if it thrusted.
export function applyJoystickSteering(ship, stick, deltaTime, turnTime, thrustScale = 1) {
    if (!stick || !stick.active || stick.magnitude < JOYSTICK_DEADZONE) return false;

    const diff = angleDiff(ship.rotation, stick.angle);
    const before = ship.rotation;
    ship.rotate(Math.sign(diff), turnTime);
    if (Math.abs(ship.rotation - before) >= Math.abs(diff)) ship.rotation = before + diff;

    if (stick.magnitude > JOYSTICK_THRUST_START &&
        Math.abs(angleDiff(ship.rotation, stick.angle)) < JOYSTICK_MAX_THRUST_ANGLE) {
        const strength = (stick.magnitude - JOYSTICK_THRUST_START) / (1 - JOYSTICK_THRUST_START);
        ship.thrust(deltaTime * thrustScale * (0.4 + 0.6 * strength));
        return true;
    }
    return false;
}

// Finger tremor on a short drag swings the aim by several degrees; ignore direction
// changes smaller than a threshold (larger when the drag is short and less precise).
export const STICK_HEADING_THRESHOLD_SHORT = 0.1; // radians, drag shorter than JOYSTICK_THRUST_START
export const STICK_HEADING_THRESHOLD_LONG = 0.04; // radians

// Pure: the caller keeps `heading` per player (e.g. player.stickHeading) and stores the
// returned heading for the next frame. Returns { stick, heading }: the steadied stick and
// the heading to keep (null when the stick is inactive).
export function stabilizeHeading(stick, heading = null) {
    if (!stick || !stick.active) return { stick, heading: null };
    const threshold = stick.magnitude < JOYSTICK_THRUST_START
        ? STICK_HEADING_THRESHOLD_SHORT : STICK_HEADING_THRESHOLD_LONG;
    const next = heading === null || !Number.isFinite(heading) || Math.abs(angleDiff(heading, stick.angle)) > threshold
        ? stick.angle : heading;
    return { stick: { ...stick, angle: next }, heading: next };
}
