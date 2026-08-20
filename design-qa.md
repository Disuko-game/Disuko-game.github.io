# Design QA: full rigid-body dice rendering

- Source visual truth: `.codex-remote-attachments/019ff6aa-d2fc-7cd3-9e53-de90bcd1787e/07025cd6-2259-463e-8b5f-70645575892f/1-Photo-1.jpg`
- Browser-rendered implementation: `output/playwright/rapier-final-launch.png`, `output/playwright/rapier-final-collisions.png`, `output/playwright/rapier-final-bounces.png`, and `output/playwright/rapier-final-settle.png`
- Combined source/implementation comparison: `output/playwright/qa-rapier-reference-comparison.jpg`
- Focused material evidence: `output/playwright/rapier-final-collisions-detail.jpg` and `output/playwright/rapier-final-settle-detail.jpg`
- Viewport: 390 x 844 CSS px, deviceScaleFactor 1
- Source pixels: 576 x 1280. Implementation pixels: 390 x 844. The comparison normalizes the reference reroll-dice crop and two implementation reroll-tray crops into equal-width panels.
- State: two-player local game, Player 1 rerolling three blue dice inside the existing reroll tray.

## Full-view comparison evidence

The reference remains an art-direction target for the dice, not a screen-layout target. The implementation preserves Disuko's existing board, header, player rails, reroll controls, and fixed tray geometry. The four browser captures show the complete launch-to-settle sequence inside the existing dashed tray. The board and tray do not shift, no synthetic rolling surface appears, and the dice remain clipped by the physical tray walls rather than by DOM layout changes.

## Focused-region comparison evidence

`qa-rapier-reference-comparison.jpg` places the supplied glossy rounded dice beside the airborne/collision and settled implementation states. The implementation matches the rounded silhouette, saturated player color, white recessed pips, dark lower edge, moving highlight, and grounded contact shadow. The focused captures show independent orientations, real occlusion, dice-to-dice contact, wall/floor bounces, and staggered settling without a final face-up snap.

## Required fidelity surfaces

- Fonts and typography: unchanged. Existing reroll status copy remains centered and legible.
- Spacing and layout rhythm: unchanged. The renderer occupies the existing reroll tray; board position, tray bounds, controls, and mobile overflow remain stable.
- Colors and visual tokens: the meshes use the same blue/red/green/yellow tokens as normal game dice. Environment-light intensity was reduced after the first browser pass to prevent washed-out cyan faces while preserving moving glossy reflections.
- Image quality and asset fidelity: true rounded Three.js meshes render at device-aware pixel density. Procedural color and bump textures give each pip visible recess depth; image-based room lighting, clearcoat, cast/contact shadows, and ACES tone mapping produce the glossy reference treatment.
- Copy and content: no game copy or rules changed.

## Interaction and runtime verification

- Tested the complete human flow: enter reroll mode, select separate dice, Roll, right-side gathering, leftward launch, airborne rotation, floor/wall/dice collision, staggered settle, authoritative final faces, landed pause, and return to the normal tray.
- Physics coverage: three deterministic variants for every supported count from 1 through 18 dice; rounded colliders, friction, restitution, angular momentum, CCD, stacking, contact-force events, and non-intersecting final bodies.
- Six-die mobile stress roll: 207 requestAnimationFrame samples over 3.5 seconds; 16.97 ms average, 16.8 ms p95, 17.1 ms p99, two frames over 25 ms, 83.2 ms maximum during scene startup.
- Final production browser console: 0 errors and 0 warnings.
- Production build: passed.
- Automated regression suite: 74/74 tests passed.

## Findings and comparison history

1. Initial full-physics browser pass found a P2 material regression: the first image-based-lighting values washed the blue dice lighter than the established normal-die appearance. It also produced PMREM sample-limit warnings.
2. Fix: reduced environment contribution while preserving clearcoat reflections and lowered the PMREM blur radius to its supported range.
3. Post-fix evidence: `rapier-final-collisions-detail.jpg` and `rapier-final-settle-detail.jpg` show restored saturated blue, darker lower edges, recessed pips, moving highlights, and grounded shadows. The final browser console is clean.
4. No actionable P0, P1, or P2 issues remain.

