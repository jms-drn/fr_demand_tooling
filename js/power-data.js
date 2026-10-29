// Loading the nuclear and hydro data files (built by scripts/power_summarise.py).

import { cached, fetchText, parseUtc } from "./data.js";
import { addDays, dateKey, monthKey, parisMidnight } from "./util.js";

const num = text => (text === "" || text == null ? null : Number(text));

/** CSV with quoted fields (notice remarks contain commas and quotes). */
export function parseQuotedCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() || [];
  return rows.filter(r => r.length > 1).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

function simpleCsv(text) {
  const lines = text.trim().split("\n");
  const header = lines[0].split(",");
  return lines.slice(1).map(line => {
    const cells = line.split(",");
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
}

export function getFleet() {
  return cached("nuclear-fleet", async () => JSON.parse(await fetchText("data/nuclear/fleet.json")));
}

export function getLive() {
  return cached("nuclear-live", async () => JSON.parse(await fetchText("data/nuclear/live.json")));
}

const DAILY_NUM = ["installed_mw", "reactors", "available_mw", "available_min_mw", "available_max_mw", "planned_off_mw",
  "unplanned_off_mw", "offline_reactors", "partial_reactors", "output_mw", "output_gwh", "load_factor_pct", "availability_pct"];

/** Daily fleet summary: { rows, byDate }. */
export function getNuclearDaily() {
  return cached("nuclear-daily", async () => {
    const rows = simpleCsv(await fetchText("data/summary/nuclear_daily.csv")).map(r => {
      const out = { date: r.date };
      for (const k of DAILY_NUM) out[k] = num(r[k]);
      return out;
    });
    return { rows, byDate: new Map(rows.map(r => [r.date, r])) };
  });
}

function hourlyMonth(month) {
  return cached(`nuclear-hourly-${month}`, async () => {
    const text = await fetchText(`data/nuclear/hourly/${month.slice(0, 4)}/${month}.csv`, { optional: true });
    if (!text) return [];
    return simpleCsv(text).map(r => ({
      x: parseUtc(r.start_utc), installed: num(r.installed_mw), available: num(r.available_mw),
      planned: num(r.planned_off_mw), unplanned: num(r.unplanned_off_mw), output: num(r.output_mw)
    }));
  });
}

function monthsBetween(from, to) {
  const months = [];
  let m = from.slice(0, 7);
  const last = to.slice(0, 7);
  while (m <= last) {
    months.push(m);
    const [y, mo] = m.split("-").map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }
  return months;
}

/** Hourly fleet rows between two Paris dates (inclusive). */
export async function getNuclearHourly(from, to) {
  const fleet = await getFleet();
  const have = new Set(fleet.hourly_months);
  const months = monthsBetween(addDays(from, -1), addDays(to, 1)).filter(m => have.has(m));
  const parts = await Promise.all(months.map(hourlyMonth));
  const lo = parisMidnight(from);
  const hi = parisMidnight(addDays(to, 1));
  return parts.flat().filter(r => r.x >= lo && r.x < hi);
}

/** Daily mean available MW per reactor: Map(date -> {name: mw}). */
export async function getUnitDaily(from, to) {
  const fleet = await getFleet();
  const years = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    if (fleet.unit_daily_years.includes(String(y))) years.push(String(y));
  }
  const parts = await Promise.all(years.map(y => cached(`unit-daily-${y}`, async () => {
    const text = await fetchText(`data/nuclear/unit_daily/${y}.csv`);
    return simpleCsv(text);
  })));
  const out = new Map();
  for (const row of parts.flat()) {
    if (row.date < from || row.date > to) continue;
    const values = {};
    for (const [k, v] of Object.entries(row)) if (k !== "date" && v !== "") values[k] = Number(v);
    out.set(row.date, values);
  }
  return out;
}

function outlookMonth(month) {
  return cached(`outlook-${month}`, async () => {
    const text = await fetchText(`data/nuclear/outlook/${month.slice(0, 4)}/${month}.csv`, { optional: true });
    const map = new Map();
    if (!text) return map;
    for (const r of simpleCsv(text)) {
      map.set(r.as_of, { asOf: r.as_of, first: r.first_target, values: r.mw10.split(" ").map(v => Number(v) * 10), unplanned: (r.unplanned10 || "").split(" ").filter(Boolean).map(v => Number(v) * 10) });
    }
    return map;
  });
}

/**
 * The outlook as known at the end of `asOf` (a Paris date): daily mean
 * available MW for asOf+1 onwards. `asOf` = today gives the live outlook.
 * Returns { asOf, first, values, byDate: Map(date -> MW) } or null.
 */
export async function getOutlookAsOf(asOf, today) {
  let entry;
  if (asOf >= today) {
    const live = await getLive();
    entry = {
      asOf: today, first: live.outlook.first_target, live: true,
      values: live.outlook.mw10.split(" ").map(v => Number(v) * 10),
      unplanned: (live.outlook.unplanned10 || "").split(" ").filter(Boolean).map(v => Number(v) * 10)
    };
  } else {
    entry = (await outlookMonth(asOf.slice(0, 7))).get(asOf);
  }
  if (!entry) return null;
  if (!entry.byDate) {
    entry.byDate = new Map(entry.values.map((v, i) => [addDays(entry.first, i), v]));
    entry.unplByDate = new Map((entry.unplanned || []).map((v, i) => [addDays(entry.first, i), v]));
  }
  return entry;
}

/** Outlooks for a run of as-of dates (for the "how the outlook changed" chart). */
export async function getOutlookRange(from, to) {
  const months = monthsBetween(from, to);
  const maps = await Promise.all(months.map(outlookMonth));
  const out = [];
  for (const map of maps) for (const [d, e] of map) if (d >= from && d <= to) out.push(e);
  return out.sort((a, b) => (a.asOf < b.asOf ? -1 : 1));
}

/** Outage rows (latest version of each notice) for the given start years. */
export async function getOutages(years) {
  const fleet = await getFleet();
  const wanted = years.filter(y => fleet.outage_years.includes(String(y)));
  const parts = await Promise.all(wanted.map(y => cached(`outages-${y}`, async () =>
    parseQuotedCsv(await fetchText(`data/nuclear/outages/${y}.csv`)).map(r => ({
      ...r,
      start: parseUtc(r.start_utc), end: parseUtc(r.end_utc),
      firstEnd: parseUtc(r.first_end_utc), firstStart: parseUtc(r.first_start_utc),
      firstPub: parseUtc(r.first_pub_utc), lastPub: parseUtc(r.last_pub_utc),
      versions: Number(r.versions), offMw: Number(r.off_mw), capMw: Number(r.cap_mw)
    })))));
  return parts.flat();
}

/** Weekly hydro reservoir levels: [{ start, end, mwh, updated }]. */
export function getReserves() {
  return cached("hydro-reserves", async () => simpleCsv(await fetchText("data/hydro/reserves.csv"))
    .map(r => ({ start: r.week_start, end: r.week_end, mwh: Number(r.mwh), updated: r.updated_utc })));
}

/** Installed nuclear capacity (MW) on a Paris date, from the reactor list. */
export function installedOn(fleet, date) {
  const t = parisMidnight(date) + 12 * 3600000;
  return fleet.reactors.reduce((sum, r) => {
    const from = r.from_utc ? Date.parse(r.from_utc.replace("Z", ":00Z")) : -Infinity;
    const to = r.to_utc ? Date.parse(r.to_utc.replace("Z", ":00Z")) : Infinity;
    return t >= from && t < to ? sum + r.mw : sum;
  }, 0);
}

export { dateKey, monthKey };
