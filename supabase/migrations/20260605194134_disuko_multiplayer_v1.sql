create table if not exists public.disuko_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 32),
  friend_code text not null unique check (friend_code ~ '^[A-Z0-9]{6,10}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.disuko_friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_profile_id uuid not null references public.disuko_profiles (id) on delete cascade,
  recipient_profile_id uuid not null references public.disuko_profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'canceled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_profile_id <> recipient_profile_id)
);

create unique index if not exists disuko_friend_requests_open_pair_idx
  on public.disuko_friend_requests (
    least(requester_profile_id, recipient_profile_id),
    greatest(requester_profile_id, recipient_profile_id)
  )
  where status in ('pending', 'accepted');

create table if not exists public.disuko_rooms (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique check (room_code ~ '^[A-Z0-9]{5,10}$'),
  host_profile_id uuid not null references public.disuko_profiles (id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('private', 'friends', 'public')),
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'finished')),
  player_count smallint not null check (player_count between 2 and 4),
  tabletop_mode boolean not null default false,
  game_state jsonb,
  state_version integer not null default 0 check (state_version >= 0),
  turn_profile_id uuid references public.disuko_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists disuko_rooms_public_lobby_idx
  on public.disuko_rooms (updated_at desc)
  where visibility = 'public' and status = 'lobby';

create table if not exists public.disuko_room_players (
  room_id uuid not null references public.disuko_rooms (id) on delete cascade,
  profile_id uuid not null references public.disuko_profiles (id) on delete cascade,
  seat_index smallint not null check (seat_index between 0 and 3),
  is_host boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (room_id, profile_id),
  unique (room_id, seat_index)
);

create table if not exists public.disuko_room_invites (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.disuko_rooms (id) on delete cascade,
  sender_profile_id uuid not null references public.disuko_profiles (id) on delete cascade,
  recipient_profile_id uuid not null references public.disuko_profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'canceled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (sender_profile_id <> recipient_profile_id)
);

create unique index if not exists disuko_room_invites_pending_idx
  on public.disuko_room_invites (room_id, recipient_profile_id)
  where status = 'pending';

create schema if not exists disuko_private;
revoke all on schema disuko_private from public;

create or replace function public.disuko_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function disuko_private.is_room_member(target_room_id uuid, target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.disuko_room_players
    where room_id = target_room_id
      and profile_id = target_profile_id
  );
$$;

create or replace function disuko_private.is_room_host(target_room_id uuid, target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.disuko_rooms
    where id = target_room_id
      and host_profile_id = target_profile_id
  );
$$;

grant usage on schema disuko_private to authenticated;
grant execute on function disuko_private.is_room_member(uuid, uuid) to authenticated;
grant execute on function disuko_private.is_room_host(uuid, uuid) to authenticated;

drop trigger if exists disuko_profiles_set_updated_at on public.disuko_profiles;
create trigger disuko_profiles_set_updated_at
before update on public.disuko_profiles
for each row execute function public.disuko_set_updated_at();

drop trigger if exists disuko_rooms_set_updated_at on public.disuko_rooms;
create trigger disuko_rooms_set_updated_at
before update on public.disuko_rooms
for each row execute function public.disuko_set_updated_at();

alter table public.disuko_profiles enable row level security;
alter table public.disuko_friend_requests enable row level security;
alter table public.disuko_rooms enable row level security;
alter table public.disuko_room_players enable row level security;
alter table public.disuko_room_invites enable row level security;

grant select, insert, update on public.disuko_profiles to authenticated;
grant select, insert, update on public.disuko_friend_requests to authenticated;
grant select, insert, update, delete on public.disuko_rooms to authenticated;
grant select, insert, update, delete on public.disuko_room_players to authenticated;
grant select, insert, update on public.disuko_room_invites to authenticated;

drop policy if exists "disuko profiles are visible to signed in players" on public.disuko_profiles;
create policy "disuko profiles are visible to signed in players"
on public.disuko_profiles for select
to authenticated
using (true);

drop policy if exists "disuko players create own profile" on public.disuko_profiles;
create policy "disuko players create own profile"
on public.disuko_profiles for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "disuko players update own profile" on public.disuko_profiles;
create policy "disuko players update own profile"
on public.disuko_profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "disuko friend requests visible to participants" on public.disuko_friend_requests;
create policy "disuko friend requests visible to participants"
on public.disuko_friend_requests for select
to authenticated
using (requester_profile_id = auth.uid() or recipient_profile_id = auth.uid());

drop policy if exists "disuko players send friend requests" on public.disuko_friend_requests;
create policy "disuko players send friend requests"
on public.disuko_friend_requests for insert
to authenticated
with check (requester_profile_id = auth.uid() and recipient_profile_id <> auth.uid());

