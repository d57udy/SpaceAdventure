// three.js object builders for the 3D game's Phase 2 and 3 content (docs/plans/07-3d-game.md
// §2.4 to §2.8): UFOs, hostile bullets, the boss, power-ups, the shield bubble, the magnet
// hint and the hyperspace effect. render3d.js owns the scene and calls these; this module
// only builds and updates objects (render3d.js stays the owner of the WebGLRenderer, and its
// radial fog patch of THREE.ShaderChunk applies to every fogged material built here).
//
// Every builder returns { object3d, update(state, time), dispose() }:
//   - object3d: add it to the scene. The camera sits at the origin (floating origin), so the
//     ship-centred effects (shield, magnet, hyperspace) are built around (0, 0, 0); the
//     hyperspace effect is the one exception and goes under the camera (it is screen-fixed).
//   - update(state, time): state carries the sim objects plus `view` (see VIEW below);
//     time is the wall clock in seconds (animation only, never gameplay).
//   - dispose(): frees the geometries, materials and textures the builder made.
//
// VIEW: { shipPos, size, cullDistance, fogNear, fogFar, camQ: [x, y, z, w], far } — the
// same numbers render3d.js uses (worldFor() plus the camera's far plane). Objects are placed
// at their nearest image relative to the ship (world3d.nearestDelta), like the rocks.
//
// Draw calls (when on screen): UFOs 3, hostile bullets 2, boss 5 (+1 turret flash), each
// power-up type in play 1 (at most 7, usually 1 or 2), shield 1, magnet 1, hyperspace 2.
//
// Pure helpers (no WebGL) are exported for the unit tests: blink and spin timing, the boss
// glow fade and far-plane clamp, weak-point glow, hyperspace phases, glyph drawing.

import * as THREE from './vendor/three.module.min.js';
import { nearestDelta } from './world3d.js';
import { PowerUpType } from '../powerup.js';

export const MESHES3D = Object.freeze({
    ufoMax: 6,
    ufoColor: 0x9933ff,          // the 2D UFO purple (js/ufo.js), never a collect or hazard hue
    ufoRadius: 15,               // ufo3d UFO3D.radius
    bulletMax: 200,
    ufoBulletColor: 0xff4dff,    // magenta; the player's bullets are 0xffe680
    bossBulletColor: 0xff7a3d,
    hostileBulletRadius: 3,
    bossRadius: 150,             // boss3d BOSS3D.bodyRadius
    weakPointRadius: 26,         // boss3d BOSS3D.weakPointRadius
    bossGlowReach: 1.5,          // the boss glow shows up to 1.5 × the fog end (plan §2.6)
    powerUpMax: 10,
    powerUpSize: 26,             // billboard side (world units)
    blinkStart: 3,               // powerup3d POWERUP3D.blinkStart
    glyphPx: 128,                // glyph texture side
    shieldRadius: 14,
    shieldWarn: 2,               // the bubble flickers in its last 2 s
    hyperspaceDuration: 0.7,
});

export const VIEW_DEFAULTS = Object.freeze({
    shipPos: [0, 0, 0], size: 3200, cullDistance: 1440, fogNear: 520, fogFar: 1440, camQ: [0, 0, 0, 1], far: 1640,
});
const viewOf = (state) => ({ ...VIEW_DEFAULTS, ...((state && state.view) || {}) });

// --- pure helpers

const clamp01 = (x) => Math.min(1, Math.max(0, x));
/** three.js smoothstep fog factor: 0 clear, 1 fully fogged. */
export function smooth(dist, near, far) {
    const t = clamp01((dist - near) / Math.max(1e-6, far - near));
    return t * t * (3 - 2 * t);
}

/** Is a blinking object drawn this frame? Steady until `blinkStart` s are left, then 4 Hz, 8 Hz in the last second. */
export function blinkOn(lifeLeft, time, blinkStart = MESHES3D.blinkStart) {
    if (!(lifeLeft < blinkStart)) return true;
    const hz = lifeLeft < 1 ? 8 : 4;
    return Math.floor(time * hz * 2) % 2 === 0;
}

/** Coin-spin width of a billboard (0.25 .. 1): the glyph never mirrors, it narrows and widens. */
export function spinScaleX(time, phase = 0, speed = 2.2) {
    return 0.25 + 0.75 * Math.abs(Math.cos(time * speed + phase));
}

