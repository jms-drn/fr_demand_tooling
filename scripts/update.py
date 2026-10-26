"""Hourly live update, run by .github/workflows/update-rte.yml.

Each run:
  1. Fetches the latest short-term data (actuals, intraday, D-1, D-2) and
     saves the raw response to data/latest.json for the "today" view.
  2. Re-fetches the past 7 days of actuals and D-1/D-2 forecasts, which
     picks up RTE's later consolidation of actuals and fills any gap left
     by a missed run.
  3. Fetches the latest week-ahead (D+3 to D+9) and annual forecasts.
  4. Merges everything into the archive and rebuilds the summaries.
"""

import json
import sys
import traceback
from datetime import datetime, timedelta, timezone

import summarise
from rte_client import RteClient
from store import (
    DATA_DIR,
    fmt_utc,
    paris_midnight,
    paris_today,
    parse_annual,
    parse_short_term,
    parse_weekly,
    rte_param,
    upsert_annual,
    upsert_series,
    upsert_weekly,
)

LOOKBACK_DAYS = 7


def store_short_term(payload, label):
    records, skipped = parse_short_term(payload)
    changed = {series: upsert_series(series, rows) for series, rows in records.items()}
    print(f"{label}: changed rows {changed}" + (f", skipped types {sorted(skipped)}" if skipped else ""))


def step_latest(client):
    payload = client.get("short_term")
    if not payload or "short_term" not in payload:
        raise RuntimeError("Latest short_term response was empty.")

    (DATA_DIR / "latest.json").write_text(
        json.dumps(payload, separators=(",", ":")), encoding="utf-8"
    )
    store_short_term(payload, "Latest")


def step_recent(client):
    today = paris_today()
    payload = client.get(
        "short_term",
        {
            "type": "REALISED,D-1,D-2",
            "start_date": rte_param(paris_midnight(today - timedelta(days=LOOKBACK_DAYS))),
            "end_date": rte_param(paris_midnight(today)),
        },
    )
    store_short_term(payload, f"Past {LOOKBACK_DAYS} days")


def step_weekly(client):
    values, peaks = parse_weekly(client.get("weekly_forecasts"))
    print(f"Week-ahead: changed rows {upsert_weekly(values, peaks)}")


def step_annual(client):
    rows = parse_annual(client.get("annual_forecasts"))
    print(f"Annual: changed rows {upsert_annual(rows)}")


def main():
    client = RteClient()
    errors = []

    for name, step in (
        ("latest", step_latest),
        ("recent", step_recent),
        ("weekly", step_weekly),
        ("annual", step_annual),
    ):
        try:
            step(client)
        except Exception as error:  # keep going so one failure doesn't block the rest
            traceback.print_exc()
            errors.append(f"{name}: {error}")

    summarise.main(
        {
            "last_live_update_utc": fmt_utc(datetime.now(timezone.utc)),
            "last_errors": errors,
        }
    )

    print(f"RTE calls made: {client.call_count}")

    if len(errors) == 4:
        sys.exit("Every RTE request failed.")


if __name__ == "__main__":
    main()
