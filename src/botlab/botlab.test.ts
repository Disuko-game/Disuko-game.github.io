import { describe, expect, it } from "vitest";
import { analyzeResults, wilson, pairedBootstrap } from "./analytics";
import { buildHtmlReport } from "./htmlReport";
import { optimizeExperiment } from "./optimizer";
import { buildSchedule, resolvePopulations, scheduleFingerprint } from "./scheduler";
import { simulateGame } from "./simulator";
import type { ExperimentSpec } from "./types";

function baselineSpec(overrides: Partial<ExperimentSpec> = {}): ExperimentSpec {
  return {
    version: 1,
    id: "test-run",
    name: "Test run",
    games: 12,
    playerCounts: [2],
    seed: "botlab-test",
    starterMode: "natural-and-forced",
    seatRotation: true,
    maxTurns: 300,
    maxActionsPerTurn: 32,
    populations: [
      { id: "easy", label: "Easy", share: 0.5, source: { kind: "preset", difficulty: "very-easy" } },
      { id: "hard", label: "Hard", share: 0.5, source: { kind: "preset", difficulty: "easy" } }
    ],
    ...overrides
  };
}

describe("bot laboratory scheduler", () => {
  it("schedules exactly the requested games with exact shares and balanced two-player matchups", () => {
    const spec = baselineSpec({ games: 100 });
    const schedule = buildSchedule(spec);
    expect(schedule).toHaveLength(100);
    expect(schedule.every((game) => new Set(game.seats.map((seat) => seat.populationId)).size === 2)).toBe(true);
    const seats = schedule.flatMap((game) => game.seats);
    expect(seats.filter((seat) => seat.populationId === "easy")).toHaveLength(100);
    expect(seats.filter((seat) => seat.populationId === "hard")).toHaveLength(100);
    expect(seats.filter((seat) => seat.populationId === "easy" && seat.seat === 0)).toHaveLength(50);
  });

  it("rotates natural and every forced starter in paired groups", () => {
    const schedule = buildSchedule(baselineSpec({ games: 6 }));
    expect(schedule.map((game) => game.starter)).toEqual(["natural", 0, 1, "natural", 0, 1]);
    expect(schedule.slice(0, 3).map((game) => game.seed)).toEqual(["botlab-test-2p-0", "botlab-test-2p-0", "botlab-test-2p-0"]);
  });

  it("covers natural and every forced starter for three- and four-player games", () => {
    for (const playerCount of [3, 4] as const) {
      const schedule = buildSchedule(baselineSpec({
        games: playerCount + 1,
        playerCounts: [playerCount],
        populations: [{ id: "all", label: "All", share: 1, source: { kind: "preset", difficulty: "very-easy" } }]
      }));
      expect(schedule.map((game) => game.starter)).toEqual(["natural", ...Array.from({ length: playerCount }, (_, seat) => seat)]);
      expect(new Set(schedule.map((game) => game.seed)).size).toBe(1);
    }
  });

  it("keeps paired starter cycles independent when player counts are mixed", () => {
    const schedule = buildSchedule(baselineSpec({ games: 12, playerCounts: [2, 3, 4], populations: [{ id: "all", label: "All", share: 1, source: { kind: "preset", difficulty: "very-easy" } }] }));
    const twoPlayer = schedule.filter((game) => game.playerCount === 2);
    expect(twoPlayer.slice(0, 3).map((game) => game.starter)).toEqual(["natural", 0, 1]);
    expect(new Set(twoPlayer.slice(0, 3).map((game) => game.seed)).size).toBe(1);
  });

  it("is deterministic and rejects malformed population shares", () => {
    const spec = baselineSpec();
    expect(scheduleFingerprint(buildSchedule(spec))).toBe(scheduleFingerprint(buildSchedule(spec)));
    expect(() => resolvePopulations({ ...spec, populations: [] })).toThrow();
  });
});

