// Overview: one tile per dataset with the latest figure, the key comparison
// and a small trend chart, plus a copyable list of the main points.

import { getDaily, getLatest, getRange, latestSeries } from "./data.js";
import { RESERVOIR_CAPACITY_MWH, isoWeek } from "./hydro.js";
import { getLive, getNuclearDaily, getReserves } from "./power-data.js";
import { parseUtc } from "./data.js";
import {
  QUARTER, addDays, alignDate, copyText, cssVar, dateKey, fmtDayTime, fmtGW, fmtLongDate, fmtNumber, fmtShortDate,
  fmtTime, heroHtml, mean, todayParis
} from "./util.js";

const ICONS = {
  demand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13h3.5l2.5-6 4 11 2.8-7H21"/></svg>',
  nuclear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="1.7"/><ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)"/></svg>',
  hydro: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2c3.3 4.2 6 7.6 6 10.8a6 6 0 0 1-12 0c0-3.2 2.7-6.6 6-10.8Z"/></svg>',
  prices: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 6.5A6.5 6.5 0 1 0 17.5 17.5"/><path d="M4.5 10.5h9M4.5 13.5h9"/></svg>',
  generation: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2.5 5 13.5h6l-1 8 8-11h-6l1-8Z"/></svg>'
};

/** Small SVG trend line: series = [{ values: [[x, y]], colour, dashed?, width? }]. */
function sparkline(series, { band } = {}) {
  const all = series.flatMap(s => s.values).concat(band ? band.flatMap(b => [[b[0], b[1]], [b[0], b[2]]]) : []);
  if (!all.length) return "";
  const xs = all.map(p => p[0]);
  const ys = all.map(p => p[1]);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const pad = (y1 - y0) * 0.12 || 1;
  y0 -= pad; y1 += pad;
  const W = 300; const H = 70;
  const sx = x => ((x - x0) / (x1 - x0 || 1)) * W;
  const sy = y => H - ((y - y0) / (y1 - y0)) * H;
  const path = values => values.map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join("");
  const bandPath = band?.length ? `${band.map((b, i) => `${i ? "L" : "M"}${sx(b[0]).toFixed(1)},${sy(b[2]).toFixed(1)}`).join("")}${[...band].reverse().map(b => `L${sx(b[0]).toFixed(1)},${sy(b[1]).toFixed(1)}`).join("")}Z` : "";
  return `<svg class="tile-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    ${bandPath ? `<path d="${bandPath}" fill="${cssVar("--s-band")}" stroke="none"/>` : ""}
    ${series.map(s => `<path d="${path(s.values)}" fill="none" stroke="${cssVar(s.colour)}" stroke-width="${s.width || 2}" vector-effect="non-scaling-stroke" ${s.dashed ? 'stroke-dasharray="5 4"' : ""} stroke-linejoin="round" stroke-linecap="round"/>`).join("")}
  </svg>`;
}

const dir = (v, up = "up", down = "down") => (v >= 0 ? up : down);

export class Overview {
  constructor(root) {
    this.root = root;
    this.root.innerHTML = `
      ${heroHtml("France's power system,", "at a glance.", "The latest from RTE's data on French electricity demand, nuclear availability and hydro reservoirs, each against earlier years. Open a tile for the full page with charts, comparisons and downloads. Prices and generation are on the way.")}
      <div class="tiles" data-tiles>${'<div class="tile skeleton"></div>'.repeat(3)}</div>
      <div class="tiles soon-row" data-soon></div>
      <section class="brief">
        <h2>Main points <button class="btn ghost small" type="button" data-copy>Copy all</button></h2>
        <ul data-points><li class="muted">Loading…</li></ul>
      </section>`;
    this.tiles = this.root.querySelector("[data-tiles]");
    this.soon = this.root.querySelector("[data-soon]");
    this.points = this.root.querySelector("[data-points]");
    this.root.querySelector("[data-copy]").addEventListener("click", () =>
      copyText([...this.points.querySelectorAll("li")].map(li => `• ${li.textContent}`).join("\n")));
  }

  activate() {
    this.update();
  }

  async update() {
    const results = await Promise.allSettled([this.demand(), this.nuclear(), this.hydro()]);
    const tiles = results.map((r, i) => (r.status === "fulfilled" ? r.value : {
      html: this.tile(["demand", "nuclear", "hydro"][i], ["Demand", "Nuclear availability", "Hydro reserves"][i], "#", "–", "", [`<span class="muted">Couldn't load (${r.reason?.message || "error"})</span>`], ""),
      points: []
    }));
    this.tiles.innerHTML = tiles.map(t => t.html).join("");
    this.soon.innerHTML = `
      <div class="tile soon">
        <div class="tile-head"><span class="tile-title">${ICONS.prices}Prices</span><span class="tile-go">Coming soon</span></div>
        <div class="tile-lines"><span>Day-ahead spot prices for France and neighbouring markets.</span></div>
      </div>
      <div class="tile soon">
        <div class="tile-head"><span class="tile-title">${ICONS.generation}Generation</span><span class="tile-go">Coming soon</span></div>
        <div class="tile-lines"><span>Output by fuel, renewables and exports.</span></div>
      </div>`;
    const points = tiles.flatMap(t => t.points);
    this.points.innerHTML = points.length ? points.map(p => `<li>${p}</li>`).join("") : `<li class="muted">No data available.</li>`;
  }