/**
 * Opacity of the boss glow sprite at a distance: faint up close (the body is visible), full
 * where the fog hides the body, fading out between the fog end and reach × fog end.
 */
export function bossGlowOpacity(dist, fogNear, fogFar, reach = MESHES3D.bossGlowReach) {
    const inFog = 0.25 + 0.75 * smooth(dist, fogNear, fogFar);
    const out = 1 - smooth(dist, fogFar, fogFar * reach);
    return clamp01(inFog * out);
}

/**
 * A billboard beyond the camera's far plane is moved in along its direction and shrunk by
 * the same ratio, so it keeps its size on screen. Returns { pos: [x,y,z], scale } (scale 1:
 * not moved). limit: the largest distance allowed (default 0.92 × far).
 */
export function clampToFar(rel, far, limit = far * 0.92) {
    const d = Math.hypot(rel[0], rel[1], rel[2]);
    if (!(d > limit)) return { pos: rel.slice(), scale: 1 };
    const k = limit / d;
    return { pos: [rel[0] * k, rel[1] * k, rel[2] * k], scale: k };
}

/**
 * Fade for an object drawn beyond the cull distance (the boss glow): toward half the cube
 * along any axis its nearest image is about to switch to the opposite side, so it fades out
 * between 0.42 and 0.5 × size there instead of jumping across the sky (review #6).
 */
export function seamFade(delta, size) {
    const m = Math.max(Math.abs(delta[0]), Math.abs(delta[1]), Math.abs(delta[2]));
    return 1 - smooth(m, size * 0.42, size * 0.5);
}

/** Boss glow sprite side: large enough to find from far away (about 4 % of the distance). */
export function bossGlowSize(dist, radius = MESHES3D.bossRadius) {
    return Math.max(radius * 3.2, dist * 0.42);
}

/**
 * A weak point's glow (0..1) and colour weight from its health: full health glows brightest,
 * a damaged one dims, a destroyed one is dark; a hit (flash > 0) flares it. Pulses gently.
 */
export function weakPointGlow(w, time = 0, flash = 0) {
    if (!w || w.destroyed) return { glow: 0, heat: 0, destroyed: true };
    const frac = w.maxHealth > 0 ? clamp01(w.health / w.maxHealth) : 1;
    const pulse = 0.85 + 0.15 * Math.sin(time * 4 + (Number(w.id) || 0));
    return { glow: clamp01((0.35 + 0.65 * frac) * pulse + flash * 10), heat: 1 - frac, destroyed: false }; // boss3d flash: 0.1 on a hit
}

/**
 * Hyperspace effect phases at t seconds after the jump began: the tunnel streaks in and out,
 * the white flash peaks at the middle (when the ship moves). All 0 before and after.
 */
export function hyperspacePhase(t, duration = MESHES3D.hyperspaceDuration) {
    if (!(t >= 0) || t > duration) return { active: false, tunnel: 0, flash: 0, speed: 0 };
    const u = t / duration;
    const tunnel = Math.sin(Math.PI * u);
    const flash = Math.max(0, 1 - Math.abs(u - 0.5) / 0.18);
    return { active: true, tunnel, flash, speed: 2 + 10 * tunnel };
}

/** The 7 power-up glyphs (2D symbols and colours, js/powerup.js), in PowerUpType order. */
export const POWERUP_GLYPHS = Object.freeze(Object.values(PowerUpType).map((t) => Object.freeze({
    id: t.id, symbol: t.symbol, color: t.color, name: t.name,
})));

/**
 * Draw a power-up glyph on a 2D canvas context of side `px`: a glowing rounded square in the
 * type's colour and the 2D symbol. Shapes as 2D: a square frame (power-ups are squares on the
 * radar too), so the meaning never depends on colour alone.
 */
export function drawGlyph(ctx, px, glyph) {
    const r = px * 0.16;
    const m = px * 0.1;
    ctx.clearRect(0, 0, px, px);
    ctx.save();
    ctx.shadowColor = glyph.color;
    ctx.shadowBlur = px * 0.08;
    ctx.fillStyle = 'rgba(10,12,30,0.78)';
    ctx.strokeStyle = glyph.color;
    ctx.lineWidth = px * 0.07;
    ctx.beginPath();
    ctx.moveTo(m + r, m);
    ctx.lineTo(px - m - r, m);
    ctx.quadraticCurveTo(px - m, m, px - m, m + r);
    ctx.lineTo(px - m, px - m - r);
    ctx.quadraticCurveTo(px - m, px - m, px - m - r, px - m);
    ctx.lineTo(m + r, px - m);
    ctx.quadraticCurveTo(m, px - m, m, px - m - r);
    ctx.lineTo(m, m + r);
    ctx.quadraticCurveTo(m, m, m + r, m);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(px * (glyph.symbol.length > 1 ? 0.4 : 0.52))}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph.symbol, px / 2, px / 2 + px * 0.03);
    ctx.restore();
}

