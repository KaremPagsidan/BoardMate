# Admin audit rollout (draft)

No live SQL or policies were changed during implementation.

Review `migrations/20261111000001_admin_activity_logs.sql` before deployment.
Apply only to a disposable local/staging Supabase instance first, after the
existing project migrations. Inspect the installed `is_boardmate_admin()`
function: it must use trusted admin membership, trusted ownership, an empty
search path, and a membership table clients cannot modify.

The new table is separate from `activity_history`; existing user history and
legacy rejection receipts remain intact. No historical admin events are inferred.
Audit rows preserve actor UUIDs after account deletion and store changed column
names, not profile values, message bodies, or verification documents.

Triggers audit committed authenticated-admin writes to profiles, listings,
roommate posts, direct messages/reports, notifications, problem reports,
deletion requests and admin memberships. Additional future administrative tables
must be explicitly added to the trigger list. Trigger failures intentionally roll
back the administrative write. One action can produce multiple audit rows when
it changes multiple records (for example a report resolution plus suspension
and notifications); these are distinct record changes, not duplicate requests.

Session events are authorized RPC calls, deduplicated per admin/auth session/event.
Login means successful portal authentication/authorization. Sign-out is recorded
as requested before signOut; it does not claim signOut succeeded. Closing a tab,
token expiration, restored sessions and authentication outside the portal do not
generate login/logout events. RPC session events express client intent; they are
not a replacement for Supabase Auth's server authentication audit trail.
SQL-console/service-role operations without an authenticated admin JWT are not
attributed. Removing one's own admin membership is not recorded because the
AFTER trigger no longer sees admin authorization; membership maintenance should
use a separate privileged operational audit trail.

Run `node --test tests/adminActivity.test.mjs` (in-memory PostgreSQL; no network).
In staging test two admins plus a renter and owner:

1. Confirm renter/owner changes stay in their existing history and never appear
   in Admin Activity Logs. Verify direct audit INSERT/UPDATE/DELETE are denied
   and ordinary members cannot SELECT audit rows.
2. Sign in, refresh, sign out; confirm one login and one sign-out request per
   session. Simulate network failure and retry; no duplicate session event.
3. Approve/reject listings, review verification, reject/manage roommate posts,
   resolve reports with warning/suspension and reinstate accounts through the
   supported backend path. Refresh the admin log and verify actor vs target IDs.
4. Send an admin chat through a supported interface/API; verify the action is
   recorded with no message body. Confirm invalid/rolled-back writes add no log.
5. Check legacy rejection receipts, dashboard queues, user history and ratings
   still work. Verify private values are absent from logs.

The UI displays the latest 200 rows; older rows remain stored. Existing refresh
and relevant table subscriptions refresh the display; no new Realtime publication
is required. Use Refresh for events on tables not already subscribed.

After staging validation, obtain approval for production migration application.
Deploy the migration before the updated frontend: without it, admin queue loading
and explicit login/logout auditing report errors. The UI deliberately does not
fall back to mixed user activity. Retain this table for audit retention when
rolling back the frontend. Define retention/export rules separately.
