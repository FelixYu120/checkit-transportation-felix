# CheckIt Website

This is the React + Vite frontend for CheckIt. It includes the public corridor availability map and the admin dashboard for browsing institutes, areas, corridors, charts, and sensor status.

## Setup

```bash
npm install
npm run dev
```

Lint:

```bash
npm run lint
```

Build:

```bash
NODE_OPTIONS=--max-old-space-size=4096 npm run build
```

The larger Node heap helps with production builds because the ArcGIS packages are large.

## Environment

Create `.env.local` in this folder:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_SENSOR_DIRECTORY_SOURCE=supabase
```

Use `VITE_SENSOR_DIRECTORY_SOURCE=supabase` for real local data. Setting it to
`local` forces the app to use the small built-in fallback dataset, which is only
useful for offline UI work.

## Main Areas

- `src/App.jsx` controls routes and switches between the public and admin headers.
- `src/components/Header/` contains the public and admin top nav bars.
- `src/components/maps/` contains the public and admin map views.
- `src/components/pages/Dashboard.jsx` shows public corridor availability.
- `src/components/admin/` contains the admin sidebar, breadcrumbs, corridor view, and charts.
- `src/components/helper/SupabaseClients.js` creates the Supabase browser client.

## Admin Routing

Admin pages use this route structure:

```text
/dashboard/college/:collegeId
/dashboard/institute/:collegeId
/dashboard/institute/:collegeId/corridors/:floorId
```

Breadcrumbs are handled by `src/components/admin/layout/AdminBreadcrumb.jsx`. The breadcrumb links let users move back from a corridor to its institute context.

## CSV Exports

Admin transportation exports are generated in the browser from the same filtered rows used by the current corridor dashboard. The export should respect:

- selected institute, area, or corridor
- start and end dates
- start and end times
- weekday/weekend filter

Current user-facing corridor columns:

- `scope_type`
- `institute`
- `area`
- `corridor`
- `observed_at_utc`
- `direction`
- `volume`
- `avg_speed_mph`
- `v85_speed_mph`
- `max_speed_mph`

Future scale TODOs:

- Move CSV generation server-side when exports regularly exceed 50,000 rows or the browser feels slow.
- Use a Supabase Edge Function or RPC for large exports so the backend can paginate through `ten_minute_summaries`.
- Stream or chunk large CSV files instead of loading every row into browser memory.
- Add an export status/loading job if CSV generation takes more than a few seconds.
- Keep dashboard queries on summary/current-state tables and reserve raw detail exports for explicit downloads.
- Add retention/archive rules before raw transportation history grows beyond the period needed for operations.
