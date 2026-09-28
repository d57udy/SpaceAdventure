# Multiplayer investigation

> **Decision (26 September 2026):** local multiplayer on one device only, no online play and no third-party services. Options E–J and Phase 3 below are out of scope and kept for reference. The detailed plan for the chosen scope is [05-local-multiplayer.md](05-local-multiplayer.md).

## Summary and recommendation

Start with **local 2-player on one device** (both ships on one shared screen), shipping **Co-op "Wingmen"** and **Versus "Harvest Race"** first. Then add an **asynchronous Ghost Race** that needs no network. Treat **online play** as an optional third phase, only if players really want to play from different places, because static GitHub Pages hosting makes it the least reliable option.

Why this order:
- **Shared screen fits this game unusually well.** The canvas is a square and the world is 1.5 x 1.5 canvases and wraps around. So the shortest distance between two ships is never more than 0.75 canvas per axis. If the camera centres on the midpoint between the two ships, each ship stays within 0.375 canvas of the centre, about 85 px of margin on a 690 px canvas. **Both ships always fit on screen without split screen or zooming out.** On a landscape tablet, the square canvas also leaves empty side bars that suit per-player touch controls.

> **Update (2026-09, adaptive screens):** the view is no longer square; the canvas fills the screen and multiplayer on a touch tablet reserves side bars (or top and bottom bars when facing) for the controls (`js/mpView.js` touchLayout). The per-axis argument still holds: the world is at least 1.5 views on each axis.
- **Local play costs nothing and needs no third party.** It runs on GitHub Pages exactly as today and matches the classic lineage: Spacewar! was 2-player on one screen, Space Duel had simultaneous and tethered co-op, and Asteroids: Recharged ships local co-op only.
- **Online play without our own server is possible but fragile:** browser-to-browser connections plus free public matchmaking and relay services, none of which guarantee availability. About 20% of connections need a relay server.
- **Most of the work is one refactor that every phase needs:** replacing the single global `ship` (and score, lives, combo and power-ups) with a list of players. Size L. Everything after it builds on it.

## What in today's code blocks multiplayer

| Area | Today | What multiplayer needs |
|---|---|---|
| Player | One global `ship`, about 100 references in `main.js` | `players[]` of `{ id, ship, score, lives, respawnTimer, combo, powerUps, input, color }` |
| Game state | Global score, lives, respawn timer, power-ups, combo, difficulty adjustment and upgrades (about 78 call sites) | Each becomes per-player or explicitly team-wide |
| Camera | Singleton always centred on the ship | Shared camera: small change (new target point). Split screen would need the camera passed everywhere |
| Input | One `InputHandler`; WASD and arrows both drive the same actions; one touch stick; fixed button ids | Per-player key bindings, two stick zones, `data-player` on touch buttons, controllers |
| Enemies | UFO and boss each target the one ship | Target the nearest living ship |
| Bullets | `isPlayerBullet` flag, no owner | `ownerId` for scoring and player-versus-player |
| Timing and randomness | Variable frame time; 31 `Math.random` calls | Fine for local and host-authoritative online play; blocks lockstep, rollback and exact replays |
| Saved data | Per-user scores, achievements, upgrades | Separate co-op/versus leaderboards; a rule for whose upgrades apply |

## How comparable games do it

| Game | Model | Lesson |
|---|---|---|
| Asteroids (1979), Asteroids Deluxe (1981) | 2 players alternating turns, separate scores | Taking turns is authentic and the cheapest option |
| Spacewar! (1962) | Two ships duelling on one screen, gravity star, hyperspace | A duel mode with hyperspace is historically on-theme |
| Space Duel (1982) | Simultaneous 2 players, competitive or co-op with **tethered ships** | A tethered co-op twist is cheap and distinctive |
| Asteroids: Recharged (2021) | Local co-op in every mode, no online | Modern arcade remakes still ship couch co-op only |
| Starblast.io and similar | Server-run online team and survival modes | Needs a real server; doesn't fit our constraints |
| Ghost racing games | Race a recorded run; share a link to challenge a friend | "Play against a friend" without a live connection |

