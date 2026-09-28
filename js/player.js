import { Entity } from './entity.js';
import { degToRad, randomRange } from './utils.js';
import { Bullet } from './bullet.js';
import { hullMarkShapes } from './mpView.js';

// Constants for the ship
const SHIP_THRUST = 5; // Acceleration per frame when thrusting
const SHIP_FRICTION = 0.995; // Slowdown factor per 1/60s (closer to 1 = less friction)
const SHIP_TURN_SPEED = 360; // Degrees per second
const SHIP_INVULNERABILITY_DURATION = 3; // Seconds
const SHIP_BLINK_INTERVAL = 0.2; // Seconds per blink
const HYPERSPACE_COOLDOWN = 5; // Seconds before hyperspace can be used again
const HYPERSPACE_SELF_DESTRUCT_CHANCE = 0.1; // 10% chance of dying on jump

export class PlayerShip extends Entity {
    constructor(x, y) {
        super(x, y, 15); // Set radius for collision
        this.rotation = degToRad(-90); // Start facing upwards
        this.isThrusting = false;
        this.thrustForce = { x: 0, y: 0 };
        this.canShoot = true;
        this.shootCooldown = 0.25; // Seconds between shots
        this.shootTimer = 0;
        this.isInvulnerable = false;
        this.invulnerabilityTimer = 0;
        this.blinkOn = true;
        this.blinkTimer = 0;
        this.canHyperspace = true;
        this.hyperspaceCooldownTimer = 0;
        // Owner (js/players.js player id) and bullet colour, set by main.js; bullets carry them
        this.ownerId = null;
        this.bulletColour = null;
        // Multiplayer identity (set by main.js): hull colour and a per-seat hull mark
        this.colour = null;     // null = white (single-player)
        this.hullMark = 'none'; // js/mpView.js HULL_MARKS

        // Make invulnerable on creation (spawn protection)
        this.makeInvulnerable(SHIP_INVULNERABILITY_DURATION);
    }

    makeInvulnerable(duration = SHIP_INVULNERABILITY_DURATION) {
        this.isInvulnerable = true;
        this.invulnerabilityTimer = duration;
        this.blinkTimer = SHIP_BLINK_INTERVAL;
        this.blinkOn = true;
    }

    rotate(direction, deltaTime) {
        // direction should be -1 (left) or 1 (right)
        this.rotation += degToRad(SHIP_TURN_SPEED) * direction * deltaTime;
    }

    thrust(deltaTime) {
        this.isThrusting = true;
        // Calculate thrust vector based on rotation
        this.thrustForce.x = Math.cos(this.rotation) * SHIP_THRUST;
        this.thrustForce.y = Math.sin(this.rotation) * SHIP_THRUST;

        // Apply thrust to velocity (scaled by delta time for consistency)
        // Note: Multiplying force by deltaTime^2 isn't quite right for acceleration,
        // a simpler approach is vel += acceleration * dt
        this.velX += this.thrustForce.x * deltaTime * 60; // Adjust multiplier as needed
        this.velY += this.thrustForce.y * deltaTime * 60;
    }

    fire(bullets, audioManager) {
        // Note: no per-call logging here; fire() runs every frame while the button is held
        if (this.canShoot && this.shootTimer <= 0) {
            const bulletVelX = Math.cos(this.rotation) * Bullet.PLAYER_SPEED;
            const bulletVelY = Math.sin(this.rotation) * Bullet.PLAYER_SPEED;
            const noseX = this.x + Math.cos(this.rotation) * (this.radius);
            const noseY = this.y + Math.sin(this.rotation) * (this.radius);
            bullets.push(new Bullet(noseX, noseY, bulletVelX, bulletVelY, true, this.ownerId, this.bulletColour));
            this.shootTimer = this.shootCooldown;
            if (audioManager) {
                audioManager.play('playerShoot');
            }
        }
    }

