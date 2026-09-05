# Mobile roll stability follow-up

## Requested pre-Blender visual rollback

The active `LiveDice3DLayer`, rendering tests and stylesheet have been restored from `faab38f`. `RerollDice3D` also uses that revision's materials, geometry and lighting; its only difference from that revision is routing physics preparation through the background worker. The newer randomized physics and gameplay remain. Blender asset, lighting and surface helpers are retained on disk but are no longer imported by the active renderers. Earlier visual/mobile-profile notes below describe superseded iterations, not the restored renderer.

## Shadow-isolation test following physical-phone context-loss diagnostics

- Phone diagnostics confirmed successful full-scene rendering followed by WebGL context loss with `rolling: false`, then repeated inability to create a context on refresh. Exact driver/resource cause remains unconfirmed.
- Mobile shadow budget is now zero: the renderer shadow pass and directional-light shadow casting are both disabled. Existing contact-shadow planes, 3D dice, wood geometry, reflections and turn-color glow remain. Desktop retains 2048px real-time shadows.
- The `renderer-start` diagnostic must now report `shadowSize: 0` on the phone. This is an isolation test; it does not establish that shadows caused the original failure.

## Second pass after the reported post-opening crash

- Fixed partial-initialization cleanup: errors release the WebGL context, canvas and successfully created resources. Frame/update exceptions now stop rendering and report the failure rather than repeating every animation frame.
- Mobile glTF is 4,281 triangles (canonical asset: 14,270), exported with rebuilt weighted normals. Phone dice use standard PBR without clearcoat; phone wood disables clearcoat and bump mapping. Desktop asset remains unchanged.
- Connected board/tray surfaces are retained while temporarily hidden, avoiding needless geometry/material destruction across overlays.
- `?diagnostics=1` shows a tap-to-expand local diagnostic panel. Initialization failures, frame failures and context loss also expose it automatically. Scene handoff breadcrumbs include dice/surface counts and rendered triangle/draw-call counts.
- Production build and 132 tests passed. LAN browser check completed the opening-to-gameplay handoff with a Medium PC opponent under the mobile profile and no console errors. This does not establish the original phone crash's root cause or prove it resolved on that device.

- Physics preparation now runs in a reusable module worker, including preloading. Worker errors, message failures, and a 15-second timeout reject preparation into the existing final-result fallback; there is no main-thread physics retry.
- Coarse-pointer devices and viewports at most 768px wide use 1024px shadows, a 1.25 pixel-ratio cap, no MSAA, and a 30 FPS scene target. Desktop quality remains unchanged. Detailed die geometry is unchanged in this first stability pass.
- WebGL context loss stops the scene loop and reveals the existing fallback; restoration restarts rendering.
- Local-only breadcrumbs retain the last 20 events in localStorage under `disuko-roll-diagnostics`. Read with `JSON.parse(localStorage.getItem('disuko-roll-diagnostics') || '[]')` in the affected origin's developer console. Stages include physics-start, physics-ready/failed, playback-start/settled, roll-fallback, and webgl-context-lost/restored. No account or game-state data is collected or uploaded. Last-stage evidence is diagnostic, not proof of a crash cause.

## Verification (2026-09-05)

- Production build passed; worker emitted as a separate module bundle.
- 130 tests passed across 15 files with one worker and a 30-second per-test timeout. New tests cover request routing, worker reuse, timeout termination/retry, worker failure, preparation errors, and mobile render budgets.
- Edge at a phone-sized viewport: opening roll and one-die reroll completed, advancing the turn. No console errors. Breadcrumbs confirmed mobile settings and worker results (opening preparation 3723ms including cold loading; subsequent one-die preparation 69ms on this desktop).
- Larger-roll UI verification was interrupted by a browser automation timeout and detached debugger during selection; it is not counted as passed. Maximum-size simulation is covered by existing automated physics tests, not by this incomplete browser check.
- A physical affected phone has not been tested. These are workload mitigations, not confirmation that the originally reported page-process crash is fixed.
