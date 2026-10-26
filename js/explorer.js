// Explorer: actual demand for any period at 15-minute to monthly resolution,
// compared with the same period in earlier years, plus a daily-profile view.

import { ChartPanel } from "./chart.js";
import { getDaily, getRange } from "./data.js";
import {
  csvDate, csvDateTime, DAY, HOUR, QUARTER, addDays, alignDate, dateKey, dateRange, daysBetween, el, fmtDate, fmtDateTime,
  fmtDayTime, fmtGW, fmtLongDate, fmtMonth, fmtNumber, fmtPct, holidayName, parisMidnight, timeKey,
  todayParis, weekStart, writeHash
} from "./util.js";

const RES_LABEL = { "15m": "15-minute", "1h": "hourly", "1d": "daily", "1w": "weekly", "1M": "monthly" };
const MAX_15M_DAYS = 366;
const MAX_1H_DAYS = 1100;
const MAX_PROFILE_DAYS = 366;

function presetRange(preset, today) {
  const y = today.slice(0, 4);
  switch (preset) {
    case "mtd": return [`${today.slice(0, 7)}-01`, today];
    case "ytd": return [`${y}-01-01`, today];
    case "last7": return [addDays(today, -6), today];
    case "last30": return [addDays(today, -29), today];
    case "last365": return [addDays(today, -364), today];
    case "lastmonth": {
      const firstThis = `${today.slice(0, 7)}-01`;
      const lastPrev = addDays(firstThis, -1);
      return [`${lastPrev.slice(0, 7)}-01`, lastPrev];
    }
    case "lastyear": return [`${Number(y) - 1}-01-01`, `${Number(y) - 1}-12-31`];
    default: return null;
  }
}

function defaults() {
  const today = todayParis();
  const [from, to] = presetRange("mtd", today);
  return {
    preset: "mtd", from, to, res: "1d", measure: "mean",
    ly: "1", avg: "1", band: "0", n: "3", align: "cal",
    hol: "off", profile: "0", d1: "0", d2: "0"
  };
}

export class Explorer {
  constructor(root) {
    this.root = root;
    this.state = defaults();
    this.renderId = 0;
    this.build();
  }

  setParams(params) {
    const state = defaults();
    for (const key of Object.keys(state)) if (params.has(key)) state[key] = params.get(key);
    if (state.preset !== "custom") {
      const range = presetRange(state.preset, todayParis());
      if (range) [state.from, state.to] = range;
    }
    this.state = state;
    this.syncControls();
  }

  // ---------- UI ----------

