// 2D overlay for the 3D game: crosshair, HUD text (score, lives, level, rocks left), level
// banner, two-circle radar, edge markers, damage-direction arc, joystick, hit flash. (The cockpit
// frame was removed after the Pixel 7 Pro test, 2026-10-07: the text has a shadow instead.)
// Drawn on a 2D canvas layered over the WebGL canvas. formatHud() is pure (unit-testable);
// the draw functions only use the CanvasRenderingContext2D they are given.

const MODE_LABELS = { direct: 'Direct', rate: 'Rate', joystick: 'Joystick' };

/** HUD text lines from the game state (pure). */
export function formatHud(info) {
    const lives = Math.max(0, info.lives | 0);
    const level = info.level ? `   LEVEL ${info.level | 0}` : '';
    const rocks = Number.isFinite(info.rocksLeft) ? `   ROCKS ${info.rocksLeft | 0}` : '';
    const left = `SCORE ${info.score | 0}   LIVES ${'♥'.repeat(Math.min(lives, 9)) || '0'}${level}${rocks}`;
    const mode = MODE_LABELS[info.mode] || info.mode;
    const chosen = info.chosenMode && info.chosenMode !== info.mode ? ` (${MODE_LABELS[info.chosenMode] || info.chosenMode} unavailable)` : '';
    const view = info.view ? `View ${info.view} · ` : '';
    const right = `${mode}${chosen} · Level ${info.levelHorizon ? 'on' : 'off'} · ${view}${Math.round(info.fps || 0)} fps · ${(info.renderScale || 1).toFixed(2)}×`;
    const speed = `SPD ${Math.round(info.speed || 0)}`;
    return { left, right, speed };
}

