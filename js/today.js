// Today: actual demand against RTE's intraday, D-1 and D-2 forecasts, with
// optional same-weekday references from earlier years.

import { ChartPanel } from "./chart.js";
import { getLatest, getRange, latestSeries } from "./data.js";
import {
  HOUR, QUARTER, addDays, copyText, csvDateTime, dateKey, fmtDate, fmtDateTime, fmtGW, fmtNumber, fmtPeriod,
  fmtSignedGW, fmtTime, heroHtml, parisMidnight, timeKey, writeHash
} from "./util.js";

export class Today {
  constructor(root) {
    this.root = root;
    this.state = { ly: "1", avg: "0", id: "1", d1: "1", d2: "1" };
    this.build();
  }

  setParams(params) {
    for (const key of Object.keys(this.state)) if (params.has(key)) this.state[key] = params.get(key);
    this.syncControls();
  }

  chip(key, label, colour) {
    return `<button class="chip" type="button" data-chip="${key}" style="color:var(${colour})"><span class="swatch"></span><span class="chip-label">${label}</span></button>`;
  }

  build() {
    this.root.innerHTML = `
      ${heroHtml("Power demand,", "at a glance.", "Realised French electricity demand against RTE's intraday, day-ahead and two-day-ahead forecasts.")}
      <div class="toolbar" role="group" aria-label="Today settings">
        <div class="toolbar-row">
          <div class="field"><span>Forecasts</span>
            <div class="chips">${this.chip("id", "Intraday", "--s-id")}${this.chip("d1", "D-1", "--s-d1")}${this.chip("d2", "D-2", "--s-d2")}</div>
          </div>
          <div class="field"><span>Compare with</span>
            <div class="chips">${this.chip("ly", "Same weekday last year", "--s-ly")}${this.chip("avg", "Same weekday, 3-year average", "--s-avg")}</div>
          </div>
        </div>
      </div>
      <div class="headline"><p data-headline>Loading…</p><button class="btn ghost small" type="button" data-copy title="Copy this sentence">Copy</button></div>
      <div class="cards" data-cards>${'<div class="card skeleton"></div>'.repeat(6)}</div>
      <div data-main></div>
      <div data-errors></div>`;

    this.headline = this.root.querySelector("[data-headline]");
    this.cards = this.root.querySelector("[data-cards]");
    this.main = new ChartPanel(this.root.querySelector("[data-main]"), { title: "Demand and forecasts", size: "tall" });
    this.errors = new ChartPanel(this.root.querySelector("[data-errors]"), { title: "Forecast minus actual, today", size: "short" });
    this.root.querySelector("[data-copy]").addEventListener("click", () => copyText(this.headline.textContent));

    this.root.querySelectorAll("[data-chip]").forEach(chip => {
      chip.addEventListener("click", () => {
        const key = chip.dataset.chip;
        this.state[key] = this.state[key] === "1" ? "0" : "1";
        this.syncControls();
        this.update();
      });
    });
    this.syncControls();
  }

  syncControls() {
    this.root.querySelectorAll("[data-chip]").forEach(chip => chip.setAttribute("aria-pressed", this.state[chip.dataset.chip] === "1"));
  }

  activate() {
    this.update();
  }

  /** Weekday-aligned reference: actuals k×364 days earlier, mapped onto these days. */
  async reference(day, days, k) {
    const src = addDays(day, -364 * k);
    const map = await getRange("realised", src, addDays(src, days - 1));
    const byKey = new Map([...map].map(([ms, mw]) => [`${dateKey(ms)} ${timeKey(ms)}`, mw]));
    const out = new Map();
    for (let x = parisMidnight(day); x < parisMidnight(addDays(day, days)); x += QUARTER) {
      const v = byKey.get(`${addDays(dateKey(x), -364 * k)} ${timeKey(x)}`);
      if (v != null) out.set(x, v);
    }
    return out;
  }

