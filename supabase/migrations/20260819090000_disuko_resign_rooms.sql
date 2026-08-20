create or replace function public.resign_disuko_room(target_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  resigning_name text;
begin
  select profile.display_name into resigning_name
  from public.disuko_room_players player
  join public.disuko_profiles profile on profile.id = player.profile_id
  join public.disuko_rooms room on room.id = player.room_id
  where player.room_id = target_room_id
    and player.profile_id = auth.uid()
    and room.status = 'playing';

  if resigning_name is null then
    raise exception 'Only a player in an active game can resign.' using errcode = '42501';
  end if;

  update public.disuko_rooms
  set status = 'finished',
      turn_profile_id = null,
      finished_at = now(),
      game_state = jsonb_set(jsonb_set(game_state, '{phase}', '"won"'::jsonb), '{message}', to_jsonb(resigning_name || ' resigned.'))
  where id = target_room_id;
end;
$$;

revoke all on function public.resign_disuko_room(uuid) from public;
grant execute on function public.resign_disuko_room(uuid) to authenticated;
