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
        select count(*)
        from public.disuko_room_players player
        where player.room_id = room.id
      ) >= room.player_count
  );
$$;

grant execute on function disuko_private.is_room_full(uuid) to authenticated;

drop policy if exists "disuko room members update allowed rooms" on public.disuko_rooms;

create policy "disuko room members update allowed rooms"
on public.disuko_rooms for update
to authenticated
using (
  disuko_private.is_room_member(disuko_rooms.id, (select auth.uid()))
  and (
    (status = 'lobby' and (
      host_profile_id = (select auth.uid())
      or disuko_private.is_room_full(disuko_rooms.id)
    ))
    or (status = 'playing' and turn_profile_id = (select auth.uid()))
  )
)
with check (
  disuko_private.is_room_member(disuko_rooms.id, (select auth.uid()))
);
