import { nextRandom, seedToState } from "./rng";
import type { BotDifficulty } from "./types";

export type BotPolicy = "preset" | "weighted-random" | "greedy" | "search";

export interface BotStrategyWeights {
  placedDie: number;
  completion: number;
  retainedTurn: number;
  placementBias: number;
  unproductiveMove: number;
  reroll: number;
  opponentReroll: number;
  valueControl: number;
  pass: number;
  remainingDie: number;
  flexibility: number;
  completionOpportunity: number;
  opponentRemainingDie: number;
  opponentFlexibility: number;
  opponentOpportunity: number;
  actionCredit: number;
  ownImmediateWin: number;
  opponentImmediateWin: number;
  nextOpponentThreat: number;
  distantOpponentThreat: number;
  threatenedOpponentWin: number;
  valuePresence: number;
  lastValueReserve: number;
  nearValueSetReserve: number;
  actionBankCredit: number;
  actionBankMoveCost: number;
  actionBankMinimumAdvantage: number;
}

export interface BotSearchSettings {
  stochasticSamples: number;
  rootPrefilter: number;
  nodePrefilter: number;
  rootBeam: number;
  nodeBeam: number;
  handoffDepth: number;
  actionDepth: number;
  nodeBudget: number;
  actionBankMaxMoves: number;
}

export interface BotStrategyConfig {
  schemaVersion: 1;
  id: string;
  label: string;
  basePreset: BotDifficulty;
  policy: BotPolicy;
  baseline: boolean;
  components: {
    threatAvoidance: boolean;
    valueReserve: boolean;
    valueControl: boolean;
    actionBanking: boolean;
    flexibility: boolean;
    completionOpportunity: boolean;
  };
  randomActionWeights: { place: number; move: number; reroll: number };
  weights: BotStrategyWeights;
  search: BotSearchSettings;
  disabledKnobs: StrategyKnobPath[];
}

export type StrategyKnobPath = `weights.${keyof BotStrategyWeights}` | `search.${keyof BotSearchSettings}` | `randomActionWeights.${keyof BotStrategyConfig["randomActionWeights"]}`;
export type StrategyKnobMode = "existing" | "fixed" | "random" | "disabled";

export interface StrategyKnobSetting {
  mode: StrategyKnobMode;
  value?: number;
  min?: number;
  max?: number;
}

export interface StrategyTemplate {
  idPrefix: string;
  labelPrefix: string;
  basePreset: BotDifficulty;
  policy?: Exclude<BotPolicy, "preset">;
  componentOverrides?: Partial<BotStrategyConfig["components"]>;
  knobs: Partial<Record<StrategyKnobPath, StrategyKnobSetting>>;
}

export type BotStrategyOverrides = Partial<Omit<BotStrategyConfig,
  "schemaVersion" | "basePreset" | "weights" | "search" | "components" | "randomActionWeights"
>> & {
  weights?: Partial<BotStrategyWeights>;
  search?: Partial<BotSearchSettings>;
  components?: Partial<BotStrategyConfig["components"]>;
  randomActionWeights?: Partial<BotStrategyConfig["randomActionWeights"]>;
};

export interface StrategyKnobDefinition {
  path: StrategyKnobPath;
  label: string;
  description: string;
  group: "Evaluation" | "Threats" | "Value reserve" | "Action banking" | "Search";
  min: number;
  max: number;
  step: number;
  integer?: boolean;
  canDisable: boolean;
  policies: Array<Exclude<BotPolicy, "preset">>;
}

const DEFAULT_WEIGHTS: BotStrategyWeights = {
  placedDie: 8_000, completion: 7_000, retainedTurn: 3_000, placementBias: 750,
  unproductiveMove: -1_500, reroll: -2_500, opponentReroll: 0, valueControl: 3_000,
  pass: -8_000, remainingDie: 12_000,
  flexibility: 7, completionOpportunity: 1, opponentRemainingDie: 2_500,
  opponentFlexibility: 1.5, opponentOpportunity: 0.35, actionCredit: 500,
  ownImmediateWin: 35_000, opponentImmediateWin: 45_000, nextOpponentThreat: 18_000,
  distantOpponentThreat: 30_000, threatenedOpponentWin: 90_000, valuePresence: 700,
  lastValueReserve: 2_400, nearValueSetReserve: 1_200, actionBankCredit: 16_000,
  actionBankMoveCost: 500, actionBankMinimumAdvantage: 1_000
};

