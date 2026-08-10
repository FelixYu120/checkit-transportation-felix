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

## Transportation Metrics

These metrics are calculated inside the active dashboard filter window: selected dates, selected time range, weekday/weekend preset, and current chart view. A "period" means one chart bucket in the current view, usually a ten-minute summary row before it is grouped into hourly, daily, weekly, or monthly chart buckets.

| Metric | What It Represents | Math |
| --- | --- | --- |
| Flow / Volume | Total movement through the lane or corridor. | `sum(volume)` across sampled periods. When approach and away are both present, total flow is `approach_volume + away_volume`. |
| Recent Movement | Most recent movement count in the active window. | `volume` from the latest sampled chart point or latest filtered summary row. |
| Peak | Highest movement point in the active window. | `max(volume)` across chart points. In weekly/monthly summary cards, the busiest day/month bucket is the peak bucket. |
| Busiest Time | Time bucket with the highest movement in a 24 hr/custom view. | Group samples by hour or visible chart bucket, compute movement per bucket, choose the bucket with the highest `volume`. |
| Busiest Day | Day with the highest movement in a weekly/monthly view. | Group samples by day, compute total or average visible movement per day depending on the chart bucket, choose the highest day. |
| Average Speed | Volume-weighted traffic speed. | `sum(avg_speed * volume) / sum(volume)`. If there is no movement volume, the value is `0` or hidden as no data depending on the chart. |
| 85th Speed | Approximate 85th percentile speed carried by the summary table. | The firmware/pipeline provides `v85_speed` per period. Dashboard rollups use `sum(v85_speed * volume) / sum(volume)`. |
| Max Speed | Highest speed observed in the active window. | `max(max_speed)` across sampled periods. |
| Over Threshold Count | Number of sampled periods where speed exceeded the configured max speed cap threshold. | `count(period where max_speed > max_speed_cap_threshold)`. If the sensor has no threshold configured, the card shows `-`. |
| Low/No Movement Periods | Number of sampled periods with little or no traffic. | `count(period where volume <= 0)`. |
| Approach Share | Percent of directional traffic moving in the approach direction. | `approach_volume / (approach_volume + away_volume) * 100`. |
| Away Share | Percent of directional traffic moving away from the approach direction. | `away_volume / (approach_volume + away_volume) * 100`, or `100 - approach_share` when both directions are present. |
| Direction Split | How total movement divides between approach and away. | Approach and away are summed separately from directional summary rows, then shown as bars or shares. |

Future scale TODOs:

- Move CSV generation server-side when exports regularly exceed 50,000 rows or the browser feels slow.
- Use a Supabase Edge Function or RPC for large exports so the backend can paginate through `ten_minute_summaries`.
- Stream or chunk large CSV files instead of loading every row into browser memory.
- Add an export status/loading job if CSV generation takes more than a few seconds.
- Keep dashboard queries on summary/current-state tables and reserve raw detail exports for explicit downloads.
- Add retention/archive rules before raw transportation history grows beyond the period needed for operations.