## Technical options

| Option | Works on free GitHub Pages? | Experience | Complexity | Cost and risk |
|---|---|---|---|---|
| **A. Shared screen, one device** (split keyboard, controllers, two players on one tablet) | Yes | Very good: no lag, social | M (after the L refactor) | None; cheap keyboards may miss keys with 3+ held; cramped on small tablets |
| B. Split screen, one device | Yes | Worse: the square canvas is already small | L | Not needed thanks to the midpoint camera |
| C. Taking turns | Yes | OK, less social | S–M | None |
| D. Ghost race (asynchronous) | Yes (share via link, file or QR code) | Good for remote friends, no scheduling | M (position trace) to L (exact replay) | None; the ghost doesn't interact with the world |
| E. Online, browser-to-browser, manual code exchange (copy/paste or QR) | Yes, no third party | Clunky: two exchanges | L | Fails for the ~20% of connections that need a relay |
| F. Online, browser-to-browser via Trystero (public Nostr/MQTT/BitTorrent servers for matchmaking) | Yes | Good: share a room code | L–XL | Public servers have no availability guarantee; players see each other's IP address |
| G. Online via the PeerJS free cloud | Yes | Good: share an ID | L–XL | 50 concurrent connections, can drop or rate-limit, no guarantee |
| H. Firebase Realtime Database (free) | Yes | OK | L | Hard cap of 100 simultaneous connections; security rules needed; use for matchmaking only |
| I. Supabase Realtime (free) | Yes | OK | L | 200 connections, 2M messages/month; **free projects pause after a week without activity** |
| J. Cloudflare Workers + Durable Objects (free), or PartyKit on your own Cloudflare account | Page stays on Pages, but the Worker is code you deploy and run | Best online reliability of the free options | XL | 100k requests/day free; needs a Cloudflare account and deploy tooling |

