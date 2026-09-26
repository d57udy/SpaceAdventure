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
    // rng: optional seeded generator (js/rng.js) for the spawn angle, heading and first shot
    // delay (Time Attack); Math.random when omitted. Aiming and later shots stay random.
    constructor(canvasWidth, canvasHeight, playerX = null, playerY = null, rng = null) {
        const size = UFOSize.STANDARD;

        // If player position provided, spawn relative to player (infinite world mode)
        let x, y;
        if (playerX !== null && playerY !== null) {
            // Spawn at edge of visibility around player
            const angle = randomRange(0, Math.PI * 2, rng);
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
        const moveAngle = randomRange(0, Math.PI * 2, rng);
        this.velX = Math.cos(moveAngle) * size.speed;
        this.velY = Math.sin(moveAngle) * size.speed;

        this.fireTimer = size.fireRate * randomRange(0.5, 1.5, rng); // Start with variable delay

        console.log(`UFO spawned at (${x.toFixed(0)}, ${y.toFixed(0)})`);
    }

    // --- Player-controlled saucer (Saucer mode, plan 05 §4.5) ---
    // controlled: no AI firing; main.js steers it (steer) and fires it (tryFire). Its bullets are
    // ordinary enemy bullets (flagged fromSaucer), so the existing collisions kill the pilot and
    // destroy greens. While isInvulnerable it is drawn translucent and main.js skips its collisions.
    makeControlled({ speed = 150, fireCooldown = 1, colour = null, heading = 0, invulnerability = 0 } = {}) {
        this.controlled = true;
        this.speed = speed;
        this.fireCooldown = fireCooldown;
        this.cooldown = 0;
        this.ownerColour = colour;
        this.heading = heading;         // turret direction: the last steering direction
        this.aimAngle = heading;        // last shot's direction (after aim assist)
        this.shots = 0;
        this.velX = 0;
        this.velY = 0;
        this.setInvulnerable(invulnerability);
        return this;
    }

    setInvulnerable(seconds) {
        this.invulnerableTimer = Math.max(0, seconds || 0);
        this.isInvulnerable = this.invulnerableTimer > 0;
    }

    // Steer with an absolute direction vector (length 0..1; 0 stops). The turret follows it.
    steer(dx, dy) {
        const m = Math.min(1, Math.hypot(dx, dy));
        if (!(m > 0)) {
            this.velX = 0;
            this.velY = 0;
            return;
        }
        this.heading = Math.atan2(dy, dx);
        this.velX = Math.cos(this.heading) * m * this.speed;
        this.velY = Math.sin(this.heading) * m * this.speed;
    }

    // Fire one enemy bullet at `angle` (default: the turret heading) unless cooling down.
    // Returns the bullet or null.
    tryFire(bullets, angle = this.heading, audioManager = null) {
        if (!this.isAlive || this.cooldown > 0) return null;
        const speed = this.sizeInfo.bulletSpeed;
        const x = this.x + Math.cos(angle) * this.radius;
        const y = this.y + Math.sin(angle) * this.radius;
        const bullet = new Bullet(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, false);
        bullet.fromSaucer = true;
        bullets.push(bullet);
        this.cooldown = this.fireCooldown;
        this.aimAngle = angle;
        this.shots++;
        if (audioManager && this.isOnScreen !== false) audioManager.play('ufoShoot');
        return bullet;
    }

    update(deltaTime, canvasWidth, canvasHeight, playerShip, bullets, audioManager, difficulty, asteroids = [], cameraX = 0, cameraY = 0) {
        super.update(deltaTime, canvasWidth, canvasHeight); // Basic movement

        // In infinite world, despawn is handled by main.js based on distance from player

        // Check if UFO is visible on screen
        const isOnScreen = this.isVisibleOnScreen(cameraX, cameraY, canvasWidth, canvasHeight);

        if (this.controlled) {
            // A player flies it: no AI shots, only the cooldown and protection timers run
            this.cooldown = Math.max(0, this.cooldown - deltaTime);
            if (this.invulnerableTimer > 0) this.setInvulnerable(this.invulnerableTimer - deltaTime);
            this.isOnScreen = isOnScreen;
            return;
        }

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
        if (this.controlled) {
            ctx.save();
            // Protected after appearing: translucent (blinking)
            if (this.isInvulnerable) ctx.globalAlpha = 0.25 + 0.2 * Math.sin(Date.now() / 90);
            this._drawBody(ctx);
            // Turret along the heading, and a ring in the pilot's colour
            const r = this.radius;
            ctx.strokeStyle = this.ownerColour || '#FFFFFF';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(this.x + Math.cos(this.heading) * r * 1.6, this.y + Math.sin(this.heading) * r * 1.6);
            ctx.stroke();
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(this.x, this.y, r * 1.35, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
            return;
        }
        this._drawBody(ctx);
    }

    _drawBody(ctx) {
        ctx.strokeStyle = '#9933FF'; // Purple: never the collectible hue (Help screen says purple too)
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