#!/usr/bin/env node
// Tiny static server for tests. Serves the repo under a sub-path (default
// /SpaceAdventure/) to mimic GitHub Pages, so service worker scope and
// relative URLs are exercised the way they are in production.
//
//   node tests/support/serve.mjs [--port 8083] [--prefix /SpaceAdventure/]
//                                [--root .] [--max-age 0] [--admin]
//
// --max-age N  sends Cache-Control: max-age=N (GitHub Pages uses 600).
// --admin      enables test-only endpoints for the update-flow spec:
//                POST /__admin/override?path=sw.js   body replaces that file
//                POST /__admin/reset                 drops all overrides
//
// Also importable: `const { server, url } = await startServer({ ... })`.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.txt': 'text/plain; charset=utf-8',
};

function normalizePrefix(prefix) {
    let p = prefix || '/';
    if (!p.startsWith('/')) p = '/' + p;
    if (!p.endsWith('/')) p += '/';
    return p;
}

export function createStaticServer({ root = REPO_ROOT, prefix = '/SpaceAdventure/', maxAge = 0, admin = false } = {}) {
    const base = normalizePrefix(prefix);
    const rootDir = resolve(root);
    const overrides = new Map();

    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, 'http://localhost');
            let pathname = decodeURIComponent(url.pathname);

            if (admin && pathname.startsWith('/__admin/')) {
                if (req.method !== 'POST') { res.writeHead(405).end(); return; }
                if (pathname === '/__admin/reset') {
                    overrides.clear();
                    res.writeHead(204).end();
                    return;
                }
                if (pathname === '/__admin/override') {
                    const target = (url.searchParams.get('path') || '').replace(/^\/+/, '');
                    const chunks = [];
                    for await (const c of req) chunks.push(c);
                    overrides.set(target, Buffer.concat(chunks));
                    res.writeHead(204).end();
                    return;
                }
                res.writeHead(404).end();
                return;
            }

            if (base !== '/' && (pathname === base.slice(0, -1) || pathname === '/')) {
                res.writeHead(301, { Location: base }).end();
                return;
            }
            if (!pathname.startsWith(base)) {
                res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
                return;
            }
            let rel = pathname.slice(base.length);
            if (rel === '' || rel.endsWith('/')) rel += 'index.html';

            const filePath = normalize(join(rootDir, rel));
            if (filePath !== rootDir && !filePath.startsWith(rootDir + sep)) {
                res.writeHead(403).end();
                return;
            }

            let body = overrides.get(rel);
            if (!body) {
                const info = await stat(filePath).catch(() => null);
                if (!info || !info.isFile()) {
                    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
                    return;
                }
                body = await readFile(filePath);
            }
            const headers = {
                'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
                'Content-Length': body.length,
                'Cache-Control': maxAge > 0 ? `max-age=${maxAge}` : 'no-cache',
            };
            res.writeHead(200, headers);
            if (req.method === 'HEAD') res.end();
            else res.end(body);
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' }).end(String(err && err.message));
        }
    });

    return { server, base, overrides };
}

export async function startServer({ port = 0, host = '127.0.0.1', ...opts } = {}) {
    const { server, base, overrides } = createStaticServer(opts);
    await new Promise((ok, fail) => {
        server.once('error', fail);
        server.listen(port, host, ok);
    });
    const actualPort = server.address().port;
    return {
        server,
        overrides,
        port: actualPort,
        url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${actualPort}${base}`,
        close: () => new Promise((ok) => server.close(() => ok())),
    };
}

function argValue(args, name, fallback) {
    const i = args.indexOf(name);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const port = Number(argValue(args, '--port', process.env.PORT || 8083));
    const prefix = argValue(args, '--prefix', '/SpaceAdventure/');
    const root = resolve(argValue(args, '--root', REPO_ROOT));
    const maxAge = Number(argValue(args, '--max-age', 0));
    const admin = args.includes('--admin');
    // Bind to localhost so Playwright's `port` readiness check succeeds.
    startServer({ port, host: 'localhost', prefix, root, maxAge, admin }).then(({ url }) => {
        console.log(`Serving ${root} at ${url}${admin ? ' (admin endpoints on)' : ''}`);
    });
}
