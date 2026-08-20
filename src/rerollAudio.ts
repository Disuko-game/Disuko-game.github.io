import type { RerollImpactKind } from "./game/rerollTumbles";

let audioContext: AudioContext | undefined;
let noiseBuffer: AudioBuffer | undefined;
let lastImpactAt = 0;

export function unlockRerollAudio(): void {
  if (typeof window === "undefined") return;
  const AudioContextConstructor = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return;
  audioContext ??= new AudioContextConstructor();
  if (audioContext.state === "suspended") {
    void audioContext.resume();
  }
}

export function playRerollImpact(strength: number, kind: RerollImpactKind, pan: number): void {
  const context = audioContext;
  if (!context || context.state !== "running") return;
  const now = context.currentTime;
  if (now - lastImpactAt < 0.018) return;
  lastImpactAt = now;

  const safeStrength = Math.max(0.06, Math.min(1, strength));
  const gain = context.createGain();
  const filter = context.createBiquadFilter();
  const source = context.createBufferSource();
  const stereo = typeof context.createStereoPanner === "function" ? context.createStereoPanner() : undefined;

  source.buffer = getNoiseBuffer(context);
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(kind === "die" ? 1150 : kind === "wall" ? 720 : 520, now);
  filter.Q.setValueAtTime(kind === "die" ? 1.1 : 0.72, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.018 + safeStrength * 0.12, now + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045 + safeStrength * 0.07);
  if (stereo) stereo.pan.setValueAtTime(Math.max(-0.8, Math.min(0.8, pan)), now);

  source.connect(filter);
  filter.connect(gain);
  if (stereo) {
    gain.connect(stereo);
    stereo.connect(context.destination);
  } else {
    gain.connect(context.destination);
  }
  source.start(now);
  source.stop(now + 0.14);
}

function getNoiseBuffer(context: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === context.sampleRate) return noiseBuffer;
  const length = Math.round(context.sampleRate * 0.16);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const samples = buffer.getChannelData(0);
  let state = 0x6d2b79f5;
  for (let index = 0; index < samples.length; index += 1) {
    state = Math.imul(state ^ (state >>> 15), state | 1);
    samples[index] = (((state >>> 0) / 4294967296) * 2 - 1) * Math.exp(-index / (length * 0.22));
  }
  noiseBuffer = buffer;
  return buffer;
}

