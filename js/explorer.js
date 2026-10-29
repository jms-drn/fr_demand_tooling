// Explorer: demand for any period since Dec 2012 at 15-minute to monthly
// resolution, extended with RTE's forecasts up to the week-ahead horizon,
// compared with the same period in earlier years. Also: daily (diurnal)
// profile, difference view, ranking of the period across years, events.

import { ChartPanel } from "./chart.js";
import { bestForecast, getDaily, getLatest, getRange, horizonDate, latestSeries, parseUtc } from "./data.js";
import { eventsBetween } from "./events.js";
import {
  HOUR, QUARTER, addDays, alignDate, copyText, csvDate, csvDateTime, dateKey, dateRange, daysBetween,
  fmtDate, fmtDateTime, fmtGW, fmtFromTo, fmtLongDate, fmtMonth, fmtNumber, fmtPct, fmtPeriod, fmtShortDate,
  fmtTime, heroHtml, holidayName, hoursInDay, ordinal, parisMidnight, timeKey, todayParis, weekStart, writeHash
} from "./util.js";

const RES_LABEL = { "15m": "15-minute", "1h": "hourly", "1d": "daily", "1w": "weekly", "1M": "monthly" };
const MEASURE_LABEL = { mean: "Average demand", max: "Peak demand", min: "Minimum demand", energy: "Energy consumed" };
const MAX_15M_DAYS = 366;
const MAX_1H_DAYS = 1100;
const MAX_PROFILE_DAYS = 366;
const FIRST_DATE = "2012-12-17";

function defaults() {
  return {
    preset: "mtd", from: "", to: "", res: "1d", measure: "mean",
    ly: "1", avg: "1", band: "0", n: "3", align: "cal", hol: "off",
    profile: "0", d1: "0", d2: "0", fc: "1", ev: "0", view: "abs", ref: "avg"
  };
}

export class Explorer {
  constructor(root) {
    this.root = root;
    this.state = defaults();
    this.status = null;
    this.renderId = 0;
    this.build();
  }

  setStatus(status) {
    this.status = status;
    const horizon = this.horizon();
    for (const input of this.root.querySelectorAll('input[type="date"]')) input.max = horizon;
    if (this.state.preset !== "custom") this.applyPreset();
  }

  horizon() {
    return this.status ? horizonDate(this.status) : todayParis();
  }

  presetRange(preset) {
    const today = todayParis();
    const y = Number(today.slice(0, 4));
    const monthStart = `${today.slice(0, 7)}-01`;
    const monthEnd = addDays(`${addDays(monthStart, 32).slice(0, 7)}-01`, -1);
    switch (preset) {
      case "mtd": return [monthStart, today];
      case "mfc": return [monthStart, monthEnd < this.horizon() ? monthEnd : this.horizon()];
      case "ahead": return [addDays(today, -6), this.horizon()];
      case "last7": return [addDays(today, -6), today];
      case "last30": return [addDays(today, -29), today];
      case "ytd": return [`${y}-01-01`, today];
      case "last365": return [addDays(today, -364), today];
      case "lastmonth": {
        const last = addDays(monthStart, -1);
        return [`${last.slice(0, 7)}-01`, last];
      }
      case "lastyear": return [`${y - 1}-01-01`, `${y - 1}-12-31`];
      default: return null;
    }
  }

  applyPreset() {
    const range = this.presetRange(this.state.preset);
    if (range) [this.state.from, this.state.to] = range;
    this.syncControls();
  }

  setParams(params) {
    const state = defaults();
    for (const key of Object.keys(state)) if (params.has(key)) state[key] = params.get(key);
    this.state = state;
    if (state.preset !== "custom" || !state.from) this.applyPreset();
    this.syncControls();
  }

  // ---------- UI ----------

  chip(key, label, colour) {
    return `<button class="chip" type="button" data-chip="${key}" style="color:var(${colour})"><span class="swatch"></span><span class="chip-label">${label}</span></button>`;
  }