drop policy if exists "disuko friend requests update by participants" on public.disuko_friend_requests;
create policy "disuko friend requests update by participants"
on public.disuko_friend_requests for update
to authenticated
using (requester_profile_id = auth.uid() or recipient_profile_id = auth.uid())
with check (
  (recipient_profile_id = auth.uid() and status in ('accepted', 'declined'))
  or (requester_profile_id = auth.uid() and status = 'canceled')
);

drop policy if exists "disuko rooms visible to lobby members and invitees" on public.disuko_rooms;
create policy "disuko rooms visible to lobby members and invitees"
on public.disuko_rooms for select
to authenticated
using (
  (visibility = 'public' and status = 'lobby')
  or disuko_private.is_room_member(disuko_rooms.id, auth.uid())
  or exists (
    select 1 from public.disuko_room_invites
    where room_id = disuko_rooms.id
      and recipient_profile_id = auth.uid()
      and status = 'pending'
  )
);

drop policy if exists "disuko players create hosted rooms" on public.disuko_rooms;
create policy "disuko players create hosted rooms"
on public.disuko_rooms for insert
to authenticated
with check (host_profile_id = auth.uid());

drop policy if exists "disuko room members update allowed rooms" on public.disuko_rooms;
create policy "disuko room members update allowed rooms"
on public.disuko_rooms for update
to authenticated
using (
  disuko_private.is_room_member(disuko_rooms.id, auth.uid())
  and (
    (status = 'lobby' and host_profile_id = auth.uid())
    or (status = 'playing' and turn_profile_id = auth.uid())
  )
)
with check (
  disuko_private.is_room_member(disuko_rooms.id, auth.uid())
);

drop policy if exists "disuko hosts delete rooms" on public.disuko_rooms;
create policy "disuko hosts delete rooms"
on public.disuko_rooms for delete
to authenticated
using (host_profile_id = auth.uid());

drop policy if exists "disuko room players visible to room participants" on public.disuko_room_players;
create policy "disuko room players visible to room participants"
on public.disuko_room_players for select
to authenticated
using (
  profile_id = auth.uid()
  or disuko_private.is_room_member(disuko_room_players.room_id, auth.uid())
  or exists (
    select 1 from public.disuko_rooms room
    where room.id = disuko_room_players.room_id
      and room.visibility = 'public'
      and room.status = 'lobby'
  )
);

drop policy if exists "disuko players join lobby rooms" on public.disuko_room_players;
create policy "disuko players join lobby rooms"
on public.disuko_room_players for insert
to authenticated
with check (
  profile_id = auth.uid()
  and exists (
    select 1 from public.disuko_rooms room
    where room.id = room_id
      and room.status = 'lobby'
      and seat_index < room.player_count
  )
  and is_host = exists (
    select 1 from public.disuko_rooms room
    where room.id = room_id
      and room.host_profile_id = auth.uid()
  )
);

drop policy if exists "disuko players update own room seat" on public.disuko_room_players;
create policy "disuko players update own room seat"
on public.disuko_room_players for update
to authenticated
using (profile_id = auth.uid())
with check (profile_id = auth.uid());

drop policy if exists "disuko players leave rooms" on public.disuko_room_players;
create policy "disuko players leave rooms"
on public.disuko_room_players for delete
to authenticated
using (
  profile_id = auth.uid()
  or disuko_private.is_room_host(disuko_room_players.room_id, auth.uid())
);

drop policy if exists "disuko room invites visible to participants" on public.disuko_room_invites;
create policy "disuko room invites visible to participants"
on public.disuko_room_invites for select
to authenticated
using (
  sender_profile_id = auth.uid()
  or recipient_profile_id = auth.uid()
  or disuko_private.is_room_member(disuko_room_invites.room_id, auth.uid())
);

drop policy if exists "disuko room members invite players" on public.disuko_room_invites;
create policy "disuko room members invite players"
on public.disuko_room_invites for insert
to authenticated
with check (
  sender_profile_id = auth.uid()
  and recipient_profile_id <> auth.uid()
  and disuko_private.is_room_member(disuko_room_invites.room_id, auth.uid())
);

drop policy if exists "disuko room invites update by participants" on public.disuko_room_invites;
create policy "disuko room invites update by participants"
on public.disuko_room_invites for update
to authenticated
using (sender_profile_id = auth.uid() or recipient_profile_id = auth.uid())
with check (
  (recipient_profile_id = auth.uid() and status in ('accepted', 'declined'))
  or (sender_profile_id = auth.uid() and status = 'canceled')
);

alter table public.disuko_rooms replica identity full;
alter table public.disuko_room_players replica identity full;
alter table public.disuko_room_invites replica identity full;
alter table public.disuko_friend_requests replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'disuko_rooms'
    ) then
      alter publication supabase_realtime add table public.disuko_rooms;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'disuko_room_players'
    ) then
      alter publication supabase_realtime add table public.disuko_room_players;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'disuko_room_invites'
    ) then
      alter publication supabase_realtime add table public.disuko_room_invites;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'disuko_friend_requests'
    ) then
      alter publication supabase_realtime add table public.disuko_friend_requests;
    end if;
  end if;
end
$$;
