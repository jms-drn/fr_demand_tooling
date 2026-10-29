// Loading and caching the repository's data files.
//
// Every file is requested with "?v=<time of the data update>", taken from
// data/status.json. That guarantees all files on screen come from the same
// update (mixing a newer latest.json with an older archive file caused the
// flat D-2 line in v1), and bypasses stale copies in browser and CDN caches.

import { HOUR, QUARTER, dateKey, monthKey, parisMidnight, addDays } from "./util.js";

let version = "";
const textCache = new Map();
const parsedCache = new Map();
let liveOverride = null;

export function dataVersion() {
  return version;
}

/** Switch to a new data update: everything is re-read on next use. */
export function setDataVersion(next) {
  if (next === version) return false;
  version = next;
  textCache.clear();
  parsedCache.clear();
  return true;
}

async function fetchText(path, { optional = false } = {}) {
  const url = `${path}?v=${encodeURIComponent(version)}`;
  if (textCache.has(url)) return textCache.get(url);

  const promise = fetch(url).then(async response => {
    if (response.status === 404 && optional) return "";
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.text();
  });

  textCache.set(url, promise);
  promise.catch(() => textCache.delete(url));
  return promise;
}

function cached(key, build) {
  const full = `${version}|${key}`;
  if (!parsedCache.has(full)) {
    const promise = build();
    parsedCache.set(full, promise);
    promise.catch(() => parsedCache.delete(full));
  }
  return parsedCache.get(full);
}

function parseCsv(text) {
  const lines = text.trim().split("\n");
  if (!lines[0]) return { header: [], rows: [] };
  return { header: lines[0].split(","), rows: lines.slice(1).map(line => line.split(",")) };
}

export function parseUtc(text) {
  // Stored as 2026-10-23T22:00Z
  return text ? Date.parse(text.replace("Z", ":00Z")) : null;
}

const num = text => (text === "" || text == null ? null : Number(text));

// ---------- Status and latest ----------