    // area (optional, simultaneous modes): {x, y, width, height} in world units, x/y may be
    // negative; the ship lands inside it (wrapped into the world) instead of anywhere. The rolls
    // are the same: self-destruct, then x, then y.
    hyperspace(canvasWidth, canvasHeight, asteroids, ufos, audioManager, area = null) {
        if (!this.canHyperspace || this.hyperspaceCooldownTimer > 0) {
            console.log("Hyperspace not ready.");
            return false;
        }

        console.log("Attempting Hyperspace!");
        // Play hyperspace start sound (if available)
        // if (audioManager) audioManager.play('hyperspaceStart');

        // Check for self-destruction risk
        if (Math.random() < HYPERSPACE_SELF_DESTRUCT_CHANCE) {
            console.log("Hyperspace failed - Self-destruct!");
            // if (audioManager) audioManager.play('hyperspaceFail');
            this.destroy(audioManager, true); // Pass audioManager and force
            // Return true: the jump happened (fatally). Caller checks isAlive to handle death.
            return true;
        }

        // Relocate to a random position
        if (area) {
            const wrap = (v, size) => ((v % size) + size) % size;
            this.x = wrap(area.x + randomRange(this.radius, area.width - this.radius), canvasWidth);
            this.y = wrap(area.y + randomRange(this.radius, area.height - this.radius), canvasHeight);
        } else {
            this.x = randomRange(this.radius, canvasWidth - this.radius);
            this.y = randomRange(this.radius, canvasHeight - this.radius);
        }

        // Stop movement
        this.velX = 0;
        this.velY = 0;

        // Check for immediate collision at new location (optional but recommended by FR19)
        // This makes hyperspace riskier as intended.
        let immediateCollision = false;
        for (const asteroid of asteroids) {
            if (asteroid.isAlive && this.collidesWith(asteroid)) {
                immediateCollision = true;
                break;
            }
        }
        if (!immediateCollision) {
            for (const ufo of ufos) {
                if (ufo.isAlive && this.collidesWith(ufo)) {
                    immediateCollision = true;
                    break;
                }
            }
        }

        if (immediateCollision) {
            console.log("Hyperspace failed - Materialized inside object!");
            // if (audioManager) audioManager.play('hyperspaceFail');
            this.destroy(audioManager, true); // Pass audioManager and force
            // Return true: the jump happened (fatally). Caller checks isAlive to handle death.
            return true;
        }

        console.log(`Hyperspace successful to (${this.x.toFixed(0)}, ${this.y.toFixed(0)})`);
        // if (audioManager) audioManager.play('hyperspaceSuccess');

        // Start cooldown
        this.hyperspaceCooldownTimer = HYPERSPACE_COOLDOWN;
        this.canHyperspace = false;

        return true; // Indicate the jump happened (ship survived)
    }

    update(deltaTime, canvasWidth, canvasHeight, audioManager) {
        // Update shoot timer
        if (this.shootTimer > 0) {
            this.shootTimer -= deltaTime;
        }

        // Update hyperspace cooldown timer
        if (this.hyperspaceCooldownTimer > 0) {
            this.hyperspaceCooldownTimer -= deltaTime;
            if (this.hyperspaceCooldownTimer <= 0) {
                this.canHyperspace = true;
                console.log("Hyperspace ready.");
            }
        }

        // Apply friction (inertia), scaled by deltaTime so it is frame-rate independent
        const friction = Math.pow(SHIP_FRICTION, deltaTime * 60);
        this.velX *= friction;
        this.velY *= friction;

        // Note: isThrusting flag is managed by main.js input handling
        // It's set true by thrust() and false when thrust key is not pressed

        // Call parent update for movement and wrapping
        super.update(deltaTime, canvasWidth, canvasHeight);

        // Update invulnerability
        if (this.isInvulnerable) {
            this.invulnerabilityTimer -= deltaTime;
            this.blinkTimer -= deltaTime;
            if (this.blinkTimer <= 0) {
                this.blinkOn = !this.blinkOn;
                this.blinkTimer = SHIP_BLINK_INTERVAL;
            }
            if (this.invulnerabilityTimer <= 0) {
                this.isInvulnerable = false;
            }
        }
    }