  build() {
    this.root.innerHTML = `
      <div class="toolbar" role="group" aria-label="Explorer settings">
        <label class="field"><span>Period</span>
          <select data-k="preset">
            <option value="mtd">Month to date</option>
            <option value="lastmonth">Last month</option>
            <option value="last7">Last 7 days</option>
            <option value="last30">Last 30 days</option>
            <option value="ytd">Year to date</option>
            <option value="last365">Last 365 days</option>
            <option value="lastyear">Last calendar year</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label class="field"><span>From</span><input type="date" data-k="from" min="2012-12-17"></label>
        <label class="field"><span>To</span><input type="date" data-k="to" min="2012-12-17"></label>
        <label class="field"><span>Resolution</span>
          <select data-k="res">
            <option value="15m">15 minutes</option>
            <option value="1h">Hourly</option>
            <option value="1d">Daily</option>
            <option value="1w">Weekly</option>
            <option value="1M">Monthly</option>
          </select>
        </label>
        <label class="field"><span>Measure</span>
          <select data-k="measure">
            <option value="mean">Average (GW)</option>
            <option value="max">Peak (GW)</option>
            <option value="min">Minimum (GW)</option>
            <option value="energy">Energy</option>
          </select>
        </label>
        <span class="divider"></span>
        <div class="field"><span>Compare with</span>
          <div class="chips">
            <button class="chip" type="button" data-chip="ly" style="color:var(--s-ly)"><span class="swatch"></span><span style="color:var(--text-soft)">Last year</span></button>
            <button class="chip" type="button" data-chip="avg" style="color:var(--s-avg)"><span class="swatch"></span><span style="color:var(--text-soft)">Average of previous</span></button>
            <select data-k="n" aria-label="Number of previous years" style="height:32px">
              <option value="2">2 years</option><option value="3">3 years</option><option value="4">4 years</option><option value="5">5 years</option>
            </select>
            <button class="chip" type="button" data-chip="band" style="color:var(--s-avg)"><span class="swatch"></span><span style="color:var(--text-soft)">Min–max range</span></button>
          </div>
        </div>
        <label class="field"><span>Align by</span>
          <select data-k="align">
            <option value="cal">Calendar date</option>
            <option value="wd">Weekday</option>
          </select>
        </label>
        <label class="field"><span>Public holidays</span>
          <select data-k="hol">
            <option value="off">Ignore</option>
            <option value="mark">Mark</option>
            <option value="excl">Mark and exclude</option>
          </select>
        </label>
        <span class="divider"></span>
        <div class="field"><span>Forecasts</span>
          <div class="chips">
            <button class="chip" type="button" data-chip="d1" style="color:var(--s-d1)"><span class="swatch"></span><span style="color:var(--text-soft)">D-1</span></button>
            <button class="chip" type="button" data-chip="d2" style="color:var(--s-d2)"><span class="swatch"></span><span style="color:var(--text-soft)">D-2</span></button>
          </div>
        </div>
        <div class="field"><span>View</span>
          <div class="chips">
            <button class="chip" type="button" data-chip="profile" style="color:var(--accent)"><span class="swatch"></span><span style="color:var(--text-soft)">Daily profile</span></button>
          </div>
        </div>
      </div>
      <p class="headline" data-headline>Loading…</p>
      <div class="cards" data-cards></div>
      <div data-chart></div>`;

    this.headline = this.root.querySelector("[data-headline]");
    this.cards = this.root.querySelector("[data-cards]");
    this.panel = new ChartPanel(this.root.querySelector("[data-chart]"), { title: "Demand", size: "tall" });

    this.root.querySelectorAll("[data-k]").forEach(input => {
      input.addEventListener("change", () => {
        const key = input.dataset.k;
        this.state[key] = input.value;
        if (key === "preset" && input.value !== "custom") {
          [this.state.from, this.state.to] = presetRange(input.value, todayParis());
        }
        if (key === "from" || key === "to") this.state.preset = "custom";
        if (this.state.from > this.state.to) [this.state.from, this.state.to] = [this.state.to, this.state.from];
        this.syncControls();
        this.update();
      });
    });

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
    const s = this.state;
    this.root.querySelectorAll("[data-k]").forEach(input => { input.value = s[input.dataset.k]; });
    this.root.querySelectorAll("[data-chip]").forEach(chip => chip.setAttribute("aria-pressed", s[chip.dataset.chip] === "1"));
    const profile = s.profile === "1";
    this.root.querySelector('[data-k="measure"]').disabled = profile || ["15m", "1h"].includes(s.res);
    this.root.querySelector('[data-chip="d1"]').disabled = profile;
    this.root.querySelector('[data-chip="d2"]').disabled = profile;
    this.root.querySelector('[data-k="n"]').disabled = s.avg !== "1" && s.band !== "1";
    const today = todayParis();
    this.root.querySelector('[data-k="from"]').max = today;
    this.root.querySelector('[data-k="to"]').max = today;
  }

  activate() {
    this.update();
  }

  // ---------- Data ----------

  yearsNeeded() {
    const s = this.state;
    const n = Number(s.n);
    return Math.max(s.ly === "1" ? 1 : 0, s.avg === "1" || s.band === "1" ? n : 0);
  }

  excluded(date) {
    return this.state.hol === "excl" && holidayName(date) !== null;
  }

  /** Load an aligned comparison year as Map("YYYY-MM-DD HH:MM" Paris -> MW). */
  async comparisonLookup(k) {
    const { from, to, align } = this.state;
    const start = alignDate(from, k, align) ?? alignDate(addDays(from, 1), k, align);
    const end = alignDate(to, k, align) ?? alignDate(addDays(to, -1), k, align);
    const map = await getRange("realised", addDays(start, -1), addDays(end, 1));
    const sums = new Map();
    for (const [ms, mw] of map) {
      const key = `${dateKey(ms)} ${timeKey(ms)}`;
      const acc = sums.get(key);
      // The repeated hour on the October clock change maps to one key: average it.
      if (acc) { acc[0] += mw; acc[1] += 1; } else sums.set(key, [mw, 1]);
    }
    return new Map([...sums].map(([key, [sum, count]]) => [key, sum / count]));
  }