## Follow-up polish

- Motion blur remains intentionally omitted. At this component size it reduced pip readability in trials more than it improved realism; true angular motion, height-sensitive shadows, and impact deformation already convey speed.

## Reference-matched typical d6 refinement

- External reference: output/references/round-corner-d6.jpg from Dice Game Depot, a 16 mm glossy opaque round-corner d6 with indented white spots.
- Secondary reference: output/references/opaque-d6.jpg, a Koplow opaque rounded d6 photographed under soft product lighting.
- Normalized reference sheet: output/references/typical-d6-comparison.jpg.
- New selected-state capture: output/qa/realistic-dice-selected.png.
- New mid-roll capture: output/qa/realistic-dice-roll-tray.png.
- Final combined comparison: output/qa/typical-d6-final-comparison.jpg.

### Visual judgment

The pass targets a typical opaque board-game d6 rather than a sharp-edged casino precision die. The rendered silhouette now has broader rounded corners and a smoother 16-segment edge transition. Face pigment is nearly uniform, so highlights no longer rotate as baked texture art; two broad area lights, the room environment, clearcoat, and the physical material now produce the moving specular response. Pip cavities are wider but shallower, with restrained inner occlusion that reads as indented paint rather than drilled holes. Static DOM dice were aligned to the same softer radius and broad glossy highlight without changing board or tray layout.

The side-by-side comparison shows the implementation now tracks the real references in the important cues: rounded plastic silhouette, large flat face centers, white indented pips, saturated opaque color, broad edge highlights, soft lower-face falloff, and grounded contact shadows. The rolling dice remain slightly stylized to preserve pip readability at the game's small mobile scale.

### Verification update

- Rounded Rapier collider was adjusted to follow the new visible silhouette while preserving real wall, floor, and die contacts.
- All three deterministic tumble variants for dice counts 1 through 18 continue to remain bounded, non-intersecting, and staggered in their settle times.
- Full automated suite: 75/75 tests passed.
- Production TypeScript/Vite build: passed.
- Browser console after repeated rerolls: 0 errors and 0 warnings.
- No actionable P0, P1, or P2 visual or interaction issues remain.

## Full-board reroll surface and expanded throw

- Source visual truth: output/qa/full-board-roll-select.png, the app's board-sized selection surface at a 390 x 844 CSS viewport.
- Initial implementation sequence: output/qa/full-board-roll-sequence.jpg.
- Initial P2 evidence: output/qa/full-board-roll-final-spray.png, where equal-speed trajectories reached the left wall together.
- Post-fix implementation: output/qa/full-board-roll-final-wide.png and output/qa/full-board-roll-final-wide-late.png.
- Final comparison: output/qa/full-board-roll-final-wide-comparison.jpg.
- State: two-player local game, Player 1 rerolling four blue dice from the player-relative bottom-right corner.
- Density normalization: browser screenshots captured at deviceScaleFactor 1; focused tray screenshots are 345 x 345 pixels and match the board's 345 x 345 CSS-pixel bounds.

### Full-view and focused comparison evidence

The selection tray is a fixed portal overlay whose bounding box was asserted in-browser to match the live board within one CSS pixel on all four edges. Because it is fixed over the board rather than inserted into layout, the board and surrounding player trays never shift. The launch capture shows the dice gathered in the active player's bottom-right corner. The final fan and late-bounce captures show materially different trajectories, wall contacts, mid-board separation, and continued motion across the expanded square surface.

### Required fidelity surfaces

- Fonts and typography: existing centered reroll copy, font family, weight, and player-facing tabletop rotation remain unchanged.
- Spacing and layout rhythm: the overlay now exactly follows the board's width, height, and screen position; the menu and dice trays remain outside its bounds.
- Colors and visual tokens: the reroll surface continues using the board's cream and brown palette, while dice retain their player color and existing physical material.
- Image quality and asset fidelity: the full-board canvas retains device-aware WebGL rendering, physical shadows, clearcoat reflections, recessed pips, and edge-safe camera framing.
- Copy and content: no labels or game rules changed.

