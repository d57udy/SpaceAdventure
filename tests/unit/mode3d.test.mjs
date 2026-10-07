import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    can3d, startupRoute, webgl2Renderer, readLastMode, writeLastMode, LAST_MODE_KEY, SOFTWARE_RENDERER, URL_3D, URL_2D,
} from '../../js/mode3d.js';

const q = (s) => new URLSearchParams(s);

test('can3d: a hardware WebGL2 renderer is offered; none or software is not', () => {
    assert.equal(can3d({ renderer: 'ANGLE (Qualcomm, Adreno 730)', params: q('') }), true);
    assert.equal(can3d({ renderer: 'Apple GPU', params: q('') }), true);
    assert.equal(can3d({ renderer: '', params: q('') }), true, 'name hidden by the browser');
    assert.equal(can3d({ renderer: null, params: q('') }), false, 'no WebGL2');
    for (const r of ['Google SwiftShader', 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))', 'llvmpipe (LLVM 15.0.7, 256 bits)', 'Microsoft Basic Render Driver']) {
        assert.equal(can3d({ renderer: r, params: q('') }), false, r);
        assert.ok(SOFTWARE_RENDERER.test(r));
    }
});

test('can3d: force3d and no3d flags; automated browsers only when forced', () => {
    assert.equal(can3d({ renderer: null, params: q('?force3d=1') }), true);
    assert.equal(can3d({ renderer: 'Apple GPU', params: q('?no3d=1') }), false);
    assert.equal(can3d({ renderer: 'Apple GPU', params: q(''), webdriver: true }), false);
    assert.equal(can3d({ renderer: 'Google SwiftShader', params: q('?force3d=1'), webdriver: true }), true);
});

test('startupRoute: ?2d=1 stays and forgets; the installed app reopens 3D', () => {
    assert.deepEqual(startupRoute({ params: q('?2d=1'), lastMode: '3d', standalone: true, available: true }),
        { go3d: false, clearLastMode: true });
    assert.deepEqual(startupRoute({ params: q(''), lastMode: '3d', standalone: true, available: true }),
        { go3d: true, clearLastMode: false });
    assert.equal(startupRoute({ params: q(''), lastMode: '3d', standalone: false, available: true }).go3d, false, 'browser tab: menu');
    assert.equal(startupRoute({ params: q(''), lastMode: '2d', standalone: true, available: true }).go3d, false);
    assert.equal(startupRoute({ params: q(''), lastMode: null, standalone: true, available: true }).go3d, false);
    assert.equal(startupRoute({ params: q(''), lastMode: '3d', standalone: true, available: false }).go3d, false, 'no 3D on this device');
});

test('last mode storage round-trip and failures', () => {
    const map = new Map();
    const s = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) };
    writeLastMode(s, '3d');
    assert.equal(map.get(LAST_MODE_KEY), '3d');
    assert.equal(readLastMode(s), '3d');
    writeLastMode(s, null);
    assert.equal(readLastMode(s), null);
    const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
    assert.equal(readLastMode(broken), null);
    writeLastMode(broken, '3d');
    assert.equal(readLastMode(null), null);
});

test('webgl2Renderer: unmasked name, released context; null without WebGL2 or on errors', () => {
    let lost = false;
    const gl = {
        RENDERER: 1,
        getExtension: (n) => (n === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 2 } : n === 'WEBGL_lose_context' ? { loseContext: () => { lost = true; } } : null),
        getParameter: (p) => (p === 2 ? 'Adreno 730' : 'WebKit WebGL'),
    };
    const doc = (ctx) => ({ createElement: () => ({ getContext: () => ctx }) });
    assert.equal(webgl2Renderer(doc(gl)), 'Adreno 730');
    assert.ok(lost);
    assert.equal(webgl2Renderer(doc(null)), null);
    assert.equal(webgl2Renderer({ createElement() { throw new Error('no'); } }), null);
    const masked = { ...gl, getExtension: () => null };
    assert.equal(webgl2Renderer(doc(masked)), 'WebKit WebGL');
});

test('URLs are relative, so they work under the Pages sub-path', () => {
    assert.equal(URL_3D, './?3d=1');
    assert.equal(URL_2D, './?2d=1');
});
