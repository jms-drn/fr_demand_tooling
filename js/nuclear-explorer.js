// Nuclear explorer: availability, output, unavailable capacity, load factor and
// reactors offline for any period since Dec 2010 (output since Dec 2014),
// compared with the same period in earlier years, for the whole fleet or one
// site or reactor series. Periods can run into the future using the outlook
// from the current notices.

import { ChartPanel } from "./chart.js";
import { parseUtc } from "./data.js";
import { eventsBetween } from "./events.js";
import { shiftMsYears } from "./nuclear-common.js";
import { getFleet, getLive, getNuclearDaily, getNuclearHourly, getUnitDaily } from "./power-data.js";
import {
  HOUR, addDays, alignDate, copyText, csvDate, csvDateTime, dateKey, dateRange, daysBetween, fmtDate, fmtDateTime,
  fmtFromTo, fmtLongDate, fmtMonth, fmtNumber, fmtPct, fmtPeriod, heroHtml, ordinal, parisMidnight, todayParis,
  weekStart, writeHash
} from "./util.js";

const FIRST_DATE = "2011-01-01";
const OUTPUT_FIRST = "2014-12-15";
const MAX_1H_DAYS = 400;

const MEASURES = {
  avail: { label: "Available capacity", unit: "GW", short: "availability" },
  off: { label: "Unavailable capacity", unit: "GW", short: "unavailable capacity" },
  avpct: { label: "Availability rate", unit: "%", short: "availability rate" },
  output: { label: "Nuclear output", unit: "GW", short: "output" },
  lf: { label: "Load factor", unit: "%", short: "load factor" },
  offline: { label: "Reactors offline", unit: "reactors", short: "reactors offline" }
};
const RES_LABEL = { "1h": "hourly", "1d": "daily", "1w": "weekly", "1M": "monthly" };

function defaults() {
  return {
    preset: "ytd", from: "", to: "", res: "1d", measure: "avail", scope: "fleet",
    ly: "1", avg: "1", band: "1", n: "5", align: "cal", fc: "1", split: "1", ev: "0", view: "abs", ref: "avg"
  };
}

export class NuclearExplorer {
  constructor(root) {
    this.root = root;
    this.state = defaults();
    this.renderId = 0;
    this.build();
    this.applyPreset();
  }

