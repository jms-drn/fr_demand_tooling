"""Builds the nuclear files the website reads, from the raw notices and output.

How availability is worked out
  * Each notice (identifier) can have many versions; a version replaces the
    previous one. "As known at time P" uses, for each identifier, the latest
    version published at or before P. Cancelled (DISMISSED) versions count
    as "no outage".
  * A reactor's unavailable capacity at a moment is the largest unavailable
    capacity among the notices covering it (overlapping notices are not
    added together). Available = installed capacity minus that.
  * Fessenheim 1 and 2 leave the fleet when they closed in 2020 and
    Flamanville 3 joins it at its first grid connection (21 Dec 2024).
  * Times are rounded to 15 minutes.

Files written (times UTC unless said otherwise)
  data/nuclear/fleet.json                 reactor list: site, series, MW, location
  data/nuclear/hourly/YYYY/YYYY-MM.csv    fleet hourly: installed, available,
                                          planned and unplanned off, output
  data/nuclear/unit_daily/YYYY.csv        daily mean available MW per reactor
  data/summary/nuclear_daily.csv          daily fleet summary (Paris days)
  data/nuclear/outlook/YYYY/YYYY-MM.csv   for each day P: expected daily mean
                                          availability for P+1 .. P+540 as known
                                          at the end of P (Paris)
  data/nuclear/outages/YYYY.csv           one row per notice (latest version),
                                          by the year the outage starts
  data/nuclear/live.json                  live status per reactor, recent notice
                                          changes, next 14 days hourly and the
                                          current 540-day outlook
"""

import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from power_store import (  # noqa: E402
    NUCLEAR_DIR,
    OUTPUT_DIR,
    UNIT_OUTPUT_FILE,
    iter_notices,
    read_csv,
    write_csv,
)
from store import DATA_DIR, PARIS, fmt_utc, parse_ts  # noqa: E402

UTC = timezone.utc
STEP = 15  # minutes
T0 = datetime(2010, 12, 1, tzinfo=UTC)
HORIZON_DAYS = 540
OFFLINE_SHARE = 0.1  # a reactor below 10% of its capacity counts as offline

HOURLY_DIR = NUCLEAR_DIR / "hourly"
UNIT_DAILY_DIR = NUCLEAR_DIR / "unit_daily"
OUTLOOK_DIR = NUCLEAR_DIR / "outlook"
OUTAGES_DIR = NUCLEAR_DIR / "outages"
LIVE_FILE = NUCLEAR_DIR / "live.json"
FLEET_FILE = NUCLEAR_DIR / "fleet.json"
DAILY_FILE = DATA_DIR / "summary" / "nuclear_daily.csv"

# --------------------------------------------------------------------------
# Fleet register
# --------------------------------------------------------------------------

# Site locations (decimal degrees) from the coordinates on Wikipedia's
# "List of power stations in France".
SITES = {
    "BELLEVILLE": ("Belleville", 47.5106, 2.8761),
    "BLAYAIS": ("Blayais", 45.2558, -0.6931),
    "BUGEY": ("Bugey", 45.7983, 5.2708),
    "CATTENOM": ("Cattenom", 49.4158, 6.2181),
    "CHINON": ("Chinon", 47.2306, 0.1706),
    "CHOOZ": ("Chooz", 50.0900, 4.7894),
    "CIVAUX": ("Civaux", 46.4567, 0.6528),
    "CRUAS": ("Cruas", 44.6331, 4.7567),
    "DAMPIERRE": ("Dampierre", 47.7336, 2.5172),
    "FESSENHEIM": ("Fessenheim", 47.9033, 7.5622),
    "FLAMANVILLE": ("Flamanville", 49.5364, -1.8817),
    "GOLFECH": ("Golfech", 44.1067, 0.8453),
    "GRAVELINES": ("Gravelines", 51.0153, 2.1361),
    "NOGENT": ("Nogent", 48.5153, 3.5178),
    "PALUEL": ("Paluel", 49.8581, 0.6356),
    "PENLY": ("Penly", 49.9767, 1.2119),
    "ST ALBAN": ("Saint-Alban", 45.4042, 4.7556),
    "ST LAURENT": ("Saint-Laurent", 47.7200, 1.5775),
    "TRICASTIN": ("Tricastin", 44.3297, 4.7322),
}

