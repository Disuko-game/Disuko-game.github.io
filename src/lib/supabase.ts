import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { GameState } from "../game/types";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      disuko_profiles: {
        Row: {
          id: string;
          display_name: string;
          friend_code: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          friend_code: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          display_name?: string;
          friend_code?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      disuko_friend_requests: {
        Row: {
          id: string;
          requester_profile_id: string;
          recipient_profile_id: string;
          status: "pending" | "accepted" | "declined" | "canceled";
          created_at: string;
          responded_at: string | null;
        };
        Insert: {
          id?: string;
          requester_profile_id: string;
          recipient_profile_id: string;
          status?: "pending" | "accepted" | "declined" | "canceled";
          created_at?: string;
          responded_at?: string | null;
        };
        Update: {
          status?: "pending" | "accepted" | "declined" | "canceled";
          responded_at?: string | null;
        };
        Relationships: [];
      };
      disuko_rooms: {
        Row: {
          id: string;
          room_code: string;
          host_profile_id: string;
          visibility: "private" | "friends" | "public";
          status: "lobby" | "playing" | "finished";
          player_count: number;
          tabletop_mode: boolean;
          game_state: Json | null;
          state_version: number;
          turn_profile_id: string | null;
          created_at: string;
          updated_at: string;
          started_at: string | null;
          finished_at: string | null;
        };
        Insert: {
          id?: string;
          room_code: string;
          host_profile_id: string;
          visibility?: "private" | "friends" | "public";
          status?: "lobby" | "playing" | "finished";
          player_count: number;
          tabletop_mode?: boolean;
          game_state?: Json | null;
          state_version?: number;
          turn_profile_id?: string | null;
          created_at?: string;
          updated_at?: string;
          started_at?: string | null;
          finished_at?: string | null;
        };
        Update: {
          visibility?: "private" | "friends" | "public";
          status?: "lobby" | "playing" | "finished";
          player_count?: number;
          tabletop_mode?: boolean;
          game_state?: Json | null;
          state_version?: number;
          turn_profile_id?: string | null;
          updated_at?: string;
          started_at?: string | null;
          finished_at?: string | null;
        };
        Relationships: [];
      };
      disuko_room_players: {
        Row: {
          room_id: string;
          profile_id: string;
          seat_index: number;
          is_host: boolean;
          joined_at: string;
        };
        Insert: {
          room_id: string;
          profile_id: string;
          seat_index: number;
          is_host?: boolean;
          joined_at?: string;
        };
        Update: {
          seat_index?: number;
          is_host?: boolean;
        };
        Relationships: [];
      };
      disuko_room_invites: {
        Row: {
          id: string;
          room_id: string;
          sender_profile_id: string;
          recipient_profile_id: string;
          status: "pending" | "accepted" | "declined" | "canceled";
          created_at: string;
          responded_at: string | null;
        };
        Insert: {
          id?: string;
          room_id: string;
          sender_profile_id: string;
          recipient_profile_id: string;
          status?: "pending" | "accepted" | "declined" | "canceled";
          created_at?: string;
          responded_at?: string | null;
        };
        Update: {
          status?: "pending" | "accepted" | "declined" | "canceled";
          responded_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type DisukoProfileRow = Database["public"]["Tables"]["disuko_profiles"]["Row"];
export type DisukoFriendRequestRow = Database["public"]["Tables"]["disuko_friend_requests"]["Row"];
export type DisukoRoomRow = Database["public"]["Tables"]["disuko_rooms"]["Row"];
export type DisukoRoomPlayerRow = Database["public"]["Tables"]["disuko_room_players"]["Row"];
export type DisukoRoomInviteRow = Database["public"]["Tables"]["disuko_room_invites"]["Row"];

export type DisukoRoomWithGameState = Omit<DisukoRoomRow, "game_state"> & {
  game_state: GameState | null;
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
let client: SupabaseClient<Database> | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabasePublishableKey && !supabasePublishableKey.startsWith("replace-with"));
}

export function getSupabaseClient(): SupabaseClient<Database> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured. Add VITE_SUPABASE_PUBLISHABLE_KEY to .env.local.");
  }

  client ??= createClient<Database>(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  return client;
}
