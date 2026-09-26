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
