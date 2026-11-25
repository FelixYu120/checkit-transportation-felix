# Portal layout and invitation delivery

## Publication

Felix publishes both websites and the Occupancy cloud backend after pulling these commits. Transportation's invite API is included in its website deployment. This release needs no database migration and introduces no Vercel environment variables.

## Portal layout

On screens wider than 960 px, the tree opens by default on each portal entry, including browsers with an older saved collapsed preference. The icon beside search collapses/reopens it during the visit without clearing its selection; that collapsed state is not saved across visits. The tree has a fixed width and no resize divider or heading. Collapse fades and slides the content while the rail contracts. The data/map divider changes only those panels' relative widths. The map stays mounted, including Transportation's selected-sensor focus.

The data/map divider supports Left/Right arrows, Shift for larger steps, Home/End for the limits, Escape to cancel an active drag, and double-click to reset. Data takes 50–70% of the available workspace, with tighter limits where needed to preserve usable panel widths. Pointer updates are coalesced to animation frames, and pointer-up saves the final position. Keyboard changes animate; dragging tracks the pointer directly. Reduced-motion preferences disable transitions. Preferences are stored separately for Occupancy and Transportation in that browser; old tree-width preferences are ignored. Blocked browser storage does not prevent resizing. Narrow screens retain the navigation drawer and stacked data/map layout, even if the desktop tree was collapsed.

## Signup transition

Saving the password emits USER_UPDATED before the Auth request resolves. Signup pauses its invitation recheck during that write, then keeps its success view through sign-out and any late empty-session events. Once local session cleanup is confirmed, it replaces the route with login without a full page reload; the login module is prefetched during signup. The form is hidden after success, and retrying failed session cleanup does not repeat signup. Invalid, expired, and completed invitations redirect to login with the appropriate notice instead of painting an invitation-required page. Changing to another user identity still resets the form, and sign-out from portal routes still unmounts account-specific state. Invitation validation and the 15-minute deadline remain enforced by the server.

A public-asset check on November 25, 2026 found Occupancy still serving an older signup bundle without the earlier transition handling. Felix must publish the website project after pulling the current commits; publishing only its backend does not update the browser code. These circular-avatar and transition refinements require website publication on both platforms and no database migration.

## Email findings — November 24, 2026

Read-only checks found that both hosted projects use Supabase's built-in sender, with no custom SMTP or Send Email hook, and `rate_limit_email_sent = 2`. Invitations, resends, and password recovery share the project email quota. Occupancy's Auth logs include earlier HTTP 429 email-limit failures. A recent invite was accepted by Auth, which does not prove inbox delivery. The checked Occupancy invitations remained unused, while their Transportation counterparts had completed signup.

GoTrue can seed a password hash during invitation acceptance. Use `checkit_accounts_private.password_setup_complete(user_id)` and invitation `used_at` to determine whether the person finished signup; the presence of `encrypted_password` alone is insufficient.

The API now returns a short email-limit or sender-configuration error when the provider rejects delivery, and does not record or report a successful invite. This improves feedback; it does not remove Supabase's sending restrictions.

## Required sender setup

The latest setup request is for Occupancy. No provider account or verified sending domain is available yet, and no SMTP settings have been changed. Supabase continues to generate and validate invitation and recovery messages; an SMTP provider only delivers those messages. Do not enable SMTP using placeholder credentials.

1. Choose a transactional email service that supports SMTP and verify a sender domain you control. Complete its domain/DNS checks with the domain owner. No AWS migration is needed.
2. Configure that service in **each Supabase project's Auth SMTP settings**: SMTP host, port, user, password, sender address, and sender name. Store credentials directly in Supabase, not in GitHub or chat.
3. Keep the existing branded invite, magic-link, and recovery templates, token-hash links, public app origins, invitation-only signup setting, and 900-second expiry. Do not restore consuming confirmation URLs in the email templates.
4. Set a project email limit appropriate for the provider's allowance and actual team volume. Retain per-user resend limits. Configuring SMTP is required before raising the built-in sender's limit can help.
5. Publish the web/API changes, then use **Resend invite** for pending members to issue fresh links. Old links keep their original expiry.

Supabase documents the built-in sender as a limited testing service with recipient restrictions and no delivery guarantee: https://supabase.com/docs/guides/auth/auth-smtp . Current rate limits: https://supabase.com/docs/guides/auth/rate-limits .

## Manual checks after publication

- Collapse/reopen the tree, drag the data/map divider to both limits, reload, and confirm the split returns. Confirm there is no tree resize handle or visible heading. Resize the window to a phone width and confirm the drawer and stacked map remain usable.
- Finish an invitation and confirm a clean transition to login, then sign in with the new password. The signup URL must still reject visitors without an invitation.
- After SMTP is configured, send one new or resent invitation and one password-reset email on each platform. Confirm receipt and that each link opens the matching platform. Test links only for accounts you control.

Automated checks cover auth-event timing, account-state reset, drag coordinates, bounds, keyboard controls, persistence, blocked storage, cancellation, map mounting/focus, and provider-error handling. Browser preview was unavailable in the implementation session; a visual check is still needed after publication.
