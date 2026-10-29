// Nuclear outlook: expected availability for a future period from the outage
// notices, compared with what the notices said at other dates — a week or a
// month ago, or at the same point in earlier years — and with what actually
// happened in those years.

import { ChartPanel } from "./chart.js";
import { getNuclearDaily, getOutlookAsOf, getOutlookRange } from "./power-data.js";
import {
  addDays, alignDate, copyText, csvDate, dateRange, daysBetween, fmtDate, fmtLongDate, fmtMonth, fmtNumber, fmtPeriod,
  fmtShortDate, heroHtml, parisMidnight, todayParis, weekStart, writeHash
} from "./util.js";

const FIRST_ASOF = "2015-01-01";
const HORIZON = 540;

function defaults() {
  return { preset: "nextmonth", from: "", to: "", asof: "", res: "1d", wk: "1", mo: "0", ly: "1", ly2: "0", ly3: "0", act: "1", cmp: "" };
}

const sum = values => values.reduce((a, b) => a + b, 0);
const avg = values => (values.length ? sum(values) / values.length : null);

export class NuclearOutlook {
  constructor(root) {
    this.root = root;
    this.state = defaults();
    this.renderId = 0;
    this.build();
    this.applyPreset();
  }

  base() {
    const today = todayParis();
    const a = this.state.asof;
    return a && a < today && a >= FIRST_ASOF ? a : today;
  }

  presetRange(preset) {
    const base = this.base();
    const first = addDays(base, 1);
    const y = Number(base.slice(0, 4));
    const m = Number(base.slice(5, 7));
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const endOfMonth = start => addDays(`${addDays(start, 32).slice(0, 7)}-01`, -1);
    const winterYear = m >= 4 ? y : y - 1;
    switch (preset) {
      case "next30": return [first, addDays(base, 30)];
      case "rest": return [first, endOfMonth(`${base.slice(0, 7)}-01`) > base ? endOfMonth(`${base.slice(0, 7)}-01`) : addDays(base, 1)];
      case "nextmonth": return [nextMonth, endOfMonth(nextMonth)];
      case "next90": return [first, addDays(base, 90)];
      case "winter": {
        const start = `${winterYear}-11-01` > base ? `${winterYear}-11-01` : first;
        return [start, `${winterYear + 1}-03-31`];
      }
      case "nextwinter": return [`${winterYear + 1}-11-01`, `${winterYear + 2}-03-31`];
      case "next365": return [first, addDays(base, 365)];
      default: return null;
    }
  }

  applyPreset() {
    const range = this.presetRange(this.state.preset);
    if (range) [this.state.from, this.state.to] = range;
    this.clamp();
    this.syncControls();
  }

  clamp() {
    const base = this.base();
    const lo = addDays(base, 1);
    const hi = addDays(base, HORIZON);
    if (this.state.from < lo) this.state.from = lo;
    if (this.state.to > hi) this.state.to = hi;
    if (this.state.to < this.state.from) this.state.to = this.state.from;
  }

  setParams(params) {
    const state = defaults();
    for (const key of Object.keys(state)) if (params.has(key)) state[key] = params.get(key);
    this.state = state;
    if (state.preset !== "custom" || !state.from) this.applyPreset();
    this.clamp();
    this.syncControls();
  }

  chip(key, label, colour) {
    return `<button class="chip" type="button" data-chip="${key}" style="color:var(${colour})"><span class="swatch"></span><span class="chip-label">${label}</span></button>`;
  }

