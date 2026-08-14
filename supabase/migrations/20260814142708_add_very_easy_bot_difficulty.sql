alter table public.disuko_room_bots
  drop constraint if exists disuko_room_bots_difficulty_check;

alter table public.disuko_room_bots
  add constraint disuko_room_bots_difficulty_check
  check (difficulty in ('very-easy', 'easy', 'medium', 'hard'));
