# Items 1 and 2: Colour-blind friendly asteroids, sharp rendering on tablets

Line numbers refer to `js/main.js` unless another file is named, as of the working tree after the freeze fix. Settings placement follows [README §A](README.md#a-one-settings-screen-instead-of-more-main-menu-rows): the "Colours" option lives on the Settings screen, not the main menu.

**Order:** Item 2 first. It is a mechanical refactor across almost every draw call; Item 1 then adds drawing code on top of it.

---

## Item 2: Sharp rendering on HiDPI tablets

### Goal and user impact
- `resizeCanvas()` (lines ~1398–1433) sets `canvas.width/height` to the CSS size. On an iPad (`devicePixelRatio` 2) the browser upscales that 2x, so every line, star and piece of canvas text is soft. Tablets are exactly the audience of the recent touch work.
- Goal: backing store = CSS size x devicePixelRatio (capped at 2), identical gameplay and world size, taps still landing exactly, 60 fps on older iPads (A10, iPad gen 7) at level 10+.

### UX
No layout change: the canvas stays a square of 90% of the smaller window side in CSS pixels. Lines, glows, stars and all canvas text (44 `ctx.font` assignments) become crisp. The DOM HUD and SVG buttons are already sharp.

### Technical approach
1. **Separate logical and backing size.** `canvas.width`/`canvas.height` are used as the logical view size in about 130 places (camera, culling in `drawEntityWrapped`, starfield, radar, menus and tap regions, entity update arguments, UFO spawn, boss target, floating texts, `addFullScreenTap`). Add next to `WORLD_WIDTH`:
   ```js
   let viewWidth = 800, viewHeight = 800;   // logical (CSS) pixels: all game code uses these
   let renderScale = 1;                     // backing pixels per CSS pixel (capped dpr)
   ```
   Replace `canvas.width`/`canvas.height` with `viewWidth`/`viewHeight` everywhere in `main.js` except inside `resizeCanvas`. Gate: afterwards `grep -n "canvas\.\(width\|height\)" js/main.js` only hits `resizeCanvas`. Other modules receive sizes as parameters and need no changes.
2. **New pure helper `js/viewport.js`:**
   ```js
   export const MAX_RENDER_SCALE = 2;
   export function computeCanvasSize(innerW, innerH, dpr, maxScale = MAX_RENDER_SCALE) {
     const css = Math.floor(Math.min(innerW, innerH) * 0.9);
     const scale = Math.min(Math.max(dpr || 1, 1), maxScale);
     const backing = Math.round(css * scale);
     return { css, scale: backing / css, backing };   // exact ratio avoids sub-pixel drift
   }
   ```
3. **Rewrite `resizeCanvas()`:** compute sizes; keep the tiny-size guard; set `canvas.style.width/height = css + 'px'` (now required, or the canvas displays at backing size); set backing size; `viewWidth = viewHeight = css`; `ctx.setTransform(scale, 0, 0, scale, 0, 0)`; world size from the **logical** size only; release the joystick only when the CSS size changed; early-out when nothing changed (iOS fires many resize events when the toolbar collapses).
4. **Per-frame transform:** at the top of `renderGame()`, `ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0)` before clearing. This also recovers from any unbalanced save/restore. The camera translate composes on top.
5. **DPR changes without a resize** (browser zoom, moving a window between monitors): watch `matchMedia('(resolution: Xdppx)')` and re-run `resizeCanvas`.
6. **Tap mapping in `js/input.js`:** taps are currently scaled by `canvas.width / rect.width`, which would give backing pixels and put every menu tap off by 2x on an iPad. Add a `getLogicalSize` option to the `InputHandler` constructor and map taps with it; `main.js` passes `() => ({ width: viewWidth, height: viewHeight })`. The joystick already works in CSS pixels.
7. **Test hook:** `get view()` returning `{ width, height, scale, backingWidth, backingHeight, dpr }`. Update `canvasToPage` in `tests/integration/helpers.js` to use `view.width`, or every touch test breaks on the iPad projects.
8. **Line widths and text:** the uniform transform keeps today's look, just crisp. Stars of 0.5–2.5 px may look fainter; review and consider `size * 1.1`.
9. **Performance on older iPads:** iPad gen 7 portrait goes from 0.53 to 2.1 megapixels per frame. Mitigations in order:
   1. Cap the scale at 2.
   2. Cache the background radial gradient per resize instead of rebuilding it every frame, and drop the redundant black fill.
   3. Replace `shadowBlur` glows with a cheaper wide low-alpha stroke. This also fixes `shadowBlur` not scaling consistently across browsers.
   4. Batch star drawing.
   5. Adaptive fallback: if average frame time exceeds 22 ms for 3 s while playing, lower the cap to 1.5, then 1, for the rest of the session. Exposed in the hook.

### Tasks
1. `js/viewport.js` + unit tests.
2. Introduce `viewWidth`/`viewHeight`/`renderScale`; mechanical replace; grep gate.
3. Rewrite `resizeCanvas()`; transform at the start of `renderGame()`.
4. `InputHandler` logical-size option; hook `view`; update `canvasToPage`.
5. DPR change watcher.
6. Performance work (gradient cache, glow replacement, adaptive fallback).
7. Full suite on all Playwright projects; compare screenshots.
8. Real iPad check with the Safari Web Inspector timeline.

### Tests
- **Unit `tests/unit/viewport.test.mjs`:** `(810, 1080, 2)` → css 729, backing 1458, scale 2; `(1280, 800, 1)` → 720/720/1; DPR 3 capped to 2; DPR 1.5 gives `scale = backing / css`; DPR 0/undefined treated as 1; tiny viewport returns css < 50.
- **Unit `input.test.mjs`:** rewrite the canvas-tap test: backing 1600x1200, rect 800x600, logical 800x600, tap at client (300, 200) with rect at (100, 50) → (200, 150) regardless of backing size; logical 400x300 → (100, 75); no provider falls back to CSS pixels.
- **Integration (`hidpi.spec.js` or `smoke.spec.js`):** backing = round(view.width x min(dpr, 2)); canvas CSS width equals `view.width` (the CSS size did not double); world size identical at DPR 1 and 2; DPR 3 capped via `test.use({ deviceScaleFactor: 3 })`; menu taps on the retina iPad project hit the right items; rotation keeps the ship in the world; `loopErrors === 0` after 5 s of play.
- **Screenshots:** canvas screenshots at DPR 2 are 1458 px wide; optional edge-sharpness comparison of the menu title at DPR 1 versus DPR 2.
- **UAT:** real iPad (ideally gen 6/7 and a Pro): crisp text, accurate taps near item edges, rotation mid-game, 2 minutes at level 8+ under 16.7 ms per frame. Desktop: move between retina and non-retina monitors, browser zoom.

### Risks
| Risk | Mitigation |
|---|---|
| A missed `canvas.width` renders something at 2x position | Grep gate; screenshot review on the iPad project |
| Taps off by 2x on retina | Logical-size provider plus unit and iPad integration tests |
| iPad fill-rate and `shadowBlur` cost | Cap at 2, cache gradient, replace glow, adaptive fallback |
| Resizing clears the canvas (brief flash) | Early-out when nothing changed |
| Old `input.js` cached next to new `main.js` for up to 10 minutes after deploy | Additive option; ship both in one commit (the service worker in Item 3 later makes updates atomic) |

**GitHub Pages:** purely client-side, no headers needed. **Effort:** M (1–2 days, plus about half a day of performance work).

**Open questions:** cap at 2 or native 3 on phones; oldest iPad to support at 60 fps; visible "Graphics: Sharp/Fast" setting or automatic fallback only; keep the soft glow look by thickening thin lines; should the canvas use the extra resolution to fill more of the iPad screen (separate layout decision).

---

## Item 1: Colour-blind friendly asteroids

### Goal and user impact
- Players must tell collectibles from hazards without colour. Shape, texture, motion and wording each carry the difference. About 8% of male players have red-green colour blindness.
- An optional **Colour-safe** palette (blue for collect, orange for danger), saved per device like the Controls setting.
- Side benefits: faster recognition for everyone, better on sunlit tablet screens, grayscale screenshots that still make sense.

### Visual design

| | Collectible "crystal" | Hazard "spiky rock" |
|---|---|---|
| Outline | Smooth near-regular polygon, 8–10 vertices, small jitter (0.08 instead of today's 0.4), rounded joins | Star shape: tips at full radius, valleys at 0.55–0.7x radius, sharp joins, thicker line (2.5) |
| Interior | Facet lines from centre to every other vertex plus a small fixed highlight | A non-rotating hazard mark at the centre ("X" or "!" in a circle), optionally 2–3 hazard stripes |
| Fill | Bright translucent, pulsing | Dark, nearly opaque |
| Motion | Existing glow pulse plus an occasional sparkle | No glow; optional slow outline throb |
| Brightness | High (#00FF00, luminance 0.72) | Low (#CC0000, luminance 0.13), about 4.3:1 contrast, so it also works in grayscale |

- **Hitbox unchanged** (circle of `radius`). Spike tips must reach `radius` so the danger is never smaller than it looks.
- **No clash with power-ups:** power-ups are hexagons with a letter, and Extra Life is also #00FF00, so the crystal must not be a hexagon.
- **Radar** (`drawRadar`): collectible = filled dot (as today); hazard = small "x"; UFO = diamond; power-up = hollow square or star. Every radar marker gets its own shape.
- **Particles:** collect = round sparkle burst plus an expanding ring. Hazard destroyed: today no particles are emitted when a red asteroid is shot or broken by the shield; add `Particles.shatter()` with 8–12 tumbling line-segment shards. Implement via a `shape` field (`dot`/`shard`/`ring`) in `Particles.spawn`.
- **Text:** the menu description becomes "Collect smooth GREEN crystals for points!" / "Avoid spiky RED rocks - shoot them!", with a small live icon before each line. The Help screen gets the same icons and names the shapes. Colour words follow the palette (GREEN/RED or BLUE/ORANGE). One shared `Asteroid.drawIcon(ctx, type, x, y, r)` keeps the menu, help and game consistent.
- **Palettes** (colour-safe values based on Okabe-Ito):
  - `standard`: collect #00FF00, hazard #CC0000 (radar #FF0000), words GREEN/RED.
  - `safe`: collect sky blue #3DB7FF, hazard orange #FF9500, words BLUE/ORANGE. Distinct under all three colour-blindness types and in grayscale.
  - Shapes are always on in both palettes; only colours change.

### Existing colour clashes to fix
1. **(Decided: change to purple.)** `UFO.draw` (`js/ufo.js:138`) strokes UFOs in `'lime'`, the same hue as collectible asteroids, while the Help screen says UFOs are purple (#9933FF) and the radar draws them magenta. Change the stroke to #9933FF. This confuses players with normal colour vision too.
2. In the colour-safe palette, Shield (#00FFFF) is close to the collect blue and Rapid Fire (#FF6600) to the hazard orange. The hexagon-plus-letter shape keeps them distinct; optionally recolour Rapid Fire in that palette.
3. Upgrades screen: affordability is shown only as green versus red "Cost:". Add a text cue such as "Cost: 800 (need 300)" or dim unaffordable rows.
4. Boss health bar is fine (length carries the meaning).

### Technical approach
- **New `js/palette.js`** (pure data, unit-testable): `Palettes = { STANDARD, COLOUR_SAFE }` with `id, name, collect, collectFill(alpha), collectRadar, hazard, hazardFill, hazardRadar, collectWord, hazardWord`; `PALETTE_KEY = 'spaceAdventure_palette'`; `findPalette(id)` falling back to STANDARD.
- **`js/asteroid.js`:** split shape generation (`generateCrystalShape`, `generateSpikyShape`; the type is known before the shape is built) and drawing (`drawCrystal`, `drawSpiky`); `static palette = Palettes.STANDARD` (same pattern as `Entity.worldWidth`); `static drawIcon(...)` with fixed offsets and no `Math.random` during rendering.
- **`js/main.js`:** load/save the palette through `settings.js`, assign `Asteroid.palette`; radar shape coding; particle shapes and `shatter()` at every hazard-destroy point (bullet hit, shield break, UFO-bullet hit); palette colours for collect particles and floating score text; menu description and Help screen icons; hook `get palette()`; optionally green/red counts in `counts`.
- **`js/ufo.js`:** stroke colour to purple.
- README gameplay section: mention shapes and the Colour-safe option.

### Tasks
1. `palette.js` + unit tests.
2. Asteroid shape and drawing split, `drawIcon`.
3. Palette setting wired into Settings and the hook.
4. Radar shapes.
5. Particle shapes and `shatter()` at all hazard-destroy sites.
6. Menu description, Help screen, upgrade affordability text.
7. UFO colour fix.
8. Test helper updates, integration tests, colour-blind simulation screenshots.
9. Visual review on a real iPad and desktop in both palettes; README.

### Tests
- **Unit `palette.test.mjs`:** `findPalette` fallback; every palette has all keys with valid hex colours; **colour-blind check**: apply the Machado 2009 simulation matrices (protanopia, deuteranopia, tritanopia) and a grayscale conversion to collect versus hazard on the game background, and assert a luminance contrast of at least 2:1 or a colour difference (CIE76) of at least 20. This stops future palette edits from breaking accessibility.
- **Unit `gameEntities.test.mjs`:** crystal vertices all within 0.9–1.0x radius; hazard vertices alternate tips (≥ 0.95r) and valleys (≤ 0.72r) with at least one tip at r; red split children are red and spiky; `drawIcon` with a recording mock context draws facets for green and the mark for red and never calls `Math.random`; `draw()` uses the palette colours after a palette change.
- **Integration:** the Colours setting toggles `hook('palette')` and the drawn label, persists across reload, and works by keyboard and by tap on all touch projects; menu and Help texts use the palette words; tap regions still match menu items.
- **Colour-blind simulation screenshots** (desktop Chromium via CDP `Emulation.setEmulatedVisionDeficiency` for protanopia, deuteranopia, tritanopia, achromatopsia) of the menu, Help screen and gameplay in both palettes, for human review. Automated colour assertions stay in the unit test because pixel-sampling a moving game is flaky.
- **UAT:** Chrome DevTools "Emulate vision deficiencies": a tester who doesn't know the colours names collect versus danger within 1 s; iPad grayscale filter (Settings > Accessibility > Display > Colour Filters) for one level; ideally a real colour-blind player. Confirm UFOs no longer look like collectibles.

### Risks
- **Rendering cost:** facets and marks roughly double the path operations per asteroid; keep glow on the outer stroke only; test at level 10+ (40 asteroids, up to 9 wrapped copies each).
- **Readability at small size:** scale inner marks with radius; drop facets below radius 22.
- **Test churn:** Settings changes are handled once in the groundwork commit.
- **Mixed cached files after deploy:** guard new calls (`Asteroid.drawIcon?.(...)`) until the service worker (Item 3) makes updates atomic.

**GitHub Pages:** one new ES module, everything drawn on the canvas, no fonts or images. **Effort:** M (1.5–2.5 days). Soft dependency on Item 2.

**Open questions:** palette values (and a third "high contrast" option?); palette per device or per player; recolour Rapid Fire in colour-safe mode; "Colours" or "Colors"; keep calling them asteroids or "crystals/rocks". (UFO to purple: decided yes.)