  async update() {
    writeHash("demand/today", this.state);
    this.main.setLoading(true);
    try {
      const latest = await getLatest();
      const live = latestSeries(latest, "REALISED");
      const lastLive = Math.max(...live.keys());
      const day = Number.isFinite(lastLive) ? dateKey(lastLive) : dateKey(Date.now());
      const end = addDays(day, 2);

      const [archActual, archD1, archD2, ly, ...years] = await Promise.all([
        getRange("realised", day, day),
        getRange("d1", day, end),
        getRange("d2", day, end),
        this.state.ly === "1" ? this.reference(day, 3, 1) : null,
        ...(this.state.avg === "1" ? [1, 2, 3].map(k => this.reference(day, 3, k)) : [])
      ]);

      const actual = new Map([...archActual, ...live]);
      const id = latestSeries(latest, "ID");
      const d1 = new Map([...archD1, ...latestSeries(latest, "D-1")]);
      const d2 = new Map([...archD2, ...latestSeries(latest, "D-2")]);

      this.renderMain(day, { actual, id, d1, d2, ly, years });
      this.renderErrors({ actual, id, d1 });
      this.renderSummary(day, { actual, d1, d2, ly });
    } catch (error) {
      console.error(error);
      this.headline.textContent = `The latest data could not be loaded (${error.message}).`;
      this.main.setLoading(false);
    }
  }

  renderMain(day, { actual, id, d1, d2, ly, years }) {
    const pts = map => [...map].sort((a, b) => a[0] - b[0]).map(([x, v]) => [x, v / 1000]);
    const series = [];

    if (years.length) {
      const avg = new Map();
      for (const x of new Set(years.flatMap(m => [...m.keys()]))) {
        const vs = years.map(m => m.get(x)).filter(v => v != null);
        if (vs.length) avg.set(x, vs.reduce((a, b) => a + b, 0) / vs.length);
      }
      series.push({ name: "Same weekday, 3-year average", colour: "--s-avg", type: "line", data: pts(avg), dashed: true, width: 1.5, unit: "GW" });
    }
    if (ly) series.push({ name: "Same weekday last year", colour: "--s-ly", type: "line", data: pts(ly), width: 1.4, unit: "GW" });
    if (this.state.d2 === "1") series.push({ name: "D-2 forecast", colour: "--s-d2", type: "line", data: pts(d2), width: 1.6, unit: "GW" });
    if (this.state.d1 === "1") series.push({ name: "D-1 forecast", colour: "--s-d1", type: "line", data: pts(d1), width: 1.6, unit: "GW" });
    if (this.state.id === "1") series.push({ name: "Intraday forecast", colour: "--s-id", type: "line", data: pts(id), dashed: true, width: 1.6, unit: "GW" });
    series.push({ name: "Actual", colour: "--s-actual", type: "line", data: pts(actual), width: 3.2, unit: "GW", z: 20 });

    const start = parisMidnight(day);
    this.main.setTitle("Demand and forecasts", `${fmtPeriod(day, addDays(day, 2))} · GW`);
    this.main.render({
      xType: "time", xLabel: x => fmtDateTime(x), csvLabel: csvDateTime, yName: "GW", series,
      xMin: start, xMax: parisMidnight(addDays(day, 3)),
      markAreas: [{ from: start, to: parisMidnight(addDays(day, 1)), label: "Today", colour: "--today" }],
      notes: [
        "Intraday covers today only; D-1 is RTE's forecast for tomorrow and D-2 for the day after. Earlier D-1 and D-2 values for today come from the archive.",
        "Same-weekday references are 364, 728 and 1,092 days earlier, matched on Paris local time."
      ]
    });
  }