const DEFAULT_SEARCH: BotSearchSettings = {
  stochasticSamples: 8, rootPrefilter: 18, nodePrefilter: 8, rootBeam: 5,
  nodeBeam: 2, handoffDepth: 1, actionDepth: 4, nodeBudget: 12, actionBankMaxMoves: 5
};

function preset(difficulty: BotDifficulty): BotStrategyConfig {
  return {
    schemaVersion: 1,
    id: `preset-${difficulty}`,
    label: difficulty.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
    basePreset: difficulty,
    policy: "preset",
    baseline: true,
    components: {
      threatAvoidance: difficulty === "medium" || difficulty === "hard",
      valueReserve: difficulty === "medium" || difficulty === "hard",
      valueControl: difficulty === "medium" || difficulty === "hard",
      actionBanking: difficulty === "hard",
      flexibility: difficulty !== "very-easy",
      completionOpportunity: difficulty !== "very-easy"
    },
    randomActionWeights: { place: 0.7, move: 0.15, reroll: 0.15 },
    weights: { ...DEFAULT_WEIGHTS },
    search: { ...DEFAULT_SEARCH, stochasticSamples: difficulty === "medium" || difficulty === "easy" ? 6 : 8 },
    disabledKnobs: []
  };
}

export const BOT_STRATEGY_PRESETS: Readonly<Record<BotDifficulty, BotStrategyConfig>> = deepFreeze({
  "very-easy": preset("very-easy"), easy: preset("easy"), medium: preset("medium"), hard: preset("hard")
});

