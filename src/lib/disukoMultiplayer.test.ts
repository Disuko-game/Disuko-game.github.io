import { describe, expect, it } from "vitest";
import { endAction, newGame } from "../game/engine";
import type { GameState } from "../game/types";
import {
  currentRoomStatus,
  normalizeAnonymousAuthError,
  optimisticRoomAfterGameCommit,
  playerNamesForRoom,
  turnProfileIdForGame,
  type RoomPlayer
} from "./disukoMultiplayer";
import type { DisukoProfileRow, DisukoRoomWithGameState } from "./supabase";

const createdAt = "2026-06-05T00:00:00.000Z";

function profile(id: string, displayName: string): DisukoProfileRow {
  return {
    id,
    display_name: displayName,
    friend_code: displayName.toUpperCase().slice(0, 6).padEnd(6, "2"),
    created_at: createdAt,
    updated_at: createdAt
  };
}

function room(game: GameState): DisukoRoomWithGameState {
  return {
    id: "room-1",
    room_code: "ABC123",
    host_profile_id: "profile-1",
    visibility: "public",
    status: "playing",
    player_count: 2,
    tabletop_mode: false,
    game_state: game,
    state_version: 4,
    turn_profile_id: "profile-1",
    created_at: createdAt,
    updated_at: createdAt,
    started_at: createdAt,
    finished_at: null
  };
}

function roomPlayers(): RoomPlayer[] {
  return [
    {
      room_id: "room-1",
      profile_id: "profile-1",
      seat_index: 0,
      is_host: true,
      joined_at: createdAt,
      profile: profile("profile-1", "Hermione")
    },
    {
      room_id: "room-1",
      profile_id: "profile-2",
      seat_index: 1,
      is_host: false,
      joined_at: createdAt,
      profile: profile("profile-2", "Ron")
    }
  ];
}

describe("Disuko multiplayer mapping", () => {
  it("maps Supabase room seats to engine player names", () => {
    expect(playerNamesForRoom(roomPlayers(), 2)).toEqual(["Hermione", "Ron"]);
  });

  it("maps the active engine player to the seated Supabase profile", () => {
    const game = newGame({ playerCount: 2, seed: "turns" });
    const nextTurn = endAction(game);

    expect(turnProfileIdForGame(roomPlayers(), game)).toBe("profile-1");
    expect(turnProfileIdForGame(roomPlayers(), nextTurn)).toBe("profile-2");
  });

  it("increments state version and advances the turn profile for optimistic commits", () => {
    const game = newGame({ playerCount: 2, seed: "commit" });
    const nextTurn = endAction(game);
    const optimistic = optimisticRoomAfterGameCommit(room(game), roomPlayers(), "profile-1", nextTurn);

    expect(optimistic?.state_version).toBe(5);
    expect(optimistic?.turn_profile_id).toBe("profile-2");
    expect(optimistic?.game_state?.turnNumber).toBe(2);
  });

  it("marks a won game finished and keeps the winner as the turn profile", () => {
    const game = newGame({ playerCount: 2, seed: "won" });
    const wonGame: GameState = {
      ...game,
      phase: "won",
      winnerId: "p1"
    };
    const optimistic = optimisticRoomAfterGameCommit(room(game), roomPlayers(), "profile-1", wonGame);

    expect(optimistic?.status).toBe("finished");
    expect(optimistic?.turn_profile_id).toBe("profile-1");
    expect(optimistic?.finished_at).not.toBeNull();
  });

  it("labels current rooms by async turn state", () => {
    const game = newGame({ playerCount: 2, seed: "current-rooms" });
    const playingRoom = room(game);

    expect(currentRoomStatus(playingRoom, "profile-1")).toBe("your-turn");
    expect(currentRoomStatus({ ...playingRoom, turn_profile_id: "profile-2" }, "profile-1")).toBe("waiting");
    expect(currentRoomStatus({ ...playingRoom, status: "lobby", turn_profile_id: null }, "profile-1")).toBe("lobby");
    expect(currentRoomStatus({ ...playingRoom, status: "finished" }, "profile-1")).toBe("finished");
  });

  it("turns anonymous-auth 422 errors into setup guidance", () => {
    const normalized = normalizeAnonymousAuthError({ status: 422, message: "Anonymous sign-ins are disabled" });

    expect(normalized.message).toContain("anonymous sign-ins are disabled");
  });
});
