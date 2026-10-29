"""Build the small summary files the dashboard loads first.

  data/summary/daily.csv            one row per Paris calendar day
  data/summary/weekly_errors.csv    one row per week-ahead forecast vintage and target day
  data/summary/error_profile.csv    errors by month and hour of day / weekday
  data/status.json                  coverage, file index and last-update times

Conventions:
  * Forecast error = forecast minus actual (positive = RTE over-forecast).
  * All forecasts are compared at 30-minute resolution: actuals and D-1 are
    averaged from their two quarter-hours (D-1 is natively half-hourly for
    most of its history); D-2 and week-ahead forecasts are half-hourly.
  * Peak error compares the forecast day's maximum with the actual day's
    maximum at the same resolution, only when at least 90% of the day's
    intervals have both a forecast and an actual.
"""

import csv
import json
from collections import defaultdict
from datetime import date, datetime, timezone

from store import (
    ARCHIVE_DIR,
    DATA_DIR,
    PARIS,
    _read_csv,
    _write_csv,
    expected_intervals,
    fmt_utc,
    parse_ts,
    plausible,
)

QUARTER = 900
HALF_HOUR = 1800
MIN_COVERAGE = 0.9


def _epoch(text):
    return int(parse_ts(text).timestamp())


def _paris_day(epoch):
    return datetime.fromtimestamp(epoch, PARIS).date()


def _paris_hhmm(epoch):
    return datetime.fromtimestamp(epoch, PARIS).strftime("%H:%M")


