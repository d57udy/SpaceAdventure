import { Entity } from './entity.js';
import { randomRange, degToRad } from './utils.js';
import { Palettes } from './palette.js';

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
const ASTEROID_ROTATION_SPEED_MAX = 90; // Max degrees per second rotation
const GREEN_GLOW_PULSE_SPEED = 2; // Speed of green asteroid pulse

// Shapes carry the collect/hazard meaning independently of colour (colour-blind play):
// collectibles are smooth faceted crystals, hazards are spiky star-shaped rocks.
const CRYSTAL_JITTER = 0.08;          // vertices within [0.92r, r]
const CRYSTAL_VERTICES = { 40: 10, 30: 9, 20: 8 }; // by radius (LARGE, MEDIUM, SMALL)
const SPIKY_TIP_MIN = 0.95;           // tips within [0.95r, r]; one tip always at r
const SPIKY_VALLEY_MIN = 0.55;        // valleys within [0.55r, 0.7r]
const SPIKY_VALLEY_MAX = 0.7;
const FACET_MIN_RADIUS = 22;          // no facet lines on smaller crystals (readability)

export function generateCrystalShape(radius, numVertices, random = Math.random) {
    const vertices = [];
    const step = (Math.PI * 2) / numVertices;
    const phase = random() * step;
    for (let i = 0; i < numVertices; i++) {
        const angle = phase + i * step;
        const r = radius * (1 - random() * CRYSTAL_JITTER);
        vertices.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
    }
    return vertices;
}

// Star outline: `tips` spikes alternating with valleys (2 * tips vertices, tip first).
export function generateSpikyShape(radius, tips, random = Math.random) {
    const vertices = [];
    const step = Math.PI / tips;
    const fullTip = Math.floor(random() * tips); // this tip reaches exactly `radius`
    for (let i = 0; i < tips * 2; i++) {
        const angle = i * step + (random() - 0.5) * step * 0.3;
        const isTip = i % 2 === 0;
        let f;
        if (isTip) f = i / 2 === fullTip ? 1 : SPIKY_TIP_MIN + random() * (1 - SPIKY_TIP_MIN);
        else f = SPIKY_VALLEY_MIN + random() * (SPIKY_VALLEY_MAX - SPIKY_VALLEY_MIN);
        vertices.push({ x: Math.cos(angle) * radius * f, y: Math.sin(angle) * radius * f });
    }
    return vertices;
}

function tracePath(ctx, vertices) {
    ctx.beginPath();
    ctx.moveTo(vertices[0].x, vertices[0].y);
    for (let i = 1; i < vertices.length; i++) ctx.lineTo(vertices[i].x, vertices[i].y);
    ctx.closePath();
}

// Crystal body in local (rotated) coordinates. pulse 0..1.
function drawCrystalBody(ctx, vertices, radius, pulse, palette) {
    tracePath(ctx, vertices);
    // Outer glow: wide low-alpha strokes of the same path. Much cheaper than shadowBlur
    // (a per-draw Gaussian blur, costly on HiDPI backing stores) and the same everywhere.
    ctx.lineJoin = 'round';
    ctx.strokeStyle = palette.collectRgba(0.12 * pulse);
    ctx.lineWidth = 2 + 14 * pulse;
    ctx.stroke();
    ctx.strokeStyle = palette.collectRgba(0.22 * pulse);
    ctx.lineWidth = 2 + 7 * pulse;
    ctx.stroke();

    ctx.fillStyle = palette.collectFill(0.25 + 0.2 * pulse);
    ctx.fill();
    ctx.strokeStyle = palette.collectRgba(0.6 + 0.4 * pulse);
    ctx.lineWidth = 2;
    ctx.stroke();

    // Facets: lines from the centre to every other vertex
    if (radius >= FACET_MIN_RADIUS) {
        ctx.beginPath();
        for (let i = 0; i < vertices.length; i += 2) {
            ctx.moveTo(0, 0);
            ctx.lineTo(vertices[i].x, vertices[i].y);
        }
        ctx.strokeStyle = palette.collectRgba(0.45);
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

// Small fixed highlight (upper left, does not rotate) so crystals read as shiny
function drawCrystalHighlight(ctx, radius) {
    ctx.beginPath();
    ctx.arc(-radius * 0.35, -radius * 0.35, Math.max(1.5, radius * 0.1), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.fill();
}

function drawSpikyBody(ctx, vertices, palette) {
    tracePath(ctx, vertices);
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 10;
    ctx.fillStyle = palette.hazardFill(0.85);
    ctx.fill();
    ctx.strokeStyle = palette.hazard;
    ctx.lineWidth = 2.5;
    ctx.stroke();
}

// Hazard mark: an X in a circle at the centre, kept upright (not rotating)
function drawHazardMark(ctx, radius, palette) {
    const m = radius * 0.32;
    const d = m * 0.55;
    ctx.beginPath();
    ctx.arc(0, 0, m, 0, Math.PI * 2);
    ctx.moveTo(-d, -d);
    ctx.lineTo(d, d);
    ctx.moveTo(d, -d);
    ctx.lineTo(-d, d);
    ctx.strokeStyle = palette.hazard;
    ctx.lineWidth = Math.max(1.5, radius * 0.06);
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';
}

// Deterministic icon shapes (no Math.random while rendering menus and help)
const ICON_CRYSTAL = generateCrystalShape(1, 9, () => 0.5);
const ICON_SPIKY = generateSpikyShape(1, 7, () => 0.5);
const scaleShape = (shape, r) => shape.map((v) => ({ x: v.x * r, y: v.y * r }));

export class Asteroid extends Entity {
    // Current colour palette (js/palette.js); main.js assigns it from the settings
    static palette = Palettes.STANDARD;

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

        // Shape depends on the type (known before the shape is built)
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
        if (this.type === AsteroidType.GREEN) {
            const n = CRYSTAL_VERTICES[this.radius] || 9;
            return generateCrystalShape(this.radius, n);
        }
        return generateSpikyShape(this.radius, this.sizeInfo.points);
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
        const palette = Asteroid.palette;
        ctx.save();
        ctx.translate(this.x, this.y);
        if (this.type === AsteroidType.GREEN) {
            const pulse = 0.5 + 0.5 * Math.sin(this.pulseTimer);
            ctx.save();
            ctx.rotate(this.rotation);
            drawCrystalBody(ctx, this.shapeVertices, this.radius, pulse, palette);
            ctx.restore();
            drawCrystalHighlight(ctx, this.radius);
        } else {
            ctx.save();
            ctx.rotate(this.rotation);
            drawSpikyBody(ctx, this.shapeVertices, palette);
            ctx.restore();
            drawHazardMark(ctx, this.radius, palette);
        }
        ctx.restore();
    }

    // Small still icon of a collectible ('green') or hazard ('red') in the current palette,
    // shared by the menu, the Help screen and anything else that explains the game.
    static drawIcon(ctx, type, x, y, r, palette = Asteroid.palette) {
        ctx.save();
        ctx.translate(x, y);
        if (type === AsteroidType.GREEN) {
            // Facets always shown on icons (they are what makes the crystal readable)
            drawCrystalBody(ctx, scaleShape(ICON_CRYSTAL, r), Math.max(r, FACET_MIN_RADIUS), 0.7, palette);
            drawCrystalHighlight(ctx, r);
        } else {
            drawSpikyBody(ctx, scaleShape(ICON_SPIKY, r), palette);
            drawHazardMark(ctx, r * 1.15, palette);
        }
        ctx.restore();
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