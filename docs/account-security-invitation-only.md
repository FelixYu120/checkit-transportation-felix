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

This uses the existing 30-second membership recheck plus focus and authentication events; it does not claim instantaneous delivery of a remote removal notification. Public pages retain their existing access rules. No user account is deleted, and an authorized reinvitation can restore membership.
