# Invitation-only account security release

## Included changes

- Public self-registration is removed from both websites. Account completion requires a verified existing identity and active membership, including the explicit CheckIt administrator exception.
- Hosted Supabase signup must also be disabled (`disable_signup=true`). Removing a registration form alone does not enforce invitation-only access.
- Existing administrative invitation and reinvitation flows remain available. Confirmed members receive sign-in links; unconfirmed members complete account setup.
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
5. Remove the test member while their protected page is open in another browser. Expect the complete portal, including its header and navigation, to disappear on focus or within 30 seconds. The current platform session is signed out and the browser replaces the protected page with `https://checkit.dev/`. Reopening a protected URL must never show a portal header or private page before membership is verified. Direct data access is separately enforced by database/server permissions.
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

The access guard covers the complete portal shell rather than only the page content. Confirmed missing or revoked membership removes all portal UI before local session cleanup begins, clears the portal conversation cache, and sends the browser to the main CheckIt landing page using history replacement. Session-cleanup errors do not leave the portal visible. A temporary verification outage also removes the portal and returns to the landing page, while preserving a valid session for later retry.

This uses the existing 30-second membership recheck plus focus and authentication events; it does not claim instantaneous delivery of a remote removal notification. Public pages retain their existing access rules. The original membership-only removal retained the Auth account. The permanent-removal release below replaces that behavior for future removals.


## Permanent account removal release — November 22, 2026

The team confirmation now explicitly describes permanent deletion **from the selected platform**. Occupancy and Transportation have independent identity stores; removing a person from one does not silently delete the other account. No existing member is removed merely by applying this release. Previously detached accounts are not bulk-deleted, and Felix's restored account is not targeted.

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
2. Keep its private portal open in another browser, remove it as administrator, type its exact displayed name/email, and confirm permanent removal. The member should disappear, and its open portal should leave for CheckIt's landing page on focus or within 30 seconds.
3. Try the old password and old protected URLs. Private access must fail. Confirm profile photos are gone and company reports/firmware remain with transferred ownership and former-member attribution.
4. Reinvite the same email. It must have a new UUID, require fresh password setup, and inherit no old email-based report shares. Delivery still requires working SMTP.
5. With a disposable account, simulate a Storage/API outage. Expect no false success, a revoked account, a pending-removal row after reload, and a successful retry once connectivity is restored.
6. Confirm viewers, field operators, another institution's administrator, and self-removal are denied; confirm authorized administration still works on both platforms.

Rolling back the website must not restore the detach-only RPC. Keep the new removal protections in place; completed account deletions are irreversible and are not undone by a code rollback.
