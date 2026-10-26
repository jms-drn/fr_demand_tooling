"""One-off historical backfill, run by .github/workflows/backfill.yml.

Limits from RTE's consumption API user guide (v2.2):
  * short_term: data from 17/12/2012, at most 186 days and at least
    1 day per call.
  * weekly_forecasts: data from 23/12/2004, at most 155 days per call.
  * annual_forecasts: data from 01/01/2015, between 1 and 6 years per call.

Chunks are kept below those maximums. The script is safe to re-run: data
already stored is merged, not duplicated.

Usage:
  python scripts/backfill.py --start 2012-12-17 --datasets short_term,weekly,annual
"""

import argparse
from datetime import date, datetime, timedelta, timezone

import summarise
from rte_client import RteClient
from store import (
    date_chunks,
    fmt_utc,
    paris_midnight,
    paris_today,
    parse_annual,
    parse_day,
    parse_short_term,
    parse_weekly,
    rte_param,
    upsert_annual,
    upsert_series,
    upsert_weekly,
)

SHORT_TERM_FIRST = date(2012, 12, 17)
WEEKLY_FIRST = date(2004, 12, 23)
ANNUAL_FIRST = date(2015, 1, 1)

SHORT_TERM_CHUNK = 180
WEEKLY_CHUNK = 150


def backfill_short_term(client, start, end):
    chunks = date_chunks(max(start, SHORT_TERM_FIRST), end, SHORT_TERM_CHUNK)
    print(f"short_term: {len(chunks)} requests")

    for index, (chunk_start, chunk_end) in enumerate(chunks, 1):
        payload = client.get(
            "short_term",
            {
                "type": "REALISED,D-1,D-2",
                "start_date": rte_param(paris_midnight(chunk_start)),
                "end_date": rte_param(paris_midnight(chunk_end)),
            },
        )
        records, skipped = parse_short_term(payload)
        changed = {series: upsert_series(series, rows) for series, rows in records.items()}
        counts = {series: len(rows) for series, rows in records.items()}
        print(f"  [{index}/{len(chunks)}] {chunk_start} to {chunk_end}: received {counts}, changed {changed}"
              + (f", skipped {sorted(skipped)}" if skipped else ""))


def backfill_weekly(client, start, end):
    chunks = date_chunks(max(start, WEEKLY_FIRST), end, WEEKLY_CHUNK)
    print(f"weekly_forecasts: {len(chunks)} requests")

    for index, (chunk_start, chunk_end) in enumerate(chunks, 1):
        payload = client.get(
            "weekly_forecasts",
            {
                "start_date": rte_param(paris_midnight(chunk_start)),
                "end_date": rte_param(paris_midnight(chunk_end)),
            },
        )
        values, peaks = parse_weekly(payload)
        changed = upsert_weekly(values, peaks)
        print(f"  [{index}/{len(chunks)}] {chunk_start} to {chunk_end}: "
              f"{len(values)} values, {len(peaks)} peaks, changed {changed}")


def backfill_annual(client, start, end):
    first_year = max(start, ANNUAL_FIRST).year
    last_year = end.year

    year = first_year
    while year <= last_year:
        # 5 calendar years per call, inside RTE's 6-year maximum. The guide
        # says end_date is excluded, so it is set to 1 January of the next year.
        to_year = min(year + 4, last_year)
        payload = client.get(
            "annual_forecasts",
            {
                "start_date": rte_param(paris_midnight(date(year, 1, 1))),
                "end_date": rte_param(paris_midnight(date(to_year + 1, 1, 1))),
            },
        )
        rows = parse_annual(payload)
        print(f"annual_forecasts {year}-{to_year}: {len(rows)} weeks, changed {upsert_annual(rows)}")
        year = to_year + 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", default=SHORT_TERM_FIRST.isoformat(), help="first day, YYYY-MM-DD")
    parser.add_argument("--end", default="", help="end day (exclusive), default today in Paris")
    parser.add_argument("--datasets", default="short_term,weekly,annual")
    args = parser.parse_args()

    start = parse_day(args.start)
    end = parse_day(args.end) if args.end else paris_today()
    datasets = {item.strip() for item in args.datasets.split(",") if item.strip()}

    client = RteClient()

    if "short_term" in datasets:
        backfill_short_term(client, start, end)
    if "weekly" in datasets:
        backfill_weekly(client, start, end)
    if "annual" in datasets:
        backfill_annual(client, start, end)

    summarise.main({"last_backfill_utc": fmt_utc(datetime.now(timezone.utc))})
    print(f"RTE calls made: {client.call_count}")


if __name__ == "__main__":
    main()
