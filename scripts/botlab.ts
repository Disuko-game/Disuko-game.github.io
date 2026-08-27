import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { execFileSync } from "node:child_process";
import { analyzeResults } from "../src/botlab/analytics";
import { optimizeExperiment } from "../src/botlab/optimizer";
import { buildHtmlReport } from "../src/botlab/htmlReport";
import { buildSchedule, resolvePopulations, scheduleFingerprint } from "../src/botlab/scheduler";
import type { BotStrategyConfig } from "../src/game/botStrategy";
import { simulateGame } from "../src/botlab/simulator";
import type { ExperimentSpec, GameResult, OptimizationSpec, ScheduledGame } from "../src/botlab/types";

const args = process.argv.slice(2);
const command = args[0] ?? "help";

if (command === "run") await runCommand();
else if (command === "compare") await compareCommand();
else if (command === "optimize") await optimizeCommand();
else if (command === "analyze") await analyzeCommand();
else if (command === "benchmark") await benchmarkCommand();
else printHelp();

async function runCommand(): Promise<void> {
  const specPath = required("--spec");
  const parsed = JSON.parse(await readFile(resolve(specPath), "utf8")) as ExperimentSpec;
  const gamesOverride = integerOption("--games");
  const concurrencyOverride = integerOption("--concurrency");
  const spec = {
    ...parsed,
    games: gamesOverride ?? parsed.games,
    concurrency: concurrencyOverride ?? parsed.concurrency
  };
  const populations = resolvePopulations(spec);
  const schedule = buildSchedule(spec, populations);
  const runId = option("--run-id") ?? safeId(spec.id + "-" + new Date().toISOString());
  const runDir = resolve(".botlab", "runs", runId);
  await mkdir(runDir, { recursive: true });
  const resultsPath = join(runDir, "games.jsonl");
  const existing = hasFlag("--resume") ? await readJsonLines(resultsPath) : [];
  const completed = new Set(existing.map((result) => result.index));
  const pending = schedule.filter((game) => !completed.has(game.index));
  const results = [...existing];
  const started = performance.now();
  let lastCheckpoint = existing.length;
  const ready = new Map<number, GameResult>();
  let pendingCursor = 0;
  let flushChain = Promise.resolve();

  await writeJson(join(runDir, "experiment.json"), spec);
  await writeJson(join(runDir, "populations.json"), populations);
  await writeJson(join(runDir, "manifest.json"), {
    artifactVersion: 1,
    runId,
    createdAt: new Date().toISOString(),
    gitCommit: gitCommit(),
    engineVersion: 1,
    node: process.version,
    scheduleFingerprint: scheduleFingerprint(schedule),
    totalGames: schedule.length,
    populationSeatCounts: Object.fromEntries(populations.map((population) => [population.id, schedule.flatMap((game) => game.seats).filter((seat) => seat.populationId === population.id).length])),
    resumedGames: existing.length
  });

  const concurrency = Math.max(1, Math.min(spec.concurrency ?? Math.max(1, cpus().length - 1), pending.length || 1));
  await executeGames(pending, spec, concurrency, async (result) => {
    ready.set(result.index, result);
    flushChain = flushChain.then(async () => {
      while (pendingCursor < pending.length) {
        const next = ready.get(pending[pendingCursor].index);
        if (!next) break;
        ready.delete(next.index);
        pendingCursor += 1;
        results.push(next);
        await appendFile(resultsPath, JSON.stringify(next) + "\n");
        const completedCount = results.length;
        const elapsed = Math.max(1, performance.now() - started);
        const rate = (completedCount - existing.length) * 1000 / elapsed;
        const eta = rate > 0 ? (schedule.length - completedCount) / rate : 0;
        process.stdout.write("\r" + completedCount + "/" + schedule.length + "  " + rate.toFixed(2) + " games/s  ETA " + formatDuration(eta * 1000) + "   ");
        if (completedCount - lastCheckpoint >= 25) {
          lastCheckpoint = completedCount;
          await writeJson(join(runDir, "checkpoint.json"), { completed: completedCount, total: schedule.length, updatedAt: new Date().toISOString() });
        }
      }
    });
    await flushChain;
  });
  await flushChain;
  process.stdout.write("\n");

  results.sort((a, b) => a.index - b.index);
  const summary = analyzeResults(spec.id, results);
  await writeJson(join(runDir, "summary.json"), summary);
  await writeFile(join(runDir, "summary.csv"), summaryCsv(summary), "utf8");
  await writeFile(join(runDir, "report.html"), buildHtmlReport(spec, summary, results), "utf8");
  await writeJson(join(runDir, "checkpoint.json"), { completed: results.length, total: schedule.length, complete: results.length === schedule.length });
  console.log("Run artifacts: " + runDir);
}