  /** Base 15-minute data on the current timeline. Returns { grid, actual, perYear[k], d1, d2 }. */
  async intradayBase() {
    const s = this.state;
    const years = this.yearsNeeded();
    const [actualMap, d1Map, d2Map, ...lookups] = await Promise.all([
      getRange("realised", s.from, s.to),
      s.d1 === "1" && s.profile !== "1" ? getRange("d1", s.from, s.to) : null,
      s.d2 === "1" && s.profile !== "1" ? getRange("d2", s.from, s.to) : null,
      ...Array.from({ length: years }, (_, i) => this.comparisonLookup(i + 1))
    ]);

    const start = parisMidnight(s.from);
    const end = parisMidnight(addDays(s.to, 1));
    const grid = [];
    for (let x = start; x < end; x += QUARTER) grid.push(x);

    const actual = new Map();
    const perYear = lookups.map(() => new Map());

    for (const x of grid) {
      const date = dateKey(x);
      if (this.excluded(date)) continue;
      if (actualMap.has(x)) actual.set(x, actualMap.get(x));
      const time = timeKey(x);
      lookups.forEach((lookup, i) => {
        const src = alignDate(date, i + 1, s.align);
        if (!src || this.excluded(src)) return;
        const v = lookup.get(`${src} ${time}`);
        if (v != null) perYear[i].set(x, v);
      });
    }

    const filterExcluded = map => {
      if (!map) return null;
      const out = new Map();
      for (const [x, v] of map) if (!this.excluded(dateKey(x))) out.set(x, v);
      return out;
    };

    return { grid, actual, perYear, d1: filterExcluded(d1Map), d2: filterExcluded(d2Map) };
  }

  /** Base daily values for the chosen measure. */
  async dailyBase() {
    const s = this.state;
    const daily = await getDaily();
    const years = this.yearsNeeded();
    const dates = dateRange(s.from, s.to);
    const pick = (row, prefix = "") => {
      if (!row) return null;
      if (prefix) {
        if (s.measure === "mean") return row[`${prefix}_mean_mw`];
        if (s.measure === "max") return row[`${prefix}_peak_mw`];
        if (s.measure === "energy") return row[`${prefix}_mean_mw`] == null ? null : row[`${prefix}_mean_mw`] * row.hours / 1000;
        return null;
      }
      if (s.measure === "mean") return row.mean_mw;
      if (s.measure === "max") return row.max_mw;
      if (s.measure === "min") return row.min_mw;
      return row.energy_gwh;
    };

    const actual = new Map();
    const weights = new Map();
    const perYear = Array.from({ length: years }, () => new Map());
    const perYearWeights = Array.from({ length: years }, () => new Map());
    const d1 = s.d1 === "1" ? new Map() : null;
    const d2 = s.d2 === "1" ? new Map() : null;

    for (const date of dates) {
      if (this.excluded(date)) continue;
      const row = daily.byDate.get(date);
      const v = pick(row);
      if (v != null) { actual.set(date, v); weights.set(date, row.intervals / 4 || row.hours); }
      if (d1) { const f = pick(row, "d1"); if (f != null) d1.set(date, f); }
      if (d2) { const f = pick(row, "d2"); if (f != null) d2.set(date, f); }
      for (let k = 1; k <= years; k++) {
        const src = alignDate(date, k, s.align);
        if (!src || this.excluded(src)) continue;
        const srcRow = daily.byDate.get(src);
        const cv = pick(srcRow);
        if (cv != null) { perYear[k - 1].set(date, cv); perYearWeights[k - 1].set(date, srcRow.hours); }
      }
    }

    return { dates, actual, weights, perYear, perYearWeights, d1, d2, daily };
  }

  // ---------- Aggregation ----------

  /** Average 15-minute maps into hours. */
  static toHourly(map) {
    if (!map) return null;
    const sums = new Map();
    for (const [x, v] of map) {
      const h = Math.floor(x / HOUR) * HOUR; // Paris offsets are whole hours
      const acc = sums.get(h);
      if (acc) { acc[0] += v; acc[1] += 1; } else sums.set(h, [v, 1]);
    }
    return new Map([...sums].map(([h, [sum, n]]) => [h, sum / n]));
  }

