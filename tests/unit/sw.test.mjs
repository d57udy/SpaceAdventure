import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Loads sw.js in a node:vm context with fake caches / clients / fetch.
const SW_SOURCE = readFileSync(fileURLToPath(new URL('../../sw.js', import.meta.url)), 'utf8');
const SCOPE = 'https://example.test/SpaceAdventure/';

class FakeRequest {
    constructor(url, init = {}) {
        this.url = typeof url === 'string' ? url : url.url;
        this.method = init.method || 'GET';
        this.mode = init.mode || 'cors';
        this.cache = init.cache || 'default';
    }
}

class FakeCache {
    constructor(storage) { this.storage = storage; this.entries = new Map(); this.added = []; }
    async addAll(requests) {
        for (const r of requests) {
            this.added.push(r);
            this.entries.set(r.url, await this.storage.fetchImpl(r));
        }
    }
    async put(req, res) { this.entries.set(typeof req === 'string' ? req : req.url, res); }
    async match(req) { return this.entries.get(typeof req === 'string' ? req : req.url); }
}

class FakeCacheStorage {
    constructor(fetchImpl) { this.fetchImpl = fetchImpl; this.map = new Map(); }
    async open(name) {
        if (!this.map.has(name)) this.map.set(name, new FakeCache(this));
        return this.map.get(name);
    }
    async keys() { return [...this.map.keys()]; }
    async delete(name) { return this.map.delete(name); }
    async has(name) { return this.map.has(name); }
}

function load() {
    const handlers = {};
    const calls = { fetch: [], skipWaiting: 0, claim: 0 };
    const net = { offline: false };
    const fetchImpl = async (req) => {
        const url = typeof req === 'string' ? req : req.url;
        calls.fetch.push(req);
        if (net.offline) throw new TypeError('Failed to fetch');
        return { source: 'network', url };
    };
    const caches = new FakeCacheStorage(fetchImpl);
    const self = {
        location: new URL(SCOPE + 'sw.js'),
        registration: { scope: SCOPE },
        clients: { claim: async () => { calls.claim++; } },
        skipWaiting: () => { calls.skipWaiting++; return Promise.resolve(); },
        addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
    };
    const ErrorResponse = { type: 'error' };
    const ctx = vm.createContext({
        self, caches, fetch: fetchImpl, Request: FakeRequest, URL, console,
        Response: { error: () => ErrorResponse },
    });
    vm.runInContext(SW_SOURCE, ctx, { filename: 'sw.js' });
    const g = (expr) => vm.runInContext(expr, ctx);

    async function dispatchExtendable(type, props = {}) {
        let p = Promise.resolve();
        const ev = { ...props, waitUntil(x) { p = x; } };
        for (const h of handlers[type] || []) h(ev);
        await p;
        return ev;
    }
    function dispatchFetch(request) {
        let responded = null;
        const ev = { request, respondWith(p) { responded = Promise.resolve(p); } };
        for (const h of handlers.fetch || []) h(ev);
        return responded; // null => not handled (browser default)
    }
    function dispatchMessage(data, extra = {}) {
        for (const h of handlers.message || []) h({ data, ...extra });
    }
    return {
        caches, calls, net, handlers, dispatchExtendable, dispatchFetch, dispatchMessage, ErrorResponse,
        CACHE_NAME: g('CACHE_NAME'), CACHE_PREFIX: g('CACHE_PREFIX'),
        CACHE_VERSION: g('CACHE_VERSION'), PRECACHE: [...g('PRECACHE')],
    };
}

test('cache name uses the space-adventure- prefix and a sa- content version', () => {
    const sw = load();
    assert.equal(sw.CACHE_PREFIX, 'space-adventure-');
    assert.match(sw.CACHE_VERSION, /^sa-[0-9a-f]{12}$/);
    assert.equal(sw.CACHE_NAME, 'space-adventure-' + sw.CACHE_VERSION);
});

test('registers install, activate, message and fetch handlers', () => {
    const sw = load();
    for (const t of ['install', 'activate', 'message', 'fetch']) {
        assert.equal((sw.handlers[t] || []).length, 1, t);
    }
});

test('install precaches every PRECACHE entry with cache: reload and does not skipWaiting', async () => {
    const sw = load();
    await sw.dispatchExtendable('install');
    const cache = sw.caches.map.get(sw.CACHE_NAME);
    assert.ok(cache, 'versioned cache created');
    assert.equal(cache.added.length, sw.PRECACHE.length);
    for (const r of cache.added) assert.equal(r.cache, 'reload');
    const urls = cache.added.map((r) => r.url);
    assert.deepEqual(urls, sw.PRECACHE.map((u) => new URL(u, SCOPE).href));
    assert.ok(urls.includes(SCOPE), "'./' resolves to the scope root");
    assert.equal(sw.calls.skipWaiting, 0);
});

