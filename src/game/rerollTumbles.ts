import type {
  ColliderDesc,
  EventQueue,
  RigidBody,
  Rotation,
  World
} from "@dimforge/rapier3d-compat";

type RapierModule = typeof import("@dimforge/rapier3d-compat").default;

export const REROLL_TUMBLE_DURATION_MS = 4600;
export const REROLL_TUMBLE_VARIANT_COUNT = 3;
export const REROLL_MAX_DICE = 18;
export const REROLL_SAMPLE_COMPONENTS = 7;
export const REROLL_GATHER_DURATION_MS = 520;
export const OPENING_ROLL_TUMBLE_DURATION_MS = 3600;
export const OPENING_ROLL_GATHER_DURATION_MS = 360;

const FRAME_RATE = 60;
const FRAME_INTERVAL_SECONDS = 1 / FRAME_RATE;
const HOLD_DURATION_SECONDS = REROLL_GATHER_DURATION_MS / 1000;
export const REROLL_DIE_HALF_SIZE = 0.52;
const DIE_CORE_HALF_SIZE = 0.335;
const DIE_BORDER_RADIUS = REROLL_DIE_HALF_SIZE - DIE_CORE_HALF_SIZE;
export const REROLL_TRAY_HALF_EXTENT = 4.35;

const SETTLED_LINEAR_SPEED = 0.12;
const SETTLED_ANGULAR_SPEED = 0.34;
const SETTLED_FRAME_COUNT = 10;

export type RerollImpactKind = "floor" | "wall" | "die";

export interface RerollImpactEvent {
  timeMs: number;
  strength: number;
  kind: RerollImpactKind;
}

export interface RerollTumbleTrack {
  samples: Float32Array;
  settleTimeMs: number;
  impacts: RerollImpactEvent[];
}

export interface RerollTumbleTemplate {
  count: number;
  variant: number;
  durationMs: number;
  frameRate: number;
  frameCount: number;
  tracks: RerollTumbleTrack[];
}

interface SimulatedDie {
  body: RigidBody;
  colliderHandle: number;
  lastActiveFrame: number;
  settledFrames: number;
}

const templateCache = new Map<string, Promise<RerollTumbleTemplate>>();
const openingTemplateCache = new Map<string, Promise<RerollTumbleTemplate>>();
let rapierReady: Promise<RapierModule> | undefined;

export function rerollVariantFromKey(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % REROLL_TUMBLE_VARIANT_COUNT;
}

export function getRerollTumbleTemplate(count: number, variant: number): Promise<RerollTumbleTemplate> {
  const safeCount = Math.max(1, Math.min(REROLL_MAX_DICE, Math.floor(count)));
  const safeVariant = ((Math.floor(variant) % REROLL_TUMBLE_VARIANT_COUNT) + REROLL_TUMBLE_VARIANT_COUNT)
    % REROLL_TUMBLE_VARIANT_COUNT;
  const cacheKey = safeCount + ":" + safeVariant;
  const cached = templateCache.get(cacheKey);
  if (cached) return cached;

  const template = ensureRapierReady().then((rapier) => createTemplate(rapier, safeCount, safeVariant));
  templateCache.set(cacheKey, template);
  return template;
}

export function getOpeningRollTumbleTemplate(
  playerIndexes: number[],
  variant: number
): Promise<RerollTumbleTemplate> {
  const safePlayerIndexes = playerIndexes
    .slice(0, 4)
    .map((playerIndex) => Math.max(0, Math.min(3, Math.floor(playerIndex))));
  const safeVariant = ((Math.floor(variant) % REROLL_TUMBLE_VARIANT_COUNT) + REROLL_TUMBLE_VARIANT_COUNT)
    % REROLL_TUMBLE_VARIANT_COUNT;
  const cacheKey = `${safePlayerIndexes.join(",")}:${safeVariant}`;
  const cached = openingTemplateCache.get(cacheKey);
  if (cached) return cached;

  const template = ensureRapierReady().then((rapier) => {
    return createOpeningTemplate(rapier, safePlayerIndexes, safeVariant);
  });
  openingTemplateCache.set(cacheKey, template);
  return template;
}
export async function preloadRerollPhysics(): Promise<void> {
  await ensureRapierReady();
}

function ensureRapierReady(): Promise<RapierModule> {
  if (!rapierReady) {
    rapierReady = import("@dimforge/rapier3d-compat").then(async ({ default: rapier }) => {
      await rapier.init();
      return rapier;
    });
  }
  return rapierReady;
}