async function compareCommand(): Promise<void> {
  const recommendationsPath = resolve(required("--recommendations"));
  const recommendations = JSON.parse(await readFile(recommendationsPath, "utf8")) as BotStrategyConfig[];
  const rank = integerOption("--rank") ?? 1;
  const candidate = recommendations[rank - 1];
  if (!candidate) throw new Error("--rank exceeds the number of recommended configurations.");

  const totalGames = integerOption("--games") ?? 1200;
  const presets = ["very-easy", "easy", "medium", "hard"] as const;
  const baseGames = Math.floor(totalGames / presets.length);
  let remainder = totalGames % presets.length;
  const allocations = presets.map((difficulty) => ({
    difficulty,
    games: baseGames + (remainder-- > 0 ? 1 : 0)
  }));
  if (allocations.some((allocation) => allocation.games < 1)) {
    throw new Error("Comparison needs at least one game per preset.");
  }
  if (allocations.some((allocation) => allocation.games % 3 !== 0)) {
    console.warn("For perfectly balanced natural/forced starter triplets, use a --games value divisible by 12.");
  }

  const schedules: ScheduledGame[] = [];
  const comparisonSpecs: ExperimentSpec[] = [];
  let indexOffset = 0;
  for (const allocation of allocations) {
    const comparisonSpec: ExperimentSpec = {
      version: 1,
      id: candidate.id + "-vs-" + allocation.difficulty,
      name: candidate.label + " versus " + allocation.difficulty,
      games: allocation.games,
      playerCounts: [2],
      seed: "preset-comparison-" + candidate.id + "-" + allocation.difficulty + "-v1",
      starterMode: "natural-and-forced",
      seatRotation: true,
      maxTurns: 1000,
      maxActionsPerTurn: 64,
      maxTotalActions: 2000,
      maxRepeatedStates: 3,
      maxTraceActions: 250,
      traceEvery: Math.max(1, Math.floor(allocation.games / 3)),
      populations: [
        { id: "champion", label: candidate.label, share: 0.5, source: { kind: "saved", strategies: [candidate] } },
        { id: "preset-" + allocation.difficulty, label: allocation.difficulty, share: 0.5, source: { kind: "preset", difficulty: allocation.difficulty } }
      ]
    };
    comparisonSpecs.push(comparisonSpec);
    const schedule = buildSchedule(comparisonSpec).map((game) => ({
      ...game,
      index: game.index + indexOffset,
      pairGroup: allocation.difficulty + "|" + game.pairGroup
    }));
    schedules.push(...schedule);
    indexOffset += schedule.length;
  }

  const combinedSpec: ExperimentSpec = {
    version: 1,
    id: candidate.id + "-vs-presets",
    name: candidate.label + " versus all presets",
    games: totalGames,
    playerCounts: [2],
    seed: "preset-comparison-" + candidate.id + "-v1",
    starterMode: "natural-and-forced",
    seatRotation: true,
    concurrency: integerOption("--concurrency") ?? Math.max(1, cpus().length - 1),
    maxTurns: 1000,
    maxActionsPerTurn: 64,
    maxTotalActions: 2000,
    maxRepeatedStates: 3,
    maxTraceActions: 250,
    populations: [
      { id: "champion", label: candidate.label, share: 4, source: { kind: "saved", strategies: [candidate] } },
      ...presets.map((difficulty) => ({
        id: "preset-" + difficulty,
        label: difficulty,
        share: 1,
        source: { kind: "preset" as const, difficulty }
      }))
    ]
  };

  const runId = option("--run-id") ?? safeId(combinedSpec.id + "-" + new Date().toISOString());
  const runDir = resolve(".botlab", "runs", runId);
  await mkdir(runDir, { recursive: true });
  const resultsPath = join(runDir, "games.jsonl");
  const resume = hasFlag("--resume");
  const existing = resume ? await readJsonLines(resultsPath) : [];
  if (!resume) await writeFile(resultsPath, "", "utf8");
  const completedIndexes = new Set(existing.map((result) => result.index));
  const pending = schedules.filter((game) => !completedIndexes.has(game.index));
  const results = [...existing];
  const started = performance.now();

  await writeJson(join(runDir, "experiment.json"), combinedSpec);
  await writeJson(join(runDir, "comparisons.json"), {
    recommendationsPath,
    selectedRank: rank,
    candidate,
    allocations,
    experiments: comparisonSpecs
  });
  await writeJson(join(runDir, "populations.json"), resolvePopulations(combinedSpec));
  await writeJson(join(runDir, "manifest.json"), {
    artifactVersion: 1,
    runId,
    createdAt: new Date().toISOString(),
    gitCommit: gitCommit(),
    engineVersion: 1,
    node: process.version,
    scheduleFingerprint: scheduleFingerprint(schedules),
    totalGames: schedules.length,
    resumedGames: existing.length,
    comparisonType: "direct-candidate-versus-each-preset"
  });

  const concurrency = Math.max(1, Math.min(combinedSpec.concurrency ?? 1, pending.length || 1));
  await executeGames(pending, combinedSpec, concurrency, async (result) => {
    results.push(result);
    await appendFile(resultsPath, JSON.stringify(result) + "\n");
    const completed = results.length;
    const elapsed = Math.max(1, performance.now() - started);
    const rate = (completed - existing.length) * 1000 / elapsed;
    const eta = rate > 0 ? (schedules.length - completed) / rate : 0;
    process.stdout.write("\r" + completed + "/" + schedules.length + "  " + rate.toFixed(2) + " games/s  ETA " + formatDuration(eta * 1000) + "   ");
  });
  process.stdout.write("\n");

  results.sort((left, right) => left.index - right.index);
  const summary = analyzeResults(combinedSpec.id, results);
  await writeFile(resultsPath, results.map((result) => JSON.stringify(result)).join("\n") + "\n", "utf8");
  await writeJson(join(runDir, "summary.json"), summary);
  await writeFile(join(runDir, "summary.csv"), summaryCsv(summary), "utf8");
  await writeFile(join(runDir, "report.html"), buildHtmlReport(combinedSpec, summary, results), "utf8");
  await writeJson(join(runDir, "checkpoint.json"), { completed: results.length, total: schedules.length, complete: results.length === schedules.length });
  console.log("Comparison artifacts: " + runDir);
}

