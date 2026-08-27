import type { BotAction } from "../game/bot";
import type { BotDecisionTrace } from "../game/botDecision";
import type { BotStrategyConfig, StrategyTemplate } from "../game/botStrategy";
import type { BotDifficulty, CompletionKind, GameState } from "../game/types";

export type PlayerCount = 2 | 3 | 4;
export type StarterMode = "natural" | "forced" | "natural-and-forced";

export type PopulationSource =
  | { kind: "preset"; difficulty: BotDifficulty }
  | { kind: "fixed"; strategy: BotStrategyConfig }
  | { kind: "random"; template: StrategyTemplate; candidateCount: number }
  | { kind: "saved"; strategies: BotStrategyConfig[] };

export interface PopulationSpec {
  id: string;
  label: string;
  share: number;
  source: PopulationSource;
}

export interface ExperimentSpec {
  version: 1;
  id: string;
  name: string;
  games: number;
  playerCounts: PlayerCount[];
  opponentRerollEnabled?: boolean;
  seed: string;
  seedStart?: number;
  starterMode: StarterMode;
  populations: PopulationSpec[];
  concurrency?: number;
  maxTurns?: number;
  maxActionsPerTurn?: number;
  maxTotalActions?: number;
  maxRepeatedStates?: number;
  maxTraceActions?: number;
  traceEvery?: number;
  maxRuntimeMs?: number;
  seatRotation?: boolean;
  tags?: string[];
}

export interface ResolvedPopulation {
  id: string;
  label: string;
  share: number;
  strategies: BotStrategyConfig[];
}

export interface ScheduledSeat {
  seat: number;
  populationId: string;
  strategy: BotStrategyConfig;
}

export interface ScheduledGame {
  index: number;
  pairGroup: string;
  seed: string;
  playerCount: PlayerCount;
  starter: "natural" | number;
  seats: ScheduledSeat[];
  trace: boolean;
}

export interface ActionRecord {
  actionIndex: number;
  turnNumber: number;
  playerId: string;
  seat: number;
  strategyId: string;
  action: BotAction;
  completedKinds: CompletionKind[];
  actionCreditsBefore: number;
  actionCreditsAfter: number;
  remainingDiceAfter: number;
  boardOccupancy: number;
  trace?: BotDecisionTrace;
}

export interface GameMetrics {
  placements: number;
  moves: number;
  rerolls: number;
  challenges: number;
  passes: number;
  actionCreditsEarned: number;
  completionKinds: Record<CompletionKind, number>;
}

export interface GameResult {
  index: number;
  pairGroup: string;
  seed: string;
  playerCount: PlayerCount;
  starterMode: "natural" | "forced";
  starterSeat: number;
  naturalStarterSeat: number;
  openingRollRounds: number;
  openingTieRounds: number;
  seats: Array<{
    seat: number;
    playerId: string;
    populationId: string;
    strategyId: string;
    strategyHash: string;
    remainingDice: number;
  }>;
  winnerSeat?: number;
  winnerStrategyId?: string;
  turns: number;
  actions: number;
  metrics: GameMetrics;
  durationMs: number;
  terminationReason: "won" | "turn-cap" | "action-cap" | "total-action-cap" | "repeated-state" | "runtime-cap" | "stalled";
  traceTruncated?: boolean;
  actionLog?: ActionRecord[];
  finalState?: GameState;
}

export interface ExperimentProgress {
  completed: number;
  total: number;
  gamesPerSecond: number;
  etaMs?: number;
  latest?: GameResult;
}

export interface RateEstimate {
  wins: number;
  games: number;
  rate: number;
  low: number;
  high: number;
}

export interface ExperimentSummary {
  experimentId: string;
  games: number;
  completedGames: number;
  totalDurationMs: number;
  gamesPerSecond: number;
  strategyWinRates: Record<string, RateEstimate>;
  populationWinRates: Record<string, RateEstimate>;
  playerCountWinRates: Record<string, Record<string, RateEstimate>>;
  seatWinRates: Record<string, RateEstimate>;
  starter: {
    naturalStarterWinRate: RateEstimate;
    forcedStarterWinRate: RateEstimate;
    openingTieRoundRate: number;
    byPlayerCount: Record<string, RateEstimate>;
    strategyInteraction: Record<string, RateEstimate>;
  };
  matchups: Record<string, RateEstimate>;
  situationalWinRates: Record<string, RateEstimate>;
  upsetRate: RateEstimate;
  seedSensitivity: number;
  luckSkill: {
    strategySpread: number;
    naturalStarterLift: number;
    forcedStarterLift: number;
    forcedStarterBootstrap: { mean: number; low: number; high: number };
  };
  averageTurns: number;
  averageActions: number;
  terminationReasons: Record<string, number>;
  actionTotals: GameMetrics;
  warnings: string[];
}

export interface ExperimentRun {
  spec: ExperimentSpec;
  populations: ResolvedPopulation[];
  schedule: ScheduledGame[];
  results: GameResult[];
  summary: ExperimentSummary;
}

export interface OptimizationSpec {
  experiment: ExperimentSpec;
  budget: number;
  candidatePopulationId: string;
  rounds?: number;
  holdoutShare?: number;
}

export interface OptimizationResult {
  budget: number;
  gamesUsed: number;
  rounds: Array<{ round: number; candidates: number; games: number; survivors: string[] }>;
  ranking: Array<{
    strategy: BotStrategyConfig;
    games: number;
    wins: number;
    winRate: number;
    confidenceLow: number;
    confidenceHigh: number;
  }>;
  holdoutSeeds: string[];
}
