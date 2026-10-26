# fr_demand_tooling

Web tool for viewing French power demand: historic trends, comparisons with equivalent past periods, and the accuracy of RTE's demand forecasts.

Data source: RTE consumption API (user guide v2.2). Figures cover mainland France, include grid losses and exclude pumping consumption at hydropower plants. Values are average power over each interval, in MW.

## How the data is collected

| Workflow | When | What it does |
|---|---|---|
| **Update RTE data (hourly)** | Every hour at :17 UTC, or by hand | Fetches the latest actuals and forecasts, re-checks the past 7 days, fetches week-ahead and annual forecasts, rebuilds the summaries |
| **Backfill RTE history (one-off)** | By hand only | Fetches history in chunks (from 17 Dec 2012 for actuals/D-1/D-2). Safe to re-run |

Both run on GitHub Actions using the `RTE_CLIENT_ID` and `RTE_CLIENT_SECRET` repository secrets. They never run at the same time.

To run the backfill: **Actions** tab → **Backfill RTE history (one-off)** → **Run workflow**.

## Data files

All times are stored in UTC (`2026-10-23T22:00Z`). Files are split by month in Paris time.

| Path | Contents |
|---|---|
| `data/latest.json` | Raw latest RTE response (used by the "today" view) |
| `data/archive/realised/YYYY/YYYY-MM.csv` | Actual demand, 15-minute: `start_utc,mw` |
| `data/archive/d1/YYYY/YYYY-MM.csv` | Day-ahead forecast, 15-minute: `start_utc,mw,updated_utc` |
| `data/archive/d2/YYYY/YYYY-MM.csv` | Two-day-ahead forecast, 30-minute: `start_utc,mw,updated_utc` |
| `data/archive/weekly/YYYY/YYYY-MM.csv` | Every published week-ahead forecast (D+3 to D+9), 30-minute: `updated_utc,start_utc,mw` |
| `data/archive/weekly_peaks.csv` | Week-ahead forecast peaks with RTE's reference temperature and deviation |
| `data/archive/annual_forecasts.csv` | RTE's annual forecast by week, with the forecast supply margin |
| `data/summary/daily.csv` | One row per Paris day: actual mean/min/max/energy and D-1/D-2 forecast errors |
| `data/summary/weekly_errors.csv` | One row per week-ahead forecast vintage and target day, with lead time and errors |
| `data/status.json` | Coverage, list of monthly files, last update times and any errors |

## Methodology notes

- **Forecast error = forecast − actual.** Positive means RTE over-forecast demand.
- **Which forecast version is kept.** RTE can republish forecasts. For D-1 and D-2 the archive keeps the latest version published *before* the interval it forecasts; a version published afterwards never replaces it. `updated_utc` records when the stored version was published, and the daily summary's `*_ex_ante_pct` column shows the share of a day's values published in advance. All week-ahead versions are kept, so accuracy can be measured by lead time.
- **Resolution.** D-1 is compared with 15-minute actuals. D-2 and week-ahead forecasts are half-hourly, so they are compared with the average of the two matching 15-minute actuals.
- **Peak error** is the forecast day's maximum minus the actual day's maximum, calculated only when at least 90% of the day's intervals have both values.
- **Clock-change days** have 92 (March) or 100 (October) quarter-hours. Daily rows show `intervals` against `expected_intervals` so incomplete days are visible.
- **Actuals** are overwritten when RTE revises them; the hourly run re-checks the last 7 days.
- The undocumented `CORRECTED` block sometimes returned by the API is ignored.