### Interaction, physics, and performance verification

- The deterministic roll window increased from 3.2 seconds to 4.6 seconds.
- Physics now begins as a tight bottom-right cluster, fans each die toward a different portion of the far and side walls, uses stronger linear and angular velocity, lower damping, higher restitution, and square 5.2-unit half-extents.
- Invisible tall wall colliders prevent hard throws from escaping while still producing real edge bounces and contact-force audio.
- Top, left, right, and bottom launch rotations are unit-tested; tabletop CSS rotation keeps the tray text and local bottom-right launch facing the seated player.
- All three variants for counts 1 through 18 remain within bounds, record floor/wall/die contacts, avoid final intersections, settle at staggered times, and satisfy a broad-spray assertion.
- Full-browser 4.7-second cadence: 276 frames, 17.04 ms average, 16.8 ms p95, 17.0 ms p99, one frame above 25 ms; the 133.5 ms maximum occurred during scene startup.
- Browser console after repeated rolls: 0 errors and 0 warnings.
- Production build: passed.
- Full automated suite: 78/78 tests passed.

### Comparison history

1. First full-board pass correctly matched the board footprint and produced hard wall impacts, but the similar horizontal speeds caused all four dice to reach the left wall together. This was recorded as a P2 bunching issue.
2. The throw was changed from a shared-speed leftward impulse to a deterministic fan: early dice receive more horizontal velocity, later dice receive more depth velocity, and every die receives a wider independent speed multiplier.
3. Post-fix captures show dice separated across the left, upper, center, and lower regions during the roll, followed by dispersed late bounces. No actionable P0, P1, or P2 issues remain.

## Unified stationary and rolling dice scale

- Source visual truth: `output/qa/unified-dice-reference.png`.
- Stationary board/tray capture: `output/qa/unified-dice-stationary.png`.
- Airborne, mixed-speed, and settled captures: `output/qa/unified-dice-airborne.png`, `output/qa/unified-dice-midroll.png`, and `output/qa/unified-dice-landed.png`.
- Focused source/stationary/settled comparison: `output/qa/unified-dice-comparison.jpg`.
- Viewport: 412 x 924 CSS px, matching the supplied mobile reference width.

### Visual judgment

The shared stationary `DieFace` now gives every board, player-tray, opponent-tray, reroll-selection, placement, and drag-preview die the same bottom-screen viewing direction: a square glossy top face over a darker rounded lower body, with no side-to-side camera skew. The rolling mesh uses the same rounded-corner ratio, saturated player pigments, recessed white pips, clearcoat highlight, and grounded shadow treatment. Its visible size was normalized against the 6 x 6 board cells so settled rolling dice no longer shrink relative to normal board dice.

The nearly overhead rolling camera preserves the board-size tray while the higher physical launch makes depth readable through vertical travel, changing apparent scale, moving/softening shadows, and delayed impacts. The three-die comparison shows independent speed and height: dice separate during the first arc, reach different areas at different times, rebound from the tall tray walls, and settle in mixed locations.

### Verification update

- Shared interactive dice markup remains one accessible `DieFace` root; the decorative top and lower body are hidden from assistive technology.
- Physics uses a 1.04-unit visible mesh with a matching 0.52-unit rounded collider, higher starting heights, independently varied linear impulses, stronger vertical velocity, 8 CCD substeps, and taller collision walls.
- Deterministic coverage now explicitly asserts varied starting heights, travel distances, and peak height in addition to the existing 1-18 die, 3-variant bounds/contact/settling coverage.
- Full automated suite: 79/79 tests passed.
- Production TypeScript/Vite build: passed.
- Browser console: 0 errors and 0 warnings.
- No actionable P0, P1, or P2 visual or interaction issues remain.

## Literal shared Three.js dice render

- Source visual truth: `output/qa/unified-dice-reference.png`.
- Final stationary implementation: `output/qa/literal-shared-dice-final.png`.
- Exact live settled implementation: `output/qa/literal-shared-live-settled.png`.
- Source/stationary/live comparison: `output/qa/literal-shared-dice-comparison.jpg`.
- Viewport: 412 x 924 CSS px at deviceScaleFactor 1.

