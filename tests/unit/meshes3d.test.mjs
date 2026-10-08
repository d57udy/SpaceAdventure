// js/3d/meshes3d.js: the pure helpers, and the builders run on the real three.js objects in
// Node (no WebGLRenderer: geometry, instancing and per-frame placement only; shaders are not
// compiled here, the browser tests on CI cover drawing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../js/3d/vendor/three.module.min.js';
import {
    MESHES3D, smooth, blinkOn, spinScaleX, bossGlowOpacity, clampToFar, bossGlowSize, weakPointGlow, hyperspacePhase,
    POWERUP_GLYPHS, drawGlyph, mergeColored, ufoWobble, shieldAlpha,
    createUfoMeshes, createHostileBullets, createBossMeshes, createPowerUpMeshes, createShieldBubble, createMagnetHint,
    createHyperspaceEffect,
} from '../../js/3d/meshes3d.js';
import { PowerUpType } from '../../js/powerup.js';

// A canvas whose 2D context records every call
function fakeCanvas(w = 64, h = 64) {
    const calls = [];
    const ctx = new Proxy({ calls }, {
        get(t, k) {
            if (k in t) return t[k];
            return (...a) => { calls.push([k, ...a]); return { addColorStop() {} }; };
        },
        set(t, k, v) { t[k] = v; calls.push(['set', k, v]); return true; },
    });
    return { width: w, height: h, getContext: () => ctx, ctx };
}
const view = (o = {}) => ({ shipPos: [100, 100, 100], size: 3200, cullDistance: 1440, fogNear: 520, fogFar: 1440, camQ: [0, 0, 0, 1], far: 1640, ...o });
const pos = (m, i) => { const out = new THREE.Matrix4(); m.getMatrixAt(i, out); return new THREE.Vector3().setFromMatrixPosition(out); };

test('blink, spin and smoothstep', () => {
    assert.equal(smooth(0, 10, 20), 0);
    assert.equal(smooth(30, 10, 20), 1);
    assert.equal(smooth(15, 10, 20), 0.5);
    assert.equal(blinkOn(10, 0.37), true, 'steady before the last 3 s');
    const on = (life) => [...Array(80).keys()].map((i) => blinkOn(life, i / 80)).filter(Boolean).length;
    assert.ok(on(2) > 25 && on(2) < 55, 'about half the frames in the last 3 s');
    let flips2 = 0, flips05 = 0;
    for (let i = 1; i < 200; i++) {
        if (blinkOn(2, i / 200) !== blinkOn(2, (i - 1) / 200)) flips2++;
        if (blinkOn(0.5, i / 200) !== blinkOn(0.5, (i - 1) / 200)) flips05++;
    }
    assert.ok(flips05 > flips2, 'faster in the last second');
    for (let t = 0; t < 5; t += 0.07) {
        const s = spinScaleX(t, 1);
        assert.ok(s >= 0.25 - 1e-9 && s <= 1 + 1e-9);
    }
});

test('boss glow: faint up close, full in the fog, gone past 1.5 × the fog end', () => {
    const near = 520, far = 1440;
    assert.ok(Math.abs(bossGlowOpacity(100, near, far) - 0.25) < 1e-9);
    assert.ok(bossGlowOpacity(far, near, far) > 0.99);
    assert.ok(bossGlowOpacity(far * 1.25, near, far) > 0.3);
    assert.equal(bossGlowOpacity(far * 1.5, near, far), 0);
    assert.equal(bossGlowOpacity(far * 2, near, far), 0);
    assert.ok(bossGlowSize(2000) > bossGlowSize(100));
    assert.equal(bossGlowSize(10), MESHES3D.bossRadius * 3.2);
});

test('clampToFar keeps the direction and the on-screen size', () => {
    const a = clampToFar([0, 0, -500], 1000);
    assert.deepEqual(a, { pos: [0, 0, -500], scale: 1 });
    const b = clampToFar([0, 1200, -1600], 1000);
    const d = Math.hypot(...b.pos);
    assert.ok(Math.abs(d - 920) < 1e-6);
    assert.ok(Math.abs(b.scale - 920 / 2000) < 1e-9);
    assert.ok(Math.abs(b.pos[1] / b.pos[2] - 1200 / -1600) < 1e-9, 'same direction');
});

