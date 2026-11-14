# React + Vite

## Supabase marketplace setup

For registration database errors, the forward trigger repair and staging checks are documented in [Registration repair](supabase/REGISTRATION_REPAIR.md).

For preserved admin weekly approval reports, UTF-8 UI text fixes, and uninterrupted inline message media, see [the statistics and media rollout guide](supabase/WEEKLY_STATISTICS_ROLLOUT.md). Weekly history requires `20261111000006_weekly_approval_history.sql` and the updated frontend.

For manual cropping, owner-controlled profile/post/listing photo privacy and deletion, and full-page portal settings/notifications, follow [the photo privacy rollout guide](supabase/PHOTO_PRIVACY_ROLLOUT.md). Deploy both privacy migrations and the updated frontend together because the affected media buckets become private.

For Flask + Gmail SMTP password recovery (renters, owners, and administrators), see [server/README.md](server/README.md). It includes the private database migration, environment setup, service/worker commands, and automated/manual testing instructions. This feature needs the Flask service and SMTP worker in addition to the frontend.

For suspension visibility, apply `supabase/migrations/20261111000002_suspended_content_visibility.sql` after the earlier migrations and deploy the frontend with it. It hides suspended owners' listings and roommate posts from other members and blocks message inserts involving suspended participants. Content stays stored with its original moderation, availability, and deletion values; reinstatement restores visibility according to existing policies. Owner/admin read access remains subject to those policies.

The frontend uses `boardmate_visibility_revision` Realtime updates, with a 15-second polling fallback and refresh on focus, reconnect, and tab visibility. Confirm that table is enabled in the target project's Realtime publication. Run `npm run test:suspension` for local database visibility, restoration, and messaging checks.

Run `supabase/migrations/20261026000000_dynamic_marketplace_data.sql`, `supabase/migrations/20261026000001_profile_history.sql`, `supabase/migrations/20261026000002_profile_photo_gallery.sql`, `supabase/migrations/20261027000000_account_and_content_review.sql`, `supabase/migrations/20261027000001_direct_messages_and_roommate_age.sql`, `supabase/migrations/20261027000002_roommate_profile_columns.sql`, `supabase/migrations/20261027000003_roommate_post_content_columns.sql`, `supabase/migrations/20261027000004_fix_profile_role_enum_signup.sql`, `supabase/migrations/20261027000005_require_existing_account_review.sql`, `supabase/migrations/20261027000006_roommate_rejection_receipt.sql`, `supabase/migrations/20261027000007_roommate_post_likes.sql`, `supabase/migrations/20261028000000_fix_listing_review_and_keep_rejected_posts.sql`, `supabase/migrations/20261028000001_roommate_post_management_and_listing_favorites.sql`, `supabase/migrations/20261028000002_messaging_presence_and_profile_interactions.sql`, `supabase/migrations/20261028000003_reports_suspensions_and_blocking.sql`, `supabase/migrations/20261028000004_direct_message_actions.sql`, and `supabase/migrations/20261028000005_presence_and_self_forwarding.sql`, in that order, in the Supabase SQL Editor. The account and content review migration adds account verification, private ID/selfie document storage, listing and roommate-post moderation, and admin-only review policies. Later migrations move existing renter and landlord accounts back to pending verification, add rejection receipts, provide secure likes for approved roommate posts, fix accommodation listing review, and retain rejected roommate posts for the admin User Posts history. The latest migrations add editable owner posts, persistent soft deletion visible in the admin User Posts history, saved accommodation favourites with live like counts, full-screen direct messaging with private photo/video attachments and seen receipts, per-user inbox hiding, active/last-seen presence, evidence-backed conversation reports, admin report decisions, user notifications, account suspension, account blocking, per-user message unsending, forwarded messages, and message reactions. The latest presence and forwarding migration publishes presence through a database-validated RPC and permits explicitly forwarded messages to be saved to your own account. Those earlier migrations initially mark new accounts pending; the registration workflow migration below changes new accounts to not_submitted until both verification documents are submitted. Existing marketplace posts are retained with their moderation status. The earlier migrations ensure the roommate post columns exist, create private participant-only direct messaging, and fix signup role casting for projects where `profiles.role` uses the `public.user_role` enum.

