create table if not exists public.disuko_room_bots (
  room_id uuid not null references public.disuko_rooms (id) on delete cascade,
  seat_index smallint not null check (seat_index between 1 and 3),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  display_name text not null check (char_length(trim(display_name)) between 1 and 32),
  created_by_profile_id uuid not null references public.disuko_profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, seat_index)
);

create or replace function disuko_private.ensure_disuko_seat_available()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1
  from public.disuko_rooms room
  where room.id = new.room_id
    and new.seat_index < room.player_count
  for update;

  if not found then
    raise exception 'That seat is outside the room player count.' using errcode = '23514';
  end if;

  if tg_table_name = 'disuko_room_bots' then
    if exists (
      select 1 from public.disuko_room_players
      where room_id = new.room_id and seat_index = new.seat_index
    ) then
      raise exception 'That room seat is already occupied.' using errcode = '23505';
    end if;
  elsif exists (
    select 1 from public.disuko_room_bots
    where room_id = new.room_id and seat_index = new.seat_index
  ) then
    raise exception 'That room seat is already occupied.' using errcode = '23505';
  end if;

  return new;
end;
$$;

revoke all on function disuko_private.ensure_disuko_seat_available() from public;

drop trigger if exists disuko_room_bots_seat_available on public.disuko_room_bots;
create trigger disuko_room_bots_seat_available
before insert or update of room_id, seat_index on public.disuko_room_bots
for each row execute function disuko_private.ensure_disuko_seat_available();

drop trigger if exists disuko_room_players_bot_seat_available on public.disuko_room_players;
create trigger disuko_room_players_bot_seat_available
before insert or update of room_id, seat_index on public.disuko_room_players
for each row execute function disuko_private.ensure_disuko_seat_available();

create or replace function disuko_private.is_room_full(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.disuko_rooms room
    where room.id = target_room_id
      and (
        (select count(*) from public.disuko_room_players player where player.room_id = room.id)
        +
        (select count(*) from public.disuko_room_bots bot where bot.room_id = room.id)
      ) >= room.player_count
  );
$$;

revoke all on function disuko_private.is_room_full(uuid) from public;
grant execute on function disuko_private.is_room_full(uuid) to authenticated;

alter table public.disuko_room_bots enable row level security;
grant select, insert, update, delete on public.disuko_room_bots to authenticated;
grant select, insert, update, delete on public.disuko_room_bots to service_role;

drop policy if exists "disuko room bots visible with room" on public.disuko_room_bots;
create policy "disuko room bots visible with room"
on public.disuko_room_bots for select
to authenticated
using (
  created_by_profile_id = (select auth.uid())
  or disuko_private.is_room_member(room_id, (select auth.uid()))
  or exists (
    select 1 from public.disuko_room_invites invite
    where invite.room_id = disuko_room_bots.room_id
      and invite.recipient_profile_id = (select auth.uid())
      and invite.status = 'pending'
  )
  or exists (
    select 1 from public.disuko_rooms room
    where room.id = disuko_room_bots.room_id
      and room.visibility = 'public'
      and room.status = 'lobby'
  )
);

drop policy if exists "disuko hosts add lobby bots" on public.disuko_room_bots;
create policy "disuko hosts add lobby bots"
on public.disuko_room_bots for insert
to authenticated
with check (
  created_by_profile_id = (select auth.uid())
  and disuko_private.is_room_host(disuko_room_bots.room_id, (select auth.uid()))
  and exists (
    select 1 from public.disuko_rooms room
    where room.id = disuko_room_bots.room_id
      and room.status = 'lobby'
      and disuko_room_bots.seat_index < room.player_count
  )
);

drop policy if exists "disuko hosts update lobby bots" on public.disuko_room_bots;
create policy "disuko hosts update lobby bots"
on public.disuko_room_bots for update
to authenticated
using (
  disuko_private.is_room_host(disuko_room_bots.room_id, (select auth.uid()))
  and exists (select 1 from public.disuko_rooms room where room.id = disuko_room_bots.room_id and room.status = 'lobby')
)
with check (
  created_by_profile_id = (select auth.uid())
  and disuko_private.is_room_host(disuko_room_bots.room_id, (select auth.uid()))
  and exists (
    select 1 from public.disuko_rooms room
    where room.id = disuko_room_bots.room_id
      and room.status = 'lobby'
      and disuko_room_bots.seat_index < room.player_count
  )
);

drop policy if exists "disuko hosts remove lobby bots" on public.disuko_room_bots;
create policy "disuko hosts remove lobby bots"
on public.disuko_room_bots for delete
to authenticated
using (
  disuko_private.is_room_host(disuko_room_bots.room_id, (select auth.uid()))
  and exists (select 1 from public.disuko_rooms room where room.id = disuko_room_bots.room_id and room.status = 'lobby')
);

alter table public.disuko_room_bots replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'disuko_room_bots'
    ) then
    alter publication supabase_realtime add table public.disuko_room_bots;
  end if;
end
$$;