test('weak point glow follows health; destroyed is dark; a hit flares', () => {
    const full = weakPointGlow({ id: 0, health: 30, maxHealth: 30 }, 0);
    const half = weakPointGlow({ id: 0, health: 15, maxHealth: 30 }, 0);
    assert.ok(full.glow > half.glow);
    assert.equal(full.heat, 0);
    assert.equal(half.heat, 0.5);
    assert.deepEqual(weakPointGlow({ id: 0, health: 0, maxHealth: 30, destroyed: true }), { glow: 0, heat: 0, destroyed: true });
    assert.equal(weakPointGlow({ id: 0, health: 15, maxHealth: 30 }, 0, 0.1).glow, 1);
});

test('hyperspace phases', () => {
    assert.equal(hyperspacePhase(-1).active, false);
    assert.equal(hyperspacePhase(5).active, false);
    const mid = hyperspacePhase(MESHES3D.hyperspaceDuration / 2);
    assert.equal(mid.active, true);
    assert.ok(Math.abs(mid.tunnel - 1) < 1e-9);
    assert.ok(Math.abs(mid.flash - 1) < 1e-9);
    assert.equal(hyperspacePhase(0.01).flash, 0, 'no flash at the start');
    assert.ok(hyperspacePhase(0.05).tunnel > 0);
});

test('glyphs: the 7 2D power-ups, drawn as a framed symbol', () => {
    assert.equal(POWERUP_GLYPHS.length, 7);
    assert.deepEqual(POWERUP_GLYPHS.map((g) => g.id), Object.values(PowerUpType).map((t) => t.id));
    const sm = POWERUP_GLYPHS.find((g) => g.id === 'score_multiplier');
    assert.equal(sm.symbol, '2x');
    const c = fakeCanvas(128, 128);
    drawGlyph(c.ctx, 128, sm);
    const calls = c.ctx.calls;
    assert.ok(calls.some((x) => x[0] === 'stroke'), 'a frame');
    assert.ok(calls.some((x) => x[0] === 'set' && x[1] === 'strokeStyle' && x[2] === sm.color), 'in the type colour');
    const text = calls.find((x) => x[0] === 'fillText');
    assert.deepEqual(text.slice(1, 3), ['2x', 64]);
});

test('mergeColored: one geometry, a colour per part', () => {
    const g = mergeColored([
        { geometry: new THREE.BoxGeometry(1, 1, 1), color: 0xff0000 },
        { geometry: new THREE.BoxGeometry(1, 1, 1), color: 0x0000ff, matrix: new THREE.Matrix4().makeTranslation(5, 0, 0) },
    ]);
    const p = g.getAttribute('position'), c = g.getAttribute('color');
    assert.equal(p.count, 72);
    assert.equal(c.count, 72);
    assert.deepEqual([c.getX(0), c.getZ(0)], [1, 0]);
    assert.deepEqual([c.getX(71), c.getZ(71)], [0, 1]);
    g.computeBoundingBox();
    assert.ok(g.boundingBox.max.x > 5);
});

test('UFOs: nearest image, culling, max 6, three instanced meshes', () => {
    const u = createUfoMeshes();
    assert.equal(u.object3d.children.length, 3);
    assert.ok(u.object3d.children.every((m) => m.isInstancedMesh));
    assert.ok(u.object3d.children.every((m) => m.visible === false), 'no draw call while empty');
    const ufos = [
        { id: 1, pos: [100, 100, 3150], radius: 15 }, // across the seam: 150 behind... nearest image
        { id: 2, pos: [100, 100, 100 - 3000], radius: 15 }, // nearest image 200 ahead
        { id: 3, pos: [1700, 100, 100], radius: 15 }, // 1600 away: culled
        { id: 4, pos: [120, 100, 100], alive: false },
    ];
    for (let i = 0; i < 10; i++) ufos.push({ id: 10 + i, pos: [100 + i, 300, 100] });
    u.update({ ufos, view: view() }, 1.2);
    assert.equal(u.count, 6, 'capped at 6');
    const body = u.object3d.children[0];
    assert.equal(body.count, 6);
    assert.equal(body.visible, true);
    const p0 = pos(body, 0);
    assert.ok(Math.abs(p0.z - -150) < 1e-6, `wraps to the nearest image (${p0.z})`);
    assert.ok(Math.abs(pos(body, 1).z - 200) < 1e-6);
    const w = ufoWobble(3, 2);
    assert.ok(Math.abs(w.tiltX) <= 0.18 && Math.abs(w.tiltZ) <= 0.18);
    u.update({ ufos: [], view: view() }, 1.3);
    assert.equal(body.visible, false);
    u.dispose();
});

