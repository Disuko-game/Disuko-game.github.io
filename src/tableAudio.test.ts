import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("table sample playback", () => {
  const sources: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; playbackRate: { value: number }; buffer?: unknown }> = [];
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  let hiddenDocument: EventTarget & { hidden: boolean };
  let clock: { currentTime: number };
  let fetchAudio: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    sources.length = 0;
    hiddenDocument = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal("document", hiddenDocument);
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
    class FakeContext {
      currentTime = 1;
      state = "running";
      destination = {};
      constructor() { clock = this; }
      resume = () => Promise.resolve();
      createGain = () => ({ ...node(), gain: { value: 0, setValueAtTime: vi.fn() } });
      createDynamicsCompressor = () => ({ ...node(), threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} });
      createStereoPanner = () => ({ ...node(), pan: { value: 0 } });
      decodeAudioData = async (data: ArrayBuffer) => ({ name: new TextDecoder().decode(data) });
      createBufferSource = () => {
        const source = { ...node(), playbackRate: { value: 1 }, start: vi.fn(), stop: vi.fn() };
        sources.push(source);
        return source;
      };
    }
    vi.stubGlobal("window", Object.assign(new EventTarget(), { AudioContext: FakeContext }));
    fetchAudio = vi.fn(async (url: string) => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode(url).buffer }));
    vi.stubGlobal("fetch", fetchAudio);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function ready() {
    const audio = await import("./tableAudio");
    audio.unlockTableAudio();
    await vi.waitFor(() => expect(fetchAudio).toHaveBeenCalledTimes(25));
    await new Promise((resolve) => setTimeout(resolve, 0));
    return audio;
  }

  it("loads every local sample once across repeated unlock gestures", async () => {
    const audio = await ready();
    audio.unlockTableAudio();
    expect(fetchAudio).toHaveBeenCalledTimes(25);
    expect(fetchAudio.mock.calls.every(([url]) => url.includes("audio/table-v2/") && url.endsWith(".wav"))).toBe(true);
    audio.playTableCue("drop");
    expect(sources[0].start).toHaveBeenCalledOnce();
  });

  it("does not replay events that happened before decoding completed", async () => {
    const audio = await import("./tableAudio");
    audio.playTableCue("win");
    expect(sources).toHaveLength(0);
    audio.unlockTableAudio();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sources).toHaveLength(0);
  });

  it("stops active tails on mute and suppresses further playback", async () => {
    const audio = await ready();
    audio.playTableCue("win");
    audio.setTableSoundEnabled(false);
    expect(sources[0].stop).toHaveBeenCalledOnce();
    audio.playTableCue("drop");
    expect(sources).toHaveLength(1);
    audio.setTableSoundEnabled(true);
    audio.playTableCue("drop");
    expect(sources).toHaveLength(2);
  });

  it("limits dense collisions and preserves contact material", async () => {
    const audio = await ready();
    audio.playTableImpact("floor", 1, -1);
    audio.playTableImpact("wall", 1, 1);
    expect(sources).toHaveLength(1);
    // A plastic collision may sound alongside wood; duplicate pair reports may not.
    audio.playTableImpact("die", 0.2, 1);
    audio.playTableImpact("die", 0.2, 1);
    expect(sources).toHaveLength(2);
    clock.currentTime += 0.03;
    expect((sources[0].buffer as { name: string }).name).toContain("dice-floor-");
    expect((sources[1].buffer as { name: string }).name).toContain("dice-die-");
  });

  it("bounds simultaneous voices and stops audio when the tab is hidden", async () => {
    const audio = await ready();
    for (let i = 0; i < 20; i++) audio.playTableCue("drop");
    expect(sources.filter((source) => source.stop.mock.calls.length > 0)).toHaveLength(6);
    hiddenDocument.hidden = true;
    audio.installTableAudio();
    hiddenDocument.dispatchEvent(new Event("visibilitychange"));
    expect(sources.every((source) => source.stop.mock.calls.length > 0)).toBe(true);
    audio.playTableCue("win");
    expect(sources).toHaveLength(20);
  });
});
