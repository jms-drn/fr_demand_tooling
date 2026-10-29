"""One-off download of the nuclear and hydro history.

  notices   every nuclear unavailability notice version since Dec 2010,
            fetched by publication date in yearly windows (split further if
            RTE refuses a window), at most 20 calls an hour as RTE asks.
  output    hourly fleet nuclear output since 15 Dec 2014 (150-day calls)
  reserves  weekly hydro reservoir levels since Dec 2014 (one call a year)
  units     hourly output per reactor for the past 7 days

Run by .github/workflows/backfill-power.yml. Safe to re-run: rows are merged.
"""

import argparse
import time
from datetime import date, datetime, timedelta, timezone

from power_store import (
    UNAVAILABILITY_MIN_GAP_SECONDS,
    fetch_fleet_output,
    fetch_notices,
    fetch_reserves,
    fetch_unit_output,
    last_monday,
    load_state,
    merge_unit_output,
    paris_midnight_dt,
    save_state,
    upsert_notices,
    upsert_output,
    upsert_reserves,
)
from rte_client import RteApiError, RteClient
from store import PARIS, fmt_utc

UTC = timezone.utc


def backfill_notices(start_day):
    client = RteClient(api="unavailability", pause_seconds=1)
    now = datetime.now(UTC)
    windows = []
    year_start = datetime(start_day.year, start_day.month, start_day.day, tzinfo=UTC)
    while year_start < now:
        nxt = datetime(year_start.year + 1, 1, 1, tzinfo=UTC)
        windows.append((year_start, min(nxt, now)))
        year_start = nxt
    windows.reverse()  # newest first

    last_call = None
    total = 0
    while windows:
        start, end = windows.pop(0)
        if last_call:
            wait = UNAVAILABILITY_MIN_GAP_SECONDS - (time.time() - last_call)
            if wait > 0:
                time.sleep(wait)
        last_call = time.time()
        try:
            rows, _ = fetch_notices(client, start, end)
        except RteApiError as error:
            if end - start <= timedelta(days=8):
                raise
            mid = start + (end - start) / 2
            mid = mid.replace(minute=0, second=0, microsecond=0)
            print(f"  {error}; splitting the window at {mid:%Y-%m-%d}")
            windows[:0] = [(mid, end), (start, mid)]
            continue
        total += upsert_notices(rows)
    state = load_state()
    state["notices_fetched_to_utc"] = fmt_utc(now)
    save_state(state)
    print(f"Notices: {total} rows added or changed")


def backfill_output(start_day):
    client = RteClient(api="generation", pause_seconds=2)
    end_day = datetime.now(PARIS).date() + timedelta(days=1)
    day = start_day
    total = 0
    while day < end_day:
        nxt = min(day + timedelta(days=150), end_day)
        rows = fetch_fleet_output(client, paris_midnight_dt(day), paris_midnight_dt(nxt))
        total += upsert_output(rows)
        print(f"  output {day} to {nxt}: {len(rows)} hours")
        day = nxt
    state = load_state()
    state["output_fetched_utc"] = fmt_utc(datetime.now(UTC))
    save_state(state)
    print(f"Output: {total} hours added or changed")


def backfill_reserves():
    client = RteClient(api="generation", pause_seconds=2)
    end_day = last_monday()
    day = date(2014, 12, 1)
    total = 0
    while day < end_day:
        nxt = min(day + timedelta(days=364), end_day)
        rows = fetch_reserves(client, paris_midnight_dt(day), paris_midnight_dt(nxt))
        total += upsert_reserves(rows)
        print(f"  reserves {day} to {nxt}: {len(rows)} weeks")
        day = nxt
    state = load_state()
    state["reserves_fetched_utc"] = fmt_utc(datetime.now(UTC))
    save_state(state)
    print(f"Reserves: {total} weeks added or changed")


def backfill_units():
    client = RteClient(api="generation", pause_seconds=2)
    today = datetime.now(PARIS).date()
    units = fetch_unit_output(client, paris_midnight_dt(today - timedelta(days=6)),
                              paris_midnight_dt(today + timedelta(days=1)))
    print(f"Per-reactor output: {merge_unit_output(units)} reactors")
    state = load_state()
    state["units_fetched_utc"] = fmt_utc(datetime.now(UTC))
    save_state(state)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--datasets", default="units,reserves,output,notices")
    parser.add_argument("--notice-start", default="2010-12-01")
    parser.add_argument("--output-start", default="2014-12-15")
    args = parser.parse_args()
    wanted = [d.strip() for d in args.datasets.split(",") if d.strip()]

    failures = []
    for name in wanted:
        print(f"== {name}")
        try:
            if name == "notices":
                backfill_notices(date.fromisoformat(args.notice_start))
            elif name == "output":
                backfill_output(date.fromisoformat(args.output_start))
            elif name == "reserves":
                backfill_reserves()
            elif name == "units":
                backfill_units()
            else:
                print(f"Unknown dataset {name}")
        except Exception as error:  # keep the other datasets going
            import traceback
            traceback.print_exc()
            failures.append(f"{name}: {error}")

    if failures:
        print("FAILED:", failures)
        if len(failures) == len(wanted):
            raise SystemExit(1)


if __name__ == "__main__":
    main()
