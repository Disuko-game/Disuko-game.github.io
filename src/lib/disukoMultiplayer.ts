import { newGame } from "../game/engine";
import type { GameState, NewGameOptions } from "../game/types";
import {
  getSupabaseClient,
  type DisukoFriendRequestRow,
  type DisukoProfileRow,
  type DisukoRoomInviteRow,
  type DisukoRoomPlayerRow,
  type DisukoRoomRow,
  type DisukoRoomWithGameState,
  type Json
} from "./supabase";

export type RoomVisibility = DisukoRoomRow["visibility"];

export interface FriendSummary {
  profile: DisukoProfileRow;
  request: DisukoFriendRequestRow;
}

export interface FriendsState {
  friends: FriendSummary[];
  incoming: FriendSummary[];
  outgoing: FriendSummary[];
}

export interface RoomPlayer extends DisukoRoomPlayerRow {
  profile: DisukoProfileRow;
}

export interface RoomPendingInvite {
  invite: DisukoRoomInviteRow;
  sender: DisukoProfileRow | null;
  recipient: DisukoProfileRow;
}

export interface RoomBundle {
  room: DisukoRoomWithGameState;
  players: RoomPlayer[];
  pendingInvites: RoomPendingInvite[];
}

export interface PublicRoomSummary {
  room: DisukoRoomWithGameState;
  host: DisukoProfileRow | null;
  joinedSeats: number;
}

export interface CurrentRoomSummary {
  room: DisukoRoomWithGameState;
  players: RoomPlayer[];
  seat: RoomPlayer;
}

export interface RoomInviteSummary {
  invite: DisukoRoomInviteRow;
  room: DisukoRoomWithGameState | null;
  sender: DisukoProfileRow | null;
}

export type CurrentRoomStatus = "your-turn" | "waiting" | "lobby" | "finished";

export interface GameCommitResult {
  ok: boolean;
  reason?: "not-your-turn" | "stale-state" | "missing-seat";
  room?: DisukoRoomWithGameState;
}

const FRIEND_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
let anonymousUserPromise: Promise<string> | null = null;
let realtimeSubscriptionSequence = 0;

export function generateFriendCode(): string {
  return generateCode(FRIEND_CODE_ALPHABET, 8);
}

export function generateRoomCode(): string {
  return generateCode(ROOM_CODE_ALPHABET, 6);
}

export function playerIdForSeat(seatIndex: number): string {
  return `p${seatIndex + 1}`;
}

export function seatIndexForPlayerId(playerId: string): number | null {
  const match = /^p([1-4])$/u.exec(playerId);
  return match ? Number(match[1]) - 1 : null;
}

export function profileIdForGamePlayer(players: RoomPlayer[], playerId: string | undefined): string | null {
  if (!playerId) {
    return null;
  }

  const seatIndex = seatIndexForPlayerId(playerId);

  if (seatIndex === null) {
    return null;
  }

  return players.find((player) => player.seat_index === seatIndex)?.profile_id ?? null;
}

export function turnProfileIdForGame(players: RoomPlayer[], game: GameState): string | null {
  return players.find((player) => player.seat_index === game.currentPlayerIndex)?.profile_id ?? null;
}

export function playerNamesForRoom(players: RoomPlayer[], playerCount: NewGameOptions["playerCount"]): string[] {
  return Array.from({ length: playerCount }, (_, index) => {
    return players.find((player) => player.seat_index === index)?.profile.display_name ?? `Player ${index + 1}`;
  });
}

export function currentRoomStatus(room: DisukoRoomWithGameState, profileId: string): CurrentRoomStatus {
  if (room.status === "finished") {
    return "finished";
  }

  if (room.status === "lobby" || !room.turn_profile_id) {
    return "lobby";
  }

  return room.turn_profile_id === profileId ? "your-turn" : "waiting";
}

export function optimisticRoomAfterGameCommit(
  room: DisukoRoomWithGameState,
  players: RoomPlayer[],
  profileId: string,
  nextGame: GameState
): DisukoRoomWithGameState | null {
  const nextTurnProfileId = nextGame.phase === "won"
    ? profileIdForGamePlayer(players, nextGame.winnerId) ?? profileId
    : turnProfileIdForGame(players, nextGame);

  if (!nextTurnProfileId) {
    return null;
  }

  return {
    ...room,
    game_state: nextGame,
    state_version: room.state_version + 1,
    turn_profile_id: nextTurnProfileId,
    status: nextGame.phase === "won" ? "finished" : room.status,
    finished_at: nextGame.phase === "won" ? new Date().toISOString() : room.finished_at
  };
}

