#!/usr/bin/env node
// Dev-only: regenerate the PRECACHE list and CACHE_VERSION in sw.js from the
// files on disk.
//
//   node scripts/update-sw-version.mjs          rewrite sw.js
//   node scripts/update-sw-version.mjs --check  exit 1 if sw.js is stale
//
// Run it before every commit that adds, removes or changes a precached file
// (index.html, style.css, manifest.webmanifest, js/*.js, js/3d/**/*.js including
// the vendored three.js, assets/audio/*.mp3, icons/*.png). tests/unit/sw-version.test.mjs fails while sw.js is stale.
//
// The version is a content hash of every precached file (path + bytes), so
// any change ships as a new cache and old caches are cleaned up on activate.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const BEGIN = '// @generated-begin (scripts/update-sw-version.mjs; do not edit by hand)';
const END = '// @generated-end';

function listDir(root, dir, ext) {
    const full = join(root, dir);
    if (!existsSync(full)) return [];
    return readdirSync(full, { withFileTypes: true })
        .filter((d) => d.isFile() && d.name.endsWith(ext) && !d.name.startsWith('.'))
        .map((d) => `${dir}/${d.name}`)
        .sort();
}

/** Every file with extension `ext` under `dir`, recursively (sorted, '/' separators). */
function listTree(root, dir, ext) {
    const full = join(root, dir);
    if (!existsSync(full)) return [];
    const out = [];
    for (const d of readdirSync(full, { withFileTypes: true })) {
        if (d.name.startsWith('.')) continue;
        if (d.isDirectory()) out.push(...listTree(root, `${dir}/${d.name}`, ext));
        else if (d.isFile() && d.name.endsWith(ext)) out.push(`${dir}/${d.name}`);
    }
    return out.sort();
}

/** Files to precache, relative to the app root (without the leading './'). */
export function collectFiles(root = DEFAULT_ROOT) {
    const top = ['index.html', 'style.css', 'manifest.webmanifest'].filter((f) => existsSync(join(root, f)));
    return [
        ...top,
        ...listDir(root, 'js', '.js'),
        // The 3D prototype is cached for everyone (docs/plans/06-3d-mode.md §8.3), even
        // though 2D never imports it; the vendored three.js lives in js/3d/vendor/.
        ...listTree(root, 'js/3d', '.js'),
        ...listDir(root, 'assets/audio', '.mp3'),
        ...listDir(root, 'icons', '.png'),
    ];
}

/** Full PRECACHE array as it should appear in sw.js. */
export function computePrecache(root = DEFAULT_ROOT) {
    return ['./', ...collectFiles(root)];
}

/** 'sa-' + first 12 hex chars of sha256 over every file's path and bytes. */
export function computeVersion(root = DEFAULT_ROOT, files = collectFiles(root)) {
    const hash = createHash('sha256');
    for (const f of files) {
        hash.update(f);
        hash.update('\0');
        hash.update(readFileSync(join(root, f)));
        hash.update('\0');
    }
    return 'sa-' + hash.digest('hex').slice(0, 12);
}

export function renderBlock(version, precache) {
    const lines = precache.map((u) => `    '${u}',`).join('\n');
    return `${BEGIN}\nconst CACHE_VERSION = '${version}';\nconst PRECACHE = [\n${lines}\n];\n${END}`;
}

/** Read CACHE_VERSION and PRECACHE back out of sw.js source text. */
export function parseSw(source) {
    const start = source.indexOf(BEGIN);
    const end = source.indexOf(END);
    if (start < 0 || end < start) throw new Error('sw.js: generated block markers not found');
    const block = source.slice(start, end);
    const version = (block.match(/const CACHE_VERSION = '([^']*)';/) || [])[1];
    const listSrc = (block.match(/const PRECACHE = \[([\s\S]*?)\];/) || [])[1];
    if (version === undefined || listSrc === undefined) throw new Error('sw.js: could not parse generated block');
    const precache = [...listSrc.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    return { version, precache };
}

export function updateSource(source, version, precache) {
    const start = source.indexOf(BEGIN);
    const end = source.indexOf(END);
    if (start < 0 || end < start) throw new Error('sw.js: generated block markers not found');
    return source.slice(0, start) + renderBlock(version, precache) + source.slice(end + END.length);
}

/** Compare sw.js with the files on disk. */
export function checkSw(root = DEFAULT_ROOT) {
    const files = collectFiles(root);
    const expected = { version: computeVersion(root, files), precache: ['./', ...files] };
    const actual = parseSw(readFileSync(join(root, 'sw.js'), 'utf8'));
    const stale = actual.version !== expected.version ||
        JSON.stringify(actual.precache) !== JSON.stringify(expected.precache);
    return { stale, expected, actual };
}

export function run(root = DEFAULT_ROOT, { check = false, log = console.log } = {}) {
    const swPath = join(root, 'sw.js');
    const result = checkSw(root);
    if (check) {
        if (result.stale) log(`sw.js is stale: have ${result.actual.version}, expected ${result.expected.version}. Run: node scripts/update-sw-version.mjs`);
        else log(`sw.js is up to date (${result.actual.version}, ${result.actual.precache.length} entries)`);
        return result.stale ? 1 : 0;
    }
    if (!result.stale) {
        log(`sw.js already up to date (${result.actual.version}, ${result.actual.precache.length} entries)`);
        return 0;
    }
    const source = readFileSync(swPath, 'utf8');
    writeFileSync(swPath, updateSource(source, result.expected.version, result.expected.precache));
    log(`sw.js updated: ${result.actual.version} -> ${result.expected.version} (${result.expected.precache.length} entries)`);
    return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = run(DEFAULT_ROOT, { check: process.argv.includes('--check') });
}