test('hostile bullets: colour by source, halo faces the camera, 2 meshes, max 200', () => {
    const b = createHostileBullets({ makeCanvas: fakeCanvas });
    const bullets = [
        { id: 1, pos: [100, 100, 50], from: 'ufo', radius: 3 },
        { id: 2, pos: [100, 150, 100], from: 'boss', radius: 4 },
    ];
    for (let i = 0; i < 250; i++) bullets.push({ id: 10 + i, pos: [100, 100, 100 - i], from: 'ufo' });
    b.update({ bullets, view: view({ camQ: [0, Math.SQRT1_2, 0, Math.SQRT1_2] }) }, 0);
    assert.equal(b.count, 200);
    const [core, halo] = b.object3d.children;
    const c0 = new THREE.Color(), c1 = new THREE.Color();
    halo.getColorAt(0, c0);
    halo.getColorAt(1, c1);
    assert.equal(c0.getHex(), MESHES3D.ufoBulletColor);
    assert.equal(c1.getHex(), MESHES3D.bossBulletColor);
    assert.notEqual(c0.getHex(), 0xffe680, 'never the player bullet colour');
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    halo.getMatrixAt(0, m);
    m.decompose(p, q, s);
    assert.ok(Math.abs(Math.abs(q.y) - Math.SQRT1_2) < 1e-6, 'billboard turned with the camera');
    assert.ok(s.x > 3 * 5, 'halo larger than the core');
    assert.equal(core.count, 200);
    b.dispose();
});

function bossState(o = {}) {
    const normals = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
    return {
        normals,
        state: {
            boss: {
                alive: true, pos: [100, 100, -400], q: [0, 0, 0, 1], flash: 0,
                weakPoints: normals.map((dir, id) => ({ id, dir, health: 30, maxHealth: 30, destroyed: false })),
                core: { health: 60, maxHealth: 60, destroyed: false },
                ...o,
            },
            view: view(),
        },
    };
}

test('boss: weak points at the normals, health colours, destroyed state, glow through the fog', () => {
    const { normals, state } = bossState();
    const boss = createBossMeshes({ normals, makeCanvas: fakeCanvas });
    boss.update(state, 0.5);
    assert.equal(boss.object3d.visible, true);
    const body = boss.object3d.children[0];
    const [, wp, halo] = body.children;
    assert.equal(wp.count, 4);
    assert.equal(halo.count, 4);
    assert.ok(pos(wp, 0).x > MESHES3D.bossRadius, 'on the surface along its normal');
    assert.ok(pos(wp, 3).z < -MESHES3D.bossRadius);
    assert.equal(boss.info.weakLit, 4);
    assert.equal(boss.info.bodyVisible, true);
    const near = boss.info.glowOpacity;
    // Damage, then destroy one
    state.boss.weakPoints[0].health = 5;
    state.boss.weakPoints[1].destroyed = true;
    state.boss.weakPoints[1].health = 0;
    boss.update(state, 0.5);
    assert.equal(wp.count, 4, 'a destroyed weak point stays as a dark crater');
    assert.equal(halo.count, 3);
    assert.equal(boss.info.weakLit, 3);
    const c = new THREE.Color();
    wp.getColorAt(1, c);
    assert.ok(c.r < 0.2 && c.g < 0.2, 'destroyed is dark');
    // Rotation applies to the whole group
    state.boss.q = [0, 1, 0, 0];
    boss.update(state, 0.5);
    assert.ok(Math.abs(body.quaternion.y - 1) < 1e-9);
    // Far away: body hidden past the cull distance, the glow still shows, pulled inside the far plane
    state.boss.pos = [1200, 1200, 100]; // about 1556 away: past the cull distance (1440)
    boss.update(state, 0.5);
    assert.equal(boss.info.bodyVisible, false);
    assert.ok(boss.info.glowOpacity > near);
    const glow = boss.object3d.children[1];
    const world = new THREE.Vector3().copy(boss.object3d.position).add(glow.position);
    assert.ok(world.length() <= 1640 * 0.92 + 1e-6, `glow inside the far plane (${world.length()})`);
    assert.equal(glow.material.fog, false);
    state.boss.pos = [1650, 1650, 1100]; // about 2400 away (a cube diagonal): past 1.5 × 1440
    boss.update(state, 0.5);
    assert.equal(boss.object3d.visible, false, 'nothing beyond 1.5 × the fog end');
    state.boss.alive = false;
    boss.update(state, 0.5);
    assert.equal(boss.object3d.visible, false);
    boss.dispose();
});