export async function ensureAnonymousUser(): Promise<string> {
  anonymousUserPromise ??= resolveAnonymousUser().catch((error: unknown) => {
    anonymousUserPromise = null;
    throw error;
  });

  return anonymousUserPromise;
}

async function resolveAnonymousUser(): Promise<string> {
  const supabase = getSupabaseClient();
  const sessionResult = await supabase.auth.getSession();

  if (sessionResult.error) {
    throw sessionResult.error;
  }

  if (sessionResult.data.session?.user.id) {
    return sessionResult.data.session.user.id;
  }

  const signInResult = await supabase.auth.signInAnonymously();

  if (signInResult.error) {
    throw normalizeAnonymousAuthError(signInResult.error);
  }

  const userId = signInResult.data.user?.id;

  if (!userId) {
    throw new Error("Supabase did not return an anonymous user.");
  }

  return userId;
}

export function normalizeAnonymousAuthError(error: unknown): Error {
  if (!isAuth422(error)) {
    return error instanceof Error ? error : new Error("Could not sign in anonymously.");
  }

  return new Error(
    "Supabase anonymous sign-ins are disabled for this project. Enable Anonymous Sign-Ins in the Supabase Auth dashboard, then reload Disuko."
  );
}

export async function loadCurrentProfile(): Promise<DisukoProfileRow | null> {
  const userId = await ensureAnonymousUser();
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("disuko_profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function createCurrentProfile(displayName: string): Promise<DisukoProfileRow> {
  const userId = await ensureAnonymousUser();
  const supabase = getSupabaseClient();
  const trimmedName = displayName.trim();

  if (!trimmedName) {
    throw new Error("Choose a display name.");
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await supabase
      .from("disuko_profiles")
      .insert({
        id: userId,
        display_name: trimmedName.slice(0, 32),
        friend_code: generateFriendCode()
      })
      .select("*")
      .single();

    if (!error && data) {
      return data;
    }

    if (!isUniqueViolation(error)) {
      throw error;
    }
  }

  throw new Error("Could not create a unique friend code. Try again.");
}

export async function updateCurrentProfileName(profileId: string, displayName: string): Promise<DisukoProfileRow> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("disuko_profiles")
    .update({ display_name: displayName.trim().slice(0, 32) })
    .eq("id", profileId)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function loadFriendsState(profileId: string): Promise<FriendsState> {
  const supabase = getSupabaseClient();
  const { data: requests, error } = await supabase
    .from("disuko_friend_requests")
    .select("*")
    .or(`requester_profile_id.eq.${profileId},recipient_profile_id.eq.${profileId}`)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  const profileIds = [...new Set((requests ?? []).flatMap((request) => [request.requester_profile_id, request.recipient_profile_id]))];
  const profiles = await loadProfilesByIds(profileIds);

  const state: FriendsState = {
    friends: [],
    incoming: [],
    outgoing: []
  };

  (requests ?? []).forEach((request) => {
    const otherProfileId = request.requester_profile_id === profileId ? request.recipient_profile_id : request.requester_profile_id;
    const otherProfile = profiles.get(otherProfileId);

    if (!otherProfile) {
      return;
    }

    const summary = { profile: otherProfile, request };

    if (request.status === "accepted") {
      state.friends.push(summary);
    } else if (request.status === "pending" && request.recipient_profile_id === profileId) {
      state.incoming.push(summary);
    } else if (request.status === "pending" && request.requester_profile_id === profileId) {
      state.outgoing.push(summary);
    }
  });

  return state;
}

export async function sendFriendRequest(profileId: string, friendCode: string): Promise<void> {
  const supabase = getSupabaseClient();
  const normalizedCode = friendCode.trim().toUpperCase();
  const { data: recipient, error: recipientError } = await supabase
    .from("disuko_profiles")
    .select("*")
    .eq("friend_code", normalizedCode)
    .maybeSingle();

  if (recipientError) {
    throw recipientError;
  }

  if (!recipient) {
    throw new Error("No player has that friend code.");
  }

  if (recipient.id === profileId) {
    throw new Error("You cannot add yourself.");
  }

  const { error } = await supabase.from("disuko_friend_requests").insert({
    requester_profile_id: profileId,
    recipient_profile_id: recipient.id
  });

  if (error) {
    throw error;
  }
}

export async function respondToFriendRequest(requestId: string, status: "accepted" | "declined" | "canceled"): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("disuko_friend_requests")
    .update({ status, responded_at: new Date().toISOString() })
    .eq("id", requestId);

  if (error) {
    throw error;
  }
}