    draw(ctx) {
        if (!this.isAlive) return;

        // Don't draw if blinking off during invulnerability
        if (this.isInvulnerable && !this.blinkOn) {
            return;
        }

        ctx.strokeStyle = this.colour || 'white';
        ctx.lineWidth = 1.5;
        ctx.beginPath();

        // Ship vertices relative to center (0,0) assuming radius is half-height
        const angle = this.rotation;
        const noseX = this.x + Math.cos(angle) * this.radius;
        const noseY = this.y + Math.sin(angle) * this.radius;
        const rearLeftX = this.x + Math.cos(angle + degToRad(140)) * this.radius;
        const rearLeftY = this.y + Math.sin(angle + degToRad(140)) * this.radius;
        const rearRightX = this.x + Math.cos(angle - degToRad(140)) * this.radius;
        const rearRightY = this.y + Math.sin(angle - degToRad(140)) * this.radius;

        // Draw triangle
        ctx.moveTo(noseX, noseY);
        ctx.lineTo(rearLeftX, rearLeftY);
        ctx.lineTo(rearRightX, rearRightY);
        ctx.closePath();
        ctx.stroke();
        if (this.hullMark && this.hullMark !== 'none') this.drawHullMark(ctx);

        // Draw thrust flame if thrusting - low poly flickering style
        if (this.isThrusting) {
            // Flicker effect - randomize flame length
            const flameFlicker = 0.8 + Math.random() * 0.6; // 0.8 to 1.4
            const flameLength = this.radius * 1.3 * flameFlicker;

            // Rear center of ship (base of flame)
            const rearCenterX = this.x + Math.cos(angle + Math.PI) * (this.radius * 0.5);
            const rearCenterY = this.y + Math.sin(angle + Math.PI) * (this.radius * 0.5);

            // Flame tip (points backward from ship)
            const flameTipX = this.x + Math.cos(angle + Math.PI) * flameLength;
            const flameTipY = this.y + Math.sin(angle + Math.PI) * flameLength;

            // Flame base corners (slightly inside the rear of ship)
            const flameBaseLeft = {
                x: this.x + Math.cos(angle + degToRad(155)) * this.radius * 0.6,
                y: this.y + Math.sin(angle + degToRad(155)) * this.radius * 0.6
            };
            const flameBaseRight = {
                x: this.x + Math.cos(angle - degToRad(155)) * this.radius * 0.6,
                y: this.y + Math.sin(angle - degToRad(155)) * this.radius * 0.6
            };

            // Draw outer flame (orange/yellow)
            ctx.strokeStyle = '#FFA500';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(flameBaseLeft.x, flameBaseLeft.y);
            ctx.lineTo(flameTipX, flameTipY);
            ctx.lineTo(flameBaseRight.x, flameBaseRight.y);
            ctx.stroke();

            // Draw inner flame (brighter, shorter) for depth
            const innerFlicker = 0.5 + Math.random() * 0.3;
            const innerTipX = this.x + Math.cos(angle + Math.PI) * (this.radius * 0.9 * innerFlicker);
            const innerTipY = this.y + Math.sin(angle + Math.PI) * (this.radius * 0.9 * innerFlicker);

            ctx.strokeStyle = '#FFFF00';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(flameBaseLeft.x, flameBaseLeft.y);
            ctx.lineTo(innerTipX, innerTipY);
            ctx.lineTo(flameBaseRight.x, flameBaseRight.y);
            ctx.stroke();
        }

        // Reset stroke style
        ctx.lineWidth = 1;
    }

    // Per-seat hull mark (stripe, dot, notch) in the hull colour, in the ship's own frame
    drawHullMark(ctx) {
        const shapes = hullMarkShapes(this.hullMark, this.radius);
        if (!shapes.length) return;
        const c = Math.cos(this.rotation);
        const s = Math.sin(this.rotation);
        const tx = (x, y) => this.x + x * c - y * s;
        const ty = (x, y) => this.y + x * s + y * c;
        ctx.strokeStyle = this.colour || 'white';
        ctx.fillStyle = this.colour || 'white';
        ctx.lineWidth = 2;
        for (const sh of shapes) {
            ctx.beginPath();
            if (sh.type === 'line') {
                ctx.moveTo(tx(sh.x1, sh.y1), ty(sh.x1, sh.y1));
                ctx.lineTo(tx(sh.x2, sh.y2), ty(sh.x2, sh.y2));
                ctx.stroke();
            } else {
                ctx.arc(tx(sh.x, sh.y), ty(sh.x, sh.y), sh.r, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.lineWidth = 1.5;
    }

    destroy(audioManager, force = false) {
        if (!force && this.isInvulnerable) return false;

        const wasAlive = this.isAlive; // Store current state
        const destroyed = super.destroy(); // Call base destroy first

        if (destroyed) { // Only play sound etc. if it was actually destroyed now
            // Play explosion sound
            if (audioManager) {
                audioManager.play('playerExplode');
            }
            console.log(`Player ship destroyed! ${force ? '(Forced)' : ''}`);
        }
        return destroyed; // Return whether destruction happened in this call
    }

    // Method to stop any sounds specific to this entity (if needed)
    stopSounds(audioManager) {
        // Currently thrust sound is managed in main.js based on isThrusting flag
        // If other player-specific loops were added, stop them here.
        // e.g., if (audioManager) audioManager.stop('somePlayerSound');
    }
} 