# Reactor series (design families).
SERIES = {
    "CP0 (900 MW)": ["BUGEY 2", "BUGEY 3", "BUGEY 4", "BUGEY 5", "FESSENHEIM 1", "FESSENHEIM 2"],
    "CP1 (900 MW)": [f"BLAYAIS {i}" for i in range(1, 5)] + [f"DAMPIERRE {i}" for i in range(1, 5)]
    + [f"GRAVELINES {i}" for i in range(1, 7)] + [f"TRICASTIN {i}" for i in range(1, 5)],
    "CP2 (900 MW)": [f"CHINON {i}" for i in range(1, 5)] + [f"CRUAS {i}" for i in range(1, 5)]
    + ["ST LAURENT 1", "ST LAURENT 2"],
    "P4 (1300 MW)": ["FLAMANVILLE 1", "FLAMANVILLE 2"] + [f"PALUEL {i}" for i in range(1, 5)]
    + ["ST ALBAN 1", "ST ALBAN 2"],
    "P'4 (1300 MW)": ["BELLEVILLE 1", "BELLEVILLE 2"] + [f"CATTENOM {i}" for i in range(1, 5)]
    + ["GOLFECH 1", "GOLFECH 2", "NOGENT 1", "NOGENT 2", "PENLY 1", "PENLY 2"],
    "N4 (1450 MW)": ["CHOOZ 1", "CHOOZ 2", "CIVAUX 1", "CIVAUX 2"],
    "EPR (1650 MW)": ["FLAMANVILLE 3"],
}
SERIES_OF = {unit: series for series, units in SERIES.items() for unit in units}

# Units that joined or left the fleet inside the data period (UTC).
IN_SERVICE = {
    "FESSENHEIM 1": (None, "2020-02-22T01:00Z"),   # final shutdown 22 Feb 2020
    "FESSENHEIM 2": (None, "2020-06-29T22:00Z"),   # final shutdown 30 Jun 2020
    "FLAMANVILLE 3": ("2024-12-21T10:48Z", None),  # first grid connection
}

# Capacities from RTE's notices (MW), used if a reactor has no notice.
DEFAULT_MW = {
    "BELLEVILLE": 1310, "BLAYAIS": 910, "BUGEY 2": 910, "BUGEY 3": 910, "BUGEY 4": 880,
    "BUGEY 5": 880, "CATTENOM": 1300, "CHINON": 905, "CHOOZ": 1500, "CIVAUX": 1495,
    "CRUAS": 915, "DAMPIERRE": 890, "FESSENHEIM": 880, "FLAMANVILLE 3": 1620,
    "FLAMANVILLE": 1330, "GOLFECH": 1310, "GRAVELINES": 910, "NOGENT": 1310,
    "PALUEL": 1330, "PENLY": 1330, "ST ALBAN": 1335, "ST LAURENT": 915, "TRICASTIN": 915,
}


def site_key(name):
    return re.sub(r"\s*\d+$", "", name).strip()


def default_mw(name):
    return DEFAULT_MW.get(name) or DEFAULT_MW.get(site_key(name))


# --------------------------------------------------------------------------
# Time grid helpers
# --------------------------------------------------------------------------