export async function createRoom(
  profileId: string,
  options: { playerCount: 2 | 3 | 4; visibility: RoomVisibility }
): Promise<RoomBundle> {
  const supabase = getSupabaseClient();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: room, error: roomError } = await supabase
      .from("disuko_rooms")
      .insert({
        room_code: generateRoomCode(),
        host_profile_id: profileId,
        visibility: options.visibility,
        player_count: options.playerCount,
        tabletop_mode: false
      })
      .select("*")
      .single();

    if (roomError) {
      if (isUniqueViolation(roomError)) {
        continue;
      }

      throw roomError;
    }

    const { error: playerError } = await supabase.from("disuko_room_players").insert({
      room_id: room.id,
      profile_id: profileId,
      seat_index: 0,
      is_host: true
    });

    if (playerError) {
      await supabase.from("disuko_rooms").delete().eq("id", room.id);
      throw playerError;
    }

    return loadRoomBundle(room.id);
  }

  throw new Error("Could not create a unique room code. Try again.");
}

export async function loadPublicRooms(): Promise<PublicRoomSummary[]> {
  const supabase = getSupabaseClient();
  const { data: rooms, error } = await supabase
    .from("disuko_rooms")
    .select("*")
    .eq("visibility", "public")
    .eq("status", "lobby")
    .order("updated_at", { ascending: false })
    .limit(20);

  if (error) {
    throw error;
  }

  const roomIds = (rooms ?? []).map((room) => room.id);
  const hostIds = [...new Set((rooms ?? []).map((room) => room.host_profile_id))];
  const [playersByRoom, profiles] = await Promise.all([loadRoomPlayerCounts(roomIds), loadProfilesByIds(hostIds)]);

  return (rooms ?? []).map((room) => ({
    room: castRoom(rowToRoom(room)),
    host: profiles.get(room.host_profile_id) ?? null,
    joinedSeats: playersByRoom.get(room.id) ?? 0
  }));
}

export async function loadCurrentRooms(profileId: string): Promise<CurrentRoomSummary[]> {
  const supabase = getSupabaseClient();
  const { data: seats, error } = await supabase
    .from("disuko_room_players")
    .select("*")
    .eq("profile_id", profileId)
    .order("joined_at", { ascending: false });

  if (error) {
    throw error;
  }

  const summaries = await Promise.all(
    (seats ?? []).map(async (seat) => {
      const bundle = await loadRoomBundle(seat.room_id);
      const hydratedSeat = bundle.players.find((player) => player.profile_id === profileId);

      return hydratedSeat
        ? {
            room: bundle.room,
            players: bundle.players,
            seat: hydratedSeat
          }
        : null;
    })
  );

  return summaries
    .filter((summary): summary is CurrentRoomSummary => Boolean(summary))
    .sort((left, right) => compareCurrentRooms(left, right, profileId));
}

export async function joinRoomByCode(profileId: string, roomCode: string): Promise<RoomBundle> {
  const supabase = getSupabaseClient();
  const { data: room, error } = await supabase
    .from("disuko_rooms")
    .select("*")
    .eq("room_code", roomCode.trim().toUpperCase())
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!room) {
    throw new Error("No room has that code.");
  }

  return joinRoom(profileId, room.id);
}

