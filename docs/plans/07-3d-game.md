# 3D game: full implementation plan (October 2026)

This plan turns the Phase 0 prototype (`?3d=1`, [06-3d-mode.md](06-3d-mode.md) §10) into the complete 3D game. It builds on the investigation in plan 06 and on everything the owner decided and tested since. Where this plan differs from plan 06 §6 (roadmap), this plan wins.

Status: **built and live (8 October 2026)**, main `c4d88ed`. All six phases are implemented; 1069 unit tests, 707 browser tests on GitHub Actions and 19 acceptance tests against the live GitHub Pages site pass. Owner test on the Pixel 7 Pro passed (8 October 2026). Open: a real iPhone check of motion permission in the installed app. Requirement-by-requirement status: [07-compliance.md](07-compliance.md); review findings: [07-review.md](07-review.md).

## Summary

| Topic | Plan |
|---|---|
| Biggest gameplay gap | Random collisions are more than 10 times rarer in 3D than in 2D (§2.1). Danger now comes from **incoming rocks** and **asteroid clusters**, plus **UFOs that behave as in 2D** (owner decisions, 8 October 2026). |
| Level structure | **As in 2D:** a level ends when no red and no green rocks are left (and the boss is destroyed on boss levels). Each level has a fixed set of rocks, partly in clusters and partly arriving as incoming waves. Boss every 2 levels. |
| Content | Hits, UFOs, boss, the 7 power-ups, hyperspace, lives, combos, scoring, Easy/Medium/Hard and adaptive difficulty, all following the 2D rules. |
| Assistance | No separate settings: aim assist and the other aids switch on automatically from the adaptive difficulty level (Assisting, Balanced, Challenging), §2.9. |
| Progression | **Separate 3D high-score board**; **credits, upgrades and achievements shared** with 2D. |
| Controls | Direct, Rate and Joystick (all kept), Level horizon toggle (default off), desktop mouse and keys, game controller. |
| HUD | No cockpit frame. Two-circle radar stacked on the right edge (live since 8 October 2026). Crosshair, edge arrows, threat and damage-direction warnings. |
| View distance | Normal, Far (default, above 70 fps on the Pixel 7 Pro), Very far. |
| Menu | Phases 1 to 5: the 3D game stays behind `?3d=1`. From Phase 4 the 2D and 3D menus switch to each other. Phase 6: **"Start 3D" becomes the first main-menu entry and the default**, 2D stays one tap away. |
| Hosting | Unchanged: static files on free GitHub Pages, everything precached for offline play, installable app. |
| Testing | Unit tests and a headless **balance harness** locally (Node only). Every browser test runs on GitHub Actions, never on the Mac. |
| Size | About **5 to 7 weeks of agent time** in 6 phases, with a phone test by the owner after phases 1, 2, 3 and 5. |

## 1. Decisions so far

From plan 06 §8, the prototype feedback (§10.1) and this conversation:

1. Three control types, all kept: **Direct** (phone pose = ship pose, all axes), **Rate** (tilt sets the turn rate), **Joystick** (on-screen stick, two roll buttons). **Level horizon** is a toggle for all three, default **off** ("doesn't really help").
2. The ship's nose points where you look. No cockpit frame.
3. Wrap-around cube world, every object drawn at its nearest copy, fog hides the seam.
4. **Far** view distance is the default (owner: "far is fine, still >70fps").
5. **Two-circle radar** (front and rear), stacked on the right edge (owner, 8 October 2026: "too close to the center of the screen").
6. Danger fixes: incoming rocks, clusters and UFOs (owner, 8 October 2026). UFOs follow the 2D rules (item 13).
7. Separate 3D high-score board; credits, upgrades and achievements shared.
8. 3D precached for everyone, offline.
9. No multiplayer in 3D for now.
10. "Start 3D" becomes the default and first menu entry once the 3D game is complete.

Owner answers, 8 October 2026:

11. **Finishing a level works exactly as in 2D:** no red and no green rocks left. Green crystals can be shot as in 2D (destroyed, no points, "wasted"); the prototype only lets you collect them, which Phase 1 fixes.
12. **Hits as in 2D.**
13. **UFOs as in 2D.**
14. **Aim assist and other assistance switch on automatically** with the adaptive difficulty level; no separate settings.
15. **Switching between 2D and 3D is in the menu.**

## 2. Gameplay design

### 2.1 Why nothing hits you today

The chance of hitting a rock depends on how many rocks are in the volume you fly through. In 2D a rock only has to cross your path; in 3D it must also be at your height.