// --- three.js helpers

/**
 * Merge geometries into one non-indexed geometry with a vertex colour per part (one draw
 * call for a multi-part object). parts: [{ geometry, color: 0xRRGGBB, matrix?: Matrix4 }].
 */
export function mergeColored(parts) {
    const pos = [], nor = [], col = [];
    const c = new THREE.Color();
    for (const p of parts) {
        const g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry.clone();
        if (p.matrix) g.applyMatrix4(p.matrix);
        if (!g.getAttribute('normal')) g.computeVertexNormals();
        const a = g.getAttribute('position'), n = g.getAttribute('normal');
        c.set(p.color);
        for (let i = 0; i < a.count; i++) {
            pos.push(a.getX(i), a.getY(i), a.getZ(i));
            nor.push(n.getX(i), n.getY(i), n.getZ(i));
            col.push(c.r, c.g, c.b);
        }
        g.dispose();
        p.geometry.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return out;
}

function defaultCanvas(w, h) {
    const c = globalThis.document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
}

/** Soft round glow (white; tinted by the material or instance colour). */
export function glowTexture(makeCanvas = defaultCanvas) {
    const c = makeCanvas(64, 64);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

/** A fixed-capacity InstancedMesh, hidden while empty (no draw call). */
function fixedInstanced(geo, mat, max, { colors = false } = {}) {
    const mesh = new THREE.InstancedMesh(geo, mat, max);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (colors) {
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    mesh.frustumCulled = false; // instances move every frame; the GPU clips
    mesh.count = 0;
    mesh.visible = false;
    let n = 0;
    return {
        mesh, max,
        begin() { n = 0; },
        push(m, color) {
            if (n >= max) return false;
            mesh.setMatrixAt(n, m);
            if (colors && color) mesh.setColorAt(n, color);
            n++;
            return true;
        },
        end() {
            mesh.count = n;
            mesh.visible = n > 0;
            mesh.instanceMatrix.needsUpdate = true;
            if (colors) mesh.instanceColor.needsUpdate = true;
        },
        get count() { return n; },
    };
}

const _rel = (pos, v) => nearestDelta(v.shipPos, pos, v.size);
const dist3 = (d) => Math.hypot(d[0], d[1], d[2]);
const camQuat = (v, out = new THREE.Quaternion()) => out.set(v.camQ[0], v.camQ[1], v.camQ[2], v.camQ[3]);

function disposeAll(list) {
    for (const x of list) if (x && x.dispose) x.dispose();
}

// --- UFOs

/** Saucer wobble (radians) for a UFO id at time t: a slow tilt, never upside down. */
export function ufoWobble(time, id = 0) {
    const ph = (Number(id) || 0) * 1.7;
    return { tiltX: 0.18 * Math.sin(time * 1.3 + ph), tiltZ: 0.18 * Math.cos(time * 1.1 + ph), spin: time * 1.6 + ph };
}

/**
 * Purple saucers (max 6): a body (disc and under-ring, vertex colours), a translucent dome
 * and 8 rim lights that chase around the rim. Three InstancedMeshes, 3 draw calls.
 * state: { ufos: [{ id, pos, radius, alive }], view }.
 */
export function createUfoMeshes({ max = MESHES3D.ufoMax } = {}) {
    const R = 1; // unit saucer, scaled to the UFO radius per instance
    const flat = new THREE.Matrix4().makeScale(1, 0.28, 1);
    const under = new THREE.Matrix4().makeTranslation(0, -0.2, 0).multiply(new THREE.Matrix4().makeScale(0.55, 0.2, 0.55));
    const bodyGeo = mergeColored([
        { geometry: new THREE.SphereGeometry(R, 24, 10), color: MESHES3D.ufoColor, matrix: flat },
        { geometry: new THREE.SphereGeometry(R, 16, 8), color: 0x4a1a80, matrix: under },
    ]);
    const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x2a0a50, flatShading: true });
    const domeGeo = new THREE.SphereGeometry(0.45, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    domeGeo.translate(0, 0.12, 0);
    const domeMat = new THREE.MeshLambertMaterial({ color: 0xd9c2ff, emissive: 0x6040a0, transparent: true, opacity: 0.75 });
    const lightParts = [];
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        lightParts.push({
            geometry: new THREE.SphereGeometry(0.09, 6, 4), color: 0xffffff,
            matrix: new THREE.Matrix4().makeTranslation(Math.cos(a) * 0.96, 0, Math.sin(a) * 0.96),
        });
    }
    const lightGeo = mergeColored(lightParts);
    const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });

    const body = fixedInstanced(bodyGeo, bodyMat, max);
    const dome = fixedInstanced(domeGeo, domeMat, max);
    const lights = fixedInstanced(lightGeo, lightMat, max, { colors: true });
    const group = new THREE.Group();
    group.add(body.mesh, dome.mesh, lights.mesh);

    const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
    const _e = new THREE.Euler(), _c = new THREE.Color();
    const lightColors = [new THREE.Color(0xffe680), new THREE.Color(0x80ffff)];

    return {
        object3d: group,
        /** Place every UFO (nearest image, culled past the cull distance). */
        update(state = {}, time = 0) {
            const v = viewOf(state);
            body.begin(); dome.begin(); lights.begin();
            for (const u of state.ufos || []) {
                if (u.alive === false) continue;
                const d = _rel(u.pos, v);
                if (dist3(d) > v.cullDistance) continue;
                const w = ufoWobble(time, u.id);
                _p.set(d[0], d[1], d[2]);
                _s.setScalar(u.radius || MESHES3D.ufoRadius);
                _q.setFromEuler(_e.set(w.tiltX, 0, w.tiltZ));
                _m.compose(_p, _q, _s);
                body.push(_m);
                dome.push(_m);
                _q.setFromEuler(_e.set(w.tiltX, w.spin, w.tiltZ));
                _m.compose(_p, _q, _s);
                lights.push(_m, _c.copy(lightColors[Math.floor(time * 3) % 2]));
            }
            body.end(); dome.end(); lights.end();
        },
        get count() { return body.count; },
        dispose() { disposeAll([bodyGeo, bodyMat, domeGeo, domeMat, lightGeo, lightMat, body.mesh, dome.mesh, lights.mesh]); },
    };
}