export async function joinRoom(profileId: string, roomId: string): Promise<RoomBundle> {
  const bundle = await loadRoomBundle(roomId);

  if (bundle.players.some((player) => player.profile_id === profileId)) {
    return startRoomIfReady(bundle);
  }

  if (bundle.room.status !== "lobby") {
    throw new Error("That game has already started.");
  }

  const occupiedSeats = new Set(bundle.players.map((player) => player.seat_index));
  const seatIndex = Array.from({ length: bundle.room.player_count }, (_, index) => index).find(
    (index) => !occupiedSeats.has(index)
  );

  if (seatIndex === undefined) {
    throw new Error("That room is full.");
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("disuko_room_players").insert({
    room_id: roomId,
    profile_id: profileId,
    seat_index: seatIndex,
    is_host: false
  });

  if (error) {
    if (isUniqueViolation(error)) {
      const latestBundle = await loadRoomBundle(roomId);

      if (latestBundle.players.some((player) => player.profile_id === profileId)) {
        return startRoomIfReady(latestBundle);
      }

      const latestOccupiedSeats = new Set(latestBundle.players.map((player) => player.seat_index));
      const nextSeatIndex = Array.from({ length: latestBundle.room.player_count }, (_, index) => index).find(
        (index) => !latestOccupiedSeats.has(index)
      );

      if (nextSeatIndex !== undefined && nextSeatIndex !== seatIndex && latestBundle.room.status === "lobby") {
        const { error: retryError } = await supabase.from("disuko_room_players").insert({
          room_id: roomId,
          profile_id: profileId,
          seat_index: nextSeatIndex,
          is_host: false
        });

        if (!retryError || isUniqueViolation(retryError)) {
          const retryBundle = await loadRoomBundle(roomId);

          if (retryBundle.players.some((player) => player.profile_id === profileId)) {
            return startRoomIfReady(retryBundle);
          }
        }

        if (retryError) {
          throw retryError;
        }
      }
    }

    throw error;
  }

  return startRoomIfReady(await loadRoomBundle(roomId));
}

export async function leaveRoom(profileId: string, roomId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("disuko_room_players")
    .delete()
    .eq("room_id", roomId)
    .eq("profile_id", profileId);

  if (error) {
    throw error;
  }
}

export async function inviteFriendToRoom(roomId: string, senderProfileId: string, recipientProfileId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: existingInvite, error: existingError } = await supabase
    .from("disuko_room_invites")
    .select("id")
    .eq("room_id", roomId)
    .eq("recipient_profile_id", recipientProfileId)
    .eq("status", "pending")
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existingInvite) {
    return;
  }

  const { error } = await supabase.from("disuko_room_invites").insert({
    room_id: roomId,
    sender_profile_id: senderProfileId,
    recipient_profile_id: recipientProfileId
  });

  if (error) {
    if (isUniqueViolation(error)) {
      return;
    }

    throw error;
  }
}

