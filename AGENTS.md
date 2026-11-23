# Product preferences

- On November 8, 2026, the user put previous-week traffic comparisons on hold. Do not implement them as part of other work. When the user next asks for software or feature suggestions, remind them that this comparison was deferred and can be revisited.

- Keep account-removal UI concise: use “Remove”, a short name-confirmation prompt, and no “permanent/permanently” wording or pending-removal label. Do not add explanatory product copy unless the user requests it.

- Account access follows email → signup → login using the chosen credentials, including after removal and re-invitation. Signup is invitation-only. Removed identities must not be silently restored by Invite. Signup and password reset return to login rather than automatically entering the portal.
- Felix manages Vercel publication for both platforms. Make, test, and push changes to GitHub; do not publish to Vercel unless the user explicitly requests it again.
