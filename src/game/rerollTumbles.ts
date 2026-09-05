import type {
  ColliderDesc,
  EventQueue,
  RigidBody,
  Rotation,
  World
} from "@dimforge/rapier3d-compat";

type RapierModule = typeof import("@dimforge/rapier3d-compat").default;

export const REROLL_TUMBLE_DURATION_MS = 4600;
// A variant is the complete throw seed, not an index into a small animation set.
export const REROLL_TUMBLE_VARIANT_COUNT = 0x1_0000_0000;
export const REROLL_MAX_DICE = 18;
export const REROLL_SAMPLE_COMPONENTS = 7;
export const REROLL_GATHER_DURATION_MS = 520;
export const OPENING_ROLL_TUMBLE_DURATION_MS = 3600;
export const OPENING_ROLL_GATHER_DURATION_MS = 360;

const FRAME_RATE = 60;
const FRAME_INTERVAL_SECONDS = 1 / FRAME_RATE;
const HOLD_DURATION_SECONDS = REROLL_GATHER_DURATION_MS / 1000;
export const REROLL_DIE_HALF_SIZE = 0.52;
const DIE_CORE_HALF_SIZE = 0.315;
const DIE_BORDER_RADIUS = REROLL_DIE_HALF_SIZE - DIE_CORE_HALF_SIZE;
export const REROLL_TRAY_HALF_EXTENT = 4.35;

const SETTLED_LINEAR_SPEED = 0.12;
const SETTLED_ANGULAR_SPEED = 0.34;
const SETTLED_FRAME_COUNT = 10;
const TEMPLATE_CACHE_LIMIT = 24;

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

interface ThrowProfile {
  originX: number;
  originZ: number;
  speed: number;
  heading: number;
  lift: number;
  height: number;
  spin: number;
  yaw: number;
  fan: number;
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
  return hash >>> 0;
}

export function getRerollTumbleTemplate(count: number, variant: number): Promise<RerollTumbleTemplate> {
  const safeCount = Number.isFinite(count) ? Math.max(1, Math.min(REROLL_MAX_DICE, Math.floor(count))) : 1;
  const safeVariant = variant >>> 0;
  const cacheKey = safeCount + ":" + safeVariant;
  const cached = templateCache.get(cacheKey);
  if (cached) {
    templateCache.delete(cacheKey);
    templateCache.set(cacheKey, cached);
    return cached;
  }

  const template = ensureRapierReady().then((rapier) => createTemplate(rapier, safeCount, safeVariant));
  cacheTemplate(templateCache, cacheKey, template);
  return template;
}

export function getOpeningRollTumbleTemplate(
  playerIndexes: number[],
  variant: number
): Promise<RerollTumbleTemplate> {
  const safePlayerIndexes = playerIndexes
    .slice(0, 4)
    .map((playerIndex) => Math.max(0, Math.min(3, Math.floor(playerIndex))));
  const safeVariant = variant >>> 0;
  const cacheKey = `${safePlayerIndexes.join(",")}:${safeVariant}`;
  const cached = openingTemplateCache.get(cacheKey);
  if (cached) {
    openingTemplateCache.delete(cacheKey);
    openingTemplateCache.set(cacheKey, cached);
    return cached;
  }

  const template = ensureRapierReady().then((rapier) => {
    return createOpeningTemplate(rapier, safePlayerIndexes, safeVariant);
  });
  cacheTemplate(openingTemplateCache, cacheKey, template);
  return template;
}
export async function preloadRerollPhysics(): Promise<void> {
  await ensureRapierReady();
}