export async function loadRoomInvites(profileId: string): Promise<RoomInviteSummary[]> {
  const supabase = getSupabaseClient();
  const { data: invites, error } = await supabase
    .from("disuko_room_invites")
    .select("*")
    .eq("recipient_profile_id", profileId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  const roomIds = [...new Set((invites ?? []).map((invite) => invite.room_id))];
  const senderIds = [...new Set((invites ?? []).map((invite) => invite.sender_profile_id))];
  const [rooms, senders] = await Promise.all([loadRoomsByIds(roomIds), loadProfilesByIds(senderIds)]);

  return (invites ?? []).map((invite) => ({
    invite,
    room: rooms.get(invite.room_id) ?? null,
    sender: senders.get(invite.sender_profile_id) ?? null
  }));
}

export async function respondToRoomInvite(
  invite: DisukoRoomInviteRow,
  profileId: string,
  status: "accepted" | "declined" | "canceled"
): Promise<RoomBundle | null> {
  let bundle: RoomBundle | null = null;

  if (status === "accepted") {
    bundle = await joinRoom(profileId, invite.room_id);
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("disuko_room_invites")
    .update({ status, responded_at: new Date().toISOString() })
    .eq("id", invite.id);

  if (error) {
    throw error;
  }

  return bundle;
}

export async function loadRoomBundle(roomId: string): Promise<RoomBundle> {
  const supabase = getSupabaseClient();
  const { data: room, error: roomError } = await supabase.from("disuko_rooms").select("*").eq("id", roomId).single();

  if (roomError) {
    throw roomError;
  }

  const { data: roomPlayers, error: playersError } = await supabase
    .from("disuko_room_players")
    .select("*")
    .eq("room_id", roomId)
    .order("seat_index", { ascending: true });

  if (playersError) {
    throw playersError;
  }

  const { data: roomInvites, error: invitesError } = await supabase
    .from("disuko_room_invites")
    .select("*")
    .eq("room_id", roomId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (invitesError) {
    throw invitesError;
  }

  const profileIds = [
    ...(roomPlayers ?? []).map((player) => player.profile_id),
    ...(roomInvites ?? []).flatMap((invite) => [invite.sender_profile_id, invite.recipient_profile_id])
  ];
  const profiles = await loadProfilesByIds(profileIds);
  const players = (roomPlayers ?? [])
    .map((player) => {
      const profile = profiles.get(player.profile_id);
      return profile ? { ...player, profile } : null;
    })
    .filter((player): player is RoomPlayer => Boolean(player));
  const pendingInvites = (roomInvites ?? [])
    .map((invite) => {
      const recipient = profiles.get(invite.recipient_profile_id);

      return recipient
        ? {
            invite,
            sender: profiles.get(invite.sender_profile_id) ?? null,
            recipient
          }
        : null;
    })
    .filter((invite): invite is RoomPendingInvite => Boolean(invite));

  return {
    room: castRoom(rowToRoom(room)),
    players,
    pendingInvites
  };
}

export async function startRoomGame(bundle: RoomBundle): Promise<RoomBundle> {
  if (bundle.room.status !== "lobby") {
    return bundle;
  }

  if (bundle.players.length !== bundle.room.player_count) {
    throw new Error("The room needs every seat filled before starting.");
  }

  const playerCount = bundle.room.player_count as 2 | 3 | 4;
  const game = newGame({
    playerCount,
    seed: bundle.room.room_code,
    tabletopMode: false,
    playerNames: playerNamesForRoom(bundle.players, playerCount)
  });
  const firstTurnProfileId = turnProfileIdForGame(bundle.players, game);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("disuko_rooms")
    .update({
      status: "playing",
      game_state: game as unknown as Json,
      state_version: bundle.room.state_version + 1,
      turn_profile_id: firstTurnProfileId,
      started_at: new Date().toISOString()
    })
    .eq("id", bundle.room.id)
    .eq("status", "lobby")
    .eq("state_version", bundle.room.state_version)
    .select("*")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("The room changed before the game could start.");
  }

  return loadRoomBundle(bundle.room.id);
}

export async function startRoomIfReady(bundle: RoomBundle): Promise<RoomBundle> {
  if (bundle.room.status !== "lobby" || bundle.players.length !== bundle.room.player_count) {
    return bundle;
  }

  try {
    return await startRoomGame(bundle);
  } catch (error) {
    if (isRoomChangedError(error)) {
      return loadRoomBundle(bundle.room.id);
    }

    throw error;
  }
}

export async function commitRoomGameState(
  room: DisukoRoomWithGameState,
  players: RoomPlayer[],
  profileId: string,
  nextGame: GameState
): Promise<GameCommitResult> {
  if (!room.game_state) {
    return { ok: false, reason: "missing-seat" };
  }

  if (room.turn_profile_id && room.turn_profile_id !== profileId) {
    return { ok: false, reason: "not-your-turn" };
  }

  const optimisticRoom = optimisticRoomAfterGameCommit(room, players, profileId, nextGame);

  if (!optimisticRoom) {
    return { ok: false, reason: "missing-seat" };
  }

  const update = {
    game_state: nextGame as unknown as Json,
    state_version: optimisticRoom.state_version,
    turn_profile_id: optimisticRoom.turn_profile_id,
    status: optimisticRoom.status,
    finished_at: optimisticRoom.finished_at
  };
  const supabase = getSupabaseClient();
  const query = supabase
    .from("disuko_rooms")
    .update(update)
    .eq("id", room.id)
    .eq("state_version", room.state_version);

  const { data, error } = await (room.turn_profile_id ? query.eq("turn_profile_id", room.turn_profile_id) : query)
    .select("*")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return { ok: false, reason: "stale-state" };
  }

  return {
    ok: true,
    room: castRoom(rowToRoom(data))
  };
}

export function subscribeToRoom(roomId: string, onChange: () => void): () => void {
  const supabase = getSupabaseClient();
  const channel = supabase
    .channel(nextRealtimeChannelName(`disuko-room:${roomId}`))
    .on("postgres_changes", roomChange("disuko_rooms", `id=eq.${roomId}`), onChange)
    .on("postgres_changes", roomChange("disuko_room_players", `room_id=eq.${roomId}`), onChange)
    .on("postgres_changes", roomChange("disuko_room_invites", `room_id=eq.${roomId}`), onChange)
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToPlayerEvents(profileId: string, onChange: () => void): () => void {
  const supabase = getSupabaseClient();
  const channel = supabase
    .channel(nextRealtimeChannelName(`disuko-player:${profileId}`))
    .on("postgres_changes", roomChange("disuko_friend_requests", `requester_profile_id=eq.${profileId}`), onChange)
    .on("postgres_changes", roomChange("disuko_friend_requests", `recipient_profile_id=eq.${profileId}`), onChange)
    .on("postgres_changes", roomChange("disuko_room_players", `profile_id=eq.${profileId}`), onChange)
    .on("postgres_changes", roomChange("disuko_room_invites", `recipient_profile_id=eq.${profileId}`), onChange)
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

function generateCode(alphabet: string, length: number): string {
  const cryptoApi = globalThis.crypto;
  const values = new Uint32Array(length);

  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(values);
  } else {
    for (let index = 0; index < values.length; index += 1) {
      values[index] = Math.floor(Math.random() * alphabet.length);
    }
  }

  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

function isRoomChangedError(error: unknown): boolean {
  return error instanceof Error && error.message === "The room changed before the game could start.";
}

function isAuth422(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (
        ("status" in error && error.status === 422) ||
        ("code" in error && error.code === "validation_failed") ||
        ("message" in error &&
          typeof error.message === "string" &&
          error.message.toLowerCase().includes("anonymous"))
      )
  );
}

function nextRealtimeChannelName(baseName: string): string {
  realtimeSubscriptionSequence = (realtimeSubscriptionSequence + 1) % Number.MAX_SAFE_INTEGER;

  return `${baseName}:${Date.now().toString(36)}:${realtimeSubscriptionSequence}`;
}

function rowToRoom(room: DisukoRoomRow): DisukoRoomWithGameState {
  return {
    ...room,
    game_state: room.game_state as unknown as GameState | null
  };
}

function castRoom(room: DisukoRoomWithGameState): DisukoRoomWithGameState {
  return room;
}

function compareCurrentRooms(left: CurrentRoomSummary, right: CurrentRoomSummary, profileId: string): number {
  const priority: Record<CurrentRoomStatus, number> = {
    "your-turn": 0,
    lobby: 1,
    waiting: 2,
    finished: 3
  };
  const statusDifference = priority[currentRoomStatus(left.room, profileId)] - priority[currentRoomStatus(right.room, profileId)];

  if (statusDifference !== 0) {
    return statusDifference;
  }

  return Date.parse(right.room.updated_at) - Date.parse(left.room.updated_at);
}

async function loadProfilesByIds(profileIds: string[]): Promise<Map<string, DisukoProfileRow>> {
  const uniqueIds = [...new Set(profileIds)].filter(Boolean);

  if (uniqueIds.length === 0) {
    return new Map();
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("disuko_profiles").select("*").in("id", uniqueIds);

  if (error) {
    throw error;
  }

  return new Map((data ?? []).map((profile) => [profile.id, profile]));
}

async function loadRoomPlayerCounts(roomIds: string[]): Promise<Map<string, number>> {
  if (roomIds.length === 0) {
    return new Map();
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("disuko_room_players").select("room_id").in("room_id", roomIds);

  if (error) {
    throw error;
  }

  const counts = new Map<string, number>();

  (data ?? []).forEach((row) => {
    counts.set(row.room_id, (counts.get(row.room_id) ?? 0) + 1);
  });

  return counts;
}

async function loadRoomsByIds(roomIds: string[]): Promise<Map<string, DisukoRoomWithGameState>> {
  const uniqueIds = [...new Set(roomIds)].filter(Boolean);

  if (uniqueIds.length === 0) {
    return new Map();
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("disuko_rooms").select("*").in("id", uniqueIds);

  if (error) {
    throw error;
  }

  return new Map((data ?? []).map((room) => [room.id, rowToRoom(room)]));
}

function roomChange(
  table: "disuko_rooms" | "disuko_room_players" | "disuko_room_invites" | "disuko_friend_requests",
  filter: string
) {
  return {
    event: "*" as const,
    schema: "public",
    table,
    filter
  };
}
