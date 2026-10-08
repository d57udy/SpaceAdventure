/*
 * Space Adventure service worker.
 *
 * Lives at the repo root so its scope is the app folder (/SpaceAdventure/ on
 * GitHub Pages, / locally). Everything the game needs is precached into ONE
 * versioned cache, and navigations are always answered from that cache, so
 * the page and its modules never come from different versions.
 *
 * IMPORTANT: CACHE_VERSION and PRECACHE below are GENERATED. After adding,
 * removing or changing ANY precached file (index.html, style.css, the
 * manifest, js/*.js, every .js under js/3d/, assets/audio/*.mp3, icons/*.png) run:
 *
 *     node scripts/update-sw-version.mjs      (npm run sw:version)
 *
 * tests/unit/sw-version.test.mjs fails while this block is stale.
 */

const CACHE_PREFIX = 'space-adventure-';

// @generated-begin (scripts/update-sw-version.mjs; do not edit by hand)
const CACHE_VERSION = 'sa-9adc66e95684';
const PRECACHE = [
    './',
    'index.html',
    'style.css',
    'manifest.webmanifest',
    'js/achievementManager.js',
    'js/achievements.js',
    'js/asteroid.js',
    'js/audio.js',
    'js/backNav.js',
    'js/boss.js',
    'js/bullet.js',
    'js/camera.js',
    'js/difficulty.js',
    'js/entity.js',
    'js/gamepad.js',
    'js/ghost.js',
    'js/haptics.js',
    'js/hud.js',
    'js/input.js',
    'js/keyDiagram.js',
    'js/lobby.js',
    'js/main.js',
    'js/menuLayout.js',
    'js/mode3d.js',
    'js/modes.js',
    'js/mpIntro.js',
    'js/mpRecords.js',
    'js/mpResults.js',
    'js/mpView.js',
    'js/music.js',
    'js/names.js',
    'js/palette.js',
    'js/particles.js',
    'js/persistence.js',
    'js/player.js',
    'js/players.js',
    'js/powerup.js',
    'js/pwa.js',
    'js/pwaUi.js',
    'js/rng.js',
    'js/saucer.js',
    'js/seats.js',
    'js/settings.js',
    'js/steering.js',
    'js/timeAttack.js',
    'js/tunes.js',
    'js/tutorial.js',
    'js/ufo.js',
    'js/upgrades.js',
    'js/utils.js',
    'js/valueRow.js',
    'js/version.js',
    'js/versus.js',
    'js/viewport.js',
    'js/wakeLock.js',
    'js/worldSize.js',
    'js/3d/assist3d.js',
    'js/3d/audio3d.js',
    'js/3d/boss3d.js',
    'js/3d/collide3d.js',
    'js/3d/debris3d.js',
    'js/3d/game3d.js',
    'js/3d/haptics3d.js',
    'js/3d/hud3d.js',
    'js/3d/hyperspace3d.js',
    'js/3d/look.js',
    'js/3d/math3d.js',
    'js/3d/meshes3d.js',
    'js/3d/orient3d.js',
    'js/3d/perf3d.js',
    'js/3d/powerup3d.js',
    'js/3d/progress3d.js',
    'js/3d/proto3d.js',
    'js/3d/radar3d.js',
    'js/3d/render3d.js',
    'js/3d/rules3d.js',
    'js/3d/sensors.js',
    'js/3d/sim3d.js',
    'js/3d/spawn3d.js',
    'js/3d/tutorial3d.js',
    'js/3d/ufo3d.js',
    'js/3d/ui3d.js',
    'js/3d/vendor/three.core.min.js',
    'js/3d/vendor/three.module.min.js',
    'js/3d/world3d.js',
    'assets/audio/asteroid_explode_large.mp3',
    'assets/audio/asteroid_explode_medium.mp3',
    'assets/audio/asteroid_explode_small.mp3',
    'assets/audio/player_explode.mp3',
    'assets/audio/player_shoot.mp3',
    'assets/audio/player_thrust.mp3',
    'assets/audio/ufo_explode.mp3',
    'assets/audio/ufo_hum.mp3',
    'assets/audio/ufo_shoot.mp3',
    'icons/apple-touch-icon-180.png',
    'icons/favicon-32.png',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-maskable-512.png',
];
// @generated-end

const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

function scopeUrl(path) {
    return new URL(path, self.registration ? self.registration.scope : self.location.href).href;
}

self.addEventListener('install', (event) => {
    // No automatic skipWaiting: a new version waits until the page asks for it
    // (SKIP_WAITING), which the game only does outside of play.
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            cache.addAll(PRECACHE.map((url) => new Request(scopeUrl(url), { cache: 'reload' })))
        )
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys
                .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
                .map((key) => caches.delete(key))
        );
        // Take control of the first-visit page too, so it works offline
        // without a reload.
        await self.clients.claim();
    })());
});

self.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    } else if (data.type === 'GET_VERSION') {
        const reply = { type: 'VERSION', version: CACHE_VERSION, cacheName: CACHE_NAME };
        if (event.ports && event.ports[0]) event.ports[0].postMessage(reply);
        else if (event.source && event.source.postMessage) event.source.postMessage(reply);
    }
});

// A navigation to the app itself (the scope root or index.html, any query): answered with
// the cached './'. Other navigations in scope (e.g. docs/...) are looked up as themselves
// and otherwise go to the network, instead of silently showing the game.
function isAppShellNavigation(request) {
    if (request.mode !== 'navigate') return false;
    const path = new URL(request.url).pathname;
    const root = new URL(scopeUrl('./')).pathname;
    if (!path.startsWith(root)) return false;
    const rest = path.slice(root.length);
    return rest === '' || rest === 'index.html';
}

async function respond(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = isAppShellNavigation(request)
        ? await cache.match(scopeUrl('./'))
        : await cache.match(request);
    if (cached) return cached;
    try {
        return await fetch(request);
    } catch (err) {
        // Offline and not precached.
        return Response.error();
    }
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    const scope = self.registration ? self.registration.scope : scopeUrl('./');
    if (!url.href.startsWith(scope)) return;
    event.respondWith(respond(request));
});
