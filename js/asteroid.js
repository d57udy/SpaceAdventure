import { Entity } from './entity.js';
import { randomRange, degToRad } from './utils.js';

// Asteroid Types
const AsteroidType = {
    GREEN: 'green',  // Collectible - gives points on collision
    RED: 'red'       // Dangerous - lose life on collision, must be shot
};

const AsteroidSize = {
    LARGE: { radius: 40, points: 10, speedMultiplier: 1, greenScore: 100, redScore: 0 },
    MEDIUM: { radius: 30, points: 8, speedMultiplier: 1.5, greenScore: 50, redScore: 0 },
    SMALL: { radius: 20, points: 6, speedMultiplier: 2, greenScore: 25, redScore: 0 },
};

const ASTEROID_BASE_SPEED = 30; // Base speed pixels per second
const ASTEROID_VERTICES_JAGGEDNESS = 0.4; // How irregular the shape is (0 = circle, 1 = very jagged)
const ASTEROID_ROTATION_SPEED_MAX = 90; // Max degrees per second rotation
const GREEN_GLOW_PULSE_SPEED = 2; // Speed of green asteroid pulse

export class Asteroid extends Entity {
    constructor(x, y, size = AsteroidSize.LARGE, initialVel = null, speedMultiplier = 1.0, type = null) {
        super(x, y, size.radius);
        this.sizeInfo = size;
        this.rotationSpeed = degToRad(randomRange(-ASTEROID_ROTATION_SPEED_MAX, ASTEROID_ROTATION_SPEED_MAX));

        // Set asteroid type - if not specified, randomly choose (60% green, 40% red)
        this.type = type || (Math.random() < 0.6 ? AsteroidType.GREEN : AsteroidType.RED);

        // Score value depends on type and size
        this.scoreValue = this.type === AsteroidType.GREEN ? size.greenScore : size.redScore;

        // Pulse effect timer for green asteroids
        this.pulseTimer = Math.random() * Math.PI * 2; // Random start phase

        // Generate random shape vertices
        this.shapeVertices = this.generateShape();

        // Set initial velocity if not provided
        if (initialVel) {
            this.velX = initialVel.x;
            this.velY = initialVel.y;
        } else {
            const angle = randomRange(0, Math.PI * 2);
            // Apply the base speed multiplier AND the size-specific multiplier
            const speed = ASTEROID_BASE_SPEED * speedMultiplier * this.sizeInfo.speedMultiplier;
            this.velX = Math.cos(angle) * speed;
            this.velY = Math.sin(angle) * speed;
        }
    }

    generateShape() {
        const vertices = [];
        const numVertices = this.sizeInfo.points;
        const angleStep = (Math.PI * 2) / numVertices;

        for (let i = 0; i < numVertices; i++) {
            const angle = i * angleStep;
            // Add randomness to the radius for jaggedness
            const radiusOffset = 1 - Math.random() * ASTEROID_VERTICES_JAGGEDNESS;
            const currentRadius = this.radius * radiusOffset;
            vertices.push({
                x: Math.cos(angle) * currentRadius,
                y: Math.sin(angle) * currentRadius,
            });
        }
        return vertices;
    }

    update(deltaTime, canvasWidth, canvasHeight, audioManager) {
        // Apply rotation
        this.rotation += this.rotationSpeed * deltaTime;

        // Update pulse timer for green asteroids
        if (this.type === AsteroidType.GREEN) {
            this.pulseTimer += deltaTime * GREEN_GLOW_PULSE_SPEED;
        }

        // Call parent update for movement and wrapping
        super.update(deltaTime, canvasWidth, canvasHeight);
    }

    // Update for infinite world (no screen wrapping)
    updateInfinite(deltaTime) {
        if (!this.isAlive) return;

        // Apply rotation
        this.rotation += this.rotationSpeed * deltaTime;

        // Update pulse timer for green asteroids
        if (this.type === AsteroidType.GREEN) {
            this.pulseTimer += deltaTime * GREEN_GLOW_PULSE_SPEED;
        }

        // Move without wrapping
        this.x += this.velX * deltaTime;
        this.y += this.velY * deltaTime;
    }

