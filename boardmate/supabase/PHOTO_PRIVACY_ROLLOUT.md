# Photo controls, manual cropping, and portal navigation

Implemented locally for renter and owner portals. No live database or Storage settings were changed.

## Deploy together

Apply these migrations in order (each now initializes the shared visibility revision table, trigger function, permissions, and Realtime publication membership if missing):

1. `20261111000004_profile_photo_privacy.sql`
2. `20261111000005_post_photo_privacy.sql`

Deploy the updated user and administrator frontends alongside them. These migrations make `profile-photos`, `listing-photos`, and `roommate-post-photos` **private**. Stored URLs remain stable identifiers; the updated renderer fetches bytes through authenticated Storage requests with caching disabled. Deploying only the SQL will break media on older frontend versions that request public URLs directly. External image URLs and other buckets, including private verification documents and direct-message attachments, retain their existing behavior.

Check the installed public-profile RPC, Storage policies, bucket names, and listing `image_url` nullability in staging first. The profile migration explicitly checks the installed RPC before adding its privacy filter. The post migration expects the existing listings/roommate post media columns. Confirm `boardmate_visibility_revision` remains in the Realtime publication. The separate suspension migration still supplies suspended-account content restrictions; initializing the shared refresh helper does not install those restrictions.

If an earlier attempt failed with missing `publish_boardmate_visibility_revision()`, run the complete corrected profile migration, then the complete corrected post migration. Both are transactional, so a failed complete run rolls back its changes. If your SQL session reports an aborted transaction, execute `ROLLBACK;` first. Do not execute a truncated trigger fragment: the function name is `public.publish_boardmate_visibility_revision()`, not `blish_boardmate_visibility_revision()`.

The owner controls appear on uploaded images in the profile gallery and profile post cards. They cover profile uploads, accommodation images, and roommate-post images. Videos/audio keep their existing controls. “Only Me” keeps the physical file but prevents other users from downloading it, including through direct Storage requests. “Public” restores access subject to the parent account/post/listing's original visibility and moderation rules. Only owners can change visibility or delete; administrator status alone does not grant these mutations.

Public profile galleries omit inaccessible tiles. Avatar, listing, feed, and preview renderers also enforce authenticated media access. Realtime revision updates refresh access; a 15-second fallback and window-focus refresh repair missed updates. Playback URLs stay stable while access is allowed, so polling does not repeatedly restart a video/audio player. Bytes someone previously downloaded or saved cannot be recalled. Previously cached public/CDN responses can persist until cache expiry; validate the provider's cache invalidation during rollout.

Permanent deletion requires the shared confirmation dialog. It first removes the actual file through Supabase Storage, then an owner-checked RPC removes gallery/post/listing references. Database deletion refuses to proceed while the Storage object still exists. Storage and PostgreSQL do not share one transaction: if reference cleanup fails after the file is removed, the UI reports that outcome and allows retry. The file remains inaccessible during cleanup. Profile deletion clears the current avatar when it matches. Listing/post deletion retains the parent row and unrelated media. Deleting a listing cover leaves no cover until the owner chooses another one. Existing listing edit/moderation triggers still apply to media changes; this change does not bypass required review or rewrite review decisions.

## Crop behavior

The shared cropper now has an unconstrained rectangular frame with eight drag handles. Mouse/touch users can drag and resize; keyboard users can focus the frame/handles and use arrows (Shift for larger steps). Selection coordinates map directly to original pixels and stay inside the image. Export preserves the selection's aspect ratio and uses PNG, retaining transparency, capped at 2400 pixels on the longest side. Existing upload size/type checks still apply. “Keep original” preserves the original file, including GIF animation; cropping exports a still image.

Every file-upload input now offers cropping for selected images; PDF, video, and audio files pass through unchanged. Multiple images are processed sequentially. Profile uploads keep their existing crop-before-upload flow; captured selfies also offer cropping. Existing edit-crop buttons reopen the same manual cropper. Verification document privacy and submission/review rules remain unchanged.

## Navigation and message playback

Settings & Privacy and Notifications now replace the dashboard with a dedicated full-page view, retaining the previous dashboard tab state. Each has a Back button; all settings sections and notification actions remain available. Confirmation dialogs for destructive actions remain dialogs.

Both message portals use paused-by-default native video/audio controls. Playback/control clicks stop propagation. Container padding and the expand button open the preview, without the old “Preview and save” link. Starting one message player pauses other players in that conversation.

## Verification

From `boardmate`:

```powershell
node --test tests/photoPrivacy.test.mjs tests/profileLayout.test.mjs tests/registrationUi.test.mjs tests/listingDetails.test.mjs tests/directMessages.test.mjs
npx.cmd eslint src
npm.cmd run build
npm.cmd run build:admin
```

The disposable PostgreSQL tests exercise the real privacy migrations, owner/viewer/anonymous Storage access, hide/unhide, direct mutation rejection, foreign-path protection, deletion prerequisites, and listing/post reference cleanup. UI tests check crop geometry/export, full-page semantics, native media properties, and control/preview event separation. They do not contact a live Supabase project.

In staging, use two accounts (renter and owner) plus a separate viewer. Hide/unhide each type of uploaded image and check the profile, profile post cards, feeds, listing details, open previews, and direct Storage download requests. Delete the current avatar, a listing cover, a gallery image, and a roommate image; verify the actual Storage object is removed and unrelated images/content remain. Retry an interrupted reference cleanup. Test Android touch resizing, portrait/landscape photos, multiple-image uploads, keyboard resizing, transparent images, PDFs, selfie captures, native audio/video controls, and Back navigation from every settings section and notification destination. Reload with a stale tab to verify access refresh. Do not claim browser/device or live Storage verification solely from the disposable tests.


## Admin post and listing media retrieval repair

Apply `20261111000010_admin_media_references.sql` after the earlier photo privacy and admin media access migrations, then deploy the updated frontend. The repair preserves private buckets, owner permissions and member visibility/blocking rules. Admin access remains limited to files referenced by listing/post database records, including pending, rejected and deleted posts. No service-role key is used in the browser.

The SQL access check now accepts path-only references, `path`/`storage_path`/`src` objects, legacy public URLs, signed URLs, and percent-encoded filenames. The admin frontend normalizes those references into stable Storage identifiers, discards expired signed tokens for same-project URLs, and retrieves bytes through the authenticated Storage SDK. Existing database values are retained. Video controls and full-size previews use the same protected retrieval flow. Loading, unavailable/retry, and successfully loaded states are distinct.

Run `node --test tests/adminMedia.test.mjs tests/photoPrivacy.test.mjs`. These tests cover normalization, admin Storage SELECT authorization for both post/listing buckets, rejected media, private-member boundaries, anonymous denial, and unrelated privacy/deletion behavior. Run both frontend builds when changing the shared media loader.

Staging checks: sign in as an administrator and inspect older and newly uploaded images/videos in User Posts and Accommodation Listings, including approved/rejected records. Play videos and open full-size previews. Sign in as an ordinary member and confirm hidden/rejected content remains inaccessible. A truly deleted Storage object cannot be recovered by changing access policies; restore it from a backup or re-upload it.

This migration and UI have been tested locally; live policy/function deployment and actual object existence still require Supabase project access. If a record still fails, inspect `can_read_boardmate_uploaded_media`, the Storage download response and exact object path in the protected dashboard. Do not make the buckets public to bypass the error.