function cacheTemplate(
  cache: Map<string, Promise<RerollTumbleTemplate>>,
  key: string,
  template: Promise<RerollTumbleTemplate>
): void {
  cache.set(key, template);
  if (cache.size > TEMPLATE_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  // Failed loads must remain retryable. An evicted promise may still be in use.
  void template.catch(() => {
    if (cache.get(key) === template) cache.delete(key);
  });
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
  const random = mulberry32(mixSeed(count, variant));
  const throwProfile = createThrowProfile(random);
  const world = new RAPIER.World({ x: 0, y: -13.8, z: 0 });
  world.timestep = FRAME_INTERVAL_SECONDS;
  world.maxCcdSubsteps = 8;
  const eventQueue = new RAPIER.EventQueue(true);
  const surfaceKindByCollider = createTrayColliders(RAPIER, world);
  const dice = Array.from(
    { length: count },
    (_, index) => createSimulatedDie(RAPIER, world, index, count, throwProfile, random)
  );
  const dieIndexByCollider = new Map(dice.map((die, index) => [die.colliderHandle, index]));

  const tracks = simulateTracks(world, eventQueue, dice, dieIndexByCollider, surfaceKindByCollider,
    REROLL_TUMBLE_DURATION_MS, HOLD_DURATION_SECONDS);
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

  const tracks = simulateTracks(world, eventQueue, dice, dieIndexByCollider, surfaceKindByCollider,
    OPENING_ROLL_TUMBLE_DURATION_MS, holdDurationSeconds);
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

function simulateTracks(
  world: World,
  eventQueue: EventQueue,
  dice: SimulatedDie[],
  dieIndexByCollider: Map<number, number>,
  surfaceKindByCollider: Map<number, RerollImpactKind>,
  durationMs: number,
  holdDurationSeconds: number
): RerollTumbleTrack[] {
  const frameCount = Math.ceil(durationMs / 1000 * FRAME_RATE) + 1;
  // Most rolls finish in the regular window. Give a collapsing stack time to
  // finish physically, then gently accelerate its late tail for playback.
  const maxFrameCount = frameCount + FRAME_RATE * 6;
  const tracks = dice.map((): RerollTumbleTrack => ({
    samples: new Float32Array(maxFrameCount * REROLL_SAMPLE_COMPONENTS),
    settleTimeMs: durationMs,
    impacts: []
  }));
  let lastFrame = 0;
  for (let frame = 0; frame < maxFrameCount; frame += 1) {
    lastFrame = frame;
    dice.forEach((die, index) => {
      writeSample(tracks[index].samples, frame, die.body);
      updateSettleTime(die, tracks[index], frame, holdDurationSeconds);
    });
    if (frame / FRAME_RATE >= holdDurationSeconds + 1.6
      && dice.every((die) => die.settledFrames >= SETTLED_FRAME_COUNT)) break;
    if (frame === maxFrameCount - 1) break;
    if (frame * FRAME_INTERVAL_SECONDS < holdDurationSeconds) continue;
    dice.forEach((die) => applySurfaceDrag(world, die, frame / FRAME_RATE - holdDurationSeconds));
    world.step(eventQueue);
    drainImpactEvents(eventQueue, dieIndexByCollider, surfaceKindByCollider, tracks, frame + 1);
  }
  const finalHoldFrames = 12;
  const playbackEnd = frameCount - 1 - finalHoldFrames;
  const preserveUntil = (holdDurationSeconds + 1.35) * FRAME_RATE;
  const tailScale = Math.max(0, (lastFrame - playbackEnd) / (playbackEnd - preserveUntil));
  const sourceFrameAt = (frame: number) => {
    const tail = Math.max(0, Math.min(frame, playbackEnd) - preserveUntil);
    return Math.min(lastFrame, frame + tailScale * tail * tail / (playbackEnd - preserveUntil));
  };
  return tracks.map((track, index) => {
    const samples = new Float32Array(frameCount * REROLL_SAMPLE_COMPONENTS);
    for (let frame = 0; frame < frameCount; frame += 1) {
      interpolateSample(track.samples, samples, frame, sourceFrameAt(frame));
    }
    const toPlaybackMs = (timeMs: number) => {
      const sourceFrame = timeMs / 1000 * FRAME_RATE;
      let low = 0;
      let high = frameCount - 1;
      for (let step = 0; step < 16; step += 1) {
        const middle = (low + high) / 2;
        if (sourceFrameAt(middle) < sourceFrame) low = middle;
        else high = middle;
      }
      return Math.round(high / FRAME_RATE * 1000);
    };
    return {
      samples,
      settleTimeMs: toPlaybackMs(dice[index].lastActiveFrame / FRAME_RATE * 1000),
      impacts: track.impacts.map((impact) => ({ ...impact, timeMs: toPlaybackMs(impact.timeMs) }))
    };
  });
}

function interpolateSample(source: Float32Array, target: Float32Array, frame: number, sourceFrame: number): void {
  const lower = Math.floor(sourceFrame) * REROLL_SAMPLE_COMPONENTS;
  const upper = Math.ceil(sourceFrame) * REROLL_SAMPLE_COMPONENTS;
  const fraction = sourceFrame - Math.floor(sourceFrame);
  const offset = frame * REROLL_SAMPLE_COMPONENTS;
  for (let axis = 0; axis < 3; axis += 1) {
    target[offset + axis] = source[lower + axis] + (source[upper + axis] - source[lower + axis]) * fraction;
  }
  let dot = 0;
  for (let axis = 3; axis < 7; axis += 1) dot += source[lower + axis] * source[upper + axis];
  const sign = dot < 0 ? -1 : 1;
  let norm = 0;
  for (let axis = 3; axis < 7; axis += 1) {
    const value = source[lower + axis] + (source[upper + axis] * sign - source[lower + axis]) * fraction;
    target[offset + axis] = value;
    norm += value * value;
  }
  const length = Math.sqrt(norm);
  for (let axis = 3; axis < 7; axis += 1) target[offset + axis] /= length;
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
  profile: ThrowProfile,
  random: () => number
): SimulatedDie {
  // Two loose layers keep a large handful within the same corner without
  // spawning overlapping bodies and letting the collision solver explode them.
  const columns = Math.min(3, Math.ceil(Math.sqrt(count)));
  const column = index % columns;
  const rows = Math.min(3, Math.ceil(count / columns));
  const row = Math.floor(index / columns) % rows;
  const layer = Math.floor(index / (columns * rows));
  const spacing = 1.2;
  const x = profile.originX - column * spacing + (random() - 0.5) * 0.05;
  const z = profile.originZ - row * spacing + (random() - 0.5) * 0.05;
  const yaw = profile.yaw + Math.floor(random() * 4) * Math.PI / 2;
  const initialRotation = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
  const heading = profile.heading + (random() - 0.5) * profile.fan;
  const speed = profile.speed * (0.74 + random() * 0.48);
  const launchHeight = profile.height + layer * spacing + random() * 0.08;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, launchHeight, z)
      .setRotation(initialRotation)
      .setLinvel(
        -Math.cos(heading) * speed,
        profile.lift * (0.82 + random() * 0.34),
        -Math.sin(heading) * speed
      )
      .setAngvel({
        x: (0.35 + random() * 0.8) * profile.spin,
        y: (random() - 0.5) * profile.spin * 1.4,
        z: -(0.35 + random() * 0.8) * profile.spin
      })
      .setLinearDamping(0.17)
      .setAngularDamping(0.38)
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
      .setFriction(0.56)
      .setRestitution(0.43)
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
  const originX = corner.x - Math.sign(corner.x) * (0.1 + random() * 0.45);
  const originZ = corner.z - Math.sign(corner.z) * (0.1 + random() * 0.45);
  const targetX = (random() - 0.5) * 2.1;
  const targetZ = (random() - 0.5) * 2.1;
  const travelScale = 1.9 + random() * 0.8;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(originX, 1.05 + random() * 0.5, originZ)
      .setRotation(randomQuaternion(random))
      .setLinvel(
        (targetX - originX) * travelScale,
        2.8 + random() * 1.8,
        (targetZ - originZ) * travelScale
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
      .setFriction(0.56)
      .setRestitution(0.38)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Average)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(0.42),
    body
  );
  return { body, colliderHandle: collider.handle, lastActiveFrame: 0, settledFrames: 0 };
}
function createThrowProfile(random: () => number): ThrowProfile {
  return {
    originX: 3.32 + random() * 0.25,
    originZ: 3.32 + random() * 0.25,
    speed: 10.5 + random() * 3.7,
    heading: Math.PI / 4 + (random() - 0.5) * 0.3,
    lift: 2.7 + random() * 1.35,
    height: 0.88 + random() * 0.26,
    spin: 8 + random() * 7,
    yaw: (random() - 0.5) * 0.2,
    fan: 0.65 + random() * 0.45
  };
}

function applySurfaceDrag(world: World, die: SimulatedDie, elapsedSeconds: number): void {
  // Approximate rolling resistance after the energetic part of the throw.
  // Airborne dice retain their arc; contact friction damps the final rocking.
  let touchingSurface = false;
  world.contactPairsWith(world.getCollider(die.colliderHandle), () => { touchingSurface = true; });
  const resistance = touchingSurface
    ? Math.max(0, Math.min(1, (elapsedSeconds - 1.25) / 0.9))
    : 0;
  die.body.setLinearDamping(0.17 + resistance * 2.2);
  die.body.setAngularDamping(0.38 + resistance * 4.4);
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
