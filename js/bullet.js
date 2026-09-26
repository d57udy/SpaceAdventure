import { Entity } from './entity.js';

// Constants for the bullet
const PLAYER_BULLET_SPEED = 500;
const UFO_BULLET_SPEED = 350; // UFO bullets slightly slower?
const BULLET_LIFETIME = 1.2; // Slightly longer lifetime to cross screen?
const BULLET_RADIUS = 2;

export class Bullet extends Entity {
    /**
     * @param {boolean} isPlayerBullet false for UFO and boss bullets
     * @param {string|null} ownerId id of the player who fired it (js/players.js), null for enemies
     * @param {string|null} colour draw colour (multiplayer: the owner's colour); null = default
     */
    constructor(x, y, velX, velY, isPlayerBullet = true, ownerId = null, colour = null) {
        super(x, y, BULLET_RADIUS);
        this.velX = velX;
        this.velY = velY;
        this.lifeTimer = BULLET_LIFETIME;
        this.isPlayerBullet = isPlayerBullet; // Flag to identify bullet source
        this.ownerId = ownerId;
        this.colour = colour;
    }

    // Expose speed constants if needed elsewhere
    static get PLAYER_SPEED() {
        return PLAYER_BULLET_SPEED;
    }
    static get UFO_SPEED() {
        return UFO_BULLET_SPEED;
    }

    update(deltaTime, canvasWidth, canvasHeight) {
        super.update(deltaTime, canvasWidth, canvasHeight); // Handles movement

        // Decrease lifetime
        this.lifeTimer -= deltaTime;
        if (this.lifeTimer <= 0) {
            this.isAlive = false;
        }

        // NOTE: In infinite world mode, we don't kill bullets based on canvas bounds
        // Bullets die based on lifetime only (handled above)
        // The old code killed bullets at screen edges which doesn't work with camera movement
    }

    draw(ctx) {
        if (!this.isAlive) return;

        ctx.fillStyle = this.colour || (this.isPlayerBullet ? 'white' : 'lime'); // Different color for UFO bullets
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
    }

    // Override destroy - bullets just disappear
    destroy() {
        this.isAlive = false;
    }
} 