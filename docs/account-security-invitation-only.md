# Invitation-only account security release

## Included changes

- Public self-registration is removed from both websites. Account completion requires a verified existing identity and active membership, including the explicit CheckIt administrator exception.
- Hosted Supabase signup must also be disabled (`disable_signup=true`). Removing a registration form alone does not enforce invitation-only access.
- Existing administrative invitation and reinvitation flows remain available. New invitations and resends of unfinished invitations lead to signup. Completed accounts are not reset by Invite; removed accounts must be deleted and receive a fresh identity when invited again.
- Both websites use Supabase JS 2.110.7, pinned to the release verified by the outage regression tests. Local logout is confirmed before redirecting. Failed server-wide revocation is reported separately.
- Transportation requires active membership for protected routes, resets views on account switches, and rechecks access every 30 seconds and on focus/authentication changes.
- Both websites ignore outdated membership responses so a delayed result cannot restore revoked access.
- Node.js 22 or newer is required by the updated SDK and declared in the website packages.

## Acceptance checks

Use dedicated test accounts in a test institution. Keep an administrator account available in a separate browser.

1. Open `/signup` and `/create-account` in a private browser without an invitation. Expect an invitation-required message and no registration form.
2. Sign in with an existing authorized account on each website and Field Teams. Expect the correct platform, role, and institution.
3. Invite a fresh test address with a viewer role. Confirm delivery, open the link, enter a name/password, and verify the selected role. The email delivery check is manual; automated tests do not send real invitations.
4. Sign out and sign back in with the invited account. Try invitation acceptance again and an expired link; neither should create an extra account or grant a higher role.
5. Remove the test member while their protected page is open in another browser. Expect the complete portal, including its header and navigation, to disappear on focus or within 30 seconds. The current platform session is signed out and the browser replaces the protected page with `/login` on the current platform. Reopening a protected URL must never show a portal header or private page before membership is verified. Direct data access is separately enforced by database/server permissions.
6. Reinvite the same address. Expect it to work without a duplicate-account error and preserve appropriate role boundaries.
7. Sign out normally, reload, and reopen the site. Expect the session to stay signed out. Browser password-manager entries may remain saved.
8. With the app loaded, interrupt connectivity and sign out. If local logout completes but remote revocation fails, expect the local-only sign-out notice. Reopen after restoring connectivity and verify the local session is absent.
9. Switch between two test accounts and between Occupancy/Transportation. Expect no protected page or account information from the prior identity.
10. Request a password-reset link for a test account and verify it returns to the same platform. Complete the reset, then test the new password.

## Hosted settings applied

On November 21, 2026 (America/Los_Angeles), both production Supabase projects were updated with exactly these settings and read back successfully:

- `disable_signup = true`
- `password_min_length = 8` (aligned with the existing website forms)

Email/password login remains enabled and email confirmation remains required. Production redirect lists include the correct platform login, account-completion, and password-reset URLs without wildcard hosts.

Custom SMTP is not configured on either project. The built-in Supabase email sender is restricted to organization-team addresses and is not a production invitation-delivery solution. Configure an owned transactional-email provider before claiming invitations and password resets work for general users. No real invitations or recovery emails were sent during automated verification.

The application changes still require a successful Vercel deployment. Felix can deploy the pushed commits through his authorized Vercel account; the deployment CLI in this workspace is signed out.

## Rollout checks

- Verify the deployed commit on each production website; a GitHub push is not deployment confirmation.
- Read back `disable_signup=true` on both Supabase projects. Keep email login/confirmation and administrative invitations enabled.
- Verify the production invitation and recovery redirect allowlists and the email-provider configuration. Avoid broad config replacement that could overwrite unrelated settings.
- Keep signup disabled during a website rollback. Login and recovery should remain available to existing accounts.

## Account-security follow-up

Administrator MFA enrollment, recovery and enforcement across the websites and Field Teams, fresh verification for password changes, hosted-secret ownership review, and any paid protections remain separately tracked. This release does not certify the entire account-security workstream complete. No MFA enrollment, administrator demotion, paid-plan purchase, or user deletion is implicit in deployment.


## Revoked-member exit behavior

The access guard covers the complete portal shell rather than only the page content. Confirmed missing or revoked membership removes all portal UI before local session cleanup begins, clears the portal conversation cache, and sends the browser to the current platform’s login page using history replacement. Session-cleanup errors do not leave the portal visible. A temporary verification outage also removes the portal and returns to the landing page, while preserving a valid session for later retry.

This uses the existing 30-second membership recheck plus focus and authentication events; it does not claim instantaneous delivery of a remote removal notification. Public pages retain their existing access rules. The original membership-only removal retained the Auth account. The permanent-removal release below replaces that behavior for future removals.


## Permanent account removal release — November 22, 2026

The team action removes the account **from the selected platform**. Occupancy and Transportation have independent identity stores; removing a person from one does not silently delete the other account. No existing member is removed merely by applying this release. Previously detached accounts are not bulk-deleted, and Felix's restored account is not targeted.

