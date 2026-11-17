# Disuko tabletop audio

The web game and Quest player use the same 23 mono 48 kHz / 16-bit PCM clips in
`public/audio/table-v1` and `quest/DisukoMR/Assets/Resources/Audio/TableV1`.
The complete library is 613,220 bytes on each platform. No generation service or
API credential is needed at runtime.

Generated through the connected ElevenLabs plugin, Sound Effects v2, on 2026-11-17.
[Source flow](https://elevenlabs.io/app/flows/3xiatL7kBXVWROQvW0aB).
`table-v1.json` records each prompt, generation ID, selected take, edit point,
duration, level, and SHA-256. Four takes were requested for every cue; three
distinct takes are used for recurring physical contacts and one for each reward.

| Event | Sound and playback |
| --- | --- |
| Roll floor | Resin die contacting a walnut tabletop; three short contacts |
| Roll wall | Resin die contacting a wooden tray rail; three contacts |
| Die collision | Hard resin dice tapping together; three contacts |
| Pickup | Fingertip brush and small plastic scrape; three takes |
| Placement | One die carefully set flat on wood; three takes |
| Button | Small wooden mechanical tick; three takes |
| Invalid | Two muted woodblock knocks |
| Completion | Celesta note, raised through six pentatonic steps for successive keys |
| Bonus | Short ascending marimba reward |
| Turn | Gentle thumb-piano invitation |
| Victory | Brief acoustic celesta/marimba flourish |

Roll audio is assembled from **individual physics collision events**, including
material, strength, and position. A whole roll recording is never retriggered per
impact. Placement uses a separate quiet set-down asset. Recurring sounds avoid
consecutive duplicate takes, with subtle pitch variation and velocity-dependent
impact gain. A shared 18 ms contact limiter and 14 voices bound dense throws.
Quest retains table-positioned 3D sources and its persisted Sound setting. The
web unlocks on a real pointer/key gesture, stops tails on mute/hidden tabs, drops
stale collisions after long frame gaps, and exposes Sound in Settings and the
game menu. The PWA pre-caches every sound for offline use.

Preparation: `python scripts/prepare-table-audio.py` requires NumPy, FFmpeg, and
the temporary original takes/download metadata under ignored `output/audio`.
It trims lead-in, extracts single transients for contacts, peak-matches with
headroom, fades the end to silence, and writes identical WAVs plus Unity import
settings. Retain the originals locally for a future edit; use the generation
IDs to retrieve existing takes instead of spending credits on regeneration.

Validation on 2026-11-17: web production build and 141 tests pass; Unity asset
integrity test passes, and four existing gameplay tests cover reroll impacts,
completion/bonus, pickup/placement, and victory. Numerical QA confirms all 23
clips are distinct, finite, audible, below clipping, and byte-identical across
platforms. Subjective playback through the wearer's Quest speakers remains a
separate listening check.
