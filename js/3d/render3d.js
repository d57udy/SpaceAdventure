// three.js renderer for the 3D prototype. The ONLY module that imports three.js, behind a
// small interface (docs/plans/06-3d-mode.md §3), so the renderer could be swapped later.
//
// three.js r185 (0.185.0), the official minified build, vendored in js/3d/vendor/
// (three.module.min.js imports ./three.core.min.js relatively; no import map needed).
//
// Floating origin: the camera always sits at (0, 0, 0) with the ship's orientation and
// every object is placed at its nearest image relative to the ship (world3d.nearestDelta),
// so the 3-torus wraps seamlessly and float precision never degrades.

import * as THREE from './vendor/three.module.min.js';
import { nearestDelta, WORLD } from './world3d.js';

const BG = 0x02030a;
const DUST_COUNT = 520;
const DUST_BOX = 200; // divides the world size (1600), so the dust does not jump when the ship wraps
const SPARK_MAX = 600;

function makeRng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Spiky red rock: an icosphere whose 12 main vertices are pulled out into spikes. */
function spikyGeometry(variant) {
    const rand = makeRng(1000 + variant);
    const g = new THREE.IcosahedronGeometry(1, 1);
    const base = new THREE.IcosahedronGeometry(1, 0).getAttribute('position');
    const dirs = [];
    for (let i = 0; i < base.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(base, i).normalize();
        if (!dirs.some((d) => d.distanceTo(v) < 1e-3)) dirs.push(v);
    }
    const spike = dirs.map(() => 1.45 + rand() * 0.45);
    const pos = g.getAttribute('position');
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).normalize();
        let k = 0.78 + rand() * 0.05;
        for (let j = 0; j < dirs.length; j++) if (v.dot(dirs[j]) > 0.999) k = spike[j];
        pos.setXYZ(i, v.x * k, v.y * k, v.z * k);
    }
    g.computeVertexNormals();
    return g;
}

function glowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
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

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} [o]
 * @param {number} [o.worldSize]
 * @param {boolean} [o.antialias] - false only for ?lowres3d=1 (tests on a software renderer)
 * @returns {object} renderer interface (see the returned object)
 */
