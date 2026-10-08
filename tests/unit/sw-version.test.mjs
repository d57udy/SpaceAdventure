import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    DEFAULT_ROOT, collectFiles, computePrecache, computeVersion, parseSw, updateSource, checkSw, run,
} from '../../scripts/update-sw-version.mjs';

// If this file fails with "sw.js is stale", run:
//     node scripts/update-sw-version.mjs      (npm run sw:version)
// Any added, removed or changed precached file (index.html, style.css,
// manifest.webmanifest, js/*.js, js/3d/**/*.js, assets/audio/*.mp3, icons/*.png) needs it.
const HOW_TO_FIX = 'sw.js is stale. Run: node scripts/update-sw-version.mjs (npm run sw:version)';

test('sw.js PRECACHE matches the files on disk', () => {
    const { actual } = checkSw(DEFAULT_ROOT);
    assert.deepEqual(actual.precache, computePrecache(DEFAULT_ROOT), HOW_TO_FIX);
});

test('sw.js CACHE_VERSION matches the content hash of the precached files', () => {
    const { actual, expected } = checkSw(DEFAULT_ROOT);
    assert.equal(actual.version, expected.version, HOW_TO_FIX);
});

test('the 3D prototype (js/3d/**, vendored three.js included) is precached for everyone', () => {
    const { actual } = checkSw(DEFAULT_ROOT);
    for (const f of ['js/3d/proto3d.js', 'js/3d/render3d.js', 'js/3d/vendor/three.module.min.js', 'js/3d/vendor/three.core.min.js']) {
        assert.ok(actual.precache.includes(f), `${f} missing. ${HOW_TO_FIX}`);
    }
    assert.ok(!actual.precache.includes('js/3d/vendor/LICENSE'), 'only .js files');
});

test('every js/*.js module is precached', () => {
    const { actual } = checkSw(DEFAULT_ROOT);
    for (const f of collectFiles(DEFAULT_ROOT).filter((f) => f.startsWith('js/'))) {
        assert.ok(actual.precache.includes(f), `${f} missing. ${HOW_TO_FIX}`);
    }
});

// --- Script behaviour on a throwaway fixture --------------------------------

function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'sw-version-'));
    mkdirSync(join(dir, 'js'));
    mkdirSync(join(dir, 'assets/audio'), { recursive: true });
    mkdirSync(join(dir, 'icons'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html>');
    writeFileSync(join(dir, 'style.css'), 'body{}');
    writeFileSync(join(dir, 'manifest.webmanifest'), '{}');
    writeFileSync(join(dir, 'js/b.js'), 'export const b = 1;');
    writeFileSync(join(dir, 'js/a.js'), 'export const a = 1;');
    writeFileSync(join(dir, 'js/notes.txt'), 'not precached');
    mkdirSync(join(dir, 'js/3d/vendor'), { recursive: true });
    writeFileSync(join(dir, 'js/3d/z.js'), 'export const z = 1;');
    writeFileSync(join(dir, 'js/3d/vendor/lib.min.js'), 'export const l = 1;');
    writeFileSync(join(dir, 'js/3d/vendor/LICENSE'), 'MIT');
    writeFileSync(join(dir, 'assets/audio/boom.mp3'), 'mp3');
    writeFileSync(join(dir, 'icons/icon-192.png'), 'png');
    writeFileSync(join(dir, 'icons/icon.svg'), '<svg/>');
    copyFileSync(join(DEFAULT_ROOT, 'sw.js'), join(dir, 'sw.js'));
    return dir;
}

test('collectFiles lists shell, sorted js (js/3d recursively), mp3 and png only', () => {
    const dir = fixture();
    try {
        assert.deepEqual(collectFiles(dir), [
            'index.html', 'style.css', 'manifest.webmanifest',
            'js/a.js', 'js/b.js', 'js/3d/vendor/lib.min.js', 'js/3d/z.js', 'assets/audio/boom.mp3', 'icons/icon-192.png',
        ]);
        assert.equal(computePrecache(dir)[0], './');
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('version changes when content changes, a file is added, or a file is renamed', () => {
    const dir = fixture();
    try {
        const v1 = computeVersion(dir);
        assert.match(v1, /^sa-[0-9a-f]{12}$/);
        assert.equal(computeVersion(dir), v1, 'deterministic');
        writeFileSync(join(dir, 'js/a.js'), 'export const a = 2;');
        const v2 = computeVersion(dir);
        assert.notEqual(v2, v1);
        writeFileSync(join(dir, 'js/c.js'), '');
        assert.notEqual(computeVersion(dir), v2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('run() rewrites a stale sw.js and --check detects staleness', () => {
    const dir = fixture();
    const quiet = () => {};
    try {
        assert.equal(run(dir, { check: true, log: quiet }), 1, 'copied sw.js is stale for the fixture');
        assert.equal(run(dir, { log: quiet }), 0);
        assert.equal(checkSw(dir).stale, false);
        assert.equal(run(dir, { check: true, log: quiet }), 0);

        const src = readFileSync(join(dir, 'sw.js'), 'utf8');
        const parsed = parseSw(src);
        assert.deepEqual(parsed.precache, computePrecache(dir));
        assert.equal(parsed.version, computeVersion(dir));
        // Code outside the generated block is untouched.
        assert.ok(src.includes("const CACHE_PREFIX = 'space-adventure-';"));
        assert.ok(src.includes("self.addEventListener('fetch'"));

        // A new module makes it stale again (this is what happens when
        // someone adds js/foo.js and forgets to re-run the script).
        writeFileSync(join(dir, 'js/new-module.js'), '');
        assert.equal(checkSw(dir).stale, true);
        run(dir, { log: quiet });
        assert.ok(parseSw(readFileSync(join(dir, 'sw.js'), 'utf8')).precache.includes('js/new-module.js'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('updateSource is idempotent', () => {
    const src = readFileSync(join(DEFAULT_ROOT, 'sw.js'), 'utf8');
    const { version, precache } = parseSw(src);
    assert.equal(updateSource(src, version, precache), src);
});

test('js/version.js carries the cache version (precached, left out of the hash)', async () => {
    const { VERSION_FILE, versionSource } = await import('../../scripts/update-sw-version.mjs');
    const { actual, expected } = checkSw(DEFAULT_ROOT);
    assert.equal(readFileSync(join(DEFAULT_ROOT, VERSION_FILE), 'utf8'), versionSource(expected.version), HOW_TO_FIX);
    assert.ok(actual.precache.includes(VERSION_FILE));
    const { BUILD_VERSION } = await import('../../js/version.js');
    assert.equal(BUILD_VERSION, actual.version);
});
