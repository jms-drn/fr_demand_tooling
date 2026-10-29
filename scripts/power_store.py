"""Fetching and storing the nuclear and hydro data (raw, as published by RTE).

Raw storage (times in UTC, minute precision):

  data/nuclear/notices/YYYY/YYYY-MM.csv  every version of every nuclear
      unavailability notice, split by publication month (UTC). One row per
      version; "intervals" holds the notice's capacity steps as
      start/end/available/unavailable separated by ";".
  data/nuclear/output/YYYY/YYYY-MM.csv   hourly fleet nuclear output (MW),
      split by Paris-time month.
  data/nuclear/unit_output.json          hourly output per reactor, last 8 days
  data/hydro/reserves.csv                weekly stored energy in reservoirs (MWh)
  data/power_state.json                  when each feed was last fetched

Derived files for the website are built by power_summarise.py.
"""

import csv
import json
import time
from datetime import datetime, timedelta, timezone

from store import DATA_DIR, PARIS, fmt_utc, parse_ts

UTC = timezone.utc
NUCLEAR_DIR = DATA_DIR / "nuclear"
NOTICES_DIR = NUCLEAR_DIR / "notices"
OUTPUT_DIR = NUCLEAR_DIR / "output"
UNIT_OUTPUT_FILE = NUCLEAR_DIR / "unit_output.json"
HYDRO_DIR = DATA_DIR / "hydro"
RESERVES_FILE = HYDRO_DIR / "reserves.csv"
STATE_FILE = DATA_DIR / "power_state.json"

NOTICE_FIELDS = [
    "identifier", "version", "publication_utc", "unit_eic", "unit_name",
    "installed_mw", "type", "reason", "status", "start_utc", "end_utc",
    "intervals", "remarks",
]

UNAVAILABILITY_RESOURCE = "generation_unavailabilities"
# RTE asks for no more than 20 calls an hour to this service.
UNAVAILABILITY_MIN_GAP_SECONDS = 180


def utc_param(value):
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def paris_param(value):
    return value.astimezone(PARIS).isoformat(timespec="seconds")


# --------------------------------------------------------------------------
# State
# --------------------------------------------------------------------------

def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}


def save_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=1, sort_keys=True) + "\n")


# --------------------------------------------------------------------------
# Unavailability notices
# --------------------------------------------------------------------------

def notice_row(item):
    def m(text):
        return fmt_utc(parse_ts(text)) if text else ""

    steps = []
    for v in item.get("values") or []:
        steps.append(
            f"{m(v.get('start_date'))}/{m(v.get('end_date'))}/"
            f"{v.get('available_capacity', '')}/{v.get('unavailable_capacity', '')}"
        )

    remarks = (item.get("remarks") or "").replace("\r", "").strip()

    return {
        "identifier": item["identifier"],
        "version": int(item["version"]),
        "publication_utc": m(item.get("publication_date")),
        "unit_eic": item.get("affected_asset_or_unit_eic_code", ""),
        "unit_name": (item.get("affected_asset_or_unit_name") or "").strip(),
        "installed_mw": item.get("affected_asset_or_unit_installed_capacity", ""),
        "type": item.get("unavailability_type", ""),
        "reason": item.get("reason", ""),
        "status": item.get("event_status", ""),
        "start_utc": m(item.get("start_date")),
        "end_utc": m(item.get("end_date")),
        "intervals": ";".join(steps),
        "remarks": remarks,
    }


def fetch_notices(client, start, end, fuel="NUCLEAR", last_wait=None):
    """All notice versions published in [start, end). Follows continuation tokens."""
    params = {
        "fuel_type": fuel,
        "date_type": "PUBLICATION_DATE",
        "start_date": utc_param(start),
        "end_date": utc_param(end),
    }
    status, headers, payload = client.request(UNAVAILABILITY_RESOURCE, params)
    items = list((payload or {}).get(UNAVAILABILITY_RESOURCE) or [])
    total = headers.get("total_match")
    pages = 1

    while status == 206 and headers.get("continuation_token"):
        status, headers, payload = client.request(
            UNAVAILABILITY_RESOURCE, headers={"continuation_token": headers["continuation_token"]}
        )
        items.extend((payload or {}).get(UNAVAILABILITY_RESOURCE) or [])
        pages += 1

    if total and total.isdigit() and int(total) != len(items):
        print(f"  warning: total_match {total} but received {len(items)}")

    print(f"  notices published {start:%Y-%m-%d %H:%M} to {end:%Y-%m-%d %H:%M}: "
          f"{len(items)} versions in {pages} call(s)")
    return [notice_row(item) for item in items], pages


def notice_path(publication_utc):
    return NOTICES_DIR / publication_utc[:4] / f"{publication_utc[:7]}.csv"