  build() {
    this.root.innerHTML = `
      ${heroHtml("Nuclear outlook,", "and how it has changed.", "Expected nuclear availability for any period up to 18 months ahead, from the outage notices published so far. Compare it with what the notices said a week or a month earlier, or on the same date in earlier years, and with what actually happened.")}
      <div class="toolbar" role="group" aria-label="Outlook settings">
        <div class="toolbar-row">
          <label class="field"><span>Period ahead</span>
            <select data-k="preset">
              <option value="next30">Next 30 days</option><option value="rest">Rest of this month</option><option value="nextmonth">Next calendar month</option>
              <option value="next90">Next 90 days</option><option value="winter">This winter (to 31 Mar)</option><option value="nextwinter">Next winter</option>
              <option value="next365">Next 12 months</option><option value="custom">Custom</option>
            </select>
          </label>
          <label class="field"><span>From</span><input type="date" data-k="from"></label>
          <label class="field"><span>To</span><input type="date" data-k="to"></label>
          <label class="field"><span>Resolution</span><select data-k="res"><option value="1d">Daily</option><option value="1w">Weekly</option><option value="1M">Monthly</option></select></label>
          <label class="field"><span>Outlook as of</span><input type="date" data-k="asof" min="${FIRST_ASOF}" title="Leave as today for the latest notices"></label>
        </div>
        <div class="toolbar-row">
          <div class="field"><span>Compare with the outlook</span>
            <div class="chips">
              ${this.chip("wk", "A week earlier", "--s-d1")}
              ${this.chip("mo", "A month earlier", "--s-d2")}
              ${this.chip("ly", "Same date last year", "--s-ly")}
              ${this.chip("ly2", "2 years ago", "--s-week")}
              ${this.chip("ly3", "3 years ago", "--s-avg")}
            </div>
          </div>
          <label class="field"><span>…or as of any date</span><input type="date" data-k="cmp" min="${FIRST_ASOF}"></label>
          <div class="field"><span>Outcome</span><div class="chips">${this.chip("act", "What actually happened", "--s-id")}</div></div>
        </div>
      </div>
      <div class="headline"><p data-headline>Loading…</p><button class="btn ghost small" type="button" data-copy title="Copy this sentence">Copy</button></div>
      <div class="cards" data-cards>${'<div class="card skeleton"></div>'.repeat(5)}</div>
      <div data-main></div>
      <div data-evolution></div>
      <div data-history></div>`;
    this.headline = this.root.querySelector("[data-headline]");
    this.cards = this.root.querySelector("[data-cards]");
    this.main = new ChartPanel(this.root.querySelector("[data-main]"), { title: "Outlook", size: "tall" });
    this.evolution = new ChartPanel(this.root.querySelector("[data-evolution]"), { title: "How the outlook for this period changed", size: "short" });
    this.history = new ChartPanel(this.root.querySelector("[data-history]"), { title: "Outlook and outcome in every year", size: "short" });
    this.root.querySelector("[data-copy]").addEventListener("click", () => copyText(this.headline.textContent));
    this.root.querySelectorAll("[data-k]").forEach(input => input.addEventListener("change", () => {
      const key = input.dataset.k;
      this.state[key] = input.value;
      if (key === "preset" && input.value !== "custom") this.applyPreset();
      if (key === "from" || key === "to") this.state.preset = "custom";
      if (key === "asof") {
        if (this.state.asof >= todayParis()) this.state.asof = "";
        if (this.state.preset !== "custom") this.applyPreset();
      }
      this.clamp();
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

  syncControls() {
    const s = this.state;
    const base = this.base();
    this.root.querySelectorAll("[data-k]").forEach(input => { input.value = input.dataset.k === "asof" ? base : s[input.dataset.k]; });
    for (const k of ["from", "to"]) {
      const input = this.root.querySelector(`[data-k="${k}"]`);
      input.min = addDays(base, 1);
      input.max = addDays(base, HORIZON);
    }
    this.root.querySelector('[data-k="asof"]').max = todayParis();
    this.root.querySelector('[data-k="cmp"]').max = addDays(base, -1);
    this.root.querySelectorAll("[data-chip]").forEach(chip => chip.setAttribute("aria-pressed", s[chip.dataset.chip] === "1"));
  }

  activate() {
    this.update();
  }

  /** The comparisons to draw: { key, name, asOf, shift (years), colour }. */
  comparisons() {
    const s = this.state;
    const base = this.base();
    const list = [];
    if (s.wk === "1") list.push({ key: "wk", name: `As of ${fmtLongDate(addDays(base, -7))} (a week earlier)`, asOf: addDays(base, -7), shift: 0, colour: "--s-d1" });
    if (s.mo === "1") list.push({ key: "mo", name: `As of ${fmtLongDate(addDays(base, -30))} (30 days earlier)`, asOf: addDays(base, -30), shift: 0, colour: "--s-d2" });
    [["ly", 1, "--s-ly"], ["ly2", 2, "--s-week"], ["ly3", 3, "--s-avg"]].forEach(([key, k, colour]) => {
      if (s[key] !== "1") return;
      const asOf = alignDate(base, k, "cal") || addDays(base, -365 * k);
      list.push({ key, name: `As of ${fmtLongDate(asOf)}, for ${this.periodLabel(k)}`, asOf, shift: k, colour });
    });
    if (s.cmp && s.cmp < base && s.cmp >= FIRST_ASOF) {
      const k = Math.round(daysBetween(s.cmp, base) / 365.25);
      list.push({ key: "cmp", name: `As of ${fmtLongDate(s.cmp)}${k ? `, for ${this.periodLabel(k)}` : ""}`, asOf: s.cmp, shift: k, colour: "--s-temp" });
    }
    return list.filter(c => c.asOf >= FIRST_ASOF);
  }

  periodLabel(k) {
    const { from, to } = this.state;
    const a = alignDate(from, k, "cal") || addDays(from, 1);
    const b = alignDate(to, k, "cal") || addDays(to, -1);
    return fmtPeriod(a, b);
  }

  shiftDate(date, k) {
    return k ? alignDate(date, k, "cal") || alignDate(addDays(date, -1), k, "cal") : date;
  }

  groupKey(date) {
    const res = this.state.res;
    return res === "1w" ? weekStart(date) : res === "1M" ? `${date.slice(0, 7)}-01` : date;
  }

  grouped(map) {
    if (this.state.res === "1d") return map;
    const acc = new Map();
    for (const [d, v] of map) {
      const k = this.groupKey(d);
      if (!acc.has(k)) acc.set(k, []);
      acc.get(k).push(v);
    }
    return new Map([...acc].map(([k, vs]) => [k, avg(vs)]));
  }

  async update() {
    const id = ++this.renderId;
    const s = this.state;
    const base = this.base();
    writeHash("nuclear/outlook", s);
    this.main.setLoading(true);
    try {
      const today = todayParis();
      const dates = dateRange(s.from, s.to);
      const comps = this.comparisons();
      const [baseOutlook, daily, ...compOutlooks] = await Promise.all([
        getOutlookAsOf(base, today), getNuclearDaily(), ...comps.map(c => getOutlookAsOf(c.asOf, today))
      ]);
      if (id !== this.renderId) return;
      if (!baseOutlook) throw new Error(`no outlook stored for ${base}`);

      const baseMap = new Map(dates.map(d => [d, baseOutlook.byDate.get(d)]).filter(([, v]) => v != null));
      const series = [];
      const notes = [];
      const pts = map => [...this.grouped(map)].sort(([a], [b]) => (a < b ? -1 : 1)).map(([d, v]) => [parisMidnight(d), v / 1000]);
      const markers = s.res !== "1d" ? true : undefined;
      const results = [];

      comps.forEach((c, i) => {
        const o = compOutlooks[i];
        if (!o) { notes.push(`No outlook is stored for ${fmtLongDate(c.asOf)}.`); return; }
        const map = new Map();
        for (const d of dates) {
          const src = this.shiftDate(d, c.shift);
          const v = src ? o.byDate.get(src) : null;
          if (v != null) map.set(d, v);
        }
        results.push({ ...c, map, mean: avg([...map.values()]) });
        series.push({ name: c.name, colour: c.colour, type: "line", data: pts(map), width: 1.8, unit: "GW", decimals: 2, dashed: c.shift === 0, symbols: markers });
      });

      // What actually happened in the shifted years (and for any past dates).
      const outcomes = [];
      if (s.act === "1") {
        const shifts = [...new Set(comps.filter(c => c.shift > 0).map(c => c.shift))];
        for (const k of shifts) {
          const map = new Map();
          for (const d of dates) {
            const src = this.shiftDate(d, k);
            const v = src && src < today ? daily.byDate.get(src)?.available_mw : null;
            if (v != null) map.set(d, v);
          }
          if (!map.size) continue;
          outcomes.push({ k, map, mean: avg([...map.values()]), complete: map.size >= dates.length * 0.95 });
          series.push({ name: `Actual, ${this.periodLabel(k)}`, colour: "--s-id", type: "line", data: pts(map), width: 1.4, unit: "GW", decimals: 2, symbols: markers, dashed: k > 1 });
        }
        if (base < today) {
          const map = new Map();
          for (const d of dates) { const v = d < today ? daily.byDate.get(d)?.available_mw : null; if (v != null) map.set(d, v); }
          if (map.size) {
            outcomes.push({ k: 0, map, mean: avg([...map.values()]), complete: map.size >= dates.length * 0.95 });
            series.push({ name: `Actual, ${fmtPeriod(s.from, s.to)}`, colour: "--s-id", type: "line", data: pts(map), width: 2, unit: "GW", decimals: 2, symbols: markers });
          }
        }
      }
      series.push({ name: `As of ${fmtLongDate(base)}${base === today ? " (latest)" : ""}`, colour: "--s-actual", type: "line", data: pts(baseMap), width: 2.8, unit: "GW", decimals: 2, z: 20, symbols: markers });

      notes.push("Each line is the daily average availability implied by the notices published up to the end of that day (Paris time). Earlier years are drawn on this period's dates (same calendar date).");
      notes.push("Outlooks only include outages already announced. New unplanned outages usually pull actual availability below the outlook.");
      const xLabel = s.res === "1M" ? x => fmtMonth(x) : s.res === "1w" ? x => `Week of ${fmtDate(x)}` : x => fmtDate(x);
      this.main.setTitle(`Outlook for ${fmtPeriod(s.from, s.to)}`, `Expected nuclear availability · GW · ${s.res === "1d" ? "daily" : s.res === "1w" ? "weekly" : "monthly"} averages`);
      this.main.render({
        xType: "time", xLabel, csvLabel: csvDate, xHeader: s.res === "1M" ? "Month" : s.res === "1w" ? "Week starting" : "Date",
        axisLabel: s.res === "1M" ? x => fmtMonth(x) : undefined, yName: "GW", yFormat: v => fmtNumber(v, Number.isInteger(v) ? 0 : 1), series, notes
      });

      const baseMean = avg([...baseMap.values()]);
      this.renderSummary(base, baseMean, results, outcomes);
      await this.renderEvolution(base, comps);
      if (id !== this.renderId) return;
      await this.renderHistory(base, daily, today);
    } catch (error) {
      console.error(error);
      if (id === this.renderId) {
        this.headline.textContent = `The outlook could not be loaded (${error.message}).`;
        this.main.setLoading(false);
      }
    }
  }

  renderSummary(base, baseMean, results, outcomes) {
    const s = this.state;
    const gw = v => `${fmtNumber(v / 1000, 1)} GW`;
    const signed = v => `${v >= 0 ? "+" : "−"}${fmtNumber(Math.abs(v) / 1000, 1)} GW`;
    const period = fmtPeriod(s.from, s.to);
    let text = `As of ${fmtLongDate(base)}, the outage notices point to average nuclear availability of ${gw(baseMean)} for ${period}.`;
    const ly = results.find(r => r.shift === 1) || results.find(r => r.shift > 0);
    const wk = results.find(r => r.key === "wk");
    if (ly) {
      const diff = baseMean - ly.mean;
      text += ` That is ${gw(Math.abs(diff))} ${diff >= 0 ? "more" : "less"} than was expected for ${this.periodLabel(ly.shift)} on ${fmtLongDate(ly.asOf)} (${gw(ly.mean)}).`;
      const out = outcomes.find(o => o.k === ly.shift);
      if (out) text += ` ${this.periodLabel(ly.shift)} ${out.complete ? "actually averaged" : "has averaged"} ${gw(out.mean)}, ${gw(Math.abs(out.mean - ly.mean))} ${out.mean >= ly.mean ? "above" : "below"} that outlook.`;
    }
    if (wk) text += ` A week earlier the outlook was ${gw(wk.mean)} (${signed(baseMean - wk.mean)} since).`;
    this.headline.textContent = text;
    const card = (l, v, d = "", c = "") => `<div class="card${c}"><div class="label">${l}</div><div class="value">${v}</div><div class="detail">${d}</div></div>`;
    this.cards.innerHTML = [
      card("Expected average", gw(baseMean), `${period}, as of ${fmtShortDate(base)}`, " accent"),
      ...results.map(r => card(r.shift ? `vs outlook ${r.shift === 1 ? "a year" : `${r.shift} years`} earlier` : r.key === "wk" ? "Change in the past week" : r.key === "mo" ? "Change in the past 30 days" : `vs ${fmtShortDate(r.asOf)}`,
        signed(baseMean - r.mean), `${gw(r.mean)} as of ${fmtLongDate(r.asOf)}`)),
      ...outcomes.filter(o => o.k > 0).map(o => card(`Actual, ${this.periodLabel(o.k)}`, gw(o.mean), o.complete ? "Outcome" : "So far"))
    ].join("");
  }

  /** Mean expected availability for the period, by as-of date. */
  async renderEvolution(base, comps) {
    const s = this.state;
    const span = 180;
    const lastAsOf = base < addDays(s.from, -1) ? base : addDays(s.from, -1);
    const firstAsOf = [addDays(lastAsOf, -span), addDays(s.to, -HORIZON + 1), FIRST_ASOF].sort().at(-1);
    if (firstAsOf > lastAsOf) { this.evolution.show(false); return; }
    this.evolution.show(true);
    const dates = dateRange(s.from, s.to);
    const meanFor = (entry, k) => {
      const vals = dates.map(d => entry.byDate.get(this.shiftDate(d, k))).filter(v => v != null);
      return vals.length >= dates.length * 0.95 ? avg(vals) : null;
    };
    const withMaps = list => list.map(e => ({ ...e, byDate: e.byDate || new Map(e.values.map((v, i) => [addDays(e.first, i), v])) }));
    const series = [];
    const shifts = [0, ...new Set(comps.filter(c => c.shift > 0).map(c => c.shift))];
    const colours = { 0: "--s-actual", 1: "--s-ly", 2: "--s-week", 3: "--s-avg" };
    for (const k of shifts) {
      const a = alignDate(firstAsOf, k, "cal") || addDays(firstAsOf, -365 * k);
      const b = alignDate(lastAsOf, k, "cal") || addDays(lastAsOf, -365 * k);
      if (b < FIRST_ASOF) continue;
      const entries = withMaps(await getOutlookRange(a < FIRST_ASOF ? FIRST_ASOF : a, b));
      const pts = [];
      for (const e of entries) {
        const v = meanFor(e, k);
        if (v == null) continue;
        const onAxis = k ? addDays(e.asOf, daysBetween(a, firstAsOf)) : e.asOf;
        pts.push([parisMidnight(onAxis), v / 1000]);
      }
      if (k === 0 && base === todayParis() && lastAsOf === base) {
        const live = await getOutlookAsOf(base, base);
        const v = live && meanFor(live, 0);
        if (v != null) pts.push([parisMidnight(base), v / 1000]);
      }
      series.push({ name: k ? `For ${this.periodLabel(k)} (as-of dates ${k} year${k > 1 ? "s" : ""} earlier)` : `For ${fmtPeriod(s.from, s.to)}`, colour: colours[k] || "--s-avg", type: "line", data: pts, width: k ? 1.6 : 2.6, unit: "GW", decimals: 2, z: k ? 10 : 20 });
    }
    this.evolution.setTitle("How the outlook for this period changed", `Average expected availability for the period, by the date the notices were read · GW`);
    this.evolution.render({
      xType: "time", xLabel: x => `As of ${fmtDate(x)}`, csvLabel: csvDate, xHeader: "Outlook as of", yName: "GW",
      yFormat: v => fmtNumber(v, Number.isInteger(v) ? 0 : 1), series,
      notes: ["Earlier years are lined up by calendar date, so the same point on the axis is the same distance ahead of the period.", "Only dates whose outlook covers the whole period are shown (outlooks run 540 days ahead)."]
    });
  }

  /** For each year: the outlook at the same lead time, and the outcome. */
  async renderHistory(base, daily, today) {
    const s = this.state;
    const dates = dateRange(s.from, s.to);
    const rows = [];
    for (let k = 0; ; k++) {
      const asOf = k ? alignDate(base, k, "cal") || addDays(base, -365 * k) : base;
      if (asOf < FIRST_ASOF) break;
      const entry = await getOutlookAsOf(asOf, today);
      if (!entry) continue;
      const shifted = dates.map(d => this.shiftDate(d, k));
      const exp = shifted.map(d => entry.byDate.get(d)).filter(v => v != null);
      const act = shifted.map(d => (d < today ? daily.byDate.get(d)?.available_mw : null)).filter(v => v != null);
      if (exp.length < dates.length * 0.95) continue;
      const a = shifted[0].slice(0, 4);
      const b = shifted.at(-1).slice(0, 4);
      rows.push({ k, label: a === b ? a : `${a}–${b.slice(2)}`, expected: avg(exp), actual: act.length >= dates.length * 0.95 ? avg(act) : null });
    }
    rows.reverse();
    if (rows.length < 2) { this.history.show(false); return; }
    this.history.show(true);
    const done = rows.filter(r => r.actual != null);
    const bias = done.length ? avg(done.map(r => r.actual - r.expected)) : null;
    const lead = daysBetween(base, s.from);
    this.history.setTitle(`The same period in every year, seen ${lead} day${lead === 1 ? "" : "s"} ahead`,
      bias != null ? `On average, the outcome was ${fmtNumber(Math.abs(bias) / 1000, 1)} GW ${bias < 0 ? "below" : "above"} the outlook at this lead time (${done.length} years) · GW` : "Expected average availability · GW");
    this.history.render({
      xType: "category", categories: rows.map(r => r.label), xLabel: x => x, xHeader: "Year", yName: "GW", yMin: 0, yScale: false,
      yFormat: v => fmtNumber(v, Number.isInteger(v) ? 0 : 1),
      series: [
        { name: "Outlook at the same lead time", colour: "--s-actual", type: "bar", data: rows.map((r, i) => [i, r.expected / 1000]), unit: "GW", decimals: 2, avg: false, barWidth: 18, labels: v => fmtNumber(v, 1) },
        { name: "What happened", colour: "--s-id", type: "bar", data: rows.map((r, i) => (r.actual == null ? null : [i, r.actual / 1000])).filter(Boolean), unit: "GW", decimals: 2, avg: false, barWidth: 18, labels: v => fmtNumber(v, 1) }
      ],
      legendCaption: null,
      notes: ["Each year uses the outlook from the same calendar date as the one selected above, for the same calendar period. The gap between the bars is how much unannounced outages (and extensions) cost in that year."]
    });
  }

  refreshTheme() {
    this.main.refreshTheme();
    this.evolution.refreshTheme();
    this.history.refreshTheme();
  }
}
