import { describe, expect, it } from "vitest";
import { playerColorForOwner } from "./StaticDie3D";

describe("live 3D dice", () => {
  it("maps every engine seat to the same player color used by rolling dice", () => {
    expect(playerColorForOwner("p1")).toBe("blue");
    expect(playerColorForOwner("p2")).toBe("red");
    expect(playerColorForOwner("p3")).toBe("green");
    expect(playerColorForOwner("p4")).toBe("yellow");
  });

  it("falls back safely for restored dice with an unknown owner", () => {
    expect(playerColorForOwner("legacy-player")).toBe("blue");
  });
});