  build() {
    this.root.innerHTML = `
      ${heroHtml("Explore demand,", "since 2012.", "Demand for any period since December 2012, from 15-minute detail to monthly averages, compared with the same period in earlier years. Periods can run into RTE's forecasts, and Daily profile shows the average shape of a day across any period.")}
      <div class="toolbar" role="group" aria-label="Explorer settings">
        <div class="toolbar-row">
          <label class="field"><span>Period</span>
            <select data-k="preset">
              <option value="mtd">Month to date</option>
              <option value="mfc">This month, with forecast</option>
              <option value="ahead">Last 7 days and next 9</option>
              <option value="lastmonth">Last month</option>
              <option value="last7">Last 7 days</option>
              <option value="last30">Last 30 days</option>
              <option value="ytd">Year to date</option>
              <option value="last365">Last 365 days</option>
              <option value="lastyear">Last calendar year</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label class="field"><span>From</span><input type="date" data-k="from" min="${FIRST_DATE}"></label>
          <label class="field"><span>To</span><input type="date" data-k="to" min="${FIRST_DATE}"></label>
          <label class="field"><span>Resolution</span>
            <select data-k="res">
              <option value="15m">15 minutes</option><option value="1h">Hourly</option><option value="1d">Daily</option>
              <option value="1w">Weekly</option><option value="1M">Monthly</option>
            </select>
          </label>
          <label class="field"><span>Measure</span>
            <select data-k="measure">
              <option value="mean">Average (GW)</option><option value="max">Peak (GW)</option>
              <option value="min">Minimum (GW)</option><option value="energy">Energy</option>
            </select>
          </label>
          <label class="field"><span>Show</span>
            <select data-k="view">
              <option value="abs">Values</option><option value="pct">Difference (%)</option><option value="gw">Difference (GW)</option>
            </select>
          </label>
          <label class="field" data-ref-field><span>Difference vs</span>
            <select data-k="ref"><option value="avg">Earlier-years average</option><option value="ly">Last year</option></select>
          </label>
        </div>
        <div class="toolbar-row">
          <div class="field"><span>Compare with</span>
            <div class="chips">
              ${this.chip("ly", "Last year", "--s-ly")}
              ${this.chip("avg", "Average of previous", "--s-avg")}
              <select data-k="n" aria-label="Number of previous years" class="compact">
                <option value="2">2 years</option><option value="3">3 years</option><option value="4">4 years</option><option value="5">5 years</option>
              </select>
              ${this.chip("band", "Min–max range", "--s-avg")}
            </div>
          </div>
          <label class="field"><span>Align by</span>
            <select data-k="align"><option value="cal">Calendar date</option><option value="wd">Weekday</option></select>
          </label>
          <label class="field"><span>Public holidays</span>
            <select data-k="hol"><option value="off">Ignore</option><option value="mark">Mark</option><option value="excl">Mark and exclude</option></select>
          </label>
          <div class="field"><span>Overlays</span>
            <div class="chips">
              ${this.chip("fc", "Forecast ahead", "--s-fcst")}
              ${this.chip("d1", "D-1", "--s-d1")}
              ${this.chip("d2", "D-2", "--s-d2")}
              ${this.chip("ev", "Events", "--muted")}
            </div>
          </div>
          <div class="field"><span>View</span>
            <div class="chips">${this.chip("profile", "Daily profile", "--accent")}</div>
          </div>
        </div>
      </div>
      <div class="headline"><p data-headline>Loading…</p><button class="btn ghost small" type="button" data-copy title="Copy this sentence">Copy</button></div>
      <p class="explain" data-explain hidden></p>
      <div class="cards" data-cards>${'<div class="card skeleton"></div>'.repeat(5)}</div>
      <div data-chart></div>
      <div data-rank></div>`;

    this.headline = this.root.querySelector("[data-headline]");
    this.explain = this.root.querySelector("[data-explain]");
    this.cards = this.root.querySelector("[data-cards]");
    this.panel = new ChartPanel(this.root.querySelector("[data-chart]"), { title: "Demand", size: "tall", overview: true });
    this.rankPanel = new ChartPanel(this.root.querySelector("[data-rank]"), { title: "The same period in every year", size: "short" });
    this.root.querySelector("[data-copy]").addEventListener("click", () => copyText(this.headline.textContent));

    this.root.querySelectorAll("[data-k]").forEach(input => {
      input.addEventListener("change", () => {
        const key = input.dataset.k;
        this.state[key] = input.value;
        if (key === "preset" && input.value !== "custom") this.applyPreset();
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
    const diff = s.view !== "abs";
    this.root.querySelector('[data-k="measure"]').disabled = profile || ["15m", "1h"].includes(s.res);
    this.root.querySelector('[data-k="view"]').disabled = profile;
    this.root.querySelector("[data-ref-field]").classList.toggle("hidden", !diff || profile);
    for (const key of ["d1", "d2"]) this.root.querySelector(`[data-chip="${key}"]`).disabled = profile || diff;
    this.root.querySelector('[data-chip="fc"]').disabled = profile;
    this.root.querySelector('[data-chip="ev"]').disabled = profile;
    this.root.querySelector('[data-chip="band"]').disabled = diff;
    this.root.querySelector('[data-k="n"]').disabled = s.avg !== "1" && s.band !== "1" && !(diff && s.ref === "avg");
  }

  activate() {
    this.update();
  }

  // ---------- Helpers ----------

  yearsNeeded() {
    const s = this.state;
    const n = Number(s.n);
    const diffAvg = s.view !== "abs" && s.ref === "avg";
    const diffLy = s.view !== "abs" && s.ref === "ly";
    return Math.max(s.ly === "1" || diffLy ? 1 : 0, s.avg === "1" || s.band === "1" || diffAvg ? n : 0);
  }

  excluded(date) {
    return this.state.hol === "excl" && holidayName(date) !== null;
  }

  multiYear() {
    return this.state.from.slice(0, 4) !== this.state.to.slice(0, 4);
  }

  yearsLabel() {
    const n = Number(this.state.n);
    const y = Number(this.state.from.slice(0, 4));
    return this.multiYear() ? `previous ${n} years` : `${y - n}–${String(y - 1).slice(-2)}`;
  }

  avgName() {
    return this.multiYear() ? `Average of previous ${this.state.n} years` : `Average ${this.yearsLabel()}`;
  }

  lastYearName() {
    return this.multiYear() ? "One year earlier" : `Last year (${Number(this.state.from.slice(0, 4)) - 1})`;
  }

  pick(stats) {
    if (!stats) return null;
    const m = this.state.measure;
    return m === "mean" ? stats.mean : m === "max" ? stats.max : m === "min" ? stats.min : stats.energy;
  }

  // ---------- Data ----------

  /** Last published actual interval (archive or live refresh). */
  async lastActualMs() {
    const latest = await getLatest();
    const live = [...latestSeries(latest, "REALISED").keys()];
    const archived = parseUtc(this.status?.series?.realised?.last_utc) ?? -Infinity;
    return Math.max(archived, ...live);
  }

  /** Actual 15-minute values (archive plus live) between two dates. */
  async actualIntervals(from, to) {
    const [arch, latest] = await Promise.all([getRange("realised", from, to), getLatest()]);
    const out = new Map(arch);
    for (const [x, v] of latestSeries(latest, "REALISED")) {
      const d = dateKey(x);
      if (d >= from && d <= to) out.set(x, v);
    }
    return out;
  }

  static statsFrom(points, kind) {
    const values = points.map(p => p[1]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    let peak = points[0];
    let low = points[0];
    for (const p of points) { if (p[1] > peak[1]) peak = p; if (p[1] < low[1]) low = p; }
    return { mean, max: peak[1], min: low[1], peakAt: peak[0], minAt: low[0], kind };
  }

  /**
   * Per-day statistics for the selected period: actual days from the daily
   * summary, and for the last actual day onwards, actual intervals completed
   * with RTE's forecast. Returns { days: Map(date -> stats), lastActual, ... }.
   */
  async periodDays() {
    const s = this.state;
    const [daily, lastActual] = await Promise.all([getDaily(), this.lastActualMs()]);
    const lastDate = dateKey(lastActual);
    // The forecast extension applies when the period runs past the last actual day.
    const useForecast = s.fc === "1" && s.to > lastDate && s.profile !== "1";
    const tailFrom = s.from > lastDate ? s.from : lastDate;
    let tail = new Map();
    let forecast = { values: new Map(), source: new Map() };

    if (s.to >= lastDate) {
      [tail, forecast] = await Promise.all([
        this.actualIntervals(tailFrom, s.to),
        useForecast ? bestForecast(tailFrom, s.to, lastActual) : forecast
      ]);
    }

    const days = new Map();
    for (const date of dateRange(s.from, s.to)) {
      if (this.excluded(date)) continue;
      const hours = hoursInDay(date);

      if (date < lastDate) {
        const r = daily.byDate.get(date);
        if (r && r.mean_mw != null) {
          days.set(date, {
            mean: r.mean_mw, max: r.max_mw, min: r.min_mw, hours, kind: "actual",
            energy: r.energy_gwh ?? r.mean_mw * hours / 1000,
            peakText: `${fmtDate(parisMidnight(date) + 12 * HOUR)}, ${r.peak_time_paris}`,
            minText: `${fmtDate(parisMidnight(date) + 12 * HOUR)}, ${r.min_time_paris}`
          });
        }
        continue;
      }

      const start = parisMidnight(date);
      const end = parisMidnight(addDays(date, 1));
      const act = [];
      const comb = [];
      for (let x = start; x < end; x += QUARTER) {
        const a = tail.get(x);
        if (a != null) { act.push([x, a]); comb.push([x, a]); continue; }
        const f = forecast.values.get(x);
        if (f != null) comb.push([x, f]);
      }
      const expected = hours * 4;
      let stats = null;
      if (useForecast && comb.length > act.length && comb.length >= 0.9 * expected) stats = Explorer.statsFrom(comb, "forecast");
      else if (act.length) stats = Explorer.statsFrom(act, act.length >= 0.9 * expected ? "actual" : "partial");
      if (!stats) continue;
      stats.hours = hours;
      stats.energy = stats.mean * hours / 1000;
      if (act.length) {
        const a = Explorer.statsFrom(act, "actual");
        stats.actual = a;
        stats.peakText = fmtDateTime(a.peakAt);
        stats.minText = fmtDateTime(a.minAt);
      }
      days.set(date, stats);
    }

    return { days, lastActual, lastDate, useForecast, forecast, tail, daily };
  }

  /** Earlier-year values for each date of the period: [k-1] -> Map(date -> value). */
  comparisonDays(daily) {
    const s = this.state;
    const years = this.yearsNeeded();
    const perYear = Array.from({ length: years }, () => new Map());
    const perYearHours = Array.from({ length: years }, () => new Map());
    for (const date of dateRange(s.from, s.to)) {
      if (this.excluded(date)) continue;
      for (let k = 1; k <= years; k++) {
        const src = alignDate(date, k, s.align);
        if (!src || this.excluded(src)) continue;
        const r = daily.byDate.get(src);
        if (!r || r.mean_mw == null) continue;
        const v = this.pick({ mean: r.mean_mw, max: r.max_mw, min: r.min_mw, energy: r.energy_gwh ?? r.mean_mw * r.hours / 1000 });
        if (v != null) { perYear[k - 1].set(date, v); perYearHours[k - 1].set(date, r.hours); }
      }
    }
    return { perYear, perYearHours };
  }

  /** Earlier-year 15-minute values mapped onto this period's timeline. */
  async comparisonIntervals(k) {
    const s = this.state;
    const start = alignDate(s.from, k, s.align) ?? alignDate(addDays(s.from, 1), k, s.align);
    const end = alignDate(s.to, k, s.align) ?? alignDate(addDays(s.to, -1), k, s.align);
    const map = await getRange("realised", addDays(start, -1), addDays(end, 1));
    const sums = new Map();
    for (const [ms, mw] of map) {
      const key = `${dateKey(ms)} ${timeKey(ms)}`;
      const acc = sums.get(key);
      if (acc) { acc[0] += mw; acc[1] += 1; } else sums.set(key, [mw, 1]); // repeated October hour: average
    }
    const lookup = new Map([...sums].map(([key, [sum, n]]) => [key, sum / n]));
    const out = new Map();
    for (let x = parisMidnight(s.from); x < parisMidnight(addDays(s.to, 1)); x += QUARTER) {
      const date = dateKey(x);
      if (this.excluded(date)) continue;
      const src = alignDate(date, k, s.align);
      if (!src || this.excluded(src)) continue;
      const v = lookup.get(`${src} ${timeKey(x)}`);
      if (v != null) out.set(x, v);
    }
    return out;
  }

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

  groupKey(date, res) {
    return res === "1w" ? weekStart(date) : `${date.slice(0, 7)}-01`;
  }

  /** Group date -> value maps into weeks or months, following the measure. */
  group(map, hoursOf, res) {
    if (!map) return null;
    const groups = new Map();
    for (const [date, v] of map) {
      const key = this.groupKey(date, res);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push([v, hoursOf(date)]);
    }
    const m = this.state.measure;
    const out = new Map();
    for (const [key, items] of groups) {
      let value;
      if (m === "max") value = Math.max(...items.map(i => i[0]));
      else if (m === "min") value = Math.min(...items.map(i => i[0]));
      else if (m === "energy") value = items.reduce((a, i) => a + i[0], 0);
      else value = items.reduce((a, i) => a + i[0] * i[1], 0) / items.reduce((a, i) => a + i[1], 0);
      out.set(key, value);
    }
    return out;
  }

  /** Last year / average / range from per-year maps. */
  combine(perYear, keys) {
    const s = this.state;
    const n = Number(s.n);
    const ly = new Map();
    const avg = new Map();
    const band = new Map();
    for (const key of keys) {
      const v1 = perYear[0]?.get(key);
      if (v1 != null) ly.set(key, v1);
      const values = perYear.slice(0, n).map(m => m.get(key)).filter(v => v != null);
      if (values.length) avg.set(key, values.reduce((a, b) => a + b, 0) / values.length);
      if (values.length >= 2) band.set(key, [Math.min(...values), Math.max(...values)]);
    }
    return { ly, avg, band };
  }

  // ---------- Render ----------

  async update() {
    const id = ++this.renderId;
    const s = this.state;
    writeHash("demand/explorer", s);
    this.panel.setLoading(true);
    this.headline.textContent = "Loading…";

    try {
      const notes = [];
      const days = daysBetween(s.from, s.to) + 1;
      const period = await this.periodDays();
      if (id !== this.renderId) return;

      let result;
      if (s.profile === "1") {
        if (days > MAX_PROFILE_DAYS) {
          result = { title: "Average daily profile", subtitle: "", spec: { xType: "category", categories: [], xLabel: x => x, series: [], empty: "Select a period of up to one year to see the daily profile." } };
        } else {
          result = await this.buildProfile(notes);
        }
      } else {
        let res = s.res;
        if (["15m", "1h"].includes(res) && days > MAX_1H_DAYS) {
          notes.push("15-minute views are limited to one year and hourly views to three years, so this period is shown daily.");
          res = "1d";
        } else if (res === "15m" && days > MAX_15M_DAYS) {
          notes.push("15-minute views are limited to one year, so this period is shown hourly.");
          res = "1h";
        }
        result = ["15m", "1h"].includes(res) ? await this.buildIntraday(res, period, notes) : this.buildDaily(res, period, notes);
      }
      if (id !== this.renderId) return;

      this.addNotes(notes, period);
      result.spec.notes = [...notes, ...(result.spec.notes || [])];
      this.panel.setTitle(result.title, result.subtitle);
      this.panel.render(result.spec);
      this.renderSummary(period);
      this.renderExplain(period);
      this.renderRanking(period);
    } catch (error) {
      console.error(error);
      if (id === this.renderId) {
        this.headline.textContent = `The data could not be loaded (${error.message}).`;
        this.panel.setLoading(false);
      }
    }
  }

  addNotes(notes, period) {
    const s = this.state;
    if (this.yearsNeeded()) {
      notes.push(s.align === "cal"
        ? "Earlier years use the same calendar dates, matched on Paris local time (29 February has no match in non-leap years)."
        : "Earlier years use the same weekday (52 weeks = 364 days earlier per year), matched on Paris local time.");
    }
    if (s.hol === "excl") notes.push("French public holidays are excluded from this period and from earlier years.");
    if (period.useForecast) notes.push(`After the last actual value, ${s.view === "abs" ? "the dashed line" : "the forecast series"} uses RTE's best available forecast: intraday for the rest of today, then D-1, D-2 and the latest week-ahead forecast.`);
    else if (s.to >= period.lastDate && s.profile !== "1") notes.push(`The last day is incomplete: actual data runs to ${fmtTime(period.lastActual + QUARTER)} Paris time.`);
  }

  eventsFor() {
    return this.state.ev === "1" ? eventsBetween(this.state.from, this.state.to) : [];
  }

  holidayAreas(daily) {
    const s = this.state;
    if (s.hol === "off") return [];
    const areas = [];
    for (const date of dateRange(s.from, s.to)) {
      const name = holidayName(date);
      if (!name) continue;
      const start = parisMidnight(date);
      areas.push(daily
        ? { from: start - 12 * HOUR, to: start + 12 * HOUR, label: name }
        : { from: start, to: parisMidnight(addDays(date, 1)), label: name });
    }
    return areas;
  }

  /** Series shown in difference view: values minus the reference. */
  diffSeries(actualPts, forecastPts, refMap, unit, isBars, toKey) {
    const s = this.state;
    const refName = s.ref === "ly" ? this.lastYearName().replace("Last year", "last year") : `the ${this.yearsLabel()} average`;
    const pct = s.view === "pct";
    const diff = pts => pts.map(([x, v]) => {
      const r = refMap.get(toKey(x));
      if (r == null) return null;
      return [x, pct ? (v / r - 1) * 100 : v - r];
    }).filter(Boolean);
    const u = pct ? "%" : unit;
    const format = v => (pct ? fmtPct(v, 1) : `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtNumber(Math.abs(v), unit === "GWh" ? 0 : 2)} ${unit}`);
    const out = [{ name: `Actual vs ${refName}`, colour: "--s-actual", type: isBars ? "bar" : "line", data: diff(actualPts), unit: u, format, width: 2, z: 20 }];
    if (forecastPts.length) out.push({ name: `Forecast vs ${refName}`, colour: "--s-d1", type: isBars ? "bar" : "line", data: diff(forecastPts), unit: u, format, dashed: !isBars, width: 2 });
    return { series: out, yName: u };
  }

  async buildIntraday(res, period, notes) {
    const s = this.state;
    const years = this.yearsNeeded();
    const diff = s.view !== "abs";
    const [actualMap, d1Arch, d2Arch, latest, ...lookups] = await Promise.all([
      this.actualIntervals(s.from, s.to),
      s.d1 === "1" && !diff ? getRange("d1", s.from, s.to) : null,
      s.d2 === "1" && !diff ? getRange("d2", s.from, s.to) : null,
      getLatest(),
      ...Array.from({ length: years }, (_, i) => this.comparisonIntervals(i + 1))
    ]);

    const keep = map => {
      if (!map) return null;
      const out = new Map();
      for (const [x, v] of map) if (!this.excluded(dateKey(x))) out.set(x, v);
      return out;
    };
    const agg = map => (map && res === "1h" ? Explorer.toHourly(map) : map);
    const actual = agg(keep(actualMap));
    const forecastRaw = period.useForecast ? keep(period.forecast.values) : new Map();
    const forecast = agg(forecastRaw);
    const perYear = lookups.map(agg);

    const step = res === "1h" ? HOUR : QUARTER;
    const keys = [];
    for (let x = parisMidnight(s.from); x < parisMidnight(addDays(s.to, 1)); x += step) keys.push(x);
    const { ly, avg, band } = this.combine(perYear, keys);
    const sorted = map => [...map].sort((a, b) => a[0] - b[0]);
    const gw = pts => pts.map(p => (p.length === 3 ? [p[0], p[1] / 1000, p[2] / 1000] : [p[0], p[1] / 1000]));

    const actualPts = sorted(actual);
    let forecastPts = sorted(forecast);
    if (forecastPts.length && actualPts.length) forecastPts = [actualPts[actualPts.length - 1], ...forecastPts];

    let series;
    let yName = "GW";
    if (diff) {
      const refMap = new Map([...(s.ref === "ly" ? ly : avg)].map(([k, v]) => [k, v / 1000]));
      ({ series, yName } = this.diffSeries(gw(actualPts), gw(forecastPts.slice(1)), refMap, "GW", false, x => x));
    } else {
      series = [];
      if (s.band === "1" && band.size) series.push({ name: `Range ${this.yearsLabel()}`, colour: "--s-band", type: "band", data: gw(sorted(band).map(([x, [lo, hi]]) => [x, lo, hi])), unit: "GW" });
      if (s.avg === "1" && avg.size) series.push({ name: this.avgName(), colour: "--s-avg", type: "line", data: gw(sorted(avg)), dashed: true, width: 1.6, unit: "GW" });
      if (s.ly === "1" && ly.size) series.push({ name: this.lastYearName(), colour: "--s-ly", type: "line", data: gw(sorted(ly)), width: 1.5, unit: "GW" });
      if (d2Arch) series.push({ name: "D-2 forecast", colour: "--s-d2", type: "line", data: gw(sorted(agg(keep(new Map([...d2Arch, ...latestSeries(latest, "D-2")]))))), width: 1.5, unit: "GW" });
      if (d1Arch) series.push({ name: "D-1 forecast", colour: "--s-d1", type: "line", data: gw(sorted(agg(keep(new Map([...d1Arch, ...latestSeries(latest, "D-1")]))))), width: 1.5, unit: "GW" });
      if (forecastPts.length) series.push({ name: "Forecast ahead", colour: "--s-fcst", type: "line", data: gw(forecastPts), dashed: true, width: 2.4, unit: "GW", z: 19 });
      series.push({ name: "Actual", colour: "--s-actual", type: "line", data: gw(actualPts), width: 2.6, unit: "GW", z: 20 });
      if (d1Arch && res === "15m") notes.push("D-1 is natively half-hourly for most of its history: its quarter-hour values are interpolated (2012–22) or repeated (2024).");
    }

    return {
      title: diff ? `Difference from ${s.ref === "ly" ? "last year" : "earlier years"}, ${RES_LABEL[res]}` : `Demand, ${RES_LABEL[res]}`,
      subtitle: `${fmtPeriod(s.from, s.to)} · ${yName}`,
      spec: {
        xType: "time", xLabel: x => fmtDateTime(x), csvLabel: csvDateTime, yName, series, zeroLine: diff,
        yFormat: v => fmtNumber(v, 1),
        markAreas: this.holidayAreas(false), events: this.eventsFor()
      }
    };
  }

  buildDaily(res, period, notes) {
    const s = this.state;
    const m = s.measure;
    const diff = s.view !== "abs";
    const { perYear, perYearHours } = this.comparisonDays(period.daily);
    const hoursOf = date => period.days.get(date)?.hours ?? hoursInDay(date);

    const actualVals = new Map();
    const forecastVals = new Map();
    for (const [date, st] of period.days) (st.kind === "forecast" ? forecastVals : actualVals).set(date, this.pick(st));

    // D-1 / D-2 daily overlays from the summary.
    const overlay = prefix => {
      if (s[prefix] !== "1" || diff || m === "min") return null;
      const out = new Map();
      for (const date of dateRange(s.from, s.to)) {
        if (this.excluded(date)) continue;
        const r = period.daily.byDate.get(date);
        const meanMw = r?.[`${prefix}_mean_mw`];
        if (meanMw == null) continue;
        out.set(date, m === "max" ? r[`${prefix}_peak_mw`] : m === "energy" ? meanMw * r.hours / 1000 : meanMw);
      }
      return out;
    };
    let d1 = overlay("d1");
    let d2 = overlay("d2");

    let keys = dateRange(s.from, s.to).filter(d => !this.excluded(d));
    let actual = actualVals;
    let forecast = forecastVals;
    let years = perYear;

    if (res !== "1d") {
      // A group that contains forecast days is shown as forecast.
      const allVals = new Map([...actualVals, ...forecastVals]);
      const grouped = this.group(allVals, hoursOf, res);
      const fcGroups = new Set([...forecastVals.keys()].map(d => this.groupKey(d, res)));
      actual = new Map([...grouped].filter(([k]) => !fcGroups.has(k)));
      forecast = new Map([...grouped].filter(([k]) => fcGroups.has(k)));
      years = perYear.map((map, i) => this.group(map, d => perYearHours[i].get(d) ?? 24, res));
      d1 = this.group(d1, hoursOf, res);
      d2 = this.group(d2, hoursOf, res);
      keys = [...new Set(keys.map(d => this.groupKey(d, res)))];
      const startsMid = res === "1w" ? weekStart(s.from) !== s.from : !s.from.endsWith("-01");
      const nextGroup = res === "1w" ? addDays(weekStart(s.to), 7) : `${addDays(`${s.to.slice(0, 7)}-28`, 4).slice(0, 7)}-01`;
      if (startsMid || addDays(s.to, 1) !== nextGroup) notes.push(`The first or last ${res === "1w" ? "week" : "month"} only covers the part inside the selected period.`);
    }

    const energyUnit = res === "1d" ? "GWh" : "TWh";
    const unit = m === "energy" ? energyUnit : "GW";
    const scale = m === "energy" ? (res === "1d" ? 1 : 1000) : 1000;
    const decimals = unit === "GWh" ? 0 : 2;
    const avgFn = m === "energy" ? values => values.reduce((a, b) => a + b, 0) : undefined;
    const pts = map => (map ? [...map].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [parisMidnight(k), v / scale]) : []);
    const { ly, avg, band } = this.combine(years, keys);
    const markers = res !== "1d" ? true : undefined;

    const actualPts = pts(actual);
    let forecastPts = pts(forecast);
    if (forecastPts.length && actualPts.length && !diff) forecastPts = [actualPts[actualPts.length - 1], ...forecastPts];

    let series;
    let yName = unit;
    if (diff) {
      const refMap = new Map([...(s.ref === "ly" ? ly : avg)].map(([k, v]) => [parisMidnight(k), v / scale]));
      ({ series, yName } = this.diffSeries(actualPts, forecastPts, refMap, unit, true, x => x));
    } else {
      series = [];
      if (s.band === "1" && band.size) {
        const bandPts = [...band].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, [lo, hi]]) => [parisMidnight(k), lo / scale, hi / scale]);
        series.push({ name: `Range ${this.yearsLabel()}`, colour: "--s-band", type: "band", data: bandPts, unit, decimals });
      }
      if (s.avg === "1" && avg.size) series.push({ name: this.avgName(), colour: "--s-avg", type: "line", data: pts(avg), dashed: true, width: 1.6, unit, decimals, avg: avgFn, symbols: markers });
      if (s.ly === "1" && ly.size) series.push({ name: this.lastYearName(), colour: "--s-ly", type: "line", data: pts(ly), width: 1.5, unit, decimals, avg: avgFn, symbols: markers });
      if (d2) series.push({ name: "D-2 forecast", colour: "--s-d2", type: "line", data: pts(d2), width: 1.5, unit, decimals, avg: avgFn, symbols: markers });
      if (d1) series.push({ name: "D-1 forecast", colour: "--s-d1", type: "line", data: pts(d1), width: 1.5, unit, decimals, avg: avgFn, symbols: markers });
      if (forecastPts.length) series.push({ name: "Forecast ahead", colour: "--s-fcst", type: "line", data: forecastPts, dashed: true, width: 2.4, unit, decimals, avg: avgFn, z: 19, symbols: markers });
      series.push({ name: "Actual", colour: "--s-actual", type: "line", data: actualPts, width: 2.6, unit, decimals, avg: avgFn, z: 20, symbols: markers });
    }

    if (m === "min" && (s.d1 === "1" || s.d2 === "1") && !diff) notes.push("RTE's forecasts aren't summarised as daily minimums, so D-1 and D-2 aren't shown for this measure.");
    if (m === "energy" && !diff) notes.push("For energy, the legend shows totals for the period in view rather than averages.");

    const xLabel = res === "1M" ? x => fmtMonth(x) : res === "1w" ? x => `Week of ${fmtDate(x)}` : x => fmtDate(x);
    return {
      title: diff ? `${MEASURE_LABEL[m]}: difference from ${s.ref === "ly" ? "last year" : "earlier years"}, ${RES_LABEL[res]}` : `${MEASURE_LABEL[m]}, ${RES_LABEL[res]}`,
      subtitle: `${fmtPeriod(s.from, s.to)} · ${yName}`,
      spec: {
        xType: "time", xLabel, csvLabel: csvDate, axisLabel: res === "1M" ? x => fmtMonth(x) : undefined,
        xHeader: res === "1M" ? "Month" : res === "1w" ? "Week starting" : "Date",
        yName, series, zeroLine: diff, yFormat: v => fmtNumber(v, unit === "GWh" ? 0 : 1),
        markAreas: res === "1d" ? this.holidayAreas(true) : [], events: this.eventsFor(),
        legendCaption: m === "energy" && !diff ? "Total for the period in view" : "Average for the period in view"
      }
    };
  }

  async buildProfile(notes) {
    const s = this.state;
    const years = this.yearsNeeded();
    const [actualMap, ...lookups] = await Promise.all([
      this.actualIntervals(s.from, s.to),
      ...Array.from({ length: years }, (_, i) => this.comparisonIntervals(i + 1))
    ]);
    const hourly = s.res === "1h";
    const slots = hourly ? 24 : 96;
    const slotOf = x => {
      const [h, mnt] = timeKey(x).split(":").map(Number);
      return hourly ? h : h * 4 + mnt / 15;
    };
    const profile = map => {
      const acc = Array.from({ length: slots }, () => [0, 0]);
      for (const [x, v] of map) {
        if (this.excluded(dateKey(x))) continue;
        const i = slotOf(x);
        acc[i][0] += v; acc[i][1] += 1;
      }
      return acc.map(([sum, n]) => (n ? sum / n : null));
    };

    const categories = Array.from({ length: slots }, (_, i) => (hourly
      ? `${String(i).padStart(2, "0")}:00`
      : `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`));
    const current = profile(actualMap);
    const prev = lookups.map(profile);
    const n = Number(s.n);
    const pts = arr => arr.map((v, i) => [i, v == null ? null : v / 1000]).filter(p => p[1] != null);
    const series = [];

    if (s.band === "1") {
      const band = [];
      for (let i = 0; i < slots; i++) {
        const values = prev.slice(0, n).map(p => p[i]).filter(v => v != null);
        if (values.length >= 2) band.push([i, Math.min(...values) / 1000, Math.max(...values) / 1000]);
      }
      if (band.length) series.push({ name: `Range ${this.yearsLabel()}`, colour: "--s-band", type: "band", data: band, unit: "GW" });
    }
    if (s.avg === "1") {
      const avg = [];
      for (let i = 0; i < slots; i++) {
        const values = prev.slice(0, n).map(p => p[i]).filter(v => v != null);
        if (values.length) avg.push([i, values.reduce((a, b) => a + b, 0) / values.length / 1000]);
      }
      series.push({ name: this.avgName(), colour: "--s-avg", type: "line", data: avg, dashed: true, width: 1.6, unit: "GW" });
    }
    if (s.ly === "1" && prev[0]) series.push({ name: this.lastYearName(), colour: "--s-ly", type: "line", data: pts(prev[0]), width: 1.5, unit: "GW" });
    series.push({ name: "Actual", colour: "--s-actual", type: "line", data: pts(current), width: 2.6, unit: "GW", z: 20 });

    notes.push(`Each point is the average for that ${hourly ? "hour" : "quarter-hour"} of the day across every day in the period (Paris local time). Choose Hourly resolution for an hourly profile. The profile uses actual data only.`);

    return {
      title: `Average daily profile, ${hourly ? "hourly" : "15-minute"}`,
      subtitle: `${fmtPeriod(s.from, s.to)} · GW`,
      spec: { xType: "category", categories, xLabel: x => x, xHeader: "Time of day (Europe/Paris)", yName: "GW", series, legendCaption: "Average across the times of day in view" }
    };
  }

  // ---------- Summary, explainer, ranking ----------

  /** Hours-weighted aggregate of a measure over days. */
  aggregate(entries) {
    if (!entries.length) return null;
    const m = this.state.measure;
    if (m === "max") return Math.max(...entries.map(e => e.v));
    if (m === "min") return Math.min(...entries.map(e => e.v));
    if (m === "energy") return entries.reduce((a, e) => a + e.v, 0);
    return entries.reduce((a, e) => a + e.v * e.h, 0) / entries.reduce((a, e) => a + e.h, 0);
  }

  fmtMeasure(v) {
    if (v == null) return "–";
    if (this.state.measure === "energy") return v >= 1000 ? `${fmtNumber(v / 1000, 2)} TWh` : `${fmtNumber(v, 0)} GWh`;
    return fmtGW(v, 1);
  }

  /** Compare this period's days with earlier years, like-for-like. */
  versus(entries, years) {
    const s = this.state;
    const daily = this.dailyCache;
    const cur = [];
    const cmp = [];
    for (const e of entries) {
      const vals = years.map(k => {
        const src = alignDate(e.date, k, s.align);
        if (!src || this.excluded(src)) return null;
        const r = daily.byDate.get(src);
        return r && r.mean_mw != null ? this.pick({ mean: r.mean_mw, max: r.max_mw, min: r.min_mw, energy: r.energy_gwh ?? r.mean_mw * r.hours / 1000 }) : null;
      }).filter(v => v != null);
      if (!vals.length) continue;
      cur.push(e);
      cmp.push({ v: vals.reduce((a, b) => a + b, 0) / vals.length, h: e.h });
    }
    if (!cur.length) return null;
    const a = this.aggregate(cur);
    const b = this.aggregate(cmp);
    return { cur: a, cmp: b, pct: (a / b - 1) * 100 };
  }

  renderSummary(period) {
    const s = this.state;
    this.dailyCache = period.daily;
    const all = [...period.days].map(([date, st]) => ({ date, v: this.pick(st), h: st.hours, st }));
    const actualOnly = all.filter(e => e.st.kind !== "forecast" || e.st.actual).map(e => (e.st.kind === "forecast"
      ? { ...e, v: this.pick({ ...e.st.actual, energy: e.st.actual.mean * e.h / 1000 }), st: { ...e.st.actual, peakText: e.st.peakText, minText: e.st.minText } }
      : e));
    if (!all.length) {
      this.headline.textContent = "No demand data for this period.";
      this.cards.innerHTML = "";
      return;
    }

    const n = Number(s.n);
    const avgYears = Array.from({ length: n }, (_, i) => i + 1);
    const label = MEASURE_LABEL[s.measure].toLowerCase();
    const hasForecast = period.useForecast && all.some(e => e.st.kind === "forecast");
    const base = hasForecast ? all : actualOnly;
    const total = this.aggregate(base);
    const vsAvg = s.avg === "1" || s.band === "1" ? this.versus(base, avgYears) : null;
    const vsLy = s.ly === "1" ? this.versus(base, [1]) : null;
    const so = this.aggregate(actualOnly);
    const dir = v => (v >= 0 ? "above" : "below");
    const verb = s.measure === "energy" ? "totalled" : s.measure === "max" ? "reached" : "was";

    const comparisons = [];
    if (vsAvg) comparisons.push(`${fmtNumber(Math.abs(vsAvg.pct), 1)}% ${dir(vsAvg.pct)} ${this.multiYear() ? `the average of the previous ${n} years` : `the ${this.yearsLabel()} average`} for the same ${s.align === "cal" ? "dates" : "weekdays"}`);
    if (vsLy) comparisons.push(`${fmtNumber(Math.abs(vsLy.pct), 1)}% ${dir(vsLy.pct)} ${this.multiYear() ? "the same period a year earlier" : "last year"}`);
    const tail = comparisons.length ? `, ${comparisons.join(" and ")}` : "";

    let text;
    if (hasForecast) {
      const lastActualDay = actualOnly.length ? actualOnly[actualOnly.length - 1].date : s.from;
      const soFar = actualOnly.length ? `${MEASURE_LABEL[s.measure]} ${fmtFromTo(s.from, lastActualDay)} ${verb} ${this.fmtMeasure(so)}. ` : "";
      text = `${soFar}Including RTE's forecasts to ${fmtLongDate(s.to)}, ${label} for the whole period is on track for ${this.fmtMeasure(total)}${tail}.`;
    } else {
      text = `${MEASURE_LABEL[s.measure]} ${fmtFromTo(s.from, s.to)} ${verb} ${this.fmtMeasure(total)}${tail}.`;
    }
    if (s.hol === "excl") text = text.replace(/\.$/, " (public holidays excluded).");
    this.headline.textContent = text;

    const peakSrc = actualOnly.reduce((a, e) => (!a || e.st.max > a.st.max ? e : a), null);
    const lowSrc = actualOnly.reduce((a, e) => (!a || e.st.min < a.st.min ? e : a), null);
    const energy = base.reduce((a, e) => a + (e.st.energy ?? e.st.mean * e.h / 1000), 0);
    const card = (lbl, value, detail = "", cls = "") =>
      `<div class="card${cls}"><div class="label">${lbl}</div><div class="value">${value}</div><div class="detail">${detail}</div></div>`;

    this.cards.innerHTML = [
      hasForecast
        ? card("Projected for the period", this.fmtMeasure(total), `Actual to date plus forecast to ${fmtShortDate(s.to)}`, " accent")
        : card(MEASURE_LABEL[s.measure], this.fmtMeasure(total), s.to >= period.lastDate ? "Actual, period so far" : "Actual"),
      hasForecast ? card("Actual so far", this.fmtMeasure(so), `${fmtShortDate(s.from)} to ${fmtTime(period.lastActual + QUARTER)} on ${fmtShortDate(dateKey(period.lastActual))}`) : "",
      vsAvg ? card(`vs ${this.multiYear() ? `previous ${n}-year average` : `${this.yearsLabel()} average`}`, fmtPct(vsAvg.pct), `${this.fmtMeasure(vsAvg.cmp)} like-for-like`) : "",
      vsLy ? card(this.multiYear() ? "vs a year earlier" : "vs last year", fmtPct(vsLy.pct), `${this.fmtMeasure(vsLy.cmp)} like-for-like`) : "",
      peakSrc ? card("Peak", fmtGW(peakSrc.st.max), peakSrc.st.peakText || "") : "",
      lowSrc ? card("Minimum", fmtGW(lowSrc.st.min), lowSrc.st.minText || "") : "",
      s.measure !== "energy" ? card(hasForecast ? "Energy (projected)" : "Energy", energy >= 1000 ? `${fmtNumber(energy / 1000, 2)} TWh` : `${fmtNumber(energy, 0)} GWh`, hasForecast ? "Actual plus forecast" : "") : ""
    ].join("");
  }

  renderExplain(period) {
    const s = this.state;
    if (!period.useForecast || s.profile === "1") { this.explain.hidden = true; return; }
    const sources = new Set(period.forecast.source.values());
    this.explain.hidden = false;
    this.explain.innerHTML = `<b>Actual and forecast.</b> The solid line is actual demand up to ${fmtDateTime(period.lastActual + QUARTER)}. The dashed line continues with RTE's latest forecasts to ${fmtLongDate(s.to)} (${[...sources].join(", ")}). Earlier years cover the whole period, so you can see where this period is heading against them.`;
  }

  renderRanking(period) {
    const s = this.state;
    const days = daysBetween(s.from, s.to) + 1;
    if (s.profile === "1" || days > 366) {
      this.rankPanel.show(false);
      return;
    }
    this.rankPanel.show(true);
    const daily = period.daily;
    const thisYear = Number(s.from.slice(0, 4));
    const rows = [];

    for (let k = 0; thisYear - k >= 2013; k++) {
      const entries = [];
      let expected = 0;
      for (const date of dateRange(s.from, s.to)) {
        if (this.excluded(date)) continue;
        expected += 1;
        if (k === 0) {
          const st = period.days.get(date);
          if (st) entries.push({ v: this.pick(st), h: st.hours });
          continue;
        }
        const src = alignDate(date, k, s.align);
        if (!src || src < FIRST_DATE || this.excluded(src)) continue;
        const r = daily.byDate.get(src);
        if (r && r.mean_mw != null && r.intervals >= 0.9 * r.expected_intervals) {
          entries.push({ v: this.pick({ mean: r.mean_mw, max: r.max_mw, min: r.min_mw, energy: r.energy_gwh ?? r.mean_mw * r.hours / 1000 }), h: r.hours });
        }
      }
      if (entries.length < 0.9 * expected) continue;
      const startDate = k === 0 ? s.from : alignDate(s.from, k, s.align) ?? alignDate(addDays(s.from, 1), k, s.align);
      const yearLabel = s.from.slice(0, 4) === s.to.slice(0, 4) ? startDate.slice(0, 4) : `${startDate.slice(0, 4)}–${String(Number(startDate.slice(0, 4)) + 1).slice(-2)}`;
      rows.push({ k, label: yearLabel, value: this.aggregate(entries) });
    }

    rows.reverse();
    const scale = s.measure === "energy" ? 1000 : 1000;
    const unit = s.measure === "energy" ? "TWh" : "GW";
    const current = rows.find(r => r.k === 0);
    const n = Number(s.n);
    const sortedDesc = [...rows].sort((a, b) => b.value - a.value);
    const rankHigh = current ? sortedDesc.indexOf(current) + 1 : null;
    const rankLow = current ? rows.length - rankHigh + 1 : null;
    const forecastNote = period.useForecast ? " (including forecast)" : s.to >= period.lastDate ? " (so far)" : "";
    const rankText = current
      ? (rankLow <= rankHigh ? `${rankLow === 1 ? "" : `${ordinal(rankLow)} `}lowest` : `${rankHigh === 1 ? "" : `${ordinal(rankHigh)} `}highest`) + ` of ${rows.length} years`
      : "";
    const measure = MEASURE_LABEL[s.measure].toLowerCase();

    this.rankPanel.setTitle(
      current ? `${fmtPeriod(s.from, s.to)}: ${rankText}` : "The same period in every year",
      `${MEASURE_LABEL[s.measure]} for the same ${s.align === "cal" ? "dates" : "weekdays"} in each year since 2013${forecastNote} · ${unit}`
    );
    const colourFor = (_, i) => {
      const r = rows[i];
      if (!r) return "--s-avg";
      if (r.k === 0) return "--s-actual";
      return r.k <= n ? "--s-avg" : "--s-band";
    };
    this.rankPanel.render({
      xType: "category", categories: rows.map(r => r.label + (r.k === 0 && period.useForecast ? "*" : "")),
      xLabel: x => x, xHeader: "Year", yName: unit, yMin: 0, yScale: false,
      yFormat: v => fmtNumber(v, 0),
      series: [{
        name: `${MEASURE_LABEL[s.measure]}, same period`, colour: "--s-actual", type: "bar",
        data: rows.map((r, i) => [i, r.value / scale]), unit, decimals: 2, colourFn: colourFor, avg: false, barWidth: 34,
        labels: v => fmtNumber(v, s.measure === "energy" ? 1 : 1),
        barColours: i => colourFor(null, i)
      }],
      legendCaption: null,
      notes: [
        `Highlighted: this period${forecastNote}. Mid-tone bars are the years used for the ${this.yearsLabel()} average. Years with less than 90% of days available are left out.`,
        period.useForecast ? "* Includes RTE's forecast for the days still to come." : "",
        current ? `This period's ${measure} ranks ${rankText}.` : ""
      ]
    });
  }

  refreshTheme() {
    this.panel.refreshTheme();
    this.rankPanel.refreshTheme();
  }
}
