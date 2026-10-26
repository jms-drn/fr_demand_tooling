"""Parsing RTE responses and storing them in the monthly CSV archive.

Archive layout (all times stored in UTC, files split by Paris-time month):

  data/archive/realised/YYYY/YYYY-MM.csv   start_utc,mw
  data/archive/d1/YYYY/YYYY-MM.csv         start_utc,mw,updated_utc
  data/archive/d2/YYYY/YYYY-MM.csv         start_utc,mw,updated_utc
  data/archive/weekly/YYYY/YYYY-MM.csv     updated_utc,start_utc,mw
  data/archive/weekly_peaks.csv            target_date,updated_utc,peak_utc,peak_mw,ref_temp_c,temp_dev_c
  data/archive/annual_forecasts.csv        one row per forecast week

Each interval's "start_utc" is the start of a 15-minute (realised, D-1)
or 30-minute (D-2, weekly) interval. Values are average power in MW.
"""

import csv
import os
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

PARIS = ZoneInfo("Europe/Paris")
UTC = timezone.utc

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
ARCHIVE_DIR = DATA_DIR / "archive"

# RTE type name -> archive series. The guide calls actuals "ACTUAL" in one
# table but the API returns "REALISED"; both are accepted.
SHORT_TERM_SERIES = {
    "REALISED": "realised",
    "ACTUAL": "realised",
    "D-1": "d1",
    "D-2": "d2",
}

FORECAST_SERIES = {"d1", "d2"}

# Values below this are treated as data errors and not stored. Mainland
# French demand in the 2012-2026 archive never falls below ~28 GW; RTE's D-1
# history for 2-14 Oct 2019 contains values of ~0.6-0.8 GW.
MIN_PLAUSIBLE_MW = 15000


def plausible(mw):
    return mw >= MIN_PLAUSIBLE_MW


# --------------------------------------------------------------------------
# Time helpers
# --------------------------------------------------------------------------

def parse_ts(text):
    """Parse an RTE timestamp (or a stored UTC one) into an aware datetime."""
    if text is None or text == "":
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    value = datetime.fromisoformat(text)
    if value.tzinfo is None:
        raise ValueError(f"Timestamp without time zone: {text}")
    return value.astimezone(UTC)


def to_minute(value):
    """Stored timestamps keep minute precision, so compare at that precision."""
    return value.replace(second=0, microsecond=0) if value else value


def fmt_utc(value):
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%MZ")


def paris_date(value):
    return value.astimezone(PARIS).date()


def paris_midnight(day):
    """Aware datetime for 00:00 Paris time on the given date."""
    return datetime(day.year, day.month, day.day, tzinfo=PARIS)


def paris_today():
    return datetime.now(PARIS).date()


def rte_param(value):
    """Format a datetime the way the API expects: 2015-06-01T00:00:00+02:00."""
    return value.astimezone(PARIS).isoformat(timespec="seconds")


def month_key(value):
    local = value.astimezone(PARIS)
    return local.year, local.month


def month_path(series, year, month):
    return ARCHIVE_DIR / series / f"{year:04d}" / f"{year:04d}-{month:02d}.csv"