### Full-view and focused comparison evidence

Every real board, player-tray, opponent-tray, selection, placement, and drag-preview die now displays a PNG generated at runtime by the same Three.js `RoundedBoxGeometry`, six face textures, recessed-pip bump maps, `MeshPhysicalMaterial`, clearcoat, room environment, lights, camera direction, tone mapping, final-face quaternion, and dual shadow treatment used by the live reroll scene. The existing DOM `DieFace` is retained only as the accessible interaction target and no longer supplies visible die artwork after the atlas is ready.

The first comparison pass found the trial 165% image framing made stationary bodies about 25% larger than fully settled live dice. Pixel-component measurement showed the original 130% framing produced 40-42 pixel stationary bodies versus 40 pixels for the comparable settled live body. The oversized trial was reverted. The final comparison confirms consistent geometry, face perspective, material highlights, pip depth, lower-face shading, and apparent body scale between stationary and rolling states.

### Required fidelity surfaces

- Fonts and typography: unchanged.
- Spacing and layout rhythm: board cells, tray slots, hit boxes, counts, locks, selection outlines, and recent-move rings are unchanged.
- Colors and visual tokens: all 24 player-color/value combinations come from the rolling renderer's exact pigment map and physical lighting.
- Image quality and asset fidelity: 512-pixel WebGL source renders are alpha-cropped into cached 192-pixel sprites, retaining real mesh edges, recessed pips, clearcoat highlights, and contact shadows without creating a WebGL context per die.
- Copy and content: unchanged.

### Verification update

- Browser DOM assertion: 21 real dice present, 21 Three.js sprite images present, 0 missing, and all 21 CSS fallback surfaces hidden.
- The atlas is lazy-loaded and cached once per page, preventing both initial-home bundle growth and per-die WebGL context overhead.
- Selection, lock, multiplier, recent-move, drag, placeholder, and fallback behavior remain layered on the existing accessible element.
- Full automated suite: 81/81 tests passed.
- Production TypeScript/Vite build: passed.
- Final browser console: 0 errors and 0 warnings.
- No actionable P0, P1, or P2 issues remain.

## Darker reference lighting, body-centered sprites, and continuous launch

- Source visual truth: output/qa/dark-dice-lighting-reference.png.
- Final stationary implementation: output/qa/dark-dice-centered-stationary.png.
- Complete bounded roll evidence: output/qa/dark-dice-gather-start.png, output/qa/dark-dice-gather-lift.png, output/qa/dark-dice-launch-safe.png, output/qa/dark-dice-midroll-safe.png, and output/qa/dark-dice-settled-safe.png.
- First-frame continuity proof: output/qa/dark-dice-no-gap-final-20ms.png, output/qa/dark-dice-no-gap-final-120ms.png, output/qa/dark-dice-no-gap-final-300ms.png, and output/qa/dark-dice-no-gap-final-launch.png.
- Final early-frame contact sheet: output/qa/dark-dice-no-gap-final-sequence.jpg.

### Visual judgment

All four physical pigments are darker and more saturated, with lower exposure and less environment wash. The key and strip lights now originate at screen top-right; highlights collect on the upper-right rounded edges while both contact and airborne shadows travel toward bottom-left. The camera is slightly lower than the previous overhead pass, exposing a restrained lower/front face like the supplied mobile reference without changing board geometry.

Stationary sprite cropping now detects the opaque die body at a high alpha threshold, centers the crop on that body, then adds symmetric breathing room for the displaced shadow. The solid top panel therefore remains centered in its cell while the lower-left shadow is free to extend outside the visual center calculation.

### Motion and safety verification

Physics is held for the same 520 ms used by the UI gathering phase. During that interval the selected dice remain visible, gather from the center, and lift into the active player's rotated bottom-right launch cluster. The invisible collision boundary was brought inward to a 4.35-unit half-extent, leaving camera-safe room for the rounded body and height-dependent lower-left shadow. Strong varied impulses still produce a broad spray, wall and die contacts, different peak heights, and staggered settling.

