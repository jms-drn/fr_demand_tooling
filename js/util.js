// Shared helpers: Paris time, formatting, French public holidays, URL state,
// downloads and small DOM helpers.

export const HOUR = 3600000;
export const DAY = 86400000;
export const QUARTER = 900000;

// ---------- Paris time ----------
// France switches to summer time at 01:00 UTC on the last Sunday of March
// and back at 01:00 UTC on the last Sunday of October. Computing the offset
// directly is much faster than Intl for hundreds of thousands of points.

const dstCache = new Map();

function lastSunday(year, monthIndex) {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  return last.getUTCDate() - last.getUTCDay();
}

function dstBounds(year) {
  if (!dstCache.has(year)) {
    dstCache.set(year, [
      Date.UTC(year, 2, lastSunday(year, 2), 1),
      Date.UTC(year, 9, lastSunday(year, 9), 1)
    ]);
  }
  return dstCache.get(year);
}

export function parisOffset(ms) {
  const [start, end] = dstBounds(new Date(ms).getUTCFullYear());
  return ms >= start && ms < end ? 2 * HOUR : HOUR;
}

/** Paris wall-clock time expressed as if it were UTC (used for chart axes). */
export function toWall(ms) {
  return ms + parisOffset(ms);
}

/** Inverse of toWall (the repeated October hour maps to its first occurrence). */
export function fromWall(wallMs) {
  const candidate = wallMs - HOUR;
  return parisOffset(candidate) === HOUR ? candidate : wallMs - 2 * HOUR;
}

/** A Date whose getUTC* fields read as Paris wall-clock time. */
export function wall(ms) {
  return new Date(toWall(ms));
}

const pad = n => String(n).padStart(2, "0");