test('boss: turret flash, exposed core, damage flash', () => {
    const { normals, state } = bossState();
    const boss = createBossMeshes({ normals, makeCanvas: fakeCanvas });
    const flash = boss.object3d.children[0].children[3];
    boss.update(state, 0);
    assert.equal(flash.visible, false);
    boss.update({ ...state, turretFlash: 0.8, turretDir: [0, 0, 1] }, 0);
    assert.equal(flash.visible, true);
    assert.ok(flash.position.z > MESHES3D.bossRadius);
    const mat = boss.object3d.children[0].children[0].material;
    for (const w of state.boss.weakPoints) { w.destroyed = true; w.health = 0; }
    boss.update(state, 0.3);
    assert.ok(mat.emissive.r > 0.1 && mat.emissive.r > mat.emissive.g, 'core exposed: red pulse');
    state.boss.flash = 0.1;
    boss.update(state, 0.3);
    assert.ok(mat.emissive.g > 0.3, 'hit flash whitens');
    boss.dispose();
});

test('power-ups: one mesh per type, only types in play visible, blinking, max 10', () => {
    const made = [];
    const pu = createPowerUpMeshes({ makeCanvas: (w, h) => { const c = fakeCanvas(w, h); made.push(c); return c; } });
    assert.equal(made.length, 7, 'a glyph texture per type');
    assert.ok(made.every((c) => c.ctx.calls.some((x) => x[0] === 'fillText')));
    assert.equal(pu.object3d.children.length, 7);
    const list = [
        { id: 1, type: 'shield', pos: [100, 100, 0], life: 10 },
        { id: 2, type: 'magnet', pos: [100, 100, 50], life: 10 },
        { id: 3, type: 'shield', pos: [100, 100, 20], life: 10 },
        { id: 4, type: 'rapid_fire', pos: [100, 100, 3000], life: 10 }, // far side: wraps 300 behind
        { id: 5, type: 'nope', pos: [100, 100, 0], life: 10 },
    ];
    pu.update({ powerUps: list, view: view() }, 0.2);
    assert.equal(pu.count, 4);
    assert.deepEqual(pu.activeTypes.sort(), ['magnet', 'rapid_fire', 'shield']);
    assert.equal(pu.object3d.children.filter((m) => m.visible).length, 3);
    // Blink: a power-up in its last seconds is missing on some frames
    let seen = 0;
    for (let i = 0; i < 40; i++) { pu.update({ powerUps: [{ id: 1, type: 'shield', pos: [100, 100, 0], life: 1.5 }], view: view() }, i / 40); seen += pu.count; }
    assert.ok(seen > 5 && seen < 35, `blinking (${seen}/40)`);
    const many = Array.from({ length: 15 }, (_, i) => ({ id: i, type: 'magnet', pos: [100, 100, 100 - i * 10], life: 10 }));
    pu.update({ powerUps: many, view: view() }, 0);
    assert.equal(pu.count, MESHES3D.powerUpMax);
    pu.dispose();
});

test('shield bubble and magnet hint: visible only while active', () => {
    const sh = createShieldBubble();
    sh.update({ shield: 0 }, 0);
    assert.equal(sh.object3d.visible, false);
    sh.update({ shield: 5 }, 0);
    assert.equal(sh.object3d.visible, true);
    assert.ok(sh.alpha > 0.2);
    assert.equal(sh.object3d.material.side, THREE.BackSide, 'seen from inside');
    sh.update({ shield: 0, shieldHit: 0.5 }, 0);
    assert.equal(sh.object3d.visible, true, 'the breaking flare shows after the shield is gone');
    assert.ok(shieldAlpha(1, 0.15) < shieldAlpha(5, 0.15), 'flickers in the last 2 s');
    assert.equal(shieldAlpha(0, 0), 0);
    sh.dispose();
    const mg = createMagnetHint();
    mg.update({ magnet: 0 }, 0);
    assert.equal(mg.visible, false);
    mg.update({ magnet: 6, magnetRange: 220 }, 1);
    assert.equal(mg.visible, true);
    assert.equal(mg.object3d.scale.x, 220);
    mg.dispose();
});

