import { getOpeningRollTumbleTemplate, getRerollTumbleTemplate, preloadRerollPhysics } from "./rerollTumbles";
import type { PhysicsRequest, PhysicsResponse } from "./rollPhysicsClient";

self.onmessage = async ({ data }: MessageEvent<PhysicsRequest>) => {
  try {
    if (data.count === undefined) {
      await preloadRerollPhysics();
      self.postMessage({ id: data.id } satisfies PhysicsResponse);
      return;
    }
    const template = await (data.playerIndexes
      ? getOpeningRollTumbleTemplate(data.playerIndexes, data.variant ?? 0)
      : getRerollTumbleTemplate(data.count, data.variant ?? 0));
    // Structured clone preserves the cached sample buffers in this worker.
    self.postMessage({ id: data.id, template } satisfies PhysicsResponse);
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error) } satisfies PhysicsResponse);
  }
};