test('PRECACHE contains the app shell', () => {
    const { PRECACHE } = load();
    for (const f of ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'js/main.js', 'js/pwa.js']) {
        assert.ok(PRECACHE.includes(f), f);
    }
    assert.ok(PRECACHE.some((f) => f.endsWith('.mp3')));
    assert.ok(PRECACHE.some((f) => f.startsWith('icons/') && f.endsWith('.png')));
    assert.ok(!PRECACHE.includes('sw.js'), 'the worker itself is never precached');
});

test('activate deletes only old space-adventure- caches and claims clients', async () => {
    const sw = load();
    await sw.caches.open('space-adventure-sa-old000000000');
    await sw.caches.open('space-adventure-sa-older0000000');
    await sw.caches.open('other-app-cache');
    await sw.caches.open('workbox-precache-v2');
    await sw.caches.open(sw.CACHE_NAME);
    await sw.dispatchExtendable('activate');
    assert.deepEqual((await sw.caches.keys()).sort(), [sw.CACHE_NAME, 'other-app-cache', 'workbox-precache-v2'].sort());
    assert.equal(sw.calls.claim, 1);
});

test('SKIP_WAITING message calls skipWaiting; other messages do not', () => {
    const sw = load();
    sw.dispatchMessage({ type: 'NOPE' });
    sw.dispatchMessage(null);
    assert.equal(sw.calls.skipWaiting, 0);
    sw.dispatchMessage({ type: 'SKIP_WAITING' });
    assert.equal(sw.calls.skipWaiting, 1);
});

test('GET_VERSION replies on the message port', () => {
    const sw = load();
    const got = [];
    sw.dispatchMessage({ type: 'GET_VERSION' }, { ports: [{ postMessage: (m) => got.push(m) }] });
    assert.equal(got.length, 1);
    assert.equal(got[0].version, sw.CACHE_VERSION);
    assert.equal(got[0].cacheName, sw.CACHE_NAME);
});

test('fetch serves precached files from the cache without touching the network', async () => {
    const sw = load();
    await sw.dispatchExtendable('install');
    sw.calls.fetch.length = 0;
    const res = await sw.dispatchFetch(new FakeRequest(SCOPE + 'js/main.js'));
    assert.equal(res.url, SCOPE + 'js/main.js');
    assert.equal(sw.calls.fetch.length, 0);
});

test('navigations to the app root or index.html are answered with the cached ./ (any query)', async () => {
    const sw = load();
    await sw.dispatchExtendable('install');
    const cache = sw.caches.map.get(sw.CACHE_NAME);
    await cache.put(SCOPE, { source: 'cache-root' });
    sw.calls.fetch.length = 0;
    for (const u of [SCOPE, SCOPE + 'index.html', SCOPE + '?sw=1', SCOPE + 'index.html?x=1']) {
        const res = await sw.dispatchFetch(new FakeRequest(u, { mode: 'navigate' }));
        assert.equal(res.source, 'cache-root', u);
    }
    assert.equal(sw.calls.fetch.length, 0);
});

test('other navigations in scope are not answered with the game', async () => {
    const sw = load();
    await sw.dispatchExtendable('install');
    const cache = sw.caches.map.get(sw.CACHE_NAME);
    await cache.put(SCOPE, { source: 'cache-root' });
    sw.calls.fetch.length = 0;
    for (const u of [SCOPE + 'some/deep/link', SCOPE + 'docs/plans/README.md', SCOPE + 'index.htmlx']) {
        const res = await sw.dispatchFetch(new FakeRequest(u, { mode: 'navigate' }));
        assert.notEqual(res.source, 'cache-root', u);
    }
    assert.equal(sw.calls.fetch.length, 3);
});

test('cache miss goes to the network', async () => {
    const sw = load();
    const res = await sw.dispatchFetch(new FakeRequest(SCOPE + 'js/not-precached.js'));
    assert.equal(res.source, 'network');
    assert.equal(sw.calls.fetch.length, 1);
});

test('offline cache miss returns Response.error()', async () => {
    const sw = load();
    sw.net.offline = true;
    const res = await sw.dispatchFetch(new FakeRequest(SCOPE + 'missing.png'));
    assert.equal(res, sw.ErrorResponse);
    const nav = await sw.dispatchFetch(new FakeRequest(SCOPE, { mode: 'navigate' }));
    assert.equal(nav, sw.ErrorResponse, 'navigation with nothing cached');
});

test('offline after install: everything precached still loads', async () => {
    const sw = load();
    await sw.dispatchExtendable('install');
    sw.net.offline = true;
    for (const f of sw.PRECACHE) {
        const res = await sw.dispatchFetch(new FakeRequest(new URL(f, SCOPE).href));
        assert.notEqual(res, sw.ErrorResponse, f);
    }
});

test('non-GET, cross-origin and out-of-scope requests are not intercepted', () => {
    const sw = load();
    assert.equal(sw.dispatchFetch(new FakeRequest(SCOPE + 'x', { method: 'POST' })), null);
    assert.equal(sw.dispatchFetch(new FakeRequest('https://cdn.other.test/lib.js')), null);
    assert.equal(sw.dispatchFetch(new FakeRequest('https://example.test/OtherRepo/index.html', { mode: 'navigate' })), null);
    assert.equal(sw.calls.fetch.length, 0);
});
