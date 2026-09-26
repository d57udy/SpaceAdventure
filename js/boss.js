import { Entity } from './entity.js';
import { Bullet } from './bullet.js';
import { randomRange, degToRad } from './utils.js';

// Boss - Large UFO mothership with multiple weak points
export class Boss extends Entity {
    static PHASES = {
        ENTERING: 'entering',
        FIGHTING: 'fighting',
        DEFEATED: 'defeated'
    };

    constructor(x, y, level = 1) {
        // Boss is large - radius scales slightly with level
        const baseRadius = 80;
        super(x, y, baseRadius + Math.min(level * 2, 20));

        this.level = level;
        this.phase = Boss.PHASES.ENTERING;
        this.phaseTimer = 0;

        // Weak points - positions relative to boss center
        this.weakPoints = this.createWeakPoints();

        // Health is the sum of weak point health (kept in sync in damageWeakPoint)
        this.maxHealth = this.getMaxTotalHealth();
        this.health = this.maxHealth;

        // Movement
        this.targetX = x;
        this.targetY = y;
        // Target is kept as an offset from the player so the boss stays on screen
        this.targetOffsetX = null;
        this.targetOffsetY = null;
        this.moveSpeed = 50 + (level * 5);
        this.moveTimer = 0;
        this.moveDuration = 3;

        // Attack patterns
        this.attackPattern = 0;
        this.attackTimer = 0;
        this.attackCooldown = 2 - Math.min(level * 0.1, 1); // Faster attacks at higher levels

        // Visual effects
        this.pulseTimer = 0;
        this.rotationAngle = 0;
        this.damageFlashTimer = 0;

        // Score value
        this.scoreValue = 1000 + (level * 500);

        // Entry position - start above target and move down
        this.entryTargetY = y;
        this.startY = y - 300; // Start 300px above target
        this.y = this.startY;

        // Entry animation timer (for warning message)
        this.entryTimer = 0;
        this.maxEntryTime = 3; // seconds for entry animation
    }

    createWeakPoints() {
        const points = [];
        const numPoints = 3 + Math.floor(this.level / 2); // More weak points at higher levels

        for (let i = 0; i < numPoints; i++) {
            const angle = (i / numPoints) * Math.PI * 2;
            const distance = this.radius * 0.6;
            points.push({
                offsetX: Math.cos(angle) * distance,
                offsetY: Math.sin(angle) * distance,
                radius: 12,
                health: 20 + (this.level * 5),
                maxHealth: 20 + (this.level * 5),
                destroyed: false,
                pulsePhase: Math.random() * Math.PI * 2
            });
        }

        // Center weak point (main core) - appears after others destroyed
        points.push({
            offsetX: 0,
            offsetY: 0,
            radius: 18,
            health: 40 + (this.level * 10),
            maxHealth: 40 + (this.level * 10),
            destroyed: false,
            isCore: true,
            pulsePhase: 0
        });

        return points;
    }

    update(deltaTime, canvasWidth, canvasHeight, ship, bullets, audioManager) {
        if (!this.isAlive) return;

        this.pulseTimer += deltaTime * 2;
        this.rotationAngle += deltaTime * 0.5;

        // Update weak point pulse
        this.weakPoints.forEach(wp => {
            wp.pulsePhase += deltaTime * 3;
        });

        // Decrease damage flash
        if (this.damageFlashTimer > 0) {
            this.damageFlashTimer -= deltaTime;
        }

        switch (this.phase) {
            case Boss.PHASES.ENTERING:
                this.updateEntering(deltaTime);
                break;
            case Boss.PHASES.FIGHTING:
                this.updateFighting(deltaTime, canvasWidth, canvasHeight, ship, bullets, audioManager);
                break;
            case Boss.PHASES.DEFEATED:
                this.updateDefeated(deltaTime);
                break;
        }
    }

    updateEntering(deltaTime) {
        // Track entry time for warning message duration
        this.entryTimer += deltaTime;

        // Move down to entry position
        const speed = 150;
        if (this.y < this.entryTargetY) {
            this.y += speed * deltaTime;
            if (this.y >= this.entryTargetY) {
                this.y = this.entryTargetY;
                this.phase = Boss.PHASES.FIGHTING;
                console.log('Boss entered - Fight begins!');
            }
        } else {
            // Already at target, transition immediately
            this.phase = Boss.PHASES.FIGHTING;
            console.log('Boss at position - Fight begins!');
        }
    }

    // Check if warning should still be shown (first 2 seconds of entry)
    shouldShowWarning() {
        return this.phase === Boss.PHASES.ENTERING && this.entryTimer < 2;
    }

