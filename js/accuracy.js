// Forecast accuracy: how well RTE's D-1, D-2 and week-ahead forecasts matched
// actual demand, over time, by lead time, by hour/season and by weekday.

import { ChartPanel } from "./chart.js";
import { getDaily, getErrorProfile, getWeeklyErrors } from "./data.js";
import {
  csvDate, HOUR, addDays, el, fmtDate, fmtLongDate, fmtMonth, fmtNumber, fmtPct, fmtSignedGW, holidayName,
  parisMidnight, todayParis, weekdayIndex, writeHash
} from "./util.js";

const METRICS = {
  mape: { label: "MAPE", long: "Mean absolute percentage error", unit: "%", daily: "mape_pct", weekly: "mape_pct" },
  mae: { label: "MAE", long: "Mean absolute error", unit: "GW", daily: "mae_mw", weekly: "mae_mw" },
  bias: { label: "Bias", long: "Mean error (forecast minus actual)", unit: "GW", daily: "bias_mw", weekly: "bias_mw" }
};

const FORECAST_LABEL = { d1: "D-1", d2: "D-2", wk: "Week-ahead" };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SEASONS = [
  { name: "Winter (Dec–Feb)", months: [12, 1, 2], colour: "--s-id" },
  { name: "Spring (Mar–May)", months: [3, 4, 5], colour: "--s-ly" },
  { name: "Summer (Jun–Aug)", months: [6, 7, 8], colour: "--s-d1" },
  { name: "Autumn (Sep–Nov)", months: [9, 10, 11], colour: "--s-week" }
];
const MIN_PAIRS = 40; // of 46-50 half-hours: skip days with large gaps

function presetRange(preset, today) {
  const end = addDays(today, -1);
  switch (preset) {
    case "90d": return [addDays(end, -89), end];
    case "1y": return [addDays(end, -364), end];
    case "3y": return [addDays(end, -3 * 365 + 1), end];
    case "all": return ["2012-12-17", end];
    default: return null;
  }
}

export class Accuracy {
  constructor(root) {
    this.root = root;
    const [from, to] = presetRange("1y", todayParis());
    this.state = { fc: "d1", lead: "3", metric: "mape", preset: "1y", from, to, roll: "30" };
    this.build();
  }

  setParams(params) {
    for (const key of Object.keys(this.state)) if (params.has(key)) this.state[key] = params.get(key);
    if (this.state.preset !== "custom") [this.state.from, this.state.to] = presetRange(this.state.preset, todayParis());
    this.syncControls();
  }