  tile(key, title, href, value, small, lines, spark) {
    return `<a class="tile" href="${href}">
      <div class="tile-head"><span class="tile-title">${ICONS[key]}${title}</span><span class="tile-go">Open →</span></div>
      <div class="tile-value">${value}${small ? `<small>${small}</small>` : ""}</div>
      <div class="tile-lines">${lines.map(l => `<span>${l}</span>`).join("")}</div>
      ${spark}
    </a>`;
  }

  async demand() {
    const [latest, daily] = await Promise.all([getLatest(), getDaily()]);
    let realised = [...latestSeries(latest, "REALISED")].sort((a, b) => a[0] - b[0]);
    if (!realised.length) {
      // Just after midnight the live feed has no values for the new day yet.
      realised = [...(await getRange("realised", addDays(todayParis(), -1), todayParis()))].sort((a, b) => a[0] - b[0]);
    }
    const last = realised.at(-1);
    const today = todayParis();
    const monthStart = `${today.slice(0, 7)}-01`;
    const lastFull = addDays(today, -1);
    const days = [];
    for (let d = monthStart; d <= lastFull; d = addDays(d, 1)) days.push(d);
    const mtd = mean(days.map(d => daily.byDate.get(d)?.mean_mw));
    const prev = mean([1, 2, 3].map(k => mean(days.map(d => daily.byDate.get(alignDate(d, k, "cal"))?.mean_mw))));
    const pct = mtd != null && prev ? (mtd / prev - 1) * 100 : null;
    const spark = [];
    const lyLine = [];
    for (let i = 59; i >= 1; i--) {
      const d = addDays(today, -i);
      const v = daily.byDate.get(d)?.mean_mw;
      if (v != null) spark.push([i * -1, v / 1000]);
      const l = daily.byDate.get(alignDate(d, 1, "cal"))?.mean_mw;
      if (l != null) lyLine.push([i * -1, l / 1000]);
    }
    const lines = [];
    if (last) lines.push(`Latest: ${fmtTime(last[0])}–${fmtTime(last[0] + QUARTER)} Paris time`);
    if (pct != null) lines.push(`Month to date ${fmtGW(mtd)}, <b class="${dir(pct)}">${pct >= 0 ? "+" : "−"}${fmtNumber(Math.abs(pct), 1)}%</b> vs the 3-year average`);
    lines.push(`<span class="muted">Last 60 days, daily average · last year dashed</span>`);
    const points = [];
    if (last) points.push(`Demand was ${fmtGW(last[1])} at ${fmtTime(last[0])} Paris time.`);
    if (pct != null) points.push(`Demand so far in ${new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "Europe/Paris" }).format(Date.now())} (to ${fmtShortDate(lastFull)}) averages ${fmtGW(mtd)}, ${fmtNumber(Math.abs(pct), 1)}% ${pct >= 0 ? "above" : "below"} the average of the same dates in the previous three years.`);
    return {
      html: this.tile("demand", "Demand", "#demand/today", last ? fmtGW(last[1]) : "–", "now", lines,
        sparkline([{ values: lyLine, colour: "--s-ly", dashed: true, width: 1.4 }, { values: spark, colour: "--s-actual" }])),
      points
    };
  }

