import { Entity } from './entity.js';
import { randomRange } from './utils.js';

// Power-up types and their properties
export const PowerUpType = {
    RAPID_FIRE: {
        id: 'rapid_fire',
        name: 'Rapid Fire',
        color: '#FF6600',
        duration: 8,
        symbol: 'R'
    },
    TRIPLE_SHOT: {
        id: 'triple_shot',
        name: 'Triple Shot',
        color: '#FF00FF',
        duration: 10,
        symbol: 'T'
    },
    SHIELD: {
        id: 'shield',
        name: 'Shield',
        color: '#00FFFF',
        duration: 6,
        symbol: 'S'
    },
    SPEED_BOOST: {
        id: 'speed_boost',
        name: 'Speed Boost',
        color: '#FFFF00',
        duration: 8,
        symbol: '>'
    },
    MAGNET: {
        id: 'magnet',
        name: 'Magnet',
        color: '#FF69B4',
        duration: 10,
        symbol: 'M'
    },
    EXTRA_LIFE: {
        id: 'extra_life',
        name: 'Extra Life',
        color: '#00FF00',
        duration: 0, // Instant effect
        symbol: '+'
    },
    SCORE_MULTIPLIER: {
        id: 'score_multiplier',
        name: '2x Score',
        color: '#FFD700',
        duration: 12,
        symbol: '2x'
    }
};

// Array of all power-up types for random selection
const POWER_UP_TYPES = Object.values(PowerUpType);

export class PowerUp extends Entity {
    constructor(x, y, type = null) {
        super(x, y, 12); // Radius for collision and display

        // Random type if not specified
        this.type = type || POWER_UP_TYPES[Math.floor(Math.random() * POWER_UP_TYPES.length)];

        // Visual properties
        this.pulsePhase = Math.random() * Math.PI * 2;
        this.rotationAngle = 0;

        // Lifetime - power-ups disappear after a while
        this.lifetime = 15; // seconds before disappearing
        this.blinkStart = 3; // Start blinking when this many seconds left
    }

    update(deltaTime, canvasWidth, canvasHeight) {
        // Update visual effects
        this.pulsePhase += deltaTime * 3;
        this.rotationAngle += deltaTime * 2;

        // Decrease lifetime
        this.lifetime -= deltaTime;
        if (this.lifetime <= 0) {
            this.isAlive = false;
        }
    }

    draw(ctx) {
        if (!this.isAlive) return;

        // Blink when about to expire
        if (this.lifetime < this.blinkStart) {
            if (Math.floor(this.lifetime * 4) % 2 === 0) return;
        }

        const pulse = 1 + Math.sin(this.pulsePhase) * 0.2;
        const r = this.radius * pulse;

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotationAngle);

        // Outer glow
        ctx.strokeStyle = this.type.color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(0, 0, r + 4, 0, Math.PI * 2);
        ctx.stroke();

        // Main hexagon shape
        ctx.globalAlpha = 1;
        ctx.strokeStyle = this.type.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const px = Math.cos(angle) * r;
            const py = Math.sin(angle) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();

        // Inner symbol
        ctx.rotate(-this.rotationAngle); // Counter-rotate for readable text
        ctx.fillStyle = this.type.color;
        ctx.font = `bold ${r}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.type.symbol, 0, 0);

        ctx.restore();
    }

    // Static method to spawn a power-up at a random position.
    // rng: optional seeded generator (js/rng.js) for the position and type (Time Attack).
    static spawnRandom(worldWidth, worldHeight, margin = 50, rng = null) {
        const x = randomRange(margin, worldWidth - margin, rng);
        const y = randomRange(margin, worldHeight - margin, rng);
        return new PowerUp(x, y, rng ? PowerUp.getRandomType(rng) : null);
    }

    // Static method to spawn a specific type
    static spawnType(x, y, type) {
        return new PowerUp(x, y, type);
    }

    // Get a random power-up type (weighted - extra life is rarer)
    static getRandomType(rng = null) {
        const rand = (rng || Math.random)();
        if (rand < 0.05) return PowerUpType.EXTRA_LIFE; // 5% chance
        if (rand < 0.15) return PowerUpType.SHIELD; // 10% chance
        if (rand < 0.30) return PowerUpType.TRIPLE_SHOT; // 15% chance
        if (rand < 0.50) return PowerUpType.RAPID_FIRE; // 20% chance
        if (rand < 0.70) return PowerUpType.SPEED_BOOST; // 20% chance
        if (rand < 0.85) return PowerUpType.MAGNET; // 15% chance
        return PowerUpType.SCORE_MULTIPLIER; // 15% chance
    }
}
