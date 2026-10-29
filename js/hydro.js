// Hydro reservoirs: weekly energy stored in French hydro reservoirs (RTE),
// this year against earlier years, the long-run range, ranking of the latest
// week and the full history.

import { ChartPanel } from "./chart.js";
import { getReserves } from "./power-data.js";
import {
  addDays, copyText, csvDate, fmtDate, fmtLongDate, fmtNumber, fmtPct, fmtShortDate, heroHtml, ordinal, parisMidnight, writeHash
} from "./util.js";

/** ISO week year and number for a YYYY-MM-DD date. */
export function isoWeek(date) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const isoYear = t.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const week = 1 + Math.round(((t - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return [isoYear, week];
}

function defaults() {
  return { view: "season", year: "", start: "1", ly: "1", avg: "1", n: "5", band: "1", all: "0", show: "abs", week: "" };
}

const twh = mwh => mwh / 1e6;

export class Hydro {
  constructor(root) {
    this.root = root;
    this.state = defaults();
    this.build();
  }

  setParams(params) {
    const state = defaults();
    for (const key of Object.keys(state)) if (params.has(key)) state[key] = params.get(key);
    this.state = state;
    this.syncControls();
  }

  chip(key, label, colour) {
    return `<button class="chip" type="button" data-chip="${key}" style="color:var(${colour})"><span class="swatch"></span><span class="chip-label">${label}</span></button>`;
  }

  build() {
    this.root.innerHTML = `
      ${heroHtml("Hydro reservoirs,", "week by week.", "Energy stored in French hydro reservoirs each week since December 2014, from RTE, compared with earlier years: the range, the average and where this week ranks.")}
      <div class="toolbar" role="group" aria-label="Reservoir settings">
        <div class="toolbar-row">
          <label class="field"><span>Chart</span><select data-k="view"><option value="season">Year against earlier years</option><option value="history">Full history</option></select></label>
          <label class="field"><span>Year</span><select data-k="year" data-years></select></label>
          <label class="field"><span>Year starts</span><select data-k="start"><option value="1">January</option><option value="40">October (hydro year)</option></select></label>
          <label class="field"><span>Show</span><select data-k="show"><option value="abs">Stored energy (TWh)</option><option value="diff">Difference from average (TWh)</option><option value="pct">Difference from average (%)</option></select></label>
          <div class="field"><span>Compare with</span>
            <div class="chips">
              ${this.chip("ly", "Last year", "--s-ly")}
              ${this.chip("avg", "Average of previous", "--s-avg")}
              <select data-k="n" class="compact" aria-label="Years in the average"><option value="3">3 years</option><option value="5">5 years</option><option value="10">10 years</option><option value="all">All years</option></select>
              ${this.chip("band", "Min–max range", "--s-avg")}
              ${this.chip("all", "Every year", "--muted")}
            </div>
          </div>
        </div>
      </div>
      <div class="headline"><p data-headline>Loading…</p><button class="btn ghost small" type="button" data-copy title="Copy this sentence">Copy</button></div>
      <div class="cards" data-cards>${'<div class="card skeleton"></div>'.repeat(6)}</div>
      <div data-main></div>
      <div data-rank></div>`;
    this.headline = this.root.querySelector("[data-headline]");
    this.cards = this.root.querySelector("[data-cards]");
    this.main = new ChartPanel(this.root.querySelector("[data-main]"), { title: "Hydro reservoirs", size: "tall", overview: false });
    this.rank = new ChartPanel(this.root.querySelector("[data-rank]"), { title: "The same week in every year", size: "short" });
    this.root.querySelector("[data-copy]").addEventListener("click", () => copyText(this.headline.textContent));
    this.root.querySelectorAll("[data-k]").forEach(input => input.addEventListener("change", () => {
      this.state[input.dataset.k] = input.value;
      if (input.dataset.k === "year") this.state.week = "";
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
    this.root.querySelectorAll("[data-k]").forEach(input => {
      if (input.tagName === "SELECT" && !input.querySelector(`option[value="${CSS.escape(s[input.dataset.k])}"]`)) return;
      input.value = s[input.dataset.k];
    });
    this.root.querySelectorAll("[data-chip]").forEach(chip => chip.setAttribute("aria-pressed", s[chip.dataset.chip] === "1"));
    this.root.querySelector('[data-chip="band"]').disabled = s.show !== "abs";
    this.root.querySelector('[data-chip="all"]').disabled = s.show !== "abs" || s.view !== "season";
  }

  activate() {
    this.update();
  }

  /** Season year of a week: calendar ISO year, or Oct–Sep hydro year. */
  seasonOf(isoYear, week) {
    const ws = Number(this.state.start);
    return ws === 1 ? isoYear : week >= ws ? isoYear : isoYear - 1;
  }

  seasonLabel(y) {
    return this.state.start === "1" ? String(y) : `${y}–${String(y + 1).slice(-2)}`;
  }

  /** Position of an ISO week within the season (0-based). */
  slotOf(week) {
    const ws = Number(this.state.start);
    return ws === 1 ? week - 1 : (week - ws + 53) % 53;
  }

  async update() {
    const s = this.state;
    try {
      const rows = await getReserves();
      this.rows = rows.map(r => {
        const [iy, w] = isoWeek(r.start);
        return { ...r, iy, w, season: this.seasonOf(iy, w), slot: this.slotOf(w) };
      });
      const seasons = [...new Set(this.rows.map(r => r.season))].sort((a, b) => b - a);
      const select = this.root.querySelector("[data-years]");
      const opts = seasons.map(y => `<option value="${y}">${this.seasonLabel(y)}</option>`).join("");
      if (select.innerHTML !== opts) select.innerHTML = opts;
      if (!s.year || !seasons.includes(Number(s.year))) s.year = String(seasons[0]);
      this.syncControls();
      writeHash("hydro", s);
      this.bySeason = new Map();
      for (const r of this.rows) {
        if (!this.bySeason.has(r.season)) this.bySeason.set(r.season, new Map());
        this.bySeason.get(r.season).set(r.slot, r);
      }
      this.renderSummary();
      if (s.view === "season") this.renderSeason(); else this.renderHistory();
      this.renderRanking();
    } catch (error) {
      console.error(error);
      this.headline.textContent = `The reservoir data could not be loaded (${error.message}).`;
    }
  }

  previousSeasons(year) {
    const n = this.state.n === "all" ? 99 : Number(this.state.n);
    const out = [];
    for (let k = 1; k <= n; k++) if (this.bySeason.has(year - k)) out.push(year - k);
    return out;
  }

  slotStats(year, slot) {
    const prev = this.previousSeasons(year).map(y => this.bySeason.get(y).get(slot)?.mwh).filter(v => v != null);
    return {
      avg: prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : null,
      min: prev.length >= 2 ? Math.min(...prev) : null,
      max: prev.length >= 2 ? Math.max(...prev) : null,
      ly: this.bySeason.get(year - 1)?.get(slot)?.mwh ?? null,
      n: prev.length
    };
  }

  /** Category label for a slot: the date that week starts in the focus season. */
  slotLabels(year) {
    const labels = [];
    const ws = Number(this.state.start);
    // Monday of ISO week ws of the season's first ISO year.
    const jan4 = `${year}-01-04`;
    const [y, m, d] = jan4.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    const monday = addDays(jan4, -((t.getUTCDay() + 6) % 7));
    const first = addDays(monday, (ws - 1) * 7);
    for (let i = 0; i < 53; i++) labels.push(addDays(first, 7 * i));
    return labels;
  }

  renderSeason() {
    const s = this.state;
    const year = Number(s.year);
    const labels = this.slotLabels(year);
    const cur = this.bySeason.get(year) || new Map();
    const slots = Array.from({ length: 53 }, (_, i) => i);
    const series = [];
    const diff = s.show !== "abs";
    const yearsTxt = this.previousSeasons(year);
    const avgName = `Average ${yearsTxt.length ? `${this.seasonLabel(yearsTxt.at(-1))}${yearsTxt.length > 1 ? ` to ${this.seasonLabel(yearsTxt[0])}` : ""}` : ""}`;
    if (diff) {
      const pct = s.show === "pct";
      const data = slots.map(i => {
        const r = cur.get(i);
        const st = this.slotStats(year, i);
        if (!r || st.avg == null) return null;
        return [i, pct ? (r.mwh / st.avg - 1) * 100 : twh(r.mwh - st.avg)];
      }).filter(Boolean);
      series.push({ name: `${this.seasonLabel(year)} vs ${avgName.toLowerCase()}`, colour: "--s-actual", type: "bar", data, unit: pct ? "%" : "TWh", decimals: pct ? 1 : 2, colourFn: v => (v >= 0 ? "--ok" : "--danger"), barColours: () => "--s-actual" });
      if (s.ly === "1") {
        const lyData = slots.map(i => {
          const r = this.bySeason.get(year - 1)?.get(i);
          const st = this.slotStats(year - 1, i);
          if (!r || st.avg == null) return null;
          return [i, pct ? (r.mwh / st.avg - 1) * 100 : twh(r.mwh - st.avg)];
        }).filter(Boolean);
        series.push({ name: `${this.seasonLabel(year - 1)} vs its own previous average`, colour: "--s-ly", type: "line", data: lyData, unit: pct ? "%" : "TWh", decimals: pct ? 1 : 2, width: 1.5 });
      }
    } else {
      if (s.band === "1") {
        const band = slots.map(i => { const st = this.slotStats(year, i); return st.min == null ? null : [i, twh(st.min), twh(st.max)]; }).filter(Boolean);
        if (band.length) series.push({ name: `Range ${avgName.replace("Average ", "")}`, colour: "--s-band", type: "band", data: band, unit: "TWh" });
      }
      if (s.all === "1") {
        for (const y of [...this.bySeason.keys()].sort()) {
          if (y === year || (s.ly === "1" && y === year - 1)) continue;
          const m = this.bySeason.get(y);
          series.push({ name: this.seasonLabel(y), colour: "--muted", type: "line", data: slots.map(i => (m.get(i) ? [i, twh(m.get(i).mwh)] : null)).filter(Boolean), unit: "TWh", decimals: 2, width: 0.8, symbols: false });
        }
      }
      if (s.avg === "1") series.push({ name: avgName, colour: "--s-avg", type: "line", dashed: true, width: 1.6, unit: "TWh", decimals: 2, data: slots.map(i => { const st = this.slotStats(year, i); return st.avg == null ? null : [i, twh(st.avg)]; }).filter(Boolean) });
      if (s.ly === "1" && this.bySeason.has(year - 1)) {
        const m = this.bySeason.get(year - 1);
        series.push({ name: this.seasonLabel(year - 1), colour: "--s-ly", type: "line", data: slots.map(i => (m.get(i) ? [i, twh(m.get(i).mwh)] : null)).filter(Boolean), unit: "TWh", decimals: 2, width: 1.6 });
      }
      series.push({ name: this.seasonLabel(year), colour: "--s-actual", type: "line", data: slots.map(i => (cur.get(i) ? [i, twh(cur.get(i).mwh)] : null)).filter(Boolean), unit: "TWh", decimals: 2, width: 2.8, z: 20, symbols: true });
    }
    this.main.setTitle(`Hydro reservoirs, ${this.seasonLabel(year)} against earlier years`, `Energy stored at the end of each week · ${diff ? (s.show === "pct" ? "%" : "TWh") : "TWh"}`);
    this.main.render({
      xType: "category", categories: labels.map(d => `Wk ${isoWeek(d)[1]} · ${fmtShortDate(d)}`), xLabel: x => x, xHeader: "Week (week starting, in the selected year)",
      axisLabel: v => String(v).split(" · ")[1] || v,
      yName: diff ? (s.show === "pct" ? "%" : "TWh") : "TWh", yFormat: v => fmtNumber(v, 1), zeroLine: diff,
      series, legendCaption: "Average for the weeks in view",
      tooltipExtra: i => {
        const r = cur.get(i);
        return r ? `<div class="muted" style="margin-top:6px">Week ${r.w}: ${fmtLongDate(r.start)} to ${fmtLongDate(addDays(r.end, -1))}</div>` : "";
      },
      notes: [
        "Weeks are matched by ISO week number, so each point compares the same week of the year. Earlier years’ averages and ranges use only the years before the one selected.",
        "RTE publishes the stored energy (in MWh) of the reservoirs it monitors once a week, usually on Wednesday for the week to Sunday."
      ]
    });
  }

  renderHistory() {
    const s = this.state;
    const series = [];
    const pts = this.rows.map(r => [parisMidnight(r.end), twh(r.mwh)]);
    const norm = this.rows.map(r => { const st = this.slotStats(r.season, r.slot); return st.avg == null ? null : [parisMidnight(r.end), twh(st.avg)]; }).filter(Boolean);
    if (s.show !== "abs") {
      const pct = s.show === "pct";
      const data = this.rows.map(r => { const st = this.slotStats(r.season, r.slot); return st.avg == null ? null : [parisMidnight(r.end), pct ? (r.mwh / st.avg - 1) * 100 : twh(r.mwh - st.avg)]; }).filter(Boolean);
      series.push({ name: "Difference from the average of previous years", colour: "--s-actual", type: "bar", data, unit: pct ? "%" : "TWh", decimals: pct ? 1 : 2, colourFn: v => (v >= 0 ? "--ok" : "--danger") });
    } else {
      if (s.avg === "1") series.push({ name: "Average of previous years, same week", colour: "--s-avg", type: "line", data: norm, dashed: true, width: 1.4, unit: "TWh", decimals: 2 });
      series.push({ name: "Stored energy", colour: "--s-actual", type: "line", data: pts, width: 2.2, unit: "TWh", decimals: 2, z: 20 });
    }
    this.main.setTitle("Hydro reservoirs since 2014", `Energy stored at the end of each week · ${s.show === "pct" ? "%" : "TWh"}`);
    this.main.render({
      xType: "time", xLabel: x => `Week to ${fmtDate(x - 86400000)}`, csvLabel: x => csvDate(x - 86400000), xHeader: "Week ending",
      yName: s.show === "pct" ? "%" : "TWh", yFormat: v => fmtNumber(v, 1), zeroLine: s.show !== "abs", series,
      notes: [`The average uses the ${this.state.n === "all" ? "all earlier" : `${this.state.n} previous`} years available for each week.`]
    });
  }

  latest() {
    return this.rows.at(-1);
  }

  renderSummary() {
    const r = this.latest();
    if (!r) return;
    const prevWeek = this.rows.at(-2);
    const st = this.slotStats(r.season, r.slot);
    const sameWeek = [...this.bySeason.entries()].map(([y, m]) => ({ y, v: m.get(r.slot)?.mwh })).filter(e => e.v != null);
    const desc = [...sameWeek].sort((a, b) => b.v - a.v);
    const rankHigh = desc.findIndex(e => e.y === r.season) + 1;
    const rankLow = sameWeek.length - rankHigh + 1;
    const rank = rankLow <= rankHigh ? `${rankLow === 1 ? "the lowest" : `the ${ordinal(rankLow)} lowest`}` : `${rankHigh === 1 ? "the highest" : `the ${ordinal(rankHigh)} highest`}`;
    const pctAvg = st.avg ? (r.mwh / st.avg - 1) * 100 : null;
    const yearsTxt = this.state.n === "all" ? "all previous years" : `the previous ${Math.min(Number(this.state.n), st.n)} years`;
    let text = `French hydro reservoirs held ${fmtNumber(twh(r.mwh), 2)} TWh in the week to ${fmtLongDate(addDays(r.end, -1))} (week ${r.w})`;
    if (prevWeek) text += `, ${fmtNumber(Math.abs(twh(r.mwh - prevWeek.mwh)), 2)} TWh ${r.mwh >= prevWeek.mwh ? "more" : "less"} than a week earlier`;
    text += ".";
    const cmp = [];
    if (pctAvg != null) cmp.push(`${fmtNumber(Math.abs(pctAvg), 1)}% ${pctAvg >= 0 ? "above" : "below"} the average of ${yearsTxt} for the same week`);
    if (st.ly != null) cmp.push(`${fmtNumber(Math.abs((r.mwh / st.ly - 1) * 100), 1)}% ${r.mwh >= st.ly ? "above" : "below"} last year`);
    if (sameWeek.length > 1) cmp.push(`${rank} for this week since ${Math.min(...sameWeek.map(e => e.y))}`);
    if (cmp.length) text += ` That is ${cmp.join(", ").replace(/, ([^,]*)$/, " and $1")}.`.replace("That is the", "It is the");
    this.headline.textContent = text;

    const record = desc[0];
    const low = desc.at(-1);
    const card = (l, v, d = "", c = "") => `<div class="card${c}"><div class="label">${l}</div><div class="value">${v}</div><div class="detail">${d}</div></div>`;
    this.cards.innerHTML = [
      card("Stored energy", `${fmtNumber(twh(r.mwh), 2)} TWh`, `Week ${r.w}, to ${fmtShortDate(addDays(r.end, -1))}`, " accent"),
      prevWeek ? card("Change on the week", `${r.mwh >= prevWeek.mwh ? "+" : "−"}${fmtNumber(Math.abs(twh(r.mwh - prevWeek.mwh)), 2)} TWh`, fmtPct((r.mwh / prevWeek.mwh - 1) * 100)) : "",
      pctAvg != null ? card(`vs ${this.state.n === "all" ? "all-years" : `${Math.min(Number(this.state.n), st.n)}-year`} average`, fmtPct(pctAvg), `${fmtNumber(twh(st.avg), 2)} TWh for week ${r.w}`) : "",
      st.ly != null ? card("vs last year", fmtPct((r.mwh / st.ly - 1) * 100), `${fmtNumber(twh(st.ly), 2)} TWh a year ago`) : "",
      card("Rank for this week", rank.replace("the ", "").replace(/^./, c => c.toUpperCase()), `Of ${sameWeek.length} years`),
      card("Range for this week", `${fmtNumber(twh(low.v), 1)}–${fmtNumber(twh(record.v), 1)} TWh`, `Low ${this.seasonLabel(low.y)} · high ${this.seasonLabel(record.y)}`)
    ].join("");
  }

  renderRanking() {
    const s = this.state;
    const year = Number(s.year);
    const yearMap = this.bySeason.get(year);
    const slot = yearMap ? Math.max(...yearMap.keys()) : this.latest().slot;
    const focus = yearMap?.get(slot) || this.latest();
    const rows = [...this.bySeason.entries()].map(([y, m]) => ({ y, v: m.get(slot)?.mwh })).filter(e => e.v != null).sort((a, b) => a.y - b.y);
    const n = this.previousSeasons(year).length;
    const colourFor = (_, i) => (rows[i]?.y === year ? "--s-actual" : rows[i] && year - rows[i].y <= n && rows[i].y < year ? "--s-avg" : "--s-band");
    this.rank.setTitle(`Week ${focus.w} in every year`, `Energy stored in the week to ${fmtShortDate(addDays(focus.end, -1))} and the same week of each year · TWh`);
    this.rank.render({
      xType: "category", categories: rows.map(r => this.seasonLabel(r.y)), xLabel: x => x, xHeader: "Year", yName: "TWh", yMin: 0, yScale: false,
      yFormat: v => fmtNumber(v, 1),
      series: [{ name: `Week ${focus.w}`, colour: "--s-actual", type: "bar", data: rows.map((r, i) => [i, twh(r.v)]), unit: "TWh", decimals: 2, avg: false, barWidth: 34, colourFn: colourFor, barColours: i => colourFor(null, i), labels: v => fmtNumber(v, 2) }],
      legendCaption: null,
      notes: ["Highlighted: the selected year. Mid-tone bars are the years in the average."]
    });
  }

  refreshTheme() {
    this.main.refreshTheme();
    this.rank.refreshTheme();
  }
}
