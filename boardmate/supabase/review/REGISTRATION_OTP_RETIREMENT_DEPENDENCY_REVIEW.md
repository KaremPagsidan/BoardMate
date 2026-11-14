# Registration OTP retirement: review of supplied live results

No SQL was executed for this review, including local SQL tests. No migration, Auth setting or deployment was changed. The retirement migration is unchanged.

## Verdict

The three supplied live trigger summaries match the exact shapes accepted by 20261113000002_remove_registration_email_otp_triggers.sql:

| Trigger | Supplied live definition | Migration action |
| --- | --- | --- |
| boardmate_require_signup_email | auth.users AFTER INSERT ROW, type 5; enroll_boardmate_email_verification | Remove only this trigger |
| enforce_boardmate_email_before_review | public.profiles AFTER INSERT/UPDATE ROW, type 21; guard_boardmate_email_review | Remove only this trigger; corrected AFTER form is explicitly accepted |
| protect_profile_verification_fields | public.profiles BEFORE INSERT/UPDATE ROW, type 23; protect_boardmate_verification_profile | Require enabled O/A mode and expected public function binding; keep unchanged |

No timing revision is needed before retirement. The migration supports both the original type-23 OTP guard and the supplied corrected type-21 guard. Exact public-schema, no-argument function bindings should be verified from the additional query: unqualified names in a summary alone do not prove function OIDs/signatures match.

**Conditionally safe to retire the database OTP enforcement as written**, provided the remaining catalog/definition review finds no extra email-enforcement paths or unexpected dependencies. The supplied summaries alone do not prove complete live-schema compatibility or end-to-end signup success.

## What remains intact

The SQL contains no INSERT/UPDATE/DELETE and does not drop tables, functions, constraints or policies. Existing Auth accounts, profile statuses, verification submissions, enrollment rows, content and permissions are not rewritten. The enrollment table retains its Auth foreign key and RLS. Removing the enrollment trigger merely stops adding new enrollment rows. The two functions remain valid historical objects; they are inert only if no other triggers or code invoke them.

Local schema inspection found no dependency on the enrollment table or these OTP functions inside the document submission/review workflow or its policies. The local submission RPC still requires an authenticated, non-suspended account, matching document revision and validated private uploads. The review RPC still checks administrator membership, Pending revision, document validity and review status. protect_profile_verification_fields still guards direct changes and initializes new profiles to not_submitted. These controls do not depend on the removed trigger running first or afterward. All automatic Pending transitions will intentionally lose only the email-confirmation prerequisite.

Dropping a trigger removes its attachment, not its function or the table it references. The migration does not use CASCADE. A dependency that prevents a normal DROP causes failure; its explicit transaction prevents a partial successful retirement. Review any custom DDL event triggers, which can add behavior outside these two explicit DROP statements.

## Live checks still needed

Run `registration_otp_retirement_dependencies.sql` manually if desired. It contains catalog-only SELECTs, no application RPC calls or account reads. Definitions can contain sensitive implementation details; share privately.

1. Query 1: all three pre-retirement matches should be true. The existing migration requires the profile protection enabled as O/A; the summary says enabled, but its literal mode should be inspected.
2. Query 2: check all trigger attachments. Only the two named OTP triggers should call the old enrollment/guard functions. Any extra attachment would remain active after this migration.
3. Query 3: review catalog dependencies in both directions. Expected dependencies include each OTP trigger -> its table/function, and the retained enrollment-table FK -> Auth key. Those do not require dropping the retained objects. Unexpected objects depending on the OTP triggers require review; do not add CASCADE to bypass them.
4. Query 4: review function/procedure source matches. The two retained OTP function definitions are expected hits. Review other functions for email checks that still block registration, document submission or approval. Recovery eligibility checks may legitimately reference email_confirmed_at and must not be removed indiscriminately.
5. Query 5: confirm the Auth profile-creation routine and document/admin routines exist with the expected bodies, ownership/search paths and privileges. Query 2 should show an enabled Auth profile-creation trigger such as on_auth_user_created_boardmate_profile -> public.handle_new_boardmate_user(). If the three supplied triggers were the entire unfiltered live inventory, that profile-creation attachment is missing relative to the local schema and new signup must not be declared healthy. A filtered OTP inspection commonly omits it; verify rather than assume. A differently named approved implementation can be valid after inspecting its body.
6. Queries 6/7: retain existing profile/document/storage RLS; review unexpected OTP dependencies in policies, views, rules or checks. The migration does not remove any such path.
7. Query 8: review any enabled DDL event triggers that could react to trigger removal. No event triggers are modified.

Catalog dependencies alone are incomplete for PL/pgSQL/string-defined routine bodies. The source scan supplements the catalog but is heuristic and cannot prove absence of constructed dynamic SQL, external code or Auth Hooks. PostgreSQL documents this limitation at https://www.postgresql.org/docs/16/ddl-depend.html . Inspect any configured Auth Hooks separately in the dashboard; this review changes none.

## Scope boundary

Database OTP retirement does not turn Supabase Confirm email OFF or edit email templates. If Auth still requires signup confirmation, new users can still receive no signup session and cannot proceed directly to authenticated document uploads. Coordinate that separately approved setting and the prepared frontend/template release; do not infer deployment readiness solely from the trigger matches. Removing signup confirmation means new signup no longer proves inbox ownership. Existing unconfirmed accounts are not mass-confirmed by this migration and may retain Auth login restrictions until individually resolved through an approved process.

Previously completed local tests covered both BEFORE/AFTER installations, repeated retirement, preservation snapshots, no-OTP signup/document submission for both roles and administrator-only decisions. These are prior local results, not new live tests or a guarantee of the complete live schema. No SQL tests were rerun during this read-only source review at the user's request.

After any later approved deployment, the separate existing `registration_without_otp_verification.sql` checks should show both OTP triggers absent and the document/admin guard, historical table and functions preserved.


## Subsequent user-supplied confirmation

The user subsequently confirmed that auth.users has BOTH enabled triggers: boardmate_require_signup_email and on_auth_user_created_boardmate_profile. The profile-creation attachment concern above is therefore closed at the presence/timing level; no change to it is proposed. The full remaining dependency/body/policy checks still apply. See REGISTRATION_OTP_PRODUCTION_DEPLOYMENT_CHECKLIST.md for the final coordinated release/rollback plan. No SQL was executed or live change made for this follow-up.
