// 2D overlay for the 3D prototype: crosshair, HUD text, joystick, hit flash. (The cockpit
// frame was removed after the Pixel 7 Pro test, 2026-10-07: the text has a shadow instead.)
// Drawn on a 2D canvas layered over the WebGL canvas. formatHud() is pure (unit-testable);
// the draw functions only use the CanvasRenderingContext2D they are given.

const MODE_LABELS = { direct: 'Direct', rate: 'Rate', joystick: 'Joystick' };

/** HUD text lines from the game state (pure). */
export function formatHud(info) {
    const lives = Math.max(0, info.lives | 0);
    const left = `SCORE ${info.score | 0}   LIVES ${'♥'.repeat(Math.min(lives, 9)) || '0'}`;
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
