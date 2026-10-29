// Outlook: what RTE expects. "Next 10 days" joins actual demand with the
// intraday, D-1, D-2 and latest week-ahead forecasts, plus RTE's temperature
// assumptions. "The year" sets RTE's annual forecast and supply margin
// against actual weekly demand.

import { ChartPanel } from "./chart.js";
import { getAnnual, getDaily, getLatest, getRange, getWeekAhead, getWeeklyPeaks, latestSeries, parseUtc } from "./data.js";
import {
  HOUR, QUARTER, addDays, copyText, csvDate, csvDateTime, dateKey, fmtDate, fmtDateTime, fmtGW, fmtNumber, fmtPeriod,
  fmtShortDate, fmtSignedGW, fmtTime, heroHtml, parisMidnight, timeKey, todayParis, weekdayIndex, writeHash
} from "./util.js";

const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export class Outlook {
  constructor(root) {
    this.root = root;
    this.state = { year: todayParis().slice(0, 4), ly: "0", avgw: "0" };
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
    const thisYear = Number(todayParis().slice(0, 4));
    const years = [];
    for (let y = thisYear; y >= 2015; y--) years.push(y);

    this.root.innerHTML = `
      ${heroHtml("The outlook,", "days to a year ahead.", "What RTE expects over the next 10 days and the rest of the year, and how the year so far compares with its annual forecast.")}
      <details class="guide">
        <summary>How to read this tab</summary>
        <div class="guide-body">
          <p><b>Next 10 days.</b> RTE publishes several forecasts, each covering a different horizon. This tab joins them into one view: actual demand so far today, the <b>intraday</b> forecast for the rest of today, the <b>D-1</b> (day-ahead) forecast for tomorrow, the <b>D-2</b> forecast for the day after, and the most recent <b>week-ahead</b> forecast for days 3 to 9. The timeline below shows which forecast covers which day. Further ahead, forecasts are less accurate: since 2012, RTE's week-ahead forecast has missed by about 2.8% on average at 3 days ahead and 4.3% at 9 days (see the Forecast accuracy tab).</p>
          <p><b>Temperature.</b> With each week-ahead forecast, RTE publishes the expected daily peak and the temperature it assumed, as a gap from the seasonal normal. In winter, colder than normal means higher demand, mainly from electric heating.</p>
          <p><b>The year.</b> At the end of each year RTE publishes a forecast for every week of the next year: a range for demand (the week's minimum and maximum), plus a single expected supply margin for the year. The charts set that range against what actually happened, and compare the margin across years.</p>
        </div>
      </details>

      <h2 class="section-title">Next 10 days</h2>
      <div class="toolbar" role="group" aria-label="Next 10 days settings">
        <div class="toolbar-row">
          <div class="field"><span>Compare with</span><div class="chips">${this.chip("ly", "Same weekdays last year", "--s-ly")}</div></div>
        </div>
      </div>
      <div class="headline"><p data-headline>Loading…</p><button class="btn ghost small" type="button" data-copy title="Copy this sentence">Copy</button></div>
      <div class="cards" data-cards>${'<div class="card skeleton"></div>'.repeat(5)}</div>
      <div class="timeline" data-timeline aria-label="Which forecast covers which day"></div>
      <div data-ten></div>
      <div data-peaks></div>

      <h2 class="section-title">The year</h2>
      <div class="toolbar" role="group" aria-label="Annual settings">
        <div class="toolbar-row">
          <label class="field"><span>Year</span>
            <select data-k="year">${years.map(y => `<option value="${y}">${y}</option>`).join("")}</select>
          </label>
          <div class="field"><span>Also show</span><div class="chips">${this.chip("avgw", "Actual weekly average", "--s-actual")}</div></div>
        </div>
      </div>
      <div data-annual></div>
      <div data-margin></div>`;

    this.headline = this.root.querySelector("[data-headline]");
    this.cards = this.root.querySelector("[data-cards]");
    this.timeline = this.root.querySelector("[data-timeline]");
    this.ten = new ChartPanel(this.root.querySelector("[data-ten]"), { title: "Next 10 days", size: "tall", overview: true });
    this.peaks = new ChartPanel(this.root.querySelector("[data-peaks]"), { title: "Week-ahead daily peaks and temperature", size: "short" });
    this.annual = new ChartPanel(this.root.querySelector("[data-annual]"), { title: "Annual forecast against actual demand" });
    this.margin = new ChartPanel(this.root.querySelector("[data-margin]"), { title: "Year-ahead supply margin", size: "short" });
    this.root.querySelector("[data-copy]").addEventListener("click", () => copyText(this.headline.textContent));

    this.root.querySelector('[data-k="year"]').addEventListener("change", event => {
      this.state.year = event.target.value;
      writeHash("outlook", this.state);
      this.renderAnnual();
    });
    this.root.querySelector('[data-chip="ly"]').addEventListener("click", () => {
      this.state.ly = this.state.ly === "1" ? "0" : "1";
      this.syncControls();
      this.renderNext();
    });
    this.root.querySelector('[data-chip="avgw"]').addEventListener("click", () => {
      this.state.avgw = this.state.avgw === "1" ? "0" : "1";
      this.syncControls();
      writeHash("outlook", this.state);
      this.renderAnnual();
    });
    this.syncControls();
  }

  syncControls() {
    this.root.querySelector('[data-k="year"]').value = this.state.year;
    for (const key of ["ly", "avgw"]) this.root.querySelector(`[data-chip="${key}"]`).setAttribute("aria-pressed", this.state[key] === "1");
  }

  activate() {
    writeHash("outlook", this.state);
    this.renderNext();
    this.renderAnnual();
  }

  async renderNext() {
    writeHash("outlook", this.state);
    this.ten.setLoading(true);
    try {
      const latest = await getLatest();
      const live = latestSeries(latest, "REALISED");
      const lastLive = Math.max(...live.keys());
      const day = Number.isFinite(lastLive) ? dateKey(lastLive) : todayParis();
      const end = addDays(day, 9);

      const [archActual, archD1, archD2, weekAhead, peaks, lyMap] = await Promise.all([
        getRange("realised", day, day),
        getRange("d1", day, addDays(day, 1)),
        getRange("d2", day, addDays(day, 2)),
        getWeekAhead(addDays(day, 3), end),
        getWeeklyPeaks(),
        this.state.ly === "1" ? getRange("realised", addDays(day, -364), addDays(end, -364)) : null
      ]);

      const actual = new Map([...archActual, ...live]);
      const id = latestSeries(latest, "ID");
      const d1 = new Map([...archD1, ...latestSeries(latest, "D-1")]);
      const d2 = new Map([...archD2, ...latestSeries(latest, "D-2")]);
      const week = new Map();
      for (const { points } of weekAhead.values()) for (const [x, v] of points) week.set(x, v);

      // Each forecast is shown only for the days it is the main forecast for.
      const only = (map, from, to) => new Map([...map].filter(([x]) => { const d = dateKey(x); return d >= from && d <= to; }));
      const pts = map => [...map].sort((a, b) => a[0] - b[0]).map(([x, v]) => [x, v / 1000]);
      const series = [];

      if (lyMap) {
        const byKey = new Map([...lyMap].map(([ms, mw]) => [`${dateKey(ms)} ${timeKey(ms)}`, mw]));
        const ly = new Map();
        for (let x = parisMidnight(day); x < parisMidnight(addDays(end, 1)); x += QUARTER) {
          const v = byKey.get(`${addDays(dateKey(x), -364)} ${timeKey(x)}`);
          if (v != null) ly.set(x, v);
        }
        series.push({ name: "Same weekdays last year", colour: "--s-ly", type: "line", data: pts(ly), width: 1.4, unit: "GW" });
      }
      series.push({ name: "Week-ahead (days 3–9)", colour: "--s-week", type: "line", data: pts(week), width: 2, unit: "GW" });
      series.push({ name: "D-2 (day after tomorrow)", colour: "--s-d2", type: "line", data: pts(only(d2, addDays(day, 2), addDays(day, 2))), width: 2, unit: "GW" });
      series.push({ name: "D-1 (tomorrow)", colour: "--s-d1", type: "line", data: pts(only(d1, addDays(day, 1), addDays(day, 1))), width: 2, unit: "GW" });
      series.push({ name: "Intraday (today)", colour: "--s-id", type: "line", data: pts(id), dashed: true, width: 1.8, unit: "GW" });
      series.push({ name: "Actual", colour: "--s-actual", type: "line", data: pts(actual), width: 3, unit: "GW", z: 20 });

      this.ten.setTitle("Next 10 days", `${fmtPeriod(day, end)} · GW`);
      this.ten.render({
        xType: "time", xLabel: x => fmtDateTime(x), csvLabel: csvDateTime, yName: "GW", series,
        xMin: parisMidnight(day), xMax: parisMidnight(addDays(end, 1)),
        markAreas: [{ from: parisMidnight(day), to: parisMidnight(addDays(day, 1)), label: "Today", colour: "--today" }],
        notes: [
          "Each forecast is shown for the days it covers: intraday today, D-1 tomorrow, D-2 the day after, and the most recently published week-ahead forecast for days 3 to 9.",
          "RTE doesn't publish week-ahead forecasts at weekends, so on Mondays the latest one can be from the previous Friday.",
          weekAhead.size ? "" : "No week-ahead forecast is stored for these days yet. It is added by the regular data update."
        ]
      });

      this.renderTimeline(day, { actual, d1, d2, weekAhead });
      this.renderPeaks(day, end, peaks);
      this.renderCards(day, { d1, d2, week, weekAhead, peaks });
    } catch (error) {
      console.error(error);
      this.headline.textContent = `The outlook data could not be loaded (${error.message}).`;
      this.ten.setLoading(false);
    }
  }

  renderTimeline(day, { d1, d2, weekAhead }) {
    const hasDay = (map, date) => [...map.keys()].some(x => dateKey(x) === date);
    const cells = [];
    for (let i = 0; i <= 9; i++) {
      const date = addDays(day, i);
      let label;
      let colour;
      if (i === 0) { label = "Actual + intraday"; colour = "--s-actual"; }
      else if (i === 1) { label = hasDay(d1, date) ? "D-1" : "D-1 due ~19:30"; colour = "--s-d1"; }
      else if (i === 2) { label = hasDay(d2, date) ? "D-2" : "D-2 due ~07:00"; colour = "--s-d2"; }
      else { label = weekAhead.has(date) ? "Week-ahead" : "Not yet published"; colour = weekAhead.has(date) ? "--s-week" : "--border-strong"; }
      const name = i === 0 ? "Today" : i === 1 ? "Tomorrow" : `${WEEKDAY[weekdayIndex(date)]} ${Number(date.slice(8))}`;
      cells.push(`<div class="tl-cell" style="--c:var(${colour})"><b>${name}</b><span>${label}</span></div>`);
    }
    this.timeline.innerHTML = cells.join("");
  }

  latestPeaks(peaks, from, to) {
    const byDay = new Map();
    for (const r of peaks) {
      if (r.target_date < from || r.target_date > to) continue;
      const cur = byDay.get(r.target_date);
      if (!cur || r.updated_utc > cur.updated_utc) byDay.set(r.target_date, r);
    }
    return [...byDay.values()].sort((a, b) => (a.target_date < b.target_date ? -1 : 1));
  }

  renderPeaks(day, end, peaks) {
    const rows = this.latestPeaks(peaks, addDays(day, 3), end);
    const x = r => parisMidnight(r.target_date);
    const byX = new Map(rows.map(r => [x(r), r]));

    this.peaks.setTitle("Week-ahead daily peaks and temperature", "Latest forecast for each day · peak in GW, temperature gap from normal in °C");
    this.peaks.render({
      xType: "time", xLabel: v => fmtDate(v), csvLabel: csvDate, axisLabel: v => fmtShortDate(dateKey(v)), xHeader: "Date", yName: "GW",
      yMin: 0, yAxis2: { name: "°C", format: v => fmtNumber(v, 1) },
      series: [
        { name: "Forecast daily peak", colour: "--s-week", type: "bar", data: rows.map(r => [x(r), r.peak_mw / 1000]), unit: "GW" },
        { name: "Temperature vs normal", colour: "--s-temp", type: "line", yAxis: 1, symbols: true, data: rows.map(r => [x(r), r.temp_dev_c]).filter(p => p[1] != null), format: v => `${v > 0 ? "+" : ""}${fmtNumber(v, 1)} °C`, unit: "°C", decimals: 1 }
      ],
      tooltipExtra: v => {
        const r = byX.get(v);
        return r ? `<div style="margin-top:6px;opacity:.75">Normal ${fmtNumber(r.ref_temp_c, 1)} °C · forecast ${fmtNumber(r.ref_temp_c + r.temp_dev_c, 1)} °C · published ${fmtDateTime(parseUtc(r.updated_utc))}</div>` : "";
      },
      notes: [
        rows.length ? "" : "No week-ahead peaks are stored for these days yet. They are added by the regular data update.",
        "Positive temperature = warmer than the seasonal normal RTE uses, which lowers heating demand in winter."
      ]
    });
  }

  renderCards(day, { d1, d2, week, weekAhead, peaks }) {
    const peakOf = (map, date) => {
      const p = [...map].filter(([x]) => dateKey(x) === date);
      return p.length ? p.reduce((a, b) => (b[1] > a[1] ? b : a)) : null;
    };
    const dayPeaks = [];
    for (let i = 1; i <= 9; i++) {
      const date = addDays(day, i);
      const [map, source] = i === 1 ? [d1, "D-1"] : i === 2 ? [d2, "D-2"] : [week, "Week-ahead"];
      const p = peakOf(map, date);
      if (p) dayPeaks.push({ date, value: p[1], at: p[0], source });
    }

    const highest = dayPeaks.reduce((a, b) => (!a || b.value > a.value ? b : a), null);
    const temps = this.latestPeaks(peaks, addDays(day, 3), addDays(day, 9)).filter(r => r.temp_dev_c != null);
    const avgDev = temps.length ? temps.reduce((a, r) => a + r.temp_dev_c, 0) / temps.length : null;
    const weekDays = [...weekAhead.keys()].sort();

    this.headline.textContent = highest
      ? `RTE's highest forecast peak over the next 9 days is ${fmtGW(highest.value)} on ${fmtDate(highest.at)} (${highest.source})${avgDev != null ? `, with temperatures expected ${fmtNumber(Math.abs(avgDev), 1)} °C ${avgDev >= 0 ? "above" : "below"} normal on average from day 3 to day 9` : ""}.`
      : "No forecasts are available for the coming days yet.";

    const card = (label, value, detail = "", cls = "") => `<div class="card${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="detail">${detail}</div></div>`;
    this.cards.innerHTML = [
      highest ? card("Highest peak, next 9 days", fmtGW(highest.value), `${fmtDate(highest.at)} · ${highest.source}`, " accent") : "",
      ...dayPeaks.slice(0, 2).map(p => card(`${p.source} peak`, fmtGW(p.value), `${fmtDate(p.at)} at ${fmtTime(p.at)}`)),
      avgDev != null ? card("Temperature vs normal", `${avgDev > 0 ? "+" : avgDev < 0 ? "−" : ""}${fmtNumber(Math.abs(avgDev), 1)} °C`, "Average, days 3 to 9") : "",
      weekDays.length ? card("Week-ahead published", fmtDateTime(Math.max(...[...weekAhead.values()].map(v => v.updated))), `Covers ${fmtShortDate(weekDays[0])} to ${fmtShortDate(weekDays[weekDays.length - 1])}`) : ""
    ].join("");
  }

  async renderAnnual() {
    const year = this.state.year;
    this.annual.setLoading(true);
    try {
      const [annual, daily] = await Promise.all([getAnnual(), getDaily()]);
      const weeks = annual.filter(r => dateKey(parseUtc(r.week_start_utc) + 3.5 * 24 * HOUR).startsWith(year));

      const band = [];
      const fcAvg = [];
      const actAvg = [];
      const actPeak = [];
      const actMin = [];
      const margin = [];

      for (const w of weeks) {
        const start = parseUtc(w.week_start_utc);
        const endMs = parseUtc(w.week_end_utc);
        if (w.weekly_min_mw > 0 && w.weekly_max_mw > 0) band.push([start, w.weekly_min_mw / 1000, w.weekly_max_mw / 1000]);
        if (w.avg_sat_to_fri_mw > 0) fcAvg.push([start, w.avg_sat_to_fri_mw / 1000]);
        if (w.margin_mw != null) margin.push([start, w.margin_mw / 1000]);

        let sum = 0; let hours = 0; let peak = null; let low = null; let days = 0;
        for (let d = dateKey(start); parisMidnight(d) < endMs; d = addDays(d, 1)) {
          const r = daily.byDate.get(d);
          if (!r || r.mean_mw == null) continue;
          sum += r.mean_mw * r.intervals / 4; hours += r.intervals / 4; days += 1;
          peak = peak == null ? r.max_mw : Math.max(peak, r.max_mw);
          low = low == null ? r.min_mw : Math.min(low, r.min_mw);
        }
        if (days >= 6) {
          actAvg.push([start, sum / hours / 1000]);
          actPeak.push([start, peak / 1000]);
          actMin.push([start, low / 1000]);
        }
      }

      const above = actPeak.filter(([x, v]) => { const b = band.find(p => p[0] === x); return b && v > b[2]; }).length;
      const below = actMin.filter(([x, v]) => { const b = band.find(p => p[0] === x); return b && v < b[1]; }).length;

      const series = [
        { name: "Forecast weekly range (min–max)", colour: "--s-band", type: "band", data: band, unit: "GW" },
        { name: "Actual weekly peak", colour: "--s-d1", type: "line", data: actPeak, width: 2, unit: "GW", symbols: true },
        { name: "Actual weekly minimum", colour: "--s-id", type: "line", data: actMin, width: 2, unit: "GW", symbols: true }
      ];
      if (fcAvg.length) series.push({ name: "Forecast weekly average", colour: "--s-avg", type: "line", data: fcAvg, dashed: true, width: 1.6, unit: "GW", symbols: true });
      if (this.state.avgw === "1") series.push({ name: "Actual weekly average", colour: "--s-actual", type: "line", data: actAvg, width: 2, unit: "GW", symbols: true });

      this.annual.setTitle(`RTE's annual forecast for ${year} against actual demand`, `Weekly · GW${actPeak.length ? ` · actual peak above the forecast range in ${above} of ${actPeak.length} weeks, minimum below it in ${below}` : ""}`);
      this.annual.render({
        xType: "time", xLabel: x => `Week of ${fmtDate(x)}`, csvLabel: csvDate, axisLabel: x => fmtShortDate(dateKey(x)), xHeader: "Week starting", yName: "GW",
        series,
        notes: [
          "The shaded band is RTE's forecast range for each week: its expected weekly minimum and maximum demand. The lines show the actual weekly minimum and peak, so the comparison is like for like.",
          fcAvg.length ? "" : "RTE has only published a forecast weekly average for 2015 and 2016 (later years show −1, meaning not available), so it isn't shown for this year.",
          "RTE describes the band as the week's minimum and maximum consumption. In the data these match the lowest and highest demand within a week (for example around 31–50 GW in July), not a range for the weekly average.",
          "RTE's annual forecast is published at the end of the previous year and can be revised; the archive keeps the latest version. Its weeks run Monday to Monday, and actual figures use the same weeks, for weeks with at least six days of data."
        ]
      });

      // RTE publishes one year-ahead margin per year (repeated for every week),
      // so it is shown as one bar per year, using the value most weeks carry.
      const byYear = new Map();
      for (const w of annual) {
        if (w.margin_mw == null) continue;
        const y = dateKey(parseUtc(w.week_start_utc) + 3.5 * 24 * HOUR).slice(0, 4);
        if (!byYear.has(y)) byYear.set(y, new Map());
        const counts = byYear.get(y);
        counts.set(w.margin_mw, (counts.get(w.margin_mw) || 0) + 1);
      }
      const yearsList = [...byYear.keys()].filter(y => y >= "2015").sort();
      const marginByYear = yearsList.map(y => [...byYear.get(y)].sort((a, b) => b[1] - a[1])[0][0] / 1000);
      const selected = yearsList.indexOf(year);

      this.margin.setTitle("RTE's year-ahead supply margin, by year", "Expected available supply minus forecast demand, as published for each year · GW");
      this.margin.render({
        xType: "category", categories: yearsList, xLabel: x => x, xHeader: "Year", yName: "GW", yScale: false, zeroLine: true,
        yFormat: v => fmtNumber(v, 0),
        series: [{
          name: "Year-ahead margin", colour: "--s-actual", type: "bar", barWidth: 34, avg: false,
          data: marginByYear.map((v, i) => [i, v]), unit: "GW", format: v => fmtSignedGW(v * 1000, 1),
          labels: v => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtNumber(Math.abs(v), 1)}`,
          colourFn: (v, i) => (i === selected ? "--accent" : v < 0 ? "--danger" : "--s-actual"),
          barColours: i => (i === selected ? "--accent" : marginByYear[i] < 0 ? "--danger" : "--s-actual")
        }],
        legendCaption: null,
        notes: [
          "RTE calculates the margin as the difference between its annual forecasts of available production and of consumption. It publishes one figure per year, repeated for every week in the data.",
          "Negative values mean RTE expected demand above available production for the year as a whole, before imports.",
          `Highlighted: ${year}.`
        ]
      });
    } catch (error) {
      console.error(error);
      this.annual.setTitle("Annual forecast", `The annual forecast could not be loaded (${error.message}).`);
      this.annual.setLoading(false);
    }
  }

  refreshTheme() {
    for (const p of [this.ten, this.peaks, this.annual, this.margin]) p.refreshTheme();
  }
}

export { HOUR };