def to_idx(text_or_dt, rounding=True):
    value = parse_ts(text_or_dt) if isinstance(text_or_dt, str) else text_or_dt
    minutes = (value - T0).total_seconds() / 60
    return int(round(minutes / STEP)) if rounding else int(minutes // STEP)


def idx_time(i):
    return T0 + timedelta(minutes=STEP * int(i))


def paris_midnight(day):
    return datetime(day.year, day.month, day.day, tzinfo=PARIS).astimezone(UTC)


# --------------------------------------------------------------------------
# Notices
# --------------------------------------------------------------------------

def parse_steps(row, cap):
    steps = []
    for part in (row["intervals"] or "").split(";"):
        if not part:
            continue
        s, e, avail, unavail = part.split("/")
        if unavail not in ("", None):
            off = int(float(unavail))
        elif avail not in ("", None):
            off = cap - int(float(avail))
        else:
            continue
        steps.append((s, e, max(0, min(off, cap))))
    if not steps and row["start_utc"] and row["end_utc"]:
        steps.append((row["start_utc"], row["end_utc"], cap))
    return steps


def load_versions():
    """All versions grouped by identifier, each list sorted by version."""
    by_id = defaultdict(list)
    for row in iter_notices():
        row["version"] = int(row["version"])
        by_id[row["identifier"]].append(row)
    for rows in by_id.values():
        rows.sort(key=lambda r: (r["version"], r["publication_utc"]))
    return by_id


def build_fleet(by_id):
    """Reactor list keyed by name (RTE's names are stable; EICs recorded too)."""
    units = {}
    for rows in by_id.values():
        for row in rows:
            name = row["unit_name"]
            if not name:
                continue
            unit = units.setdefault(name, {"name": name, "eic": row["unit_eic"], "mw": None, "_pub": ""})
            if row["installed_mw"] and row["publication_utc"] >= unit["_pub"]:
                unit["mw"] = int(float(row["installed_mw"]))
                unit["_pub"] = row["publication_utc"]
                unit["eic"] = row["unit_eic"] or unit["eic"]

    # Reactors that have never had a notice still belong to the fleet.
    for names in SERIES.values():
        for name in names:
            units.setdefault(name, {"name": name, "eic": "", "mw": None, "_pub": ""})

    fleet = []
    for name, unit in sorted(units.items()):
        site = site_key(name)
        if site not in SITES:
            print(f"  note: {name} is not a known reactor; ignored")
            continue
        label, lat, lon = SITES[site]
        start, end = IN_SERVICE.get(name, (None, None))
        fleet.append({
            "name": name,
            "label": f"{label} {name.split()[-1]}",
            "site": label,
            "eic": unit["eic"],
            "mw": unit["mw"] or default_mw(name),
            "series": SERIES_OF.get(name, ""),
            "lat": lat,
            "lon": lon,
            "from_utc": start,
            "to_utc": end,
        })
    return fleet


class Grid:
    """Per-reactor 15-minute arrays of planned / unplanned unavailable MW."""

    def __init__(self, fleet, start_idx, n):
        self.fleet = fleet
        self.index = {u["name"]: i for i, u in enumerate(fleet)}
        self.start = start_idx
        self.n = n
        self.planned = np.zeros((len(fleet), n), dtype=np.int16)
        self.unplanned = np.zeros((len(fleet), n), dtype=np.int16)
        self.cap = np.zeros((len(fleet), n), dtype=np.int16)
        for i, u in enumerate(fleet):
            a = 0 if not u["from_utc"] else max(0, to_idx(u["from_utc"]) - start_idx)
            b = n if not u["to_utc"] else min(n, max(0, to_idx(u["to_utc"]) - start_idx))
            if b > a:
                self.cap[i, a:b] = u["mw"]

    def apply(self, row):
        if row["status"] == "DISMISSED":
            return
        i = self.index.get(row["unit_name"])
        if i is None:
            return
        cap = self.fleet[i]["mw"]
        target = self.unplanned if "UNPLANNED" in (row["type"] or "") else self.planned
        for s, e, off in parse_steps(row, cap):
            a = max(0, to_idx(s) - self.start)
            b = min(self.n, to_idx(e) - self.start)
            if b > a and off > 0:
                np.maximum(target[i, a:b], off, out=target[i, a:b])

    def totals(self):
        """(installed, available, planned_off, unplanned_off) per reactor-step."""
        off = np.minimum(np.maximum(self.planned, self.unplanned), self.cap)
        planned = np.minimum(self.planned, off)
        unplanned = off - planned
        avail = self.cap - off
        return self.cap, avail, planned, unplanned


# --------------------------------------------------------------------------
# Hourly, daily and per-reactor history (current knowledge)
# --------------------------------------------------------------------------

def load_output():
    out = {}
    for path in sorted(OUTPUT_DIR.glob("*/*.csv")):
        for row in read_csv(path):
            out[row["start_utc"]] = int(row["mw"])
    return out


def paris_month_key(dt):
    return dt.astimezone(PARIS).strftime("%Y-%m")


def write_hourly(hours, cap_h, avail_h, plan_h, unpl_h, output, last_hour):
    files = defaultdict(list)
    for k, t in enumerate(hours):
        if t > last_hour:
            break
        key = fmt_utc(t)
        files[paris_month_key(t)].append({
            "start_utc": key,
            "installed_mw": int(round(cap_h[k])),
            "available_mw": int(round(avail_h[k])),
            "planned_off_mw": int(round(plan_h[k])),
            "unplanned_off_mw": int(round(unpl_h[k])),
            "output_mw": output.get(key, ""),
        })
    fields = ["start_utc", "installed_mw", "available_mw", "planned_off_mw", "unplanned_off_mw", "output_mw"]
    for month, rows in files.items():
        write_csv(HOURLY_DIR / month[:4] / f"{month}.csv", fields, rows)
    return sorted(files)


def history(fleet, by_id, now):
    """Final-version availability from Dec 2010 to 3 years ahead."""
    start_idx = 0
    end_time = (now + timedelta(days=3 * 366)).replace(minute=0, second=0, microsecond=0)
    n = to_idx(end_time)
    n -= n % 4
    grid = Grid(fleet, start_idx, n)
    for rows in by_id.values():
        grid.apply(rows[-1])
    cap, avail, planned, unplanned = grid.totals()
    return grid, cap, avail, planned, unplanned


_MIDNIGHTS = {}


def midnight_idx(day):
    if day not in _MIDNIGHTS:
        _MIDNIGHTS[day] = to_idx(paris_midnight(day))
    return _MIDNIGHTS[day]


def day_bounds(first_day, last_day):
    """UTC 15-minute indices of Paris midnights from first_day to last_day+1."""
    days = []
    d = first_day
    while d <= last_day + timedelta(days=1):
        days.append(d)
        d += timedelta(days=1)
    return days, [midnight_idx(x) for x in days]


def build_history_files(fleet, grid, cap, avail, planned, unplanned, now):
    output = load_output()
    n = grid.n
    hours_n = n // 4

    cap_f = cap.sum(axis=0, dtype=np.int64)
    avail_f = avail.sum(axis=0, dtype=np.int64)
    plan_f = planned.sum(axis=0, dtype=np.int64)
    unpl_f = unplanned.sum(axis=0, dtype=np.int64)

    def hmean(a):
        return a[: hours_n * 4].reshape(hours_n, 4).mean(axis=1)

    hours = [T0 + timedelta(hours=k) for k in range(hours_n)]
    first_hour = datetime(2010, 12, 15, tzinfo=UTC)
    k0 = int((first_hour - T0).total_seconds() // 3600)
    last_hour = now.replace(minute=0, second=0, microsecond=0)
    months = write_hourly(hours[k0:], hmean(cap_f)[k0:], hmean(avail_f)[k0:], hmean(plan_f)[k0:],
                          hmean(unpl_f)[k0:], output, last_hour)

    # Daily (Paris days) fleet and per-reactor summaries.
    today = now.astimezone(PARIS).date()
    first_day = date(2010, 12, 15)
    days, bounds = day_bounds(first_day, today)
    out_by_day = defaultdict(list)
    for key, mw in output.items():
        out_by_day[parse_ts(key).astimezone(PARIS).date()].append(mw)

    daily_rows = []
    unit_rows = defaultdict(list)
    names = [u["name"] for u in fleet]
    for k, d in enumerate(days[:-1]):
        a, b = bounds[k], bounds[k + 1]
        if b > n:
            break
        if d > today:
            break
        cap_d = cap_f[a:b]
        av = avail_f[a:b]
        unit_mean = avail[:, a:b].mean(axis=1)
        unit_cap = cap[:, a:b].mean(axis=1)
        in_service = unit_cap > 0
        offline = int(((unit_mean < OFFLINE_SHARE * np.maximum(unit_cap, 1)) & in_service).sum())
        partial = int(((unit_mean >= OFFLINE_SHARE * unit_cap) & (unit_mean < 0.9 * unit_cap) & in_service).sum())
        outs = out_by_day.get(d, [])
        hours_in_day = (b - a) / 4
        out_mean = round(sum(outs) / len(outs)) if outs and len(outs) >= 0.9 * hours_in_day else ""
        daily_rows.append({
            "date": d.isoformat(),
            "installed_mw": int(round(cap_d.mean())),
            "reactors": int(in_service.sum()),
            "available_mw": int(round(av.mean())),
            "available_min_mw": int(av.min()),
            "available_max_mw": int(av.max()),
            "planned_off_mw": int(round(plan_f[a:b].mean())),
            "unplanned_off_mw": int(round(unpl_f[a:b].mean())),
            "offline_reactors": offline,
            "partial_reactors": partial,
            "output_mw": out_mean,
            "output_gwh": round(out_mean * hours_in_day / 1000, 1) if out_mean != "" else "",
            "load_factor_pct": round(100 * out_mean / cap_d.mean(), 1) if out_mean != "" and cap_d.mean() else "",
            "availability_pct": round(100 * av.mean() / cap_d.mean(), 1) if cap_d.mean() else "",
        })
        row = {"date": d.isoformat()}
        for j, name in enumerate(names):
            row[name] = int(round(unit_mean[j])) if in_service[j] else ""
        unit_rows[d.year].append(row)

    fields = list(daily_rows[0].keys())
    write_csv(DAILY_FILE, fields, daily_rows)
    for year, rows in unit_rows.items():
        write_csv(UNIT_DAILY_DIR / f"{year}.csv", ["date"] + names, rows)
    return months, daily_rows


# --------------------------------------------------------------------------
# As-of outlooks
# --------------------------------------------------------------------------

def outlook_from(fleet, versions, start_day):
    """Daily mean available MW for start_day .. start_day+HORIZON-1 from the given versions."""
    days = [start_day + timedelta(days=k) for k in range(HORIZON_DAYS + 1)]
    bounds = np.array([midnight_idx(d) for d in days])
    a = bounds[0]
    grid = Grid(fleet, a, int(bounds[-1] - a))
    for row in versions:
        grid.apply(row)
    _, avail, _, _ = grid.totals()
    total = avail.sum(axis=0, dtype=np.int64)
    rel = bounds - a
    return np.add.reduceat(total, rel[:-1]) / np.diff(rel)


def encode(values):
    return " ".join(str(int(round(v / 10))) for v in values)


def build_outlooks(fleet, by_id, now, full):
    """One row per as-of day P with the outlook for P+1 .. P+HORIZON."""
    today = now.astimezone(PARIS).date()
    existing_months = {p.stem for p in OUTLOOK_DIR.glob("*/*.csv")}
    first_day = date(2011, 1, 1)
    if not full and existing_months:
        last_month = max(existing_months)
        rows = read_csv(OUTLOOK_DIR / last_month[:4] / f"{last_month}.csv")
        if rows:
            first_day = date.fromisoformat(rows[-1]["as_of"]) + timedelta(days=1)

    versions = sorted((r for rows in by_id.values() for r in rows), key=lambda r: r["publication_utc"])
    newest = {}   # identifier -> highest version seen so far
    active = {}   # identifier -> that version, while it can still affect the future
    pos = 0
    by_month = defaultdict(list)

    def advance(cutoff_text):
        nonlocal pos
        while pos < len(versions) and versions[pos]["publication_utc"] < cutoff_text:
            v = versions[pos]
            if v["version"] >= newest.get(v["identifier"], -1):
                newest[v["identifier"]] = v["version"]
                if v["status"] == "DISMISSED":
                    active.pop(v["identifier"], None)
                else:
                    active[v["identifier"]] = v
            pos += 1

    def relevant(from_text):
        for ident in [i for i, v in active.items() if v["end_utc"] <= from_text]:
            del active[ident]
        return list(active.values())

    day = first_day
    while day < today:
        advance(fmt_utc(paris_midnight(day + timedelta(days=1))))
        start = day + timedelta(days=1)
        values = outlook_from(fleet, relevant(fmt_utc(paris_midnight(start))), start)
        by_month[day.strftime("%Y-%m")].append({"as_of": day.isoformat(), "first_target": start.isoformat(),
                                                "mw10": encode(values)})
        day += timedelta(days=1)

    for month, rows in by_month.items():
        path = OUTLOOK_DIR / month[:4] / f"{month}.csv"
        old = {r["as_of"]: r for r in read_csv(path)} if not full else {}
        for r in rows:
            old[r["as_of"]] = r
        write_csv(path, ["as_of", "first_target", "mw10"], [old[k] for k in sorted(old)])

    # Current outlook (latest knowledge), from tomorrow.
    advance("9999")
    start = today + timedelta(days=1)
    current = outlook_from(fleet, relevant(fmt_utc(paris_midnight(start))), start)
    months = sorted(p.stem for p in OUTLOOK_DIR.glob("*/*.csv"))
    return {"as_of_utc": fmt_utc(now), "first_target": start.isoformat(), "mw10": encode(current)}, months


# --------------------------------------------------------------------------
# Outages table
# --------------------------------------------------------------------------

def english_remark(text):
    text = (text or "").strip()
    if "--------" in text:
        text = text.split("--------")[-1]
    elif " / " in text and len(text) < 120:
        text = text.split(" / ")[0]
    text = re.sub(r"\s+", " ", text).strip()
    return text[:300]


def build_outages(fleet, by_id):
    names = {u["name"] for u in fleet}
    by_year = defaultdict(list)
    for ident, rows in by_id.items():
        last = rows[-1]
        if last["unit_name"] not in names or not last["start_utc"]:
            continue
        cap = next(u["mw"] for u in fleet if u["name"] == last["unit_name"])
        steps = parse_steps(last, cap)
        max_off = max((s[2] for s in steps), default=0)
        live = [r for r in rows if r["status"] != "DISMISSED"]
        first = live[0] if live else rows[0]
        by_year[last["start_utc"][:4]].append({
            "id": ident,
            "unit": last["unit_name"],
            "type": "unplanned" if "UNPLANNED" in last["type"] else "planned",
            "reason": last["reason"],
            "status": last["status"],
            "start_utc": last["start_utc"],
            "end_utc": last["end_utc"],
            "first_end_utc": first["end_utc"],
            "first_start_utc": first["start_utc"],
            "first_pub_utc": rows[0]["publication_utc"],
            "last_pub_utc": last["publication_utc"],
            "versions": len(rows),
            "off_mw": max_off,
            "cap_mw": cap,
            "remark": english_remark(last["remarks"]),
        })
    fields = ["id", "unit", "type", "reason", "status", "start_utc", "end_utc", "first_start_utc",
              "first_end_utc", "first_pub_utc", "last_pub_utc", "versions", "off_mw", "cap_mw", "remark"]
    for year, rows in by_year.items():
        rows.sort(key=lambda r: (r["start_utc"], r["unit"]))
        write_csv(OUTAGES_DIR / f"{year}.csv", fields, rows)
    return sorted(by_year)


# --------------------------------------------------------------------------
# Live status
# --------------------------------------------------------------------------

def build_live(fleet, by_id, grid, cap, avail, planned, unplanned, now, outlook_now):
    i_now = to_idx(now, rounding=False) - grid.start
    unit_output = json.loads(UNIT_OUTPUT_FILE.read_text()) if UNIT_OUTPUT_FILE.exists() else {"units": {}}
    out_by_name = {v["name"]: v["values"] for v in unit_output.get("units", {}).values()}
    week_start = (now - timedelta(days=7)).replace(minute=0, second=0, microsecond=0)
    week_hours = [fmt_utc(week_start + timedelta(hours=h)) for h in range(7 * 24 + 1)]

    # Latest version covering now, per reactor (for the notice details).
    covering = defaultdict(list)
    now_text = fmt_utc(now)
    for ident, rows in by_id.items():
        last = rows[-1]
        if last["status"] == "DISMISSED":
            continue
        if last["start_utc"] <= now_text < last["end_utc"]:
            covering[last["unit_name"]].append((ident, rows))

    units = []
    for j, u in enumerate(fleet):
        c = int(cap[j, i_now])
        if c == 0:
            continue
        a = int(avail[j, i_now])
        off = c - a
        limit = OFFLINE_SHARE * c
        state = "offline" if a < limit else ("reduced" if a < 0.9 * c else "online")

        since = until = None
        if state != "online":
            threshold = 0.9 * c
            back = avail[j, : i_now + 1] >= threshold
            prev_ok = np.flatnonzero(back)
            since_idx = (prev_ok[-1] + 1) if prev_ok.size else 0
            fwd = np.flatnonzero(avail[j, i_now:] >= threshold)
            until_idx = i_now + fwd[0] if fwd.size else None
            since = fmt_utc(idx_time(since_idx + grid.start))
            until = fmt_utc(idx_time(until_idx + grid.start)) if until_idx is not None else None

        notices = []
        for ident, rows in covering.get(u["name"], []):
            last = rows[-1]
            steps = parse_steps(last, u["mw"])
            notices.append({
                "id": ident,
                "type": "unplanned" if "UNPLANNED" in last["type"] else "planned",
                "reason": last["reason"],
                "start_utc": last["start_utc"],
                "end_utc": last["end_utc"],
                "first_end_utc": next((r["end_utc"] for r in rows if r["status"] != "DISMISSED"), last["end_utc"]),
                "versions": len(rows),
                "off_mw": max((s[2] for s in steps), default=0),
                "remark": english_remark(last["remarks"]),
            })
        notices.sort(key=lambda x: -x["off_mw"])

        series = out_by_name.get(u["name"], {})
        output = [series.get(h) for h in week_hours]
        last_output = next(((week_hours[k], output[k]) for k in range(len(output) - 1, -1, -1)
                            if output[k] is not None), (None, None))
        units.append({
            "name": u["name"], "label": u["label"], "site": u["site"], "mw": c,
            "available_mw": a, "off_mw": off, "state": state,
            "planned_off_mw": int(planned[j, i_now]), "unplanned_off_mw": int(unplanned[j, i_now]),
            "since_utc": since, "until_utc": until, "notices": notices,
            "output_mw": last_output[1], "output_hour_utc": last_output[0],
            "output_week": output,
        })

    # Next 14 days, hourly, current knowledge.
    h0 = (i_now // 4) * 4
    n14 = 14 * 24 * 4
    fleet_avail = avail[:, h0:h0 + n14].sum(axis=0, dtype=np.int64)
    fleet_cap = cap[:, h0:h0 + n14].sum(axis=0, dtype=np.int64)
    hours = len(fleet_avail) // 4
    next14 = {
        "start_utc": fmt_utc(idx_time(h0 + grid.start)),
        "available_mw": [int(round(x)) for x in fleet_avail[: hours * 4].reshape(hours, 4).mean(axis=1)],
        "installed_mw": [int(round(x)) for x in fleet_cap[: hours * 4].reshape(hours, 4).mean(axis=1)],
    }

    # Notice changes published in the past 72 hours.
    since_text = fmt_utc(now - timedelta(hours=72))
    changes = []
    for ident, rows in by_id.items():
        for k, r in enumerate(rows):
            if r["publication_utc"] < since_text:
                continue
            prev = rows[k - 1] if k else None
            cap_u = next((u["mw"] for u in fleet if u["name"] == r["unit_name"]), None)
            if cap_u is None:
                continue
            steps = parse_steps(r, cap_u)
            changes.append({
                "id": ident, "unit": r["unit_name"], "version": r["version"],
                "published_utc": r["publication_utc"],
                "type": "unplanned" if "UNPLANNED" in r["type"] else "planned",
                "reason": r["reason"], "status": r["status"],
                "start_utc": r["start_utc"], "end_utc": r["end_utc"],
                "prev_start_utc": prev["start_utc"] if prev else None,
                "prev_end_utc": prev["end_utc"] if prev else None,
                "prev_status": prev["status"] if prev else None,
                "off_mw": max((s[2] for s in steps), default=0),
                "remark": english_remark(r["remarks"]),
            })
    changes.sort(key=lambda c: c["published_utc"], reverse=True)

    latest_pub = max((rows[-1]["publication_utc"] for rows in by_id.values()), default=None)
    fleet_now = {
        "installed_mw": int(cap[:, i_now].sum()),
        "available_mw": int(avail[:, i_now].sum()),
        "planned_off_mw": int(planned[:, i_now].sum()),
        "unplanned_off_mw": int(unplanned[:, i_now].sum()),
    }
    live = {
        "generated_utc": fmt_utc(now),
        "latest_notice_utc": latest_pub,
        "unit_output_updated_utc": unit_output.get("updated_utc"),
        "week_start_utc": week_hours[0],
        "fleet": fleet_now,
        "units": units,
        "next14": next14,
        "changes": changes[:150],
        "outlook": outlook_now,
    }
    LIVE_FILE.write_text(json.dumps(live, separators=(",", ":")))
    return live


# --------------------------------------------------------------------------

def main(full=False, now=None):
    now = now or datetime.now(UTC)
    by_id = load_versions()
    if not by_id:
        print("No nuclear notices stored yet; nothing to build.")
        return None
    fleet = build_fleet(by_id)
    FLEET_FILE.parent.mkdir(parents=True, exist_ok=True)

    grid, cap, avail, planned, unplanned = history(fleet, by_id, now)
    months, daily = build_history_files(fleet, grid, cap, avail, planned, unplanned, now)
    outlook_now, outlook_months = build_outlooks(fleet, by_id, now, full)
    outage_years = build_outages(fleet, by_id)
    live = build_live(fleet, by_id, grid, cap, avail, planned, unplanned, now, outlook_now)

    output_months = sorted(p.stem for p in OUTPUT_DIR.glob("*/*.csv"))
    FLEET_FILE.write_text(json.dumps({
        "reactors": fleet,
        "series": list(SERIES),
        "hourly_months": months,
        "unit_daily_years": sorted(p.stem for p in UNIT_DAILY_DIR.glob("*.csv")),
        "outlook_months": outlook_months,
        "outage_years": outage_years,
        "output_from": output_months[0] if output_months else None,
        "horizon_days": HORIZON_DAYS,
        "generated_utc": fmt_utc(now),
    }, indent=1))

    f = live["fleet"]
    print(f"Nuclear: {len(by_id)} notices, {len(fleet)} reactors, {len(daily)} days; "
          f"available now {f['available_mw']} of {f['installed_mw']} MW")
    return live


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--full", action="store_true", help="rebuild every as-of outlook")
    main(full=parser.parse_args().full)
