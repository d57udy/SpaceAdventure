import { Entity } from './entity.js';
import { randomRange } from './utils.js';
import { Bullet } from './bullet.js'; // Need this now

const UFOSize = {
    // Define different sizes later if needed (e.g., Large vs Small)
    STANDARD: { radius: 15, speed: 100, score: 200, fireRate: 2, bulletSpeed: Bullet.UFO_SPEED } // Add bullet speed ref
};

// Remove global accuracy constant
// const UFO_ACCURACY = 0.8;

export class UFO extends Entity {
    constructor(canvasWidth, canvasHeight, playerX = null, playerY = null) {
        const size = UFOSize.STANDARD;

        // If player position provided, spawn relative to player (infinite world mode)
        let x, y;
        if (playerX !== null && playerY !== null) {
            // Spawn at edge of visibility around player
            const angle = randomRange(0, Math.PI * 2);
            const distance = 400; // Just outside typical view
            x = playerX + Math.cos(angle) * distance;
            y = playerY + Math.sin(angle) * distance;
        } else {
            // Legacy: Spawn off-screen left or right
            const spawnLeft = Math.random() < 0.5;
            x = spawnLeft ? -size.radius : canvasWidth + size.radius;
            y = randomRange(size.radius, canvasHeight - size.radius);
        }

        super(x, y, size.radius);

        this.sizeInfo = size;
        this.scoreValue = size.score;

        // Move towards player area (random direction with bias toward center)
        const moveAngle = randomRange(0, Math.PI * 2);
        this.velX = Math.cos(moveAngle) * size.speed;
        this.velY = Math.sin(moveAngle) * size.speed;

        this.fireTimer = size.fireRate * randomRange(0.5, 1.5); // Start with variable delay

        console.log(`UFO spawned at (${x.toFixed(0)}, ${y.toFixed(0)})`);
    }

    update(deltaTime, canvasWidth, canvasHeight, playerShip, bullets, audioManager, difficulty, asteroids = [], cameraX = 0, cameraY = 0) {
        super.update(deltaTime, canvasWidth, canvasHeight); // Basic movement

        // In infinite world, despawn is handled by main.js based on distance from player

        // Check if UFO is visible on screen
        const isOnScreen = this.isVisibleOnScreen(cameraX, cameraY, canvasWidth, canvasHeight);

        // Firing logic
        this.fireTimer -= deltaTime;
        if (this.fireTimer <= 0 && this.isAlive) {
            this.fire(playerShip, bullets, audioManager, difficulty, asteroids, isOnScreen);
            this.fireTimer = this.sizeInfo.fireRate * randomRange(0.8, 1.2);
        }

        // Store visibility for use by main.js (for UFO hum sound)
        this.isOnScreen = isOnScreen;
    }

    fire(playerShip, bullets, audioManager, difficulty, asteroids = [], isOnScreen = true) {
        // Use accuracy from difficulty settings
        const accuracy = difficulty ? difficulty.ufoAccuracy : 0.8; // Default if missing

        // 30% chance to target a green asteroid instead of the player
        let target = null;
        let targetType = 'player';

        // Find nearby green asteroids
        const greenAsteroids = asteroids.filter(a => a.isAlive && a.isGreen && a.isGreen());
        const nearbyGreenAsteroids = greenAsteroids.filter(a => {
            const { dx, dy } = Entity.wrappedDelta(this.x, this.y, a.x, a.y);
            return Math.sqrt(dx * dx + dy * dy) < 400; // Only consider nearby green asteroids
        });

        if (nearbyGreenAsteroids.length > 0 && Math.random() < 0.3) {
            // Target a random nearby green asteroid
            target = nearbyGreenAsteroids[Math.floor(Math.random() * nearbyGreenAsteroids.length)];
            targetType = 'green_asteroid';
            console.log("UFO targeting green asteroid!");
        } else if (playerShip && playerShip.isAlive) {
            target = playerShip;
            targetType = 'player';
        }

        if (!target) return;

        console.log(`UFO Firing at ${targetType}!`);

        // Calculate base angle towards target
        // (use shortest wrapped delta so UFOs aim across the world seam correctly)
        const toTarget = Entity.wrappedDelta(this.x, this.y, target.x, target.y);
        const angleToTarget = Math.atan2(toTarget.dy, toTarget.dx);

        // Add inaccuracy
        const angleOffset = (1 - accuracy) * Math.PI;
        const finalAngle = angleToTarget + randomRange(-angleOffset, angleOffset);

        // Calculate velocity vector
        const bulletSpeed = this.sizeInfo.bulletSpeed;
        const bulletVelX = Math.cos(finalAngle) * bulletSpeed;
        const bulletVelY = Math.sin(finalAngle) * bulletSpeed;

        // Create the bullet (flagged as not a player bullet)
        bullets.push(new Bullet(this.x, this.y, bulletVelX, bulletVelY, false));

        // Only play UFO fire sound if UFO is visible on screen
        if (audioManager && isOnScreen) {
            audioManager.play('ufoShoot');
        }
    }