export const STRATEGY_KNOBS: readonly StrategyKnobDefinition[] = [
  knob("randomActionWeights.place", "Random placement share", "Weighted-random probability mass for placement.", "Evaluation", 0, 1, 0.01),
  knob("randomActionWeights.move", "Random move share", "Weighted-random probability mass for movement.", "Evaluation", 0, 1, 0.01),
  knob("randomActionWeights.reroll", "Random reroll share", "Weighted-random probability mass for rerolls.", "Evaluation", 0, 1, 0.01),
  knob("weights.placedDie", "Place a tray die", "Reward progress toward emptying the tray.", "Evaluation", 0, 24_000, 250),
  knob("weights.completion", "Complete a set", "Reward each completed set.", "Evaluation", 0, 30_000, 250),
  knob("weights.retainedTurn", "Keep the turn", "Reward completions that earn another action.", "Evaluation", 0, 20_000, 250),
  knob("weights.placementBias", "Prefer placement", "Bias toward placement.", "Evaluation", -5_000, 8_000, 100),
  knob("weights.unproductiveMove", "Unproductive move", "Score for a move that completes no set.", "Evaluation", -12_000, 4_000, 100),
  knob("weights.pass", "Pass preference", "Score applied to a forced or selected pass.", "Evaluation", -20_000, 2_000, 100),
  knob("weights.reroll", "Reroll preference", "Score applied when rerolling.", "Evaluation", -12_000, 6_000, 100),
  knob("weights.opponentReroll", "Opponent reroll incentive", "Small generic bias for opponent rerolls; values near the reroll cost can dominate tactical scoring.", "Evaluation", 0, 2_500, 100),
  knob("weights.valueControl", "Value control", "Reward exclusive control of a die value, weighted more heavily when holding several copies.", "Value reserve", 0, 5_000, 100),
  knob("weights.remainingDie", "Remaining-die pressure", "Penalty for every tray die.", "Evaluation", 0, 30_000, 250),
  knob("weights.flexibility", "Future flexibility", "Reward legal future placements.", "Evaluation", 0, 30, 0.5),
  knob("weights.completionOpportunity", "Future completions", "Scale near-completion opportunities.", "Evaluation", 0, 5, 0.1),
  knob("weights.actionCredit", "Saved actions", "Reward action credits.", "Evaluation", 0, 8_000, 100),
  knob("weights.opponentRemainingDie", "Opponent remaining dice", "Value assigned to each opponent tray die.", "Evaluation", 0, 10_000, 100),
  knob("weights.opponentFlexibility", "Opponent flexibility", "Penalty for opponent legal placements.", "Evaluation", 0, 20, 0.1),
  knob("weights.opponentOpportunity", "Opponent opportunities", "Penalty for opponent completion opportunities.", "Evaluation", 0, 5, 0.05),
  knob("weights.ownImmediateWin", "Own immediate win", "Reward for preserving an immediate winning placement.", "Evaluation", 0, 150_000, 1_000),
  knob("weights.opponentImmediateWin", "Opponent immediate win", "Penalty for an opponent winning placement.", "Threats", 0, 200_000, 1_000),
  knob("weights.nextOpponentThreat", "Next-player threat", "Penalty for enabling the next player.", "Threats", 0, 80_000, 500),
  knob("weights.distantOpponentThreat", "Other-player threat", "Penalty for enabling later opponents.", "Threats", 0, 80_000, 500),
  knob("weights.threatenedOpponentWin", "Opponent winning threat", "Extra immediate-win penalty.", "Threats", 0, 250_000, 1_000),
  knob("weights.valuePresence", "Keep value represented", "Reward retaining each value.", "Value reserve", 0, 10_000, 100),
  knob("weights.lastValueReserve", "Protect final die", "Reward keeping the final die of each value.", "Value reserve", 0, 20_000, 100),
  knob("weights.nearValueSetReserve", "Reserve near value set", "Extra reserve near a value completion.", "Value reserve", 0, 12_000, 100),
  knob("weights.actionBankCredit", "Banked-action value", "Value of credits in banking plans.", "Action banking", 0, 50_000, 500),
  knob("weights.actionBankMoveCost", "Banking move cost", "Cost per banking setup move.", "Action banking", 0, 8_000, 100),
  knob("weights.actionBankMinimumAdvantage", "Banking threshold", "Required banking advantage.", "Action banking", 0, 20_000, 100),
  searchKnob("search.stochasticSamples", "Chance samples", "Reroll evaluation samples.", 1, 24, 1),
  searchKnob("search.rootPrefilter", "Root prefilter", "Root candidates scored before beam selection.", 1, 100, 1),
  searchKnob("search.nodePrefilter", "Node prefilter", "Candidates scored at deeper nodes.", 1, 100, 1),
  searchKnob("search.rootBeam", "Root beam", "Root actions searched deeply.", 1, 24, 1),
  searchKnob("search.nodeBeam", "Node beam", "Actions retained at search nodes.", 1, 12, 1),
  searchKnob("search.handoffDepth", "Opponent handoffs", "Player handoffs searched.", 0, 3, 1),
  searchKnob("search.actionDepth", "Action depth", "Actions searched through combos.", 1, 10, 1),
  searchKnob("search.nodeBudget", "Node budget", "Maximum expanded nodes.", 1, 500, 1),
  searchKnob("search.actionBankMaxMoves", "Banking move depth", "Maximum chained setup moves.", 0, 10, 1)
] as const;

export function resolveBotStrategy(input: BotDifficulty | BotStrategyConfig): BotStrategyConfig {
  const source = typeof input === "string"
    ? BOT_STRATEGY_PRESETS[input]
    : mergeStrategyWithPreset(input);
  validateStrategy(source);
  return cloneStrategy(source);
}

function mergeStrategyWithPreset(input: BotStrategyConfig): BotStrategyConfig {
  const base = BOT_STRATEGY_PRESETS[input.basePreset];
  return {
    ...base,
    ...input,
    components: { ...base.components, ...input.components },
    randomActionWeights: { ...base.randomActionWeights, ...input.randomActionWeights },
    weights: { ...base.weights, ...input.weights },
    search: { ...base.search, ...input.search },
    disabledKnobs: [...(input.disabledKnobs ?? base.disabledKnobs)]
  };
}

export function customizeStrategy(base: BotDifficulty, overrides: BotStrategyOverrides): BotStrategyConfig {
  const original = resolveBotStrategy(base);
  return {
    ...original,
    ...overrides,
    schemaVersion: 1,
    basePreset: base,
    baseline: false,
    policy: overrides.policy ?? (base === "very-easy" ? "weighted-random" : base === "hard" ? "search" : "greedy"),
    components: { ...original.components, ...overrides.components },
    randomActionWeights: { ...original.randomActionWeights, ...overrides.randomActionWeights },
    weights: { ...original.weights, ...overrides.weights },
    search: { ...original.search, ...overrides.search },
    disabledKnobs: [...(overrides.disabledKnobs ?? original.disabledKnobs)]
  };
}

