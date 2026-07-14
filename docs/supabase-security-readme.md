# Supabase Security

This is the simple security guide for the CheckIt Transportation Supabase project.

This is documentation only. There is no SQL script to run from this repo right now.

If Supabase changes are needed later, create a clear one-time migration for that specific change instead of keeping general-purpose SQL scripts around.

## Core Rule

Transportation data is scoped by institute.

The main access boundary is:

```text
profile.assigned_institute = sensors.institute_id
```

## Protected Tables

Authenticated users can access only data for their institute:

- `sensors`
- `ten_minute_summaries`
- `saved_reports`
- `profile`

Service-role ingestion can still write sensor data because Supabase service-role requests bypass RLS.

## Reports

Saved reports use owner/editor/viewer access.

- Owner: can edit, share, remove access, and delete.
- Editor: can edit, but cannot delete or manage sharing.
- Viewer: can view only.

Sharing only works with platform users from the same institute.

## Institutes And Emails

Use:

- `institutes` for institute records
- `institute_email_domains` for trusted institute email domains

Example:

- `ucsd.edu` -> `ucsd`
- `health.ucsd.edu` -> `ucsd`

Avoid mapping broad personal domains like `gmail.com`. For a developer/admin using a personal email, manually assign that one profile:

```sql
update public.profile
set assigned_institute = 'ucsd'
where lower(email) = 'person@gmail.com';
```

## Quick Checks

If a user cannot see data:

1. Check `profile.assigned_institute`.
2. Check `sensors.institute_id`.
3. Check that summary rows reference sensors in the same institute.
4. For reports, check `owner_id`, `shared_with_emails`, and `shared_access`.

## Avoid

- Do not make transportation summaries public unless that is intentional.
- Do not map personal email domains globally.
- Do not let collaborators delete reports they do not own.
- Do not keep general-purpose or competing security SQL files around.