  /** Group daily values into weeks or months according to the measure. */
  groupDaily(map, weights, res) {
    if (!map) return null;
    const groups = new Map();
    for (const [date, v] of map) {
      const key = res === "1w" ? weekStart(date) : `${date.slice(0, 7)}-01`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push([v, weights?.get(date) ?? 24]);
    }
    const m = this.state.measure;
    const out = new Map();
    for (const [key, items] of groups) {
      let value;
      if (m === "max") value = Math.max(...items.map(i => i[0]));
      else if (m === "min") value = Math.min(...items.map(i => i[0]));
      else if (m === "energy") value = items.reduce((a, i) => a + i[0], 0);
      else {
        const w = items.reduce((a, i) => a + i[1], 0);
        value = items.reduce((a, i) => a + i[0] * i[1], 0) / w;
      }
      out.set(key, value);
    }
    return out;
  }

  /** Combine per-year maps into last year / average / band series. */
  combine(perYear, keys) {
    const s = this.state;
    const n = Number(s.n);
    const ly = [];
    const avg = [];
    const band = [];
    for (const key of keys) {
      if (s.ly === "1") { const v = perYear[0]?.get(key); if (v != null) ly.push([key, v]); }
      const values = perYear.slice(0, n).map(m => m.get(key)).filter(v => v != null);
      if (s.avg === "1" && values.length) avg.push([key, values.reduce((a, b) => a + b, 0) / values.length]);
      if (s.band === "1" && values.length >= 2) band.push([key, Math.min(...values), Math.max(...values)]);
    }
    return { ly, avg, band };
  }

  multiYear() {
    return this.state.from.slice(0, 4) !== this.state.to.slice(0, 4);
  }

  /** "2023–25" for a single-year period; "previous 3 years" when the period spans years. */
  yearsLabel() {
    const n = Number(this.state.n);
    const y = Number(this.state.from.slice(0, 4));
    return this.multiYear() ? `of previous ${n} years` : `${y - n}–${String(y - 1).slice(-2)}`;
  }

  lastYearLabel() {
    return this.multiYear() ? "One year earlier" : `Last year (${Number(this.state.from.slice(0, 4)) - 1})`;
  }

  // ---------- Render ----------

  async update() {
    const id = ++this.renderId;
    const s = this.state;
    writeHash("explorer", s);
    this.headline.textContent = "Loading…";

    try {
      const days = daysBetween(s.from, s.to) + 1;
      const notes = [];
      let result;

      if (s.profile === "1") {
        if (days > MAX_PROFILE_DAYS) {
          this.headline.textContent = "Select a period of up to one year to see the daily profile.";
          this.cards.innerHTML = "";
          this.panel.render({ xType: "category", categories: [], xLabel: x => x, series: [] });
          return;
        }
        result = await this.buildProfile(notes);
      } else {
        let res = s.res;
        if (["15m", "1h"].includes(res) && days > MAX_1H_DAYS) {
          notes.push("15-minute views are limited to one year and hourly views to three years, so this period is shown daily.");
          res = "1d";
        } else if (res === "15m" && days > MAX_15M_DAYS) {
          notes.push("15-minute views are limited to one year, so this period is shown hourly.");
          res = "1h";
        }
        result = ["15m", "1h"].includes(res) ? await this.buildIntraday(res, notes) : await this.buildDaily(res, notes);
      }

      if (id !== this.renderId) return; // a newer update started

      this.addAlignmentNotes(notes);
      result.spec.notes = [...notes, ...(result.spec.notes || [])];
      this.panel.setTitle(result.title, result.subtitle);
      this.panel.render(result.spec);
      this.renderSummary(result.summary);
    } catch (error) {
      console.error(error);
      if (id === this.renderId) this.headline.textContent = `The data could not be loaded (${error.message}).`;
    }
  }

  addAlignmentNotes(notes) {
    const s = this.state;
    if (this.yearsNeeded()) {
      notes.push(s.align === "cal"
        ? "Comparisons use the same calendar dates in earlier years, matched on Paris local time (29 February has no match in non-leap years)."
        : "Comparisons use the same weekday in earlier years (52 weeks = 364 days earlier per year), matched on Paris local time.");
    }
    if (s.hol === "excl") notes.push("French public holidays are excluded from the current period and from comparison years.");
  }