    // Check if UFO is visible on screen given camera position
    isVisibleOnScreen(cameraX, cameraY, canvasWidth, canvasHeight) {
        // Measure from the camera center using the shortest wrapped delta, since the
        // camera may sit outside [0, world) while the UFO is drawn at a wrapped copy
        const centerX = cameraX + canvasWidth / 2;
        const centerY = cameraY + canvasHeight / 2;
        const { dx, dy } = Entity.wrappedDelta(centerX, centerY, this.x, this.y);
        const screenX = dx + canvasWidth / 2;
        const screenY = dy + canvasHeight / 2;
        const margin = this.radius * 2; // Small margin

        return screenX > -margin &&
               screenX < canvasWidth + margin &&
               screenY > -margin &&
               screenY < canvasHeight + margin;
    }

    draw(ctx) {
        if (!this.isAlive) return;

        ctx.strokeStyle = 'lime'; // Distinct color
        ctx.lineWidth = 1.5;
        ctx.beginPath();

        // Draw simple saucer shape
        const r = this.radius;
        ctx.moveTo(this.x - r, this.y);
        ctx.lineTo(this.x + r, this.y); // Base line

        ctx.moveTo(this.x - r * 0.7, this.y - r * 0.4);
        ctx.lineTo(this.x + r * 0.7, this.y - r * 0.4); // Upper deck base

        ctx.moveTo(this.x - r * 0.4, this.y - r * 0.8);
        ctx.lineTo(this.x + r * 0.4, this.y - r * 0.8); // Top dome base

        // Connect with arcs or lines for a saucer shape
        // Base ellipse
        ctx.beginPath();
        ctx.ellipse(this.x, this.y, r, r * 0.3, 0, 0, Math.PI * 2);
        ctx.stroke();
        // Upper deck ellipse
        ctx.beginPath();
        ctx.ellipse(this.x, this.y - r * 0.4, r * 0.7, r * 0.2, 0, 0, Math.PI * 2);
        ctx.stroke();
        // Top dome
        ctx.beginPath();
        ctx.arc(this.x, this.y - r * 0.5, r * 0.4, Math.PI, 0); // Semicircle
        ctx.closePath();
        ctx.stroke();
    }

    destroy(audioManager) {
        const destroyed = super.destroy();
        if (destroyed) {
            console.log("UFO destroyed!");
            // Play explosion sound
            if (audioManager) {
                // Stop the hum sound if it was playing for *this* specific UFO? No, main handles it.
                audioManager.play('ufoExplode');
            }
        }
        return destroyed;
    }

    // Static properties for spawning logic
    static get SpawnChancePerSecond() {
        return 0.05; // e.g., 5% chance per second (adjust based on level/difficulty)
    }
    static get MaxActiveUFOs() {
        return 1; // Only allow one UFO at a time initially
    }
} 