export function generateStrategyCandidates(template: StrategyTemplate, count: number, seed: string): BotStrategyConfig[] {
  let rngState = seedToState(`${seed}|${template.idPrefix}|${template.basePreset}`);
  const definitions = new Map(STRATEGY_KNOBS.map((definition) => [definition.path, definition]));
  return Array.from({ length: Math.max(1, Math.floor(count)) }, (_, index) => {
    const config = customizeStrategy(template.basePreset, {
      id: `${template.idPrefix}-${index + 1}`,
      label: `${template.labelPrefix} ${index + 1}`,
      policy: template.policy,
      components: template.componentOverrides
    });
    Object.entries(template.knobs).sort(([a], [b]) => a.localeCompare(b)).forEach(([rawPath, setting]) => {
      if (!setting) return;
      const path = rawPath as StrategyKnobPath;
      const definition = definitions.get(path);
      if (!definition) throw new Error(`Unknown strategy knob: ${path}`);
      let value = getKnob(config, path);
      if (setting.mode === "disabled") {
        value = 0;
        config.disabledKnobs = [...new Set([...config.disabledKnobs, path])];
      } else {
        config.disabledKnobs = config.disabledKnobs.filter((entry) => entry !== path);
      }
      if (setting.mode === "fixed") value = setting.value ?? value;
      if (setting.mode === "random") {
        const random = nextRandom(rngState);
        rngState = random.state;
        value = snap((setting.min ?? definition.min) + random.value * ((setting.max ?? definition.max) - (setting.min ?? definition.min)), definition.step, definition.integer);
      }
      setKnob(config, path, clamp(value, definition.min, definition.max));
    });
    config.id = `${template.idPrefix}-${strategyHash(config).slice(0, 8)}`;
    return config;
  });
}

export function strategyHash(config: BotStrategyConfig): string {
  const canonical = JSON.stringify({ basePreset: config.basePreset, policy: config.policy, components: config.components, disabledKnobs: [...config.disabledKnobs].sort(), randomActionWeights: config.randomActionWeights, weights: config.weights, search: config.search });
  let hash = 2_166_136_261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function validateStrategy(config: BotStrategyConfig): void {
  if (config.schemaVersion !== 1 || !config.id || !config.label) throw new Error("Invalid bot strategy configuration.");
  STRATEGY_KNOBS.forEach((definition) => {
    const value = getKnob(config, definition.path);
    if (!Number.isFinite(value) || value < definition.min || value > definition.max) throw new Error(`${definition.label} must be between ${definition.min} and ${definition.max}.`);
  });
}

function knob(path: StrategyKnobPath, label: string, description: string, group: StrategyKnobDefinition["group"], min: number, max: number, step: number): StrategyKnobDefinition {
  return { path, label, description, group, min, max, step, canDisable: true, policies: ["greedy", "search"] };
}
function searchKnob(path: StrategyKnobPath, label: string, description: string, min: number, max: number, step: number): StrategyKnobDefinition {
  return { path, label, description, group: "Search", min, max, step, integer: true, canDisable: false, policies: ["search"] };
}
function getKnob(config: BotStrategyConfig, path: StrategyKnobPath): number {
  const [section, key] = path.split(".") as ["weights" | "search" | "randomActionWeights", string];
  return (config[section] as unknown as Record<string, number>)[key];
}
function setKnob(config: BotStrategyConfig, path: StrategyKnobPath, value: number): void {
  const [section, key] = path.split(".") as ["weights" | "search" | "randomActionWeights", string];
  (config[section] as unknown as Record<string, number>)[key] = value;
}
function snap(value: number, step: number, integer = false): number {
  const snapped = step > 0 ? Math.round(value / step) * step : value;
  return integer ? Math.round(snapped) : Number(snapped.toFixed(6));
}
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function cloneStrategy(config: BotStrategyConfig): BotStrategyConfig { return JSON.parse(JSON.stringify(config)) as BotStrategyConfig; }
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach((entry) => deepFreeze(entry));
  }
  return value;
}