# Weekly statistics history and UI/media fixes

Apply `20261111000006_weekly_approval_history.sql` as postgres in staging, then deploy the updated frontends. No live database was changed during implementation. This migration needs the existing `profiles`, `listings`, `roommate_posts`, and `is_boardmate_admin()` helper; it does not depend on the photo-privacy refresh helper. Existing verification snapshots and administrative audit tables are used for backfill only when present.

Statistics Reports now has a date/week selector, previous/next/current-week buttons, per-category comparisons with the preceding week, an eight-week chart with an exact-values table, and daily counts for the selected week. Weeks run Monday–Sunday in **Asia/Manila**, independent of the browser or database server timezone. The current week is marked in progress and explicitly compared against the full preceding week. A zero previous baseline displays “New approvals” instead of an undefined percentage. Reports refresh every 30 seconds, on focus, or through Refresh.

`boardmate_approval_events` stores each transition into approved for accounts, listings, and roommate posts. Reapproval after a new review is another event. Edits that leave approval unchanged do not count again. Events survive rejection, return to pending, deletion, and changes to the current row's review timestamp. Event insertion shares the approval transaction, so rollback rolls back statistics too. Administrators can read history through an admin-checked RPC; ordinary accounts cannot read it, and browser clients (including administrators) cannot directly edit/delete/insert events.

The installation locks approval source tables while it backfills and installs triggers. A 5-second lock timeout avoids waiting indefinitely on active writes; retry a failed whole migration during a quieter period. Backfill uses known current approval timestamps, retained verification decisions, and retained approval audit events, deduplicating matching decisions. Events that were never retained cannot be reconstructed. The UI displays the start of complete tracking rather than presenting older partial history as complete. Existing public content, decisions, and the dashboard's current-week widget remain unchanged; the Reports page uses the new durable event history.

Source UI text was audited as UTF-8, including user, owner, admin, and shared components. The corrupted session/login strings in `App.jsx` were repaired. `.editorconfig` specifies UTF-8 for future edits; both HTML entry points already declare UTF-8. Shared alerts, notifications, and authentication errors also safely repair recognizable Windows-1252/UTF-8 corruption at display time, including previously saved notification text. Valid multilingual text is retained. User messages and database content are not rewritten.

Message audio/video previously received a newly signed attachment URL during each refresh. That changed the media source and recreated/reloaded the native player. Signed URLs are now reused per account/path for 50 minutes of their 60-minute validity, with a bounded cache and safe renewal. Unsent messages no longer sign or expose an attachment URL. This preserves normal polling, seen state, reactions, and message deletion while avoiding playback interruption every few seconds. Chat images now use a maximum 240px width (55vw on small screens), 220px height, and aspect-ratio-preserving object fit; clicking still opens the original in the preview.

Run from `boardmate`:

```powershell
node --test tests/uiText.test.mjs tests/weeklyStatistics.test.mjs tests/directMessages.test.mjs
npx.cmd eslint src
npm.cmd run build
npm.cmd run build:admin
```

The tests use a disposable PostgreSQL engine and mocked Supabase messaging; no live account, SMTP, or production data is accessed. Coverage includes timezone/year boundaries, preserved history after deletion, backfill/deduplication, admin-only access, transaction rollback, zero-baseline comparisons, mixed/double-encoded UI text, valid Unicode preservation, source UTF-8 integrity, attachment URL reuse/renewal, unsending, and existing message pagination/reactions.

In staging, approve one item of each kind, switch weeks, and compare the event counts with the database. Change/reject/delete an approved item and confirm earlier totals remain; reapprove and confirm a new event is recorded. Test an empty week and a Manila Monday boundary. Play a long audio clip in both renter and owner chats for several polling intervals, including while new messages/reactions arrive; confirm playback continues and controls/preview work independently. Test portrait/landscape images on Android and check alerts, stored notifications, login, and loading text in all portals. Live Supabase and physical-device verification remain separate from the disposable tests.
