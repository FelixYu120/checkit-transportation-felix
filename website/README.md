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
| 85th Speed | Legacy approximation carried by the current summary table. | The firmware/pipeline provides `v85_speed` per period. Current dashboard rollups use `sum(v85_speed * volume) / sum(volume)`, which is **not** a true merged percentile. V2 must replace long-window values with a percentile derived from merged `traffic_daily.speed_histogram` bins. |
| Max Speed | Highest speed observed in the active window. | `max(max_speed)` across sampled periods. |
| Over Threshold Count | Number of sampled periods where speed exceeded the configured max speed cap threshold. | `count(period where max_speed > max_speed_cap_threshold)`. If the sensor has no threshold configured, the card shows `-`. |
| Low/No Movement Periods | Number of sampled periods with little or no traffic. | `count(period where volume <= 0)`. |
| Approach Share | Percent of directional traffic moving in the approach direction. | `approach_volume / (approach_volume + away_volume) * 100`. |
| Away Share | Percent of directional traffic moving away from the approach direction. | `away_volume / (approach_volume + away_volume) * 100`, or `100 - approach_share` when both directions are present. |
| Direction Split | How total movement divides between approach and away. | Approach and away are summed separately from directional summary rows, then shown as bars or shares. |
| Traffic Change | Change between the first and latest sampled movement value in a comparison/report window. | `latest_volume - earliest_volume`. Positive values are shown as increases. |
| Group Average | Average movement across selected comparison targets. | For each target, calculate `avg(volume)` across its filtered rows. Then average those target averages. |
| Top Volume Corridor / Lane | Highest-volume target in a comparison set. | Sort selected targets by `sum(volume)` and choose the largest. |
| Top Average Corridor / Lane | Highest-average target in a comparison set. | Sort selected targets by `avg(volume)` and choose the largest. |
| Traffic Spread | Difference between the highest and lowest selected comparison target. | `highest_avg_volume - lowest_avg_volume` for the selected comparison set. |
| Approach | Directional movement toward the configured approach direction. | `sum(approach_volume)` or count rows whose direction is `approach`, depending on source shape. |
| Away | Directional movement away from the configured approach direction. | `sum(away_volume)` or count rows whose direction is `away`, depending on source shape. |
| Sensor Status: Active | Transportation sensor is reporting recent data/health. | Derived from `last_seen_at`, `updated_at`, or latest traffic summary freshness. |
| Sensor Status: Down | Sensor is known but has stopped reporting recently. | Derived from stale health/summary timestamps. The UI can show when it went down when that timestamp is available. |
| Sensor Status: Offline | Sensor has no usable recent health signal. | Derived from missing or stale status/health information. |
| Needs Review | Field/deployment flag for sensors that require follow-up. | Boolean setup metadata. It does not change traffic calculations. |

### Transportation Chart Views

| View | What It Shows | Data Source |
| --- | --- | --- |
| 24 hr | Recent movement, speed, and direction over the current 24-hour view. | Traffic summary rows from Supabase, usually ten-minute summaries grouped for display. |
| Weekly | Daily traffic pattern across a seven-day window. | Traffic summary rows grouped by local day. |
| Monthly | Calendar-style traffic pattern. Multi-month ranges can drill into a selected month. | Traffic summary rows grouped by local day/month. |
| Flow | Movement volume. | `volume`, plus `approach_volume` and `away_volume` when directional data exists. |
| Speed | Average, 85th percentile, and max speed. | `avg_speed`, `v85_speed`, and `max_speed` from summary rows. |
| Direction | Approach versus away movement. | Directional row fields or direction-specific summary fields. |

### Transportation Field Metadata

| Field | What It Represents | Used In Math Today |
| --- | --- | --- |
| Sensor ID / Unique Identifier | Human-entered identifier for the lane sensor record. | Used to find and organize the sensor. |
| Hardware Serial | Physical sensor serial once available. | Used for hardware identity/field verification, not traffic math. |
| Institute | Organization/campus that owns the sensor. | Used for access and navigation scope. |
| Area | Campus area where the sensor belongs. | Used for filtering, tree navigation, and comparison scope. |
| Lane / Corridor | Named traffic location being monitored. | Used as the primary display entity and comparison target. |
| Latitude / Longitude | Sensor or lane coordinates. | Used for map placement. |
| Speed Limit Threshold | Normal speed limit/reference threshold in mph. | Stored for context and future threshold logic. |
| Max Speed Cap Threshold | Maximum allowed/review threshold in mph. | Used by `Over Threshold Count`: `max_speed > max_speed_cap_threshold`. |
| Danger Speed / Emergency Speed | Higher severity speed thresholds when configured. | Stored as context unless a chart/report explicitly uses them. |
| Heading | Direction/orientation of the sensor or lane. | Used as context for interpreting approach/away direction. |
| WiFi SSID | Network configured in the field app. | Deployment/debug context only. |
| Installation Notes | Technician notes from setup. | Human context only. |

### Metric Interpretation Notes

- **Flow** answers "how much movement happened?"
- **Average Speed** answers "how fast was movement typically going, weighted by volume?"
- **Max Speed** answers "what was the highest observed speed?"
- **Over Threshold Count** answers "how often did speed exceed the configured cap?"
- **Low/No Movement Periods** answers "how many buckets had no observed traffic?"
- **Approach/Away** only make sense after the sensor orientation/heading is understood.

Future scale TODOs:

- Move CSV generation server-side when exports regularly exceed 50,000 rows or the browser feels slow.
- Use a Supabase Edge Function or RPC for large exports so the backend can paginate through `ten_minute_summaries`.
- Stream or chunk large CSV files instead of loading every row into browser memory.
- Add an export status/loading job if CSV generation takes more than a few seconds.
- Keep dashboard queries on summary/current-state tables and reserve raw detail exports for explicit downloads.
- Add retention/archive rules before raw transportation history grows beyond the period needed for operations.