// --- hostile bullets (UFO and boss)

/**
 * Glowing hostile bullets (max 200): a bright core sphere and an additive halo billboard, each
 * one InstancedMesh with a colour per bullet (UFO magenta, boss orange). 2 draw calls.
 * state: { bullets: [{ pos, radius, from: 'ufo' | 'boss', life }], view }.
 */
export function createHostileBullets({ max = MESHES3D.bulletMax, makeCanvas } = {}) {
    const coreGeo = new THREE.IcosahedronGeometry(1, 1);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const tex = glowTexture(makeCanvas);
    const haloGeo = new THREE.PlaneGeometry(1, 1);
    const haloMat = new THREE.MeshBasicMaterial({
        map: tex, color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const core = fixedInstanced(coreGeo, coreMat, max, { colors: true });
    const halo = fixedInstanced(haloGeo, haloMat, max, { colors: true });
    const group = new THREE.Group();
    group.add(core.mesh, halo.mesh);
    const ufoC = new THREE.Color(MESHES3D.ufoBulletColor), bossC = new THREE.Color(MESHES3D.bossBulletColor);
    const _coreC = new THREE.Color();
    const white = new THREE.Color(0xffffff);
    const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
    const _id = new THREE.Quaternion();

    return {
        object3d: group,
        update(state = {}, time = 0) {
            const v = viewOf(state);
            const cq = camQuat(v, _q);
            core.begin(); halo.begin();
            for (const b of state.bullets || []) {
                const d = _rel(b.pos, v);
                if (dist3(d) > v.cullDistance) continue;
                const c = b.from === 'boss' ? bossC : ufoC;
                const r = b.radius || MESHES3D.hostileBulletRadius;
                const pulse = 1 + 0.15 * Math.sin(time * 18 + (Number(b.id) || 0));
                _p.set(d[0], d[1], d[2]);
                _m.compose(_p, _id, _s.setScalar(r));
                core.push(_m, _coreC.copy(c).lerp(white, 0.55));
                _m.compose(_p, cq, _s.setScalar(r * 6 * pulse));
                halo.push(_m, c);
            }
            core.end(); halo.end();
        },
        get count() { return core.count; },
        dispose() { disposeAll([coreGeo, coreMat, tex, haloGeo, haloMat, core.mesh, halo.mesh]); },
    };
}

// --- boss

/**
 * The mothership: a rotating group (plated core of radius 150 with an equator band, polar
 * caps and a turret at every weak point, one merged mesh), the weak points (instanced spheres
 * coloured by health, dark and shrunken once destroyed) with additive halos, a turret flash
 * and a glow sprite that stays visible through the fog up to 1.5 × the fog end.
 * @param {object} o
 * @param {number[][]} o.normals - unit directions of the weak points (boss3d weakPoints[].dir)
 * state: { boss: { alive, pos, q: [x,y,z,w], weakPoints: [{ id, health, maxHealth, destroyed }],
 *   core: { health, maxHealth, destroyed }, flash, lastHit, turretFlash, turretDir }, view }; boss3d
 *   sets lastHit (the flaring weak point) and turretFlash / turretDir (the firing one, body frame);
 *   state.turretFlash / state.turretDir override them.
 */
export function createBossMeshes({ normals = [], makeCanvas, radius = MESHES3D.bossRadius, weakRadius = MESHES3D.weakPointRadius } = {}) {
    const R = radius;
    const up = new THREE.Vector3(0, 1, 0);
    const parts = [
        { geometry: new THREE.IcosahedronGeometry(R, 2), color: 0x4a5266 },
        { geometry: new THREE.TorusGeometry(R * 1.04, R * 0.07, 6, 32), color: 0x8a93ab, matrix: new THREE.Matrix4().makeRotationX(Math.PI / 2) },
        { geometry: new THREE.CylinderGeometry(R * 0.35, R * 0.5, R * 0.18, 12), color: 0x6a7388, matrix: new THREE.Matrix4().makeTranslation(0, R * 0.95, 0) },
        { geometry: new THREE.CylinderGeometry(R * 0.5, R * 0.35, R * 0.18, 12), color: 0x6a7388, matrix: new THREE.Matrix4().makeTranslation(0, -R * 0.95, 0) },
    ];
    const _n = new THREE.Vector3(), _tq = new THREE.Quaternion();
    for (const n of normals) {
        // A turret housing ring around each weak point
        _n.set(n[0], n[1], n[2]).normalize();
        _tq.setFromUnitVectors(up, _n);
        const m = new THREE.Matrix4().compose(_n.clone().multiplyScalar(R * 0.97), _tq, new THREE.Vector3(1, 1, 1));
        parts.push({ geometry: new THREE.CylinderGeometry(weakRadius * 1.5, weakRadius * 1.9, weakRadius * 0.6, 10, 1, true), color: 0x2c3140, matrix: m });
    }
    const bodyGeo = mergeColored(parts);
    const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x000000 });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);

    const wpGeo = new THREE.IcosahedronGeometry(weakRadius, 2);
    const wpMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const wp = fixedInstanced(wpGeo, wpMat, Math.max(1, normals.length), { colors: true });
    const tex = glowTexture(makeCanvas);
    const haloGeo = new THREE.PlaneGeometry(1, 1);
    const haloMat = new THREE.MeshBasicMaterial({
        map: tex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const halo = fixedInstanced(haloGeo, haloMat, Math.max(1, normals.length), { colors: true });

    const flashMat = new THREE.SpriteMaterial({ map: tex, color: 0xffd9a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const flash = new THREE.Sprite(flashMat);
    flash.visible = false;
    const glowMat = new THREE.SpriteMaterial({
        map: tex, color: 0xff9a40, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.renderOrder = 2;

    const body = new THREE.Group(); // rotates with the boss
    body.add(bodyMesh, wp.mesh, halo.mesh, flash);
    const root = new THREE.Group(); // at the boss's nearest image; the glow does not rotate
    root.add(body, glow);
    root.visible = false;

    const dirs = normals.map((n) => new THREE.Vector3(n[0], n[1], n[2]).normalize());
    const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
    const _inv = new THREE.Quaternion(), _cq = new THREE.Quaternion(), _hq = new THREE.Quaternion(), _c = new THREE.Color();
    const cool = new THREE.Color(0xffd040), hot = new THREE.Color(0xff3a1a), dead = new THREE.Color(0x1c1f26);
    const core = new THREE.Color(0xff3020);
    let last = { glowOpacity: 0, bodyVisible: false, weakLit: 0 };

    return {
        object3d: root,
        update(state = {}, time = 0) {
            const b = state.boss;
            const v = viewOf(state);
            if (!b || b.alive === false) { root.visible = false; last = { glowOpacity: 0, bodyVisible: false, weakLit: 0 }; return; }
            const d = _rel(b.pos, v);
            const dist = dist3(d);
            const glowOpacity = bossGlowOpacity(dist, v.fogNear, v.fogFar) * seamFade(d, v.size);
            root.visible = dist <= v.cullDistance || glowOpacity > 0.01;
            root.position.set(d[0], d[1], d[2]);
            body.visible = dist <= v.cullDistance;
            const q = b.q || [0, 0, 0, 1];
            body.quaternion.set(q[0], q[1], q[2], q[3]);

            // Body: a damage flash, and a red pulse once the core is exposed
            const outerLeft = (b.weakPoints || []).filter((w) => !w.destroyed).length;
            const exposed = outerLeft === 0 && b.core && !b.core.destroyed;
            const hit = clamp01((b.flash || 0) * 10);
            bodyMat.emissive.setRGB(0, 0, 0);
            if (exposed) bodyMat.emissive.copy(core).multiplyScalar(0.25 + 0.2 * Math.sin(time * 6));
            if (hit > 0) bodyMat.emissive.lerp(_c.setRGB(1, 1, 1), hit * 0.6);

            // Weak points and halos (halos face the camera: undo the body rotation)
            _inv.copy(body.quaternion).invert();
            _hq.copy(_inv).multiply(camQuat(v, _cq));
            wp.begin(); halo.begin();
            let lit = 0;
            (b.weakPoints || []).forEach((w, i) => {
                const dir = dirs[i];
                if (!dir) return;
                const g = weakPointGlow(w, time, w.id === b.lastHit ? b.flash || 0 : 0);
                _p.copy(dir).multiplyScalar(R * (g.destroyed ? 0.97 : 1.02));
                _m.compose(_p, _q.identity(), _s.setScalar(g.destroyed ? 0.7 : 1));
                if (g.destroyed) { wp.push(_m, dead); return; }
                lit++;
                _c.copy(cool).lerp(hot, g.heat).multiplyScalar(0.5 + 0.5 * g.glow);
                wp.push(_m, _c);
                _p.copy(dir).multiplyScalar(R * 1.02 + weakRadius * 0.6);
                _m.compose(_p, _hq, _s.setScalar(weakRadius * (3 + 2 * g.glow)));
                halo.push(_m, _c.multiplyScalar(g.glow));
            });
            wp.end(); halo.end();

            // Turret flash at the firing weak point
            // From the state, or from boss3d's own turretFlash / turretDir
            const tf = clamp01(Math.max(state.turretFlash || 0, b.turretFlash || 0));
            const tdir = state.turretDir || b.turretDir;
            flash.visible = tf > 0 && !!tdir;
            if (flash.visible) {
                const t = tdir;
                flash.position.set(t[0], t[1], t[2]).normalize().multiplyScalar(R + weakRadius * 1.4);
                flash.scale.setScalar(weakRadius * 4 * tf);
                flashMat.opacity = tf;
            }

            // Glow sprite: not fogged, pulled inside the far plane, sized to stay findable
            const cl = clampToFar(d, v.far);
            glow.position.set(cl.pos[0] - d[0], cl.pos[1] - d[1], cl.pos[2] - d[2]);
            glow.scale.setScalar(bossGlowSize(dist, R) * cl.scale);
            glowMat.opacity = glowOpacity * (0.85 + 0.15 * Math.sin(time * 2));
            glow.visible = glowOpacity > 0.01;
            last = { glowOpacity, bodyVisible: body.visible, weakLit: lit };
        },
        /** What the last update showed (test hook). */
        get info() { return { ...last }; },
        dispose() {
            disposeAll([bodyGeo, bodyMat, wpGeo, wpMat, haloGeo, haloMat, tex, flashMat, glowMat, wp.mesh, halo.mesh]);
        },
    };
}

// --- power-ups

/**
 * Spinning glyph billboards for the 7 power-up types (max 10 in play): one InstancedMesh per
 * type with its canvas-drawn glyph, hidden while that type is absent, so only the types in
 * play cost a draw call. They blink for their last 3 s. Fogged like rocks.
 * state: { powerUps: [{ id, type, pos, life }], view }.
 */
export function createPowerUpMeshes({ max = MESHES3D.powerUpMax, makeCanvas = defaultCanvas, size = MESHES3D.powerUpSize } = {}) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const group = new THREE.Group();
    const byType = new Map();
    const owned = [geo];
    for (const g of POWERUP_GLYPHS) {
        const c = makeCanvas(MESHES3D.glyphPx, MESHES3D.glyphPx);
        drawGlyph(c.getContext('2d'), MESHES3D.glyphPx, g);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
        const pool = fixedInstanced(geo, mat, max);
        group.add(pool.mesh);
        byType.set(g.id, pool);
        owned.push(tex, mat, pool.mesh);
    }
    const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
    let shown = 0;

    return {
        object3d: group,
        update(state = {}, time = 0) {
            const v = viewOf(state);
            const cq = camQuat(v, _q);
            for (const p of byType.values()) p.begin();
            shown = 0;
            for (const pu of state.powerUps || []) {
                if (shown >= max) break;
                const pool = byType.get(pu.type);
                if (!pool) continue;
                const d = _rel(pu.pos, v);
                if (dist3(d) > v.cullDistance) continue;
                if (!blinkOn(pu.life, time)) continue;
                const ph = (Number(pu.id) || 0) * 0.9;
                const bob = Math.sin(time * 2 + ph) * size * 0.12;
                _p.set(d[0], d[1], d[2]);
                // Bob along the camera's up so it reads the same from any side
                _p.add(_s.set(0, bob, 0).applyQuaternion(cq));
                _s.set(size * spinScaleX(time, ph), size, 1);
                _m.compose(_p, cq, _s);
                pool.push(_m);
                shown++;
            }
            for (const p of byType.values()) p.end();
        },
        /** Billboards drawn by the last update, and the types with a draw call. */
        get count() { return shown; },
        get activeTypes() { return [...byType].filter(([, p]) => p.count > 0).map(([id]) => id); },
        dispose() { disposeAll(owned); },
    };
}

// --- shield bubble and magnet hint (around the camera at the origin)

const SHIELD_VERT = `
varying vec3 vView;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const SHIELD_FRAG = `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
varying vec3 vView;
void main() {
  // Seen from inside, a fresnel term is constant; use the angle from the view axis instead:
  // clear in the middle of the screen, a tinted rim toward the edges, with a faint shimmer
  float off = 1.0 - clamp(-vView.z, 0.0, 1.0);
  float rim = smoothstep(0.04, 0.55, off);
  float shimmer = 0.75 + 0.25 * sin(uTime * 3.0 + vView.x * 14.0 + vView.y * 11.0);
  gl_FragColor = vec4(uColor, uAlpha * rim * shimmer);
}`;

/** Shield bubble opacity: 0 without a shield, flickering in its last 2 s, a flare on a hit. */
export function shieldAlpha(secondsLeft, time, hit = 0) {
    if (!(secondsLeft > 0) && !(hit > 0)) return 0;
    let a = 0.32;
    if (secondsLeft > 0 && secondsLeft < MESHES3D.shieldWarn && Math.floor(time * 10) % 2) a *= 0.35;
    return clamp01(a + hit * 0.6);
}

/**
 * Shield bubble: a sphere around the camera that tints the screen edges cyan while a shield
 * is active (and flares when it absorbs a hit). 1 draw call, only while visible.
 * state: { shield: seconds left, shieldHit: 0..1 (fading flare) }.
 */
export function createShieldBubble({ radius = MESHES3D.shieldRadius, color = 0x00ffff } = {}) {
    const geo = new THREE.SphereGeometry(radius, 32, 16);
    const mat = new THREE.ShaderMaterial({
        vertexShader: SHIELD_VERT, fragmentShader: SHIELD_FRAG,
        uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: 0 }, uTime: { value: 0 } },
        transparent: true, depthWrite: false, depthTest: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 10;
    mesh.frustumCulled = false;
    mesh.visible = false;
    return {
        object3d: mesh,
        update(state = {}, time = 0) {
            const a = shieldAlpha(state.shield || 0, time, state.shieldHit || 0);
            mat.uniforms.uAlpha.value = a;
            mat.uniforms.uTime.value = time;
            mesh.visible = a > 0;
        },
        get alpha() { return mat.uniforms.uAlpha.value; },
        dispose() { disposeAll([geo, mat]); },
    };
}

/**
 * Magnet hint: three slowly turning great circles at the magnet's reach, pink like the 2D
 * power-up, fogged so only the near arcs show. 1 draw call while the magnet is active.
 * state: { magnet: seconds left, magnetRange: world units }.
 */
export function createMagnetHint({ color = 0xff69b4, segments = 64 } = {}) {
    const pts = [];
    for (let ring = 0; ring < 3; ring++) {
        for (let i = 0; i < segments; i++) {
            for (const k of [i, i + 1]) {
                const a = (k / segments) * Math.PI * 2;
                const c = Math.cos(a), s = Math.sin(a);
                if (ring === 0) pts.push(c, s, 0);
                else if (ring === 1) pts.push(c, 0, s);
                else pts.push(0, c, s);
            }
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    lines.visible = false;
    return {
        object3d: lines,
        update(state = {}, time = 0) {
            const on = (state.magnet || 0) > 0;
            lines.visible = on;
            if (!on) return;
            lines.scale.setScalar(Math.max(1, state.magnetRange || 150));
            lines.rotation.set(time * 0.21, time * 0.33, 0);
            mat.opacity = (0.22 + 0.1 * Math.sin(time * 3)) * (blinkOn(state.magnet, time) ? 1 : 0.3);
        },
        get visible() { return lines.visible; },
        dispose() { disposeAll([geo, mat]); },
    };
}

// --- hyperspace (screen-fixed: add object3d to the CAMERA)

const TUNNEL_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const TUNNEL_FRAG = `
uniform float uAlpha;
uniform float uOffset;
varying vec2 vUv;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  // 48 streak columns around the tunnel, each with its own length and phase
  float col = floor(vUv.x * 48.0);
  float h = hash(col);
  float s = fract(vUv.y * (1.5 + h * 2.0) + uOffset * (0.6 + h) + h);
  float streak = smoothstep(0.0, 0.08, s) * (1.0 - smoothstep(0.08, 0.5, s));
  float fadeEnds = smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
  vec3 c = mix(vec3(0.45, 0.6, 1.0), vec3(1.0), h);
  gl_FragColor = vec4(c, uAlpha * streak * fadeEnds);
}`;

/**
 * Hyperspace jump: streaks rushing past in a tunnel around the view axis and a white flash at
 * the moment of the jump (hyperspacePhase). 2 draw calls while it runs, none otherwise.
 * state: { hyperspace: seconds since the jump began (null / undefined: idle) }.
 */
export function createHyperspaceEffect({ duration = MESHES3D.hyperspaceDuration } = {}) {
    const tunnelGeo = new THREE.CylinderGeometry(6, 6, 240, 48, 1, true);
    tunnelGeo.rotateX(Math.PI / 2); // axis along the view (-Z)
    tunnelGeo.translate(0, 0, -100);
    const tunnelMat = new THREE.ShaderMaterial({
        vertexShader: TUNNEL_VERT, fragmentShader: TUNNEL_FRAG,
        uniforms: { uAlpha: { value: 0 }, uOffset: { value: 0 } },
        transparent: true, depthWrite: false, depthTest: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
    });
    const tunnel = new THREE.Mesh(tunnelGeo, tunnelMat);
    tunnel.renderOrder = 20;
    tunnel.frustumCulled = false;
    const flashGeo = new THREE.PlaneGeometry(1, 1);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.set(0, 0, -1.5); // just past the camera's near plane (1)
    flash.scale.set(20, 20, 1);     // covers any field of view up to about 160°
    flash.renderOrder = 21;
    flash.frustumCulled = false;
    const group = new THREE.Group();
    group.add(tunnel, flash);
    group.visible = false;
    let offset = 0, lastT = null, phase = hyperspacePhase(-1, duration);

    return {
        object3d: group,
        update(state = {}) {
            const t = state.hyperspace;
            phase = hyperspacePhase(t == null ? -1 : t, duration);
            group.visible = phase.active;
            if (!phase.active) { lastT = null; offset = 0; return; }
            const dt = lastT === null ? 0 : Math.max(0, t - lastT);
            lastT = t;
            offset += dt * phase.speed;
            tunnelMat.uniforms.uAlpha.value = phase.tunnel;
            tunnelMat.uniforms.uOffset.value = offset;
            flashMat.opacity = phase.flash;
            tunnel.visible = phase.tunnel > 0.01;
            flash.visible = phase.flash > 0.01;
        },
        get phase() { return { ...phase }; },
        dispose() { disposeAll([tunnelGeo, tunnelMat, flashGeo, flashMat]); },
    };
}