export function createRenderer3d(canvas, {
    worldSize = WORLD.size, fogNear = WORLD.fogNear, fogFar = WORLD.fogFar, antialias = true,
} = {}) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias, powerPreference: 'high-performance' });
    renderer.setClearColor(BG, 1);
    let contextLost = false;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); contextLost = true; });
    canvas.addEventListener('webglcontextrestored', () => { contextLost = false; });

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG);
    scene.fog = new THREE.Fog(BG, fogNear, fogFar);
    const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.5, 2600);
    scene.add(camera);

    scene.add(new THREE.AmbientLight(0x6070a0, 1.1));
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
    sun.position.set(0.5, 0.8, 0.3);
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x6688ff, 0.8);
    rim.position.set(-0.6, -0.3, -0.7);
    scene.add(rim);

    // --- fixed background: stars and a distant planet (not fogged, always at the same direction)
    const sky = new THREE.Group();
    scene.add(sky);
    {
        const rand = makeRng(77);
        const n = 1800;
        const pos = new Float32Array(n * 3);
        const col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            const z = rand() * 2 - 1, t = rand() * Math.PI * 2, s = Math.sqrt(1 - z * z);
            pos.set([s * Math.cos(t) * 2200, z * 2200, s * Math.sin(t) * 2200], i * 3);
            const b = 0.45 + rand() * 0.55;
            const tint = rand();
            col.set(tint < 0.15 ? [b, b * 0.8, b * 0.6] : tint < 0.3 ? [b * 0.7, b * 0.8, b] : [b, b, b], i * 3);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const m = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false });
        sky.add(new THREE.Points(g, m));
        const planet = new THREE.Mesh(
            new THREE.SphereGeometry(260, 32, 16),
            new THREE.MeshLambertMaterial({ color: 0x3355aa, emissive: 0x0a1430, fog: false }),
        );
        planet.position.set(1300, 450, -1500);
        sky.add(planet);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTexture(), color: 0x4466ff, transparent: true, opacity: 0.35, depthWrite: false, fog: false,
            blending: THREE.AdditiveBlending,
        }));
        glow.scale.setScalar(820);
        glow.position.copy(planet.position);
        sky.add(glow);
    }

    // --- space dust around the ship (motion feel); wraps in a small box around the camera
    const dustBase = new Float32Array(DUST_COUNT * 3);
    const dustPos = new Float32Array(DUST_COUNT * 3);
    {
        const rand = makeRng(5);
        for (let i = 0; i < dustBase.length; i++) dustBase[i] = rand() * DUST_BOX;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
        color: 0x9fb4d8, size: 1.3, sizeAttenuation: true, transparent: true, opacity: 0.75, depthWrite: false,
    }));
    dust.frustumCulled = false;
    scene.add(dust);

    // --- rocks
    const greenGeo = new THREE.OctahedronGeometry(1, 0);
    greenGeo.scale(0.8, 1.5, 0.8);
    const greenMat = new THREE.MeshLambertMaterial({ color: 0x3dffa0, emissive: 0x0c7a40, flatShading: true });
    const redGeos = [0, 1, 2, 3].map(spikyGeometry);
    const redMat = new THREE.MeshLambertMaterial({ color: 0xff3a4c, emissive: 0x3a0610, flatShading: true });
    const glowTex = glowTexture();
    const greenGlowMat = new THREE.SpriteMaterial({
        map: glowTex, color: 0x33ff99, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const rockMeshes = new Map(); // id -> { mesh, glow }

    // --- bullets
    const bulletGeo = new THREE.BoxGeometry(0.9, 0.9, 10);
    const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffe680 });
    const bulletMeshes = new Map();

    // --- sparkles (collect / split)
    const sparkPos = new Float32Array(SPARK_MAX * 3);
    const sparkCol = new Float32Array(SPARK_MAX * 3);
    const sparks = []; // { world: [x,y,z], vel, life, max, color }
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
    const sparkPoints = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
        size: 3.2, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, map: glowTex,
    }));
    sparkPoints.frustumCulled = false;
    scene.add(sparkPoints);
    const sparkRand = makeRng(99);

    let drawCalls = 0;
    let shipPos = [0, 0, 0];

    function sweep(map, alive, remove) {
        for (const [id, entry] of map) {
            if (!alive.has(id)) { remove(entry); map.delete(id); }
        }
    }

    function syncRocks(rocks) {
        const alive = new Set();
        const cull = fogFar + 60;
        for (const r of rocks) {
            alive.add(r.id);
            let e = rockMeshes.get(r.id);
            if (!e) {
                const mesh = new THREE.Mesh(r.kind === 'green' ? greenGeo : redGeos[r.shape % redGeos.length], r.kind === 'green' ? greenMat : redMat);
                let glow = null;
                if (r.kind === 'green') {
                    glow = new THREE.Sprite(greenGlowMat);
                    glow.scale.setScalar(r.radius * 4.2);
                    scene.add(glow);
                }
                mesh.scale.setScalar(r.radius);
                scene.add(mesh);
                e = { mesh, glow };
                rockMeshes.set(r.id, e);
            }
            const d = nearestDelta(shipPos, r.pos, worldSize);
            const far = Math.abs(d[0]) > cull || Math.abs(d[1]) > cull || Math.abs(d[2]) > cull;
            e.mesh.visible = !far;
            e.mesh.position.set(d[0], d[1], d[2]);
            e.mesh.quaternion.setFromAxisAngle(_axis.set(r.spinAxis[0], r.spinAxis[1], r.spinAxis[2]), r.angle);
            if (e.glow) { e.glow.visible = !far; e.glow.position.copy(e.mesh.position); }
        }
        sweep(rockMeshes, alive, (e) => { scene.remove(e.mesh); if (e.glow) scene.remove(e.glow); });
    }
    const _axis = new THREE.Vector3();
    const _look = new THREE.Vector3();

    function syncBullets(bullets) {
        const alive = new Set();
        for (const b of bullets) {
            alive.add(b.id);
            let m = bulletMeshes.get(b.id);
            if (!m) {
                m = new THREE.Mesh(bulletGeo, bulletMat);
                scene.add(m);
                bulletMeshes.set(b.id, m);
            }
            const d = nearestDelta(shipPos, b.pos, worldSize);
            m.position.set(d[0], d[1], d[2]);
            _look.set(d[0] + b.vel[0], d[1] + b.vel[1], d[2] + b.vel[2]);
            m.lookAt(_look);
        }
        sweep(bulletMeshes, alive, (m) => scene.remove(m));
    }

    function syncDust() {
        const h = DUST_BOX / 2;
        for (let i = 0; i < DUST_COUNT; i++) {
            for (let k = 0; k < 3; k++) {
                let v = (dustBase[i * 3 + k] - shipPos[k]) % DUST_BOX;
                if (v < 0) v += DUST_BOX;
                dustPos[i * 3 + k] = v - h;
            }
        }
        dustGeo.attributes.position.needsUpdate = true;
    }

    function syncSparks(dt) {
        let n = 0;
        for (let i = sparks.length - 1; i >= 0; i--) {
            const s = sparks[i];
            s.life -= dt;
            if (s.life <= 0) { sparks.splice(i, 1); continue; }
            s.world[0] += s.vel[0] * dt; s.world[1] += s.vel[1] * dt; s.world[2] += s.vel[2] * dt;
        }
        for (const s of sparks) {
            if (n >= SPARK_MAX) break;
            const d = nearestDelta(shipPos, s.world, worldSize);
            sparkPos.set(d, n * 3);
            const k = s.life / s.max;
            sparkCol.set([s.color[0] * k, s.color[1] * k, s.color[2] * k], n * 3);
            n++;
        }
        sparkGeo.setDrawRange(0, n);
        sparkGeo.attributes.position.needsUpdate = true;
        sparkGeo.attributes.color.needsUpdate = true;
    }

    return {
        three: THREE.REVISION,
        get contextLost() { return contextLost; },
        /** CSS size and device pixel ratio actually used for the drawing buffer. */
        setSize(width, height, pixelRatio) {
            renderer.setPixelRatio(pixelRatio);
            renderer.setSize(width, height, false);
            const aspect = width / Math.max(1, height);
            camera.aspect = aspect;
            // About 90° horizontally on wide screens, at most 80° vertically when tall
            const vfov = 2 * Math.atan(Math.tan(45 * Math.PI / 180) / aspect) * 180 / Math.PI;
            camera.fov = Math.min(80, Math.max(50, vfov));
            camera.updateProjectionMatrix();
        },
        /** Add a burst of sparkles at a world position. kind: 'collect' | 'split' | 'hit'. */
        burst(pos, kind = 'collect') {
            const color = kind === 'collect' ? [0.3, 1, 0.6] : kind === 'hit' ? [1, 0.5, 0.3] : [1, 0.35, 0.3];
            const count = kind === 'collect' ? 60 : 40;
            for (let i = 0; i < count && sparks.length < SPARK_MAX; i++) {
                const z = sparkRand() * 2 - 1, t = sparkRand() * Math.PI * 2, s = Math.sqrt(1 - z * z);
                const sp = 20 + sparkRand() * 70;
                const max = 0.5 + sparkRand() * 0.5;
                sparks.push({ world: pos.slice(), vel: [s * Math.cos(t) * sp, z * sp, s * Math.sin(t) * sp], life: max, max, color });
            }
        },
        /**
         * Draw one frame.
         * @param {object} view - { shipPos, q: [x,y,z,w], rocks, bullets, dt }
         */
        render(view) {
            if (contextLost) return;
            shipPos = view.shipPos;
            camera.quaternion.set(view.q[0], view.q[1], view.q[2], view.q[3]);
            syncRocks(view.rocks);
            syncBullets(view.bullets);
            syncDust();
            syncSparks(view.dt || 0);
            renderer.render(scene, camera);
            drawCalls = renderer.info.render.calls;
        },
        /** Re-render and count lit pixels (tests only: reads the drawing buffer right away). */
        probeLitPixels(view) {
            this.render(view);
            const gl = renderer.getContext();
            const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
            const px = new Uint8Array(w * h * 4);
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
            let lit = 0;
            for (let i = 0; i < px.length; i += 16) if (px[i] + px[i + 1] + px[i + 2] > 60) lit++;
            return { lit, width: w, height: h };
        },
        get drawCalls() { return drawCalls; },
        dispose() { renderer.dispose(); },
    };
}