After creating the first administrator as a normal Supabase Auth user, authorize that account from the Supabase SQL Editor (replace the email with the administrator's email):

```sql
insert into public.admin_memberships (user_id)
select id from auth.users where email = 'admin@example.com'
on conflict (user_id) do nothing;
```

Only accounts in `admin_memberships` can access the admin portal or approve users and posts. Never expose a Supabase service-role key in the browser. The admin portal now signs in through Supabase Auth.

To reset an administrator password, enter the Auth account email on the admin sign-in screen and select **Forgot Password?**. Supabase sends a reset link to that email. In Supabase **Authentication → URL Configuration**, allow the admin page URL as a redirect URL (for local development, `http://127.0.0.1:5174/admin.html`; also add the deployed admin URL). Open the link, choose a new password on the admin page, then sign in normally. The reset email must be deliverable through the project's configured email provider.

After applying migration `20261028000005_presence_and_self_forwarding.sql`, also run `supabase/migrations/20261028000006_notifications_and_public_profiles.sql`, `supabase/migrations/20261028000007_account_settings_search_and_problem_reports.sql`, and `supabase/migrations/20261029000000_fix_listing_photos_storage_policies.sql` in the Supabase SQL Editor. These enable database-backed like/review notifications, account settings and search preferences, and the required storage insert/update/delete policies for listing photos.

Run `supabase/migrations/20261101000000_listing_media_gallery.sql` after those migrations to store listing photo/video galleries for administrator review and renter listing details. If it was already applied before the table-specific listing review trigger fix, run it again so the approval error is fixed. Then run `supabase/migrations/20261101000001_unique_profile_views.sql`, `supabase/migrations/20261101000002_listing_favorite_owner_counts.sql`, `supabase/migrations/20261101000003_active_member_likes_and_messaging.sql`, and `supabase/migrations/20261101000004_account_deletion_requests.sql` in order. These enable unique profile views, owner-visible listing likes, likes and messaging for active non-suspended accounts (blocks are still enforced), and account deletion requests. Keep `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set to the same active Supabase project used by the website. An upload error of `Failed to fetch` indicates that the browser could not reach Supabase; check the network and project URL before changing storage policies.

After the existing migrations, apply `supabase/migrations/20261102000000_roommate_post_photos.sql`. It adds photo galleries to roommate posts, a public photo bucket with renter-owned upload/delete policies, and refreshes the message-contact and public-profile RPCs in PostgREST's schema cache. It also installs the account-preferences table and visibility helpers required by those RPCs if they are missing; apply `20261028000007_account_settings_search_and_problem_reports.sql` as well to enable all account settings, search preferences, and problem reports. Profile and listing image crops are applied before upload, and image/video previews include a **Save to device** action.

If account settings reports a missing `boardmate_problem_reports` table or Supabase schema-cache entry, apply `supabase/migrations/20261102000001_repair_problem_reports.sql` in the SQL Editor after the account and admin-membership migrations. It creates the problem-report table, restores its user/admin access policies, and asks PostgREST to reload its schema.

After all existing migrations, including `supabase/migrations/20261104000000_notification_privacy_controls.sql`, apply `supabase/migrations/20261105000000_listing_ratings_notifications_and_account_deletion.sql`. This adds renter listing ratings, notification destinations, and the five-day account-deletion schedule. To make scheduled deletion complete automatically:

1. Deploy `supabase/functions/purge-boardmate-accounts` with `supabase functions deploy purge-boardmate-accounts` and set a strong random `PURGE_SECRET` using `supabase secrets set PURGE_SECRET="replace-with-a-long-random-secret"`. The function uses the project's `SUPABASE_SERVICE_ROLE_KEY` only on the server; never add it to the frontend.
2. Enable the `pg_cron`, `pg_net`, and `vault` extensions for the Supabase project. Store the function URL, the project's anon key, and the same purge secret in Vault (replace the placeholders):

   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/purge-boardmate-accounts', 'boardmate_purge_url');
   select vault.create_secret('<project-anon-key>', 'boardmate_purge_anon_key');
   select vault.create_secret('<same-random-secret-as-PURGE_SECRET>', 'boardmate_purge_secret');
   ```

3. Schedule the worker to run hourly:

   ```sql
   select cron.schedule(
     'purge-boardmate-accounts-hourly',
     '0 * * * *',
     $$
       select net.http_post(
         url := (select decrypted_secret from vault.decrypted_secrets where name = 'boardmate_purge_url'),
         headers := jsonb_build_object(
           'Content-Type', 'application/json',
           'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'boardmate_purge_anon_key'),
           'x-purge-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'boardmate_purge_secret')
         ),
         body := '{}'::jsonb
       );
     $$
   );
   ```

The worker removes the account's stored media and Auth account after the five-day deadline. Signing in during the grace period cancels the schedule. Failed purges are retried on the next hourly run.

After migration `20261105000000`, apply `supabase/migrations/20261106000000_reliable_listing_ratings_and_message_actions.sql`. It enables transactional renter ratings, updates owner profile-view counts, and permits active (including pending-verification) members to block, report, and unsend messages. Listing ratings and account actions will not work until this migration has been applied to the connected Supabase project.

Owner and renter accounts sign in with their email address and password. Phone numbers can still be verified and linked to an existing account from **Settings & Privacy → Phone**; Philippine local numbers beginning with `0` are normalized to `+63`.

The user-to-self conversation behavior is separate from authentication. To enable it, apply `supabase/migrations/20261106000001_self_conversations.sql`; this migration also enables sending, opening, forwarding to, and deleting a user's private conversation with themselves.

Listing cards show the public average and rating count. The interactive stars show only the signed-in renter's own rating and remain gray until that renter rates the listing.

Renter and landlord accounts can access their dashboards while verification is pending or rejected, but they must upload a government ID and selfie to private storage and receive administrator approval before creating accommodation listings or roommate posts. Administrators review the account information and private documents. Approved accounts display a verified badge. Each listing and roommate post still requires separate administrator approval before it is visible to others. Users see pending, approved, and rejected status in My Posts; rejected roommate posts and their rejection reasons remain available in the admin User Posts directory. A user's own roommate posts do not appear in that user's public feed. Users can like and message other active accounts from visible, approved roommate posts. Updating verification details or a published post sends it back for review.

Renters can message other renters from approved roommate posts and contact landlords from approved accommodation listings. The app displays the listing owner’s profile name in new conversations. Account verification is still required to publish listings and roommate posts, but messaging and likes are available between active accounts, including accounts pending verification; suspended/deactivated accounts and blocked pairs cannot use them. Messages are stored privately and visible only to the two participants. The messaging migration creates a private attachment bucket, sent/seen state, per-user conversation hiding, presence records, and admin-readable conversation reports; apply it before using these features. Users and owners can review and unblock accounts from Settings & Privacy. Roommate post locations are entered as text by the poster; no external location service or device-location permission is needed.

The latest safety migration enables report categories and optional private screenshot evidence, admin decisions to dismiss, warn, or suspend, and notifications for both the reporter and any warned or suspended account. A suspended account cannot post, edit, message, or use other protected account actions. Users can block or unblock another account from the Messages area; blocked users and their posts/listings are hidden from each other.

The direct-message actions migration adds message reactions, forwarding to existing conversation contacts, per-user message hiding, and sender-only unsend-for-everyone. Unsend-for-you hides the message only from the current account; unsend-for-everyone replaces the message with an unsent notice and removes its attachment for both participants.

Deleting a conversation hides its history only for the person who deleted it. If that person messages the same contact again, only the new conversation is shown to them; the other participant retains their messages.

If verification upload reports `Bucket not found`, the database setup has not created the required private `verification-documents` storage bucket in the Supabase project configured by the app. Apply `20261027000000_account_and_content_review.sql` in the Supabase SQL Editor (after the preceding migrations listed above), then retry the upload. Do not make the verification bucket public.

Owner and renter accounts use `profiles.role` values `LANDLORD` and `RENTER`; the login screens validate the role before opening a dashboard. Users can edit a roommate post from My Posts; edits return it to pending review. Roommate post photos can be cropped before upload and managed while editing a post. Deleting a roommate post hides it from users without removing its record from the admin User Posts history. Renter accommodation favourites are stored in Supabase and are shared as listing like counts. Search bars on accommodation, roommate, and message screens filter their relevant lists; accommodation results continue to use saved search filters. The separate search and filter controls open matching-result windows, and owner dashboards show unique profile-view totals.

## Registration and verification submission

The registration workflow uses the existing private `verification-documents` bucket and profile document-path columns. Signup creates the account first. With immediate authentication, both selected documents upload automatically; with email confirmation enabled, documents upload only after confirmation and sign-in. Files remain in memory only and must be selected again after a tab reload. Submission becomes pending only after the versioned submission RPC commits; approval remains a separate admin decision.

### Reviewed migration rollout required

`supabase/migrations/20261111000000_verification_submission_workflow.sql` is a replacement for the earlier **unapplied draft**, not a production-deployed migration. This work has not executed SQL against production, changed live policies, or applied the migration to any Supabase project. If an earlier draft was applied elsewhere, prepare a separately versioned forward migration and review that database's actual schema instead of editing its migration history.

The draft now changes Storage policies and profile update grants. Review these changes explicitly before applying them anywhere outside the disposable test environment. It requires all preceding migrations and the original base schema; the repository does not reconstruct that base schema on an empty Supabase project by itself.

Database changes:

- Add nullable `profiles.verification_revision` plus read-protected submission snapshots and immutable document-path registrations. Legacy profile statuses, reasons, flags, timestamps, and revisions are not backfilled or rewritten. Existing document references are frozen, including missing references, so users cannot recreate an old referenced path with new content.
- Use `submit_boardmate_verification` to lock the caller's profile, compare the expected revision, validate both objects, register immutable paths, create a snapshot, and atomically set pending status. A replacement must use a fresh UUID path. An unchanged valid document can be retained; old paths cannot be swapped or reused as replacements.
- Use `review_boardmate_verification` to authorize admin membership, lock the profile and submission, compare the exact revision and pending state, and commit one decision. An older review or second decision fails. The admin UI must send the revision of the displayed documents and requires both document links to be opened for that revision before enabling approval. Opening links is a UI safeguard, not proof that a human examined the documents.
- Replace only the profile verification trigger. The original shared listing/roommate moderation function and suspension protection remain. Protected profile fields are no longer directly writable by authenticated clients, including admins; ordinary previously editable columns keep their grants and existing RLS still applies. Admin review must use the RPC.
- Add restrictive owner/admin Storage reads and owner-only mutations for unsubmitted objects. A Storage mutation trigger serializes with submission through sorted per-path advisory locks and rejects overwriting, moving, recreating, or deleting registered document objects. These checks supplement existing permissive policies; other buckets are unchanged.
- Preserve the existing trusted service-role purge exception and account-deletion cascades. Ordinary administrators do not receive permission to delete submitted files. Reviewer deletion can clear reviewer attribution without changing the decision or revision. Never put service-role credentials in the frontend.
- Keep one `profiles:<user UUID>` admin notification, reopening it only for a new revision. Existing unread legacy pending notices are marked read with an explicit status-retained message; account statuses and notification records are preserved. Notification failure rolls back the submission/decision database transaction; Storage uploads remain separate and the frontend handles safe cleanup/retry.
- Require trusted `postgres` ownership, empty function search paths, restricted helper execution, and owner/admin read access to snapshots. Preflight checks reject missing suspension protection, disabled RLS, unsafe admin-membership grants, an unexpected status type, missing notification uniqueness, or nonprivate/unbounded Storage configuration. Lock/statement timeouts limit deployment blocking.

Legacy policy:

- Existing approved, rejected, and pending accounts retain their exact statuses, even with missing/invalid references. Unrelated updates such as avatar changes do not reclassify them.
- Legacy pending accounts are listed in the existing user directory, but cannot be newly approved through an unversioned action. Users must explicitly submit updated documents before a new review. Previously stored invalid/missing documents must be replaced; the server explains that a retained invalid document is unacceptable.
- Legacy approved accounts keep existing posting access. They must explicitly submit documents before changing verified identity fields. Those edits fail without changing approval. A verification-management link is available to approved users. This is an intentional migration policy, not automatic invalidation or silent acceptance of a changed verified identity.
- Managed accounts can edit ordinary profile fields normally. Editing identity fields creates a new revision and sends the identity snapshot for review using the existing immutable documents, preserving the existing requirement to review identity changes.

Approval/deployment sequence:

1. Inspect a sanitized development clone's schema, constraints, function owners/grants, RLS policies, trigger order, and Storage metadata/configuration. Confirm `storage.objects.metadata` contains the expected `mimetype` and byte `size` fields and that the deployment role can install the Storage guard. Verify no custom writer/trigger bypasses these protections.
2. Run the offline suites below. They apply the draft only to in-memory PostgreSQL with a minimal Supabase-compatible fixture. No application `.env`, production URL, or production credential is read.
3. After review, apply the draft only to a disposable development Supabase project with the complete previous schema. Run the loopback integration tests and browser acceptance checks. Inspect any Storage internal-update incompatibility or real multi-session lock behavior before seeking production approval.
4. Back up the actual target schema/data and old grants/functions/policies. Review migration duration and lock timeouts on representative data. Coordinate both user and admin frontend deployment: old clients' direct verification writes will deliberately fail after the migration. Apply to production only with explicit approval.
5. Verify access, revisions, notifications, and scheduled deletion after an approved deployment. Rolling back requires an explicit data-mapping plan once new statuses/revisions exist; do not blindly rerun older migrations or disable the immutable-object guard. Retain document history until an approved retention or account-deletion process removes it.

### Automated tests

From `boardmate/`:

```sh
npm run test:verification
```

This runs frontend helper tests, the messaging regressions, and PGlite database tests for immutable paths, owner/admin access, direct API bypasses, stale/competing reviews, competing submissions, legacy compatibility, duplicate notifications, failure/retry handling, and trusted purging. PGlite executes real PostgreSQL triggers/RLS/ACLs but has a single connection: its competing-call tests verify serialized state transitions, not cross-session blocking.

For real parallel HTTP requests and the actual Supabase Storage API, configure a disposable **loopback HTTP** project explicitly using `BOARDMATE_TEST_SUPABASE_URL`, `BOARDMATE_TEST_SUPABASE_ANON_KEY`, and `BOARDMATE_TEST_SUPABASE_SERVICE_ROLE_KEY`, then run:

```sh
npm run test:verification:local
```

This opt-in suite creates/removes temporary accounts and verification uploads only on the explicitly configured loopback project. Cloud hosts, HTTPS, credentials in URLs, and HTTP redirects are refused. It never loads the app's `.env`; without the explicit test variables it reports skipped tests. Keep all credentials in the process environment, never committed files or frontend code. The local service credential is used only for fixture setup/cleanup. No schema or policy changes are performed by this suite; apply the reviewed migration to that disposable project separately first.

### Manual acceptance checks on development

1. Register renter and landlord accounts with immediate authentication; confirm auth precedes upload, private UUID paths are saved together, and status moves from not submitted to pending only on successful RPC commit.
2. Enable email confirmation; verify no upload before sign-in, correct confirmation instructions, and file reselection after reload.
3. Interrupt the second upload, fail the RPC or notification insert, and retry. Confirm no false success, no duplicate Auth account, and cleanup never deletes an immutable referenced file. A lost save response must trigger confirmation reads; unknown outcomes retain files and report uncertainty.
4. Open both documents in admin browser A. Resubmit in user browser B. Try approval and rejection from the old screen: both must fail and require refreshed review. Repeat with two admins deciding concurrently; exactly one decision may succeed. Repeat with simultaneous submissions from two user tabs.
5. Attempt same-path overwrite, rename/move, delete, historical-path reuse, path swapping, fabricated references, direct profile approval/path writes, and another user's paths through ordinary API clients. Verify objects and statuses remain intact. Test registered missing legacy paths as well as existing objects.
6. Confirm anonymous/other-user download and URL-signing are denied; owner/admin previews work; previously signed URLs remain bearer links until expiry. Verify actual Storage upload/update behavior, not only SQL metadata fixtures. Other buckets and unsubmitted-upload cleanup must continue working.
7. Compare legacy approved/rejected/pending records before and after migration and unrelated edits. Confirm no status/reason changes, legacy approved posting works, identity edits explain the explicit resubmission requirement, and a one-document replacement retains the unchanged valid document.
8. Verify notification uniqueness/reopening, verified badges, login/session restoration, profile edits, content moderation, and the five-day trusted purge worker. Use disposable accounts; never invoke permanent deletion on production for a test.

Known limits: MIME/size checks validate Storage metadata and do not prove document authenticity, inspect file signatures, scan malware, or establish identity. Real document content still needs administrator review; a content-inspection service would be a separate change. Database-owner/service-role access remains trusted. A future public-bucket change, custom privileged writer, or disabled guard can defeat these guarantees and must be controlled operationally. Historical private documents increase retention/storage usage until the approved cleanup policy or account deletion removes them. Real multi-session/Storage/browser integration requires the dedicated development environment and is not implied by passing the offline suites.

## Owner listing detail pages

Owner dashboard listing containers and the My Listings directory cards open a dedicated detail page in a new tab at the existing user-site entry point (`#listing/<id>`). View All remains the listing directory; its cards also show extra media previews and link to the full gallery. Availability controls remain separate actions and do not open another tab. The hard-coded `0 messages` icon has been removed from these listing cards. There is no comments section or comments database migration.

The detail page uses its own responsive CSS, renders the saved cover and every valid additional photo, retains video/audio uploads, and displays the full description, location, property type, availability/review state, and existing rating summary. Missing ratings do not prevent the gallery from loading. Owners cannot rate their own listing through this page. Existing profile-photo previews and messaging screens are unchanged.

Sessions remain in sessionStorage. A normal card click prepares a one-time, same-origin BroadcastChannel handoff for the new tab, with a 30-second parent timeout. Session tokens are never placed in the URL or localStorage, and links retain `noopener noreferrer`. The new tab removes handoff metadata after startup and validates the authenticated user before loading listing data. Matching-account refresh events keep handed-over sessions current; signing out stops that synchronization. Unsupported/private browsers, context-menu opens, or expired handoffs can sign in directly on the detail page. Listing RLS remains authoritative: other accounts cannot open an owner's private/pending listing merely by knowing its URL. Fragment routing requires no additional HTML entry point or server rewrite rules.

Run the listing tests from `boardmate/`:

```sh
npm run test:listings
```

Manual acceptance:

1. Open an owner listing with a cover, several extra images, and optional video/audio. Click its image, title, text, and whitespace from the dashboard and View All: each opens full details in a new tab. Repeat using keyboard Enter and middle click.
2. Confirm all gallery items appear, selecting a thumbnail changes the main media, and enlarge/save controls work. Check mobile/desktop layouts, long descriptions, missing images, and missing ratings.
3. Toggle availability in My Listings; that action must not open another tab. Confirm there is no dummy comments/messages icon, comments section, or dashboard chat overlay on the standalone page.
4. Test automatic sign-in, refresh, Back to dashboard, context-menu sign-in, expired handoff, and BroadcastChannel restrictions. Authentication tokens must never appear in the address bar. Confirm another account cannot view a private draft.

This feature uses existing tables/buckets and requires no new database migration. Browser/Supabase integration should be verified on development; automated tests cover URL routing, full-gallery normalization, and the session handoff using in-memory fixtures.

## Profile layout

Renter, owner and public profile views share `src/components/ProfileLayout.jsx` and scoped `src/profile.css`. Profiles use a centered circular avatar with an integrated photo-edit action for the signed-in owner only. Existing crop/upload handlers and verification badges are retained. Account details use a wrapping two-column grid, expanding to three columns on desktop; private account information is never added to the public profile.

The separate three-column media gallery includes profile photos and uploaded post/listing media, deduplicated by URL. Image tiles preserve the full image with contain sizing, while audio/video tiles open full previews. See all media shows the complete gallery. Post feeds are vertically stacked with untruncated titles/descriptions, wrapping location sections, natural image/video dimensions, and full-width audio controls. Existing post editing/deletion, likes, review feedback, photo saving, and listing previews remain available. Shared preview dialogs use a scrollable body within the app's available height.

Locations are existing text values; no external map service, geolocation request, database migration, or policy change was introduced. Uploaded map screenshots benefit from the same uncropped image presentation. The layout also provides appropriate full-width sizing for embedded map frames if such content is introduced separately.

Run `npm run test:profiles` from `boardmate/` for media-normalization/privacy checks and server-rendered tests of the actual shared JSX. These tests do not use the application environment or connect to Supabase. Browser checks should cover both roles at phone, tablet and desktop widths: circular avatar preview/edit and crop/upload, long emails/addresses, mixed media and all-media navigation, long stacked posts, retained renter edit/delete actions, rejection feedback, and scrolling/closing public/post previews. Public profiles must retain the private-contact-details notice and must never expose a photo-edit input or private account grid.

## Separate user and admin websites

The user/owner website is served from `index.html`; the admin website has its own entry point at `admin.html`. During development, use `npm run dev` for the user/owner site and `npm run dev:admin` for the admin site (at `/admin.html`).

Build and deploy them independently: `npm run build` outputs the user/owner site to `dist`, while `npm run build:admin` outputs the admin-only site to `dist-admin`. Deploy each output folder to its own website/domain. Signing out of the admin dashboard returns to the admin sign-in screen; the admin portal does not link to the user portal.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
