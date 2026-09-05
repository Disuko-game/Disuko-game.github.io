import { afterEach, describe, expect, it, vi } from "vitest";
import { RollPhysicsClient } from "./rollPhysicsClient";

afterEach(() => vi.useRealTimers());
function setup() {
  const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null as any, onerror: null as any, onmessageerror: null as any };
  const create = vi.fn(() => worker as unknown as Worker);
  return { worker, create, client: new RollPhysicsClient(create) };
}
describe("background roll physics", () => {
  it("reuses one worker and matches out-of-order responses to callers", async () => {
    const { worker, create, client } = setup();
    const first = client.request({ count: 2, variant: 7 });
    const second = client.request({ count: 4, variant: 8, playerIndexes: [0, 1, 2, 3] });
    expect(create).toHaveBeenCalledOnce();
    const template = { count: 4 };
    worker.onmessage({ data: { id: 2, template } });
    worker.onmessage({ data: { id: 1 } });
    await expect(second).resolves.toBe(template);
    await expect(first).resolves.toBeUndefined();
    client.dispose();
  });
  it("terminates hung preparation and allows a fresh worker next time", async () => {
    vi.useFakeTimers();
    const { worker, create, client } = setup();
    const pending = expect(client.request({ count: 18 })).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(15000);
    await pending;
    expect(worker.terminate).toHaveBeenCalledOnce();
    const retry = client.request();
    worker.onmessage({ data: { id: 2 } });
    await retry;
    expect(create).toHaveBeenCalledTimes(2);
    client.dispose();
  });
  it("rejects all pending requests on worker failure", async () => {
    const { worker, client } = setup();
    const a = expect(client.request()).rejects.toThrow("worker failed");
    const b = expect(client.request({ count: 6 })).rejects.toThrow("worker failed");
    worker.onerror();
    await Promise.all([a, b]);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("surfaces preparation errors instead of simulating on the UI thread", async () => {
    const { worker, client } = setup();
    const failure = expect(client.request({ count: 1 })).rejects.toThrow("unavailable");
    worker.onmessage({ data: { id: 1, error: "unavailable" } });
    await failure;
    client.dispose();
  });
});
