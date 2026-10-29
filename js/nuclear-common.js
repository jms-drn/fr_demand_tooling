// Shared pieces for the nuclear pages: labels, colours, durations.

import { DAY, HOUR, addDays, alignDate, dateKey, fmtDayTime, fmtLongDate, fmtNumber, parisMidnight } from "./util.js";

export const REASONS = {
  FAILURE: "Failure",
  FORESEEN_MAINTENANCE: "Planned maintenance",
  SHUTDOWN: "Shutdown",
  COMPLEMENTARY_INFORMATION: "Other (see remark)"
};

/** Reason for a notice; EDF often files "complementary information" with the real reason in the remark. */
export function reasonLabel(code, remark = "") {
  if (code === "COMPLEMENTARY_INFORMATION" && remark && remark.length <= 48) return remark.replace(/\.$/, "");
  return REASONS[code] || (code || "").replace(/_/g, " ").toLowerCase();
}

/** "30 Jan 14:00", with the year when it isn't the current one. */
export function fmtStamp(ms) {
  if (ms == null) return "–";
  const sameYear = dateKey(ms).slice(0, 4) === dateKey(Date.now()).slice(0, 4);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", day: "numeric", month: "short", year: sameYear ? undefined : "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms).replace(",", "");
}

/** Status colours (CSS variables, defined in style.css for both themes). */
export const STATE_COLOUR = {
  online: "--st-online",
  reduced: "--st-reduced",
  planned: "--st-planned",
  unplanned: "--st-unplanned"
};

export const SEQ = ["--seq-1", "--seq-2", "--seq-3", "--seq-4", "--seq-5"];

/** Buckets for "offline for" / "back in" colouring, in days. */
export const DURATION_BUCKETS = [
  { max: 7, label: "Under a week" },
  { max: 30, label: "1–4 weeks" },
  { max: 91, label: "1–3 months" },
  { max: 182, label: "3–6 months" },
  { max: Infinity, label: "6 months or more" }
];

export function bucketOf(days) {
  return DURATION_BUCKETS.findIndex(b => days < b.max);
}

/** "3 days", "5 weeks", "4 months". */
export function fmtDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return "–";
  const days = ms / DAY;
  if (days < 1) return `${Math.max(1, Math.round(ms / HOUR))} h`;
  if (days < 14) return `${fmtNumber(days, days < 3 ? 1 : 0)} days`;
  if (days < 70) return `${Math.round(days / 7)} weeks`;
  if (days < 730) return `${fmtNumber(days / 30.44, 0)} months`;
  return `${fmtNumber(days / 365.25, 1)} years`;
}

export function fmtDays(ms) {
  return ms == null ? "–" : `${fmtNumber(ms / DAY, ms / DAY < 10 ? 1 : 0)} d`;
}

/** Same Paris wall-clock moment k years earlier (null on 29 Feb). */
export function shiftMsYears(ms, k) {
  const date = dateKey(ms);
  const src = alignDate(date, k, "cal");
  if (!src) return null;
  return parisMidnight(src) + (ms - parisMidnight(date));
}

export function fmtWhen(ms) {
  return ms == null ? "unknown" : fmtDayTime(ms);
}

export function fmtDateOnly(ms) {
  return ms == null ? "–" : fmtLongDate(dateKey(ms));
}

/** Notice type of a unit's main notice: planned / unplanned. */
export function stateKey(unit) {
  if (unit.state === "online") return "online";
  if (unit.state === "reduced") return "reduced";
  return unit.unplanned_off_mw > unit.planned_off_mw ? "unplanned" : "planned";
}

export function siteSort(a, b) {
  return a.site === b.site ? a.name.localeCompare(b.name, "en", { numeric: true }) : a.site.localeCompare(b.site);
}

export { addDays };

/** Red and yellow diagonal stripes (unplanned outages), as an ECharts fill pattern. */
export function stripePattern(red, yellow, size = 8) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = red;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = yellow;
  ctx.lineWidth = size / 4;
  ctx.beginPath();
  for (let k = -size; k <= size * 2; k += size / 2) {
    ctx.moveTo(k, 0);
    ctx.lineTo(k - size, size);
  }
  ctx.stroke();
  return { image: canvas, repeat: "repeat" };
}

/** An on/off switch between two labels (left = off, right = on). */
export function switchHtml(attr, left, right) {
  return `<button type="button" class="switch" role="switch" ${attr} aria-checked="false"><span data-left>${left}</span><span class="track" aria-hidden="true"></span><span data-right>${right}</span></button>`;
}

export function setSwitch(button, on) {
  button.setAttribute("aria-checked", on);
  button.querySelector("[data-left]").classList.toggle("on", !on);
  button.querySelector("[data-right]").classList.toggle("on", on);
}