  async buildIntraday(res, notes) {
    const s = this.state;
    const base = await this.intradayBase();
    const step = res === "1h" ? HOUR : QUARTER;
    const agg = map => (res === "1h" ? Explorer.toHourly(map) : map);

    const actual = agg(base.actual);
    const perYear = base.perYear.map(agg);
    const keys = res === "1h" ? [...new Set(base.grid.map(x => Math.floor(x / HOUR) * HOUR))] : base.grid;
    const { ly, avg, band } = this.combine(perYear, keys);
    const toGW = arr => arr.map(p => (p.length === 3 ? [p[0], p[1] / 1000, p[2] / 1000] : [p[0], p[1] / 1000]));

    const series = [];
    if (band.length) series.push({ name: `Range ${this.yearsLabel()}`, colour: "--s-band", type: "band", data: toGW(band), unit: "GW" });
    if (avg.length) series.push({ name: `Average ${this.yearsLabel()}`, colour: "--s-avg", type: "line", data: toGW(avg), dashed: true, width: 1.8, unit: "GW" });
    if (ly.length) series.push({ name: this.lastYearLabel(), colour: "--s-ly", type: "line", data: toGW(ly), width: 1.6, unit: "GW" });
    if (base.d2) series.push({ name: "D-2 forecast", colour: "--s-d2", type: "line", data: toGW([...agg(base.d2)].sort((a, b) => a[0] - b[0])), width: 1.6, unit: "GW" });
    if (base.d1) series.push({ name: "D-1 forecast", colour: "--s-d1", type: "line", data: toGW([...agg(base.d1)].sort((a, b) => a[0] - b[0])), width: 1.6, unit: "GW" });
    series.push({ name: "Actual", colour: "--s-actual", type: "line", data: toGW([...actual].sort((a, b) => a[0] - b[0])), width: 2.4, area: true, unit: "GW", z: 20 });

    if (base.d1 && res === "15m") notes.push("D-1 is natively half-hourly for most of its history: its quarter-hour values are interpolated (2012–22) or repeated (2024).");
    if (base.d2 && res === "15m") notes.push("D-2 is published half-hourly.");

    const spec = {
      xType: "time", xLabel: x => fmtDateTime(x), axisLabel: x => fmtDayTime(x), csvLabel: csvDateTime,
      yName: "GW", series, markAreas: this.holidayAreas(s.from, s.to, false),
      legendCaption: "Average for the period in view"
    };

    return {
      spec,
      title: `Demand, ${RES_LABEL[res]}`,
      subtitle: `${fmtLongDate(s.from)} – ${fmtLongDate(s.to)} · GW`,
      summary: this.summaryFromIntraday(base)
    };
  }