  renderErrors({ actual, id, d1 }) {
    const diff = map => [...actual].filter(([x]) => map.has(x)).sort((a, b) => a[0] - b[0]).map(([x, v]) => [x, (map.get(x) - v) / 1000]);
    const format = v => fmtSignedGW(v * 1000);
    const series = [];
    if (this.state.id === "1") series.push({ name: "Intraday minus actual", colour: "--s-id", type: "bar", data: diff(id), unit: "GW", format });
    if (this.state.d1 === "1") series.push({ name: "D-1 minus actual", colour: "--s-d1", type: "line", data: diff(d1), width: 2, unit: "GW", format });

    this.errors.setTitle("Forecast minus actual, today", "Positive = forecast above actual demand · GW");
    this.errors.render({
      xType: "time", xLabel: x => fmtDateTime(x), csvLabel: csvDateTime, yName: "GW", yFormat: v => fmtNumber(v, 1), series, zeroLine: true,
      notes: ["The intraday forecast is revised through the day, so its errors for past intervals are usually small."]
    });
  }

  renderSummary(day, { actual, d1, d2, ly }) {
    const today = [...actual].filter(([x]) => dateKey(x) === day).sort((a, b) => a[0] - b[0]);
    if (!today.length) { this.headline.textContent = "No actual data published yet today."; return; }

    const [lastX, lastV] = today[today.length - 1];
    const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    const curMean = mean(today.map(p => p[1]));
    const peak = today.reduce((a, p) => (p[1] > a[1] ? p : a));
    const low = today.reduce((a, p) => (p[1] < a[1] ? p : a));
    const vsMap = map => {
      const pairs = today.filter(([x]) => map?.has(x));
      return pairs.length ? (mean(pairs.map(p => p[1])) / mean(pairs.map(([x]) => map.get(x))) - 1) * 100 : null;
    };
    const vsD1 = vsMap(d1);
    const vsLy = vsMap(ly);
    const peakOf = (map, date) => {
      const p = [...map].filter(([x]) => dateKey(x) === date);
      return p.length ? p.reduce((a, b) => (b[1] > a[1] ? b : a)) : null;
    };
    const d1Peak = peakOf(d1, addDays(day, 1));
    const d2Peak = peakOf(d2, addDays(day, 2));
    const d1Now = d1.get(lastX);

    const parts = [];
    if (vsD1 != null) parts.push(`${fmtNumber(Math.abs(vsD1), 1)}% ${vsD1 >= 0 ? "above" : "below"} RTE's D-1 forecast for the same hours`);
    if (vsLy != null) parts.push(`${fmtNumber(Math.abs(vsLy), 1)}% ${vsLy >= 0 ? "above" : "below"} the same weekday last year`);
    this.headline.textContent = `So far on ${fmtDate(parisMidnight(day) + 12 * HOUR)}, French demand has averaged ${fmtGW(curMean)}${parts.length ? `, ${parts.join(" and ")}` : ""}.`;

    const card = (label, value, detail = "", cls = "") =>
      `<div class="card${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="detail">${detail}</div></div>`;
    this.cards.innerHTML = [
      card("Latest actual", fmtGW(lastV), `${fmtTime(lastX)}–${fmtTime(lastX + QUARTER)} Paris time`, " accent"),
      card("D-1 forecast, same interval", fmtGW(d1Now), d1Now != null ? `Forecast minus actual ${fmtSignedGW(d1Now - lastV)}` : "Not available"),
      card("Today's peak so far", fmtGW(peak[1]), `at ${fmtTime(peak[0])}`),
      card("Today's minimum", fmtGW(low[1]), `at ${fmtTime(low[0])}`),
      card("Tomorrow's peak (D-1)", d1Peak ? fmtGW(d1Peak[1]) : "–", d1Peak ? `${fmtDate(d1Peak[0])} at ${fmtTime(d1Peak[0])}` : "Published around 19:30 Paris time"),
      card("Day-after peak (D-2)", d2Peak ? fmtGW(d2Peak[1]) : "–", d2Peak ? `${fmtDate(d2Peak[0])} at ${fmtTime(d2Peak[0])}` : "")
    ].join("");
  }

  refreshTheme() {
    this.main.refreshTheme();
    this.errors.refreshTheme();
  }
}
