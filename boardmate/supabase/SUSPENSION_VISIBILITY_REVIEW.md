# Suspension visibility rollout

The migration `20261111000002_suspended_content_visibility.sql` is a draft.
No live database, Storage policy, publication or production data was changed.

## Behavior and implementation

Restrictive SELECT policies add a suspension check to existing listing and post
policies. Other users cannot read suspended creators' content even if an existing
permissive policy allows it. Owners and admins retain their existing access for
management; existing policies still decide whether that access is allowed.
Missing creator profiles and orphaned content are hidden from other viewers.
No moderation status, availability, deletion flag, or uploaded file is changed.
Reinstatement restores visibility only where original policies allow it.

Existing public-profile and message-contact SECURITY DEFINER functions already
check account suspension via `is_boardmate_profile_visible` and
`is_boardmate_account_active`; validate the installed definitions against the
repository before rollout. Existing send policy still enforces active-account
preferences, blocks, identity and attachment validation. An additional restrictive
insert policy plus a BEFORE INSERT trigger prevents sends involving suspended
participants, including SECURITY DEFINER inserts. Sorted profile row locks order
messages against suspension transactions: an earlier successful send may commit
before suspension; subsequent sends must fail. In-flight uploads can still race
with suspension; the existing failed-insert attachment cleanup remains in place.

A singleton revision counter changes in the same transaction as suspension or
reinstatement. It contains no account IDs or private values. Only authenticated
clients can read/subscribe; only the trusted trigger can update it. It is added
to `supabase_realtime` when that publication exists. Unrelated profile updates do
not broadcast. Transaction rollback rolls back the counter as well.

Renter feeds/recommendations/search share the refreshed marketplace arrays.
Selected details and media for removed content clear after refresh. Public
profiles, standalone listing pages, inboxes and open chats refresh as well.
Recipient availability is checked before opening chats and before uploading
message attachments. The database remains authoritative if a preflight races.
Realtime is the fast path, with focus/reconnect and 15-second polling fallback.
Offline clients cannot receive immediate updates; server reads/sends enforce
restrictions regardless. Transport disconnects no longer generate the misleading
blocking listing error; actual user-action/query errors remain reportable.

## Validation and staging procedure

Run `node --test tests/suspensionVisibility.test.mjs` for a disposable in-memory
PostgreSQL test plus message-preflight test. These use no network or credentials.
They cover outsider/anonymous/admin/owner access, restrictive policy precedence,
direct message blocking, retained original statuses, revision updates and
restoration. The fixture is not a substitute for real Supabase Realtime or
multi-connection concurrency tests.

1. Use a disposable local/staging Supabase project with the existing migrations.
   Confirm the three affected tables have RLS enabled, admin memberships are
   protected, trusted helper ownership/search paths match the repo, and
   `supabase_realtime` exists. Review existing SECURITY DEFINER/view endpoints:
   table RLS does not constrain functions running as the table owner.
2. Apply the draft only to staging. Confirm the revision table appears in
   `pg_publication_tables` for `supabase_realtime`. No private profile columns
   should be newly published. Deploy the frontend there.
3. Create an owner and renter with approved, pending, rejected, unavailable and
   deleted content. Open a second account on home, recommendations, search,
   favourites, public profile, post details and standalone listing tabs. Open an
   existing chat and a new unsent conversation to an active member.
4. Suspend each content creator as admin. Other accounts should lose visible
   content and affected previews/chats after the event. Active unsent chats must
   remain open. Verify direct REST queries cannot retrieve suspended content and
   direct message inserts fail. Admin review must still see retained records.
5. In two PostgreSQL connections, start a suspension update without committing;
   insert a message from the other connection. It should wait, then fail after
   suspension commits. Roll back suspension and repeat: the send should succeed
   if other existing policies permit it. Repeat with opposite sender/recipient
   IDs and self conversations to check lock order/deadlock behavior.
6. Disable Realtime temporarily: focus refresh and polling should repair stale
   views without a blocking transport-error dialog. Try sending from a stale tab
   and confirm a specific unavailable-account message before attachment upload.
7. Reinstate the account. Only originally public/available/approved, nondeleted
   items should return. Hidden conversations, blocks, unread state, private
   profiles and rejection receipts must preserve their existing behavior.
8. Simulate attachment upload, suspension, then message insert failure. Confirm
   the uploaded attachment is cleaned up or a cleanup error is reported.

Review/approve production application separately. Apply the reviewed migration
before the frontend rollout. Do not use a blanket migration push while other
draft migrations remain unreviewed. Frontend refresh alone does not enforce
visibility until this database change is installed.

## Limits and operational risks

- Existing public Storage URLs/downloads are not revoked by hiding database rows;
  previously downloaded media cannot be recalled. Private-media migration is a
  separate change.
- Polling adds marketplace/rating/inbox reads every 15 seconds per open view;
  measure traffic before high-volume rollout. The singleton update serializes
  suspension changes, and row locks may wait on concurrent sends.
- Privileged SQL/service-role reads bypass RLS. Any future definer endpoint must
  explicitly check suspension before returning content.
- This does not purge historical messages or notifications. Suspended recipients
  are removed from contact lists and cannot receive new sends.
- Database changes cannot erase content already rendered on a disconnected
  device; online tabs refresh after events, or within the polling interval when
  events are missed. Browser/mobile and real multi-session tests remain required.