An authenticated administrator calls `POST /api/team/remove` with a member UUID. Supabase verifies the caller, and the database independently rechecks current role, institution, target role, and self-removal protection. Institution administrators can remove their own viewers/field operators; CheckIt administrators can remove other elevated accounts across institutions. Finalization is executable only by the server service role.

Removal first records private, temporary retry state and revokes membership and platform-wide privileges. A concurrent invitation cannot reactivate a pending removal. Personal profile photos, including orphaned older photos, are deleted through the Storage API. Upload checks lock the account row so an in-flight upload cannot escape the cleanup list. If cleanup fails, the account remains revoked and appears as **Removal pending** in the authorized team directory. Retrying continues cleanup. The UI never falls back to the former membership-only RPC or reports a partial cleanup as permanent deletion.

The final database transaction transfers reports to another administrator in the same institution, preserves company firmware with reassigned ownership, anonymizes structured historical identity and attribution, unassigns follow-up work, removes old email-based report shares, and deletes the Auth account, profile, identities, refresh tokens, sessions, factors and account-linked SCIM data. It also deletes its temporary removal record. A report owner cannot be removed without another administrator in that institution. Unknown owned file buckets block removal for review rather than deleting company assets. Finish pending removals before removing their receiving administrator. If the receiving administrator's role/institution changes during cleanup, support must repair the recipient before finalization.

Saved report versions remain immutable during normal work; only the owner-executed removal transaction may redact attribution. Company narrative content is preserved. The release does not promise to remove arbitrary mentions embedded in free text, third-party mailboxes, browser password vaults, managed audit records, or retained backups. Existing access JWTs can remain cryptographically valid until expiry; missing membership denies private application access. The website exits the portal on its existing focus/authentication/30-second recheck.

A reinvitation after successful deletion creates a fresh Auth identity. A server-owned readiness check verifies that the account has a password before protected portal pages render. Opening an email invitation authenticates email ownership, but a fresh invited account must still complete password setup. Existing accounts with passwords remain ready. Public signup remains disabled. This does not configure the still-pending production SMTP provider.

### Deployment and verification

Stage `supabase/migrations/20261123010000_permanent_team_account_removal.sql` first, in a transaction, and record its exact version in Supabase migration history. Other pending telemetry/photo migrations are outside this release. Deploy the API and website together and verify the production API is live. Only then apply and record `20261123010100_retire_membership_only_removal.sql`. The second phase makes the old removal RPC explicitly require a portal refresh, so an outdated client cannot silently detach an account. If publication is blocked, leave the retirement migration unapplied: existing administrators must retain their current ability to revoke access while the release awaits deployment.

For local SQL regression tests, create an isolated PostgreSQL database named `checkit_permanent_removal_test` and run:

```sh
python3 supabase/tests/run_permanent_removal.py --host /path/to/local/socket --port 55439
```

The runner inlines the actual workflow and removal migrations in one fixture transaction and rolls back synthetic identities, files, reports, and permissions. The historical `team_member_removal.sql` tests cover the superseded migration; this new suite covers permanent deletion.

After deployment, use a dedicated disposable account, not a real colleague:

1. Keep an administrator signed in separately. Invite the disposable address with a viewer role and complete its account setup.
2. Keep its private portal open in another browser, remove it as administrator, type its exact displayed name/email, and confirm permanent removal. The member should disappear, and its open portal should return to the current platform’s login page on focus or within 30 seconds.
3. Try the old password and old protected URLs. Private access must fail. Confirm profile photos are gone and company reports/firmware remain with transferred ownership and former-member attribution.
4. Reinvite the same email. It must have a new UUID, require fresh password setup, and inherit no old email-based report shares. Delivery still requires working SMTP.
5. With a disposable account, simulate a Storage/API outage. Expect no false success, a revoked account, a pending-removal row after reload, and a successful retry once connectivity is restored.
6. Confirm viewers, field operators, another institution's administrator, and self-removal are denied; confirm authorized administration still works on both platforms.

Rolling back the website must not restore the detach-only RPC. Keep the new removal protections in place; completed account deletions are irreversible and are not undone by a code rollback.


## Account UI follow-up

Revoked members return to the same platform's `/login` page after local session cleanup. Temporary verification outages retain the separate public-landing fallback to avoid repeatedly redirecting a still-valid session between login and the portal. All account-completion fields remain required and display a red asterisk. The removal dialog uses a short confirmation prompt; the success notice simply reads “Name was removed.” It includes a dismiss button and clears automatically after three seconds, with timer cleanup on dismissal or unmount.


## Invited-profile completion repair

Invitations already create a profile. Account completion now updates only `full_name`, scoped to the verified Auth user's ID, and confirms the returned ID and name before setting a password. It does not upsert the profile or request `UPDATE(id)`, which Occupancy correctly denies. Email, role, institution, assignments, and account identity remain untouched. Failed or unconfirmed saves cannot report completion or proceed to password setup.

`supabase/tests/invitation_profile_completion.sql` exercises the actual installed profile grants, row policies and triggers in a single rolled-back transaction using synthetic accounts. It reproduces the legacy upsert denial where IDs are immutable, verifies the name-only update, and confirms cross-account edits and protected role changes remain blocked. Run the entire file in one connection; it creates no credentials, sends no emails and changes no existing account. This repair requires website deployment only; no database permissions are loosened.

