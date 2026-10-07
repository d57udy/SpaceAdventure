# Wiring js/3d/ui3d.js into the 3D page

How the 3D page (game3d.js, or proto3d.js until then) uses the menus module. The API and screens are documented at the top of `js/3d/ui3d.js`.

1. **Create it once** after the page's root exists:
   `createUi3d({ doc, root: <#proto3d>, settings, persistence: new PersistenceManager(), version: <build version>, inputKind, isTouch, onPlay, onResume, onRestart, onQuit, onSwitch2d, onSettingChange, onScreen })`, then `ui.show('menu')`.
2. **Remove the prototype menu:** the `#p3-menu` markup, its CSS, its buttons' handlers and the window `keydown` handler that clicks `#p3-start` on Enter. Hide the game buttons with `#proto3d.u3d-open .p3-game { display: none }` (the root gets `u3d-open` while the overlay shows), replacing `p3-menu-open`.
3. **Progress comes from the UI:** use `ui.progress`, read when a game starts, or keep the one passed to `onProfileChange(user, progress)`. Don't hold on to a progress object you created: a name or guest choice replaces it.
4. **onPlay({ tutorial, again, user, progress })**: the overlay has already been hidden. Call `progress.startGame()`, build a new sim, start the 3D tutorial when `tutorial` is true, and keep the iOS rule: call `ensureMotion(...)` synchronously inside this callback, since it runs inside the click or key event.
5. **Pause:** wherever the game pauses (Pause button, Esc or P, controller Start, page hidden), call `ui.show('pause')`. The callbacks:
   - `onResume`: continue the game.
   - `onRestart`: start a new sim of the same kind.
   - `onQuit`: stop the game and save credits with `progress.save()`. The UI then shows the menu.
6. **Game over:** call `ui.show('gameOver', { score: sim.score, level: sim.level })` once, and nothing else: the UI calls `progress.finishGame(score)` and `progress.takeUnlocked()` itself, so the page must not call them. During play the page still calls `progress.awardPoints`, `setLevel` and the `track*` methods.
7. **onSwitch2d:** call `writeLastMode(localStorage, null)` if wanted, then `location.replace(URL_2D)` (js/mode3d.js).
8. **onSettingChange(key, value):** apply changes live. The values are already saved.
   - `control3d`: `chooseMode`
   - `levelHorizon3d`: `setLevelHorizon`
   - `sensitivity3d`: `look.sensitivity`
   - `invert3d`: flip the stick, mouse and controller Y
   - `fov3d`: set the renderer camera's field of view
   - `vignette3d`: turn the fast-turn vignette on or off
   - `leftHanded3d`: mirror the Thrust/Fire (and stick) layout and run `relayoutRadar`
   - `viewDistance3d`: rebuild the sim for the next game
   - `difficulty`: takes effect on the next game
   - `palette`, `haptics`, `musicTune`, `musicVolume`, `sfxVolume`, `rumble`: pass them to the audio, music, haptics and palette code
9. **onScreen(screen):** on `'menu'` and `'gameOver'`, apply a waiting service-worker update (plan §4). On `null`, the overlay has closed.
10. **Controller in menus:** while `ui.visible`, poll the pad and on each new press call:
    - `ui.navigate('up' | 'down' | 'left' | 'right')` for the D-pad or left stick (with a repeat delay)
    - `ui.select()` for Ⓐ
    - `ui.back()` for Ⓑ or Start

    Skip the game's own pad handling while the overlay is visible.
11. **Keyboard:** the UI listens to `keydown` on `document` (arrows, Enter, Space, Esc) only while it is visible. The game's own key handler should ignore keys while `ui.visible`. To route keys yourself, pass `keys: false` and call `ui.handleKey(e)`.
12. **Prompts:** use `await ui.prompt({ title, text, buttons: [{ id, label }], cancel })` for these:
    - the slow-device offer ("Switch to 2D?": `yes` calls `onSwitch2d`)
    - WebGL context loss (Reload)
    - iPhone motion permission (the Allow button must call `requestMotionPermission` in its own click, so ask first, then call it in the button's handler path)

    It resolves with the button id. `hide()` resolves any open prompts with their cancel id.
13. **Help tab:** pass `inputKind: () => detectInputKind3d({ lastInputSource, isTouchDevice })` (js/3d/tutorial3d.js) so the Help screen opens on the right controls. Open Help with `ui.show('help', { input: inputKind() })` if you open it from outside the menu.
14. **Test hook:** add `ui: ui.snapshot()` to `window.__spaceAdventure.game3d`, and make `screen` read `ui.current` (or `'playing'`). Browser tests can click the `#u3d-<id>` or `[data-u3d="<id>"]` buttons: `#u3d-play`, `#u3d-name`, `#u3d-name-ok`, `#u3d-guest`, `#u3d-tutorial-yes`, `#u3d-resume`, `#u3d-again`, `#u3d-switch2d`, and so on.
15. **Teardown:** `ui.destroy()` removes the overlay and the key listener.