function createTemplate(RAPIER: RapierModule, count: number, variant: number): RerollTumbleTemplate {
  const frameCount = Math.ceil((REROLL_TUMBLE_DURATION_MS / 1000) * FRAME_RATE) + 1;
  const tracks = Array.from({ length: count }, (): RerollTumbleTrack => ({
    samples: new Float32Array(frameCount * REROLL_SAMPLE_COMPONENTS),
    settleTimeMs: REROLL_TUMBLE_DURATION_MS,
    impacts: []
  }));
  const random = mulberry32(mixSeed(count, variant));
  const world = new RAPIER.World({ x: 0, y: -13.8, z: 0 });
  world.timestep = FRAME_INTERVAL_SECONDS;
  world.maxCcdSubsteps = 8;
  const eventQueue = new RAPIER.EventQueue(true);
  const surfaceKindByCollider = createTrayColliders(RAPIER, world);
  const dice = Array.from(
    { length: count },
    (_, index) => createSimulatedDie(RAPIER, world, index, count, random)
  );
  const dieIndexByCollider = new Map(dice.map((die, index) => [die.colliderHandle, index]));

  for (let frame = 0; frame < frameCount; frame += 1) {
    dice.forEach((die, index) => {
      writeSample(tracks[index].samples, frame, die.body);
      updateSettleTime(die, tracks[index], frame);
    });

    if (frame === frameCount - 1) break;
    if (frame * FRAME_INTERVAL_SECONDS < HOLD_DURATION_SECONDS) continue;
    world.step(eventQueue);
    drainImpactEvents(eventQueue, dieIndexByCollider, surfaceKindByCollider, tracks, frame + 1);
  }

  dice.forEach((die, index) => {
    if (die.lastActiveFrame > 0) {
      tracks[index].settleTimeMs = Math.min(
        REROLL_TUMBLE_DURATION_MS,
        Math.round((die.lastActiveFrame / FRAME_RATE) * 1000)
      );
    }
  });
  eventQueue.free();
  world.free();

  return { count, variant, durationMs: REROLL_TUMBLE_DURATION_MS, frameRate: FRAME_RATE, frameCount, tracks };
}

function createOpeningTemplate(
  RAPIER: RapierModule,
  playerIndexes: number[],
  variant: number
): RerollTumbleTemplate {
  const frameCount = Math.ceil((OPENING_ROLL_TUMBLE_DURATION_MS / 1000) * FRAME_RATE) + 1;
  const tracks = playerIndexes.map((): RerollTumbleTrack => ({
    samples: new Float32Array(frameCount * REROLL_SAMPLE_COMPONENTS),
    settleTimeMs: OPENING_ROLL_TUMBLE_DURATION_MS,
    impacts: []
  }));
  const random = mulberry32(mixOpeningSeed(playerIndexes, variant));
  const world = new RAPIER.World({ x: 0, y: -13.8, z: 0 });
  world.timestep = FRAME_INTERVAL_SECONDS;
  world.maxCcdSubsteps = 8;
  const eventQueue = new RAPIER.EventQueue(true);
  const surfaceKindByCollider = createTrayColliders(RAPIER, world);
  const dice = playerIndexes.map((playerIndex, index) => {
    return createOpeningDie(RAPIER, world, playerIndex, index, random);
  });
  const dieIndexByCollider = new Map(dice.map((die, index) => [die.colliderHandle, index]));
  const holdDurationSeconds = OPENING_ROLL_GATHER_DURATION_MS / 1000;

  for (let frame = 0; frame < frameCount; frame += 1) {
    dice.forEach((die, index) => {
      writeSample(tracks[index].samples, frame, die.body);
      updateSettleTime(die, tracks[index], frame, holdDurationSeconds);
    });

    if (frame === frameCount - 1) break;
    if (frame * FRAME_INTERVAL_SECONDS < holdDurationSeconds) continue;
    world.step(eventQueue);
    drainImpactEvents(eventQueue, dieIndexByCollider, surfaceKindByCollider, tracks, frame + 1);
  }

  dice.forEach((die, index) => {
    if (die.lastActiveFrame > 0) {
      tracks[index].settleTimeMs = Math.min(
        OPENING_ROLL_TUMBLE_DURATION_MS,
        Math.round((die.lastActiveFrame / FRAME_RATE) * 1000)
      );
    }
  });
  eventQueue.free();
  world.free();

  return {
    count: playerIndexes.length,
    variant,
    durationMs: OPENING_ROLL_TUMBLE_DURATION_MS,
    frameRate: FRAME_RATE,
    frameCount,
    tracks
  };
}
function createTrayColliders(RAPIER: RapierModule, world: World): Map<number, RerollImpactKind> {
  const surfaceKindByCollider = new Map<number, RerollImpactKind>();
  const surface = (description: ColliderDesc, kind: RerollImpactKind) => {
    const collider = world.createCollider(description
      .setFriction(0.46)
      .setRestitution(0.34)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Average)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(0.55));
    surfaceKindByCollider.set(collider.handle, kind);
  };
  surface(RAPIER.ColliderDesc.cuboid(REROLL_TRAY_HALF_EXTENT, 0.1, REROLL_TRAY_HALF_EXTENT).setTranslation(0, -0.06, 0), "floor");
  surface(RAPIER.ColliderDesc.cuboid(0.12, 7, REROLL_TRAY_HALF_EXTENT).setTranslation(-REROLL_TRAY_HALF_EXTENT - 0.12, 6.8, 0), "wall");
  surface(RAPIER.ColliderDesc.cuboid(0.12, 7, REROLL_TRAY_HALF_EXTENT).setTranslation(REROLL_TRAY_HALF_EXTENT + 0.12, 6.8, 0), "wall");
  surface(RAPIER.ColliderDesc.cuboid(REROLL_TRAY_HALF_EXTENT, 7, 0.12).setTranslation(0, 6.8, -REROLL_TRAY_HALF_EXTENT - 0.12), "wall");
  surface(RAPIER.ColliderDesc.cuboid(REROLL_TRAY_HALF_EXTENT, 7, 0.12).setTranslation(0, 6.8, REROLL_TRAY_HALF_EXTENT + 0.12), "wall");
  return surfaceKindByCollider;
}