    draw(ctx) {
        if (!this.isAlive) return;

        // Different colors based on type
        if (this.type === AsteroidType.GREEN) {
            // Green asteroids: bright green with pulsing glow
            const pulseIntensity = 0.5 + 0.5 * Math.sin(this.pulseTimer);
            const glowAlpha = 0.3 * pulseIntensity;

            // Draw glow effect
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.rotation);

            ctx.beginPath();
            ctx.moveTo(this.shapeVertices[0].x, this.shapeVertices[0].y);
            for (let i = 1; i < this.shapeVertices.length; i++) {
                ctx.lineTo(this.shapeVertices[i].x, this.shapeVertices[i].y);
            }
            ctx.closePath();

            // Outer glow: wide low-alpha strokes of the same path. Much cheaper than
            // shadowBlur (a per-draw Gaussian blur, costly on HiDPI backing stores) and it
            // scales the same in every browser.
            ctx.lineJoin = 'round';
            ctx.strokeStyle = `rgba(0, 255, 0, ${0.12 * pulseIntensity})`;
            ctx.lineWidth = 2 + 14 * pulseIntensity;
            ctx.stroke();
            ctx.strokeStyle = `rgba(0, 255, 0, ${0.22 * pulseIntensity})`;
            ctx.lineWidth = 2 + 7 * pulseIntensity;
            ctx.stroke();

            ctx.strokeStyle = `rgba(0, 255, 0, ${0.6 + 0.4 * pulseIntensity})`;
            ctx.fillStyle = `rgba(0, 180, 0, ${glowAlpha})`;
            ctx.lineWidth = 2;
            ctx.fill();
            ctx.stroke();

            ctx.restore();
        } else {
            // Red asteroids: dark red/crimson, jagged appearance
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.rotation);

            ctx.strokeStyle = '#CC0000';
            ctx.fillStyle = 'rgba(100, 0, 0, 0.3)';
            ctx.lineWidth = 2;

            ctx.beginPath();
            ctx.moveTo(this.shapeVertices[0].x, this.shapeVertices[0].y);
            for (let i = 1; i < this.shapeVertices.length; i++) {
                ctx.lineTo(this.shapeVertices[i].x, this.shapeVertices[i].y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.restore();
        }
    }

    split(newAsteroidsArray, audioManager) {
        if (!this.isAlive) return [];

        // Play explosion sound for the asteroid being split
        if (audioManager) {
            audioManager.playAsteroidExplosion(this.sizeInfo);
        }

        let children = [];

        // GREEN asteroids: Just get destroyed, no splitting (player shouldn't shoot them!)
        if (this.type === AsteroidType.GREEN) {
            this.destroy();
            return children; // No children - shooting green asteroids is wasteful
        }

        // RED asteroids: Split into smaller red asteroids
        let nextSize = null;

        if (this.sizeInfo === AsteroidSize.LARGE) {
            nextSize = AsteroidSize.MEDIUM;
        } else if (this.sizeInfo === AsteroidSize.MEDIUM) {
            nextSize = AsteroidSize.SMALL;
        }

        if (nextSize) {
            // Create two smaller RED asteroids
            for (let i = 0; i < 2; i++) {
                // Give them slightly divergent velocities based on original + a kick
                const angleKick = randomRange(-Math.PI / 4, Math.PI / 4);
                const speedKick = randomRange(1.1, 1.5);
                const newVel = {
                    x: (this.velX + Math.cos(angleKick) * 20) * speedKick,
                    y: (this.velY + Math.sin(angleKick) * 20) * speedKick
                };

                // Preserve RED type for children
                const child = new Asteroid(this.x, this.y, nextSize, newVel, 1.0, AsteroidType.RED);
                children.push(child);
                newAsteroidsArray.push(child);
            }
        }
        // If size is SMALL, it just gets destroyed (no children)

        this.destroy(); // Mark the parent asteroid as not alive
        return children; // Return the newly created asteroids (if any)
    }

    destroy() {
        super.destroy();
        // Trigger explosion sound/effect here
    }

    // Expose sizes for use elsewhere (e.g., spawning)
    static get Sizes() {
        return AsteroidSize;
    }

    // Expose types for use elsewhere
    static get Types() {
        return AsteroidType;
    }

    // Check if this is a green (collectible) asteroid
    isGreen() {
        return this.type === AsteroidType.GREEN;
    }

    // Check if this is a red (dangerous) asteroid
    isRed() {
        return this.type === AsteroidType.RED;
    }
} 