def _utc_text(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y-%m-%dT%H:%MZ")


def _series_files(series):
    root = ARCHIVE_DIR / series
    if not root.exists():
        return []
    return sorted(root.glob("*/*.csv"))


def load_realised():
    values = {}
    for path in _series_files("realised"):
        for row in _read_csv(path):
            if plausible(int(row[1])):
                values[_epoch(row[0])] = int(row[1])
    return values


def load_forecast(series):
    values = {}
    for path in _series_files(series):
        for row in _read_csv(path):
            if not plausible(int(row[1])):
                continue
            updated = _epoch(row[2]) if len(row) > 2 and row[2] else None
            values[_epoch(row[0])] = (int(row[1]), updated)
    return values


def half_hourly_forecast(points):
    """Average a 15-minute forecast into half-hours.

    RTE's D-1 is natively half-hourly for most of its history (the :15/:45
    values are interpolated or repeated), so its accuracy is measured at
    30 minutes, like D-2 and the week-ahead forecast.
    """
    result = {}
    for start, (mw, updated) in points.items():
        if start % HALF_HOUR == 0 and start + QUARTER in points:
            mw2, updated2 = points[start + QUARTER]
            stamps = [u for u in (updated, updated2) if u is not None]
            result[start] = ((mw + mw2) / 2, max(stamps) if stamps else None)
    return result


def half_hourly(realised):
    """Average pairs of quarter-hours into half-hours (both must exist)."""
    result = {}
    for start, mw in realised.items():
        if start % HALF_HOUR == 0 and start + QUARTER in realised:
            result[start] = (mw + realised[start + QUARTER]) / 2
    return result


def _round(value, digits=0):
    if value is None:
        return ""
    rounded = round(value, digits)
    return int(rounded) if digits == 0 else rounded


def forecast_day_stats(forecast_points, actual, expected):
    """Error statistics for one day of one forecast series.

    forecast_points: {start_epoch: (mw, updated_epoch)}
    actual: {start_epoch: mw} at the same resolution
    """
    if not forecast_points:
        return None

    pairs = [
        (start, fc[0], actual[start], fc[1])
        for start, fc in forecast_points.items()
        if start in actual
    ]
    forecast_values = [fc[0] for fc in forecast_points.values()]
    updates = [fc[1] for fc in forecast_points.values() if fc[1] is not None]

    stats = {
        "mean_mw": sum(forecast_values) / len(forecast_values),
        "peak_mw": max(forecast_values),
        "pairs": len(pairs),
        "mae_mw": None,
        "bias_mw": None,
        "mape_pct": None,
        "peak_error_mw": None,
        "ex_ante_pct": None,
        "last_update_utc": _utc_text(max(updates)) if updates else "",
    }

    if pairs:
        errors = [fc - act for _, fc, act, _ in pairs]
        stats["mae_mw"] = sum(abs(e) for e in errors) / len(errors)
        stats["bias_mw"] = sum(errors) / len(errors)
        stats["mape_pct"] = 100 * sum(
            abs(fc - act) / act for _, fc, act, _ in pairs if act
        ) / len(pairs)
        dated = [p for p in pairs if p[3] is not None]
        if dated:
            stats["ex_ante_pct"] = 100 * sum(1 for p in dated if p[3] < p[0]) / len(dated)

        if len(pairs) >= MIN_COVERAGE * expected:
            stats["peak_error_mw"] = max(fc for _, fc, _, _ in pairs) - max(
                act for _, _, act, _ in pairs
            )

    return stats


DAILY_HEADER = [
    "date",
    "intervals",
    "expected_intervals",
    "mean_mw",
    "min_mw",
    "max_mw",
    "peak_time_paris",
    "min_time_paris",
    "energy_gwh",
]

for _prefix in ("d1", "d2"):
    DAILY_HEADER += [
        f"{_prefix}_mean_mw",
        f"{_prefix}_peak_mw",
        f"{_prefix}_pairs",
        f"{_prefix}_mae_mw",
        f"{_prefix}_bias_mw",
        f"{_prefix}_mape_pct",
        f"{_prefix}_peak_error_mw",
        f"{_prefix}_ex_ante_pct",
        f"{_prefix}_last_update_utc",
    ]


def build_daily(realised, realised_30, d1, d2):
    by_day = defaultdict(dict)
    for start, mw in realised.items():
        by_day[_paris_day(start)][start] = mw

    d1_by_day = defaultdict(dict)
    for start, value in d1.items():
        d1_by_day[_paris_day(start)][start] = value

    d2_by_day = defaultdict(dict)
    for start, value in d2.items():
        d2_by_day[_paris_day(start)][start] = value

    days = sorted(set(by_day) | set(d1_by_day) | set(d2_by_day))
    rows = []

    for day in days:
        actual = by_day.get(day, {})
        row = {"date": day.isoformat()}
        row["expected_intervals"] = expected_intervals(day, 15)
        row["intervals"] = len(actual)

        if actual:
            peak_start = max(actual, key=lambda s: (actual[s], -s))
            min_start = min(actual, key=lambda s: (actual[s], s))
            row["mean_mw"] = _round(sum(actual.values()) / len(actual))
            row["min_mw"] = actual[min_start]
            row["max_mw"] = actual[peak_start]
            row["peak_time_paris"] = _paris_hhmm(peak_start)
            row["min_time_paris"] = _paris_hhmm(min_start)
            # Energy = average MW x hours in the Paris day (23/24/25) / 1000.
            # Using the average means one missing quarter-hour (RTE's 2025
            # data lacks 23:45 on many days) doesn't understate the total.
            # Left blank when under 90% of the day's intervals are present.
            if len(actual) >= MIN_COVERAGE * row["expected_intervals"]:
                hours = row["expected_intervals"] * 0.25
                row["energy_gwh"] = _round(sum(actual.values()) / len(actual) * hours / 1000, 3)

        for prefix, points, comparison, minutes in (
            ("d1", d1_by_day.get(day, {}), realised_30, 30),
            ("d2", d2_by_day.get(day, {}), realised_30, 30),
        ):
            stats = forecast_day_stats(points, comparison, expected_intervals(day, minutes))
            if stats:
                row[f"{prefix}_mean_mw"] = _round(stats["mean_mw"])
                row[f"{prefix}_peak_mw"] = _round(stats["peak_mw"])
                row[f"{prefix}_pairs"] = stats["pairs"]
                row[f"{prefix}_mae_mw"] = _round(stats["mae_mw"])
                row[f"{prefix}_bias_mw"] = _round(stats["bias_mw"])
                row[f"{prefix}_mape_pct"] = _round(stats["mape_pct"], 2)
                row[f"{prefix}_peak_error_mw"] = _round(stats["peak_error_mw"])
                row[f"{prefix}_ex_ante_pct"] = _round(stats["ex_ante_pct"], 1)
                row[f"{prefix}_last_update_utc"] = stats["last_update_utc"]

        rows.append([row.get(column, "") for column in DAILY_HEADER])

    _write_csv(DATA_DIR / "summary" / "daily.csv", DAILY_HEADER, rows)
    return len(rows)


WEEKLY_HEADER = [
    "target_date",
    "updated_utc",
    "lead_days",
    "pairs",
    "mae_mw",
    "bias_mw",
    "mape_pct",
    "forecast_peak_mw",
    "actual_peak_mw",
    "peak_error_mw",
    "ref_temp_c",
    "temp_dev_c",
]


def build_weekly_errors(realised_30):
    vintages = defaultdict(dict)

    for path in _series_files("weekly"):
        for row in _read_csv(path):
            updated = _epoch(row[0])
            start = _epoch(row[1])
            if not plausible(int(row[2])):
                continue
            vintages[(_paris_day(start), updated)][start] = (int(row[2]), updated)

    peaks = {}
    for row in _read_csv(ARCHIVE_DIR / "weekly_peaks.csv"):
        peaks[(row[0], row[1])] = (row[4], row[5])

    actual_peak_by_day = {}
    for start, mw in realised_30.items():
        day = _paris_day(start)
        if mw > actual_peak_by_day.get(day, float("-inf")):
            actual_peak_by_day[day] = mw

    rows = []
    for (target, updated), points in sorted(vintages.items()):
        expected = expected_intervals(target, 30)
        stats = forecast_day_stats(points, realised_30, expected)
        actual_peak = actual_peak_by_day.get(target)

        updated_text = _utc_text(updated)
        temp, temp_dev = peaks.get((target.isoformat(), updated_text), ("", ""))

        rows.append(
            [
                target.isoformat(),
                updated_text,
                (target - _paris_day(updated)).days,
                stats["pairs"],
                _round(stats["mae_mw"]),
                _round(stats["bias_mw"]),
                _round(stats["mape_pct"], 2),
                _round(stats["peak_mw"]),
                _round(actual_peak),
                _round(stats["peak_error_mw"]),
                temp,
                temp_dev,
            ]
        )

    _write_csv(DATA_DIR / "summary" / "weekly_errors.csv", WEEKLY_HEADER, rows)
    return len(rows), vintages


PROFILE_HEADER = [
    "forecast",
    "month",
    "dimension",
    "key",
    "n",
    "sum_abs_err_mw",
    "sum_err_mw",
    "sum_actual_mw",
    "sum_abs_pct_err",
]


def build_error_profile(realised_30, d1_30, d2, weekly_vintages):
    """Half-hourly forecast errors aggregated by month and hour of day /
    weekday, so the dashboard can build heatmaps for any period.

    forecast: d1, d2, or w3..w9 (week-ahead at that lead in days; where a
    lead has several versions for one target day, the latest is used).
    key: Paris hour 0-23, or weekday 0 (Monday) to 6.
    """
    sums = defaultdict(lambda: [0, 0.0, 0.0, 0.0, 0.0])

    def add(forecast, start, fc_mw):
        actual = realised_30.get(start)
        if actual is None:
            return
        local = datetime.fromtimestamp(start, PARIS)
        month = local.strftime("%Y-%m")
        err = fc_mw - actual
        for dimension, key in (("hour", local.hour), ("weekday", local.weekday())):
            acc = sums[(forecast, month, dimension, key)]
            acc[0] += 1
            acc[1] += abs(err)
            acc[2] += err
            acc[3] += actual
            acc[4] += abs(err) / actual * 100

    for start, (mw, _) in d1_30.items():
        add("d1", start, mw)
    for start, (mw, _) in d2.items():
        add("d2", start, mw)

    latest_by_lead = {}
    for (target, updated), points in weekly_vintages.items():
        lead = (target - _paris_day(updated)).days
        if 3 <= lead <= 9:
            key = (target, lead)
            if key not in latest_by_lead or updated > latest_by_lead[key][0]:
                latest_by_lead[key] = (updated, points)

    for (target, lead), (_, points) in latest_by_lead.items():
        for start, (mw, _) in points.items():
            add(f"w{lead}", start, mw)

    rows = []
    for (forecast, month, dimension, key), acc in sorted(sums.items()):
        rows.append([
            forecast, month, dimension, key, acc[0],
            round(acc[1]), round(acc[2]), round(acc[3]), round(acc[4], 2),
        ])

    _write_csv(DATA_DIR / "summary" / "error_profile.csv", PROFILE_HEADER, rows)
    return len(rows)


def build_status(extra=None):
    status = {
        "generated_utc": fmt_utc(datetime.now(timezone.utc)),
        "series": {},
    }

    previous_path = DATA_DIR / "status.json"
    if previous_path.exists():
        try:
            previous = json.loads(previous_path.read_text(encoding="utf-8"))
            for key in ("last_live_update_utc", "last_backfill_utc", "last_errors", "power"):
                if key in previous:
                    status[key] = previous[key]
        except (json.JSONDecodeError, OSError):
            pass

    for series in ("realised", "d1", "d2", "weekly"):
        files = _series_files(series)
        months = [path.stem for path in files]
        entry = {"months": months}

        if files:
            first_rows = _read_csv(files[0])
            last_rows = _read_csv(files[-1])
            column = 1 if series == "weekly" else 0
            if first_rows:
                entry["first_utc"] = min(row[column] for row in first_rows)
            if last_rows:
                entry["last_utc"] = max(row[column] for row in last_rows)

        status["series"][series] = entry

    if extra:
        status.update(extra)

    (DATA_DIR / "status.json").write_text(
        json.dumps(status, indent=1) + "\n", encoding="utf-8"
    )
    return status


def main(extra_status=None):
    realised = load_realised()
    realised_30 = half_hourly(realised)
    d1_30 = half_hourly_forecast(load_forecast("d1"))
    d2 = load_forecast("d2")

    days = build_daily(realised, realised_30, d1_30, d2)
    weekly, vintages = build_weekly_errors(realised_30)
    profile = build_error_profile(realised_30, d1_30, d2, vintages)
    build_status(extra_status)

    print(f"Summaries rebuilt: {days} days, {weekly} week-ahead vintages, {profile} error-profile rows.")


if __name__ == "__main__":
    main()