The removal dialog uses “Remove user?” and exact-name confirmation, with the concise prompt “Type [name] to confirm.” The success message remains “Name was removed.” with a dismiss button and three-second timeout. Existing open tabs must reload to load updated application code.


## One-use invitation setup and cleanup repair

Signup URLs render no form until `invitation_setup_status` confirms a valid, unused invitation and a session created after its issuance. A completed account, missing invite, expired window, revoked membership or older session returns to login. Setup expires fifteen minutes after issuance, including while the form is open. Refreshing a session does not extend it. Resending mail records a fresh window only after delivery is accepted; the recipient must open the latest invitation. Only unfinished invitations can be resent. Completed active accounts cannot be reset by Invite. Deleted accounts receive a new identity on a new invitation; detached or orphaned identities are never silently restored. Self-invitations are rejected. Opening signup without a new invitation never reopens completed setup. The first-password Auth trigger checks the deadline and consumes the ticket in the same database transaction; existing password changes continue to work. Both `/signup` and `/create-account` use this gate. No existing password is changed by deployment or by inviting an already-completed account. Setup requires a new invite/OTP session, and the portal also verifies that the current session still exists. Duplicate delivery recording never resets completed setup, and an older concurrent delivery cannot replace a newer invitation. Email token expiration is configured to 900 seconds in both production projects; Supabase applies this setting to other email links, including password recovery, too.

Apply `20261123021000_single_use_invitation_setup.sql` alone, then deploy the invitation API and website. Occupancy needs both its API and website projects published. Transportation deploys them together. This supersedes the earlier session-only signup gate. Synthetic tests cover expiry, consumed tickets, older sessions, sender authorization and preservation of normal password changes.

`20261123020000_fix_account_cleanup_report_guard.sql` repairs the legacy saved-report trigger, which was reverting ownership transfers made by server cleanup. The trusted removal transaction can transfer reports; normal client ownership checks remain intact. The actual legacy trigger is now included in cleanup regressions. This migration changes function definitions and processes no existing removal job by itself. Real-user cleanup is completed by the admin's Remove action.

User-facing removal wording is “Remove”, with a short confirmation prompt, no pending-removal badge, and “Name was removed.” with dismiss and three-second expiry. Internal retry state remains private so a failed file operation cannot cause false success or reactivate access.


## Invite, signup, login and password reset

The required sequence on both platforms is email → signup → login with the chosen credentials. The same sequence applies after removal and a new invitation. Signup and recovery sessions cannot enter the portal as password logins. Saving a signup or reset password verifies local session cleanup and returns to `/login`; neither action automatically opens a dashboard.

New invitation emails target `/signup`; reset emails target `/reset-password`. The email templates place the one-time token hash in the URL fragment, and the frontend exchanges it once through Supabase `verifyOtp`. The token is not sent to Vercel in a URL query. React StrictMode and repeated subscribers share the same exchange. Legacy Supabase confirmation URLs remain supported. Invalid or expired link errors are preserved as short notices instead of disappearing into an unexplained login page.

Signup still requires an active, unused, unexpired server invitation and a fresh invite/OTP session. Password reset requires its own 15-minute ticket, an existing completed active account, and a matching recovery session. Saving the new password consumes that reset ticket; ordinary profile password changes also invalidate outstanding reset setup. Removing the Auth account cascades both invitation and recovery records.

### Publishing this release

1. Apply `20261123040000_invitation_login_password_reset.sql` to each matching Supabase project. In this task Codex applied the scoped migration and recorded it in migration history; do not bulk-apply unrelated migrations.
2. Configure the matching Auth email templates and exact redirect paths with `node supabase/scripts/configure-email-links.mjs --project-ref <ref> --apply`, using an existing `SUPABASE_ACCESS_TOKEN` in the environment. In this task Codex applied and read back this configuration on both projects. Never put that token in frontend environment variables or Git.
3. Felix publishes the latest website and API code. For Occupancy, publish the website first, then `checkit-api`. Transportation publishes its website/API together. The template branches retain legacy links for older callback paths, so changing the configuration does not require all clients to upgrade simultaneously. No new Vercel environment variables are required.
4. Send fresh emails after publication. Existing emails keep their original destination and expire normally; configuration changes do not rewrite delivered mail.

### User acceptance checks

- Invite a new email. Open its newest link within 15 minutes: signup appears, all required fields must be completed, and saving leads to login. Sign in with the chosen password.
- Remove that user with its portal open. It must lose access. Invite the same email again: a new account ID and fresh signup are required, with no old password, session, personal photo, or account grants restored.
- Open `/signup` directly without a valid invitation, and reopen a completed or expired invite. No registration form is available.
- Request password reset, open the newest email, save a new password, and sign in. The old password and used reset link must not work.

Local verification combines the real browser Auth SDK with stubbed Auth HTTP responses, real React route/form tests, and isolated PostgreSQL account/removal fixtures. It sends no email and changes no real member account. Real email delivery and browser acceptance checks still require the published release.
