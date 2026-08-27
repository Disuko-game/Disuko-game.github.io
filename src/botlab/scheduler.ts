import { generateStrategyCandidates, resolveBotStrategy, strategyHash } from "../game/botStrategy";
import type {
  ExperimentSpec, PlayerCount, ResolvedPopulation, ScheduledGame, ScheduledSeat
} from "./types";

export function resolvePopulations(spec: ExperimentSpec): ResolvedPopulation[] {
  validateExperimentSpec(spec);
  return spec.populations.map((population) => {
    let strategies;
    if (population.source.kind === "preset") {
      strategies = [resolveBotStrategy(population.source.difficulty)];
    } else if (population.source.kind === "fixed") {
      strategies = [resolveBotStrategy(population.source.strategy)];
    } else if (population.source.kind === "saved") {
      strategies = population.source.strategies.map(resolveBotStrategy);
    } else {
      strategies = generateStrategyCandidates(
        population.source.template,
        population.source.candidateCount,
        spec.seed + "|" + population.id
      );
    }
    if (strategies.length === 0) throw new Error("Population " + population.id + " has no strategies.");
    return { id: population.id, label: population.label, share: population.share, strategies };
  });
}

export function buildSchedule(spec: ExperimentSpec, resolved = resolvePopulations(spec)): ScheduledGame[] {
  const totalSeats = Array.from({ length: spec.games }, (_, index) =>
    spec.playerCounts[index % spec.playerCounts.length]
  ).reduce((sum, count) => sum + count, 0);
  const quotas = exactQuotas(totalSeats, resolved.map((population) => population.share));
  const tickets = weightedTicketSequence(resolved, quotas, spec.seed);

  const schedule: ScheduledGame[] = [];
  const occurrences = new Map<PlayerCount, number>();
  let ticketCursor = 0;
  for (let index = 0; index < spec.games; index += 1) {
    const playerCount = spec.playerCounts[index % spec.playerCounts.length] as PlayerCount;
    const occurrence = occurrences.get(playerCount) ?? 0;
    occurrences.set(playerCount, occurrence + 1);
    const variant = starterVariant(spec.starterMode, playerCount, occurrence);
    const rotation = spec.seatRotation === false ? 0 : occurrence % playerCount;
    const rawSeats = Array.from({ length: playerCount }, () => tickets[ticketCursor++])
      .sort((left, right) => left.population.id.localeCompare(right.population.id) || left.ticketIndex - right.ticketIndex);
    const seats: ScheduledSeat[] = rawSeats.map((ticket, rawSeat) => ({
      seat: (rawSeat + rotation) % playerCount,
      populationId: ticket.population.id,
      strategy: ticket.strategy
    })).sort((left, right) => left.seat - right.seat);
    const baseIndex = spec.starterMode === "natural-and-forced"
      ? Math.floor(occurrence / (playerCount + 1))
      : occurrence;
    schedule.push({
      index,
      pairGroup: playerCount + "p-" + baseIndex,
      seed: spec.seed + "-" + playerCount + "p-" + ((spec.seedStart ?? 0) + baseIndex),
      playerCount,
      starter: variant,
      seats,
      trace: Boolean(spec.traceEvery && index % spec.traceEvery === 0)
    });
  }
  return schedule;
}

export function validateExperimentSpec(spec: ExperimentSpec): void {
  if (spec.version !== 1) throw new Error("Unsupported experiment version.");
  if (!Number.isInteger(spec.games) || spec.games <= 0) throw new Error("games must be a positive integer.");
  if (!spec.playerCounts.length || spec.playerCounts.some((count) => ![2, 3, 4].includes(count))) {
    throw new Error("playerCounts must contain 2, 3, or 4.");
  }
  if (!spec.populations.length || spec.populations.some((population) => population.share <= 0)) {
    throw new Error("Every population needs a positive share.");
  }
  const share = spec.populations.reduce((sum, population) => sum + population.share, 0);
  if (!Number.isFinite(share) || share <= 0) throw new Error("Population shares are invalid.");
  if ((spec.maxTurns ?? 1000) < 1 || (spec.maxActionsPerTurn ?? 64) < 1
    || (spec.maxTotalActions ?? 2000) < 1 || (spec.maxRepeatedStates ?? 3) < 1
    || (spec.maxTraceActions ?? 250) < 1) {
    throw new Error("Safety limits must be positive.");
  }
  if (spec.maxRuntimeMs !== undefined && spec.maxRuntimeMs < 1) {
    throw new Error("maxRuntimeMs must be positive when specified.");
  }
}

export function scheduleFingerprint(schedule: ScheduledGame[]): string {
  return stableHash(schedule.map((game) => [
    game.index, game.seed, game.playerCount, game.starter,
    ...game.seats.map((seat) => seat.populationId + ":" + strategyHash(seat.strategy))
  ].join("|")).join("\n")).toString(16);
}

function starterVariant(mode: ExperimentSpec["starterMode"], playerCount: PlayerCount, index: number): "natural" | number {
  if (mode === "natural") return "natural";
  if (mode === "forced") return index % playerCount;
  const position = index % (playerCount + 1);
  return position === 0 ? "natural" : position - 1;
}

function weightedTicketSequence(resolved: ResolvedPopulation[], quotas: number[], seed: string) {
  const total = quotas.reduce((sum, value) => sum + value, 0);
  const shares = resolved.map((population) => population.share);
  const shareTotal = shares.reduce((sum, value) => sum + value, 0);
  const used = resolved.map(() => 0);
  return Array.from({ length: total }, (_, seatIndex) => {
    const candidates = resolved.map((population, index) => ({
      index,
      deficit: (seatIndex + 1) * shares[index] / shareTotal - used[index],
      tie: stableHash(seed + "|" + seatIndex + "|" + population.id)
    })).filter(({ index }) => used[index] < quotas[index])
      .sort((left, right) => right.deficit - left.deficit || left.tie - right.tie);
    const selected = candidates[0].index;
    const ticketIndex = used[selected]++;
    const population = resolved[selected];
    return {
      population,
      strategy: population.strategies[ticketIndex % population.strategies.length],
      ticketIndex
    };
  });
}

function exactQuotas(total: number, shares: number[]): number[] {
  const shareTotal = shares.reduce((sum, share) => sum + share, 0);
  const raw = shares.map((share) => total * share / shareTotal);
  const quotas = raw.map(Math.floor);
  let remaining = total - quotas.reduce((sum, value) => sum + value, 0);
  raw.map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .forEach(({ index }) => { if (remaining-- > 0) quotas[index] += 1; });
  return quotas;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
