import { wrapAroundEdges, wrapDelta } from './utils.js';

export class Entity {
    // World size used for wrap-aware distance checks (0 = no wrapping).
    // Set by main.js whenever the world is resized.
    static worldWidth = 0;
    static worldHeight = 0;

    // Shortest delta from (fromX, fromY) to (toX, toY), accounting for world wrapping
    static wrappedDelta(fromX, fromY, toX, toY) {
        return {
            dx: wrapDelta(toX - fromX, Entity.worldWidth),
            dy: wrapDelta(toY - fromY, Entity.worldHeight)
        };
    }

    constructor(x, y, radius = 10) {
        this.x = x;
        this.y = y;
        this.velX = 0; // Velocity x
        this.velY = 0; // Velocity y
        this.rotation = 0; // Rotation in radians (0 is pointing right)
        this.radius = radius; // Collision radius
        this.isAlive = true;
    }

    update(deltaTime, canvasWidth, canvasHeight) {
        // Basic physics: update position based on velocity
        this.x += this.velX * deltaTime;
        this.y += this.velY * deltaTime;

        // Apply screen wrapping (disabled for infinite world)
        // wrapAroundEdges(this, canvasWidth, canvasHeight);
    }

    // Update for infinite world (no wrapping, just move)
    updateInfinite(deltaTime) {
        this.x += this.velX * deltaTime;
        this.y += this.velY * deltaTime;
    }

    // Basic draw method (intended to be overridden by subclasses)
    draw(ctx) {
        if (!this.isAlive) return;

        // Example: draw a simple circle for debugging
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.strokeStyle = 'white';
        ctx.stroke();

        // Draw rotation indicator (line pointing forward)
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(
            this.x + Math.cos(this.rotation) * this.radius * 1.5,
            this.y + Math.sin(this.rotation) * this.radius * 1.5
        );
        ctx.strokeStyle = 'red'; // Different color for direction
        ctx.stroke();
    }

    // Simple radius-based collision detection
    collidesWith(otherEntity) {
        if (!this.isAlive || !otherEntity.isAlive) {
            return false;
        }
        const { dx, dy } = Entity.wrappedDelta(otherEntity.x, otherEntity.y, this.x, this.y);
        const distance = Math.sqrt(dx * dx + dy * dy);
        return distance < this.radius + otherEntity.radius;
    }

    destroy() {
        if (!this.isAlive) return false; // Don't destroy if already dead
        this.isAlive = false;
        // Add logic here for explosion effects, sounds, etc.
        return true; // Indicate successful destruction
    }
} 