drop policy if exists "disuko rooms visible to lobby members and invitees" on public.disuko_rooms;

create policy "disuko rooms visible to lobby members and invitees"
on public.disuko_rooms for select
to authenticated
using (
  host_profile_id = (select auth.uid())
  or (visibility = 'public' and status = 'lobby')
  or disuko_private.is_room_member(disuko_rooms.id, (select auth.uid()))
  or exists (
    select 1 from public.disuko_room_invites
    where room_id = disuko_rooms.id
      and recipient_profile_id = (select auth.uid())
      and status = 'pending'
  )
);
