import type { RerollImpactKind } from "./game/rerollTumbles";

export type TableCue = "pickup" | "drop" | "click" | "invalid" | "completion" | "bonus" | "turn" | "win";
type Sound = TableCue | `dice-${RerollImpactKind}`;
const counts: Record<Sound, number> = {
  "dice-floor": 4, "dice-wall": 4, "dice-die": 3,
  pickup: 3, drop: 3, click: 3, invalid: 1, completion: 1, bonus: 1, turn: 1, win: 1
};
const levels: Record<TableCue, number> = {
  pickup: 0.16, drop: 0.48, click: 0.14, invalid: 0.28,
  completion: 0.22, bonus: 0.24, turn: 0.22, win: 0.32
};
const STORAGE_KEY = "disuko-sound-enabled";
let context: AudioContext | undefined;
let master: GainNode | undefined;
let enabled = readEnabled();
let installed = false;
let loading: Promise<void> | undefined;
const lastImpactAt = { wood: -1, die: -1 };
const buffers = new Map<string, AudioBuffer>();
const previous = new Map<Sound, number>();
const active = new Set<AudioBufferSourceNode>();

function readEnabled(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) !== "false"; } catch { return true; }
}
export function isTableSoundEnabled(): boolean { return enabled; }
export function setTableSoundEnabled(value: boolean): void {
  enabled = value;
  try { localStorage.setItem(STORAGE_KEY, String(value)); } catch { /* Private browsing. */ }
  if (master && context) master.gain.setValueAtTime(value ? 0.8 : 0, context.currentTime);
  if (!value) for (const source of active) source.stop();
  window.dispatchEvent(new Event("disuko-sound-change"));
  if (value) unlockTableAudio();
}

/** Browsers require a real pointer/key gesture to unlock playback. */
export function installTableAudio(): void {
  if (installed) return;
  installed = true;
  document.addEventListener("pointerdown", unlockTableAudio, { capture: true, passive: true });
  document.addEventListener("keydown", unlockTableAudio, { capture: true });
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button:not(:disabled)") && !target.closest("[data-die-id], .rail-die, .board-cell, [data-sound-toggle]")) playTableCue("click");
  }, { capture: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) for (const source of active) source.stop();
  });
}

export function unlockTableAudio(): void {
  if (!enabled || typeof window === "undefined") return;
  try {
    const Constructor = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) return;
    if (!context) {
      context = new Constructor();
      master = context.createGain();
      master.gain.value = 0.8;
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 6;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;
      master.connect(limiter);
      limiter.connect(context.destination);
    }
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    const audio = context;
    loading ??= Promise.all(Object.entries(counts).flatMap(([sound, count]) =>
      Array.from({ length: count }, (_, index) => {
        const name = `${sound}-${index + 1}`;
        if (buffers.has(name)) return Promise.resolve();
        return fetch(`${import.meta.env.BASE_URL}audio/table-v2/${name}.wav`)
          .then((response) => {
            if (!response.ok) throw new Error(`Audio ${response.status}: ${name}`);
            return response.arrayBuffer();
          })
          .then((data) => audio.decodeAudioData(data))
          .then((buffer) => { buffers.set(name, buffer); });
      })
    )).then(() => undefined).catch(() => { loading = undefined; });
  } catch { /* Sound is optional on browsers without Web Audio. */ }
}

function play(sound: Sound, gain: number, pan: number, pitch: number): void {
  if (!enabled || document.hidden || !context || context.state !== "running" || !master) return;
  const count = counts[sound];
  const last = previous.get(sound) ?? -1;
  const index = count === 1 ? 0 : (last + 1 + Math.floor(Math.random() * (count - 1))) % count;
  const buffer = buffers.get(`${sound}-${index + 1}`);
  if (!buffer) return; // Never replay a stale event after loading.
  previous.set(sound, index);
  if (active.size >= 14) {
    const oldest = active.values().next().value;
    if (oldest) { active.delete(oldest); oldest.stop(); }
  }
  const source = context.createBufferSource();
  const volume = context.createGain();
  source.buffer = buffer;
  source.playbackRate.value = pitch;
  volume.gain.value = Math.max(0, Math.min(1, gain));
  source.connect(volume);
  const stereo = typeof context.createStereoPanner === "function" ? context.createStereoPanner() : undefined;
  if (stereo) {
    stereo.pan.value = Math.max(-0.8, Math.min(0.8, pan));
    volume.connect(stereo);
    stereo.connect(master);
  } else volume.connect(master);
  active.add(source);
  source.onended = () => { active.delete(source); source.disconnect(); volume.disconnect(); stereo?.disconnect(); };
  source.start();
}

export function playTableCue(cue: TableCue, variant = 0, pan = 0): void {
  const pitch = cue === "completion" ? 2 ** ([0, 2, 4, 7, 9, 12][Math.min(5, Math.max(0, variant))] / 12)
    : cue === "drop" || cue === "pickup" || cue === "click" ? 0.98 + Math.random() * 0.04 : 1;
  play(cue, levels[cue], pan, pitch);
}

export function playTableImpact(kind: RerollImpactKind, strength: number, pan: number): void {
  const material = kind === "die" ? "die" : "wood";
  if (!context || context.currentTime - lastImpactAt[material] < 0.025) return;
  lastImpactAt[material] = context.currentTime;
  const safe = Math.max(0.06, Math.min(1, strength));
  play(`dice-${kind}`, (0.025 + 0.48 * safe ** 1.6) * (kind === "die" ? 0.62 : 1), pan, 0.98 + Math.random() * 0.04);
}