  async nuclear() {
    const [live, daily] = await Promise.all([getLive(), getNuclearDaily()]);
    const f = live.fleet;
    const now = parseUtc(live.generated_utc);
    const offline = live.units.filter(u => u.state === "offline").length;
    const today = todayParis();
    const todayRow = daily.byDate.get(today);
    const lyRow = daily.byDate.get(alignDate(today, 1, "cal"));
    const past = [];
    const ly = [];
    for (let i = 89; i >= 0; i--) {
      const d = addDays(today, -i);
      const v = daily.byDate.get(d)?.available_mw;
      if (v != null) past.push([-i, v / 1000]);
      const l = daily.byDate.get(alignDate(d, 1, "cal"))?.available_mw;
      if (l != null) ly.push([-i, l / 1000]);
    }
    const ahead = live.outlook.mw10.split(" ").slice(0, 60).map((v, i) => [i + 1, Number(v) / 100]);
    for (let i = 1; i <= 60; i++) {
      const l = daily.byDate.get(alignDate(addDays(today, i), 1, "cal"))?.available_mw;
      if (l != null) ly.push([i, l / 1000]);
    }
    const next30 = mean(ahead.slice(0, 30).map(p => p[1] * 1000));
    const ly30 = mean(Array.from({ length: 30 }, (_, i) => daily.byDate.get(alignDate(addDays(today, i + 1), 1, "cal"))?.available_mw));
    const diff = todayRow && lyRow ? todayRow.available_mw - lyRow.available_mw : null;
    const lines = [
      `${fmtNumber(100 * f.available_mw / f.installed_mw, 0)}% of ${fmtGW(f.installed_mw)} · ${offline} reactors offline`,
      diff != null ? `Today <b class="${dir(diff)}">${diff >= 0 ? "+" : "−"}${fmtNumber(Math.abs(diff) / 1000, 1)} GW</b> vs the same day last year` : "",
      `<span class="muted">Past 90 days and next 60 (dashed, from notices) · last year thin</span>`
    ].filter(Boolean);
    const points = [`Nuclear availability is ${fmtGW(f.available_mw)} (${fmtNumber(100 * f.available_mw / f.installed_mw, 0)}% of installed capacity) at ${fmtTime(now)}, with ${offline} reactors offline.`];
    if (diff != null) points.push(`Today's average nuclear availability of ${fmtGW(todayRow.available_mw)} is ${fmtGW(Math.abs(diff))} ${diff >= 0 ? "higher" : "lower"} than on the same day last year.`);
    if (next30 != null && ly30 != null) points.push(`Notices published so far point to ${fmtGW(next30)} available on average over the next 30 days, against ${fmtGW(ly30)} in the same period last year.`);
    const delays = (live.changes || []).filter(c => c.version > 1 && c.prev_end_utc && parseUtc(c.end_utc) - parseUtc(c.prev_end_utc) > 3600000);
    if (delays.length) points.push(`${delays.length} notice${delays.length === 1 ? "" : "s"} pushed back a return date in the past 72 hours (latest: ${delays[0].unit.replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase())}, ${fmtDayTime(parseUtc(delays[0].published_utc))}).`);
    return {
      html: this.tile("nuclear", "Nuclear availability", "#nuclear/today", fmtGW(f.available_mw), "available", lines,
        sparkline([{ values: ly, colour: "--s-ly", width: 1.2 }, { values: past, colour: "--s-actual" }, { values: [past.at(-1), ...ahead].filter(Boolean), colour: "--s-fcst", dashed: true }])),
      points
    };
  }

  async hydro() {
    const rows = await getReserves();
    const r = rows.at(-1);
    const [iy, w] = isoWeek(r.start);
    const same = rows.filter(x => isoWeek(x.start)[1] === w && isoWeek(x.start)[0] < iy && isoWeek(x.start)[0] >= iy - 5).map(x => x.mwh);
    const avg5 = mean(same);
    const ly = rows.find(x => isoWeek(x.start)[0] === iy - 1 && isoWeek(x.start)[1] === w);
    const pct = avg5 ? (r.mwh / avg5 - 1) * 100 : null;
    const year = rows.filter(x => isoWeek(x.start)[0] === iy).map(x => [isoWeek(x.start)[1], x.mwh / 1e6]);
    const band = [];
    for (let k = 1; k <= 53; k++) {
      const vals = rows.filter(x => isoWeek(x.start)[1] === k && isoWeek(x.start)[0] < iy && isoWeek(x.start)[0] >= iy - 5).map(x => x.mwh / 1e6);
      if (vals.length >= 2) band.push([k, Math.min(...vals), Math.max(...vals)]);
    }
    const lines = [
      `${fmtNumber(100 * r.mwh / RESERVOIR_CAPACITY_MWH, 1)}% full · week ${w}, to ${fmtShortDate(addDays(r.end, -1))}`,
      pct != null ? `<b class="${dir(pct)}">${pct >= 0 ? "+" : "−"}${fmtNumber(Math.abs(pct), 1)}%</b> vs the 5-year average for this week` : "",
      `<span class="muted">${iy} by week, against the range of the previous 5 years</span>`
    ].filter(Boolean);
    const points = [`Hydro reservoirs held ${fmtNumber(r.mwh / 1e6, 2)} TWh (${fmtNumber(100 * r.mwh / RESERVOIR_CAPACITY_MWH, 1)}% full) in the week to ${fmtLongDate(addDays(r.end, -1))}${pct != null ? `, ${fmtNumber(Math.abs(pct), 1)}% ${pct >= 0 ? "above" : "below"} the five-year average for the week` : ""}${ly ? ` and ${fmtNumber(Math.abs((r.mwh / ly.mwh - 1) * 100), 1)}% ${r.mwh >= ly.mwh ? "above" : "below"} last year` : ""}.`];
    return {
      html: this.tile("hydro", "Hydro reserves", "#hydro", `${fmtNumber(r.mwh / 1e6, 2)} TWh`, "stored", lines,
        sparkline([{ values: year, colour: "--s-actual" }], { band })),
      points
    };
  }

  refreshTheme() {
    this.update();
  }
}

