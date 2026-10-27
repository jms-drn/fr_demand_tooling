# fr_demand_tooling

**France Power Demand Intelligence**: a web tool for French power demand, covering live data, comparisons with equivalent past periods, the accuracy of RTE's demand forecasts and the outlook.

## The site

| Tab | What it shows |
|---|---|
| **Today** | Actual demand against RTE's intraday, D-1 and D-2 forecasts, with optional same-weekday references from earlier years |
| **Explorer** | Any period from Dec 2012 at 15-minute to monthly resolution; average, peak, minimum or energy; comparisons with last year, the average of the previous N years and their min–max range (each toggled), aligned by calendar date or weekday; public holidays marked or excluded; average daily profile view |
| **Forecast accuracy** | D-1, D-2 and week-ahead (3–9 days) error over time, by lead time, by weekday, by hour and season, and the biggest misses |
| **Outlook** | The next 10 days (D-1, D-2, latest week-ahead), week-ahead peaks with RTE's temperature assumptions, and RTE's annual forecast and supply margin against actual demand |

On every chart: hover for values, drag across the chart to zoom, double-click to reset; the legend shows each series' average for the period in view and hides or shows series; PNG and CSV export the chart and the data in view. The address bar stores the settings, so links can be shared.

The site is static (GitHub Pages) and reads the CSV files below. Code: `index.html`, `style.css`, `js/` (ECharts 5.6 is included in `js/vendor/`).

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
| `data/summary/error_profile.csv` | Forecast errors summed by month and hour of day / weekday, for D-1, D-2 and week-ahead leads 3–9 |
| `data/status.json` | Coverage, list of monthly files, last update times and any errors |

## Methodology notes

- **Forecast error = forecast − actual.** Positive means RTE over-forecast demand.
- **Which forecast version is kept.** RTE can republish forecasts. For D-1 and D-2 the archive keeps the latest version published *before* the interval it forecasts; a version published afterwards never replaces it. `updated_utc` records when the stored version was published, and the daily summary's `*_ex_ante_pct` column shows the share of a day's values published in advance. All week-ahead versions are kept, so accuracy can be measured by lead time.
- **Resolution.** All forecasts are compared at 30 minutes, against the average of the two matching 15-minute actuals. D-2 and week-ahead forecasts are published half-hourly; D-1 is published at 15 minutes but is natively half-hourly for most of its history (quarter-hour values are interpolated in 2012–22 and repeated in 2024), so its two quarter-hours are averaged.
- **Values below 15 GW** are treated as data errors and not stored (RTE's D-1 history for 2–14 Oct 2019 contains ~0.7 GW values).
- **Daily energy** is average demand × hours in the Paris day, so a missing quarter-hour (RTE's 2025 data lacks 23:45 on many days, and October clock-change days lack the repeated hour) doesn't understate it.
- **Annual forecast.** RTE's weekly average forecast is only populated for 2015–16; later years have the weekly min/max and the margin.
- **Peak error** is the forecast day's maximum minus the actual day's maximum, calculated only when at least 90% of the day's intervals have both values.
- **Clock-change days** have 92 (March) or 100 (October) quarter-hours. Daily rows show `intervals` against `expected_intervals` so incomplete days are visible.
- **Actuals** are overwritten when RTE revises them; the hourly run re-checks the last 7 days.
- The undocumented `CORRECTED` block sometimes returned by the API is ignored.

Data updates run every 30 minutes; GitHub can delay or skip scheduled runs, and each run re-checks the past 7 days.
