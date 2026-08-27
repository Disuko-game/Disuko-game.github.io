# Disuko Bot Laboratory

The laboratory runs the production rules engine without Supabase or human telemetry. Existing Very Easy, Easy, Medium, and Hard presets are immutable baselines: preset decisions are delegated directly to the shipped chooser.

## Dashboard

```powershell
npm run botlab:ui
```

Open `http://localhost:4188/botlab/`. The dashboard is a separate Vite entry and is not imported by the production game. It provides exact-share populations, generated knob controls, natural/forced starter analysis, reports, sampled replays, scenario decision inspection, import/export, cancellation, and IndexedDB run history.

## CLI

```powershell
npm run botlab -- run --spec botlab/experiments/hard-vs-medium.json --games 1000
npm run botlab -- optimize --spec botlab/experiments/hard-vs-random.json --budget 100000
npm run botlab -- compare --recommendations .botlab/runs/<optimization-run>/recommended-configurations.json --games 1200
npm run botlab -- analyze --run <run-id>
npm run botlab -- benchmark --games-per-cell 3
```

Use `--concurrency N` to choose worker count, `--run-id ID` to name a run, and `--resume` to continue its JSONL checkpoint. `run --games N` schedules exactly N games. `optimize --budget N` spends at most and normally exactly N games across training and holdout evaluation.

The `compare` command selects the first recommended configuration by default and schedules direct two-player comparisons against Very Easy, Easy, Medium, and Hard. Use `--rank N` to select another recommendation. A game total divisible by 12 gives every preset an equal number of natural, candidate-forced, and preset-forced starts. The output is one combined run and interactive report.

Both the CLI and dashboard use dynamic worker queues: each free worker takes the next scheduled game, so one unusually long game cannot strand an entire static chunk. The CLI defaults to one fewer than the available logical CPUs; the dashboard defaults to at most eight workers. Tune this down if the machine becomes memory-constrained.

Runaway games stop deterministically after `maxTotalActions` (default 2,000) or `maxRepeatedStates` equivalent strategic positions (default 3). `maxRuntimeMs` is an optional emergency wall-clock limit rather than a default result boundary. Sampled traces keep at most `maxTraceActions` actions (default 250), and dashboard checkpoints are written in batches rather than after every game.

Artifacts are written to ignored `.botlab/runs/<run-id>/` directories:

- resolved experiment and populations;
- engine/git/runtime manifest and deterministic schedule fingerprint;
- per-game JSONL with seeds, seats, starter, configuration hashes, game metrics, and optional traces;
- JSON and CSV summaries;
- a self-contained HTML report;
- checkpoints and optimizer recommendations.

## Knob semantics

Every numeric knob is registered in `STRATEGY_KNOBS` and supports:

- **Existing** — inherit the selected preset value.
- **Fixed** — use the entered value; fixed zero remains enabled.
- **Random** — sample once into a finite seeded candidate pool reused across games.
- **Disabled** — record the knob in `disabledKnobs`, zero its value, and skip its score calculation where applicable.

Configuration hashes include component toggles and disabled-knob state. The optimizer never edits production presets; promotion is an explicit review step.

## Reproducibility

Schedules are deterministic from the experiment spec. Population quotas use deterministic largest-remainder allocation, candidates are finite and seeded, and seats/starters rotate independently of worker count. Natural-plus-forced experiments reuse the same game seed for the natural opening and every forced starter variant, preserving trays and future engine RNG.
