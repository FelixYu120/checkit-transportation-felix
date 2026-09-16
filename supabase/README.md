# Supabase migrations

These SQL files are additive and have not been applied to any database:

- `migrations/add_historical_archives.sql`
- `migrations/add_traffic_daily.sql`

The checkout had no prior migration history or declarative `supabase/schemas/` source of truth. Before production application, import/reconcile the authoritative history and create timestamped migration files with the installed Supabase CLI (`supabase migration new ...`) if your deployment workflow requires timestamp names. The CLI was not installed in this environment, so no filename timestamp was fabricated.

Apply only after review, preferably first to a local/staging database. Both tables enable RLS and revoke `anon`/`authenticated` table grants. No public policy is invented. A future API migration can grant narrowly scoped `SELECT` access and add matching RLS policies once the real authorization model is known.

Neither migration changes `traffic_passages`, deletes rows, or installs retention automation.