Browser QA initially found a blank interval while the lazy 3D chunk and physics template initialized. The final implementation covers both loading boundaries: the Suspense fallback renders the existing stationary dice immediately, and the mounted renderer retains cached identical sprites until its first fully positioned WebGL frame. Captures at 20 ms, 120 ms, 300 ms, and launch confirm there is no disappearance. Final browser console: 0 errors and 0 warnings.

Automated regression suite: 81/81 tests passed. Production TypeScript/Vite build: passed. No actionable P0, P1, or P2 issues remain.
## Restored stationary scale and lower diagonal throw

- Source visual truth: output/qa/dark-dice-lighting-reference.png.
- Final stationary implementation: output/qa/restored-stationary-final.png.
- Expanded-view roll evidence: output/qa/expanded-view-launch.png, output/qa/expanded-view-airborne.png, output/qa/expanded-view-first-bounces.png, output/qa/expanded-view-midroll.png, and output/qa/expanded-view-late-roll.png.
- Required source/stationary/rolling comparison: output/qa/stationary-roll-correction-comparison.jpg.
- Viewport: 412 x 924 CSS pixels at deviceScaleFactor 1.

### Comparison history and findings

1. P1 stationary-scale regression: the prior opaque-body crop correctly centered the die independently of its shadow, but the 130% sprite frame exposed too much of each colored slot and made the die read as a small cube sitting in an individual tray.
2. Fix: the already body-centered sprite is now framed at 156% around the same center. This restores the pre-crop apparent footprint and covers the structural slot background without changing hit boxes, board cells, tray tracks, or the rolling mesh.
3. P1 airborne clipping: lowering the vertical impulse reduced the arc, but the original inner WebGL viewport could still clip a physically valid die near its edge.
4. Fix: the full physics arena and broad spray were retained, while the live WebGL view was expanded vertically by 20% and its field of view changed proportionally. Apparent die size remains stable, but the complete rounded body and shadow remain visible through launch, first bounce, late bounces, and settling.
5. Post-fix comparison shows stationary dice at the same visual scale as the reference and live dice, no exposed individual colored wells around normal dice, a lower diagonal negative-X/negative-Z throw, and no viewport clipping in the captured sequence.

### Required fidelity surfaces

- Fonts and typography: unchanged.
- Spacing and layout rhythm: board, trays, slots, controls, and outer reroll surface remain fixed; only the transparent WebGL viewing area extends vertically during the active roll.
- Colors and visual tokens: unchanged from the darker top-right-lit physical material pass.
- Image quality and asset fidelity: stationary and rolling states continue to use the same Three.js geometry, textures, recessed pips, physical material, lighting, and shadows.
- Copy and content: unchanged.
- Browser console: 0 errors and 0 warnings.
- No actionable P0, P1, or P2 findings remain.
## Shared live Three.js dice everywhere

- Stationary board/tray implementation: `output/qa/live-dice-everywhere.png`.
- Reroll selection before occlusion correction: `output/qa/live-dice-reroll-selection.png`.
- Final corrected selection state: `output/qa/live-dice-final-clean.png`.
- Final live physics handoff: `output/qa/live-dice-roll-final.png`.
- Viewport: 412 x 924 CSS pixels.

### Visual and implementation judgment

The cached PNG atlas has been removed. Every real board, player-tray, opponent-tray, reroll-selection, drag-preview, and transition die is now a DOM interaction marker tracked by one transparent Three.js renderer. That renderer reuses the exact `RoundedBoxGeometry`, six physical face materials, recessed-pip bump textures, final-face quaternion, camera direction, studio lighting, tone mapping, and grounded shadow treatment used by the Rapier reroll renderer. The live physics renderer takes over during the active tumble, so the die no longer changes from an image capture into a mesh.

One shared WebGL context renders all resting dice with scissored viewports at 30 FPS, avoiding the browser context limit and per-die renderer overhead. The existing semantic DOM remains responsible for labels, hit targets, selection, locks, multipliers, and recent-action feedback. Explicit tray occlusion prevents elevated board feedback from bleeding through the board-sized reroll surface.

### Final verification