function createSimulatedDie(
  RAPIER: RapierModule,
  world: World,
  index: number,
  count: number,
  random: () => number
): SimulatedDie {
  const columns = Math.min(5, Math.ceil(Math.sqrt(count)));
  const column = index % columns;
  const row = Math.floor(index / columns);
  const spacing = 0.58;
  const x = 3.62 - column * spacing;
  const z = 3.6 - row * spacing;
  const initialRotation = randomQuaternion(random);
  const spread = count === 1 ? 0.5 : index / (count - 1);
  const speedScale = 0.72 + random() * 0.52;
  const horizontalThrow = (3.8 + (1 - spread) * 8.8 + random() * 2.1) * speedScale;
  const depthThrow = (3.8 + spread * 8.8 + random() * 2.1) * (0.7 + random() * 0.56);
  const launchHeight = 1.15 + (index % 3) * 0.16 + random() * 0.48;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, launchHeight, z)
      .setRotation(initialRotation)
      .setLinvel(
        -horizontalThrow,
        4 + spread * 0.9 + random() * 0.9,
        -depthThrow
      )
      .setAngvel({
        x: (random() - 0.5) * 20,
        y: (random() - 0.5) * 24,
        z: (random() - 0.5) * 22
      })
      .setLinearDamping(0.15 + spread * 0.035)
      .setAngularDamping(0.32 + spread * 0.065)
      .setCanSleep(true)
      .setCcdEnabled(true)
      .setAdditionalSolverIterations(8)
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.roundCuboid(
      DIE_CORE_HALF_SIZE,
      DIE_CORE_HALF_SIZE,
      DIE_CORE_HALF_SIZE,
      DIE_BORDER_RADIUS
    )
      .setDensity(1.08)
      .setFriction(0.48)
      .setRestitution(0.34)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Average)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(0.48),
    body
  );
  return { body, colliderHandle: collider.handle, lastActiveFrame: 0, settledFrames: 0 };
}