    updateFighting(deltaTime, canvasWidth, canvasHeight, ship, bullets, audioManager) {
        // Movement
        this.moveTimer += deltaTime;
        if (this.moveTimer >= this.moveDuration || this.targetOffsetX === null) {
            this.moveTimer = 0;
            // Pick new target position in the upper part of the player's view.
            // Stored relative to the player (world coords), not absolute canvas coords.
            this.targetOffsetX = randomRange(-canvasWidth / 2 + this.radius + 50, canvasWidth / 2 - this.radius - 50);
            this.targetOffsetY = randomRange(-canvasHeight / 2 + this.radius + 50, -canvasHeight / 2 + canvasHeight * 0.4);
        }
        if (ship) {
            this.targetX = ship.x + this.targetOffsetX;
            this.targetY = ship.y + this.targetOffsetY;
        }

        // Move toward target (shortest path in the wrapping world)
        const { dx, dy } = Entity.wrappedDelta(this.x, this.y, this.targetX, this.targetY);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 5) {
            this.x += (dx / dist) * this.moveSpeed * deltaTime;
            this.y += (dy / dist) * this.moveSpeed * deltaTime;
        }

        // Attack patterns
        this.attackTimer += deltaTime;
        if (this.attackTimer >= this.attackCooldown && ship && ship.isAlive) {
            this.attackTimer = 0;
            this.executeAttack(ship, bullets, audioManager);
        }
    }

    executeAttack(ship, bullets, audioManager) {
        this.attackPattern = (this.attackPattern + 1) % 3;

        switch (this.attackPattern) {
            case 0: // Spread shot
                this.fireSpread(ship, bullets, audioManager);
                break;
            case 1: // Aimed shot
                this.fireAimed(ship, bullets, audioManager);
                break;
            case 2: // Circle burst
                this.fireCircle(bullets, audioManager);
                break;
        }
    }

    fireSpread(ship, bullets, audioManager) {
        const toShip = Entity.wrappedDelta(this.x, this.y, ship.x, ship.y);
        const angleToShip = Math.atan2(toShip.dy, toShip.dx);
        const spreadCount = 5;
        const spreadAngle = degToRad(15);

        for (let i = 0; i < spreadCount; i++) {
            const angle = angleToShip + (i - Math.floor(spreadCount / 2)) * spreadAngle;
            const speed = 200;
            bullets.push(new Bullet(
                this.x, this.y + this.radius * 0.8,
                Math.cos(angle) * speed,
                Math.sin(angle) * speed,
                false // Not player bullet
            ));
        }

        if (audioManager) audioManager.play('ufoShoot');
    }

    fireAimed(ship, bullets, audioManager) {
        const toShip = Entity.wrappedDelta(this.x, this.y, ship.x, ship.y);
        const angleToShip = Math.atan2(toShip.dy, toShip.dx);
        const speed = 300;

        bullets.push(new Bullet(
            this.x, this.y + this.radius * 0.8,
            Math.cos(angleToShip) * speed,
            Math.sin(angleToShip) * speed,
            false
        ));

        if (audioManager) audioManager.play('ufoShoot');
    }

    fireCircle(bullets, audioManager) {
        const bulletCount = 8 + this.level;
        const speed = 150;

        for (let i = 0; i < bulletCount; i++) {
            const angle = (i / bulletCount) * Math.PI * 2;
            bullets.push(new Bullet(
                this.x + Math.cos(angle) * this.radius * 0.5,
                this.y + Math.sin(angle) * this.radius * 0.5,
                Math.cos(angle) * speed,
                Math.sin(angle) * speed,
                false
            ));
        }

        if (audioManager) audioManager.play('ufoShoot');
    }

    updateDefeated(deltaTime) {
        // Explosion animation - shrink and fade
        this.phaseTimer += deltaTime;
        if (this.phaseTimer > 2) {
            this.isAlive = false;
        }
    }

    // Check if a bullet hits a weak point
    checkBulletHit(bullet) {
        if (!bullet.isPlayerBullet || !this.isAlive || this.phase !== Boss.PHASES.FIGHTING) {
            return null;
        }

        // Check if outer weak points are all destroyed first
        const outerDestroyed = this.weakPoints.filter(wp => !wp.isCore).every(wp => wp.destroyed);

        for (const wp of this.weakPoints) {
            if (wp.destroyed) continue;

            // Core is only vulnerable after outer points destroyed
            if (wp.isCore && !outerDestroyed) continue;

            const wpX = this.x + wp.offsetX;
            const wpY = this.y + wp.offsetY;
            const { dx, dy } = Entity.wrappedDelta(wpX, wpY, bullet.x, bullet.y);
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < wp.radius + bullet.radius) {
                return wp;
            }
        }

        return null;
    }

    // Damage a weak point
    damageWeakPoint(wp, damage = 10) {
        wp.health -= damage;
        this.damageFlashTimer = 0.1;

        if (wp.health <= 0) {
            wp.destroyed = true;
            wp.health = 0;
        }
        this.health = this.getTotalHealth();

        if (wp.destroyed) {
            // Check if all points destroyed
            if (this.weakPoints.every(p => p.destroyed)) {
                this.phase = Boss.PHASES.DEFEATED;
                this.phaseTimer = 0;
                console.log('Boss defeated!');
                return true; // Boss defeated
            }
        }

        return false; // Boss still alive
    }

    draw(ctx) {
        if (!this.isAlive) return;

        const pulse = 1 + Math.sin(this.pulseTimer) * 0.05;

        ctx.save();
        ctx.translate(this.x, this.y);

        // Damage flash effect
        if (this.damageFlashTimer > 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.beginPath();
            ctx.arc(0, 0, this.radius * pulse * 1.1, 0, Math.PI * 2);
            ctx.fill();
        }

        // Main body - saucer shape
        ctx.strokeStyle = this.phase === Boss.PHASES.DEFEATED ? '#FF4444' : '#9933FF';
        ctx.lineWidth = 3;
        ctx.fillStyle = 'rgba(50, 0, 80, 0.8)';

        // Draw saucer body (ellipse)
        ctx.beginPath();
        ctx.ellipse(0, 0, this.radius * pulse, this.radius * 0.4 * pulse, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Draw dome on top
        ctx.beginPath();
        ctx.ellipse(0, -this.radius * 0.15 * pulse, this.radius * 0.5 * pulse, this.radius * 0.3 * pulse, 0, Math.PI, 0);
        ctx.fill();
        ctx.stroke();

        // Draw rotating details
        ctx.save();
        ctx.rotate(this.rotationAngle);
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const x = Math.cos(angle) * this.radius * 0.7;
            const y = Math.sin(angle) * this.radius * 0.25;
            ctx.fillStyle = '#FF00FF';
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();

        // Draw weak points
        const outerDestroyed = this.weakPoints.filter(wp => !wp.isCore).every(wp => wp.destroyed);

        this.weakPoints.forEach(wp => {
            if (wp.destroyed) return;

            // Core only visible when outer points destroyed
            if (wp.isCore && !outerDestroyed) return;

            const wpPulse = 1 + Math.sin(wp.pulsePhase) * 0.2;
            const healthRatio = wp.health / wp.maxHealth;

            // Weak point glow
            ctx.fillStyle = wp.isCore ? 'rgba(255, 0, 0, 0.3)' : 'rgba(255, 255, 0, 0.3)';
            ctx.beginPath();
            ctx.arc(wp.offsetX, wp.offsetY, wp.radius * wpPulse * 1.5, 0, Math.PI * 2);
            ctx.fill();

            // Weak point core
            ctx.fillStyle = wp.isCore ? '#FF0000' : '#FFFF00';
            ctx.strokeStyle = wp.isCore ? '#FF6666' : '#FFFF66';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(wp.offsetX, wp.offsetY, wp.radius * wpPulse * healthRatio, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        });

        ctx.restore();

        // Draw health bar above boss
        if (this.phase === Boss.PHASES.FIGHTING) {
            const barWidth = this.radius * 2;
            const barHeight = 8;
            const barX = this.x - barWidth / 2;
            const barY = this.y - this.radius - 20;
            const healthRatio = this.health / this.maxHealth;

            // Background
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(barX - 2, barY - 2, barWidth + 4, barHeight + 4);

            // Health bar
            ctx.fillStyle = healthRatio > 0.5 ? '#00FF00' : healthRatio > 0.25 ? '#FFFF00' : '#FF0000';
            ctx.fillRect(barX, barY, barWidth * healthRatio, barHeight);

            // Border
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 1;
            ctx.strokeRect(barX, barY, barWidth, barHeight);

            // Boss name
            ctx.fillStyle = '#FF00FF';
            ctx.font = 'bold 16px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(`MOTHERSHIP Lv.${this.level}`, this.x, barY - 8);
        }
    }

    // Calculate total remaining health
    getTotalHealth() {
        return this.weakPoints.reduce((sum, wp) => sum + (wp.destroyed ? 0 : wp.health), 0);
    }

    getMaxTotalHealth() {
        return this.weakPoints.reduce((sum, wp) => sum + wp.maxHealth, 0);
    }
}