export function dateKey(ms) {
  const d = wall(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function timeKey(ms) {
  const d = wall(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function monthKey(ms) {
  const d = wall(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** Epoch ms of 00:00 Paris time on a YYYY-MM-DD date. */
export function parisMidnight(date) {
  const [y, m, d] = date.split("-").map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d);
  return utcMidnight - parisOffset(utcMidnight - HOUR);
}

export function addDays(date, days) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function daysBetween(from, to) {
  const [a, b] = [from, to].map(s => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.round((b - a) / DAY);
}

export function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function todayParis() {
  return dateKey(Date.now());
}

export function weekdayIndex(date) {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday = 0
}

export function weekStart(date) {
  return addDays(date, -weekdayIndex(date));
}

export function hoursInDay(date) {
  return (parisMidnight(addDays(date, 1)) - parisMidnight(date)) / HOUR;
}

export function isLeapDay(date) {
  return date.slice(5) === "02-29";
}

/** Same calendar date k years earlier, or null for 29 Feb in a non-leap year. */
export function shiftYears(date, years) {
  const y = Number(date.slice(0, 4)) - years;
  const shifted = `${y}${date.slice(4)}`;
  if (isLeapDay(date)) {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return leap ? shifted : null;
  }
  return shifted;
}

/** The comparison date for alignment "cal" (same date) or "wd" (364 days per year, same weekday). */
export function alignDate(date, years, align) {
  return align === "wd" ? addDays(date, -364 * years) : shiftYears(date, years);
}

// ---------- Formatting ----------

const fmtCache = {};

function fmt(options) {
  const key = JSON.stringify(options);
  if (!fmtCache[key]) fmtCache[key] = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", ...options });
  return fmtCache[key];
}

export const fmtDate = ms => fmt({ weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(ms);
export const fmtDateShort = ms => fmt({ day: "numeric", month: "short" }).format(ms);
export const fmtMonth = ms => fmt({ month: "short", year: "numeric" }).format(ms);
export const fmtDateTime = ms => fmt({ weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
export const fmtTime = ms => fmt({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
export const fmtDayTime = ms => fmt({ day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);

/** Axis tick label for a time axis: date at midnight, time otherwise. */
export function fmtTick(ms) {
  if (timeKey(ms) !== "00:00") return fmtTime(ms);
  const date = dateKey(ms);
  if (date.endsWith("-01-01")) return date.slice(0, 4);
  if (date.endsWith("-01")) return fmtMonth(ms + 12 * HOUR);
  return fmtDateShort(ms);
}

export function fmtLongDate(date) {
  return fmt({ day: "numeric", month: "short", year: "numeric" }).format(parisMidnight(date) + 12 * HOUR);
}

export function fmtShortDate(date) {
  return fmt({ day: "numeric", month: "short" }).format(parisMidnight(date) + 12 * HOUR);
}

export function fmtPeriod(from, to) {
  if (from === to) return fmtLongDate(from);
  if (from.slice(0, 4) === to.slice(0, 4)) return `${fmtShortDate(from)} – ${fmtLongDate(to)}`;
  return `${fmtLongDate(from)} – ${fmtLongDate(to)}`;
}

/** "1 Oct to 29 Oct 2026" for use in sentences. */
export function fmtFromTo(from, to) {
  if (from === to) return `on ${fmtLongDate(from)}`;
  const first = from.slice(0, 4) === to.slice(0, 4) ? fmtShortDate(from) : fmtLongDate(from);
  return `from ${first} to ${fmtLongDate(to)}`;
}

export function fmtNumber(value, decimals = 1) {
  if (value == null || !Number.isFinite(value)) return "–";
  return value.toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtGW(mw, decimals = 1) {
  return mw == null || !Number.isFinite(mw) ? "–" : `${fmtNumber(mw / 1000, decimals)} GW`;
}

export function fmtPct(value, decimals = 1, signed = true) {
  if (value == null || !Number.isFinite(value)) return "–";
  const sign = signed && value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${fmtNumber(Math.abs(value), decimals)}%`;
}

export function fmtSignedGW(mw, decimals = 2) {
  if (mw == null || !Number.isFinite(mw)) return "–";
  const sign = mw > 0 ? "+" : mw < 0 ? "−" : "";
  return `${sign}${fmtNumber(Math.abs(mw) / 1000, decimals)} GW`;
}

export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : null;
}

/** Spreadsheet-friendly Paris local timestamps for CSV files. */
export const csvDateTime = ms => `${dateKey(ms)} ${timeKey(ms)}`;
export const csvDate = ms => dateKey(ms + 12 * HOUR);

// ---------- French public holidays ----------

function easterSunday(year) {
  // Anonymous Gregorian algorithm.
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

const holidayCache = new Map();

/** Map of YYYY-MM-DD -> name for national public holidays in mainland France. */
export function holidays(year) {
  if (!holidayCache.has(year)) {
    const easter = easterSunday(year);
    holidayCache.set(year, new Map([
      [`${year}-01-01`, "New Year's Day"],
      [addDays(easter, 1), "Easter Monday"],
      [`${year}-05-01`, "Labour Day"],
      [`${year}-05-08`, "Victory in Europe Day"],
      [addDays(easter, 39), "Ascension Day"],
      [addDays(easter, 50), "Whit Monday"],
      [`${year}-07-14`, "Bastille Day"],
      [`${year}-08-15`, "Assumption Day"],
      [`${year}-11-01`, "All Saints' Day"],
      [`${year}-11-11`, "Armistice Day"],
      [`${year}-12-25`, "Christmas Day"]
    ]));
  }
  return holidayCache.get(year);
}

export function holidayName(date) {
  return holidays(Number(date.slice(0, 4))).get(date) || null;
}

// ---------- URL state ----------
// The address bar holds "#tab?key=value&…" so any view can be shared.

export function readHash() {
  const raw = location.hash.replace(/^#/, "");
  const [tab, query = ""] = raw.split("?");
  return { tab: tab || "today", params: new URLSearchParams(query) };
}

export function writeHash(tab, params) {
  const query = new URLSearchParams(params).toString();
  const hash = `#${tab}${query ? `?${query}` : ""}`;
  if (location.hash !== hash) history.replaceState(null, "", hash);
}

// ---------- Downloads, clipboard, DOM ----------

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCsv(headers, rows) {
  const escape = value => {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [headers, ...rows].map(row => row.map(escape).join(",")).join("\n");
}

export function slug(text) {
  return text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function el(tag, attrs = {}, html = "") {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  if (html) node.innerHTML = html;
  return node;
}

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

let toastTimer = null;

/** Small notification at the bottom of the screen. */
export function toast(message, { error = false } = {}) {
  let node = document.getElementById("toast");
  if (!node) {
    node = el("div", { id: "toast", role: "status", "aria-live": "polite" });
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.className = "toast"; }, 3200);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard");
  } catch (error) {
    toast("Your browser blocked copying. Select the text and copy it instead.", { error: true });
  }
}

/** A tab's title and one-line description. */
export function heroHtml(title, accent, description) {
  return `<div class="hero"><div><h1>${title} <span>${accent}</span></h1><p>${description}</p></div></div>`;
}