/** status.json is always fetched fresh (it decides the data version). */
export async function getStatus() {
  const response = await fetch(`data/status.json?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`status.json: HTTP ${response.status}`);
  return response.json();
}

/** Live RTE data from the refresh service, used until the archive catches up. */
export function setLiveOverride(payload) {
  liveOverride = payload && Array.isArray(payload.short_term) ? payload : null;
}

function lastRealised(payload) {
  let last = -Infinity;
  for (const block of payload?.short_term || []) {
    if (block.type !== "REALISED") continue;
    for (const item of block.values || []) last = Math.max(last, Date.parse(item.start_date));
  }
  return last;
}

export async function getLatest() {
  const archived = JSON.parse(await fetchText("data/latest.json"));
  if (liveOverride && lastRealised(liveOverride) > lastRealised(archived)) return liveOverride;
  return archived;
}

/** Values of one type from a short_term response: Map(ms -> MW). */
export function latestSeries(latest, type) {
  const map = new Map();
  for (const block of latest?.short_term || []) {
    if (block.type !== type) continue;
    for (const item of block.values || []) {
      if (item.value != null && item.value >= 15000) map.set(Date.parse(item.start_date), item.value);
    }
  }
  return map;
}

// ---------- Summaries ----------

/** data/summary/daily.csv as { rows, byDate } with numbers parsed. */
export function getDaily() {
  return cached("daily", async () => {
    const { header, rows } = parseCsv(await fetchText("data/summary/daily.csv"));
    const textFields = new Set(["date", "peak_time_paris", "min_time_paris", "d1_last_update_utc", "d2_last_update_utc"]);
    const objects = rows.map(row => {
      const obj = {};
      header.forEach((name, i) => { obj[name] = textFields.has(name) ? row[i] : num(row[i]); });
      obj.hours = obj.expected_intervals / 4;
      return obj;
    });
    return { rows: objects, byDate: new Map(objects.map(r => [r.date, r])) };
  });
}

async function csvObjects(path, numeric) {
  const { header, rows } = parseCsv(await fetchText(path));
  return rows.map(row => {
    const obj = {};
    header.forEach((name, i) => { obj[name] = numeric.has(name) ? num(row[i]) : row[i]; });
    return obj;
  });
}

export const getWeeklyErrors = () => cached("weekly_errors", () => csvObjects("data/summary/weekly_errors.csv",
  new Set(["lead_days", "pairs", "mae_mw", "bias_mw", "mape_pct", "forecast_peak_mw", "actual_peak_mw", "peak_error_mw", "ref_temp_c", "temp_dev_c"])));

export const getErrorProfile = () => cached("error_profile", () => csvObjects("data/summary/error_profile.csv",
  new Set(["key", "n", "sum_abs_err_mw", "sum_err_mw", "sum_actual_mw", "sum_abs_pct_err"])));

export const getAnnual = () => cached("annual", () => csvObjects("data/archive/annual_forecasts.csv",
  new Set(["avg_sat_to_fri_mw", "avg_mon_to_sun_8_20_mw", "weekly_min_mw", "weekly_max_mw", "margin_mw"])));

export const getWeeklyPeaks = () => cached("weekly_peaks", () => csvObjects("data/archive/weekly_peaks.csv",
  new Set(["peak_mw", "ref_temp_c", "temp_dev_c"])));

// ---------- Monthly archive files ----------

/**
 * One month of a series: realised / d1 / d2 -> Map(ms -> MW);
 * weekly -> array of { updated, start, mw }.
 */
export function getMonth(series, ym) {
  return cached(`${series}/${ym}`, async () => {
    const text = await fetchText(`data/archive/${series}/${ym.slice(0, 4)}/${ym}.csv`, { optional: true });
    const { rows } = parseCsv(text);
    if (series === "weekly") {
      return rows.map(r => ({ updated: parseUtc(r[0]), start: parseUtc(r[1]), mw: Number(r[2]) })).filter(r => r.mw >= 15000);
    }
    const map = new Map();
    for (const r of rows) {
      const mw = Number(r[1]);
      if (mw >= 15000) map.set(parseUtc(r[0]), mw);
    }
    return map;
  });
}

export function monthsBetween(fromMs, toMs) {
  const months = [];
  let ym = monthKey(fromMs);
  const last = monthKey(toMs - 1);
  while (ym <= last) {
    months.push(ym);
    let [y, m] = ym.split("-").map(Number);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    ym = `${y}-${String(m).padStart(2, "0")}`;
  }
  return months;
}

/** Values of a 15/30-minute series between two Paris dates (to inclusive): Map(ms -> MW). */
export async function getRange(series, fromDate, toDate) {
  const from = parisMidnight(fromDate);
  const toExclusive = parisMidnight(addDays(toDate, 1));
  const maps = await Promise.all(monthsBetween(from, toExclusive).map(ym => getMonth(series, ym)));
  const out = new Map();
  for (const map of maps) {
    for (const [ms, mw] of map) if (ms >= from && ms < toExclusive) out.set(ms, mw);
  }
  return out;
}

/** Latest-published week-ahead forecast per target day: Map(date -> { updated, points: Map(ms -> MW) }). */
export async function getWeekAhead(fromDate, toDate) {
  const months = monthsBetween(parisMidnight(fromDate), parisMidnight(addDays(toDate, 1)));
  const rows = (await Promise.all(months.map(ym => getMonth("weekly", ym)))).flat();
  const byDay = new Map();
  for (const r of rows) {
    const date = dateKey(r.start);
    if (date < fromDate || date > toDate) continue;
    const cur = byDay.get(date);
    if (!cur || r.updated > cur.updated) byDay.set(date, { updated: r.updated, points: new Map([[r.start, r.mw]]) });
    else if (r.updated === cur.updated) cur.points.set(r.start, r.mw);
  }
  return byDay;
}

/**
 * RTE's best available forecast for future intervals, at 15-minute steps:
 * intraday (today), then D-1, then D-2, then the latest week-ahead.
 * Returns { values: Map(ms -> MW), source: Map(ms -> label) }.
 */
export async function bestForecast(fromDate, toDate, afterMs) {
  const [latest, d1Arch, d2Arch, week] = await Promise.all([
    getLatest(), getRange("d1", fromDate, toDate), getRange("d2", fromDate, toDate), getWeekAhead(fromDate, toDate)
  ]);
  const layers = [
    ["Intraday", latestSeries(latest, "ID")],
    ["D-1", new Map([...d1Arch, ...latestSeries(latest, "D-1")])],
    ["D-2", new Map([...d2Arch, ...latestSeries(latest, "D-2")])],
    ["Week-ahead", new Map([...week.values()].flatMap(v => [...v.points]))]
  ];

  const values = new Map();
  const source = new Map();
  const start = parisMidnight(fromDate);
  const end = parisMidnight(addDays(toDate, 1));
  for (let x = start; x < end; x += QUARTER) {
    if (x <= afterMs) continue;
    const half = x - (x % (2 * QUARTER)); // half-hourly series hold the value at :00/:30
    for (const [label, map] of layers) {
      const v = map.get(x) ?? map.get(half);
      if (v != null) { values.set(x, v); source.set(x, label); break; }
    }
  }
  return { values, source };
}

/** Last date with any forecast available (the forecast horizon). */
export function horizonDate(status) {
  const lasts = ["d1", "d2", "weekly"].map(s => status?.series?.[s]?.last_utc).filter(Boolean).map(parseUtc);
  return lasts.length ? dateKey(Math.max(...lasts)) : dateKey(Date.now());
}

export { HOUR };
