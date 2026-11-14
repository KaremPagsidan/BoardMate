-- Forward correction for the ALREADY INSTALLED email OTP guard.
-- Manual execution only. Does not replace functions or enrollment data.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Fail closed on unexpected live definitions; review drift rather than overwrite it.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = pg_catalog.to_regclass('public.profiles')
      and t.tgname = 'enforce_boardmate_email_before_review'
      and t.tgfoid = pg_catalog.to_regprocedure('public.guard_boardmate_email_review()')
      -- 23 = BEFORE ROW INSERT/UPDATE; 21 = AFTER ROW INSERT/UPDATE (safe rerun).
      and t.tgtype in (23, 21) and t.tgenabled = 'O'
      and not t.tgisinternal and t.tgconstraint = 0
      and t.tgnargs = 0 and t.tgqual is null
      and t.tgattr = ''::pg_catalog.int2vector
      and t.tgoldtable is null and t.tgnewtable is null
  ) then
    raise exception 'Expected enabled BoardMate email guard not found or definition differs. Inspect read-only verification output before proceeding.';
  end if;
end;
$$;

-- Keep the existing name/function. AFTER sees the row produced by all BEFORE
-- triggers. This ordinary trigger is immediate, not a deferred constraint trigger.
create or replace trigger enforce_boardmate_email_before_review
  after insert or update on public.profiles
  for each row execute function public.guard_boardmate_email_review();
commit;
