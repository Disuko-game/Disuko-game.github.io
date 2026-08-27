import { StrictMode, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { chooseBotDecision } from "../game/botDecision";
import { completeOpeningRoll, newGame } from "../game/engine";
import { BOT_STRATEGY_PRESETS, STRATEGY_KNOBS, type BotStrategyConfig, type StrategyKnobMode, type StrategyTemplate } from "../game/botStrategy";
import type { BotDifficulty, GameState } from "../game/types";
import type { ExperimentProgress, ExperimentRun, ExperimentSpec, GameResult, PopulationSpec } from "./types";
import { analyzeResults } from "./analytics";
import { buildSchedule, resolvePopulations } from "./scheduler";
import "./dashboard.css";

const difficulties: BotDifficulty[] = ["very-easy", "easy", "medium", "hard"];
const defaultTemplate: StrategyTemplate = {
  idPrefix: "candidate",
  labelPrefix: "Candidate",
  basePreset: "hard",
  policy: "search",
  knobs: Object.fromEntries(STRATEGY_KNOBS.map((knob) => [knob.path, { mode: "existing" }]))
};

function defaultSpec(): ExperimentSpec {
  return {
    version: 1,
    id: "dashboard-run",
    name: "Dashboard experiment",
    games: 100,
    playerCounts: [2],
    opponentRerollEnabled: false,
    seed: "dashboard-v1",
    starterMode: "natural-and-forced",
    seatRotation: true,
    maxTurns: 1000,
    maxActionsPerTurn: 64,
    traceEvery: 25,
    maxTotalActions: 2000,
    maxRepeatedStates: 3,
    maxTraceActions: 250,
    concurrency: Math.max(1, Math.min(8, (navigator.hardwareConcurrency ?? 4) - 1)),
    populations: [
      { id: "hard", label: "Hard", share: 0.5, source: { kind: "preset", difficulty: "hard" } },
      { id: "candidates", label: "Candidates", share: 0.5, source: { kind: "random", candidateCount: 16, template: defaultTemplate } }
    ]
  };
}

function App() {
  const [spec, setSpec] = useState(defaultSpec);
  const [progress, setProgress] = useState<ExperimentProgress>();
  const [run, setRun] = useState<ExperimentRun>();
  const [comparisonRun, setComparisonRun] = useState<ExperimentRun>();
  const [history, setHistory] = useState<Array<{ id: string; name: string; games: number }>>([]);
  const [error, setError] = useState("");
  const [report, setReport] = useState("overview");
  const workersRef = useRef<Worker[]>([]);
  const checkpointRef = useRef<GameResult[]>([]);
  const activeCheckpointKeyRef = useRef<string | undefined>(undefined);
  const activeResultsRef = useRef<Map<number, GameResult> | undefined>(undefined);
  const customPopulationIndex = spec.populations.findIndex((population) => population.source.kind === "random");
  const customPopulation = spec.populations[customPopulationIndex];
  const template = customPopulation?.source.kind === "random" ? customPopulation.source.template : undefined;

  function stopWorkers() {
    workersRef.current.forEach((worker) => worker.terminate());
    workersRef.current = [];
  }

  function startRun() {
    stopWorkers();
    setError("");
    setRun(undefined);

    try {
      const populations = resolvePopulations(spec);
      const schedule = buildSchedule(spec, populations);
      const checkpointKey = "botlab-checkpoint-" + spec.id;
      activeCheckpointKeyRef.current = checkpointKey;
      const saved = localStorage.getItem(checkpointKey);
      const validIndexes = new Set(schedule.map((game) => game.index));
      checkpointRef.current = (saved ? JSON.parse(saved) as GameResult[] : [])
        .filter((result) => validIndexes.has(result.index));
      const byIndex = new Map(checkpointRef.current.map((result) => [result.index, result]));
      activeResultsRef.current = byIndex;
      const pending = schedule.filter((game) => !byIndex.has(game.index));
      const resumedCount = byIndex.size;
      const started = performance.now();
      let cursor = 0;
      let finished = false;
      let resultsSinceCheckpoint = 0;
      let lastCheckpointAt = performance.now();

      setProgress({ completed: byIndex.size, total: schedule.length, gamesPerSecond: 0 });

      const persistCheckpoint = (force = false) => {
        if (!force && resultsSinceCheckpoint < 10 && performance.now() - lastCheckpointAt < 2000) return;
        checkpointRef.current = [...byIndex.values()].sort((a, b) => a.index - b.index);
        try {
          localStorage.setItem(checkpointKey, JSON.stringify(checkpointRef.current));
          resultsSinceCheckpoint = 0;
          lastCheckpointAt = performance.now();
        } catch {
          setError("The run is continuing, but its browser checkpoint is too large to save.");
        }
      };

      const finishRun = async () => {
        if (finished) return;
        finished = true;
        stopWorkers();
        const results = [...byIndex.values()].sort((a, b) => a.index - b.index);
        const completed: ExperimentRun = {
          spec,
          populations,
          schedule,
          results,
          summary: analyzeResults(spec.id, results)
        };
        setRun(completed);
        setProgress({ completed: results.length, total: schedule.length, gamesPerSecond: results.length * 1000 / Math.max(1, performance.now() - started) });
        localStorage.removeItem(checkpointKey);
        checkpointRef.current = [];
        activeCheckpointKeyRef.current = undefined;
        activeResultsRef.current = undefined;
        await saveRun(completed);
        setHistory(await listRuns());
      };

      if (!pending.length) {
        void finishRun();
        return;
      }

      const dispatch = (worker: Worker) => {
        const game = pending[cursor++];
        if (game) worker.postMessage({ type: "game", game, limits: spec });
      };
      const concurrency = Math.max(1, Math.min(
        spec.concurrency ?? Math.max(1, (navigator.hardwareConcurrency ?? 4) - 1),
        pending.length
      ));
      const workers = Array.from({ length: concurrency }, () => {
        const worker = new Worker(new URL("./browserWorker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (event: MessageEvent<{ type: string; result?: GameResult; message?: string }>) => {
          if (event.data.type === "error") {
            stopWorkers();
            setError(event.data.message ?? "A Bot Lab worker failed.");
            setProgress(undefined);
            return;
          }
          if (event.data.type !== "result" || !event.data.result || finished) return;
          const result = event.data.result;
          byIndex.set(result.index, result);
          resultsSinceCheckpoint += 1;
          persistCheckpoint();
          const elapsed = Math.max(1, performance.now() - started);
          const completedThisRun = byIndex.size - resumedCount;
          const gamesPerSecond = completedThisRun * 1000 / elapsed;
          setProgress({
            completed: byIndex.size,
            total: schedule.length,
            gamesPerSecond,
            etaMs: gamesPerSecond > 0 ? (schedule.length - byIndex.size) * 1000 / gamesPerSecond : undefined,
            latest: result
          });
          if (byIndex.size === schedule.length) void finishRun();
          else dispatch(worker);
        };
        worker.onerror = (event) => {
          stopWorkers();
          setError(event.message || "A Bot Lab worker failed.");
          setProgress(undefined);
        };
        return worker;
      });
      workersRef.current = workers;
      workers.forEach(dispatch);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
      setProgress(undefined);
    }
  }

  function cancelRun() {
    stopWorkers();
    const checkpointKey = activeCheckpointKeyRef.current;
    const activeResults = activeResultsRef.current;
    if (checkpointKey && activeResults?.size) {
      const results = [...activeResults.values()].sort((a, b) => a.index - b.index);
      try { localStorage.setItem(checkpointKey, JSON.stringify(results)); } catch { /* best effort */ }
    }
    activeCheckpointKeyRef.current = undefined;
    activeResultsRef.current = undefined;
    setProgress(undefined);
  }

  function updatePopulation(index: number, update: (population: PopulationSpec) => PopulationSpec) {
    setSpec((current) => ({ ...current, populations: current.populations.map((population, item) => item === index ? update(population) : population) }));
  }

  function updateKnob(path: string, mode: StrategyKnobMode, value?: number, min?: number, max?: number) {
    if (customPopulationIndex < 0) return;
    updatePopulation(customPopulationIndex, (population) => {
      if (population.source.kind !== "random") return population;
      return {
        ...population,
        source: {
          ...population.source,
          template: {
            ...population.source.template,
            knobs: { ...population.source.template.knobs, [path]: { mode, value, min, max } }
          }
        }
      };
    });
  }

  function updateComponent(key: keyof BotStrategyConfig["components"], enabled: boolean) {
    if (customPopulationIndex < 0) return;
    updatePopulation(customPopulationIndex, (population) => {
      if (population.source.kind !== "random") return population;
      return {
        ...population,
        source: {
          ...population.source,
          template: {
            ...population.source.template,
            componentOverrides: { ...population.source.template.componentOverrides, [key]: enabled }
          }
        }
      };
    });
  }

  async function importArtifact(file: File) {
    const imported = JSON.parse(await file.text()) as ExperimentRun | ExperimentSpec | BotStrategyConfig | BotStrategyConfig[];
    if ("spec" in imported && "results" in imported) {
      setRun(imported);
      setSpec(imported.spec);
      await saveRun(imported);
      setHistory(await listRuns());
      return;
    }
    if (Array.isArray(imported) || ("schemaVersion" in imported && "policy" in imported)) {
      const strategies = (Array.isArray(imported) ? imported : [imported]) as BotStrategyConfig[];
      setSpec((current) => ({ ...current, populations: [...current.populations, {
        id: "imported-" + current.populations.length,
        label: "Imported configurations",
        share: 1,
        source: { kind: "saved", strategies }
      }] }));
      return;
    }
    setSpec(imported as ExperimentSpec);
  }

  return <main className="lab-shell">
    <header>
      <div><p className="eyebrow">Developer tool · local only</p><h1>Disuko Bot Laboratory</h1></div>
      <div className="run-actions">
        <button className="primary" onClick={startRun} disabled={Boolean(progress && progress.completed < progress.total)}>Run experiment</button>
        <button onClick={cancelRun}>Cancel</button>
        <button onClick={() => downloadValue(spec, spec.id + ".experiment.json")}>Export spec</button>
        {run && <button onClick={() => downloadValue(run, run.spec.id + ".botlab.json")}>Export run</button>}
        <label className="button">Import<input type="file" accept=".json" onChange={(event) => event.target.files?.[0] && importArtifact(event.target.files[0])} /></label>
      </div>
    </header>

    <section className="panel experiment-grid">
      <label>Name<input value={spec.name} onChange={(event) => setSpec({ ...spec, name: event.target.value })} /></label>
      <label>Games<input type="number" min="1" value={spec.games} onChange={(event) => setSpec({ ...spec, games: Math.max(1, Number(event.target.value)) })} /></label>
      <label>Concurrent workers<input type="number" min="1" max={navigator.hardwareConcurrency ?? 16} value={spec.concurrency ?? 1} onChange={(event) => setSpec({ ...spec, concurrency: Math.max(1, Number(event.target.value)) })} /></label>
      <label>Seed<input value={spec.seed} onChange={(event) => setSpec({ ...spec, seed: event.target.value })} /></label>
      <label>Player counts<select multiple value={spec.playerCounts.map(String)} onChange={(event) => setSpec({ ...spec, playerCounts: [...event.target.selectedOptions].map((option) => Number(option.value) as 2 | 3 | 4) })}><option value="2">2 players</option><option value="3">3 players</option><option value="4">4 players</option></select></label>
      <label>Starter analysis<select value={spec.starterMode} onChange={(event) => setSpec({ ...spec, starterMode: event.target.value as ExperimentSpec["starterMode"] })}><option value="natural">Natural opening rolls</option><option value="forced">Forced rotation</option><option value="natural-and-forced">Natural + forced pairs</option></select></label>
      <label><span><input type="checkbox" checked={spec.opponentRerollEnabled ?? false} onChange={(event) => setSpec({ ...spec, opponentRerollEnabled: event.target.checked })} /> Opponent rerolls</span></label>
      <label>Trace every N games<input type="number" min="0" value={spec.traceEvery ?? 0} onChange={(event) => setSpec({ ...spec, traceEvery: Number(event.target.value) || undefined })} /></label>
    </section>

    <section className="panel">
      <div className="section-title"><div><p className="eyebrow">Exact shares</p><h2>Populations</h2></div><button onClick={() => setSpec({ ...spec, populations: [...spec.populations, { id: "population-" + (spec.populations.length + 1), label: "New baseline", share: 1, source: { kind: "preset", difficulty: "medium" } }] })}>Add preset</button></div>
      <div className="population-list">{spec.populations.map((population, index) => <div className="population" key={population.id}>
        <label>Label<input value={population.label} onChange={(event) => updatePopulation(index, (item) => ({ ...item, label: event.target.value }))} /></label>
        <label>Share<input type="number" min="0.001" step="0.05" value={population.share} onChange={(event) => updatePopulation(index, (item) => ({ ...item, share: Number(event.target.value) }))} /></label>
        {population.source.kind === "preset" && <label>Preset<select value={population.source.difficulty} onChange={(event) => updatePopulation(index, (item) => ({ ...item, source: { kind: "preset", difficulty: event.target.value as BotDifficulty } }))}>{difficulties.map((difficulty) => <option key={difficulty}>{difficulty}</option>)}</select></label>}
        {population.source.kind === "random" && <label>Candidate pool<input type="number" min="1" value={population.source.candidateCount} onChange={(event) => updatePopulation(index, (item) => item.source.kind === "random" ? { ...item, source: { ...item.source, candidateCount: Number(event.target.value) } } : item)} /></label>}
        <button className="danger" onClick={() => setSpec({ ...spec, populations: spec.populations.filter((_, item) => item !== index) })}>Remove</button>
      </div>)}</div>
    </section>

    {template && <section className="panel">
      <p className="eyebrow">Generated from the central registry</p><h2>Strategy knobs</h2>
      <p className="muted">Fixed zero leaves a component enabled. Disabled sets its influence to zero and is tracked as an intentional exclusion.</p>
      <div className="component-toggles">{(Object.keys(BOT_STRATEGY_PRESETS[template.basePreset].components) as Array<keyof BotStrategyConfig["components"]>).map((key) => <label key={key}><input type="checkbox" checked={template.componentOverrides?.[key] ?? BOT_STRATEGY_PRESETS[template.basePreset].components[key]} onChange={(event) => updateComponent(key, event.target.checked)} />{key}</label>)}</div>
      <div className="knob-table">{STRATEGY_KNOBS.map((knob) => {
        const setting = template.knobs[knob.path] ?? { mode: "existing" as const };
        return <div className="knob" key={knob.path}>
          <div><strong>{knob.label}</strong><small>{knob.description}</small></div>
          <select value={setting.mode} onChange={(event) => updateKnob(knob.path, event.target.value as StrategyKnobMode, setting.value, setting.min, setting.max)}>
            <option value="existing">Existing</option><option value="fixed">Fixed</option><option value="random">Random</option>{knob.canDisable && <option value="disabled">Disabled</option>}
          </select>
          {setting.mode === "fixed" && <input type="number" step={knob.step} min={knob.min} max={knob.max} value={setting.value ?? BOT_STRATEGY_PRESETS[template.basePreset].weights[knob.path.split(".")[1] as keyof typeof BOT_STRATEGY_PRESETS.hard.weights] ?? 0} onChange={(event) => updateKnob(knob.path, "fixed", Number(event.target.value))} />}
          {setting.mode === "random" && <div className="range"><input type="number" value={setting.min ?? knob.min} onChange={(event) => updateKnob(knob.path, "random", undefined, Number(event.target.value), setting.max ?? knob.max)} /><span>to</span><input type="number" value={setting.max ?? knob.max} onChange={(event) => updateKnob(knob.path, "random", undefined, setting.min ?? knob.min, Number(event.target.value))} /></div>}
        </div>;
      })}</div>
    </section>}

    {progress && <section className="panel progress"><progress value={progress.completed} max={progress.total}/><strong>{progress.completed} / {progress.total}</strong><span>{progress.gamesPerSecond.toFixed(2)} games/s</span><span>ETA {formatMs(progress.etaMs)}</span></section>}
    {error && <p className="error">{error}</p>}
    {run && <Reports run={run} comparison={comparisonRun} report={report} setReport={setReport} />}
    <ScenarioInspector />
    <section className="panel"><div className="section-title"><h2>Saved local runs</h2><button onClick={async () => setHistory(await listRuns())}>Refresh</button></div>{history.length ? history.map((item) => <div className="history-run" key={item.id}><span>{item.name} · {item.games} games</span><button onClick={async () => setRun(await loadRun(item.id))}>Open</button><button onClick={async () => setComparisonRun(await loadRun(item.id))}>Compare</button></div>) : <p className="muted">Runs are stored in IndexedDB on this device.</p>}</section>
  </main>;
}

function Reports({ run, comparison, report, setReport }: { run: ExperimentRun; comparison?: ExperimentRun; report: string; setReport: (value: string) => void }) {
  const tabs = ["overview", "matchups", "first-player", "player-count", "luck-skill", "situational", "optimization", "replay"];
  return <section className="panel">
    <nav className="tabs">{tabs.map((tab) => <button className={tab === report ? "active" : ""} onClick={() => setReport(tab)} key={tab}>{tab}</button>)}</nav>
    {report === "overview" && <><div className="stat-grid"><Stat label="Completed" value={String(run.summary.completedGames)} /><Stat label="Throughput" value={run.summary.gamesPerSecond.toFixed(2) + "/s"} /><Stat label="Avg turns" value={run.summary.averageTurns.toFixed(1)} /><Stat label="Upsets" value={percent(run.summary.upsetRate.rate)} /></div><RateTable rates={run.summary.strategyWinRates} />{comparison && <Comparison current={run} previous={comparison} />}</>}
    {report === "matchups" && <RateTable rates={run.summary.matchups} />}
    {report === "first-player" && <><div className="stat-grid"><Stat label="Natural starter" value={percent(run.summary.starter.naturalStarterWinRate.rate)} /><Stat label="Forced starter" value={percent(run.summary.starter.forcedStarterWinRate.rate)} /><Stat label="Opening tie rounds" value={percent(run.summary.starter.openingTieRoundRate)} /><Stat label="Seed sensitivity" value={percent(run.summary.seedSensitivity)} /></div><RateTable rates={run.summary.starter.strategyInteraction} /></>}
    {report === "player-count" && Object.entries(run.summary.playerCountWinRates).map(([count, rates]) => <div key={count}><h3>{count} players</h3><RateTable rates={rates} /></div>)}
    {report === "luck-skill" && <><div className="stat-grid"><Stat label="Strategy spread" value={percent(run.summary.luckSkill.strategySpread)} /><Stat label="Natural starter lift" value={percent(run.summary.luckSkill.naturalStarterLift)} /><Stat label="Forced starter lift" value={percent(run.summary.luckSkill.forcedStarterLift)} /><Stat label="Seed sensitivity" value={percent(run.summary.seedSensitivity)} /><Stat label="Upset rate" value={percent(run.summary.upsetRate.rate)} /></div><p>Forced-starter paired bootstrap: {percent(run.summary.luckSkill.forcedStarterBootstrap.mean)} ({percent(run.summary.luckSkill.forcedStarterBootstrap.low)}–{percent(run.summary.luckSkill.forcedStarterBootstrap.high)}). Equal-strategy experiments provide the luck/seat baseline; mixed leagues measure strategy lift.</p></>}
    {report === "situational" && (Object.keys(run.summary.situationalWinRates).length ? <RateTable rates={run.summary.situationalWinRates} /> : <p>Enable decision traces to inspect occupancy, remaining dice, action credits, tray diversity, legal candidates, and component scores at sampled states.</p>)}
    {report === "optimization" && <p>Use the CLI optimize command for successive halving and isolated holdout rankings. Recommended configurations are emitted as importable JSON and are never promoted automatically.</p>}
    {report === "replay" && <Replay run={run} />}
  </section>;
}

function Comparison({ current, previous }: { current: ExperimentRun; previous: ExperimentRun }) {
  const ids = [...new Set([...Object.keys(current.summary.strategyWinRates), ...Object.keys(previous.summary.strategyWinRates)])];
  return <div><h3>Compared with {previous.spec.name}</h3><table><thead><tr><th>Configuration</th><th>Current</th><th>Previous</th><th>Delta</th></tr></thead><tbody>{ids.map((id) => {
    const now = current.summary.strategyWinRates[id]?.rate ?? 0;
    const before = previous.summary.strategyWinRates[id]?.rate ?? 0;
    return <tr key={id}><td>{id}</td><td>{percent(now)}</td><td>{percent(before)}</td><td>{percent(now - before)}</td></tr>;
  })}</tbody></table></div>;
}

function ScenarioInspector() {
  const initial = useMemo(() => completeOpeningRoll(newGame({ playerCount: 2, seed: "scenario", skipOpeningRoll: true })), []);
  const [text, setText] = useState(JSON.stringify(initial, null, 2));
  const [difficulty, setDifficulty] = useState<BotDifficulty>("hard");
  const [trace, setTrace] = useState("");
  function inspect() {
    try { setTrace(JSON.stringify(chooseBotDecision(JSON.parse(text) as GameState, difficulty, { enabled: true }).trace, null, 2)); }
    catch (error) { setTrace(error instanceof Error ? error.message : String(error)); }
  }
  return <section className="panel"><p className="eyebrow">Identical-position comparison</p><h2>Scenario inspector</h2><div className="scenario"><textarea value={text} onChange={(event) => setText(event.target.value)} /><div><select value={difficulty} onChange={(event) => setDifficulty(event.target.value as BotDifficulty)}>{difficulties.map((item) => <option key={item}>{item}</option>)}</select><button className="primary" onClick={inspect}>Inspect decision</button><pre>{trace || "Decision scores will appear here."}</pre></div></div></section>;
}

function Replay({ run }: { run: ExperimentRun }) {
  const traced = run.results.find((result) => result.actionLog?.length);
  if (!traced) return <p>No trace was sampled. Set “Trace every N games” to a smaller number.</p>;
  return <div className="replay">{traced.actionLog?.map((record) => <details key={record.actionIndex}><summary>#{record.actionIndex + 1} · turn {record.turnNumber} · {record.strategyId} · {record.action.type}</summary><pre>{JSON.stringify(record, null, 2)}</pre></details>)}</div>;
}
function RateTable({ rates }: { rates: Record<string, { wins: number; games: number; rate: number; low: number; high: number }> }) {
  return <table><thead><tr><th>Configuration</th><th>Win rate</th><th>95% CI</th><th>Sample</th></tr></thead><tbody>{Object.entries(rates).sort((a, b) => b[1].rate - a[1].rate).map(([id, rate]) => <tr key={id}><td>{id}</td><td>{percent(rate.rate)}</td><td>{percent(rate.low)}–{percent(rate.high)}</td><td>{rate.wins}/{rate.games}</td></tr>)}</tbody></table>;
}
function Stat({ label, value }: { label: string; value: string }) { return <div className="stat"><small>{label}</small><strong>{value}</strong></div>; }
function percent(value: number) { return (value * 100).toFixed(1) + "%"; }
function formatMs(value?: number) { if (value === undefined) return "—"; const seconds = Math.round(value / 1000); return Math.floor(seconds / 60) + "m " + (seconds % 60) + "s"; }
function downloadValue(value: unknown, filename: string) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url); }
function openDb(): Promise<IDBDatabase> { return new Promise((resolveDb, reject) => { const request = indexedDB.open("disuko-botlab", 1); request.onupgradeneeded = () => request.result.createObjectStore("runs", { keyPath: "spec.id" }); request.onsuccess = () => resolveDb(request.result); request.onerror = () => reject(request.error); }); }
async function saveRun(run: ExperimentRun) { const db = await openDb(); await new Promise<void>((resolveTx, reject) => { const tx = db.transaction("runs", "readwrite"); tx.objectStore("runs").put(run); tx.oncomplete = () => resolveTx(); tx.onerror = () => reject(tx.error); }); db.close(); }
async function loadRun(id: string): Promise<ExperimentRun> { const db = await openDb(); const run = await new Promise<ExperimentRun>((resolveRun, reject) => { const request = db.transaction("runs").objectStore("runs").get(id); request.onsuccess = () => resolveRun(request.result); request.onerror = () => reject(request.error); }); db.close(); return run; }
async function listRuns() { const db = await openDb(); const runs = await new Promise<ExperimentRun[]>((resolveRuns, reject) => { const request = db.transaction("runs").objectStore("runs").getAll(); request.onsuccess = () => resolveRuns(request.result); request.onerror = () => reject(request.error); }); db.close(); return runs.map((run) => ({ id: run.spec.id, name: run.spec.name, games: run.results.length })); }

createRoot(document.getElementById("botlab-root")!).render(<StrictMode><App /></StrictMode>);
