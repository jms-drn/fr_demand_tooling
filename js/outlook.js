// Outlook: RTE's forecasts for the next 10 days (D-1, D-2 and the latest
// week-ahead forecast), its temperature assumptions, and the annual forecast
// and supply margin against actual demand.

import { ChartPanel } from "./chart.js";
import { getAnnual, getDaily, getLatest, getMonth, getRange, getWeeklyPeaks, latestSeries, monthsBetween } from "./data.js";
import {
  csvDate, csvDateTime, HOUR, addDays, dateKey, fmtDate, fmtDateTime, fmtDayTime, fmtGW, fmtLongDate, fmtNumber, fmtSignedGW,
  parisMidnight, timeKey, todayParis, writeHash
} from "./util.js";

export class Outlook {
  constructor(root) {
    this.root = root;
    this.state = { year: todayParis().slice(0, 4), ly: "0" };
    this.build();
  }

  setParams(params) {
    for (const key of Object.keys(this.state)) if (params.has(key)) this.state[key] = params.get(key);
    this.syncControls();
  }

  build() {
    const thisYear = Number(todayParis().slice(0, 4));
    const years = [];
    for (let y = thisYear; y >= 2015; y--) years.push(y);

    this.root.innerHTML = `
      <div class="toolbar" role="group" aria-label="Outlook settings">
        <div class="field"><span>Compare with</span>
          <div class="chips">
            <button class="chip" type="button" data-chip="ly" style="color:var(--s-ly)"><span class="swatch"></span><span style="color:var(--text-soft)">Same weekdays last year</span></button>
          </div>
        </div>
        <span class="divider"></span>
        <label class="field"><span>Annual forecast year</span>
          <select data-k="year">${years.map(y => `<option value="${y}">${y}</option>`).join("")}</select>
        </label>
      </div>
      <p class="headline" data-headline>Loading…</p>
      <div class="cards" data-cards></div>
      <div data-ten></div>
      <div data-peaks></div>
      <div data-annual></div>
      <div data-margin></div>`;

    this.headline = this.root.querySelector("[data-headline]");
    this.cards = this.root.querySelector("[data-cards]");
    this.ten = new ChartPanel(this.root.querySelector("[data-ten]"), { title: "Next 10 days" });
    this.peaks = new ChartPanel(this.root.querySelector("[data-peaks]"), { title: "Week-ahead daily peaks and temperature", size: "short" });
    this.annual = new ChartPanel(this.root.querySelector("[data-annual]"), { title: "Annual forecast against actual demand" });
    this.margin = new ChartPanel(this.root.querySelector("[data-margin]"), { title: "Forecast supply margin", size: "short" });

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
    this.syncControls();
  }

  syncControls() {
    this.root.querySelector('[data-k="year"]').value = this.state.year;
    this.root.querySelector('[data-chip="ly"]').setAttribute("aria-pressed", this.state.ly === "1");
  }

  activate() {
    writeHash("outlook", this.state);
    this.renderNext();
    this.renderAnnual();
  }

  /** Latest week-ahead forecast for each target day: Map(date -> { updated, points: Map(ms -> mw) }). */
  async latestWeekAhead(from, to) {
    const months = monthsBetween(parisMidnight(from), parisMidnight(addDays(to, 1)));
    const rows = (await Promise.all(months.map(ym => getMonth("weekly", ym)))).flat();
    const byDay = new Map();
    for (const r of rows) {
      const date = dateKey(r.start);
      if (date < from || date > to) continue;
      const cur = byDay.get(date);
      if (!cur || r.updated > cur.updated) byDay.set(date, { updated: r.updated, points: new Map([[r.start, r.mw]]) });
      else if (r.updated === cur.updated) cur.points.set(r.start, r.mw);
    }
    return byDay;
  }

