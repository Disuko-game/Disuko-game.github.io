alter table public.disuko_rooms
  add column if not exists opponent_reroll_enabled boolean not null default false;