  async buildDaily(res, notes) {
    const s = this.state;
    const base = await this.dailyBase();
    const m = s.measure;
    const scale = m === "energy" ? (res === "1d" ? 1 : 1000) : 1000; // MW->GW, GWh->TWh for week/month
    const unit = m === "energy" ? (res === "1d" ? "GWh" : "TWh") : "GW";

    let actual = base.actual;
    let perYear = base.perYear;
    let d1 = base.d1;
    let d2 = base.d2;
    let keys = base.dates.filter(d => !this.excluded(d));

    if (res !== "1d") {
      actual = this.groupDaily(base.actual, base.weights, res);
      perYear = base.perYear.map((map, i) => this.groupDaily(map, base.perYearWeights[i], res));
      d1 = this.groupDaily(base.d1, base.weights, res);
      d2 = this.groupDaily(base.d2, base.weights, res);
      keys = [...new Set(keys.map(d => (res === "1w" ? weekStart(d) : `${d.slice(0, 7)}-01`)))];
      const first = keys[0];
      const lastDate = base.dates[base.dates.length - 1];
      const partialStart = res === "1w" ? first !== s.from : !s.from.endsWith("-01");
      const nextGroup = res === "1w" ? addDays(weekStart(lastDate), 7) : addDays(`${lastDate.slice(0, 7)}-28`, 4).slice(0, 7) + "-01";
      const partialEnd = addDays(lastDate, 1) !== nextGroup;
      if (partialStart || partialEnd) notes.push(`The first or last ${res === "1w" ? "week" : "month"} only covers the part inside the selected period.`);
    }

    const keySet = new Set(keys);
    const toPoints = map => (map ? [...map].filter(([k]) => keySet.has(k)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [parisMidnight(k), v / scale]) : null);
    const { ly, avg, band } = this.combine(perYear, keys);
    const conv = arr => arr.map(p => (p.length === 3 ? [parisMidnight(p[0]), p[1] / scale, p[2] / scale] : [parisMidnight(p[0]), p[1] / scale]));

    const decimals = unit === "GWh" ? 0 : 2;
    const avgFn = m === "energy" ? values => values.reduce((a, b) => a + b, 0) : undefined;
    const series = [];
    if (band.length) series.push({ name: `Range ${this.yearsLabel()}`, colour: "--s-band", type: "band", data: conv(band), unit, decimals });
    if (avg.length) series.push({ name: `Average ${this.yearsLabel()}`, colour: "--s-avg", type: "line", data: conv(avg), dashed: true, width: 1.8, unit, decimals, avg: avgFn, symbols: res !== "1d" });
    if (ly.length) series.push({ name: this.lastYearLabel(), colour: "--s-ly", type: "line", data: conv(ly), width: 1.6, unit, decimals, avg: avgFn, symbols: res !== "1d" });
    if (d2) series.push({ name: "D-2 forecast", colour: "--s-d2", type: "line", data: toPoints(d2), width: 1.6, unit, decimals, avg: avgFn, symbols: res !== "1d" });
    if (d1) series.push({ name: "D-1 forecast", colour: "--s-d1", type: "line", data: toPoints(d1), width: 1.6, unit, decimals, avg: avgFn, symbols: res !== "1d" });
    series.push({ name: "Actual", colour: "--s-actual", type: "line", data: toPoints(actual), width: 2.4, area: true, unit, decimals, avg: avgFn, z: 20, symbols: res !== "1d" });

    if (m === "min" && (s.d1 === "1" || s.d2 === "1")) notes.push("Forecast minimums are not summarised, so forecasts are not shown for this measure.");
    if (m === "energy") notes.push("The legend shows totals for the period in view rather than averages.");
    if (s.to >= todayParis()) notes.push("Today is incomplete: its values cover the hours published so far.");

    const measureLabel = { mean: "Average demand", max: "Peak demand", min: "Minimum demand", energy: "Energy consumed" }[m];
    const xLabel = res === "1M" ? x => fmtMonth(x) : res === "1w" ? x => `Week of ${fmtDate(x)}` : x => fmtDate(x);

    const spec = {
      xType: "time", xLabel, axisLabel: res === "1M" ? x => fmtMonth(x) : x => fmtDayShort(x), csvLabel: csvDate,
      xHeader: res === "1M" ? "Month" : res === "1w" ? "Week starting" : "Date",
      yName: unit, series,
      markAreas: res === "1d" ? this.holidayAreas(s.from, s.to, true) : [],
      legendCaption: m === "energy" ? "Total for the period in view" : "Average for the period in view"
    };

    return {
      spec,
      title: `${measureLabel}, ${RES_LABEL[res]}`,
      subtitle: `${fmtLongDate(s.from)} – ${fmtLongDate(s.to)} · ${unit}`,
      summary: this.summaryFromDaily(base)
    };
  }