  presetRange(preset) {
    const today = todayParis();
    const y = Number(today.slice(0, 4));
    const monthStart = `${today.slice(0, 7)}-01`;
    const winterStartYear = Number(today.slice(5, 7)) >= 7 ? y : y - 1;
    switch (preset) {
      case "mtd": return [monthStart, today];
      case "last30": return [addDays(today, -29), today];
      case "last90": return [addDays(today, -89), today];
      case "ytd": return [`${y}-01-01`, today];
      case "year": return [`${y}-01-01`, `${y}-12-31`];
      case "last365": return [addDays(today, -364), today];
      case "lastyear": return [`${y - 1}-01-01`, `${y - 1}-12-31`];
      case "winter": return [`${winterStartYear}-11-01`, `${winterStartYear + 1}-03-31`];
      case "next90": return [addDays(today, -30), addDays(today, 90)];
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

  chip(key, label, colour) {
    return `<button class="chip" type="button" data-chip="${key}" style="color:var(${colour})"><span class="swatch"></span><span class="chip-label">${label}</span></button>`;
  }

  build() {
    this.root.innerHTML = `
      ${heroHtml("Explore nuclear availability,", "since 2011.", "Available and unavailable nuclear capacity, output and reactors offline for any period, from hourly detail to monthly averages, compared with the same period in earlier years. Narrow it to one site or reactor series, or run the period into the months ahead using the current outage notices.")}
      <div class="toolbar" role="group" aria-label="Explorer settings">
        <div class="toolbar-row">
          <label class="field"><span>Period</span>
            <select data-k="preset">
              <option value="mtd">Month to date</option><option value="last30">Last 30 days</option><option value="last90">Last 90 days</option>
              <option value="ytd">Year to date</option><option value="year">This year, with outlook</option><option value="next90">Last 30 days and next 90</option>
              <option value="winter">This winter (Nov–Mar)</option><option value="last365">Last 365 days</option><option value="lastyear">Last calendar year</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label class="field"><span>From</span><input type="date" data-k="from" min="${FIRST_DATE}"></label>
          <label class="field"><span>To</span><input type="date" data-k="to" min="${FIRST_DATE}"></label>
          <label class="field"><span>Resolution</span>
            <select data-k="res"><option value="1h">Hourly</option><option value="1d">Daily</option><option value="1w">Weekly</option><option value="1M">Monthly</option></select>
          </label>
          <label class="field"><span>Measure</span>
            <select data-k="measure">${Object.entries(MEASURES).map(([k, m]) => `<option value="${k}">${m.label}${m.unit === "GW" ? " (GW)" : m.unit === "%" ? " (%)" : ""}</option>`).join("")}</select>
          </label>
          <label class="field"><span>Reactors</span><select data-k="scope" data-scope></select></label>
          <label class="field"><span>Show</span>
            <select data-k="view"><option value="abs">Values</option><option value="diff">Difference</option><option value="pct">Difference (%)</option></select>
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
                ${[2, 3, 4, 5, 8, 10].map(n => `<option value="${n}">${n} years</option>`).join("")}
              </select>
              ${this.chip("band", "Min–max range", "--s-avg")}
            </div>
          </div>
          <label class="field"><span>Align by</span>
            <select data-k="align"><option value="cal">Calendar date</option><option value="wd">Weekday</option></select>
          </label>
          <div class="field"><span>Overlays</span>
            <div class="chips">
              ${this.chip("fc", "Expected ahead", "--s-fcst")}
              ${this.chip("split", "Planned / unplanned", "--st-planned")}
              ${this.chip("ev", "Events", "--muted")}
            </div>
          </div>
        </div>
      </div>
      <div class="headline"><p data-headline>Loading…</p><button class="btn ghost small" type="button" data-copy title="Copy this sentence">Copy</button></div>
      <div class="cards" data-cards>${'<div class="card skeleton"></div>'.repeat(5)}</div>
      <div data-chart></div>
      <div data-rank></div>`;

    this.headline = this.root.querySelector("[data-headline]");
    this.cards = this.root.querySelector("[data-cards]");
    this.panel = new ChartPanel(this.root.querySelector("[data-chart]"), { title: "Nuclear", size: "tall", overview: true });
    this.rankPanel = new ChartPanel(this.root.querySelector("[data-rank]"), { title: "The same period in every year", size: "short" });
    this.root.querySelector("[data-copy]").addEventListener("click", () => copyText(this.headline.textContent));

    this.root.querySelectorAll("[data-k]").forEach(input => input.addEventListener("change", () => {
      const key = input.dataset.k;
      this.state[key] = input.value;
      if (key === "preset" && input.value !== "custom") this.applyPreset();
      if (key === "from" || key === "to") this.state.preset = "custom";
      if (this.state.from > this.state.to) [this.state.from, this.state.to] = [this.state.to, this.state.from];
      this.syncControls();
      this.update();
    }));
    this.root.querySelectorAll("[data-chip]").forEach(chip => chip.addEventListener("click", () => {
      const key = chip.dataset.chip;
      this.state[key] = this.state[key] === "1" ? "0" : "1";
      this.syncControls();
      this.update();
    }));
  }

  async fillScopes() {
    if (this.scopesFilled) return;
    const fleet = await getFleet();
    const sites = [...new Set(fleet.reactors.map(r => r.site))].sort();
    this.root.querySelector("[data-scope]").innerHTML = `<option value="fleet">Whole fleet</option>
      <optgroup label="Reactor series">${fleet.series.map(s => `<option value="series:${s}">${s}</option>`).join("")}</optgroup>
      <optgroup label="Site">${sites.map(s => `<option value="site:${s}">${s}</option>`).join("")}</optgroup>`;
    this.scopesFilled = true;
    this.syncControls();
  }

  syncControls() {
    const s = this.state;
    this.root.querySelectorAll("[data-k]").forEach(input => { if (input.querySelector?.(`option[value="${CSS.escape(s[input.dataset.k])}"]`) || input.type === "date") input.value = s[input.dataset.k]; });
    this.root.querySelectorAll("[data-chip]").forEach(chip => chip.setAttribute("aria-pressed", s[chip.dataset.chip] === "1"));
    const diff = s.view !== "abs";
    this.root.querySelector("[data-ref-field]").classList.toggle("hidden", !diff);
    this.root.querySelector('[data-chip="band"]').disabled = diff;
    this.root.querySelector('[data-chip="split"]').disabled = s.measure !== "off" || diff || s.scope !== "fleet";
    this.root.querySelector('[data-chip="fc"]').disabled = ["output", "lf", "offline"].includes(s.measure);
    this.root.querySelector('[data-k="scope"]').disabled = !["avail", "off", "avpct"].includes(s.measure);
  }

  activate() {
    this.fillScopes().then(() => this.update());
  }

  // ---------- Data ----------

  measureOf(row, m) {
    if (!row) return null;
    switch (m) {
      case "avail": return row.available_mw;
      case "off": return row.planned_off_mw != null ? row.planned_off_mw + row.unplanned_off_mw : row.installed_mw - row.available_mw;
      case "avpct": return row.installed_mw ? 100 * row.available_mw / row.installed_mw : null;
      case "output": return row.output_mw;
      case "lf": return row.output_mw != null && row.installed_mw ? 100 * row.output_mw / row.installed_mw : null;
      case "offline": return row.offline_reactors;
      default: return null;
    }
  }

  scale(m) {
    return MEASURES[m].unit === "GW" ? 1000 : 1;
  }

  /** Reactors in the chosen scope. */
  scopeReactors() {
    const [kind, value] = this.state.scope.split(/:(.*)/s);
    if (kind === "site") return this.fleet.reactors.filter(r => r.site === value);
    if (kind === "series") return this.fleet.reactors.filter(r => r.series === value);
    return null;
  }

  scopeName() {
    const s = this.state.scope;
    if (s === "fleet") return "the fleet";
    const [kind, value] = s.split(/:(.*)/s);
    return kind === "site" ? `${value}` : `the ${value} series`;
  }

  /** Daily rows (fleet, or summed over the scope's reactors) for a date range. */
  async dailyRows(from, to) {
    const reactors = ["avail", "off", "avpct"].includes(this.state.measure) ? this.scopeReactors() : null;
    if (!reactors) {
      const daily = await getNuclearDaily();
      return new Map(dateRange(from, to).map(d => [d, daily.byDate.get(d)]).filter(([, r]) => r));
    }
    const unit = await getUnitDaily(from, to);
    const out = new Map();
    for (const [date, values] of unit) {
      let avail = 0;
      let installed = 0;
      for (const r of reactors) {
        if (values[r.name] == null) continue;
        avail += values[r.name];
        installed += r.mw;
      }
      if (installed) out.set(date, { available_mw: avail, installed_mw: installed, planned_off_mw: null, unplanned_off_mw: null });
    }
    return out;
  }

  /** Expected daily values after today from the live outlook (fleet only). */
  async expectedRows() {
    const live = await getLive();
    const values = live.outlook.mw10.split(" ").map(v => Number(v) * 10);
    const installed = live.fleet.installed_mw;
    return new Map(values.map((v, i) => [addDays(live.outlook.first_target, i), { available_mw: v, installed_mw: installed, expected: true }]));
  }

  // ---------- Render ----------

  async update() {
    const id = ++this.renderId;
    const s = this.state;
    writeHash("nuclear/explorer", s);
    this.panel.setLoading(true);
    this.headline.textContent = "Loading…";
    try {
      this.fleet = await getFleet();
      const today = todayParis();
      const notes = [];
      const m = s.measure;
      let from = s.from < FIRST_DATE ? FIRST_DATE : s.from;
      if (["output", "lf"].includes(m) && from < OUTPUT_FIRST) {
        from = OUTPUT_FIRST;
        notes.push("RTE's nuclear output data starts on 15 Dec 2014.");
      }
      const days = daysBetween(from, s.to) + 1;
      let res = s.res;
      const scoped = s.scope !== "fleet" && ["avail", "off", "avpct"].includes(m);
      if (res === "1h" && (days > MAX_1H_DAYS || scoped || m === "offline")) {
        notes.push(scoped ? "Site and series views are daily, so this is shown daily." : m === "offline" ? "Reactors offline are counted per day." : "Hourly views are limited to about a year, so this period is shown daily.");
        res = "1d";
      }
      const result = res === "1h" ? await this.buildHourly(from, today, notes) : await this.buildDaily(from, res, today, notes);
      if (id !== this.renderId) return;
      this.panel.setTitle(result.title, result.subtitle);
      this.panel.render(result.spec);
      this.renderSummary(result.summary, from);
      await this.renderRanking(from, today);
    } catch (error) {
      console.error(error);
      if (id === this.renderId) {
        this.headline.textContent = `The data could not be loaded (${error.message}).`;
        this.panel.setLoading(false);
      }
    }
  }

  yearsNeeded() {
    const s = this.state;
    const diffAvg = s.view !== "abs" && s.ref === "avg";
    return Math.max(s.ly === "1" || (s.view !== "abs" && s.ref === "ly") ? 1 : 0, s.avg === "1" || s.band === "1" || diffAvg ? Number(s.n) : 0);
  }

  yearsLabel(from) {
    const n = Number(this.state.n);
    const y = Number(from.slice(0, 4));
    return from.slice(0, 4) !== this.state.to.slice(0, 4) ? `previous ${n} years` : `${y - n}–${String(y - 1).slice(-2)}`;
  }

  groupKey(date, res) {
    return res === "1w" ? weekStart(date) : res === "1M" ? `${date.slice(0, 7)}-01` : date;
  }

  group(map, res) {
    if (res === "1d") return map;
    const acc = new Map();
    for (const [d, v] of map) {
      const k = this.groupKey(d, res);
      if (!acc.has(k)) acc.set(k, []);
      acc.get(k).push(v);
    }
    return new Map([...acc].map(([k, vs]) => [k, vs.reduce((a, b) => a + b, 0) / vs.length]));
  }

  combine(perYear, keys, n) {
    const ly = new Map();
    const avg = new Map();
    const band = new Map();
    for (const key of keys) {
      const v1 = perYear[0]?.get(key);
      if (v1 != null) ly.set(key, v1);
      const values = perYear.slice(0, n).map(map => map?.get(key)).filter(v => v != null);
      if (values.length) avg.set(key, values.reduce((a, b) => a + b, 0) / values.length);
      if (values.length >= 2) band.set(key, [Math.min(...values), Math.max(...values)]);
    }
    return { ly, avg, band };
  }

  async buildDaily(from, res, today, notes) {
    const s = this.state;
    const m = s.measure;
    const sc = this.scale(m);
    const years = this.yearsNeeded();
    const rows = await this.dailyRows(from, s.to < today ? s.to : today);
    const useFc = s.fc === "1" && s.to > today && !["output", "lf", "offline"].includes(m) && s.scope === "fleet";
    const expected = useFc ? await this.expectedRows() : new Map();

    const actual = new Map();
    const fc = new Map();
    const planned = new Map();
    const unplanned = new Map();
    for (const d of dateRange(from, s.to)) {
      const r = d <= today ? rows.get(d) : expected.get(d);
      const v = this.measureOf(r, m);
      if (v == null) continue;
      (r.expected ? fc : actual).set(d, v);
      if (m === "off" && r.planned_off_mw != null) { planned.set(d, r.planned_off_mw); unplanned.set(d, r.unplanned_off_mw); }
    }

    // Earlier years, aligned to this period's dates.
    const perYear = [];
    for (let k = 1; k <= years; k++) {
      const start = alignDate(from, k, s.align) ?? alignDate(addDays(from, 1), k, s.align);
      const end = alignDate(s.to, k, s.align) ?? alignDate(addDays(s.to, -1), k, s.align);
      if (end < FIRST_DATE) { perYear.push(new Map()); continue; }
      const src = await this.dailyRows(start < FIRST_DATE ? FIRST_DATE : start, end);
      const map = new Map();
      for (const d of dateRange(from, s.to)) {
        const a = alignDate(d, k, s.align);
        const v = a ? this.measureOf(src.get(a), m) : null;
        if (v != null) map.set(d, v);
      }
      perYear.push(map);
    }

    const keysDaily = dateRange(from, s.to);
    const g = map => this.group(map, res);
    const allVals = new Map([...actual, ...fc]);
    const grouped = g(allVals);
    const fcGroups = new Set([...fc.keys()].map(d => this.groupKey(d, res)));
    const actualG = new Map([...grouped].filter(([k]) => !fcGroups.has(k)));
    const fcG = new Map([...grouped].filter(([k]) => fcGroups.has(k)));
    const yearsG = perYear.map(g);
    const keys = [...new Set(keysDaily.map(d => this.groupKey(d, res)))];
    const { ly, avg, band } = this.combine(yearsG, keys, Number(s.n));
    const pts = map => [...map].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [parisMidnight(k), v / sc]);
    const unit = MEASURES[m].unit === "reactors" ? "" : MEASURES[m].unit;
    const decimals = m === "offline" ? 1 : 2;
    const markers = res !== "1d" ? true : undefined;
    const diff = s.view !== "abs";
    const yearsLabel = this.yearsLabel(from);

    let series = [];
    let yName = MEASURES[m].unit;
    if (diff) {
      const ref = s.ref === "ly" ? ly : avg;
      const pct = s.view === "pct";
      const d = map => pts(map).map(([x, v]) => {
        const r = ref.get(dateKey(x));
        return r == null ? null : [x, pct ? (v / (r / sc) - 1) * 100 : v - r / sc];
      }).filter(Boolean);
      yName = pct ? "%" : yName;
      const refName = s.ref === "ly" ? "last year" : `the ${yearsLabel} average`;
      series.push({ name: `Actual vs ${refName}`, colour: "--s-actual", type: "bar", data: d(actualG), unit: pct ? "%" : unit, decimals: pct ? 1 : decimals });
      if (fcG.size) series.push({ name: `Expected vs ${refName}`, colour: "--s-fcst", type: "bar", data: d(fcG), unit: pct ? "%" : unit, decimals: pct ? 1 : decimals });
    } else {
      if (s.band === "1" && band.size) series.push({ name: `Range ${yearsLabel}`, colour: "--s-band", type: "band", data: [...band].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, [lo, hi]]) => [parisMidnight(k), lo / sc, hi / sc]), unit, decimals });
      if (s.avg === "1" && avg.size) series.push({ name: `Average ${yearsLabel}`, colour: "--s-avg", type: "line", data: pts(avg), dashed: true, width: 1.6, unit, decimals, symbols: markers });
      if (s.ly === "1" && ly.size) series.push({ name: from.slice(0, 4) === s.to.slice(0, 4) ? `Last year (${Number(from.slice(0, 4)) - 1})` : "One year earlier", colour: "--s-ly", type: "line", data: pts(ly), width: 1.5, unit, decimals, symbols: markers });
      if (m === "off" && s.split === "1" && planned.size && s.scope === "fleet") {
        series.push({ name: "Planned", colour: "--st-planned", type: "line", stack: "off", data: pts(g(planned)), width: 0.8, unit, decimals, z: 5, symbols: false });
        series.push({ name: "Unplanned", colour: "--st-unplanned", type: "line", stack: "off", data: pts(g(unplanned)), width: 0.8, unit, decimals, z: 5, symbols: false });
      }
      let fcPts = pts(fcG);
      const aPts = pts(actualG);
      if (fcPts.length && aPts.length) fcPts = [aPts.at(-1), ...fcPts];
      if (fcPts.length) series.push({ name: "Expected (current notices)", colour: "--s-fcst", type: "line", data: fcPts, dashed: true, width: 2.4, unit, decimals, z: 19, symbols: markers });
      series.push({ name: MEASURES[m].label, colour: "--s-actual", type: "line", data: aPts, width: 2.6, unit, decimals, z: 20, symbols: markers });
    }

    if (useFc) notes.push("After today, the dashed line is the availability implied by the outage notices published so far. Unplanned outages that have not happened yet are missing, so it tends to be optimistic.");
    if (years) notes.push(s.align === "cal" ? "Earlier years use the same calendar dates." : "Earlier years use the same weekday (364 days earlier per year).");
    if (m === "off" && s.split === "1" && s.scope === "fleet" && !diff) notes.push("Shaded areas split the unavailable capacity into planned and unplanned outages (stacked). Where they overlap on one reactor, the overlap counts as planned.");
    if (res !== "1d") notes.push(`Each point is the average of the days in that ${res === "1w" ? "week" : "month"} inside the period.`);
    if (s.scope !== "fleet" && ["avail", "off", "avpct"].includes(m)) notes.push(`Only reactors in ${this.scopeName()} are included. Expected values ahead are only available for the whole fleet.`);
    if (m === "offline") notes.push("A reactor counts as offline on a day when its average availability is below 10% of its capacity.");
    if (from < "2015-01-01" && ["avail", "off", "avpct", "offline"].includes(m)) notes.push("Notices before 2015 (when the EU's REMIT transparency rules took full effect) may be less complete, so early availability can look higher than it was.");

    const xLabel = res === "1M" ? x => fmtMonth(x) : res === "1w" ? x => `Week of ${fmtDate(x)}` : x => fmtDate(x);
    const label = MEASURES[m].label;
    return {
      title: diff ? `${label}: difference from ${s.ref === "ly" ? "last year" : "earlier years"}, ${RES_LABEL[res]}` : `${label}, ${RES_LABEL[res]}${s.scope !== "fleet" ? ` · ${this.scopeName()}` : ""}`,
      subtitle: `${fmtPeriod(from, s.to)} · ${yName}`,
      spec: {
        xType: "time", xLabel, csvLabel: csvDate, axisLabel: res === "1M" ? x => fmtMonth(x) : undefined,
        xHeader: res === "1M" ? "Month" : res === "1w" ? "Week starting" : "Date",
        yName, series, zeroLine: diff, yFormat: v => fmtNumber(v, Number.isInteger(v) ? 0 : 1),
        yMin: m === "off" || m === "offline" ? 0 : undefined,
        events: s.ev === "1" ? eventsBetween(from, s.to) : [], notes,
        markAreas: s.to > today ? [{ from: parisMidnight(addDays(today, 1)), to: parisMidnight(addDays(s.to, 1)), label: "Expected", colour: "--today" }] : []
      },
      summary: { actual, fc, perYear, unit, sc, m }
    };
  }

  async buildHourly(from, today, notes) {
    const s = this.state;
    const m = s.measure;
    const sc = this.scale(m);
    const years = this.yearsNeeded();
    const pick = r => {
      if (!r) return null;
      switch (m) {
        case "avail": return r.available;
        case "off": return r.planned + r.unplanned;
        case "avpct": return r.installed ? 100 * r.available / r.installed : null;
        case "output": return r.output;
        case "lf": return r.output != null && r.installed ? 100 * r.output / r.installed : null;
        default: return null;
      }
    };
    const rows = await getNuclearHourly(from, s.to < today ? s.to : today);
    const actual = new Map(rows.map(r => [r.x, pick(r)]).filter(([, v]) => v != null));
    const fc = new Map();
    if (s.fc === "1" && s.to >= today && ["avail", "off", "avpct"].includes(m)) {
      const live = await getLive();
      const start = parseUtc(live.next14.start_utc);
      const lastActual = Math.max(...actual.keys(), 0);
      live.next14.available_mw.forEach((v, i) => {
        const x = start + i * HOUR;
        if (x <= lastActual || dateKey(x) > s.to) return;
        const inst = live.next14.installed_mw[i];
        const r = { available: v, installed: inst, planned: inst - v, unplanned: 0 };
        fc.set(x, pick(r));
      });
      if (addDays(today, 14) < s.to) notes.push("Hourly expected values only run 14 days ahead; switch to daily for the full outlook.");
    }
    const planned = new Map(m === "off" ? rows.map(r => [r.x, r.planned]) : []);
    const unplanned = new Map(m === "off" ? rows.map(r => [r.x, r.unplanned]) : []);

    const perYear = [];
    for (let k = 1; k <= years; k++) {
      const start = alignDate(from, k, "cal") ?? addDays(from, -365 * k);
      const end = alignDate(s.to, k, "cal") ?? addDays(s.to, -365 * k);
      const src = end < FIRST_DATE ? [] : await getNuclearHourly(start, end);
      const byX = new Map(src.map(r => [r.x, pick(r)]));
      const map = new Map();
      for (let x = parisMidnight(from); x < parisMidnight(addDays(s.to, 1)); x += HOUR) {
        const sx = shiftMsYears(x, k);
        const v = sx != null ? byX.get(sx) : null;
        if (v != null) map.set(x, v);
      }
      perYear.push(map);
    }
    const keys = [];
    for (let x = parisMidnight(from); x < parisMidnight(addDays(s.to, 1)); x += HOUR) keys.push(x);
    const { ly, avg, band } = this.combine(perYear, keys, Number(s.n));
    const sorted = map => [...map].sort((a, b) => a[0] - b[0]).map(([x, v]) => [x, v / sc]);
    const unit = MEASURES[m].unit;
    const diff = s.view !== "abs";
    const yearsLabel = this.yearsLabel(from);
    const series = [];
    let yName = unit;
    if (diff) {
      const ref = s.ref === "ly" ? ly : avg;
      const pct = s.view === "pct";
      const d = map => sorted(map).map(([x, v]) => {
        const r = ref.get(x);
        return r == null ? null : [x, pct ? (v / (r / sc) - 1) * 100 : v - r / sc];
      }).filter(Boolean);
      yName = pct ? "%" : unit;
      series.push({ name: "Actual vs reference", colour: "--s-actual", type: "line", data: d(actual), unit: yName, decimals: pct ? 1 : 2, width: 2 });
      if (fc.size) series.push({ name: "Expected vs reference", colour: "--s-fcst", type: "line", data: d(fc), unit: yName, decimals: pct ? 1 : 2, dashed: true });
    } else {
      if (s.band === "1" && band.size) series.push({ name: `Range ${yearsLabel}`, colour: "--s-band", type: "band", data: [...band].sort((a, b) => a[0] - b[0]).map(([x, [lo, hi]]) => [x, lo / sc, hi / sc]), unit });
      if (s.avg === "1" && avg.size) series.push({ name: `Average ${yearsLabel}`, colour: "--s-avg", type: "line", data: sorted(avg), dashed: true, width: 1.6, unit });
      if (s.ly === "1" && ly.size) series.push({ name: "Last year", colour: "--s-ly", type: "line", data: sorted(ly), width: 1.5, unit });
      if (m === "off" && s.split === "1") {
        series.push({ name: "Planned", colour: "--st-planned", type: "line", stack: "off", data: sorted(planned), width: 0.8, unit, symbols: false });
        series.push({ name: "Unplanned", colour: "--st-unplanned", type: "line", stack: "off", data: sorted(unplanned), width: 0.8, unit, symbols: false });
      }
      const aPts = sorted(actual);
      let fPts = sorted(fc);
      if (fPts.length && aPts.length) fPts = [aPts.at(-1), ...fPts];
      if (fPts.length) series.push({ name: "Expected (current notices)", colour: "--s-fcst", type: "line", data: fPts, dashed: true, width: 2.4, unit, z: 19 });
      series.push({ name: MEASURES[m].label, colour: "--s-actual", type: "line", data: aPts, width: 2.6, unit, z: 20 });
    }
    notes.push("Earlier years use the same calendar date and Paris clock time.");
    const daily = new Map();
    for (const [x, v] of actual) {
      const d = dateKey(x);
      if (!daily.has(d)) daily.set(d, []);
      daily.get(d).push(v);
    }
    const dayMap = new Map([...daily].map(([d, vs]) => [d, vs.reduce((a, b) => a + b, 0) / vs.length]));
    const dailyYears = perYear.map(map => {
      const acc = new Map();
      for (const [x, v] of map) { const d = dateKey(x); if (!acc.has(d)) acc.set(d, []); acc.get(d).push(v); }
      return new Map([...acc].map(([d, vs]) => [d, vs.reduce((a, b) => a + b, 0) / vs.length]));
    });
    return {
      title: diff ? `${MEASURES[m].label}: difference, hourly` : `${MEASURES[m].label}, hourly`,
      subtitle: `${fmtPeriod(from, s.to)} · ${yName}`,
      spec: {
        xType: "time", xLabel: x => fmtDateTime(x), csvLabel: csvDateTime, yName, series, zeroLine: diff,
        yFormat: v => fmtNumber(v, Number.isInteger(v) ? 0 : 1), yMin: m === "off" ? 0 : undefined, notes,
        events: s.ev === "1" ? eventsBetween(from, s.to) : []
      },
      summary: { actual: dayMap, fc: new Map(), perYear: dailyYears, unit, sc, m }
    };
  }

  fmtValue(v, m) {
    if (v == null) return "–";
    const unit = MEASURES[m].unit;
    if (unit === "GW") return `${fmtNumber(v / 1000, 1)} GW`;
    if (unit === "%") return `${fmtNumber(v, 1)}%`;
    return fmtNumber(v, 1);
  }

  fmtDelta(cur, ref, m) {
    const unit = MEASURES[m].unit;
    const d = cur - ref;
    const sign = d > 0 ? "+" : d < 0 ? "−" : "";
    if (unit === "GW") return `${sign}${fmtNumber(Math.abs(d) / 1000, 1)} GW`;
    if (unit === "%") return `${sign}${fmtNumber(Math.abs(d), 1)} pts`;
    return `${sign}${fmtNumber(Math.abs(d), 1)}`;
  }

  renderSummary(sum, from) {
    const s = this.state;
    const m = sum.m;
    const meanOf = map => (map.size ? [...map.values()].reduce((a, b) => a + b, 0) / map.size : null);
    const all = new Map([...sum.actual, ...sum.fc]);
    if (!all.size) {
      this.headline.textContent = "No data for this period.";
      this.cards.innerHTML = "";
      return;
    }
    const cur = meanOf(all);
    const so = meanOf(sum.actual);
    // Like-for-like: only dates present in both.
    const versus = years => {
      let a = 0; let b = 0; let n = 0;
      for (const [d, v] of all) {
        const vals = years.map(k => sum.perYear[k - 1]?.get(d)).filter(x => x != null);
        if (!vals.length) continue;
        a += v; b += vals.reduce((x, y) => x + y, 0) / vals.length; n += 1;
      }
      return n ? { cur: a / n, ref: b / n } : null;
    };
    const n = Number(s.n);
    const vsAvg = sum.perYear.length >= 1 && (s.avg === "1" || s.band === "1") ? versus(Array.from({ length: Math.min(n, sum.perYear.length) }, (_, i) => i + 1)) : null;
    const vsLy = sum.perYear.length >= 1 && s.ly === "1" ? versus([1]) : null;
    const label = MEASURES[m].label;
    const scope = s.scope === "fleet" ? "" : ` for ${this.scopeName()}`;
    const avgLabel = this.yearsLabel(from);
    const bits = [];
    if (vsAvg) bits.push(`${this.fmtDelta(vsAvg.cur, vsAvg.ref, m).replace(/^\+/, "")} ${vsAvg.cur >= vsAvg.ref ? "above" : "below"} the ${avgLabel} average`);
    if (vsLy) bits.push(`${this.fmtDelta(vsLy.cur, vsLy.ref, m).replace(/^\+/, "")} ${vsLy.cur >= vsLy.ref ? "above" : "below"} last year`);
    const tail = bits.length ? `, ${bits.join(" and ")}` : "";
    const hasFc = sum.fc.size > 0;
    let text = `Average ${MEASURES[m].short}${scope} ${fmtFromTo(from, s.to)} ${hasFc ? "is expected to be" : "was"} ${this.fmtValue(cur, m)}${tail}.`;
    if (hasFc && sum.actual.size) text = `Average ${MEASURES[m].short}${scope} so far is ${this.fmtValue(so, m)}. Including the current notices to ${fmtLongDate(s.to)}, the period is on track for ${this.fmtValue(cur, m)}${tail}.`;
    this.headline.textContent = text.replace(/−/g, "");

    const values = [...sum.actual].filter(([, v]) => v != null);
    const max = values.reduce((a, b) => (!a || b[1] > a[1] ? b : a), null);
    const min = values.reduce((a, b) => (!a || b[1] < a[1] ? b : a), null);
    const card = (l, v, d = "", c = "") => `<div class="card${c}"><div class="label">${l}</div><div class="value">${v}</div><div class="detail">${d}</div></div>`;
    this.cards.innerHTML = [
      card(hasFc ? `${label}, with outlook` : `Average ${MEASURES[m].short}`, this.fmtValue(cur, m), hasFc ? "Actual to date plus current notices" : fmtPeriod(from, s.to), " accent"),
      hasFc && sum.actual.size ? card("Actual so far", this.fmtValue(so, m), "") : "",
      vsAvg ? card(`vs ${avgLabel} average`, this.fmtDelta(vsAvg.cur, vsAvg.ref, m), `${this.fmtValue(vsAvg.ref, m)} like-for-like`) : "",
      vsLy ? card("vs last year", this.fmtDelta(vsLy.cur, vsLy.ref, m), `${this.fmtValue(vsLy.ref, m)} like-for-like`) : "",
      max ? card("Highest day", this.fmtValue(max[1], m), fmtLongDate(max[0])) : "",
      min ? card("Lowest day", this.fmtValue(min[1], m), fmtLongDate(min[0])) : ""
    ].join("");
  }

  async renderRanking(from, today) {
    const s = this.state;
    const m = s.measure;
    const days = daysBetween(from, s.to) + 1;
    if (days > 366) { this.rankPanel.show(false); return; }
    this.rankPanel.show(true);
    const firstYear = ["output", "lf"].includes(m) ? 2015 : 2011;
    const thisYear = Number(from.slice(0, 4));
    const rows = [];
    const useFc = s.fc === "1" && s.to > today && !["output", "lf", "offline"].includes(m) && s.scope === "fleet";
    const expected = useFc ? await this.expectedRows() : new Map();
    for (let k = 0; thisYear - k >= firstYear; k++) {
      const start = k === 0 ? from : alignDate(from, k, s.align) ?? alignDate(addDays(from, 1), k, s.align);
      const end = k === 0 ? s.to : alignDate(s.to, k, s.align) ?? alignDate(addDays(s.to, -1), k, s.align);
      if (start < FIRST_DATE) break;
      const src = await this.dailyRows(start, end < today ? end : today);
      const vals = [];
      for (const d of dateRange(start, end)) {
        const r = d <= today ? src.get(d) : expected.get(d);
        const v = this.measureOf(r, m);
        if (v != null) vals.push(v);
      }
      if (vals.length < 0.9 * days && !(k === 0 && vals.length)) continue;
      const label = from.slice(0, 4) === s.to.slice(0, 4) ? start.slice(0, 4) : `${start.slice(0, 4)}–${end.slice(2, 4)}`;
      rows.push({ k, label, value: vals.reduce((a, b) => a + b, 0) / vals.length });
    }
    rows.reverse();
    const current = rows.find(r => r.k === 0);
    const desc = [...rows].sort((a, b) => b.value - a.value);
    const rankHigh = current ? desc.indexOf(current) + 1 : null;
    const rankLow = current ? rows.length - rankHigh + 1 : null;
    const rankText = current ? (rankLow <= rankHigh ? `${rankLow === 1 ? "" : `${ordinal(rankLow)} `}lowest` : `${rankHigh === 1 ? "" : `${ordinal(rankHigh)} `}highest`) + ` of ${rows.length} years` : "";
    const sc = this.scale(m);
    const n = Number(s.n);
    const colourFor = (_, i) => (rows[i]?.k === 0 ? "--s-actual" : rows[i]?.k <= n ? "--s-avg" : "--s-band");
    this.rankPanel.setTitle(current ? `${fmtPeriod(from, s.to)}: ${rankText}` : "The same period in every year",
      `Average ${MEASURES[m].short}${s.scope === "fleet" ? "" : ` for ${this.scopeName()}`} for the same ${s.align === "cal" ? "dates" : "weekdays"} in each year${useFc ? " (this year includes the outlook)" : ""} · ${MEASURES[m].unit}`);
    this.rankPanel.render({
      xType: "category", categories: rows.map(r => r.label + (r.k === 0 && useFc ? "*" : "")), xLabel: x => x, xHeader: "Year",
      yName: MEASURES[m].unit, yMin: 0, yScale: false, yFormat: v => fmtNumber(v, Number.isInteger(v) ? 0 : 1),
      series: [{
        name: `${MEASURES[m].label}, same period`, colour: "--s-actual", type: "bar", data: rows.map((r, i) => [i, r.value / sc]),
        unit: MEASURES[m].unit === "reactors" ? "" : MEASURES[m].unit, decimals: 2, colourFn: colourFor, barColours: i => colourFor(null, i), avg: false, barWidth: 30,
        labels: v => fmtNumber(v, 1)
      }],
      legendCaption: null,
      notes: [`Highlighted: this period. Mid-tone bars are the years in the ${n}-year average. Years with less than 90% of days available are left out.`, useFc ? "* Includes the expected availability from the current notices." : ""]
    });
  }

  refreshTheme() {
    this.panel.refreshTheme();
    this.rankPanel.refreshTheme();
  }
}
