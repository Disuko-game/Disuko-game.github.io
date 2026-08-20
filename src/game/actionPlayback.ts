import type { Player } from "./types";

type ActionActor = Pick<Player, "id" | "controller">;

export function shouldAnimateObservedAction(actor: ActionActor | undefined, onlinePlayerId?: string): boolean {
  if (!actor) {
    return false;
  }

  return actor.controller.kind === "bot" || (onlinePlayerId !== undefined && actor.id !== onlinePlayerId);
}