- Runtime DOM assertion: one shared stationary canvas, one live roll canvas during tumbling, zero `.static-die-3d-image` elements, and all live-die markers use the shared renderer.
- Reroll selection, board-sized overlay, physics handoff, settled return, and restored local-game load were exercised in the production preview.
- Two-second browser cadence with the shared layer active: 121 frames, 16.63 ms average, 16.8 ms p95, 17 ms maximum.
- Browser console: 0 errors and 0 warnings.
- Full automated suite: 81/81 tests passed.
- Production TypeScript/Vite build: passed.
- No actionable P0, P1, or P2 visual or interaction issues remain.
## Reference-driven carved wood table and live-dice loading gate

- Supplied source visual truth: `C:/Users/shadt/AppData/Local/Temp/codex-clipboard-c7c53bc8-cbb2-45f3-8ce4-c53517baed62.png`.
- Final browser implementation: `output/qa/wood-redesign-final.png`.
- Same-input comparison: `output/qa/wood-redesign-reference-comparison.jpg`.
- Viewport: 412 x 924 CSS pixels at deviceScaleFactor 1. The reference is center-cropped to the same 412:924 viewport before being placed beside the implementation.
- State: two-player local game with one human and one Medium PC, matching the supplied reference's compact mobile game-table composition.

### Generated material assets

The built-in ImageGen tool used the supplied screenshot as art direction and generated three texture-only raster assets: dark walnut tabletop grain, pale maple laser-engraved board grain, and a dark recessed wood/cork tray-well surface. Prompts explicitly excluded dice, UI controls, text, logos, frames, perspective scenes, and lighting gradients so the results remain seamless physical materials rather than replacement UI screenshots.

- `public/textures/dark-walnut-table.png`
- `public/textures/pale-maple-board.png`
- `public/textures/dark-tray-well.png`

### Comparison findings and corrections

1. The first loading-gate implementation hid the DOM markers with `visibility: hidden`; the shared renderer correctly refused to render invisible targets, creating a readiness deadlock. The visibility rule was removed and the opaque wood loader now covers the game without making its geometry unmeasurable.
2. The loader itself initially failed the renderer's element-at-point occlusion test. The render loop now recognizes its own opaque loader as a permitted temporary cover, reports ready after the first real die frame, and then dismisses the loader. Browser verification: `aria-busy` changed to false, loader count changed to 0, exactly one shared stationary canvas remained, and the root acquired `live-dice-3d-ready`.
3. All old CSS die surfaces are hidden from first paint; browser verification found 23 live-die targets and 0 visible fallback surfaces. There is no old-die flash while the lazy Three.js renderer initializes.
4. The camera moved closer to overhead while retaining a restrained lower/front face. Environment contribution, clearcoat wash, and specular intensity were reduced; player pigments were darkened to align with the reference's saturated molded-plastic dice.
5. The board now uses a pale maple surface with engraved grid lines inside a darker carved wood frame. The active-player color remains a narrow illuminated perimeter rather than changing the board geometry.
6. Opponent and player dice rails now use dark walnut physical frames, color-boundary rails, six fixed recessed wells, and the generated dark well texture. Multipliers remain DOM UI, centered on the die and underneath the live WebGL body in stacking order.
7. The board-sized reroll surface exactly matches the live board bounds at 388 x 388 CSS pixels and uses the same maple/walnut physical construction. Selecting a reroll die produced 0 board-action highlight or wiggle elements.
8. Layering is explicit: reroll surface z-index 75, shared live dice canvas 76 with `pointer-events: none`, drag previews 78, and game-menu backdrop 100. Browser element-at-point verification returned the menu panel above both reroll tray and live dice.
9. The stationary live layer uses one shared scissored WebGL canvas and the physics roll keeps the existing Rapier renderer. No per-die WebGL contexts or sprite captures were introduced.
10. Final production browser console: 0 errors and 0 warnings. No actionable P0, P1, or P2 issue remains in the verified mobile state.

### Verification update

- Full automated regression suite: 81/81 tests passed.
- Production TypeScript/Vite build: passed.
- `git diff --check`: passed.
- Browser interactions verified: resume saved local game, loading handoff, enter reroll mode, select a die, open menu over reroll surface, resume, and cancel reroll.
## Compact corner counts, light-maple rails, and height-aware shared shadows

