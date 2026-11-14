alter table public.roommate_posts
  add column if not exists heading text,
  add column if not exists budget text,
  add column if not exists description text not null default '',
  add column if not exists location text,
  add column if not exists role text,
  add column if not exists user_name text,
  add column if not exists author_name text,
  add column if not exists author_avatar_url text,
  add column if not exists author_gender text,
  add column if not exists author_age integer;

notify pgrst, 'reload schema';
