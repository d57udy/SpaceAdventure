// Switching between the 2D and 3D games from the menus (docs/plans/07-3d-game.md §4).
// The 3D game is its own page (./?3d=1); the 3D menu's "Switch to 2D" opens ./?2d=1.
// Pure apart from the small DOM probe in webgl2Renderer().

export const LAST_MODE_KEY = 'spaceAdventure_lastMode';
// Software renderers draw 3D far too slowly to offer it
export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software rasterizer|microsoft basic render/i;
export const URL_3D = './?3d=1';
export const URL_2D = './?2d=1';

/**
 * The WebGL2 renderer name, '' when unknown, or null without WebGL2. The context is released
 * straight away so the 2D game keeps its graphics memory.
 */
export function webgl2Renderer(doc) {
    try {
        const canvas = doc.createElement('canvas');
        const gl = canvas.getContext('webgl2');
        if (!gl) return null;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
        return String(name || '');
    } catch {
        return null;
    }
}

/**
 * Is 3D offered in the 2D menu? `?force3d=1` always offers it, `?no3d=1` never does.
 * Automated browsers (navigator.webdriver) don't see it unless forced, so the 2D test suite
 * keeps the classic menu; CI's 3D tests use ?force3d=1.
 */
export function can3d({ renderer, params, webdriver = false }) {
    if (params && params.get('force3d') === '1') return true;
    if (params && params.get('no3d') === '1') return false;
    if (webdriver) return false;
    return typeof renderer === 'string' && !SOFTWARE_RENDERER.test(renderer);
}

/**
 * What the 2D page does on load.
 * - ?2d=1 (the 3D menu's Switch to 2D): stay in 2D and forget 3D as the last mode.
 * - The installed app (standalone) whose last mode was 3D opens 3D again.
 * @returns {{ go3d: boolean, clearLastMode: boolean }}
 */
export function startupRoute({ params, lastMode, standalone, available }) {
    if (params && params.get('2d') === '1') return { go3d: false, clearLastMode: true };
    return { go3d: !!(available && standalone && lastMode === '3d'), clearLastMode: false };
}

export function readLastMode(storage) {
    try { return storage ? storage.getItem(LAST_MODE_KEY) : null; } catch { return null; }
}

export function writeLastMode(storage, value) {
    try {
        if (!storage) return;
        if (value) storage.setItem(LAST_MODE_KEY, value);
        else storage.removeItem(LAST_MODE_KEY);
    } catch { /* private mode: nothing remembered */ }
}
