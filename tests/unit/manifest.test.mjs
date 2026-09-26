import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));

/** Width/height from a PNG's IHDR chunk. */
function pngSize(file) {
    const buf = readFileSync(file);
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    assert.ok(sig.every((b, i) => buf[i] === b), `${file} is not a PNG`);
    assert.equal(buf.toString('ascii', 12, 16), 'IHDR');
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
}

function isRelative(u) {
    return typeof u === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith('/');
}

test('manifest has the required fields', () => {
    assert.equal(manifest.name, 'Space Adventure');
    assert.ok(manifest.short_name && manifest.short_name.length <= 12);
    assert.equal(manifest.display, 'fullscreen');
    assert.deepEqual(manifest.display_override, ['fullscreen', 'standalone']);
    assert.equal(manifest.orientation, 'any');
    assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
    assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
});

test('all manifest URLs are relative (works at / and /SpaceAdventure/)', () => {
    for (const key of ['id', 'start_url', 'scope']) {
        assert.ok(isRelative(manifest[key]), `${key}=${manifest[key]}`);
    }
    for (const icon of manifest.icons) assert.ok(isRelative(icon.src), icon.src);
});

test('192, 512 and maskable 512 icons exist with matching pixel sizes', () => {
    const want = [
        { sizes: '192x192', purpose: 'any' },
        { sizes: '512x512', purpose: 'any' },
        { sizes: '512x512', purpose: 'maskable' },
    ];
    for (const w of want) {
        const icon = manifest.icons.find((i) => i.sizes === w.sizes && (i.purpose || 'any').split(' ').includes(w.purpose));
        assert.ok(icon, `${w.sizes} ${w.purpose}`);
        assert.equal(icon.type, 'image/png');
        const file = join(ROOT, icon.src);
        assert.ok(existsSync(file), icon.src);
        const { width, height } = pngSize(file);
        assert.equal(`${width}x${height}`, icon.sizes, icon.src);
    }
});

test('apple-touch-icon (180, opaque) and favicon (32) exist', () => {
    const apple = pngSize(join(ROOT, 'icons/apple-touch-icon-180.png'));
    assert.equal(apple.width, 180);
    assert.equal(apple.height, 180);
    assert.ok(apple.colorType !== 4 && apple.colorType !== 6, 'apple touch icon must not have an alpha channel');
    const fav = pngSize(join(ROOT, 'icons/favicon-32.png'));
    assert.equal(fav.width, 32);
    assert.equal(fav.height, 32);
    assert.ok(existsSync(join(ROOT, 'icons/icon.svg')), 'source artwork');
});

test('.nojekyll exists so GitHub Pages serves every file as-is', () => {
    assert.ok(existsSync(join(ROOT, '.nojekyll')));
});

// index.html is wired up by the integrator. Until then this test is skipped
// rather than failing, so it turns on automatically once the links land.
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const wired = /rel=["']manifest["']/.test(html);
test('index.html links the manifest, favicon and apple-touch-icon', { skip: !wired && 'index.html <head> links not added yet' }, () => {
    assert.match(html, /<link[^>]+rel=["']manifest["'][^>]+href=["']manifest\.webmanifest["']/);
    assert.match(html, /<link[^>]+rel=["']icon["'][^>]+href=["']icons\/favicon-32\.png["']/);
    assert.match(html, /<link[^>]+rel=["']apple-touch-icon["'][^>]+href=["']icons\/apple-touch-icon-180\.png["']/);
    assert.match(html, /<meta[^>]+name=["']apple-mobile-web-app-title["']/);
    // No absolute URLs: the site lives under /SpaceAdventure/.
    assert.doesNotMatch(html, /(href|src)=["']\//);
});