With Far's numbers (144 red rocks in a 3200 cube, rock radius 24 to 42, ship radius 9), the average flight between two collisions is about 39,000 units. At top speed (260 per second) that's about 2.5 minutes of flying straight without dodging. A rough 2D estimate (4 large rocks of radius 40 in a 1200 × 1200 world, ship radius 15) gives about 3,300 units, so 3D is more than 10 times calmer, and the 2D screen also wraps you back into the rocks within seconds. Adding rocks doesn't fix this: matching 2D would need about 1,700 red rocks, almost 3 times the 600 object cap.

3D space games solve this by aiming danger at the player rather than relying on chance. The three sources below do that, and they keep the number of rocks (and so the frame rate) about where it is today.

**Tuning targets** (Medium, level 1, measured by the balance harness in §6.2):
- A rock or UFO on a collision course (a radar threat) about **every 6 to 10 seconds**.
- A pilot who flies straight at crystals and never dodges loses a life about **every 30 to 60 seconds**.
- A pilot who dodges loses a life about **every 2 to 3 minutes**.
- Easy halves the threat rate; Hard is about 1.5 times Medium. Each level raises it about 8 %.
- Since the homing re-tune (below): the careless pilot (always moving toward crystals) loses a life every **30 to 40 s at level 1, 22 to 30 s at level 3 and 15 to 22 s at level 5**; the dodging pilot every **75 to 120 s at level 1** and clearly more often later. Lost lives come about 15 to 25 % more often per level.

**Phase 1 result (rocks only, 8 October 2026).** `scripts/balance3d.mjs`, 16 seeds × 4 minutes, Far, level 1. The careless pilot flies at the nearest crystal and never reacts; the dodging pilot also shoots rocks in its way and reacts to threats after 0.6 s:

| Difficulty | Threat every | Careless pilot loses a life every | Dodging pilot loses a life every | Level 1 cleared in |
|---|---|---|---|---|
| Easy | 15 s | 160 s | 770 s | about 200 s |
| Medium | 12 s | 120 s | 295 s | about 205 s |
| Hard | 10 s | 87 s | 240 s | about 220 s |

**With UFOs (Phases 2 and 3, 8 October 2026).** Same harness, 16 seeds × 3 minutes, Far, level 1. Threats now also count UFOs on a collision course and UFO shots heading for the ship. The dodging pilot also shoots UFOs in its way and watches UFO shots from the view distance (they glow), since a shot can only be dodged:

| Difficulty | Threat every | Careless pilot loses a life every | Dodging pilot loses a life every |
|---|---|---|---|
| Easy | 9 s | 85 s | 360 s |
| Medium | 7 s | 56 s | 120 s |
| Hard | 6 s | 38 s | 90 s |

Medium meets the §2.1 targets (the dodging pilot at the low end of 2 to 3 minutes). About a third of the careless pilot's lost lives are UFO shots (2.8 % of the shots aimed at the ship hit, the 2D hit chance); the dodging pilot loses most of its lives to UFO shots. Two numbers changed to get there (deviations from §2.2): incoming rocks come every **4.5 s** on Medium (was 5.5; Easy 7, was 8.5; Hard 3.5, was 4) and aim a little closer (miss disc **1.5** × the radii, was 1.75). `tests/unit/balance3d.test.mjs` now checks the full targets with a tolerance (threat every 6 to 10 s, careless 30 to 60 s ± 10 %, dodging 2 to 3 minutes ± 20 %) and Easy < Medium < Hard.

**Easy and Hard re-tune (8 October 2026).** With the table above, Easy had 0.78 times the Medium threat rate (target 0.5) and Hard 1.17 times (target 1.5). Only 3D numbers changed; the shared 2D Difficulty table (UFO timing and accuracy, rock speed, lives, scores) did not (`rules3d.js` `TUNING_3D`):

| Difficulty | Incoming rocks (level 1) | Every | Miss disc | Small rocks per cluster |
|---|---|---|---|---|
| Easy | 6 (0.25 × Medium) | 10 s | 2.2 × the radii | 2 |
| Medium | 22 | 4.5 s | 1.35 × (was 1.5, see below) | 3 |
| Hard | 33 (1.5 ×) | 3 s | 1.9 × (2.2 before the reach rule, below) | 3 |

More incoming rocks with a wider miss give Hard more threats without making every one a hit. Easy's remaining threats are mostly the 2D-rule UFOs and their shots. Same harness, 16 seeds × 3 minutes, Far, level 1:

| Difficulty | Threat every | Threat rate × Medium | Careless pilot loses a life every | Dodging pilot loses a life every |
|---|---|---|---|---|
| Easy | 12.0 s | 0.60 | 120 s | 480 s |
| Medium | 7.1 s | 1 | 51 s | 131 s |
| Hard | 4.8 s | 1.49 | 37 s | 111 s |

