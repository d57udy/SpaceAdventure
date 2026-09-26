// Particle system for explosions, collections and shatters. DOM-free (draws on a given ctx).
// Each particle has a shape so effects read without colour:
//   dot   - round spark (collect sparkles, generic explosions)
//   shard - tumbling line segment (hazard rock shattering)
//   ring  - expanding circle outline (collect pickup)
export const ParticleShape = Object.freeze({ DOT: 'dot', SHARD: 'shard', RING: 'ring' });

export const Particles = {
    particles: [],

    spawn(x, y, count, color, speed = 100, lifetime = 0.5, size = 3, shape = ParticleShape.DOT) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const vel = speed * (0.5 + Math.random() * 0.5);
            this.particles.push({
                x, y,
                velX: Math.cos(angle) * vel,
                velY: Math.sin(angle) * vel,
                color,
                size: size * (0.5 + Math.random() * 0.5),
                lifetime,
                timer: lifetime,
                shape,
                angle: Math.random() * Math.PI * 2,
                spin: (Math.random() - 0.5) * 16, // radians per second (shards tumble)
            });
        }
    },

    // Explosion effect
    explode(x, y, color = '#FF6600', count = 20) {
        this.spawn(x, y, count, color, 150, 0.8, 4);
        // Add some white sparks
        this.spawn(x, y, count / 2, '#FFFFFF', 200, 0.4, 2);
    },

    // Collection: round sparkle burst plus an expanding ring
    collect(x, y, color = '#00FF00') {
        this.spawn(x, y, 12, color, 80, 0.6, 3);
        this.particles.push({
            x, y, velX: 0, velY: 0, color, size: 6, lifetime: 0.45, timer: 0.45,
            shape: ParticleShape.RING, angle: 0, spin: 0,
        });
    },

    // Hazard rock destroyed: tumbling line-segment shards (8-12)
    shatter(x, y, color = '#CC0000', count = 10) {
        const n = Math.max(8, Math.min(12, Math.round(count)));
        this.spawn(x, y, n, color, 140, 0.7, 9, ParticleShape.SHARD);
    },

    update(deltaTime) {
        this.particles = this.particles.filter(p => {
            p.timer -= deltaTime;
            p.x += p.velX * deltaTime;
            p.y += p.velY * deltaTime;
            p.velX *= 0.98;
            p.velY *= 0.98;
            p.angle += p.spin * deltaTime;
            return p.timer > 0;
        });
    },

    draw(ctx, cameraX, cameraY) {
        this.particles.forEach(p => {
            const alpha = p.timer / p.lifetime;
            const screenX = p.x - cameraX;
            const screenY = p.y - cameraY;

            ctx.save();
            ctx.globalAlpha = alpha;
            if (p.shape === ParticleShape.SHARD) {
                const half = p.size / 2;
                const dx = Math.cos(p.angle) * half, dy = Math.sin(p.angle) * half;
                ctx.strokeStyle = p.color;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(screenX - dx, screenY - dy);
                ctx.lineTo(screenX + dx, screenY + dy);
                ctx.stroke();
            } else if (p.shape === ParticleShape.RING) {
                ctx.strokeStyle = p.color;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(screenX, screenY, p.size + (1 - alpha) * 30, 0, Math.PI * 2);
                ctx.stroke();
            } else {
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(screenX, screenY, p.size * alpha, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        });
    },

    // Count per shape (read by the test hook)
    countByShape() {
        const out = { dot: 0, shard: 0, ring: 0 };
        for (const p of this.particles) out[p.shape] = (out[p.shape] || 0) + 1;
        return out;
    },

    clear() {
        this.particles = [];
    }
};