test('hyperspace effect: runs for its duration, then hides', () => {
    const h = createHyperspaceEffect();
    h.update({});
    assert.equal(h.object3d.visible, false);
    h.update({ hyperspace: 0.1 });
    assert.equal(h.object3d.visible, true);
    h.update({ hyperspace: MESHES3D.hyperspaceDuration / 2 });
    assert.equal(h.object3d.children[1].visible, true, 'flash at the jump');
    assert.ok(h.object3d.children[1].material.opacity > 0.9);
    assert.ok(h.object3d.children[0].material.uniforms.uOffset.value > 0, 'streaks move');
    h.update({ hyperspace: 2 });
    assert.equal(h.object3d.visible, false);
    h.dispose();
});

// --- Regression test for docs/plans/07-review.md
import { seamFade } from '../../js/3d/meshes3d.js';

test('review #6: the boss glow fades out before its nearest image switches sides', () => {
    assert.equal(seamFade([0, 0, -1000], 3200), 1);
    assert.equal(seamFade([0, 1600, 0], 3200), 0);
    assert.ok(seamFade([1500, 0, 0], 3200) < 0.5);
    const { normals, state } = bossState();
    const boss = createBossMeshes({ normals, makeCanvas: fakeCanvas });
    state.boss.pos = [100 + 1590, 100, 100]; // 1590 along x: about to flip
    boss.update(state, 0);
    assert.ok(boss.info.glowOpacity < 0.05, `${boss.info.glowOpacity}`);
    state.boss.pos = [100 + 1100, 100 + 1100, 100]; // 1556 away, both axes well inside
    boss.update(state, 0);
    assert.ok(boss.info.glowOpacity > 0.3);
    // The turret flash from boss3d's own state
    state.boss.turretFlash = 1;
    state.boss.turretDir = [1, 0, 0];
    state.boss.pos = [100, 100, -400];
    boss.update(state, 0);
    assert.equal(boss.object3d.children[0].children[3].visible, true);
    boss.dispose();
});

test('reduced motion: no shield flicker (a smooth fade instead), calm boss pulsing', () => {
    // Normal: the last 2 s flicker between two levels; reduced: steady at any instant, fading with time left
    const flick = new Set(), calm = new Set();
    for (let i = 0; i < 40; i++) { flick.add(shieldAlpha(1, i / 40).toFixed(3)); calm.add(shieldAlpha(1, i / 40, 0, true).toFixed(3)); }
    assert.ok(flick.size >= 2);
    assert.equal(calm.size, 1);
    assert.ok(shieldAlpha(0.5, 0, 0, true) < shieldAlpha(1.5, 0, 0, true), 'fades as it runs out');
    assert.ok(shieldAlpha(5, 0, 1, true) < shieldAlpha(5, 0, 1), 'smaller hit flare');
    const sh = createShieldBubble();
    sh.update({ shield: 5, reducedMotion: true }, 10);
    assert.ok(sh.object3d.material.uniforms.uTime.value < 10, 'slow shimmer');
    sh.dispose();
    // Weak points: no pulse
    const w = { id: 1, health: 30, maxHealth: 30 };
    const g = [0, 0.3, 0.6, 0.9].map((t) => weakPointGlow(w, t, 0, true).glow);
    assert.ok(g.every((x) => x === g[0]));
    assert.ok(new Set([0, 0.3, 0.6].map((t) => weakPointGlow(w, t).glow)).size > 1);
    // Exposed core: a small, slow pulse
    const { normals, state } = bossState();
    for (const x of state.boss.weakPoints) { x.destroyed = true; x.health = 0; }
    const boss = createBossMeshes({ normals, makeCanvas: fakeCanvas });
    const mat = boss.object3d.children[0].children[0].material;
    const range = (reducedMotion) => {
        const v = [];
        for (let i = 0; i < 30; i++) { boss.update({ ...state, reducedMotion }, i / 30); v.push(mat.emissive.r); }
        return Math.max(...v) - Math.min(...v);
    };
    assert.ok(range(true) < range(false) / 3, `${range(true)} vs ${range(false)}`);
    boss.dispose();
});