async function optimizeCommand(): Promise<void> {
  const specPath = required("--spec");
  const parsed = JSON.parse(await readFile(resolve(specPath), "utf8")) as ExperimentSpec & { optimization?: Partial<OptimizationSpec> };
  const budget = integerOption("--budget") ?? parsed.games;
  const candidatePopulationId = option("--population") ?? parsed.optimization?.candidatePopulationId;
  if (!candidatePopulationId) throw new Error("Optimization requires --population or optimization.candidatePopulationId.");
  const runId = option("--run-id") ?? safeId(parsed.id + "-opt-" + new Date().toISOString());
  const runDir = resolve(".botlab", "runs", runId);
  await mkdir(runDir, { recursive: true });
  const concurrency = Math.max(1, parsed.concurrency ?? Math.max(1, cpus().length - 1));
  const result = await optimizeExperiment({
    experiment: parsed,
    budget,
    candidatePopulationId,
    rounds: parsed.optimization?.rounds,
    holdoutShare: parsed.optimization?.holdoutShare
  }, (completed, total) => process.stdout.write("\r" + completed + "/" + total + " optimization games   "), undefined,
    (games, experiment, onResult) => executeGames(games, experiment, Math.min(concurrency, games.length || 1), onResult)
  );
  process.stdout.write("\n");
  await writeJson(join(runDir, "optimization.json"), result);
  await writeJson(join(runDir, "recommended-configurations.json"), result.ranking.map((entry) => entry.strategy));
  await writeFile(join(runDir, "report.html"), optimizationHtml(parsed, result), "utf8");
  console.log("Optimization artifacts: " + runDir);
}

