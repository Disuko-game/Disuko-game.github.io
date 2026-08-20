import type { PlayerColor } from "./game/types";

const COLOR_BY_OWNER: Record<string, PlayerColor> = {
  p1: "blue",
  p2: "red",
  p3: "green",
  p4: "yellow"
};

export function playerColorForOwner(ownerId: string): PlayerColor {
  return COLOR_BY_OWNER[ownerId] ?? "blue";
}