  build() {
    this.root.innerHTML = `
      <div class="toolbar" role="group" aria-label="Accuracy settings">
        <label class="field"><span>Forecast</span>
          <select data-k="fc"><option value="d1">D-1 (day-ahead)</option><option value="d2">D-2 (two days ahead)</option><option value="wk">Week-ahead</option></select>
        </label>
        <label class="field" data-lead><span>Lead time</span>
          <select data-k="lead">${[3, 4, 5, 6, 7, 8, 9].map(l => `<option value="${l}">${l} days ahead</option>`).join("")}</select>
        </label>
        <label class="field"><span>Measure</span>
          <select data-k="metric"><option value="mape">MAPE (%)</option><option value="mae">MAE (GW)</option><option value="bias">Bias (GW)</option></select>
        </label>
        <span class="divider"></span>
        <label class="field"><span>Period</span>
          <select data-k="preset"><option value="90d">Last 90 days</option><option value="1y">Last year</option><option value="3y">Last 3 years</option><option value="all">All (from Dec 2012)</option><option value="custom">Custom</option></select>
        </label>
        <label class="field"><span>From</span><input type="date" data-k="from" min="2012-12-17"></label>
        <label class="field"><span>To</span><input type="date" data-k="to" min="2012-12-17"></label>
        <label class="field"><span>Rolling average</span>
          <select data-k="roll"><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select>
        </label>
      </div>
      <p class="headline" data-headline>Loading…</p>
      <div class="cards" data-cards></div>
      <div data-time></div>
      <div class="grid-2"><div data-lead-chart></div><div data-weekday></div></div>
      <div data-hour></div>
      <article class="panel">
        <div class="panel-head"><div><h2>Biggest misses</h2><p data-miss-sub></p></div></div>
        <div class="table-scroll" style="margin:12px 16px 16px;max-height:none" data-misses></div>
      </article>`;

    this.headline = this.root.querySelector("[data-headline]");
    this.cards = this.root.querySelector("[data-cards]");
    this.timePanel = new ChartPanel(this.root.querySelector("[data-time]"), { title: "Error over time" });
    this.leadPanel = new ChartPanel(this.root.querySelector("[data-lead-chart]"), { title: "Error by lead time", size: "short" });
    this.weekdayPanel = new ChartPanel(this.root.querySelector("[data-weekday]"), { title: "Error by weekday", size: "short" });
    this.hourPanel = new ChartPanel(this.root.querySelector("[data-hour]"), { title: "Error by time of day and season", size: "short" });
    this.misses = this.root.querySelector("[data-misses]");
    this.missSub = this.root.querySelector("[data-miss-sub]");

    this.root.querySelectorAll("[data-k]").forEach(input => input.addEventListener("change", () => {
      const key = input.dataset.k;
      this.state[key] = input.value;
      if (key === "preset" && input.value !== "custom") [this.state.from, this.state.to] = presetRange(input.value, todayParis());
      if (key === "from" || key === "to") this.state.preset = "custom";
      if (this.state.from > this.state.to) [this.state.from, this.state.to] = [this.state.to, this.state.from];
      this.syncControls();
      this.update();
    }));
    this.syncControls();
  }

  syncControls() {
    this.root.querySelectorAll("[data-k]").forEach(input => { input.value = this.state[input.dataset.k]; });
    this.root.querySelector("[data-lead]").classList.toggle("hidden", this.state.fc !== "wk");
  }

  activate() {
    this.update();
  }

  forecastKey() {
    return this.state.fc === "wk" ? `w${this.state.lead}` : this.state.fc;
  }

  forecastName() {
    return this.state.fc === "wk" ? `Week-ahead (${this.state.lead} days)` : FORECAST_LABEL[this.state.fc];
  }

  /** Daily rows for the chosen forecast: [{ date, mape, mae, bias, peakError, actualMean }]. */
  async dailyErrors() {
    const s = this.state;
    const daily = await getDaily();

    if (s.fc !== "wk") {
      const p = s.fc;
      return daily.rows
        .filter(r => r.date >= s.from && r.date <= s.to && r[`${p}_pairs`] >= MIN_PAIRS)
        .map(r => ({
          date: r.date, mape: r[`${p}_mape_pct`], mae: r[`${p}_mae_mw`], bias: r[`${p}_bias_mw`],
          peakError: r[`${p}_peak_error_mw`], actualMean: r.mean_mw
        }));
    }

    const lead = Number(s.lead);
    const latest = new Map();
    for (const r of await getWeeklyErrors()) {
      if (r.lead_days !== lead || r.target_date < s.from || r.target_date > s.to || r.pairs < MIN_PAIRS) continue;
      const prev = latest.get(r.target_date);
      if (!prev || r.updated_utc > prev.updated_utc) latest.set(r.target_date, r);
    }
    return [...latest.values()].sort((a, b) => (a.target_date < b.target_date ? -1 : 1)).map(r => ({
      date: r.target_date, mape: r.mape_pct, mae: r.mae_mw, bias: r.bias_mw, peakError: r.peak_error_mw,
      actualMean: daily.byDate.get(r.target_date)?.mean_mw ?? null, refTemp: r.ref_temp_c, tempDev: r.temp_dev_c
    }));
  }

  async update() {
    const s = this.state;
    writeHash("accuracy", s);
    this.headline.textContent = "Loading…";
    try {
      const [rows, profile] = await Promise.all([this.dailyErrors(), getErrorProfile()]);
      this.renderTime(rows);
      this.renderProfileCharts(profile);
      this.renderMisses(rows);
      this.renderSummary(rows);
    } catch (error) {
      console.error(error);
      this.headline.textContent = `The accuracy data could not be loaded (${error.message}).`;
    }
  }