  async renderNext() {
    writeHash("outlook", this.state);
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
        this.latestWeekAhead(addDays(day, 3), end),
        getWeeklyPeaks(),
        this.state.ly === "1" ? getRange("realised", addDays(day, -364), addDays(end, -364)) : null
      ]);

      const actual = new Map([...archActual, ...live]);
      const id = latestSeries(latest, "ID");
      const d1 = new Map([...archD1, ...latestSeries(latest, "D-1")]);
      const d2 = new Map([...archD2, ...latestSeries(latest, "D-2")]);
      const week = new Map();
      for (const { points } of weekAhead.values()) for (const [x, v] of points) week.set(x, v);

      const pts = map => [...map].sort((a, b) => a[0] - b[0]).map(([x, v]) => [x, v / 1000]);
      const series = [];

      if (lyMap) {
        const byKey = new Map([...lyMap].map(([ms, mw]) => [`${dateKey(ms)} ${timeKey(ms)}`, mw]));
        const ly = new Map();
        for (let x = parisMidnight(day); x < parisMidnight(addDays(end, 1)); x += 900000) {
          const v = byKey.get(`${addDays(dateKey(x), -364)} ${timeKey(x)}`);
          if (v != null) ly.set(x, v);
        }
        series.push({ name: "Same weekdays last year", colour: "--s-ly", type: "line", data: pts(ly), width: 1.4, unit: "GW" });
      }
      series.push({ name: "Week-ahead forecast (latest)", colour: "--s-week", type: "line", data: pts(week), width: 2, unit: "GW" });
      series.push({ name: "D-2 forecast", colour: "--s-d2", type: "line", data: pts(d2), width: 2, unit: "GW" });
      series.push({ name: "D-1 forecast", colour: "--s-d1", type: "line", data: pts(d1), width: 2, unit: "GW" });
      series.push({ name: "Intraday forecast", colour: "--s-id", type: "line", data: pts(id), dashed: true, width: 1.6, unit: "GW" });
      series.push({ name: "Actual", colour: "--s-actual", type: "line", data: pts(actual), width: 2.6, area: true, unit: "GW", z: 20 });

      this.ten.setTitle("Next 10 days", `${fmtLongDate(day)} to ${fmtLongDate(end)} · GW`);
      this.ten.render({
        xType: "time", xLabel: x => fmtDateTime(x), csvLabel: csvDateTime, axisLabel: x => fmtDayTime(x), yName: "GW", series,
        xMin: parisMidnight(day), xMax: parisMidnight(addDays(end, 1)),
        markAreas: [{ from: parisMidnight(day), to: parisMidnight(addDays(day, 1)), label: "Today", colour: "--today" }],
        notes: [
          "The week-ahead forecast covers 3 to 9 days ahead. For each day, the most recently published version is shown. RTE doesn't publish new week-ahead forecasts at weekends.",
          weekAhead.size ? "" : "No week-ahead forecast is stored for these days yet. They are added by the hourly update."
        ].filter(Boolean)
      });

      this.renderPeaks(day, end, peaks);
      this.renderCards(day, { d1, d2, week, weekAhead, peaks });
    } catch (error) {
      console.error(error);
      this.headline.textContent = `The outlook data could not be loaded (${error.message}).`;
    }
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

    this.peaks.setTitle("Week-ahead daily peaks and temperature", "Latest forecast for each day · peak in GW, temperature deviation in °C");
    this.peaks.render({
      xType: "time", xLabel: v => fmtDate(v), csvLabel: csvDate, axisLabel: v => fmtDate(v), xHeader: "Date", yName: "GW",
      yMin: 0, yAxis2: { name: "°C", format: v => fmtNumber(v, 1) },
      series: [
        { name: "Forecast daily peak", colour: "--s-week", type: "bar", data: rows.map(r => [x(r), r.peak_mw / 1000]), unit: "GW" },
        { name: "Temperature vs reference", colour: "--s-temp", type: "line", yAxis: 1, symbols: true, data: rows.map(r => [x(r), r.temp_dev_c]).filter(p => p[1] != null), format: v => `${v > 0 ? "+" : ""}${fmtNumber(v, 1)} °C`, unit: "°C", decimals: 1 }
      ],
      tooltipExtra: v => {
        const r = byX.get(v);
        return r ? `<div style="margin-top:6px;color:var(--muted)">Reference temperature ${fmtNumber(r.ref_temp_c, 1)} °C · forecast ${fmtNumber(r.ref_temp_c + r.temp_dev_c, 1)} °C · published ${fmtDateTime(Date.parse(r.updated_utc.replace("Z", ":00Z")))}</div>` : "";
      },
      notes: [
        ...(rows.length ? [] : ["No week-ahead peaks are stored for these days yet. They are added by the hourly update."]),
        "RTE gives each day's forecast peak with a reference (seasonal normal) temperature and the forecast deviation from it. Positive = warmer than normal, which lowers heating demand in winter."
      ]
    });
  }

  renderCards(day, { d1, d2, week, weekAhead, peaks }) {
    const peakOf = (map, date) => {
      const p = [...map].filter(([x]) => dateKey(x) === date);
      return p.length ? p.reduce((a, b) => (b[1] > a[1] ? b : a)) : null;
    };
    const days = [addDays(day, 1), addDays(day, 2), ...Array.from({ length: 7 }, (_, i) => addDays(day, 3 + i))];
    const dayPeaks = days.map((date, i) => {
      const map = i === 0 ? d1 : i === 1 ? d2 : week;
      const p = peakOf(map, date);
      return p ? { date, value: p[1], at: p[0], source: i === 0 ? "D-1" : i === 1 ? "D-2" : "Week-ahead" } : null;
    }).filter(Boolean);

    const highest = dayPeaks.reduce((a, b) => (!a || b.value > a.value ? b : a), null);
    const temps = this.latestPeaks(peaks, addDays(day, 3), addDays(day, 9)).filter(r => r.temp_dev_c != null);
    const avgDev = temps.length ? temps.reduce((a, r) => a + r.temp_dev_c, 0) / temps.length : null;
    const weekDays = [...weekAhead.keys()].sort();

    this.headline.textContent = highest
      ? `The highest forecast peak in the next 9 days is ${fmtGW(highest.value)} on ${fmtDate(highest.at)} (${highest.source})${avgDev != null ? `, with temperatures forecast ${fmtNumber(Math.abs(avgDev), 1)} °C ${avgDev >= 0 ? "above" : "below"} normal on average from day 3 to day 9` : ""}.`
      : "No forecasts are available for the coming days yet.";

    const card = (label, value, detail = "") => `<div class="card"><div class="label">${label}</div><div class="value">${value}</div><div class="detail">${detail}</div></div>`;
    this.cards.innerHTML = [
      ...dayPeaks.slice(0, 2).map(p => card(`${p.source} peak`, fmtGW(p.value), `${fmtDate(p.at)} at ${new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(p.at)}`)),
      highest ? card("Highest peak, next 9 days", fmtGW(highest.value), `${fmtDate(highest.at)} · ${highest.source}`) : "",
      avgDev != null ? card("Temperature vs normal", `${avgDev > 0 ? "+" : ""}${fmtNumber(avgDev, 1)} °C`, "Average, days 3 to 9") : "",
      weekDays.length ? card("Week-ahead published", fmtDateTime(Math.max(...[...weekAhead.values()].map(v => v.updated))), `Covers ${fmtDate(parisMidnight(weekDays[0]) + 12 * HOUR)} to ${fmtDate(parisMidnight(weekDays[weekDays.length - 1]) + 12 * HOUR)}`) : ""
    ].join("");
  }

  async renderAnnual() {
    const year = this.state.year;
    try {
      const [annual, daily] = await Promise.all([getAnnual(), getDaily()]);
      const parse = text => Date.parse(text.replace("Z", ":00Z"));
      const weeks = annual.filter(r => {
        const mid = parse(r.week_start_utc) + 3.5 * 24 * HOUR;
        return dateKey(mid).startsWith(year);
      });

      const band = [];
      const fcAvg = [];
      const actAvg = [];
      const actPeak = [];
      const margin = [];

      for (const w of weeks) {
        const start = parse(w.week_start_utc);
        const endMs = parse(w.week_end_utc);
        if (w.weekly_min_mw > 0 && w.weekly_max_mw > 0) band.push([start, w.weekly_min_mw / 1000, w.weekly_max_mw / 1000]);
        if (w.avg_sat_to_fri_mw > 0) fcAvg.push([start, w.avg_sat_to_fri_mw / 1000]);
        if (w.margin_mw != null) margin.push([start, w.margin_mw / 1000]);

        // Actual demand over the same week.
        let sum = 0; let hours = 0; let peak = null; let days = 0;
        for (let d = dateKey(start); parisMidnight(d) < endMs; d = addDays(d, 1)) {
          const r = daily.byDate.get(d);
          if (!r || r.mean_mw == null) continue;
          sum += r.mean_mw * r.intervals / 4; hours += r.intervals / 4; days += 1;
          peak = peak == null ? r.max_mw : Math.max(peak, r.max_mw);
        }
        if (days >= 6) { actAvg.push([start, sum / hours / 1000]); actPeak.push([start, peak / 1000]); }
      }

      this.annual.setTitle(`RTE's annual forecast for ${year} against actual demand`, "Weekly · GW");
      this.annual.render({
        xType: "time", xLabel: x => `Week of ${fmtDate(x)}`, csvLabel: csvDate, axisLabel: x => fmtDate(x), xHeader: "Week starting", yName: "GW",
        series: [
          { name: "Forecast weekly min–max", colour: "--s-band", type: "band", data: band, unit: "GW" },
          { name: "Forecast weekly average", colour: "--s-avg", type: "line", data: fcAvg, dashed: true, width: 1.8, unit: "GW", symbols: true },
          { name: "Actual weekly peak", colour: "--s-ly", type: "line", data: actPeak, width: 1.4, unit: "GW", symbols: true },
          { name: "Actual weekly average", colour: "--s-actual", type: "line", data: actAvg, width: 2.4, unit: "GW", symbols: true }
        ],
        notes: [
          "RTE's annual forecast is published at the end of the previous year and can be revised during the year; the archive keeps the latest version.",
          "RTE describes its weekly average as Saturday-to-Friday, but its forecast weeks run Monday to Monday. Actual averages here use the same Monday-to-Monday weeks.",
          "Actual figures are shown for weeks with at least six days of data.",
          ...(fcAvg.length ? [] : ["RTE's annual forecast for this year doesn't include a weekly average (it is published as −1), so only the forecast min–max range is shown."])
        ]
      });

      this.margin.setTitle(`Forecast supply margin, ${year}`, "RTE's year-ahead margin: available generation minus forecast demand · GW");
      this.margin.render({
        xType: "time", xLabel: x => `Week of ${fmtDate(x)}`, csvLabel: csvDate, axisLabel: x => fmtDate(x), xHeader: "Week starting", yName: "GW",
        yScale: false,
        series: [{ name: "Forecast margin", colour: "--s-actual", type: "bar", data: margin, unit: "GW", colourFn: v => (v < 0 ? "--danger" : "--s-actual"), format: v => fmtSignedGW(v * 1000, 1) }],
        notes: ["Negative values mean RTE's year-ahead forecast showed demand above expected available generation for that week."]
      });
    } catch (error) {
      console.error(error);
      this.annual.setTitle("Annual forecast", `The annual forecast could not be loaded (${error.message}).`);
    }
  }

  refreshTheme() {
    for (const p of [this.ten, this.peaks, this.annual, this.margin]) p.refreshTheme();
  }
}

export { fmtNumber };
