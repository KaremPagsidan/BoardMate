alter table public.roommate_posts
  add column if not exists author_name text,
  add column if not exists author_avatar_url text,
  add column if not exists author_gender text,
  add column if not exists author_age integer;

notify pgrst, 'reload schema';
