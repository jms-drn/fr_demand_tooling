"""Regular nuclear and hydro update, called from update.py on every run.

  * Nuclear notices: everything published since the newest stored notice
    (one call, every run; RTE asks for at most 20 calls an hour).
  * Fleet and per-reactor nuclear output: at most once every 55 minutes
    (RTE publishes these hourly and asks for one call an hour).
  * Hydro reservoirs: at most every 12 hours (weekly data).
Then the website's nuclear files are rebuilt.
"""

import traceback
from datetime import datetime, timedelta, timezone

import power_summarise
from power_store import (
    fetch_fleet_output,
    fetch_notices,
    fetch_reserves,
    fetch_unit_output,
    last_monday,
    latest_publication,
    load_state,
    merge_unit_output,
    paris_midnight_dt,
    save_state,
    upsert_notices,
    upsert_output,
    upsert_reserves,
)
from rte_client import RteClient
from store import PARIS, fmt_utc, parse_ts

UTC = timezone.utc


def due(state, key, minutes):
    last = state.get(key)
    return not last or datetime.now(UTC) - parse_ts(last) >= timedelta(minutes=minutes)


def run():
    state = load_state()
    errors = []
    now = datetime.now(UTC)
    today = now.astimezone(PARIS).date()

    try:
        client = RteClient(api="unavailability", pause_seconds=1)
        newest = latest_publication()
        start = (newest - timedelta(hours=2)) if newest else now - timedelta(days=3)
        rows, _ = fetch_notices(client, start, now - timedelta(minutes=1))  # RTE rejects end dates in the future
        print(f"Nuclear notices: {upsert_notices(rows)} rows added or changed")
        state["notices_fetched_to_utc"] = fmt_utc(now)
    except Exception as error:
        traceback.print_exc()
        errors.append(f"notices: {error}")

    gen = None
    if due(state, "output_fetched_utc", 55) or due(state, "units_fetched_utc", 55):
        try:
            gen = RteClient(api="generation", pause_seconds=1.5)
            rows = fetch_fleet_output(gen, paris_midnight_dt(today - timedelta(days=3)),
                                      paris_midnight_dt(today + timedelta(days=1)))
            print(f"Nuclear output: {upsert_output(rows)} hours added or changed")
            state["output_fetched_utc"] = fmt_utc(now)
        except Exception as error:
            traceback.print_exc()
            errors.append(f"output: {error}")
        try:
            gen = gen or RteClient(api="generation", pause_seconds=1.5)
            units = fetch_unit_output(gen, paris_midnight_dt(today - timedelta(days=1)),
                                      paris_midnight_dt(today + timedelta(days=1)))
            print(f"Per-reactor output: {merge_unit_output(units)} reactors")
            state["units_fetched_utc"] = fmt_utc(now)
        except Exception as error:
            traceback.print_exc()
            errors.append(f"reactor output: {error}")

    if due(state, "reserves_fetched_utc", 12 * 60):
        try:
            gen = gen or RteClient(api="generation", pause_seconds=1.5)
            end = last_monday()
            rows = fetch_reserves(gen, paris_midnight_dt(end - timedelta(days=63)), paris_midnight_dt(end))
            print(f"Hydro reserves: {upsert_reserves(rows)} weeks added or changed")
            state["reserves_fetched_utc"] = fmt_utc(now)
        except Exception as error:
            traceback.print_exc()
            errors.append(f"reserves: {error}")

    save_state(state)

    try:
        power_summarise.main()
    except Exception as error:
        traceback.print_exc()
        errors.append(f"nuclear summaries: {error}")

    return {"updated_utc": fmt_utc(now), "errors": errors}