  async buildProfile(notes) {
    const s = this.state;
    const base = await this.intradayBase();
    // Quarter-hour slots unless the hourly resolution is selected.
    const hourly = s.res === "1h";
    const slots = hourly ? 24 : 96;
    const slotOf = x => {
      const [h, mnt] = timeKey(x).split(":").map(Number);
      return hourly ? h : h * 4 + mnt / 15;
    };
    const profile = map => {
      const acc = Array.from({ length: slots }, () => [0, 0]);
      for (const [x, v] of map) { const i = slotOf(x); acc[i][0] += v; acc[i][1] += 1; }
      return acc.map(([sum, n]) => (n ? sum / n : null));
    };

    const categories = Array.from({ length: slots }, (_, i) => (hourly
      ? `${String(i).padStart(2, "0")}:00`
      : `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`));

    const current = profile(base.actual);
    const years = base.perYear.map(profile);
    const n = Number(s.n);
    const series = [];
    const pts = arr => arr.map((v, i) => [i, v == null ? null : v / 1000]).filter(p => p[1] != null);

    if (s.band === "1") {
      const band = [];
      for (let i = 0; i < slots; i++) {
        const values = years.slice(0, n).map(p => p[i]).filter(v => v != null);
        if (values.length >= 2) band.push([i, Math.min(...values) / 1000, Math.max(...values) / 1000]);
      }
      if (band.length) series.push({ name: `Range ${this.yearsLabel()}`, colour: "--s-band", type: "band", data: band, unit: "GW" });
    }
    if (s.avg === "1") {
      const avg = [];
      for (let i = 0; i < slots; i++) {
        const values = years.slice(0, n).map(p => p[i]).filter(v => v != null);
        if (values.length) avg.push([i, values.reduce((a, b) => a + b, 0) / values.length / 1000]);
      }
      series.push({ name: `Average ${this.yearsLabel()}`, colour: "--s-avg", type: "line", data: avg, dashed: true, width: 1.8, unit: "GW" });
    }
    if (s.ly === "1" && years[0]) series.push({ name: this.lastYearLabel(), colour: "--s-ly", type: "line", data: pts(years[0]), width: 1.6, unit: "GW" });
    series.push({ name: "Actual", colour: "--s-actual", type: "line", data: pts(current), width: 2.6, area: true, unit: "GW", z: 20, symbols: hourly });

    notes.push(`Each point is the average for that ${hourly ? "hour" : "quarter-hour"} of the day across every day in the period (Paris local time).`);

    const spec = {
      xType: "category", categories, xLabel: x => x, xHeader: "Time of day (Europe/Paris)",
      yName: "GW", series, legendCaption: "Average across the time of day in view"
    };

    return {
      spec,
      title: `Average daily profile, ${hourly ? "hourly" : "15-minute"}`,
      subtitle: `${fmtLongDate(s.from)} – ${fmtLongDate(s.to)} · GW`,
      summary: this.summaryFromIntraday(base)
    };
  }

  holidayAreas(from, to, daily) {
    if (this.state.hol === "off") return [];
    const areas = [];
    for (const date of dateRange(from, to)) {
      const name = holidayName(date);
      if (!name) continue;
      const start = parisMidnight(date);
      const end = parisMidnight(addDays(date, 1));
      areas.push(daily
        ? { from: start - 12 * HOUR, to: start + 12 * HOUR, label: name }
        : { from: start, to: end, label: name });
    }
    return areas;
  }

  // ---------- Summary ----------

  summaryFromIntraday(base) {
    const values = [...base.actual];
    if (!values.length) return null;
    const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    const actualMean = mean(values.map(v => v[1]));
    let peak = values[0];
    let low = values[0];
    for (const p of values) { if (p[1] > peak[1]) peak = p; if (p[1] < low[1]) low = p; }

    // Like-for-like: compare only where the actual value exists.
    const compare = map => {
      const pairs = values.filter(([x]) => map.has(x));
      if (!pairs.length) return null;
      return { cur: mean(pairs.map(p => p[1])), cmp: mean(pairs.map(([x]) => map.get(x))) };
    };
    const n = Number(this.state.n);
    const avgMap = new Map();
    for (const [x] of values) {
      const vs = base.perYear.slice(0, n).map(m => m.get(x)).filter(v => v != null);
      if (vs.length) avgMap.set(x, vs.reduce((a, b) => a + b, 0) / vs.length);
    }

    return {
      mean: actualMean,
      peak: { value: peak[1], when: fmtDateTime(peak[0]) },
      low: { value: low[1], when: fmtDateTime(low[0]) },
      energyGwh: actualMean * values.length * 0.25 / 1000,
      vsAvg: this.state.avg === "1" || this.state.band === "1" ? compare(avgMap) : null,
      vsLy: this.state.ly === "1" && base.perYear[0] ? compare(base.perYear[0]) : null,
      coverage: values.length
    };
  }

