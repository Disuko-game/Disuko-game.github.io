drop policy if exists "disuko room players visible to room participants" on public.disuko_room_players;

create policy "disuko room players visible to room participants"
on public.disuko_room_players for select
to authenticated
using (
  profile_id = (select auth.uid())
  or disuko_private.is_room_member(disuko_room_players.room_id, (select auth.uid()))
  or exists (
    select 1 from public.disuko_room_invites invite
    where invite.room_id = disuko_room_players.room_id
      and invite.recipient_profile_id = (select auth.uid())
      and invite.status = 'pending'
  )
  or exists (
    select 1 from public.disuko_rooms room
    where room.id = disuko_room_players.room_id
      and room.visibility = 'public'
      and room.status = 'lobby'
  )
);
