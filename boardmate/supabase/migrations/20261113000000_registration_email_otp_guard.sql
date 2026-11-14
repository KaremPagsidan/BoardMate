-- Manual deployment only; existing accounts are exempt.
begin;
create table public.boardmate_email_verification_required(user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.boardmate_email_verification_required enable row level security;
revoke all on public.boardmate_email_verification_required from public, anon, authenticated;
create function public.enroll_boardmate_email_verification() returns trigger language plpgsql security definer set search_path = '' as $$
begin
insert into public.boardmate_email_verification_required values(new.id);
return new;
end; $$;
alter function public.enroll_boardmate_email_verification() owner to postgres;
revoke all on function public.enroll_boardmate_email_verification() from public, anon, authenticated;
create trigger boardmate_require_signup_email after insert on auth.users for each row execute function public.enroll_boardmate_email_verification();
create function public.guard_boardmate_email_review() returns trigger language plpgsql security definer set search_path = '' as $$
begin
if new.verification_status in ('pending','approved')
and exists(select 1 from public.boardmate_email_verification_required r where r.user_id = new.id)
and not exists(select 1 from auth.users u where u.id = new.id and u.email_confirmed_at is not null)
then raise exception 'Verify your email before submitting documents or receiving administrator approval.';
end if;
return new;
end; $$;
alter function public.guard_boardmate_email_review() owner to postgres;
revoke all on function public.guard_boardmate_email_review() from public, anon, authenticated;
create trigger enforce_boardmate_email_before_review before insert or update on public.profiles for each row execute function public.guard_boardmate_email_review();
commit;
