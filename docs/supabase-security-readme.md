# Supabase Security README

This document explains the transportation Supabase security setup used by CheckIt.

The main SQL file is:

```text
docs/supabase-simple-security.sql
```

Run that file in the Supabase SQL Editor whenever the security schema or policies need to be refreshed.

## Goals

- Keep the schema simple.
- Use the existing `public.profile` table for app users.
- Use the existing `public.saved_reports` table for Insights Studio reports.
- Avoid extra permission tables for now.
- Allow report sharing by storing shared emails directly on `saved_reports`.
- Keep transportation sensor data scoped by institute.
- Allow authenticated users to access only the data they should see.

## Core Tables

### `public.profile`

Stores app-level user profile data.

Important columns:

- `id`: matches `auth.users.id`
- `email`: user email
- `full_name`: display name
- `role`: usually `user`, `admin`, or `platform_admin`
- `assigned_institute`: institute the user belongs to

Profiles are created/backfilled from Supabase Auth users by the SQL script.

### `public.saved_reports`

Stores Insights Studio reports.

Security columns added by the SQL script:

- `owner_id`: report owner, references `auth.users.id`
- `assigned_institute`: institute scope for the report
- `shared_with_emails`: text array of users who can open the report
- `shared_access`: JSON object mapping emails to access roles
- `updated_at`: last updated timestamp

Example `shared_access`:

```json
{
  "person@institution.edu": "editor",
  "viewer@institution.edu": "viewer"
}
```

## Report Access Rules

### Owner

The owner can:

- Open the report
- Edit the report
- Share the report
- Change collaborator access
- Remove collaborators
- Delete the report

### Editor

An editor can:

- Open the report
- Save edits to the report

An editor cannot:

- Delete the report
- Change sharing/access settings
- Become the report owner by saving edits

### Viewer

A viewer can:

- Open/read the report

A viewer cannot:

- Save edits
- Delete the report
- Change sharing/access settings
- Use builder tools, sidebars, drag handles, page controls, or text editing controls in the UI

### Admin

Users with `role in ('admin', 'platform_admin')` can read/update scoped reports according to the policies.

## Sharing Flow

The frontend validates that shared users:

- Exist in `public.profile`
- Belong to the same `assigned_institute`
- Are not the current user

Then it calls:

```sql
public.update_saved_report_access(
  p_report_id uuid,
  p_shared_with_emails text[],
  p_shared_access jsonb,
  p_layout_data jsonb
)
```

This RPC updates:

- `shared_with_emails`
- `shared_access`
- `layout_data`
- `updated_at`

The RPC is `security definer`, so it can safely update access after checking that the caller owns the report or is an admin.

## Legacy Report Ownership

Older reports may have `owner_id = null`.

To avoid breaking those reports, the SQL uses:

```sql
public.current_user_owns_saved_report(owner_id, layout_data, author)
```

This treats a report as owned by the current user when:

- `owner_id = auth.uid()`, or
- `owner_id is null` and `author` matches the current user email, or
- `owner_id is null`, `layout_data.reportSettings.lastSavedBy` matches the current user email, and the current user is not listed as a shared collaborator

When the owner updates access, the RPC repairs the report by setting `owner_id`.

## Transportation Sensor Data Rules

The SQL enables RLS on:

- `public.institutes`
- `public.sensors`
- `public.ten_minute_summaries`

Authenticated users can read:

- Their assigned institute
- Sensors in their assigned institute
- Traffic summary rows tied to sensors in their assigned institute

Platform/admin users can read across institutes.

Service-role ingestion still bypasses RLS, so backend data ingestion can continue.

## Important Functions

### `public.current_assigned_institute()`

Returns the current user's `assigned_institute`.

### `public.current_profile_is_admin()`

Returns true if the current user is an admin/platform admin.

### `public.current_user_email()`

Returns the current authenticated email from the JWT or `auth.email()`.

### `public.email_is_shared(shared_emails text[])`

Returns true if the current user's email appears in `shared_with_emails`.

### `public.shared_email_can_edit(shared_emails text[], shared_access jsonb)`

Returns true if the current user is shared on the report and has `editor` access.

### `public.update_saved_report_access(...)`

Updates report sharing after verifying owner/admin permission.

## Applying The SQL

Run:

```text
docs/supabase-simple-security.sql
```

in the Supabase SQL Editor.

If an old trigger causes errors, run:

```text
docs/supabase-emergency-fix-old-trigger.sql
```

then rerun:

```text
docs/supabase-simple-security.sql
```

## Common Issues

### “Access could not be updated. Make sure you own this report.”

Usually means Supabase has not received the latest SQL with `update_saved_report_access`.

Fix:

1. Rerun `docs/supabase-simple-security.sql`.
2. Refresh the app.
3. Try changing/removing access again.

### Report shows under “Shared with you” even though I made it

Usually means the report is old and has `owner_id = null`.

Fix:

1. Rerun `docs/supabase-simple-security.sql`.
2. Open the report as the original creator.
3. Save or update access once to repair `owner_id`.

### A user cannot be shared with

Check that:

- The email exists in `public.profile`
- The user's `assigned_institute` matches yours
- The user is not sharing with their own email