def expected_intervals(day, minutes):
    """Number of intervals in a Paris calendar day (92/96/100 for 15 min)."""
    # Subtract in UTC: Python subtracts same-zone datetimes on wall-clock time.
    start = paris_midnight(day).astimezone(UTC)
    end = paris_midnight(day + timedelta(days=1)).astimezone(UTC)
    return int((end - start).total_seconds() // (minutes * 60))


# --------------------------------------------------------------------------
# Parsing API responses
# --------------------------------------------------------------------------

def parse_short_term(payload):
    """Return {series: [(start, mw, updated)]} from a short_term response.

    Unknown types (for example the undocumented "CORRECTED" block) are
    skipped and reported.
    """
    records = defaultdict(list)
    skipped = set()

    for block in (payload or {}).get("short_term", []):
        series = SHORT_TERM_SERIES.get(block.get("type"))

        if series is None:
            # The intraday (ID) forecast is only used live, from latest.json.
            if block.get("type") != "ID":
                skipped.add(block.get("type"))
            continue

        for item in block.get("values") or []:
            value = item.get("value")
            if value is None:
                continue
            mw = int(round(float(value)))
            if not plausible(mw):
                continue
            records[series].append(
                (
                    parse_ts(item["start_date"]),
                    mw,
                    to_minute(parse_ts(item.get("updated_date"))),
                )
            )

    return dict(records), skipped


def parse_weekly(payload):
    """Return (values, peaks) from a weekly_forecasts response.

    values: [(updated, start, mw)]
    peaks:  [(target_date, updated, peak_time, peak_mw, temp, temp_dev)]
    """
    values = []
    peaks = []

    for block in (payload or {}).get("weekly_forecasts", []):
        updated = to_minute(parse_ts(block.get("updated_date")))
        block_start = parse_ts(block.get("start_date"))

        if updated is None or block_start is None:
            continue

        target = paris_date(block_start)

        for item in block.get("values") or []:
            value = item.get("value")
            if value is None:
                continue
            mw = int(round(float(value)))
            if plausible(mw):
                values.append((updated, parse_ts(item["start_date"]), mw))

        peak = block.get("peak") or {}
        if peak.get("value") is not None:
            peaks.append(
                (
                    target,
                    updated,
                    parse_ts(peak.get("peak_hour")),
                    int(round(float(peak["value"]))),
                    peak.get("temperature"),
                    peak.get("temperature_deviation"),
                )
            )

    return values, peaks


def parse_annual(payload):
    rows = []

    for block in (payload or {}).get("annual_forecasts", []):
        for item in block.get("values") or []:
            rows.append(
                {
                    "week_start_utc": fmt_utc(parse_ts(item["start_date"])),
                    "week_end_utc": fmt_utc(parse_ts(item["end_date"])),
                    "avg_sat_to_fri_mw": item.get("average_load_saturday_to_friday"),
                    "avg_mon_to_sun_8_20_mw": item.get("average_load_monday_to_sunday"),
                    "weekly_min_mw": item.get("weekly_minimum"),
                    "weekly_max_mw": item.get("weekly_maximum"),
                    "load_updated_utc": _fmt_optional(item.get("average_load_updated_date")),
                    "margin_mw": item.get("forecast_margin"),
                    "margin_updated_utc": _fmt_optional(item.get("margin_updated_date")),
                }
            )

    return rows


def _fmt_optional(text):
    parsed = parse_ts(text) if text else None
    return fmt_utc(parsed) if parsed else ""


# --------------------------------------------------------------------------
# Writing the archive
# --------------------------------------------------------------------------

def _write_csv(path, header, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(header)
        writer.writerows(rows)
    os.replace(tmp, path)


def _read_csv(path):
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as handle:
        reader = csv.reader(handle)
        next(reader, None)
        return [row for row in reader if row]


def _forecast_should_replace(start, old, new):
    """Decide whether a newly fetched forecast value replaces a stored one.

    Aim: keep the latest version published BEFORE the interval it forecasts,
    so accuracy is measured against what was known in advance. A version
    published after the interval started never replaces an earlier one.
    """
    if old is None:
        return True

    old_mw, old_updated = old
    new_mw, new_updated = new

    if new_updated is None:
        return False
    if old_updated is None:
        return True

    old_ex_ante = old_updated < start
    new_ex_ante = new_updated < start

    if old_ex_ante and not new_ex_ante:
        return False
    if new_ex_ante and not old_ex_ante:
        return True
    if new_updated == old_updated:
        return new_mw != old_mw
    return new_updated > old_updated


def upsert_series(series, records):
    """Merge [(start, mw, updated)] into the monthly files. Returns rows changed."""
    by_month = defaultdict(list)
    for record in records:
        by_month[month_key(record[0])].append(record)

    is_forecast = series in FORECAST_SERIES
    header = ["start_utc", "mw", "updated_utc"] if is_forecast else ["start_utc", "mw"]
    changed_total = 0

    for (year, month), month_records in sorted(by_month.items()):
        path = month_path(series, year, month)
        stored = {}

        for row in _read_csv(path):
            start = parse_ts(row[0])
            updated = parse_ts(row[2]) if is_forecast and len(row) > 2 else None
            stored[start] = (int(row[1]), updated)

        changed = 0

        for start, mw, updated in month_records:
            old = stored.get(start)

            if is_forecast:
                if _forecast_should_replace(start, old, (mw, updated)):
                    if old != (mw, updated):
                        stored[start] = (mw, updated)
                        changed += 1
            else:
                # Actuals: RTE may consolidate figures later; latest wins.
                if old is None or old[0] != mw:
                    stored[start] = (mw, None)
                    changed += 1

        if changed:
            rows = []
            for start in sorted(stored):
                mw, updated = stored[start]
                if is_forecast:
                    rows.append([fmt_utc(start), mw, fmt_utc(updated) if updated else ""])
                else:
                    rows.append([fmt_utc(start), mw])
            _write_csv(path, header, rows)
            changed_total += changed

    return changed_total


def upsert_weekly(values, peaks):
    """Store every published vintage of the week-ahead forecast."""
    changed_total = 0
    by_month = defaultdict(list)

    for updated, start, mw in values:
        by_month[month_key(start)].append((updated, start, mw))

    for (year, month), month_values in sorted(by_month.items()):
        path = month_path("weekly", year, month)
        stored = {}

        for row in _read_csv(path):
            stored[(parse_ts(row[0]), parse_ts(row[1]))] = int(row[2])

        changed = 0
        for updated, start, mw in month_values:
            if stored.get((updated, start)) != mw:
                stored[(updated, start)] = mw
                changed += 1

        if changed:
            rows = [
                [fmt_utc(updated), fmt_utc(start), stored[(updated, start)]]
                for updated, start in sorted(stored, key=lambda key: (key[1], key[0]))
            ]
            _write_csv(path, ["updated_utc", "start_utc", "mw"], rows)
            changed_total += changed

    if peaks:
        path = ARCHIVE_DIR / "weekly_peaks.csv"
        stored = {}
        for row in _read_csv(path):
            stored[(row[0], row[1])] = row

        changed = 0
        for target, updated, peak_time, peak_mw, temp, temp_dev in peaks:
            key = (target.isoformat(), fmt_utc(updated))
            row = [
                key[0],
                key[1],
                fmt_utc(peak_time) if peak_time else "",
                str(peak_mw),
                "" if temp is None else str(temp),
                "" if temp_dev is None else str(temp_dev),
            ]
            if stored.get(key) != row:
                stored[key] = row
                changed += 1

        if changed:
            _write_csv(
                path,
                ["target_date", "updated_utc", "peak_utc", "peak_mw", "ref_temp_c", "temp_dev_c"],
                [stored[key] for key in sorted(stored)],
            )
            changed_total += changed

    return changed_total


ANNUAL_HEADER = [
    "week_start_utc",
    "week_end_utc",
    "avg_sat_to_fri_mw",
    "avg_mon_to_sun_8_20_mw",
    "weekly_min_mw",
    "weekly_max_mw",
    "load_updated_utc",
    "margin_mw",
    "margin_updated_utc",
]


def upsert_annual(rows):
    path = ARCHIVE_DIR / "annual_forecasts.csv"
    stored = {}

    for row in _read_csv(path):
        stored[row[0]] = row

    changed = 0
    for row in rows:
        new = ["" if row[key] is None else str(row[key]) for key in ANNUAL_HEADER]
        old = stored.get(new[0])
        # Keep the most recently updated forecast for each week.
        if old is None or (new[6] >= old[6] and new != old):
            stored[new[0]] = new
            changed += 1

    if changed:
        _write_csv(path, ANNUAL_HEADER, [stored[key] for key in sorted(stored)])

    return changed


def date_chunks(start_day, end_day, max_days):
    """Split [start_day, end_day) into consecutive chunks of at most max_days."""
    chunks = []
    current = start_day
    while current < end_day:
        chunk_end = min(current + timedelta(days=max_days), end_day)
        chunks.append((current, chunk_end))
        current = chunk_end
    return chunks


def parse_day(text):
    return date.fromisoformat(text)