  metricValue(row) {
    const v = row[this.state.metric];
    if (v == null) return null;
    return this.state.metric === "mape" ? v : v / 1000;
  }

  fmtMetric(v) {
    if (v == null || !Number.isFinite(v)) return "–";
    if (this.state.metric === "mape") return `${fmtNumber(v, 2)}%`;
    if (this.state.metric === "bias") return fmtSignedGW(v * 1000, 2);
    return `${fmtNumber(v, 2)} GW`;
  }

  renderTime(rows) {
    const s = this.state;
    const m = METRICS[s.metric];
    const window = Number(s.roll);
    const points = rows.map(r => [parisMidnight(r.date), this.metricValue(r), r.date]).filter(p => p[1] != null);

    // Trailing rolling mean over calendar days.
    const rolling = [];
    let start = 0;
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      sum += points[i][1];
      const cutoff = addDays(points[i][2], -window + 1);
      while (points[start][2] < cutoff) { sum -= points[start][1]; start += 1; }
      const n = i - start + 1;
      if (n >= Math.ceil(window * 0.6)) rolling.push([points[i][0], sum / n]);
    }

    const format = v => this.fmtMetric(v);
    this.timePanel.setTitle(`${this.forecastName()} ${m.label} over time`, `${m.long}, by day and ${window}-day rolling average · ${fmtLongDate(s.from)} – ${fmtLongDate(s.to)}`);
    this.timePanel.render({
      xType: "time", xLabel: x => fmtDate(x), csvLabel: csvDate, xHeader: "Date", yName: m.unit,
      yMin: s.metric === "bias" ? undefined : 0,
      yFormat: v => fmtNumber(v, s.metric === "mape" ? 1 : 1),
      series: [
        { name: `Daily ${m.label}`, colour: "--s-avg", type: points.length > 400 ? "line" : "bar", data: points.map(p => [p[0], p[1]]), width: 1, format, unit: m.unit },
        { name: `${window}-day rolling average`, colour: "--s-actual", type: "line", data: rolling, width: 2.4, format, unit: m.unit, avg: false }
      ],
      notes: this.notes()
    });
  }

  notes() {
    const notes = [
      "Errors compare half-hourly forecasts with the average of the two matching 15-minute actuals. Error = forecast minus actual, so positive bias means RTE over-forecast demand.",
      `Days with fewer than ${MIN_PAIRS} matched half-hours are left out.`
    ];
    if (this.state.fc === "d1") notes.push("RTE time-stamps historical D-1 forecasts after delivery, so it can't be confirmed that values before 26 Oct 2026 are the versions published the day before. From that date the hourly update records the version published in advance.");
    if (this.state.fc === "wk") notes.push("Week-ahead forecasts are published on weekdays; where several versions exist for the same target day and lead time, the latest is used.");
    return notes;
  }

  /** Sum error-profile rows for the chosen period (whole months). */
  profileSums(profile, forecast, dimension) {
    const s = this.state;
    const fromM = s.from.slice(0, 7);
    const toM = s.to.slice(0, 7);
    const out = new Map();
    for (const r of profile) {
      if (r.forecast !== forecast || r.dimension !== dimension || r.month < fromM || r.month > toM) continue;
      const key = dimension === "hour-season" ? null : r.key;
      const acc = out.get(key) || { n: 0, abs: 0, err: 0, ape: 0 };
      acc.n += r.n; acc.abs += r.sum_abs_err_mw; acc.err += r.sum_err_mw; acc.ape += r.sum_abs_pct_err;
      out.set(key, acc);
    }
    return out;
  }

  fromSums(acc) {
    if (!acc || !acc.n) return null;
    if (this.state.metric === "mape") return acc.ape / acc.n;
    if (this.state.metric === "mae") return acc.abs / acc.n / 1000;
    return acc.err / acc.n / 1000;
  }

  renderProfileCharts(profile) {
    const s = this.state;
    const m = METRICS[s.metric];
    const fk = this.forecastKey();
    const format = v => this.fmtMetric(v);
    const monthsNote = `Based on whole months from ${fmtMonth(parisMidnight(`${s.from.slice(0, 7)}-01`) + 12 * HOUR)} to ${fmtMonth(parisMidnight(`${s.to.slice(0, 7)}-01`) + 12 * HOUR)}.`;

    // By lead time.
    const leads = ["d1", "d2", "w3", "w4", "w5", "w6", "w7", "w8", "w9"];
    const leadLabels = ["D-1", "D-2", "3 days", "4 days", "5 days", "6 days", "7 days", "8 days", "9 days"];
    const leadValues = leads.map(f => {
      const sums = this.profileSums(profile, f, "hour");
      let total = null;
      for (const acc of sums.values()) {
        total = total || { n: 0, abs: 0, err: 0, ape: 0 };
        total.n += acc.n; total.abs += acc.abs; total.err += acc.err; total.ape += acc.ape;
      }
      return this.fromSums(total);
    });
    this.leadPanel.setTitle(`${m.label} by lead time`, "How accuracy falls with forecast horizon");
    this.leadPanel.render({
      xType: "category", categories: leadLabels, xLabel: x => x, xHeader: "Forecast", yName: m.unit,
      yMin: s.metric === "bias" ? undefined : 0, yFormat: v => fmtNumber(v, 1),
      series: [{ name: m.label, colour: "--s-actual", type: "bar", data: leadValues.map((v, i) => [i, v]).filter(p => p[1] != null), format, unit: m.unit, avg: false }],
      notes: [monthsNote]
    });

    // By weekday.
    const wd = this.profileSums(profile, fk, "weekday");
    this.weekdayPanel.setTitle(`${this.forecastName()} ${m.label} by weekday`, "");
    this.weekdayPanel.render({
      xType: "category", categories: WEEKDAYS, xLabel: x => x, xHeader: "Weekday", yName: m.unit,
      yMin: s.metric === "bias" ? undefined : 0, yFormat: v => fmtNumber(v, 1),
      series: [{ name: m.label, colour: "--s-d1", type: "bar", data: WEEKDAYS.map((_, i) => [i, this.fromSums(wd.get(i))]).filter(p => p[1] != null), format, unit: m.unit }],
      notes: [monthsNote]
    });

    // By hour of day, one line per season.
    const fromM = s.from.slice(0, 7);
    const toM = s.to.slice(0, 7);
    const bySeason = SEASONS.map(() => Array.from({ length: 24 }, () => ({ n: 0, abs: 0, err: 0, ape: 0 })));
    for (const r of profile) {
      if (r.forecast !== fk || r.dimension !== "hour" || r.month < fromM || r.month > toM) continue;
      const month = Number(r.month.slice(5));
      const si = SEASONS.findIndex(season => season.months.includes(month));
      const acc = bySeason[si][r.key];
      acc.n += r.n; acc.abs += r.sum_abs_err_mw; acc.err += r.sum_err_mw; acc.ape += r.sum_abs_pct_err;
    }
    const hours = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);
    this.hourPanel.setTitle(`${this.forecastName()} ${m.label} by time of day and season`, "Paris local time");
    this.hourPanel.render({
      xType: "category", categories: hours, xLabel: x => x, xHeader: "Hour (Europe/Paris)", yName: m.unit,
      yMin: s.metric === "bias" ? undefined : 0, yFormat: v => fmtNumber(v, 1),
      series: SEASONS.map((season, si) => ({
        name: season.name, colour: season.colour, type: "line", width: 2, format, unit: m.unit,
        data: bySeason[si].map((acc, h) => [h, this.fromSums(acc)]).filter(p => p[1] != null)
      })).filter(series => series.data.length),
      notes: [monthsNote]
    });
  }

  renderMisses(rows) {
    const s = this.state;
    const key = s.metric === "bias" ? r => Math.abs(r.bias ?? 0) : r => r[s.metric] ?? 0;
    const top = [...rows].sort((a, b) => key(b) - key(a)).slice(0, 15);
    this.missSub.textContent = `The ${top.length} days with the largest ${s.metric === "bias" ? "absolute bias" : METRICS[s.metric].label} for ${this.forecastName()} in the period. Click a day to open it in the Explorer.`;

    const tempCols = s.fc === "wk";
    this.misses.innerHTML = `<table>
      <thead><tr><th>Date</th><th>MAPE</th><th>MAE</th><th>Bias</th><th>Peak error</th><th>Actual average</th>${tempCols ? "<th>Temp. deviation</th>" : ""}<th>Note</th></tr></thead>
      <tbody>${top.map(r => `<tr class="clickable" data-date="${r.date}">
        <td>${fmtDate(parisMidnight(r.date) + 12 * HOUR)}</td>
        <td>${r.mape == null ? "–" : `${fmtNumber(r.mape, 2)}%`}</td>
        <td>${r.mae == null ? "–" : `${fmtNumber(r.mae / 1000, 2)} GW`}</td>
        <td>${fmtSignedGW(r.bias, 2)}</td>
        <td>${fmtSignedGW(r.peakError, 2)}</td>
        <td>${r.actualMean == null ? "–" : `${fmtNumber(r.actualMean / 1000, 1)} GW`}</td>
        ${tempCols ? `<td>${r.tempDev == null ? "–" : `${r.tempDev > 0 ? "+" : ""}${fmtNumber(r.tempDev, 1)} °C`}</td>` : ""}
        <td style="font-family:var(--sans)">${holidayName(r.date) || (weekdayIndex(r.date) >= 5 ? "Weekend" : "")}</td>
      </tr>`).join("")}</tbody></table>`;

    this.misses.querySelectorAll("tr[data-date]").forEach(tr => tr.addEventListener("click", () => {
      const d = tr.dataset.date;
      const params = new URLSearchParams({ preset: "custom", from: d, to: d, res: "15m", ly: "0", avg: "0", band: "0", d1: "1", d2: "1" });
      location.hash = `explorer?${params}`;
    }));
  }

  renderSummary(rows) {
    const s = this.state;
    if (!rows.length) {
      this.headline.textContent = "No forecast and actual data overlap in this period.";
      this.cards.innerHTML = "";
      return;
    }
    const avg = f => rows.map(f).filter(Number.isFinite).reduce((a, b, _, arr) => a + b / arr.length, 0);
    const mape = avg(r => r.mape);
    const mae = avg(r => r.mae);
    const bias = avg(r => r.bias);
    const over = rows.filter(r => r.bias > 0).length / rows.length * 100;
    const peakAbs = avg(r => (r.peakError == null ? NaN : Math.abs(r.peakError)));

    this.headline.textContent = `From ${fmtLongDate(rows[0].date)} to ${fmtLongDate(rows[rows.length - 1].date)}, RTE's ${this.forecastName()} forecast was off by ${fmtNumber(mape, 2)}% on average (${fmtNumber(mae / 1000, 2)} GW), and ${bias >= 0 ? "over" : "under"}-forecast demand by ${fmtNumber(Math.abs(bias) / 1000, 2)} GW on average.`;

    const card = (label, value, detail = "") => `<div class="card"><div class="label">${label}</div><div class="value">${value}</div><div class="detail">${detail}</div></div>`;
    this.cards.innerHTML = [
      card("MAPE", `${fmtNumber(mape, 2)}%`, "Average of daily values"),
      card("MAE", `${fmtNumber(mae / 1000, 2)} GW`, "Average absolute error"),
      card("Bias", fmtSignedGW(bias, 2), "Forecast minus actual"),
      card("Days over-forecast", fmtPct(over, 0, false), `${rows.length} days with data`),
      card("Peak error", `${fmtNumber(peakAbs / 1000, 2)} GW`, "Average absolute error in the daily peak")
    ].join("");
  }

  refreshTheme() {
    for (const p of [this.timePanel, this.leadPanel, this.weekdayPanel, this.hourPanel]) p.refreshTheme();
  }
}

export { el };