- Supplied component reference: `C:/Users/shadt/AppData/Local/Temp/codex-clipboard-13f8ba30-75e7-4593-9f4f-3588c7443da1.png`.
- Final full mobile state: `output/qa/count-maple-shadow-final.png`.
- Component-level reference comparison: `output/qa/count-maple-shadow-reference-comparison.jpg`.
- Elevated real-drag evidence: `output/qa/elevated-drag-over-board-final.png`.
- Renderer-hidden comparison frames: `output/qa/count-maple-shadow-background.png` and `output/qa/elevated-drag-over-board-background.png`.
- Viewport: 412 x 924 CSS pixels at deviceScaleFactor 1. The implementation tray is cropped to the supplied reference's 287 x 95 component frame for direct comparison.

### Findings and corrections

1. Confirmed stacking bug: the count lived inside a die stacking context below the shared WebGL canvas, so the real 3D die covered it. The count-bearing target now uses z-index 79 above the stationary canvas at 76. Browser element-at-point verification at the badge center returns `.die-multiplier`, not the canvas or die.
2. The player-tray count is restored to a compact 1.3 rem circle with 1 rem type, positioned at `right: -0.24rem; bottom: -0.2rem`. Browser geometry confirms its center is both right and below the die center.
3. Both opponent and active-player rails now use the generated pale-maple texture and light carved-wood shading while retaining their colored perimeter and dark recessed value wells.
4. The shared live renderer now maps normal dice to grounded height, pointer drags to a constant lifted height, bot/return animations to a sine lift based on live CSS animation progress, and landing dice to a decaying height. Every state feeds the same `shadowPresentation` function used by reroll physics.
5. Contact shadows were enlarged and strengthened while preserving the reroll light direction: key lighting remains top-right and the shadow offset remains negative X / positive Z, which projects bottom-left in the game camera. As height increases, the shadow grows, moves farther bottom-left, and becomes lighter.
6. Stationary renderer-on versus renderer-hidden pixel comparison around an isolated board die found 73.5% changed neutral pixels in the bottom-left sample and only 8.5% in the top-right sample. Mean bottom-left darkening was 77.95 levels after saturated die pixels were excluded.
7. A real pointer drag was held over a light empty board cell without dropping. The drag preview remained above the board, produced a broader elevated bottom-left shadow, and returned to its original tray without changing the turn or leaving selection state.
8. Browser console after the full flow: 0 errors and 0 warnings.

### Verification update

- Full automated regression suite: 81/81 tests passed.
- Strengthened shadow-specific regression test: 7/7 passed, including grounded visibility, rising softness/expansion, and bottom-left direction assertions.
- Production TypeScript/Vite build: passed.
- Browser interactions: saved-game resume, stationary tray inspection, held pointer drag over board, renderer-isolated shadow comparison, and safe return to tray.
## Mobile drag clipping and stacked-count compositing correction

- Final held-drag capture: `output/qa/drag-unclipped-mobile-final.png`.
- Viewport: 412 x 924 CSS pixels at deviceScaleFactor 1.
- State: the representative die from a nine-die value stack held above the board without dropping.

### Findings and corrections

1. Confirmed clipping cause: lifted live dice reused the grounded 1.9x scissored viewport even though height made the projected mesh larger and shifted it toward the viewport top. The per-die region now grows from 2.08x at ground level to as much as 2.92x for a pointer-held die.
2. Camera zoom is inversely compensated by the region-scale change, preserving the established apparent die size while adding transparent clearance for the complete body and displaced shadow.
3. The stacked-value artifact was not duplicate game state: browser DOM inspection found exactly one live die marker in every occupied tray slot. It occurred only on count-bearing targets, whose badge was composited inside the parent's preserved 3D transform on mobile.
4. Count-bearing targets now flatten their DOM transform subtree, while the badge has its own isolated front layer with explicit text color and backface handling. The real die remains entirely in the shared WebGL canvas; the count remains ordinary readable DOM.
5. During a real held drag of a nine-die stack, the drag preview contained exactly one live die marker and zero multiplier/blank-die markers. The expanded region measured 142.58 CSS pixels around a 48.88 pixel target, versus roughly 93 pixels before the correction.
6. The held die was returned to its original tray position. No move was committed, no selection remained, and the turn stayed Player 1.
7. Final browser console: 0 errors and 0 warnings.

