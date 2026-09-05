import { describe, expect, it } from "vitest";
import { renderingQuality } from "./renderQuality";

describe("mobile rendering budget", () => {
  it("limits phone resolution, shadows, antialiasing and frame rate", () => {
    expect(renderingQuality(true, 3)).toEqual({ mobile: true, pixelRatio: 1.25, shadowSize: 0, frameInterval: 1000 / 30, antialias: false });
  });
  it("keeps desktop detail without upscaling low-density displays", () => {
    expect(renderingQuality(false, 3).pixelRatio).toBe(2);
    expect(renderingQuality(true, 1).pixelRatio).toBe(1);
    expect(renderingQuality(false, 1).shadowSize).toBe(2048);
  });
});