describe("bot laboratory simulation and statistics", () => {
  it("passes the opponent-reroll option into simulated games", () => {
    const game = buildSchedule(baselineSpec({ games: 1, traceEvery: 1 }))[0];
    const result = simulateGame(game, {
      maxTurns: 1,
      maxActionsPerTurn: 1,
      maxTotalActions: 1,
      maxRepeatedStates: 1,
      opponentRerollEnabled: true
    });

    expect(result.finalState?.opponentRerollEnabled).toBe(true);
  });


  it("reproduces every action and winner from a scheduled seed", () => {
    const game = buildSchedule(baselineSpec({ games: 1, traceEvery: 1 }))[0];
    const first = simulateGame(game, { maxTurns: 300, maxActionsPerTurn: 32 });
    const second = simulateGame(game, { maxTurns: 300, maxActionsPerTurn: 32 });
    expect({ ...second, durationMs: 0 }).toEqual({ ...first, durationMs: 0 });
    expect(first.actionLog?.length).toBe(first.actions);
  });
  it("stops runaway games deterministically and bounds sampled traces", () => {
    const game = buildSchedule(baselineSpec({ games: 1, traceEvery: 1 }))[0];
    const limits = { maxTurns: 300, maxActionsPerTurn: 32, maxTotalActions: 2, maxRepeatedStates: 99, maxTraceActions: 1 };
    const first = simulateGame(game, limits);
    const second = simulateGame(game, limits);
    expect(first.terminationReason).toBe("total-action-cap");
    expect(first.actions).toBe(2);
    expect(first.actionLog).toHaveLength(1);
    expect(first.traceTruncated).toBe(true);
    expect({ ...second, durationMs: 0 }).toEqual({ ...first, durationMs: 0 });
  });

  it("does not allocate an action log for untraced games", () => {
    const game = buildSchedule(baselineSpec({ games: 1, traceEvery: undefined }))[0];
    const result = simulateGame(game, { maxTotalActions: 10 });
    expect(result.actionLog).toBeUndefined();
  });
  it("builds a self-contained CLI report with every dashboard view and sampled replay data", () => {
    const spec = baselineSpec({ games: 1, name: "<Unsafe report>" });
    const game = buildSchedule({ ...spec, traceEvery: 1 })[0];
    const result = simulateGame(game, { maxTotalActions: 2, maxTraceActions: 2 });
    const html = buildHtmlReport(spec, analyzeResults(spec.id, [result]), [result]);
    for (const tab of ["overview", "matchups", "first-player", "player-count", "luck-skill", "situational", "optimization", "replay"]) {
      expect(html).toContain('data-tab="' + tab + '"');
    }
    expect(html).toContain("&lt;Unsafe report&gt;");
    expect(html).not.toContain("__REPORT_DATA__");
    const embedded = html.match(/id="report-data">([^<]+)<\/script>/)?.[1];
    const payload = JSON.parse(embedded ?? "{}") as { traces?: Array<Record<string, unknown>> };
    expect(payload.traces?.[0]).toHaveProperty("actionLog");
    expect(payload.traces?.[0]).not.toHaveProperty("finalState");
  });

  it("computes Wilson and paired bootstrap intervals from synthetic fixtures", () => {
    const estimate = wilson(60, 100);
    expect(estimate.rate).toBe(0.6);
    expect(estimate.low).toBeLessThan(0.6);
    expect(estimate.high).toBeGreaterThan(0.6);
    expect(pairedBootstrap([1, 1, -1, 1], 42, 500)).toEqual(pairedBootstrap([1, 1, -1, 1], 42, 500));
  });

  it("uses exactly the requested optimization game budget", async () => {
    const experiment = baselineSpec({
      games: 8,
      populations: [
        { id: "candidates", label: "Candidates", share: 1, source: { kind: "random", candidateCount: 4, template: {
          idPrefix: "random", labelPrefix: "Random", basePreset: "very-easy", policy: "weighted-random",
          knobs: { "randomActionWeights.place": { mode: "random", min: 0.2, max: 1 } }
        } } }
      ]
    });
    const result = await optimizeExperiment({ experiment, budget: 8, candidatePopulationId: "candidates", rounds: 2, holdoutShare: 0.25 });
    expect(result.gamesUsed).toBe(8);
    expect(result.ranking.length).toBeGreaterThan(0);
    const tiny = await optimizeExperiment({ experiment, budget: 4, candidatePopulationId: "candidates", holdoutShare: 0.25 });
    expect(tiny.gamesUsed).toBe(4);
  });
});