async function analyzeCommand(): Promise<void> {
  const runId = required("--run");
  const runDir = resolve(".botlab", "runs", runId);
  const spec = JSON.parse(await readFile(join(runDir, "experiment.json"), "utf8")) as ExperimentSpec;
  const results = await readJsonLines(join(runDir, "games.jsonl"));
  const summary = analyzeResults(spec.id, results);
  await writeJson(join(runDir, "summary.json"), summary);
  await writeFile(join(runDir, "summary.csv"), summaryCsv(summary), "utf8");
  await writeFile(join(runDir, "report.html"), buildHtmlReport(spec, summary, results), "utf8");
  console.log("Analyzed " + results.length + " games in " + runDir);
}

async function benchmarkCommand(): Promise<void> {
  const gamesPerCell = integerOption("--games-per-cell") ?? 3;
  const rows: Array<{ difficulty: string; playerCount: number; games: number; gamesPerSecond: number; averageMs: number }> = [];
  for (const difficulty of ["very-easy", "easy", "medium", "hard"] as const) {
    for (const playerCount of [2, 3, 4] as const) {
      const spec: ExperimentSpec = {
        version: 1,
        id: "benchmark-" + difficulty + "-" + playerCount,
        name: "Benchmark " + difficulty + " " + playerCount + "p",
        games: gamesPerCell,
        playerCounts: [playerCount],
        seed: "benchmark-v1",
        starterMode: "natural",
        populations: [{ id: difficulty, label: difficulty, share: 1, source: { kind: "preset", difficulty } }]
      };
      const schedule = buildSchedule(spec);
      const started = performance.now();
      schedule.forEach((game) => simulateGame(game, spec));
      const duration = performance.now() - started;
      rows.push({ difficulty, playerCount, games: gamesPerCell, gamesPerSecond: gamesPerCell * 1000 / Math.max(1, duration), averageMs: duration / gamesPerCell });
    }
  }
  await mkdir(resolve(".botlab", "benchmarks"), { recursive: true });
  await writeJson(resolve(".botlab", "benchmarks", "latest.json"), { measuredAt: new Date().toISOString(), node: process.version, rows });
  console.table(rows);
}

async function executeGames(
  games: ScheduledGame[],
  spec: ExperimentSpec,
  concurrency: number,
  onResult: (result: GameResult) => Promise<void>
): Promise<void> {
  if (!games.length) return;
  if (concurrency === 1) {
    for (const game of games) await onResult(simulateGame(game, spec));
    return;
  }

  const workerCount = Math.min(concurrency, games.length);
  const limits = {
    maxTurns: spec.maxTurns,
    maxActionsPerTurn: spec.maxActionsPerTurn,
    maxTotalActions: spec.maxTotalActions,
    maxRepeatedStates: spec.maxRepeatedStates,
    maxTraceActions: spec.maxTraceActions,
    maxRuntimeMs: spec.maxRuntimeMs,
    opponentRerollEnabled: spec.opponentRerollEnabled
  };

  await new Promise<void>((resolvePool, rejectPool) => {
    const workers: Worker[] = [];
    let cursor = 0;
    let completed = 0;
    let exited = 0;
    let failed = false;

    const fail = (error: unknown) => {
      if (failed) return;
      failed = true;
      workers.forEach((worker) => void worker.terminate());
      rejectPool(error instanceof Error ? error : new Error(String(error)));
    };
    const stopPool = () => workers.forEach((worker) => worker.postMessage({ type: "stop" }));
    const dispatch = (worker: Worker) => {
      if (failed) return;
      const game = games[cursor++];
      if (game) worker.postMessage({ type: "game", game });
    };

    for (let index = 0; index < workerCount; index += 1) {
      const worker = new Worker(new URL("./botlab-worker.ts", import.meta.url), { workerData: { limits } });
      workers.push(worker);
      worker.on("message", (message: { type: string; result?: GameResult; message?: string }) => {
        if (message.type === "ready") {
          dispatch(worker);
          return;
        }
        if (message.type === "error") {
          fail(new Error(message.message ?? "Bot-lab worker failed."));
          return;
        }
        if (message.type === "result" && message.result) {
          void onResult(message.result).then(() => {
            completed += 1;
            if (completed === games.length) stopPool();
            else dispatch(worker);
          }, fail);
        }
      });
      worker.on("error", fail);
      worker.on("exit", (code) => {
        if (failed) return;
        if (code !== 0) {
          fail(new Error("Bot-lab worker exited with code " + code));
          return;
        }
        if (completed !== games.length) {
          fail(new Error("Bot-lab worker exited before completing its assigned game."));
          return;
        }
        exited += 1;
        if (exited === workerCount && completed === games.length) resolvePool();
      });
    }
  });
}

