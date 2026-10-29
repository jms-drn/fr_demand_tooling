// Nuclear outlook: expected unavailability (or availability) for a future
// period from the outage notices, compared with what the notices said at
// other dates — a week or a month earlier, or at the same point in earlier
// years and on average over five years — and with what actually happened.
//
// Chart convention: colour = which year; solid = what the notices said at
// the time; dashed = this year's outlook at an earlier date; dotted = what
// actually happened.

import { ChartPanel } from "./chart.js";
import { setSwitch, switchHtml } from "./nuclear-common.js";
import { getFleet, getNuclearDaily, getOutlookAsOf, getOutlookRange, installedOn } from "./power-data.js";
import {
  addDays, alignDate, copyText, csvDate, dateRange, daysBetween, fmtDate, fmtLongDate, fmtMonth, fmtNumber, fmtPeriod,
  fmtShortDate, heroHtml, parisMidnight, todayParis, weekStart, writeHash
} from "./util.js";

const FIRST_ASOF = "2015-01-01";
const HORIZON = 540;
const YEAR_COLOURS = { 0: "--s-actual", 1: "--s-ly", 2: "--s-week", 3: "--s-d2" };
const DOTTED = [2, 4];

function defaults() {
  return {
    preset: "nextmonth", from: "", to: "", asof: "", res: "1d", av: "0",
    wk: "1", mo: "0", ly: "1", ly2: "0", ly3: "0", avg5: "1", act: "1", cmp: ""
  };
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

  available() {
    return this.state.av === "1";
  }

  word() {
    return this.available() ? "availability" : "unavailability";
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
      ${heroHtml("Nuclear outlook,", "and how it has changed.", "Expected nuclear unavailability (or availability) for any period up to 18 months ahead, from the outage notices published so far. Compare it with what the notices said a week or a month earlier, at the same point in earlier years or on average over five years, and with what actually happened.")}
      <div class="toolbar" role="group" aria-label="Outlook settings">
        <div class="toolbar-row">
          <div class="field"><span>Show</span>${switchHtml("data-avail", "Unavailable", "Available")}</div>
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
          <div class="field"><span>This year's outlook earlier</span>
            <div class="chips">${this.chip("wk", "A week earlier", "--s-actual")}${this.chip("mo", "A month earlier", "--s-actual")}</div>
          </div>
          <div class="field"><span>Same point in earlier years</span>
            <div class="chips">
              ${this.chip("ly", "Last year", "--s-ly")}${this.chip("ly2", "2 years ago", "--s-week")}${this.chip("ly3", "3 years ago", "--s-d2")}
              ${this.chip("avg5", "5-year average", "--s-avg")}
            </div>
          </div>
          <label class="field"><span>…or as of any date</span><input type="date" data-k="cmp" min="${FIRST_ASOF}"></label>
          <div class="field"><span>Outcome</span><div class="chips">${this.chip("act", "What actually happened", "--text-soft")}</div></div>
        </div>
      </div>
      <div class="headline"><p data-headline>Loading…</p><button class="btn ghost small" type="button" data-copy title="Copy this sentence">Copy</button></div>
      <div class="cards" data-cards>${'<div class="card skeleton"></div>'.repeat(5)}</div>
      <div class="outlook-key">
        <span><b>How to read the chart:</b> colour shows which year</span>
        <span><i class="sample"></i>solid: what the notices said at the time</span>
        <span><i class="sample dashed"></i>dashed: this year's outlook at an earlier date</span>
        <span><i class="sample dotted"></i>dotted: what actually happened</span>
      </div>
      <div data-main></div>
      <div data-evolution></div>
      <div data-history></div>`;
    this.headline = this.root.querySelector("[data-headline]");
    this.cards = this.root.querySelector("[data-cards]");
    this.main = new ChartPanel(this.root.querySelector("[data-main]"), { title: "Outlook", size: "tall" });
    this.evolution = new ChartPanel(this.root.querySelector("[data-evolution]"), { title: "How the outlook for this period changed", size: "short" });
    this.history = new ChartPanel(this.root.querySelector("[data-history]"), { title: "Outlook and outcome in every year", size: "short" });
    this.root.querySelector("[data-copy]").addEventListener("click", () => copyText(this.headline.textContent));
    this.root.querySelector("[data-avail]").addEventListener("click", () => {
      this.state.av = this.available() ? "0" : "1";
      this.syncControls();
      this.update();
    });
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
    setSwitch(this.root.querySelector("[data-avail]"), this.available());
  }

  activate() {
    this.update();
  }

  // ---------- Helpers ----------

  shiftDate(date, k) {
    return k ? alignDate(date, k, "cal") || alignDate(addDays(date, -1), k, "cal") : date;
  }

  asOfYearsBack(base, k) {
    return alignDate(base, k, "cal") || addDays(base, -365 * k);
  }

  /** "Nov 2025" for whole calendar months, otherwise the date range. */
  periodLabel(k) {
    const { from, to } = this.state;
    const a = this.shiftDate(from, k);
    const b = this.shiftDate(to, k);
    const monthEnd = d => addDays(`${addDays(`${d.slice(0, 7)}-28`, 4).slice(0, 7)}-01`, -1);
    if (a.endsWith("-01") && b === monthEnd(a) && a.slice(0, 7) === b.slice(0, 7)) return fmtMonth(parisMidnight(a) + 43200000);
    return fmtPeriod(a, b);
  }

  /** Expected value (MW) for a source date from an outlook entry. */
  expected(entry, src) {
    const av = entry?.byDate.get(src);
    if (av == null) return null;
    return this.available() ? av : installedOn(this.fleet, src) - av;
  }

  actual(src, today) {
    if (src >= today) return null;
    const r = this.daily.byDate.get(src);
    if (!r) return null;
    return this.available() ? r.available_mw : r.planned_off_mw + r.unplanned_off_mw;
  }

  /** Map(date of this period -> MW) for an outlook shifted k years. */
  seriesFrom(entry, dates, k) {
    const map = new Map();
    for (const d of dates) {
      const src = this.shiftDate(d, k);
      const v = src ? this.expected(entry, src) : null;
      if (v != null) map.set(d, v);
    }
    return map;
  }

  actualFrom(dates, k, today) {
    const map = new Map();
    for (const d of dates) {
      const src = this.shiftDate(d, k);
      const v = src ? this.actual(src, today) : null;
      if (v != null) map.set(d, v);
    }
    return map;
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

  // ---------- Render ----------

  async update() {
    const id = ++this.renderId;
    const s = this.state;
    const base = this.base();
    writeHash("nuclear/outlook", s);
    this.main.setLoading(true);
    try {
      const today = todayParis();
      const dates = dateRange(s.from, s.to);
      const complete = map => map.size >= dates.length * 0.95;
      [this.fleet, this.daily] = await Promise.all([getFleet(), getNuclearDaily()]);
      const baseOutlook = await getOutlookAsOf(base, today);
      if (id !== this.renderId) return;
      if (!baseOutlook) throw new Error(`no outlook stored for ${base}`);

      const series = [];
      const notes = [];
      const pts = map => [...this.grouped(map)].sort(([a], [b]) => (a < b ? -1 : 1)).map(([d, v]) => [parisMidnight(d), v / 1000]);
      const markers = s.res !== "1d" ? true : undefined;
      const line = (name, colour, map, extra = {}) => series.push({ name, colour, type: "line", data: pts(map), unit: "GW", decimals: 2, symbols: markers, width: 1.8, ...extra });
      const P0 = this.periodLabel(0);
      const results = {};

      // This year: now, and earlier readings of the same period.
      const baseMap = this.seriesFrom(baseOutlook, dates, 0);
      results.base = { map: baseMap, mean: avg([...baseMap.values()]) };
      const unpl = dates.map(d => baseOutlook.unplByDate?.get(d)).filter(v => v != null);
      results.base.unplanned = unpl.length ? avg(unpl) : null;
      for (const [key, days, dash] of [["wk", 7, [7, 4]], ["mo", 30, [12, 5]]]) {
        if (s[key] !== "1") continue;
        const asOf = addDays(base, -days);
        if (asOf < FIRST_ASOF) continue;
        const entry = await getOutlookAsOf(asOf, today);
        if (!entry) continue;
        const map = this.seriesFrom(entry, dates, 0);
        results[key] = { asOf, map, mean: avg([...map.values()]) };
        line(`${P0}: expected on ${fmtShortDate(asOf)} (${days === 7 ? "a week" : "30 days"} earlier)`, "--s-actual", map, { dash, width: 1.5 });
      }
      if (s.act === "1" && base < today) {
        const map = this.actualFrom(dates, 0, today);
        if (map.size) {
          results.act0 = { map, mean: avg([...map.values()]), complete: complete(map) };
          line(`${P0}: what happened`, "--s-actual", map, { dash: DOTTED, width: 2 });
        }
      }

      // Earlier years at the same point.
      results.years = [];
      for (const [key, k] of [["ly", 1], ["ly2", 2], ["ly3", 3]]) {
        if (s[key] !== "1") continue;
        const asOf = this.asOfYearsBack(base, k);
        if (asOf < FIRST_ASOF) continue;
        const entry = await getOutlookAsOf(asOf, today);
        if (!entry) { notes.push(`No outlook is stored for ${fmtLongDate(asOf)}.`); continue; }
        const map = this.seriesFrom(entry, dates, k);
        const Pk = this.periodLabel(k);
        const r = { k, asOf, map, mean: avg([...map.values()]), label: Pk };
        line(`${Pk}: expected on ${fmtLongDate(asOf)}`, YEAR_COLOURS[k], map);
        if (s.act === "1") {
          const act = this.actualFrom(dates, k, today);
          if (act.size) {
            r.actual = avg([...act.values()]);
            r.actualComplete = complete(act);
            line(`${Pk}: what happened`, YEAR_COLOURS[k], act, { dash: DOTTED });
          }
        }
        results.years.push(r);
      }

      // Five-year average of outlooks at the same point, and of outcomes.
      if (s.avg5 === "1") {
        const exp = new Map();
        const act = new Map();
        let n = 0;
        for (let k = 1; k <= 5; k++) {
          const asOf = this.asOfYearsBack(base, k);
          if (asOf < FIRST_ASOF) break;
          const entry = await getOutlookAsOf(asOf, today);
          const m = entry ? this.seriesFrom(entry, dates, k) : new Map();
          if (!complete(m)) continue;
          n += 1;
          for (const [d, v] of m) exp.set(d, [...(exp.get(d) || []), v]);
          for (const [d, v] of this.actualFrom(dates, k, today)) act.set(d, [...(act.get(d) || []), v]);
        }
        if (n) {
          const expMap = new Map([...exp].map(([d, vs]) => [d, avg(vs)]));
          const actMap = new Map([...act].filter(([, vs]) => vs.length === n).map(([d, vs]) => [d, avg(vs)]));
          results.avg5 = { n, mean: avg([...expMap.values()]), actual: actMap.size ? avg([...actMap.values()]) : null };
          line(`${n}-year average: expected at the same point`, "--s-avg", expMap, { width: 1.6 });
          if (s.act === "1" && actMap.size) line(`${n}-year average: what happened`, "--s-avg", actMap, { dash: DOTTED, width: 1.6 });
        }
      }

      // Any chosen date.
      if (s.cmp && s.cmp < base && s.cmp >= FIRST_ASOF) {
        const k = Math.round(daysBetween(s.cmp, base) / 365.25);
        const entry = await getOutlookAsOf(s.cmp, today);
        if (entry) {
          const map = this.seriesFrom(entry, dates, k);
          results.cmp = { asOf: s.cmp, k, map, mean: avg([...map.values()]) };
          line(`${this.periodLabel(k)}: expected on ${fmtLongDate(s.cmp)}`, "--s-temp", map);
          if (k && s.act === "1") {
            const act = this.actualFrom(dates, k, today);
            if (act.size) line(`${this.periodLabel(k)}: what happened`, "--s-temp", act, { dash: DOTTED });
          }
        }
      }

      line(`${P0}: expected now (${fmtShortDate(base)})`, "--s-actual", baseMap, { width: 3, z: 20 });
      if (id !== this.renderId) return;

      notes.push(`Each outlook line is the daily average ${this.word()} implied by the notices published by the end of that day (Paris time). Earlier years are drawn on this period's dates (same calendar date).`);
      notes.push("Outlooks only include outages already announced. New unplanned outages and extensions usually make unavailability higher than expected.");
      const xLabel = s.res === "1M" ? x => fmtMonth(x) : s.res === "1w" ? x => `Week of ${fmtDate(x)}` : x => fmtDate(x);
      this.main.setTitle(`Outlook for ${P0}: nuclear ${this.word()}`, `Expected and actual ${this.word()} · GW · ${s.res === "1d" ? "daily" : s.res === "1w" ? "weekly" : "monthly"} averages`);
      this.main.render({
        xType: "time", xLabel, csvLabel: csvDate, xHeader: s.res === "1M" ? "Month" : s.res === "1w" ? "Week starting" : "Date",
        axisLabel: s.res === "1M" ? x => fmtMonth(x) : undefined, yName: "GW", yFormat: v => fmtNumber(v, Number.isInteger(v) ? 0 : 1),
        yMin: this.available() ? undefined : 0, series, notes
      });

      this.renderSummary(base, results);
      await this.renderEvolution(base, dates);
      if (id !== this.renderId) return;
      await this.renderHistory(base, dates, today);
    } catch (error) {
      console.error(error);
      if (id === this.renderId) {
        this.headline.textContent = `The outlook could not be loaded (${error.message}).`;
        this.main.setLoading(false);
      }
    }
  }

  renderSummary(base, r) {
    const gw = v => `${fmtNumber(v / 1000, 1)} GW`;
    const signed = v => `${v >= 0 ? "+" : "−"}${fmtNumber(Math.abs(v) / 1000, 1)} GW`;
    const more = v => (v >= 0 ? "more" : "less");
    const word = this.word();
    const P0 = this.periodLabel(0);
    let text = `As of ${fmtLongDate(base)}, the outage notices point to average nuclear ${word} of ${gw(r.base.mean)} in ${P0}`;
    if (!this.available() && r.base.unplanned != null) text += r.base.unplanned < 50 ? ", all of it planned" : `, of which ${gw(r.base.unplanned)} unplanned`;
    text += ".";
    const ly = r.years.find(y => y.k === 1) || r.years[0];
    if (ly) {
      text += ` That is ${gw(Math.abs(r.base.mean - ly.mean))} ${more(r.base.mean - ly.mean)} than was expected for ${ly.label} at the same point (${fmtLongDate(ly.asOf)}: ${gw(ly.mean)}).`;
      if (ly.actual != null) text += ` ${ly.label} ${ly.actualComplete ? "ended up" : "has so far come in"} at ${gw(ly.actual)}, ${gw(Math.abs(ly.actual - ly.mean))} ${ly.actual >= ly.mean ? "above" : "below"} that outlook.`;
    }
    if (r.avg5?.actual != null) text += ` Over the previous ${r.avg5.n} years, the outlook at this point averaged ${gw(r.avg5.mean)} and the outcome ${gw(r.avg5.actual)}.`;
    if (r.wk) text += ` A week earlier the outlook was ${gw(r.wk.mean)} (${signed(r.base.mean - r.wk.mean)} since).`;
    this.headline.textContent = text;

    const card = (l, v, d = "", c = "") => `<div class="card${c}"><div class="label">${l}</div><div class="value">${v}</div><div class="detail">${d}</div></div>`;
    const cards = [card(`Expected ${word}`, gw(r.base.mean), `${P0}, as of ${fmtShortDate(base)}${!this.available() && r.base.unplanned != null ? ` · ${gw(r.base.mean - r.base.unplanned)} planned, ${gw(r.base.unplanned)} unplanned` : ""}`, " accent")];
    if (r.wk) cards.push(card("Change in the past week", signed(r.base.mean - r.wk.mean), `${gw(r.wk.mean)} as of ${fmtShortDate(r.wk.asOf)}`));
    if (r.mo) cards.push(card("Change in the past 30 days", signed(r.base.mean - r.mo.mean), `${gw(r.mo.mean)} as of ${fmtShortDate(r.mo.asOf)}`));
    for (const y of r.years) {
      cards.push(card(`vs outlook for ${y.label}`, signed(r.base.mean - y.mean), `${gw(y.mean)} expected on ${fmtLongDate(y.asOf)}`));
      if (y.actual != null) cards.push(card(`${y.label}: what happened`, gw(y.actual), `${signed(y.actual - y.mean)} vs its outlook`));
    }
    if (r.avg5) {
      cards.push(card(`${r.avg5.n}-year average outlook`, gw(r.avg5.mean), "Same period, same point ahead"));
      if (r.avg5.actual != null) cards.push(card(`${r.avg5.n}-year average outcome`, gw(r.avg5.actual), `${signed(r.avg5.actual - r.avg5.mean)} vs the outlook`));
    }
    this.cards.innerHTML = cards.join("");
  }

  /** Mean expected value for the period, by as-of date, this year and earlier years. */
  async renderEvolution(base, dates) {
    const s = this.state;
    const span = 180;
    const lastAsOf = base < addDays(s.from, -1) ? base : addDays(s.from, -1);
    const firstAsOf = [addDays(lastAsOf, -span), addDays(s.to, -HORIZON + 1), FIRST_ASOF].sort().at(-1);
    if (firstAsOf > lastAsOf) { this.evolution.show(false); return; }
    this.evolution.show(true);
    const meanFor = (entry, k) => {
      const vals = dates.map(d => this.expected(entry, this.shiftDate(d, k))).filter(v => v != null);
      return vals.length >= dates.length * 0.95 ? avg(vals) : null;
    };
    const withMaps = list => list.map(e => ({ ...e, byDate: e.byDate || new Map(e.values.map((v, i) => [addDays(e.first, i), v])) }));
    const shifts = [0, ...[["ly", 1], ["ly2", 2], ["ly3", 3]].filter(([key]) => s[key] === "1").map(([, k]) => k)];
    const series = [];
    for (const k of shifts) {
      const a = this.asOfYearsBack(firstAsOf, k);
      const b = this.asOfYearsBack(lastAsOf, k);
      if (b < FIRST_ASOF) continue;
      const entries = withMaps(await getOutlookRange(a < FIRST_ASOF ? FIRST_ASOF : a, b));
      const pts = [];
      for (const e of entries) {
        const v = meanFor(e, k);
        if (v != null) pts.push([parisMidnight(k ? addDays(e.asOf, daysBetween(a, firstAsOf)) : e.asOf), v / 1000]);
      }
      if (k === 0 && base === todayParis() && lastAsOf === base) {
        const live = await getOutlookAsOf(base, base);
        const v = live && meanFor(live, 0);
        if (v != null) pts.push([parisMidnight(base), v / 1000]);
      }
      series.push({ name: `${this.periodLabel(k)}: expected, by date read${k ? ` (dates ${k} year${k > 1 ? "s" : ""} earlier)` : ""}`, colour: YEAR_COLOURS[k], type: "line", data: pts, width: k ? 1.6 : 2.6, unit: "GW", decimals: 2, z: k ? 10 : 20 });
    }
    this.evolution.setTitle("How the outlook for this period changed", `Average expected ${this.word()} for the period, by the date the notices were read · GW`);
    this.evolution.render({
      xType: "time", xLabel: x => `As of ${fmtDate(x)}`, csvLabel: csvDate, xHeader: "Outlook as of", yName: "GW",
      yFormat: v => fmtNumber(v, Number.isInteger(v) ? 0 : 1), series,
      notes: ["Earlier years are lined up by calendar date, so the same point on the axis is the same distance ahead of the period.", "Only dates whose outlook covers the whole period are shown (outlooks run 540 days ahead)."]
    });
  }

  /** For each year: the outlook at the same lead time, and the outcome. */
  async renderHistory(base, dates, today) {
    const rows = [];
    for (let k = 0; ; k++) {
      const asOf = k ? this.asOfYearsBack(base, k) : base;
      if (asOf < FIRST_ASOF) break;
      const entry = await getOutlookAsOf(asOf, today);
      if (!entry) continue;
      const shifted = dates.map(d => this.shiftDate(d, k));
      const exp = shifted.map(d => this.expected(entry, d)).filter(v => v != null);
      const act = shifted.map(d => this.actual(d, today)).filter(v => v != null);
      if (exp.length < dates.length * 0.95) continue;
      const a = shifted[0].slice(0, 4);
      const b = shifted.at(-1).slice(0, 4);
      rows.push({ k, label: a === b ? a : `${a}–${b.slice(2)}`, expected: avg(exp), actual: act.length >= dates.length * 0.95 ? avg(act) : null });
    }
    rows.reverse();
    if (rows.length < 2) { this.history.show(false); return; }
    this.history.show(true);
    const done = rows.filter(r => r.actual != null);
    const gap = done.length ? avg(done.map(r => r.actual - r.expected)) : null;
    const lead = daysBetween(base, this.state.from);
    this.history.setTitle(`The same period in every year, seen ${lead} day${lead === 1 ? "" : "s"} ahead`,
      gap != null ? `On average, ${this.word()} turned out ${fmtNumber(Math.abs(gap) / 1000, 1)} GW ${gap >= 0 ? "higher" : "lower"} than the outlook at this point (${done.length} years) · GW` : `Expected average ${this.word()} · GW`);
    this.history.render({
      xType: "category", categories: rows.map(r => r.label), xLabel: x => x, xHeader: "Year", yName: "GW", yMin: 0, yScale: false,
      yFormat: v => fmtNumber(v, Number.isInteger(v) ? 0 : 1),
      series: [
        { name: "Expected at the same point", colour: "--s-actual", type: "bar", data: rows.map((r, i) => [i, r.expected / 1000]), unit: "GW", decimals: 2, avg: false, barWidth: 18, labels: v => fmtNumber(v, 1) },
        { name: "What happened", colour: "--s-avg", type: "bar", data: rows.map((r, i) => (r.actual == null ? null : [i, r.actual / 1000])).filter(Boolean), unit: "GW", decimals: 2, avg: false, barWidth: 18, labels: v => fmtNumber(v, 1) }
      ],
      legendCaption: null,
      notes: ["Each year uses the outlook from the same calendar date as the one selected above, for the same calendar period. The gap between the bars shows how much unannounced outages and extensions changed the picture."]
    });
  }

  refreshTheme() {
    this.main.refreshTheme();
    this.evolution.refreshTheme();
    this.history.refreshTheme();
  }
}