At levels 3 and 5 the ratios hold (Easy 0.49 to 0.55, Hard 1.43 to 1.58). The Medium threat rate grows about 9 % a level (one every 7.1 s at level 1, 5.8 s at level 3, 5.1 s at level 5), a little above the plan's 8 %.

**UFO hit chance against 2D (§2.4, §6.2).** `ufoHitCheck` in the harness: an empty field, a ship that sits still (as the 2D rule assumes) with a shield that never runs out, UFOs on their 2D timer. Every shot aimed at the ship is compared with the 2D chance at the same distance (`hitChance2d`, distance in 2D px). The aim cone first used the ship's radius alone, but a shot hits within ship + bullet radius (9 + 3 in 3D, 15 + 2 in 2D), so 3D hit 1.2 to 1.3 times as often as 2D; `ufo3d.js` now uses those radii and 3D matches 2D: × 1.00 (Easy, 6.1 % of shots), 1.00 (Medium, 11.7 %), 1.01 (Hard, 42 %). Fewer UFO hits made Medium a little easier, so its incoming rocks aim a little closer (miss disc 1.35, was 1.5).

**UFO shots within reach.** A third of the UFO shots at Far were fired from beyond their reach (350 × 3 s = 1050 units, less than the 1440 view distance): they could never hit, but some still flashed as radar threats. A UFO now skips its turn when the target is beyond reach (plus the target's radius) and its timer runs again as after a shot, so the 2D rhythm (a shot every 2 s ± 20 %) stays; a 2D UFO is always within reach of its screen. The threat rates dropped a little (those were never real threats) and Hard's lives lost with them, so Hard's miss disc went from 2.2 to 1.9. Over 40 seeds the hit chance against 2D is × 1.08 (Easy), 1.04 (Medium), 1.01 (Hard). Level 1, 16 seeds × 3 minutes:

| Difficulty | Threat every | Threat rate × Medium | Careless pilot loses a life every | Dodging pilot loses a life every |
|---|---|---|---|---|
| Easy | 12.9 s | 0.59 | 131 s | 411 s |
| Medium | 7.7 s | 1 | 52 s | 144 s |
| Hard | 4.7 s | 1.63 | 38 s | 87 s |

Levels 3 and 5: Easy × 0.52 to 0.53, Hard × 1.45 to 1.57. Boss level 2 for the dodging pilot: Easy 87 to 203 s, Medium 120 to 267 s, Hard 210 to 424 s (one Hard run of 16 took longer than 10 minutes).

**Boss levels (§2.6).** As 2D `createLevelAsteroids`: the red rocks are floor(40 %) of a normal level's (fewer clusters and scattered rocks; the incoming rocks fill up to exactly that number), and half the crystals. The dodging pilot, which holds about 420 units from the boss and fires as the weak points turn past, clears level 2 in 107 to 253 s on Easy, 163 to 265 s on Medium and 172 to 500 s on Hard (16 seeds).

`tests/unit/balance3d.test.mjs` checks the ratios at levels 1, 3 and 5 (Easy 0.4 to 0.68, Hard 1.25 to 1.8), the growth (4 to 15 % a level), the boss level (cleared within 6 minutes, Hard 9), the boss-level counts and the UFO hit chance (× 0.8 to 1.2 of 2D).

**Homing incoming rocks (owner feedback, 8 October 2026).** On the Pixel 7 Pro collisions in the first two levels were still rare. The cause: an incoming rock re-aimed only while in the fog and then flew straight, so a player who keeps moving (toward the next crystal) was rarely hit, and danger grew only about 10 % a level. The harness pilot also slowed down near each crystal, which players don't. Changes (`rules3d.js`, `spawn3d.js` `steerIncoming`, §2.2):

- Once visible, an incoming rock keeps turning toward the ship's predicted position (plus its miss offset) at a limited rate: 12°/s at level 1, +2°/s per level, at most 30°/s, × 0.6 on Easy and × 1.3 on Hard. Its speed doesn't change. In the last 150 units, or the last 0.8 s before its closest approach, it flies straight, so a late dodge still works; once past the ship it is an ordinary rock.
- The miss disc shrinks 3 % per level (at least half the level 1 disc). Medium's disc is 1.2 × the radii (was 1.35), Easy 1.5 (was 2.2), Hard 1.5 (was 1.9).
- Incoming rocks get 6 % faster per level (was 4 %). Interval and count growth are unchanged.
- The careless harness pilot never drops below 180 units per second toward a crystal.

The first draft (6°/s + 3°/s per level, miss 8 % smaller per level) barely changed level 1 and made level 3 too hard: below about 1 × the radii almost every aimed rock hits, so the miss disc is the steep lever and the turn rate the gentle one. Hence the higher start and slower growth of both.

Lives lost, a life every N seconds, `node scripts/balance3d.mjs --levels 1-6`, 32 seeds × 3 minutes from each starting level, Far (before: old rules and the old pilots; after: both changes). Levels 2, 4 and 6 are boss levels, where the boss and its shots dominate:

| Difficulty | Pilot | L1 | L2 | L3 | L4 | L5 | L6 |
|---|---|---|---|---|---|---|---|
| Easy | careless | 115 → 101 | 20 → 22 | 105 → 63 | 22 → 20 | 65 → 47 | 29 → 32 |
| Easy | dodging | 443 → 524 | 98 → 89 | 339 → 303 | 111 → 111 | 360 → 250 | 120 → 160 |
| Medium | careless | 53 → 40 | 24 → 21 | 42 → 24 | 36 → 31 | 30 → 18 | 30 → 25 |
| Medium | dodging | 160 → 101 | 80 → 68 | 125 → 66 | 109 → 72 | 87 → 37 | 96 → 59 |
| Hard | careless | 39 → 28 | 28 → 23 | 33 → 20 | 30 → 26 | 26 → 15 | 25 → 19 |
| Hard | dodging | 83 → 56 | 77 → 45 | 73 → 38 | 79 → 51 | 55 → 27 | 55 → 36 |

On the normal levels Medium now meets the targets (careless 40, 24, 18 s; growth about 22 % a level), and lost lives grow level over level on every difficulty for the careless pilot. Easy's dodging pilot is too rarely hit to measure well (a handful of hits per run). Boss levels don't follow the curve: level 4 is calmer than level 3 on Medium, since a boss level has 40 % of the rocks (open point). Threats: one every 6.4 s on Medium level 1 (was 7.8), Easy × 0.54 and Hard × 1.52 of Medium. Levels stay clearable: the dodging pilot clears level 1 in 212 to 274 s on Medium (was 181 to 294), 124 to 189 s on Easy, and 11 of 16 Hard runs within 330 s (was 10); boss level 2 in 103 to 338 s (Easy), 140 to 312 s (Medium) and 211 to 533 s (Hard), all 16 seeds. `tests/unit/balance3d.test.mjs` checks the new bands (8 seeds, 16 for the dodging pilot's level 3 and 5) and Easy < Medium < Hard at levels 1, 3 and 5; `tests/unit/spawn3d.test.mjs` checks the homing (turn-rate limit, speed kept, straight in the final approach, never after passing, the same seed gives the same rocks).

Rocks alone deliver about half of the targets above. A fixed set of rocks per level (the 2D rule) caps how much rock danger a level can hold without making it very long to clear, so the rest comes from the UFOs (§2.4, Phase 2), which in 2D shoot every 2 s. `tests/unit/balance3d.test.mjs` checks the rocks' share now (Medium: a threat every 7.5 to 17 s, the careless pilot losing a life every 50 to 240 s, dodging helps, Easy < Hard, level 1 clearable in 2 to 5 minutes); Phase 2 tightens it to the full targets.

### 2.2 Incoming rocks (fix 1)

- Each level's red rocks are a **fixed set** (§2.5). About half of them don't start in the field: they arrive during the level as **incoming rocks** (level 1 on Medium: 22, +2 per level; Easy 0.25 × and Hard 1.5 × as many, §2.1; `js/3d/rules3d.js`). This keeps the 2D rule that a level ends once every rock is gone.
- An incoming rock appears just beyond the fog (cull distance), inside a 70° cone around the direction the ship is moving (random direction while the ship is nearly still). It's aimed at the point where the ship will be when it arrives (exact intercept), plus a random miss offset in a disc of 1.2 × (rock radius + ship radius) on Medium at level 1 (1.75 in the first draft, then 1.5, then 1.35; Easy and Hard 1.5, §2.1), 3 % smaller per level down to half. While it's still in the fog it keeps re-aiming exactly. From the fog start (fully visible) it homes in: it turns toward the predicted position at 12°/s at level 1, +2°/s per level, at most 30°/s (Easy × 0.6, Hard × 1.3), at constant speed. In the last 150 units or 0.8 s before its closest approach it flies straight, so it can still be dodged (`js/3d/spawn3d.js` `steerIncoming`).
- Speed 130 to 190 units per second at level 1, times the difficulty's `asteroidSpeedMultiplier` and the adaptive `asteroidSpeedMod`, plus 6 % per level (4 % before the homing re-tune). Mostly small (65 %) and medium (30 %), a few large (5 %): danger comes from the aim, and small ones are quick to clear. Shooting a larger one splits it into pieces that keep flying toward you.
- Timing: Medium level 1 one every 4.5 s, Easy 10 s, Hard 3 s (5.5 / 8.5 / 4 in the first draft, 4.5 / 7 / 3.5 after the UFO re-tune, §2.1); 0.4 s less per level, at least 3 s. At most 4 on their way at once. None in the 3 s after a respawn. When everything else in the level is cleared, the remaining incoming rocks are released straight away, so a level never waits on a timer.
- An incoming rock that has passed its closest approach is an ordinary rock of the field.
- They fade in through the fog like every other object. The radar threat flash (already built) marks them once they're within 25 % of the view distance on a closing course.

### 2.3 Asteroid clusters (fix 2)

- The field's red rocks are mostly in **clusters**: tight spheres (radius 70 + 35 × ∛members, about 140 to 160) holding 2 medium and 3 small rocks at level 1 (+1 medium every 2 levels, +1 large every 3), that drift slowly together (3 to 8 units per second) and tumble.
- **Most of the level's crystals sit inside clusters**, so collecting means flying through danger. The space between clusters is calm and has a few scattered rocks and crystals. Crystals come in the three 2D sizes with the 2D scores (`greenScore`) and don't split.
- Level 1 on Medium (every view distance): 3 clusters of 5 rocks with 70 % of the 14 crystals inside them, 3 scattered rocks (medium, every fourth large) and 22 incoming, 54 rocks and crystals over the level (Easy: clusters of 4 and 6 incoming; Hard: 33 incoming, §2.1). Inside a cluster the average flight between collisions is a few hundred units, so crossing one without care is a real risk. The first draft's 150-plus rocks would have taken far too long to clear under the 2D rule (about 9 minutes for the harness pilot), so the field is smaller and the danger comes from the aim instead.
- Levels grow: +1 cluster every 2 levels, +1 scattered rock every 2 levels, +2 crystals and +2 incoming rocks per level; the adaptive `greenRatioMod` changes the crystal count. A bigger view distance spreads the same set over a bigger cube.
- The radar shows each cluster's rocks as usual. Clusters beyond the view distance appear as a faint ring on the radar rim, so you can find the next one.

### 2.4 UFOs (as in 2D)

The 2D rules (`js/ufo.js`, `js/main.js` `updateUfoSpawning`, `js/modes.js` `SOLO_BASE`), carried over one to one:

- **Appearance:** one at a time (`ufoMaxActive` 1), a new one about every 15 s (`ufoBaseInterval`, times the difficulty's `ufoSpawnMultiplier` and the adaptive `ufoSpawnMod`). Purple saucer, radius 15, score 200, one hit to destroy.
- **Movement:** appears at the edge of the visible area and flies in a straight line at speed 100, wrapping around the world.
- **Shooting:** every 2 s (±20 %). 30 % of the shots go at a green crystal near the UFO, the rest at the player. Accuracy per difficulty (`ufoAccuracy`: 0.6 Easy, 0.8 Medium, Hard's value) times the adaptive `ufoAccuracyMod`. UFO bullets destroy greens they hit and split reds.
- **Collisions:** ramming a UFO costs a life and destroys it; a shield absorbs it (§2.5).

Two things need a 3D translation so the behaviour *feels* the same, not just has the same numbers:
- **Staying in play:** a 2D UFO crosses a small screen and stays near you; in a 3D cube a random straight line would carry it into the fog within seconds. In 3D its straight line is chosen to pass within half the view distance of the ship, which is what a 2D UFO does on its screen.
- **Aim spread:** 2D spreads shots up to ±(1 − accuracy) × 180° in a plane. The same angle as a 3D cone would almost never hit (the same geometry problem as §2.1), so the 3D cone is set to give **the same hit chance as 2D at the same distance**. The balance harness checks this.

The radar shows UFOs as a purple saucer glyph. An edge arrow points to a UFO within the view distance that's off screen, and a red **damage-direction arc** at the screen edge shows where a hit came from.

### 2.5 Levels and hits (as in 2D)

- **Each level has a fixed set of rocks** (2D: 10 plus 3 per level, scaled to the world). In 3D it's split into clusters, scattered rocks and incoming rocks (§2.2, §2.3), the same for every view distance. Rocks don't refill. Boss levels (every 2nd) have 40 % of the rocks, as in 2D.
- **Level complete:** no red and no green rocks left, no hostile UFO, and the boss destroyed on boss levels, exactly the 2D condition.
- **Shooting a green** destroys it with no points ("wasted", a small green burst), as in 2D. It still counts as gone.
- **Finding the last rocks:** a cube is much bigger than a screen, so once 5 or fewer rocks are left, every one of them shows on the radar at any distance and gets an edge arrow with its distance.
- Between levels: a short "LEVEL N" banner, 3 s of invulnerability, and a new field around the ship (nothing within 320). The HUD shows the level and the rocks left (field plus incoming still to come).
- **Hits, as in 2D:** touching a red rock, being rammed by a UFO or hit by a UFO bullet costs a life. The rock splits (or the UFO is destroyed). A **shield** power-up absorbs one hit, breaks, and gives 1 s of protection so the fragments don't hit straight away. After losing a life the ship is gone for 2 s (2D `RESPAWN_DELAY`), then respawns where it was with 3 s of invulnerability and rocks within 150 pushed out. A red arc at the screen edge shows where the hit came from. Lives, the extra-life score (10000, with the adaptive `extraLifeThresholdMod`), combos (the 2D `Combo` class: ×2 from 5, ×3 from 10, ×4 from 20, streak bonuses, 3 s window) and score values match 2D. As in 2D, red rocks give no points (only crystals, UFOs and the boss do), and while the ship is protected it neither collects nor collides.

### 2.6 Boss (every 2 levels)

- A mothership with a slowly rotating core (radius about 150) and **4 glowing weak points** spread around it, so you have to fly around it to reach them. Weak-point health comes from the 2D boss (`js/boss.js`).
- It fires bursts from its turrets and releases one escort UFO each time a weak point is destroyed.
- It's drawn with a glow that stays visible through the fog up to 1.5 times the view distance, and the radar shows it as a ring glyph with a permanent edge arrow, so it's always findable.
- Boss levels have half the crystals and fewer clusters; their red rocks are floor(40 %) of a normal level's, as 2D (§2.1).

### 2.7 Power-ups

- As in 2D: the same 7 types, type chances (`js/powerup.js`) and durations; a 30 % chance of a drop when a red rock or UFO is destroyed, plus one at a random place every 20 s (times the adaptive `powerUpSpawnMod`). In 3D the timed one appears within the view distance so it can be found. They float as spinning glyph billboards and show as squares on the radar.
- In 3D: **Shield** is a bubble around the ship; **Magnet** pulls crystals within a sphere; **Triple shot** fires 3 bullets 3° apart; **Rapid fire**, **Speed boost**, **Score multiplier** and **Extra life** work as in 2D.
- Active power-ups show as chips with a timer bar on the HUD, top left under the score.

### 2.8 Hyperspace

Kept, as plan 06 recommended. A button next to Fire (H on desktop, B on a controller) jumps to a random point clear of rocks, with the same risk rules and cooldown as 2D.

### 2.9 Assistance follows the adaptive difficulty

There are no assistance settings. The 2D adaptive difficulty (`DynamicDifficulty`, extracted from `main.js` in Phase 1) runs in 3D unchanged: it watches accuracy, crystal collection, deaths per minute and score rate, and its level shows on the HUD as in 2D (**Assisting**, **Balanced** or **Challenging**). Its existing effects apply in 3D the same way: rock speed, UFO timing and accuracy, power-up timing, green share and the extra-life score. On top of that it now switches the 3D aids:

| Aid | Assisting | Balanced | Challenging |
|---|---|---|---|
| Aim assist (bullets bend toward a target near the crosshair) | within 4° | within 2° | off |
| Lead marker in front of moving targets | on | on | off |
| Edge arrow to the nearest crystal | always | when no crystal is on screen (as the prototype) | only for the last 5 rocks |
| Threat warning (radar flash, tone, vibration) | flash, tone and vibration | flash, tone and vibration | radar flash only |
| Collection radius bonus | +50 % | as now | as now |

Easy, Medium and Hard set the starting point, as in 2D. The 2D game gets no new aids from this. Target brackets around the current target and the hit flash are always on.

## 3. HUD and controls

- **Radar:** the two circles stacked on the right edge (built 8 October 2026, deployed with this plan). New glyphs: UFO (saucer), boss (ring), power-up (square), cluster beyond range (faint rim ring).
- **Top left:** score, lives, crystals left, speed, active power-ups. **Top right:** Pause (and Recentre for Direct and Rate). **Bottom:** Thrust left, Fire right (Joystick mode: Thrust next to Fire, stick on the left), Hyperspace small next to Fire, roll buttons in Joystick mode with Level horizon off. The footer line (frame rate, view distance) moves into a debug setting.
- **Warnings:** radar flash, edge arrow, short tone and light vibration for a threat; red edge arc for a hit, showing its direction.
- **Desktop:** pointer-lock mouse, W/↑ thrust, Space/F/click fire, A/D or Q/E roll, H hyperspace, Esc pause.
- **Controller:** the existing `js/gamepad.js`: left stick turn, triggers thrust and fire, bumpers roll, B hyperspace, Start pause.
- Upgrades map to 3D: Collection Radius → pickup radius; Thrust Power → acceleration; Starting Lives → lives; Turn Speed → maximum turn rate in Rate and Joystick (Direct follows the phone 1:1 and is unaffected); Power-Up Duration → durations.

## 4. Menus, settings and progression

- **3D screens** (DOM overlay in the 3D page, built like the prototype's start screen): Play, Settings, High Scores, Help, **Switch to 2D**. Pause menu: Resume, Restart, Settings, Quit to 3D menu.
- **3D settings:** control type, Level horizon, sensitivity, invert up/down, view distance, field of view (60 to 95°, default 70°), vignette during fast turns, left-handed layout. No assistance settings (§2.9). Shared with 2D (same keys): colours (Colour-safe), vibration, music tune and volume, sound effects volume, controller rumble.
- **High scores:** separate 3D board, top 10 per profile (key `asteroids_highScores3d`, same format as 2D), name entry with the existing name rules. The 2D High Scores screen gets a 2D / 3D switch.
- **Credits, upgrades, achievements:** shared, through the existing `js/persistence.js`, `js/upgrades.js` and `js/achievementManager.js`. 3D events count toward the existing achievements (score, level, rocks destroyed, UFOs destroyed). New 3D achievements are optional and not planned.
- **Switching between 2D and 3D in the menu** (owner, 8 October 2026): the 2D main menu gets a **Start 3D** row (from Phase 4; first and default from Phase 6), and the 3D menu a **Switch to 2D** row. The choice is remembered, so the installed app opens where you left it. Under the hood it's a page change (`./` and `./?3d=1`) served from the offline cache in about a second, so the two games never share live state.
- **Updates:** the 3D page applies a waiting update on its menu and game-over screens (fixed 8 October 2026) and shows the build version in its menu.

## 5. Architecture

- **Entry:** `js/3d/game3d.js` replaces `proto3d.js` as the entry `js/main.js` imports for `?3d=1`. Split the prototype's DOM and input code into `ui3d.js` (menus, settings, buttons) and `input3d.js` (touch, mouse, keys, controller, sensors).
- **Pure, DOM-free modules** (unit-tested without a browser):
  - `rules3d.js`: levels, difficulty, crystal counts, threat rates, scoring tables.
  - `spawn3d.js`: sectors, clusters, incoming rocks, field trimming.
  - `ufo3d.js`: 2D-rule UFO movement, aiming with the 3D spread, firing.
  - `boss3d.js`: core, weak points, turrets, escorts.
  - `powerup3d.js`: drops and effects.
  - `sim3d.js` (grows): the fixed-step game simulation calling the modules above.
  - `progress3d.js`: high scores, credits, achievements and upgrades through the shared 2D modules.
- **Shared from 2D:** `persistence.js`, `upgrades.js`, `achievementManager.js`, `settings.js`, `audio.js`, `music.js`, `tunes.js`, `haptics.js`, `gamepad.js`, `palette.js`, `names.js`, `rng.js`, `wakeLock.js`, `pwa.js`. Two extractions from `main.js` come first, each checked against the full 2D test suite: `DynamicDifficulty` into `js/difficulty.js`, and the `Difficulty` table plus level constants into the rules module.
- **Renderer:** `render3d.js` stays the only three.js importer. It gets meshes for UFOs, boss, power-ups, the shield bubble and explosions, all instanced or pooled.
- **Performance budget** (Far, Pixel 7 Pro): at least 60 fps; at most 600 field objects, 6 UFOs including escorts, 200 bullets and 400 particles; under 25 draw calls. The adaptive render scale stays.
- **Test hook:** `window.__spaceAdventure.game3d` grows with level, crystals left, UFOs, boss, power-ups and threats; `?seed3d=N` and `layout3d=` test layouts stay.

## 6. Testing

### 6.1 Rules for this work
- **No browsers, servers, Playwright or audio on the Mac.** Agents only run `nice -n 10 npm run test:unit` and `node --check` locally.
- Browser tests run on GitHub Actions: push to `release-candidate`, wait for green, then push `main`.

### 6.2 Balance harness (new)
- `scripts/balance3d.mjs` runs the pure simulation headless for seeded minutes with two scripted pilots: one flies straight at the nearest crystal and never dodges; the other also turns away from threats.
- It reports threats per minute, collisions per minute, crystals per minute, level time, and the UFO hit chance compared with 2D, per difficulty, level and adaptive level.
- A unit test checks the targets in §2.1 within a tolerance band, so later changes can't silently make the game trivial or unfair again. It runs in Node only and takes seconds.

### 6.3 Unit tests (Node)
Cluster and sector generation, incoming-rock aiming and rates, UFO movement and lead, boss weak points, power-up effects, level completion, scoring and combos, high scores and shared progression through the real persistence modules, menus and settings on the fake DOM.

### 6.4 Browser tests (GitHub Actions)
- `chromium-3d` and `chromium-3d-desktop` with SwiftShader: a full seeded level (collect, shoot, get hit, respawn, level up), a boss level, power-ups, pause and resume, settings persist, the high-score entry, switching to 2D and back, offline reload, screenshots in the `screenshots` artifact.
- `no3d.spec.js` keeps checking that 2D never loads a 3D file.
- WebKit: only that 3D is offered or hidden correctly and that the menus work (too slow for gameplay without a GPU).

### 6.5 Owner phone checks
After phases 1, 2, 3 and 5 on the Pixel 7 Pro (and an iPhone if available): feel, danger level, frame rate. Each check lists what to try.

## 7. Phases

| Phase | Content | Size | Done when | Status (8 October 2026) |
|---|---|---|---|---|
| 1 Danger and levels | `rules3d`, `spawn3d`: fixed rock set per level, clusters, incoming rocks, 2D level-complete rule, shootable greens, 2D hit and shield rules, last-5 radar and arrows, rocks-left counter, level banner, damage-direction marker, threat tone; balance harness; extract `DynamicDifficulty` and the difficulty table from `main.js` | L | Harness meets §2.1 targets; owner phone check: "I get hit when I'm careless" | Done; Pixel 7 Pro check passed (8 October 2026) |
| 2 UFOs and assistance | 2D-rule UFOs with the 3D translations (§2.4), UFO bullets, adaptive difficulty in 3D with its HUD label, the 3D aids table (§2.9: aim assist, lead marker, arrows, warnings), target brackets, explosions, sound effects in 3D (stereo pan by direction) | L | UFO hit chance matches 2D in the harness; aids change with the adaptive level; owner phone check | Done; Pixel 7 Pro check passed (8 October 2026) |
| 3 Boss, power-ups, hyperspace | Boss with weak points, turrets, escorts, boss glow and arrow; 7 power-ups; hyperspace | XL | Matches 2D single-player content; owner phone check | Done; Pixel 7 Pro check passed (8 October 2026) |
| 4 Menus and progression | `game3d` entry, `ui3d`, `input3d`; 3D menu, pause menu, settings, Help page; **Start 3D** row in the 2D menu and **Switch to 2D** in the 3D menu; 3D high scores and name entry; shared credits, upgrades and achievements; 2D High Scores 2D / 3D switch; version label | L | A full game from menu to high-score entry; 2D suite green and unchanged | Done (8 October 2026) |
| 5 Platform and comfort | 3D tutorial (asks first, like 2D), music, vibration and rumble, controller, desktop polish, field of view, vignette, invert, left-handed layout, capability check and slow-device offer to switch to 2D | L | Every input type tested; owner phone check | Done; Pixel 7 Pro check passed (8 October 2026) |
| 6 Launch | "Start 3D" first in the main menu and the default; remove the `?3d=1` gate (keep it as a direct link); context-loss handling; iPhone motion-permission check in the installed app; docs and README | M | Live on Pages, works offline and installed, 2D unchanged | Done (8 October 2026) |

S = under a day, M = 1 to 2 days, L = 2 to 3 days, XL = a week or more. Phases 1 and 2 can overlap (separate modules), and phases 4 and 5 can partly run in parallel with agent teams. Each phase ends with a CI run and a deploy behind `?3d=1`.

## 8. Risks

1. **Balance:** the right threat level is a feel question. The harness keeps numbers stable, but the phone checks decide.
2. **Frame rate with more content:** UFOs, boss and particles add draw calls. Instancing, pools and the adaptive render scale keep this in check; Very far may need fewer clusters.
3. **iPhone:** motion permission in the installed app may need a tap on every launch; not tested on a real iPhone yet.
4. **Two games to maintain:** shared modules keep progression consistent, but rules changes in 2D won't reach 3D automatically.
5. **Making 3D the default:** slower devices could land in 3D first. The capability check offers 2D in that case, and 2D stays one tap away.
6. **CI only:** SwiftShader in CI is slow, so browser tests use short seeded scenarios and the harness covers long play.

## 9. Open questions

None at the moment; the five from the first draft are answered in §1 (items 11 to 15).

One reading to confirm during the Phase 2 phone check: "assistive game support level" is taken to mean the adaptive difficulty level shown on the HUD (Assisting, Balanced, Challenging), with Easy, Medium and Hard as its starting point.
