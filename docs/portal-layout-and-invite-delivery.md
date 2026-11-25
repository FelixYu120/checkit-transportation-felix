# Portal layout and invitation delivery

## Publication

Felix publishes both websites and the Occupancy cloud backend after pulling these commits. Transportation's invite API is included in its website deployment. This release needs no database migration and introduces no Vercel environment variables.

## Portal layout

On screens wider than 960 px, the Navigation button collapses/reopens the tree without clearing its selection. Drag the navigation divider to change the tree width, or the data/map divider to change their relative widths. The map stays mounted, including Transportation's selected-sensor focus.

Both dividers support Left/Right arrows, Shift for larger steps, Home/End for the limits, Escape to cancel an active drag, and double-click to reset. Minimum pane widths prevent dragging a panel closed. Preferences are stored separately for Occupancy and Transportation in that browser; blocked browser storage does not prevent resizing. Narrow screens retain the navigation drawer and stacked data/map layout.

## Signup transition

Saving the password emits USER_UPDATED before the Auth request resolves. Signup pauses its invitation recheck during that write, then finishes local sign-out without remounting the setup form. This prevents a consumed invitation from flashing an invalid/required screen before login. Changing to another user identity still resets the form, and sign-out from portal routes still unmounts account-specific state. Invitation validation and the 15-minute deadline remain enforced by the server.

## Email findings — November 24, 2026

Read-only checks found that both hosted projects use Supabase's built-in sender, with no custom SMTP or Send Email hook, and `rate_limit_email_sent = 2`. Invitations, resends, and password recovery share the project email quota. Occupancy's Auth logs include earlier HTTP 429 email-limit failures. A recent invite was accepted by Auth, which does not prove inbox delivery. The checked Occupancy invitations remained unused, while their Transportation counterparts had completed signup.

GoTrue can seed a password hash during invitation acceptance. Use `checkit_accounts_private.password_setup_complete(user_id)` and invitation `used_at` to determine whether the person finished signup; the presence of `encrypted_password` alone is insufficient.

The API now returns a short email-limit or sender-configuration error when the provider rejects delivery, and does not record or report a successful invite. This improves feedback; it does not remove Supabase's sending restrictions.

## Required sender setup

1. Choose a transactional email service that supports SMTP and verify a sender domain you control. Complete its domain/DNS checks with the domain owner. No AWS migration is needed.
2. Configure that service in **each Supabase project's Auth SMTP settings**: SMTP host, port, user, password, sender address, and sender name. Store credentials directly in Supabase, not in GitHub or chat.
3. Keep the existing branded invite, magic-link, and recovery templates, token-hash links, public app origins, invitation-only signup setting, and 900-second expiry. Do not restore consuming confirmation URLs in the email templates.
4. Set a project email limit appropriate for the provider's allowance and actual team volume. Retain per-user resend limits. Configuring SMTP is required before raising the built-in sender's limit can help.
5. Publish the web/API changes, then use **Resend invite** for pending members to issue fresh links. Old links keep their original expiry.

Supabase documents the built-in sender as a limited testing service with recipient restrictions and no delivery guarantee: https://supabase.com/docs/guides/auth/auth-smtp . Current rate limits: https://supabase.com/docs/guides/auth/rate-limits .

## Manual checks after publication

- Collapse/reopen the tree, drag both dividers, reload, and confirm the chosen widths return. Resize the window to a phone width and confirm the drawer and stacked map remain usable.
- Finish an invitation and confirm a clean transition to login, then sign in with the new password. The signup URL must still reject visitors without an invitation.
- After SMTP is configured, send one new or resent invitation and one password-reset email on each platform. Confirm receipt and that each link opens the matching platform. Test links only for accounts you control.

Automated checks cover auth-event timing, account-state reset, drag coordinates, bounds, keyboard controls, persistence, blocked storage, cancellation, map mounting/focus, and provider-error handling. Browser preview was unavailable in the implementation session; a visual check is still needed after publication.
