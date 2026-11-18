# Disuko tabletop audio

The web game and Quest player use the same 25 mono 48 kHz / 16-bit PCM clips in
`public/audio/table-v2` and `quest/DisukoMR/Assets/Resources/Audio/TableV2`.
The complete library is 780,464 bytes on each platform. No generation service or
API credential is needed at runtime.

Generated through the connected ElevenLabs plugin, Sound Effects v2, on 2026-11-17.
[Source flow](https://elevenlabs.io/app/flows/3xiatL7kBXVWROQvW0aB).
`table-v2.json` records each prompt, generation ID, selected take, edit point,
duration, level, and SHA-256. Four takes were requested for every cue; three
distinct takes are used for recurring physical contacts and one for each reward.

| Event | Sound and playback |
| --- | --- |
| Roll floor | Four user-selected resin-on-wood contacts with their natural body retained |
| Roll wall | The same four approved wooden contacts |
| Die collision | Hard resin dice tapping together; three contacts |
| Pickup | Fingertip brush and small plastic scrape; three takes |
| Placement | One die carefully set flat on wood; three takes |
| Button | Small wooden mechanical tick; three takes |
| Invalid | User-selected option 2: descending marimba, 2x tempo with pitch preserved |
| Completion | Celesta note, raised through six pentatonic steps for successive keys |
| Bonus | Short ascending marimba reward |
| Turn | Gentle thumb-piano invitation |
| Victory | Brief acoustic celesta/marimba flourish |

Roll audio is assembled from **individual physics collision events**, including
material, strength, and position. A whole roll recording is never retriggered per
impact. Placement uses a separate quiet set-down asset. Recurring sounds avoid
consecutive duplicate takes, with subtle pitch variation and velocity-dependent
impact gain. A 25 ms limiter for each material and 14 voices bound dense throws.
Quest retains table-positioned 3D sources and its persisted Sound setting. The
web unlocks on a real pointer/key gesture, stops tails on mute/hidden tabs, drops
stale collisions after long frame gaps, and exposes Sound in Settings and the
game menu. The PWA pre-caches every sound for offline use.

The user selected the original ElevenLabs result clips 5–8 for wood and excluded
clip 4. The revision keeps those four takes, adds distinct plastic-on-plastic
collisions, and preserves the other 14 approved files byte for byte. It also
filters stationary-contact weight and sustained contact force, which otherwise
produce repeated ticks after dice stop bouncing. Earlier `table-v1` assets remain
available for already-open browser clients.

Preparation: `python scripts/revise-dice-audio.py` requires NumPy, FFmpeg, and
the temporary original takes/download metadata under ignored `output/audio`.
The revision trims lead-in while preserving the selected contact bodies, peak-matches with
headroom, fades the end to silence, and writes identical WAVs plus Unity import
settings. Retain the originals locally for a future edit; use the generation
IDs to retrieve existing takes instead of spending credits on regeneration.

Validation on 2026-11-17: web production build and 145 tests pass; Unity asset
integrity test passes, and four existing gameplay tests cover reroll impacts,
completion/bonus, pickup/placement, and victory. Numerical QA confirms all deployed
clips are finite, audible, below clipping, and byte-identical across
platforms. Subjective playback through the wearer's Quest speakers remains a
separate listening check.

On 2026-11-18 the invalid cue was replaced with the user-selected descending
marimba (option 2), accelerated with FFmpeg `atempo=2` while preserving pitch.
Its duration is 0.340125 seconds, exactly half the selected master. A new filename
keeps existing browser caches from serving the previous invalid sound.
