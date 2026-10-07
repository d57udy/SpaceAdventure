// three.js renderer for the 3D prototype. The ONLY module that imports three.js, behind a
// small interface (docs/plans/06-3d-mode.md §3), so the renderer could be swapped later.
//
// three.js r185 (0.185.0), the official minified build, vendored in js/3d/vendor/
// (three.module.min.js imports ./three.core.min.js relatively; no import map needed).
//
// Floating origin: the camera always sits at (0, 0, 0) with the ship's orientation and
// every object is placed at its nearest image relative to the ship (world3d.nearestDelta),
// so the 3-torus wraps seamlessly and float precision never degrades.
//
// Fog is RADIAL (distance from the camera, not view depth): an object at the screen edge
// fades at the same distance as one straight ahead, so culling at world.cullDistance and
// the nearest-image switch at side / 2 both happen where everything is fully fogged.
// Rocks, crystal glows and bullets are drawn with InstancedMesh (a handful of draw calls
// for hundreds of objects). The sky (stars, planet) never writes depth and is drawn first,
// scaled inside the camera's far plane, so it always stays behind the field.

import * as THREE from './vendor/three.module.min.js';
import { nearestDelta, worldFor } from './world3d.js';
import { verticalFov } from './radar3d.js';

const BG = 0x02030a;
const DUST_COUNT = 520;
export const DUST_BOX = 200; // divides every world side, so the dust does not jump when the ship wraps
const SPARK_MAX = 600;
const SKY_RADIUS = 2300;     // outermost sky geometry (planet far side), scaled to fit the far plane

// Radial fog for every fogged material (patched once, before any shader compiles)
THREE.ShaderChunk.fog_vertex = THREE.ShaderChunk.fog_vertex.replace('- mvPosition.z', 'length( mvPosition.xyz )');

/** linear-fog factor as three.js computes it (smoothstep): 0 = clear, 1 = fully fogged. */
export function fogFactor(dist, near, far) {
    const t = Math.min(1, Math.max(0, (dist - near) / (far - near)));
    return t * t * (3 - 2 * t);
}

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
 * @param {object} [o.world] - from world3d.worldFor() (size, fog, cull distance); setWorld() changes it
 * @param {boolean} [o.antialias] - false only for ?lowres3d=1 (tests on a software renderer)
 * @returns {object} renderer interface (see the returned object)
 */