  summaryFromDaily(base) {
    const rows = base.dates.filter(d => !this.excluded(d)).map(d => base.daily.byDate.get(d)).filter(r => r && r.mean_mw != null);
    if (!rows.length) return null;
    const hours = r => r.intervals / 4;
    const totalHours = rows.reduce((a, r) => a + hours(r), 0);
    const mean = rows.reduce((a, r) => a + r.mean_mw * hours(r), 0) / totalHours;
    const peak = rows.reduce((a, r) => (r.max_mw > a.max_mw ? r : a));
    const low = rows.reduce((a, r) => (r.min_mw < a.min_mw ? r : a));

    const n = Number(this.state.n);
    const compare = years => {
      let cur = 0; let cmp = 0; let w = 0;
      for (const r of rows) {
        const vals = years.map(k => {
          const src = alignDate(r.date, k, this.state.align);
          if (!src || this.excluded(src)) return null;
          return base.daily.byDate.get(src)?.mean_mw ?? null;
        }).filter(v => v != null);
        if (!vals.length) continue;
        cur += r.mean_mw * hours(r);
        cmp += (vals.reduce((a, b) => a + b, 0) / vals.length) * hours(r);
        w += hours(r);
      }
      return w ? { cur: cur / w, cmp: cmp / w } : null;
    };

    return {
      mean,
      peak: { value: peak.max_mw, when: `${fmtDate(parisMidnight(peak.date) + 12 * HOUR)} ${peak.peak_time_paris}` },
      low: { value: low.min_mw, when: `${fmtDate(parisMidnight(low.date) + 12 * HOUR)} ${low.min_time_paris}` },
      // Use the stored daily energy (average x hours in the day) where available.
      energyGwh: rows.reduce((a, r) => a + (r.energy_gwh ?? r.mean_mw * hours(r) / 1000), 0),
      vsAvg: this.state.avg === "1" || this.state.band === "1" ? compare(Array.from({ length: n }, (_, i) => i + 1)) : null,
      vsLy: this.state.ly === "1" ? compare([1]) : null
    };
  }

  renderSummary(summary) {
    const s = this.state;
    if (!summary) {
      this.headline.textContent = "No actual demand data for this period.";
      this.cards.innerHTML = "";
      return;
    }

    const pct = c => (c ? (c.cur - c.cmp) / c.cmp * 100 : null);
    const vsAvg = pct(summary.vsAvg);
    const vsLy = pct(summary.vsLy);
    const period = s.from === s.to ? fmtLongDate(s.from) : `${fmtLongDate(s.from)} to ${fmtLongDate(s.to)}`;
    const dir = v => (v >= 0 ? "above" : "below");

    let text = `Demand from ${period} averaged ${fmtGW(summary.mean, 1)}`;
    const parts = [];
    if (vsAvg != null) parts.push(`${fmtNumber(Math.abs(vsAvg), 1)}% ${dir(vsAvg)} ${this.multiYear() ? `the average of the previous ${s.n} years` : `the ${this.yearsLabel()} average`} for the same ${s.align === "cal" ? "dates" : "weekdays"}`);
    if (vsLy != null) parts.push(`${fmtNumber(Math.abs(vsLy), 1)}% ${dir(vsLy)} ${this.multiYear() ? "the same period one year earlier" : "last year"}`);
    if (parts.length) text += `, ${parts.join(" and ")}`;
    text += s.hol === "excl" ? " (public holidays excluded)." : ".";
    this.headline.textContent = text;

    const energy = summary.energyGwh >= 1000 ? `${fmtNumber(summary.energyGwh / 1000, 2)} TWh` : `${fmtNumber(summary.energyGwh, 0)} GWh`;
    const card = (label, value, detail = "", cls = "") =>
      `<div class="card"><div class="label">${label}</div><div class="value ${cls}">${value}</div><div class="detail">${detail}</div></div>`;

    this.cards.innerHTML = [
      card("Average demand", fmtGW(summary.mean, 1), "Actual, period so far"),
      vsAvg != null ? card(this.multiYear() ? `vs previous ${s.n}-year average` : `vs ${this.yearsLabel()} average`, fmtPct(vsAvg), `${fmtGW(summary.vsAvg.cmp, 1)} like-for-like`) : "",
      vsLy != null ? card(this.multiYear() ? "vs one year earlier" : "vs last year", fmtPct(vsLy), `${fmtGW(summary.vsLy.cmp, 1)} like-for-like`) : "",
      card("Peak", fmtGW(summary.peak.value, 1), summary.peak.when),
      card("Minimum", fmtGW(summary.low.value, 1), summary.low.when),
      card("Energy", energy, "Actual, period so far")
    ].join("");
  }

  refreshTheme() {
    this.panel.refreshTheme();
  }
}

function fmtDayShort(x) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", day: "numeric", month: "short" }).format(x);
}

export { DAY };