### Verification update

- Full automated regression suite: 81/81 tests passed.
- Production TypeScript/Vite build: passed.
- `git diff --check`: passed.

## Engraved empty slots and physics-continuous reroll return

### Findings and corrections

1. Empty value wells no longer render a desaturated miniature die. The existing value-specific pip grid remains, while the die depth, face border, fill, and gloss are removed. Empty wells use pale maple and the pips use inset dark/light shadows to read as engraved recesses.
2. Confirmed return discontinuity: entering the returning phase unmounted the Rapier/WebGL dice and created centered DOM dice, so the old animation began from an unrelated position.
3. The physics renderer now reports each die's final projected screen center after the final tumble sample. The returning element converts that point into its orientation-aware local coordinate space and starts its glide there.
4. The return no longer uses negative animation delays or fades to zero. Every die remains opaque and reaches its value-specific tray slot before the committed tray state replaces it.
5. Timing audit confirms the final physics sample occurs at 4600 ms and the return begins only after the additional 260 ms landed pause, leaving time for the settled-position callback before the renderer handoff.

### Verification update

- Full automated regression suite: 81/81 tests passed.
- Production TypeScript/Vite build: passed.
- `git diff --check`: passed.
- Live in-app browser verification was attempted but blocked by the environment's Windows ACL helper failure; no browser-pass claim is made for this update.

## Board and tray physical-perspective pass

**Source visual truth**
- `output/qa/board-perspective-reference.png`
- Source dimensions: 941 x 1673 pixels.
- Target state: portrait game table with opponent rails, square game board, and active-player rail visible.

**Rendered implementation evidence**
- Local implementation URL: `http://127.0.0.1:4177/`.
- Intended QA viewport: 412 x 924 CSS pixels at deviceScaleFactor 1.
- Implementation screenshot: unavailable. The in-app browser runtime failed twice before a tab could be inspected or captured because the Windows sandbox ACL helper exited.
- Density normalization: not possible without the implementation capture.

**Findings**
- [Blocked] The raised maple board rim, matching tray aprons, asymmetric top-right lighting, and bottom-left cast shadows are implemented, but fidelity cannot be judged from code or build output alone.
  Location: `.board-wrap`, `.dice-rail-groove`, `.opponent-dice-rail`, `.floating-reroll-tray`.
  Evidence: source image is available; browser-rendered implementation evidence is missing.
  Impact: perspective strength, mobile spacing, tabletop rotation, and live-die alignment remain visually unverified.
  Fix: restore the in-app browser runtime, capture the same game state at 412 x 924, create a side-by-side comparison with the source, and correct any P0/P1/P2 mismatch.

**Required fidelity surfaces**
- Fonts and typography: intentionally unchanged; not visually reverified.
- Spacing and layout rhythm: CSS preserves hit geometry, but apron clearance and compact viewport fit require a browser capture.
- Colors and visual tokens: existing maple/walnut textures and player-color rim tokens are reused; exact visual balance requires capture.
- Image quality and asset fidelity: existing generated wood textures are reused without scaling changes; browser sharpness is unverified.
- Copy and content: unchanged.

**Primary interactions and console**
- Browser interactions tested: none; browser runtime blocked before connection.
- Console errors checked: unavailable for this iteration.
- Automated regression suite: 81/81 passed.
- Production TypeScript/Vite build: passed.
- `git diff --check`: passed.

**Comparison history**
- Initial pass: implementation completed, but no valid rendered comparison could be produced. No visual fixes were made from unverified evidence.

**Implementation Checklist**
- Restore browser capture.
- Verify portrait local game at 412 x 924.
- Verify tabletop mode at a supported landscape viewport.
- Compare source and implementation in one combined image.
- Fix any P0/P1/P2 drift before changing this result to passed.

final result: blocked