export function createRenderer3d(canvas, { world = worldFor(), antialias = true } = {}) {
    let worldSize = world.size;
    let fogNear = world.fogNear;
    let fogFar = world.fogFar;
    let cullDistance = world.cullDistance;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias, powerPreference: 'high-performance' });
    renderer.setClearColor(BG, 1);
    let contextLost = false;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); contextLost = true; });
    canvas.addEventListener('webglcontextrestored', () => { contextLost = false; });

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG);
    scene.fog = new THREE.Fog(BG, fogNear, fogFar);
    const camera = new THREE.PerspectiveCamera(65, 16 / 9, 1, 2600);
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
        const m = new THREE.PointsMaterial({
            size: 2, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false, depthTest: false,
        });
        const stars = new THREE.Points(g, m);
        stars.renderOrder = -3;
        stars.frustumCulled = false;
        sky.add(stars);
        const planet = new THREE.Mesh(
            new THREE.SphereGeometry(260, 32, 16),
            new THREE.MeshLambertMaterial({ color: 0x3355aa, emissive: 0x0a1430, fog: false, depthWrite: false, depthTest: false }),
        );
        planet.position.set(1300, 450, -1500);
        planet.renderOrder = -2;
        sky.add(planet);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTexture(), color: 0x4466ff, transparent: true, opacity: 0.35, depthWrite: false, depthTest: false, fog: false,
            blending: THREE.AdditiveBlending,
        }));
        glow.renderOrder = -1;
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
    const greenGlowMat = new THREE.MeshBasicMaterial({
        map: glowTex, color: 0x33ff99, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const glowGeo = new THREE.PlaneGeometry(1, 1);

    // --- bullets
    const bulletGeo = new THREE.BoxGeometry(0.9, 0.9, 10);
    const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffe680 });

    /** An InstancedMesh that grows (doubling) when more instances are needed. */
    function instanced(geo, mat, capacity) {
        const pool = { mesh: null, capacity: 0, n: 0 };
        const make = (cap) => {
            if (pool.mesh) { scene.remove(pool.mesh); pool.mesh.dispose(); }
            pool.mesh = new THREE.InstancedMesh(geo, mat, cap);
            pool.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            pool.mesh.frustumCulled = false; // instances move every frame; the GPU clips
            pool.mesh.count = 0;
            pool.capacity = cap;
            scene.add(pool.mesh);
        };
        make(capacity);
        pool.ensure = (n) => { if (n > pool.capacity) make(Math.max(n, pool.capacity * 2)); };
        pool.begin = () => { pool.n = 0; };
        pool.push = (m) => { pool.mesh.setMatrixAt(pool.n++, m); };
        pool.end = () => { pool.mesh.count = pool.n; pool.mesh.instanceMatrix.needsUpdate = true; };
        return pool;
    }
    const redPools = redGeos.map((g) => instanced(g, redMat, 128));
    const greenPool = instanced(greenGeo, greenMat, 128);
    const glowPool = instanced(glowGeo, greenGlowMat, 128);
    const bulletPool = instanced(bulletGeo, bulletMat, 32);
    const allPools = [...redPools, greenPool, glowPool, bulletPool];

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
    let drawnRocks = 0;
    const lastSeen = new Map(); // rock id -> { distance, drawn } from the last frame (test hook)

    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3();
    const _axis = new THREE.Vector3();
    const _look = new THREE.Vector3();
    const _origin = new THREE.Vector3();
    const _up = new THREE.Vector3(0, 1, 0);

    function syncRocks(rocks) {
        for (const p of redPools) p.ensure(rocks.length);
        greenPool.ensure(rocks.length);
        glowPool.ensure(rocks.length);
        for (const p of allPools) if (p !== bulletPool) p.begin();
        lastSeen.clear();
        drawnRocks = 0;
        for (const r of rocks) {
            const d = nearestDelta(shipPos, r.pos, worldSize);
            const dist = Math.hypot(d[0], d[1], d[2]);
            const drawn = dist <= cullDistance;
            lastSeen.set(r.id, { distance: dist, drawn });
            if (!drawn) continue;
            drawnRocks++;
            _p.set(d[0], d[1], d[2]);
            _q.setFromAxisAngle(_axis.set(r.spinAxis[0], r.spinAxis[1], r.spinAxis[2]), r.angle);
            _s.setScalar(r.radius);
            _m.compose(_p, _q, _s);
            if (r.kind === 'green') {
                greenPool.push(_m);
                // Glow billboard: faces the camera plane, like a sprite
                _s.setScalar(r.radius * 4.2);
                _m.compose(_p, camera.quaternion, _s);
                glowPool.push(_m);
            } else {
                redPools[r.shape % redPools.length].push(_m);
            }
        }
        for (const p of allPools) if (p !== bulletPool) p.end();
    }

    function syncBullets(bullets) {
        bulletPool.ensure(bullets.length);
        bulletPool.begin();
        for (const b of bullets) {
            const d = nearestDelta(shipPos, b.pos, worldSize);
            _p.set(d[0], d[1], d[2]);
            _look.set(b.vel[0], b.vel[1], b.vel[2]);
            if (_look.lengthSq() < 1e-9) _look.set(0, 0, -1);
            // Object3D.lookAt for a non-camera: +Z points along the velocity
            _m.lookAt(_look, _origin, _up);
            _q.setFromRotationMatrix(_m);
            _s.set(1, 1, 1);
            _m.compose(_p, _q, _s);
            bulletPool.push(_m);
        }
        bulletPool.end();
    }

    /** Sky scale and camera far plane for the current fog distance. */
    function applyWorld() {
        scene.fog.near = fogNear;
        scene.fog.far = fogFar;
        camera.far = Math.max(cullDistance + 200, 1200);
        sky.scale.setScalar(Math.min(1, (camera.far * 0.95) / SKY_RADIUS));
        camera.updateProjectionMatrix();
    }
    applyWorld();

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
            camera.fov = verticalFov(aspect);
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
        /** Change the world (view distance): cube side, fog, cull distance, far plane, sky scale. */
        setWorld(w) {
            worldSize = w.size;
            fogNear = w.fogNear;
            fogFar = w.fogFar;
            cullDistance = w.cullDistance;
            sparks.length = 0;
            applyWorld();
        },
        /** World settings in effect (test hook). */
        get world() { return { size: worldSize, fogNear, fogFar, cullDistance, cameraFar: camera.far }; },
        /**
         * How visible a rock was in the last frame (test hook, no pixel reads): distance from
         * the ship, drawn (inside the cull distance) and the fog factor (0 clear, 1 fully fogged).
         */
        rockVisibility(id) {
            const e = lastSeen.get(id);
            if (!e) return null;
            return { distance: e.distance, drawn: e.drawn, fog: fogFactor(e.distance, fogNear, fogFar) };
        },
        get drawnRocks() { return drawnRocks; },
        get drawCalls() { return drawCalls; },
        dispose() { renderer.dispose(); },
    };
}