export function drawCrosshair(ctx, w, h, color = 'rgba(180, 255, 220, 0.85)') {
    const cx = w / 2, cy = h / 2;
    const r = Math.max(10, Math.min(w, h) * 0.025);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 3;
    ctx.beginPath();
    ctx.moveTo(cx - r * 2, cy); ctx.lineTo(cx - r * 0.6, cy);
    ctx.moveTo(cx + r * 0.6, cy); ctx.lineTo(cx + r * 2, cy);
    ctx.moveTo(cx, cy - r * 2); ctx.lineTo(cx, cy - r * 0.6);
    ctx.moveTo(cx, cy + r * 0.6); ctx.lineTo(cx, cy + r * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
}

export function drawHudText(ctx, w, h, info, insets = { top: 0, left: 0, right: 0 }) {
    const t = formatHud(info);
    const fs = Math.max(12, Math.min(18, Math.round(h * 0.035)));
    ctx.save();
    ctx.font = `bold ${fs}px Arial, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#d8fff0';
    // No cockpit frame behind the text any more: a soft dark shadow keeps it readable on rocks and stars
    ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    ctx.textAlign = 'left';
    ctx.fillText(t.left, 12 + insets.left, 10 + insets.top);
    ctx.font = `${Math.round(fs * 0.8)}px Arial, sans-serif`;
    ctx.fillStyle = '#9fc0d8';
    ctx.fillText(t.speed, 12 + insets.left, 14 + fs + insets.top);
    ctx.textAlign = 'center';
    ctx.fillText(t.right, w / 2, h - Math.max(18, h * 0.06) + 4);
    if (info.message) {
        ctx.font = `bold ${fs}px Arial, sans-serif`;
        ctx.fillStyle = '#ffd27a';
        ctx.fillText(info.message, w / 2, h * 0.2);
    }
    ctx.restore();
}

/** Large centred banner ("LEVEL 2"), fading out over its last half second. t: seconds left. */
export function drawBanner(ctx, w, h, banner) {
    if (!banner || !banner.text) return;
    const fs = Math.max(24, Math.min(56, Math.round(h * 0.09)));
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, banner.t / 0.5));
    ctx.font = `bold ${fs}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#d8fff0';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
    ctx.shadowBlur = 6;
    ctx.fillText(banner.text, w / 2, h * 0.36);
    if (banner.sub) {
        ctx.font = `${Math.round(fs * 0.4)}px Arial, sans-serif`;
        ctx.fillStyle = '#9fc0d8';
        ctx.fillText(banner.sub, w / 2, h * 0.36 + fs * 0.75);
    }
    ctx.restore();
}

/**
 * Screen direction for a damage-direction arc from a ship-local vector to the cause
 * (x right, y up, -z the nose): radians, 0 = right, π/2 = up; straight ahead or behind
 * with no sideways part: down.
 */
export function damageAngle(local) {
    const [x, y] = local;
    return Math.hypot(x, y) < 1e-6 ? -Math.PI / 2 : Math.atan2(y, x);
}

/** Red arc at the screen edge toward where a hit came from. alpha: 0..1 (fades out). */
export function drawDamage(ctx, w, h, angle, alpha) {
    if (!(alpha > 0) || !Number.isFinite(angle)) return;
    const cx = w / 2, cy = h / 2;
    const rx = w / 2 - 18, ry = h / 2 - 18;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.strokeStyle = 'rgba(255, 60, 60, 0.9)';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(255, 0, 0, 0.8)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    // Canvas y is down: screen angle a is at (cos a, -sin a)
    const span = 0.35;
    for (let i = 0; i <= 12; i++) {
        const a = angle - span + (2 * span * i) / 12;
        const x = cx + Math.cos(a) * rx, y = cy - Math.sin(a) * ry;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
}

/** Floating joystick: base ring where the thumb landed, knob at the deflection. */
export function drawJoystick(ctx, stick) {
    if (!stick || !stick.active) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(stick.cx, stick.cy, stick.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(stick.cx + stick.x * stick.radius, stick.cy + stick.y * stick.radius, stick.radius * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

/** Red flash after a hit (alpha 0..1), green tint after a pickup. */
export function drawFlash(ctx, w, h, hit, collect) {
    if (hit > 0) {
        ctx.fillStyle = `rgba(255, 40, 40, ${Math.min(0.45, hit * 0.45)})`;
        ctx.fillRect(0, 0, w, h);
    }
    if (collect > 0) {
        ctx.fillStyle = `rgba(60, 255, 150, ${Math.min(0.18, collect * 0.18)})`;
        ctx.fillRect(0, 0, w, h);
    }
}

/** Radar glyph per type: diamond = crystal, × = red rock (later: saucer, ring = boss, square = power-up). */
function glyph(ctx, type, x, y, s) {
    ctx.beginPath();
    if (type === 'crystal') {
        ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.75, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s * 0.75, y); ctx.closePath();
        ctx.fill();
    } else if (type === 'rock') {
        ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s);
        ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s);
        ctx.stroke();
    } else if (type === 'boss') {
        ctx.arc(x, y, s, 0, Math.PI * 2);
        ctx.stroke();
    } else if (type === 'cluster') {
        // A cluster beyond the view distance: a faint ring on the rim
        ctx.arc(x, y, s * 1.8, 0, Math.PI * 2);
        ctx.stroke();
    } else if (type === 'powerup') {
        ctx.rect(x - s * 0.8, y - s * 0.8, s * 1.6, s * 1.6);
        ctx.fill();
    } else { // saucer and anything else: a flat ellipse
        ctx.ellipse(x, y, s * 1.2, s * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

/**
 * Two radar circles (radar3d.js buildRadar + radarLayout). colors: { collect, hazard } (the
 * palette's radar colours, colour-safe aware). time: seconds, for the threat flash.
 */
export function drawRadar(ctx, layout, radar, colors, time = 0) {
    if (!layout || !radar) return;
    const { r } = layout;
    const unit = r / 45;
    const flashOn = Math.floor(time * 6) % 2 === 0;
    ctx.save();
    for (const hemi of ['front', 'rear']) {
        const { cx, cy } = layout[hemi];
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(8, 16, 30, 0.45)';
        ctx.strokeStyle = 'rgba(150, 200, 240, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // 45° ring and a small centre cross
        ctx.strokeStyle = 'rgba(150, 200, 240, 0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, r / 2, 0, Math.PI * 2);
        ctx.moveTo(cx - 4, cy); ctx.lineTo(cx + 4, cy);
        ctx.moveTo(cx, cy - 4); ctx.lineTo(cx, cy + 4);
        ctx.stroke();
        // Label left of the circle (stacked layout) or above it
        ctx.font = `${Math.max(9, Math.round(10 * unit))}px Arial, sans-serif`;
        ctx.fillStyle = 'rgba(170, 210, 240, 0.7)';
        const text = hemi === 'front' ? '▲ FRONT' : '▼ REAR';
        if (layout.label === 'left') {
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, cx - r - 6, cy);
        } else {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(text, cx, cy - r - 2);
        }
        // Far first, so near blips are drawn on top
        const blips = [...radar[hemi]].sort((a, b) => a.near - b.near);
        for (const b of blips) {
            const color = b.type === 'crystal' ? colors.collect : colors.hazard;
            const x = cx + b.x * r;
            const y = cy - b.y * r;
            // The last rocks of a level stay clearly visible however far they are
            const near = b.last ? Math.max(b.near, 0.6) : b.near;
            const s = (b.beyond ? 2 : 2 + 3.5 * near) * unit;
            ctx.globalAlpha = b.beyond ? 0.3 : 0.4 + 0.6 * near;
            ctx.fillStyle = color;
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(1.5, 2 * unit);
            if (b.threat) {
                ctx.globalAlpha = flashOn ? 1 : 0.35;
                glyph(ctx, b.type, x, y, s * 1.3);
                ctx.beginPath();
                ctx.arc(x, y, s * 2.2, 0, Math.PI * 2);
                ctx.lineWidth = 1.5;
                ctx.stroke();
            } else {
                glyph(ctx, b.type, x, y, s);
            }
            if (b.beyond) {
                // Tick on the rim in the crystal's direction
                ctx.globalAlpha = 0.45;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(cx + b.rimX * (r - 5), cy - b.rimY * (r - 5));
                ctx.lineTo(cx + b.rimX * (r + 3), cy - b.rimY * (r + 3));
                ctx.stroke();
            }
        }
        ctx.globalAlpha = 1;
    }
    ctx.restore();
}

/** Arrow at the screen edge towards the nearest crystal (radar3d.js edgeMarker), with its distance. */
export function drawEdgeMarker(ctx, w, h, marker, color) {
    if (!marker) return;
    const margin = 46;
    const cx = w / 2, cy = h / 2;
    const dx = Math.cos(marker.angle), dy = -Math.sin(marker.angle); // canvas y is down
    const hw = w / 2 - margin, hh = h / 2 - margin;
    const k = Math.min(Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : Infinity);
    const x = cx + dx * k, y = cy + dy * k;
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.rotate(Math.atan2(dy, dx));
    ctx.beginPath();
    ctx.moveTo(16, 0); ctx.lineTo(-6, -10); ctx.lineTo(-2, 0); ctx.lineTo(-6, 10); ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.font = 'bold 12px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
    ctx.shadowBlur = 4;
    ctx.fillText(String(Math.round(marker.dist)), x - dx * 30, y - dy * 30);
    ctx.restore();
}