function createOpeningDie(
  RAPIER: RapierModule,
  world: World,
  playerIndex: number,
  rollIndex: number,
  random: () => number
): SimulatedDie {
  const corners = [
    { x: 3.62, z: 3.62 },
    { x: -3.62, z: -3.62 },
    { x: 3.62, z: -3.62 },
    { x: -3.62, z: 3.62 }
  ];
  const corner = corners[playerIndex] ?? corners[rollIndex % corners.length];
  const targetX = (random() - 0.5) * 1.25;
  const targetZ = (random() - 0.5) * 1.25;
  const travelScale = 2.05 + random() * 0.28;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(corner.x, 1.35 + random() * 0.42, corner.z)
      .setRotation(randomQuaternion(random))
      .setLinvel(
        (targetX - corner.x) * travelScale,
        3.8 + random() * 1.25,
        (targetZ - corner.z) * travelScale
      )
      .setAngvel({
        x: (random() - 0.5) * 24,
        y: (random() - 0.5) * 27,
        z: (random() - 0.5) * 24
      })
      .setLinearDamping(0.17 + random() * 0.04)
      .setAngularDamping(0.34 + random() * 0.06)
      .setCanSleep(true)
      .setCcdEnabled(true)
      .setAdditionalSolverIterations(10)
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.roundCuboid(
      DIE_CORE_HALF_SIZE,
      DIE_CORE_HALF_SIZE,
      DIE_CORE_HALF_SIZE,
      DIE_BORDER_RADIUS
    )
      .setDensity(1.08)
      .setFriction(0.48)
      .setRestitution(0.38)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Average)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(0.42),
    body
  );
  return { body, colliderHandle: collider.handle, lastActiveFrame: 0, settledFrames: 0 };
}
function drainImpactEvents(
  eventQueue: EventQueue,
  dieIndexByCollider: Map<number, number>,
  surfaceKindByCollider: Map<number, RerollImpactKind>,
  tracks: RerollTumbleTrack[],
  frame: number
): void {
  eventQueue.drainContactForceEvents((event) => {
    const leftIndex = dieIndexByCollider.get(event.collider1());
    const rightIndex = dieIndexByCollider.get(event.collider2());
    if (leftIndex === undefined && rightIndex === undefined) return;
    const force = event.totalForceMagnitude();
    const strength = Math.max(0.08, Math.min(1, Math.log1p(force) / 4.15));
    const timeMs = Math.round((frame / FRAME_RATE) * 1000);
    const staticHandle = leftIndex === undefined ? event.collider1() : event.collider2();
    const kind: RerollImpactKind = leftIndex !== undefined && rightIndex !== undefined
      ? "die"
      : surfaceKindByCollider.get(staticHandle) ?? "floor";
    if (leftIndex !== undefined) pushImpact(tracks[leftIndex].impacts, { timeMs, strength, kind });
    if (rightIndex !== undefined) pushImpact(tracks[rightIndex].impacts, { timeMs, strength, kind });
  });
}

function pushImpact(events: RerollImpactEvent[], event: RerollImpactEvent): void {
  const previous = events[events.length - 1];
  if (previous && event.timeMs - previous.timeMs < 42) {
    if (event.strength > previous.strength) events[events.length - 1] = event;
    return;
  }
  events.push(event);
}

function updateSettleTime(
  die: SimulatedDie,
  track: RerollTumbleTrack,
  frame: number,
  holdDurationSeconds = HOLD_DURATION_SECONDS
): void {
  if (frame / FRAME_RATE < holdDurationSeconds) return;
  const linear = die.body.linvel();
  const angular = die.body.angvel();
  const linearSpeed = Math.hypot(linear.x, linear.y, linear.z);
  const angularSpeed = Math.hypot(angular.x, angular.y, angular.z);
  if (!die.body.isSleeping() && (linearSpeed > SETTLED_LINEAR_SPEED || angularSpeed > SETTLED_ANGULAR_SPEED)) {
    die.lastActiveFrame = frame;
    die.settledFrames = 0;
    return;
  }
  die.settledFrames += 1;
  if (die.settledFrames === SETTLED_FRAME_COUNT) {
    track.settleTimeMs = Math.round(((frame - SETTLED_FRAME_COUNT + 1) / FRAME_RATE) * 1000);
  }
}

function writeSample(samples: Float32Array, frame: number, body: RigidBody): void {
  const offset = frame * REROLL_SAMPLE_COMPONENTS;
  const position = body.translation();
  const rotation = body.rotation();
  samples[offset] = position.x;
  samples[offset + 1] = position.y;
  samples[offset + 2] = position.z;
  samples[offset + 3] = rotation.x;
  samples[offset + 4] = rotation.y;
  samples[offset + 5] = rotation.z;
  samples[offset + 6] = rotation.w;
}

function randomQuaternion(random: () => number): Rotation {
  const u1 = random();
  const u2 = random();
  const u3 = random();
  const first = Math.sqrt(1 - u1);
  const second = Math.sqrt(u1);
  return {
    x: first * Math.sin(2 * Math.PI * u2),
    y: first * Math.cos(2 * Math.PI * u2),
    z: second * Math.sin(2 * Math.PI * u3),
    w: second * Math.cos(2 * Math.PI * u3)
  };
}

function mixSeed(count: number, variant: number): number {
  let seed = Math.imul(count + 41, 0x9e3779b1) ^ Math.imul(variant + 17, 0x85ebca6b);
  seed ^= seed >>> 16;
  seed = Math.imul(seed, 0x7feb352d);
  seed ^= seed >>> 15;
  return seed >>> 0;
}

function mixOpeningSeed(playerIndexes: number[], variant: number): number {
  let seed = Math.imul(variant + 29, 0x9e3779b1);
  playerIndexes.forEach((playerIndex, index) => {
    seed ^= Math.imul(playerIndex + 11 + index * 7, 0x85ebca6b);
    seed = Math.imul(seed ^ (seed >>> 13), 0xc2b2ae35);
  });
  return seed >>> 0;
}
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