def read_csv(path):
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def write_csv(path, fields, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    tmp.replace(path)


def upsert_notices(rows):
    by_file = {}
    for row in rows:
        if not row["publication_utc"]:
            continue
        by_file.setdefault(notice_path(row["publication_utc"]), []).append(row)

    changed = 0
    for path, new_rows in by_file.items():
        existing = {(r["identifier"], int(r["version"])): r for r in read_csv(path)}
        for row in new_rows:
            key = (row["identifier"], int(row["version"]))
            clean = {k: str(row[k]) for k in NOTICE_FIELDS}
            if existing.get(key) != clean:
                existing[key] = clean
                changed += 1
        ordered = sorted(existing.values(), key=lambda r: (r["publication_utc"], r["identifier"], int(r["version"])))
        write_csv(path, NOTICE_FIELDS, ordered)
    return changed


def iter_notices():
    for path in sorted(NOTICES_DIR.glob("*/*.csv")):
        yield from read_csv(path)


def latest_publication():
    files = sorted(NOTICES_DIR.glob("*/*.csv"))
    for path in reversed(files):
        rows = read_csv(path)
        if rows:
            return parse_ts(max(r["publication_utc"] for r in rows))
    return None


# --------------------------------------------------------------------------
# Nuclear output (fleet, hourly) and per-reactor output
# --------------------------------------------------------------------------

def output_path(start_utc):
    paris = parse_ts(start_utc).astimezone(PARIS)
    return OUTPUT_DIR / f"{paris:%Y}" / f"{paris:%Y-%m}.csv"


def fetch_fleet_output(client, start, end):
    payload = client.get(
        "actual_generations_per_production_type",
        {"start_date": paris_param(start), "end_date": paris_param(end)},
    )
    rows = []
    for block in (payload or {}).get("actual_generations_per_production_type") or []:
        if block.get("production_type") != "NUCLEAR":
            continue
        for v in block.get("values") or []:
            if v.get("value") is None:
                continue
            rows.append({"start_utc": fmt_utc(parse_ts(v["start_date"])), "mw": int(v["value"])})
    return rows


def upsert_output(rows):
    by_file = {}
    for row in rows:
        by_file.setdefault(output_path(row["start_utc"]), []).append(row)
    changed = 0
    for path, new_rows in by_file.items():
        existing = {r["start_utc"]: r["mw"] for r in read_csv(path)}
        for row in new_rows:
            if existing.get(row["start_utc"]) != str(row["mw"]):
                existing[row["start_utc"]] = str(row["mw"])
                changed += 1
        write_csv(path, ["start_utc", "mw"], [{"start_utc": k, "mw": existing[k]} for k in sorted(existing)])
    return changed


def fetch_unit_output(client, start, end):
    """Hourly output per nuclear reactor, keyed by EIC code."""
    payload = client.get(
        "actual_generations_per_unit",
        {"start_date": paris_param(start), "end_date": paris_param(end)},
    )
    units = {}
    for block in (payload or {}).get("actual_generations_per_unit") or []:
        unit = block.get("unit") or {}
        if unit.get("production_type") != "NUCLEAR":
            continue
        entry = units.setdefault(unit["eic_code"], {"name": unit.get("name", ""), "values": {}})
        for v in block.get("values") or []:
            if v.get("value") is not None:
                entry["values"][fmt_utc(parse_ts(v["start_date"]))] = int(v["value"])
    return units


def merge_unit_output(units, keep_days=8):
    stored = json.loads(UNIT_OUTPUT_FILE.read_text()) if UNIT_OUTPUT_FILE.exists() else {"units": {}}
    cutoff = fmt_utc(datetime.now(UTC) - timedelta(days=keep_days))
    for eic, entry in units.items():
        target = stored["units"].setdefault(eic, {"name": entry["name"], "values": {}})
        target["name"] = entry["name"]
        target["values"].update(entry["values"])
    for target in stored["units"].values():
        target["values"] = {k: v for k, v in sorted(target["values"].items()) if k >= cutoff}
    stored["updated_utc"] = fmt_utc(datetime.now(UTC))
    UNIT_OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    UNIT_OUTPUT_FILE.write_text(json.dumps(stored, separators=(",", ":"), sort_keys=True))
    return len(units)


# --------------------------------------------------------------------------
# Hydro reservoirs (weekly)
# --------------------------------------------------------------------------

RESERVE_FIELDS = ["week_start", "week_end", "mwh", "updated_utc"]


def fetch_reserves(client, start, end):
    payload = client.get(
        "water_reserves", {"start_date": paris_param(start), "end_date": paris_param(end)}
    )
    block = (payload or {}).get("water_reserves") or {}
    if isinstance(block, list):  # the guide shows a list; the API returns an object
        values = [v for b in block for v in b.get("values") or []]
    else:
        values = block.get("values") or []
    rows = []
    for v in values:
        if v.get("value") is None:
            continue
        rows.append({
            "week_start": parse_ts(v["start_date"]).astimezone(PARIS).date().isoformat(),
            "week_end": parse_ts(v["end_date"]).astimezone(PARIS).date().isoformat(),
            "mwh": str(int(v["value"])),
            "updated_utc": fmt_utc(parse_ts(v["updated_date"])) if v.get("updated_date") else "",
        })
    return rows


def upsert_reserves(rows):
    existing = {r["week_start"]: r for r in read_csv(RESERVES_FILE)}
    changed = 0
    for row in rows:
        if existing.get(row["week_start"]) != row:
            existing[row["week_start"]] = row
            changed += 1
    write_csv(RESERVES_FILE, RESERVE_FIELDS, [existing[k] for k in sorted(existing)])
    return changed


def last_monday(today=None):
    today = today or datetime.now(PARIS).date()
    return today - timedelta(days=today.weekday() or 7)


def paris_midnight_dt(day):
    return datetime(day.year, day.month, day.day, tzinfo=PARIS)


def polite_sleep(last_call, gap):
    if last_call:
        wait = gap - (time.time() - last_call)
        if wait > 0:
            time.sleep(wait)
    return time.time()

