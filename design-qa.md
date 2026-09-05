# Gameplay wood and dice depth QA

## Scope and visual target

- Source: `C:/Users/shadt/AppData/Local/Temp/codex-clipboard-c8a8b514-811b-4566-8c40-392367489817.png`.
- Target is the reference's near-overhead, straight dice and physical wooden frames/recesses, not a pixel-for-pixel recreation of its phone chrome, avatar, game state, palette, logo, or typography.
- User explicitly requested preserving the existing pale maple board and dark walnut background. Existing controls, game rules, board markings, and multiplayer behavior are preserved.
- Source pixels: 941 x 1672. Browser checks: 390 x 760 and 390 x 844 CSS px at DPR 1. Compare component proportions after normalizing source width to 390px; exclude its OS status bar. Different board occupancy/player names are intentional live-game data, not visual substitutions.

## Comparison history

1. Initial in-app comparison at 390 x 760 found [P2] excess unused rail space: fixed-size columns left a blank strip before the first well. Six equal-width tracks now fill the existing outer rail, preserving all six value positions and readable empty-well pips.
2. The shared 3D camera changed from 0.48 to 0.26 radians off vertical. Resting orientations remain cardinal. Real rounded mesh rims, inside walls, solid lower skirts and shadow receivers replace the previous simple boxes.
3. Source and `output/playwright/trayQA-full-width-wells.png` were opened together for full-view comparison. The second pass confirmed uniform wells, appropriate shallow die side visibility, preserved wood colors, and increased frame depth. [P2] square lower-skirt corners protruded under the rounded rims; the lower skirt now uses the same rounded outline as the rim, with vertex-by-vertex containment regression tests.
4. Final source and `output/playwright/webkit-final-wood/board-four-colors.png` were opened together. The four-player normal layout shows straight dice, full-width recessed wells, smoothly rounded frame corners and preserved maple/walnut playing colors. In-app mobile and 1200 x 900 desktop checks confirm the corner correction. Focused inspection of the empty wells, die fronts, lower frame corners and raised rim shadows found no remaining actionable P0/P1/P2 differences within the requested styling scope.

## Required fidelity surfaces

- Fonts/typography: existing game typography and logo retained; turn labels, player labels, action counts and die counts remain legible. No screenshot text is rebuilt as new UI.
- Spacing/layout: six evenly spaced tray wells; no new page structure. Opponent well widths measured 42.25px with equal 7.67px edge spacing at 390px width. Existing board and controls remain in the viewport.
- Colors/tokens: existing maple playing area and walnut background unchanged. Dark tray-well texture reused; player accents retained as thin outlines. Physical rim materials use warm wooden edge tones.
- Images/materials: existing raster wood textures and logo reused, real Blender GLB dice retained. New frame geometry is live 3D gameplay geometry, not a flattened screenshot or placeholder asset. Bevels, wood relief, lighting and shadows are evaluated at runtime.
- Copy/content: no changes to game copy, scores, rules or value meanings. Native phone status bar/avatar from reference intentionally not reproduced.

## Interaction and engineering checks

- In-app browser: four-human normal layout, opening roll, resume, four colored dice placed through normal controls, turn handoff and straight resting orientations verified. No console errors observed.
- Geometry regression tests: open playable interiors, raised lips, upward normals, bounded mesh footprints, floor clearances, shadow/depth separation, dimension caching and disposal pass.
- TypeScript and production build pass. Final complete suite: 123 tests passed across 13 files (single worker, 30-second test timeout).
- Final WebKit phone rendering: four-human normal layout at 390 x 664 CSS px, DPR 3, opening roll, four legal placements and selected-die reroll verified. Screenshot output is 390 x 664px (CSS-pixel capture); final image above is compared at normalized 390px width. Zero runtime errors; one Windows ANGLE precision warning. A physical iPhone GPU has not been tested.
- Final WebKit lifted-die evidence: `output/playwright/webkit-final-wood/blue-die-held.png`. The replacement capture was taken only after confirming `.drag-preview` existed, and shows the lifted blue die and its displaced shadow toward the green die. The initial no-drag capture was rejected and replaced. Isolated WebKit session closed after the completed reroll advanced the turn.
- In-app final drag check at 1200 x 900: lifted red die moved over a green die, then outside the board's top edge. Its live shadow crosses the wood rim and continues onto the board; no banding or double shadow. Die returned to its original cell normally. Temporary browser viewport was reset and isolated in-app QA tab closed.

## Follow-up polish and test gaps

- The supplied image is a style reference, not the app's exact content/layout contract. Its warmer playing-board color, OS chrome, avatar, player names and occupied cells were intentionally not copied.
- Physical iPhone GPU/device testing remains useful even though WebKit rendering is covered.

final result: passed
