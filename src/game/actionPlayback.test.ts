import { describe, expect, it } from "vitest";
import { shouldAnimateObservedAction } from "./actionPlayback";

describe("observed online action playback", () => {
  it("animates PCs and remote humans, but not the local human or an unknown actor", () => {
    expect(shouldAnimateObservedAction(undefined, "p1")).toBe(false);
    expect(shouldAnimateObservedAction({ id: "p1", controller: { kind: "human" } }, "p1")).toBe(false);
    expect(shouldAnimateObservedAction({ id: "p2", controller: { kind: "human" } }, "p1")).toBe(true);
    expect(
      shouldAnimateObservedAction(
        { id: "p2", controller: { kind: "bot", difficulty: "medium" } },
        "p1"
      )
    ).toBe(true);
  });
});