# Persistent admin media investigation ? 11 November 2026

## Confirmed live results

Read-only HTTP requests were made to the configured Supabase project's public RPC interface using synthetic references. No account records, uploaded files, or tokens were printed.

| Check | HTTP status | Actual | Expected with migration 00010 |
| --- | --- | --- | --- |
| Plain public URL reference matches its path | 200 | true | true |
| Raw object path matches itself | 200 | false | true |
| URL-encoded filename matches decoded object path | 200 | false | true |
| Anonymous media access denied | 200 | false | false |

This confirms that the deployed `boardmate_media_url_matches` behavior differs from `20261111000010_admin_media_references.sql`. It does not establish the deployed admin branch of `can_read_boardmate_uploaded_media`, whether an individual file exists, or that every failing request has the same cause. Admin authentication and a concrete failing request are still needed to resolve those questions.

Repeat with `python server/diagnose_media_access.py` from `boardmate`. Exit code 1 means at least one check failed; the script outputs individual results. It does not create posts, upload files, inspect users, or change database objects.

## Repair and diagnostics

Apply the existing, locally tested `supabase/migrations/20261111000010_admin_media_references.sql` to the correct project after the preceding privacy migrations. Do not rerun older non-idempotent privacy migrations or make buckets public. Rerun the script; all four checks should pass. Deployment requires database administrator/project access, which is not connected to this session.

The frontend now reports sanitized `[BoardMate media]` diagnostics for permission RPC errors/denials, Storage download errors, and native image/video decode failures. Reports include stage, permitted error codes, HTTP status when available, bucket, and a session-local media reference number. They exclude actual URLs, query strings, paths, filenames, user IDs, tokens, raw server messages and full error objects. Duplicate identical reports are suppressed to avoid polling spam. Successful requests do not generate diagnostics.

The loader also correctly transitions to failure if access is revoked between its initial permission check and the completed download; previously that branch could leave it loading indefinitely. This race fix is separate from the confirmed deployment mismatch.

## Remaining acceptance verification

A connected Supabase project or redacted failing request is required to inspect the actual admin session's permission RPC and Storage download. A permission RPC may return HTTP 200 with `false`, in which case the frontend deliberately never downloads the file. A failed image request is therefore not guaranteed to appear in Network.

With administrator access, confirm the account is in `admin_memberships`, compare the exact stored bucket/object path with Storage (case-sensitive), verify the referenced file exists, and inspect applicable SELECT policies. Compare the same record in an owner/member session and admin session. Distinguish a permission-RPC failure from a subsequent Storage 403/404 or native codec failure before making further policy changes. Do not share Authorization/apikey headers, signed URL query strings, names, or user IDs in diagnostic exports.

The following live tests are still pending and must not be reported as passed:

- One existing and one newly uploaded renter/User post, including image/video previews.
- One existing and one newly uploaded Owner listing, including image/video previews.
- Corresponding review sections, approved/rejected views, refresh and reopen behavior.
- Successful playback/full-size previews with no failed media requests or media Console errors.
- Ordinary members remain unable to access private/rejected media reserved for admin review.

Local validation passed: `node --test tests/mediaDiagnostics.test.mjs tests/adminMedia.test.mjs tests/photoPrivacy.test.mjs` (6 tests), targeted ESLint, `npm run build:admin`, and `npm run build`. Browser Console/Network and live Storage object tests have not been performed.