**Relays:** Google's STUN servers are free and enough for most connections. About 20% of public connections need a TURN relay, more on corporate networks. Free TURN: Metered Open Relay (20 GB/month). Any relay credential in a static site is visible to anyone, so the quota could be used up by others; affected players then fail to connect. The relay can't read the traffic (it's end-to-end encrypted). Warning sign: the public y-webrtc matchmaking servers have already disappeared.

**Network models:**
| Model | Fit | Notes |
|---|---|---|
| **Host runs the game, sends snapshots; others send input and display smoothed snapshots** | **Recommended** | The existing simulation runs unchanged on the host. Predict the local player's own ship so steering doesn't feel sluggish |
| Lockstep (every device runs the same simulation) | Poor | Needs a fixed timestep, seeded randomness for all 31 calls and identical maths across browsers, which JavaScript doesn't guarantee |
| Rollback (fighting-game style) | Poor | All of the above plus saving and restoring full game state every frame |

**Bandwidth** (about 50 objects, 20 updates per second): compact binary ≈ 11 KB/s; plain JSON ≈ 40–60 KB/s. Both fine on home Wi-Fi. With a relay, binary means about 7 MB per direction for 10 minutes, so the free 20 GB covers about 1,500 relayed sessions a month (JSON about 6x fewer). Sending bullets as spawn events saves more.

## Mode designs

### 1. Co-op "Wingmen" (first to build)
- Both ships share one world and level progression. Each ship has its own score; together they make a **team score** that drives levels and the leaderboard.
- Each player has 3 lives. A player who is out becomes a drifting beacon; the teammate revives them by hovering nearby for 2 s, which costs the reviver a life. Game over when both are out.
- Shield, rapid fire and speed go to the collector; magnet and triple shot could be team-wide (open question).
- UFOs and the boss target the nearest living ship. Boss health about 1.5x; level thresholds scale with player count.
- Greens score for whoever touches them; reds, UFOs and the boss for the bullet's owner; combos per player.
- Optional twist "Tether" (a Space Duel homage): a spring links the ships, so thrust needs coordination.

```
Tablet, landscape, one shared camera (midpoint of both ships)
+--------+---------------------------+--------+
| P1 HUD |  [radar: both ships,      | P2 HUD |
| 1250   |   P1 cyan, P2 orange]     | 980    |
| ♥♥♥    |        ^ P1               | ♥♥     |
|        |    *        o green       |        |
| (stick)|              ^ P2         | (stick)|
|  [FIRE]|  TEAM 2230   LVL 3        |[FIRE]  |
+--------+---------------------------+--------+
```

### 2. Versus "Harvest Race"
- 3-minute rounds or first to N points. Greens score for the collector. **Shooting a green destroys it with no points**, so players can deny each other. Reds and UFOs threaten both. No friendly fire; ships bump off each other.
- Death: 3 s respawn and the combo is lost; unlimited lives, time is the limit.
- Fairness: upgrades and difficulty adjustment off (standard ships).
- HUD: large shared timer at the top centre, each score in its player's colour on their side.

### 3. Battle "Duel" (a Spacewar! homage)
- Player bullets hit the other ship; first to 5 kills wins. Greens give a shield charge; reds still split and block shots; hyperspace available with its 10% self-destruct.
- Respawn after 2 s with 2 s of invulnerability, at the spawn point furthest from the opponent.
- Optional: the boss core as a gravity well in the centre.

### 4. Asymmetric "Saucer"
- Player 1 flies the normal ship. Player 2 controls a UFO: slower, turret aimed independently of movement, fire cooldown. The UFO scores by shooting greens or hitting Player 1, who must reach a target score before time runs out.
- Good for a parent and child or players of different skill. Reuses the existing UFO and its green-targeting behaviour.

### 5. Taking turns and Ghost Race (no simultaneous input)
- **Take Turns:** as in the 1979 arcade game, players alternate each time a life is lost, with separate saved worlds and scores. Simplest variant: full runs one after another on the same level layout, then compare.
- **Ghost Race:** record the ship's position, rotation and thrust 10 times a second (about 11 KB for 3 minutes, about 14 KB as a share link). Replay it as a translucent ship with a live pace indicator ("Ghost: +140"). Levels start from the same seeded layout, but diverge after the first collisions, so the ghost is a pace reference, not an interactive opponent. Share by link, file download or locally ("beat your best run"). Exact replays would need a fixed timestep and full seeded randomness (size L).

## Controls per setup

| Setup | Player 1 | Player 2 | Notes |
|---|---|---|---|
| Split keyboard | W thrust, A/D rotate, S hyperspace, Space or F fire | Arrows, Down hyperspace, Enter or Right Shift fire | Today WASD and arrows drive the same actions, so this needs separate bindings. Menus stay shared |
| Controllers | Controller 1 | Controller 2 | Builds on Item 8; a controller can be mixed with the keyboard |
| One tablet, side by side | Left bar: stick and fire | Right bar: stick and fire | Drag-to-steer maps to absolute direction, so it's natural. Hyperspace moves to a small button or double-tap |
| One tablet, flat, facing each other | Bottom controls | Top controls, **rotated 180°** | Player 2's stick direction and HUD text are rotated 180°; pause sits in the centre |

## Refactoring needed

| # | Work | Size |
|---|---|---|
| 1 | `Player` object and `players[]`; replace the global ship, score, lives, respawn timer, combo and power-ups; loop over players in input, update, collisions, magnet, respawn and game over | **L** |
| 2 | Bullet `ownerId`; points for the collector or bullet owner; friendly-fire flag per mode | S |
| 3 | UFO and boss target the nearest living ship | S |
| 4 | Input: per-player bindings, second stick zone and routing touches by zone, `data-player` on touch buttons, controller adapter, 180° rotation for a facing player | M |
| 5 | Camera at the wrapped midpoint of living ships, with smoothing near the half-world ambiguity; radar centred on the camera showing all ships; zoom out for 3–4 players (down to about 0.67) | S–M |
| 6 | HUD: per-player panels in the side bars, colours, mode timer, revive beacon | M |
| 7 | Mode layer: settings per mode (friendly fire, lives, timer, win condition), mode select menu, end-of-round screen | M |
| 8 | Saved data: co-op/versus leaderboards; whose upgrades and achievements apply; difficulty adjustment per mode | S–M |
| 9 | Ghost: trace recorder and player, seeded level layout, sharing | M |
| 10 | Determinism (fixed timestep, one seeded random generator); only for exact replays or lockstep | L |
| 11 | Online: network layer (Trystero or PeerJS), room-code lobby, snapshot encoding, smoothing, own-ship prediction, disconnect and rejoin, relay settings | **XL** |
| 12 | Tests for 2-player collisions, scoring and camera fit | M |

## Roadmap

- **Phase 1, local multiplayer** (items 1–8 and 12; L–XL overall): one simulation, one canvas, `players[]`, midpoint camera, per-player input. Modes in order: Co-op, Versus Harvest, Duel, Saucer. No new dependencies; hosting unchanged.
- **Phase 2, asynchronous** (item 9, M; add 10 only for exact replays): Ghost Race and Take Turns on seeded levels; traces in local storage and share links. Still no network.
- **Phase 3, online, optional** (item 11, XL): the host's browser runs the game (the Phase 1 code) and sends snapshots; the other player sends input. Browser-to-browser data channels (unreliable for snapshots, reliable for events). Matchmaking via Trystero with a room code, trying Nostr first and falling back to MQTT or BitTorrent servers; manual code or QR exchange as a no-third-party fallback. Google STUN plus optional Open Relay TURN, with a clear "your network blocks direct connections" message. 2 players first, at most 4. Only if Phase 3 proves popular: move matchmaking and relay to a free Cloudflare Worker for reliability.

## Risks
- **Core refactor regressions:** global state is spread through `main.js`. Keep single-player as `players.length === 1` and run the full existing test suite after every step.
- **Touch ergonomics:** two sets of controls on a smaller tablet may block the view; the landscape side bars help, portrait doesn't.
- **Camera edge case:** when the ships are exactly half a world apart on an axis, the midpoint can flip; needs hysteresis to avoid jitter.
- **Balance:** two players collect greens twice as fast; level thresholds, boss health and UFO spawn rate need scaling; revives can make it too easy.
- **Online reliability and privacy:** public matchmaking servers have no guarantee (y-webrtc's have already vanished); a relay key in a static site can be abused; players learn each other's IP address.
- **Free backend traps:** Firebase's hard 100-connection cap; Supabase pausing inactive projects. Neither suits 20 updates per second.
- **Determinism debt:** anything needing exact replays forces the fixed-timestep and seeded-randomness work.

## Questions for you
1. Who plays together: the same household on one tablet or laptop, or friends in different places? This decides whether Phase 3 is needed at all.
2. On a tablet, do players sit side by side, or face each other across a tablet lying flat?
3. Co-op or competitive first? Are ship-versus-ship shots (Duel) fine for the intended players?
4. Co-op lives: shared, or individual with revive? Power-ups per player or team-wide?
5. Should each player's purchased upgrades apply in multiplayer, or everyone get standard ships? Who earns credits and achievements?
6. Are 2 players enough, or are 3–4 needed? Beyond 2, the camera must zoom out and on-screen controls won't fit on one tablet.
7. For online play, are third-party services (public Nostr servers, the PeerJS cloud, a Metered relay) acceptable? Would you create a free Cloudflare account for a more reliable option?
8. For ghost sharing, is a long link or a downloaded file fine, or is a QR code needed on tablets?

## Sources
- Asteroids (1979): [MobyGames](https://www.mobygames.com/game/8872/asteroids/), [arcade-history](https://www.arcade-history.com/?n=asteroids-upright-model&page=detail&id=126)
- Asteroids Deluxe: [Wikipedia](https://en.wikipedia.org/wiki/Asteroids_Deluxe), [MobyGames](https://www.mobygames.com/game/32333/asteroids-deluxe/)
- Spacewar!: [Wikipedia](https://en.wikipedia.org/wiki/Spacewar!), [Computer History Museum](https://www.computerhistory.org/pdp-1/spacewar/)
- Space Duel: [Wikipedia](https://en.wikipedia.org/wiki/Space_Duel), [Shmup Wiki](https://shmup.fandom.com/wiki/Space_Duel)
- Asteroids: Recharged: [official site](https://recharged.atari.com/asteroids-recharged/), [Co-Optimus](https://www.co-optimus.com/game/10796/pc/asteroids-recharged.html)
- Starblast.io: [starblast.io](https://starblast.io/)
- Ghost racing: [Ghost Pro Racing 3D (Hacker News)](https://news.ycombinator.com/item?id=45490844), [ghost replay needs a deterministic course](https://github.com/wjdavis5/taxiGame/issues/20)
- PeerJS: [FAQ](https://peerjs.com/client/faq), [PeerServer Cloud](https://peerjs.com/server/cloud), [issue #997](https://github.com/peers/peerjs/issues/997), [p2p-games free-tier limits](https://github.com/abdullahnettoor/p2p-games/issues/5)
- Trystero: [GitHub](https://github.com/dmotz/trystero), [trystero.dev](https://trystero.dev/)
- Manual/QR exchange: [serverless-webrtc-qrcode](https://github.com/fta2012/serverless-webrtc-qrcode), [Franklin Ta](https://franklinta.com/2014/10/19/serverless-webrtc-using-qr-codes/), [QWBP spec](https://github.com/magarcia/qwbp/blob/main/SPECIFICATION.md)
- y-webrtc outage: [issue #43](https://github.com/yjs/y-webrtc/issues/43), [Yjs forum](https://discuss.yjs.dev/t/is-the-public-signaling-server-that-ships-by-default-with-y-webrtc-still-working/1979)
- Relay usage: [BlogGeek TURN](https://bloggeek.me/webrtcglossary/turn/), [L7mp](https://medium.com/l7mp-technologies/use-of-turn-in-webrtc-revisited-it-may-be-more-useful-than-you-thought-856059fd27a3)
- Free relays: [Open Relay Project](https://www.metered.ca/tools/openrelay/), [Metered STUN/TURN](https://www.metered.ca/stun-turn), [WebRTC.ventures](https://webrtc.ventures/2024/11/selecting-and-deploying-managed-stun-turn-servers/)
- Firebase: [limits](https://firebase.google.com/docs/database/usage/limits), [API keys](https://firebase.google.com/docs/projects/api-keys), [security checklist](https://firebase.google.com/support/guides/security-checklist)
- Supabase: [Realtime limits](https://supabase.com/docs/guides/realtime/limits), [free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [pricing](https://supabase.com/pricing)
- Cloudflare / PartyKit: [Durable Objects free tier](https://developers.cloudflare.com/changelog/post/2025-04-07-durable-objects-free-tier/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [PartyKit on your own account](https://docs.partykit.io/guides/deploy-to-cloudflare/), [how PartyKit works](https://docs.partykit.io/how-partykit-works/)
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- Network models: [Gambetta: client-server architecture](https://www.gabrielgambetta.com/client-server-game-architecture.html), [entity interpolation](https://www.gabrielgambetta.com/entity-interpolation.html), [client-side prediction](https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html), [Fiedler: snapshot interpolation](https://gafferongames.com/post/snapshot_interpolation/), [deterministic lockstep](https://gafferongames.com/post/deterministic_lockstep/), [floating point determinism](https://gafferongames.com/post/floating_point_determinism/), [fix your timestep](https://gafferongames.com/post/fix_your_timestep/), [ECMAScript Math.sin](https://tc39.es/ecma262/#sec-math.sin)
- Rollback: [GGPO](https://en.wikipedia.org/wiki/GGPO), [Telegraph](https://github.com/thomasboyt/telegraph), [SnapNet](https://www.snapnet.dev/blog/netcode-architectures-part-2-rollback/)
- Controllers: [MDN getGamepads](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/getGamepads), [MDN Gamepad controls](https://developer.mozilla.org/en-US/docs/Games/Techniques/Controls_Gamepad_API)
