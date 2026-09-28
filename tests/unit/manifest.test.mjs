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
    // short_name is the Android launcher label (the WebAPK's android:label) and what the app
    // drawer search matches: it must contain the full name ("Space Adv" was not findable by
    // searching "Space Adventure"). Launchers show roughly 12-15 characters.
    assert.equal(manifest.short_name, 'Space Adventure');
    assert.ok(manifest.short_name.length <= 15);
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
    for (const shot of manifest.screenshots) assert.ok(isRelative(shot.src), shot.src);
    for (const app of manifest.related_applications) assert.ok(isRelative(app.url), app.url);
});

test('id and start_url stay "./" (a changed id makes Chrome treat it as a different app)', () => {
    assert.equal(manifest.id, './');
    assert.equal(manifest.start_url, './');
    assert.equal(manifest.scope, './');
    // Resolved under GitHub Pages: everything stays inside /SpaceAdventure/
    const base = new URL('https://d57udy.github.io/SpaceAdventure/manifest.webmanifest');
    for (const u of [manifest.id, manifest.start_url, manifest.scope]) {
        assert.equal(new URL(u, base).pathname, '/SpaceAdventure/');
    }
});

test('description, categories and install-related fields for a richer install dialog', () => {
    assert.ok(typeof manifest.description === 'string' && manifest.description.length >= 40, 'description');
    assert.ok(manifest.description.length <= 300);
    assert.ok(Array.isArray(manifest.categories) && manifest.categories.includes('games'));
    assert.equal(manifest.prefer_related_applications, false, 'true would hide the install prompt');
    // Self-reference so navigator.getInstalledRelatedApps() can tell a browser tab the app is installed
    assert.deepEqual(manifest.related_applications, [{ platform: 'webapp', url: 'manifest.webmanifest' }]);
    assert.ok(manifest.launch_handler && ['focus-existing', 'navigate-existing', 'auto', 'navigate-new']
        .includes(manifest.launch_handler.client_mode));
    assert.equal(manifest.display_override[0], manifest.display);
});

test('screenshots: one narrow and one wide, PNG, sizes match the files, within Chrome limits', () => {
    const shots = manifest.screenshots;
    assert.ok(Array.isArray(shots));
    for (const factor of ['narrow', 'wide']) {
        assert.ok(shots.some((s) => s.form_factor === factor), factor);
    }
    for (const s of shots) {
        assert.equal(s.type, 'image/png');
        assert.ok(s.label && s.label.length > 0, 'label');
        const file = join(ROOT, s.src);
        assert.ok(existsSync(file), s.src);
        const { width, height } = pngSize(file);
        assert.equal(`${width}x${height}`, s.sizes, s.src);
        // Chrome's richer install UI: 320..3840 px per side, long side <= 2.3x the short side
        for (const d of [width, height]) assert.ok(d >= 320 && d <= 3840, `${s.src} ${d}`);
        assert.ok(Math.max(width, height) / Math.min(width, height) <= 2.3, s.src);
        if (s.form_factor === 'narrow') assert.ok(height > width, 'narrow is portrait');
        if (s.form_factor === 'wide') assert.ok(width > height, 'wide is landscape');
    }
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
    // iOS home screen label: the full name, like the Android short_name
    assert.match(html, /<meta[^>]+name=["']apple-mobile-web-app-title["'][^>]+content=["']Space Adventure["']/);
    // No absolute URLs: the site lives under /SpaceAdventure/.
    assert.doesNotMatch(html, /(href|src)=["']\//);
});