async function readJsonLines(path: string): Promise<GameResult[]> {
  try {
    const text = await readFile(path, "utf8");
    return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as GameResult);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}
function summaryCsv(summary: ReturnType<typeof analyzeResults>): string {
  const rows = [["strategy", "wins", "games", "win_rate", "ci_low", "ci_high"]];
  Object.entries(summary.strategyWinRates).forEach(([id, rate]) => rows.push([
    id, String(rate.wins), String(rate.games), String(rate.rate), String(rate.low), String(rate.high)
  ]));
  return rows.map((row) => row.join(",")).join("\n") + "\n";
}
function optimizationHtml(spec: ExperimentSpec, result: Awaited<ReturnType<typeof optimizeExperiment>>): string {
  const rows = result.ranking.map((entry) => "<tr><td>" + escapeHtml(entry.strategy.label) + "</td><td>" + pct(entry.winRate) + "</td><td>" + entry.games + "</td><td><code>" + escapeHtml(entry.strategy.id) + "</code></td></tr>").join("");
  return "<!doctype html><meta charset=utf-8><title>" + escapeHtml(spec.name) + " optimization</title><style>body{font:16px system-ui;max-width:980px;margin:40px auto;background:#1d0d06;color:#ffe4af}td,th{padding:10px;border-bottom:1px solid #754b2d}</style><h1>Optimization: " + escapeHtml(spec.name) + "</h1><p>" + result.gamesUsed + "/" + result.budget + " games used</p><table><tr><th>Configuration</th><th>Holdout win rate</th><th>Games</th><th>ID</th></tr>" + rows + "</table>";
}
function option(name: string): string | undefined { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }
function required(name: string): string { const value = option(name); if (!value) throw new Error("Missing " + name); return value; }
function integerOption(name: string): number | undefined { const value = option(name); if (!value) return undefined; const parsed = Number(value); if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(name + " must be a positive integer."); return parsed; }
function hasFlag(name: string): boolean { return args.includes(name); }
function safeId(value: string): string { return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, ""); }
function gitCommit(): string { try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } }
function pct(value: number): string { return (value * 100).toFixed(1) + "%"; }
function formatDuration(ms: number): string { const seconds = Math.max(0, Math.round(ms / 1000)); return Math.floor(seconds / 60) + "m " + (seconds % 60) + "s"; }
function escapeHtml(value: string): string { return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] as string); }
function printHelp(): void {
  console.log("Disuko Bot Laboratory\n\n  run --spec <file> [--games N] [--concurrency N] [--run-id ID] [--resume]\n  compare --recommendations <file> [--rank N] [--games N] [--concurrency N] [--run-id ID] [--resume]\n  optimize --spec <file> --budget N [--population ID]\n  analyze --run <run-id>\n  benchmark [--games-per-cell N]");
}
