// Loading and caching the repository's data files.

import { DAY, HOUR, QUARTER, dateKey, monthKey, parisMidnight, wall } from "./util.js";

const textCache = new Map();

async function fetchText(path, { optional = false, fresh = false } = {}) {
  if (!fresh && textCache.has(path)) return textCache.get(path);

  const promise = fetch(path, { cache: fresh ? "no-store" : "default" }).then(async response => {
    if (response.status === 404 && optional) return "";
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.text();
  });

  textCache.set(path, promise);
  promise.catch(() => textCache.delete(path));
  return promise;
}

function parseCsv(text) {
  const lines = text.trim().split("\n");
  if (!lines[0]) return { header: [], rows: [] };
  return { header: lines[0].split(","), rows: lines.slice(1).map(line => line.split(",")) };
}

function parseUtc(text) {
  // Stored as 2026-10-23T22:00Z
  return text ? Date.parse(text.replace("Z", ":00Z")) : null;
}

const num = text => (text === "" || text == null ? null : Number(text));

// ---------- Small files ----------

export async function getStatus() {
  return JSON.parse(await fetchText("data/status.json", { fresh: true }));
}

export async function getLatest() {
  return JSON.parse(await fetchText("data/latest.json", { fresh: true }));
}

let dailyPromise = null;

/** data/summary/daily.csv as { rows: [...], byDate: Map } with numbers parsed. */
export function getDaily() {
  if (!dailyPromise) {
    dailyPromise = fetchText("data/summary/daily.csv").then(text => {
      const { header, rows } = parseCsv(text);
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
  return dailyPromise;
}

async function getCsvObjects(path, numeric) {
  const { header, rows } = parseCsv(await fetchText(path));
  return rows.map(row => {
    const obj = {};
    header.forEach((name, i) => { obj[name] = numeric.has(name) ? num(row[i]) : row[i]; });
    return obj;
  });
}

export function getWeeklyErrors() {
  return getCsvObjects("data/summary/weekly_errors.csv",
    new Set(["lead_days", "pairs", "mae_mw", "bias_mw", "mape_pct", "forecast_peak_mw", "actual_peak_mw", "peak_error_mw", "ref_temp_c", "temp_dev_c"]));
}

export function getErrorProfile() {
  return getCsvObjects("data/summary/error_profile.csv",
    new Set(["key", "n", "sum_abs_err_mw", "sum_err_mw", "sum_actual_mw", "sum_abs_pct_err"]));
}

export function getAnnual() {
  return getCsvObjects("data/archive/annual_forecasts.csv",
    new Set(["avg_sat_to_fri_mw", "avg_mon_to_sun_8_20_mw", "weekly_min_mw", "weekly_max_mw", "margin_mw"]));
}

export function getWeeklyPeaks() {
  return getCsvObjects("data/archive/weekly_peaks.csv", new Set(["peak_mw", "ref_temp_c", "temp_dev_c"]));
}

// ---------- Monthly archive files ----------

const monthCache = new Map();

/**
 * One month of a series: realised / d1 / d2 -> Map(ms -> mw);
 * weekly -> array of { updated, start, mw }.
 */
export function getMonth(series, ym) {
  const key = `${series}/${ym}`;
  if (!monthCache.has(key)) {
    const path = `data/archive/${series}/${ym.slice(0, 4)}/${ym}.csv`;
    const fresh = ym === monthKey(Date.now()) || ym === monthKey(Date.now() + 10 * DAY);
    monthCache.set(key, fetchText(path, { optional: true, fresh }).then(text => {
      const { rows } = parseCsv(text);
      if (series === "weekly") {
        return rows.map(r => ({ updated: parseUtc(r[0]), start: parseUtc(r[1]), mw: Number(r[2]) }));
      }
      const map = new Map();
      for (const r of rows) {
        const mw = Number(r[1]);
        if (mw >= 15000) map.set(parseUtc(r[0]), mw);
      }
      return map;
    }));
  }
  return monthCache.get(key);
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

/** Values of a 15/30-minute series between two Paris dates (to inclusive): Map(ms -> mw). */
export async function getRange(series, fromDate, toDate) {
  const from = parisMidnight(fromDate);
  const toExclusive = parisMidnight(nextDate(toDate));
  const maps = await Promise.all(monthsBetween(from, toExclusive).map(ym => getMonth(series, ym)));
  const out = new Map();
  for (const map of maps) {
    for (const [ms, mw] of map) if (ms >= from && ms < toExclusive) out.set(ms, mw);
  }
  return out;
}

function nextDate(date) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return t.toISOString().slice(0, 10);
}

/** Merge the live latest.json actuals/ID into maps (they can be newer than the archive). */
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

export { QUARTER, wall };
