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
```

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
