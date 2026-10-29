// Nuclear today: fleet availability now, a map of reactors coloured by status
// or by how long they have been / will be offline, the next 14 days, output
// by reactor over the past week and the latest notice changes.

import { ChartPanel } from "./chart.js";
import { parseUtc } from "./data.js";
import {
  DURATION_BUCKETS, SEQ, STATE_COLOUR, bucketOf, fmtDuration, fmtWhen, reasonLabel, shiftMsYears, siteSort, stateKey
} from "./nuclear-common.js";
import { getFleet, getLive, getNuclearDaily, getNuclearHourly, getOutages } from "./power-data.js";
import {
  DAY, HOUR, addDays, alignDate, copyText, cssVar, csvDateTime, downloadBlob, fmtDateShort, fmtDateTime, fmtDayTime, fmtGW, fmtNumber,
  fmtSignedGW, fmtTime, heroHtml, mean, toCsv, todayParis, writeHash
} from "./util.js";

let mapReady = null;

/** Registers the France outline with ECharts once. */
export function loadMap() {
  if (!mapReady) {
    mapReady = fetch("js/vendor/europe-fr.json").then(r => r.json()).then(geo => {
      echarts.registerMap("fr-region", geo);
    });
  }
  return mapReady;
}

const MODES = {
  status: "Status",
  since: "Time offline so far",
  until: "Time until return"
};

export class NuclearToday {
  constructor(root) {
    this.root = root;
    this.state = { colour: "status" };
    this.selected = null;
    this.build();
  }

  setParams(params) {
    if (params.has("colour") && MODES[params.get("colour")]) this.state.colour = params.get("colour");
    this.syncControls();
  }

  build() {
    this.root.innerHTML = `
      ${heroHtml("Nuclear fleet,", "right now.", "Available nuclear capacity from EDF's unavailability notices published through RTE, with the latest output, every reactor on the map and the notices changed in the past three days.")}
      <div class="headline"><p data-headline>Loading…</p><button class="btn ghost small" type="button" data-copy title="Copy this sentence">Copy</button></div>
      <div class="cards" data-cards>${'<div class="card skeleton"></div>'.repeat(6)}</div>
      <div class="map-layout">
        <div class="map-col">
          <div class="map-controls">
            <span class="field-label">Colour reactors by</span>
            <div class="segmented" role="group" aria-label="Colour reactors by">
              ${Object.entries(MODES).map(([k, v]) => `<button type="button" data-mode="${k}">${v}</button>`).join("")}
            </div>
          </div>
          <div data-map></div>
        </div>
        <aside class="panel reactor-list">
          <div class="panel-head"><div><h2>Reactors not at full capacity</h2><p data-list-sub></p></div></div>
          <div class="reactor-rows" data-list><div class="card skeleton" style="margin:12px 16px"></div></div>
        </aside>
      </div>
      <div data-ahead></div>
      <div data-heat></div>
      <article class="panel">
        <div class="panel-head">
          <div><h2>Notices changed in the past 72 hours</h2><p>Each line is a new version of an EDF unavailability notice, newest first. Times are Paris time.</p></div>
          <div class="panel-tools">
            <select data-change-filter aria-label="Filter changes" class="compact">
              <option value="all">All changes</option><option value="new">New notices</option>
              <option value="dates">Dates moved</option><option value="cancelled">Cancelled</option>
            </select>
            <button class="btn ghost" type="button" data-changes-csv>CSV</button>
          </div>
        </div>
        <div class="table-scroll flat" data-changes></div>
      </article>`;

    this.headline = this.root.querySelector("[data-headline]");
    this.cards = this.root.querySelector("[data-cards]");
    this.list = this.root.querySelector("[data-list]");
    this.listSub = this.root.querySelector("[data-list-sub]");
    this.changesEl = this.root.querySelector("[data-changes]");
    this.mapPanel = new ChartPanel(this.root.querySelector("[data-map]"), { title: "Reactors", size: "map", table: true });
    this.aheadPanel = new ChartPanel(this.root.querySelector("[data-ahead]"), { title: "Available capacity, past 7 days and next 14", size: "", overview: false });
    this.heatPanel = new ChartPanel(this.root.querySelector("[data-heat]"), { title: "Output by reactor, past 7 days", size: "heat" });

    this.root.querySelector("[data-copy]").addEventListener("click", () => copyText(this.headline.textContent));
    this.root.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", () => {
      this.state.colour = b.dataset.mode;
      this.syncControls();
      writeHash("nuclear/today", this.state);
      this.renderMap();
      this.renderList();
    }));
    this.root.querySelector("[data-change-filter]").addEventListener("change", () => this.renderChanges());
    this.root.querySelector("[data-changes-csv]").addEventListener("click", () => this.exportChanges());
    this.syncControls();
  }

  syncControls() {
    this.root.querySelectorAll("[data-mode]").forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === this.state.colour));
  }

  activate() {
    writeHash("nuclear/today", this.state);
    this.update();
  }

  async update() {
    try {
      const today = todayParis();
      await loadMap();
      const [fleet, live, daily] = await Promise.all([getFleet(), getLive(), getNuclearDaily()]);
      this.fleet = fleet;
      this.live = live;
      this.daily = daily;
      this.now = parseUtc(live.generated_utc);
      const thisYear = Number(today.slice(0, 4));
      const [past, lastYear, outages] = await Promise.all([
        getNuclearHourly(addDays(today, -7), today),
        getNuclearHourly(alignDate(addDays(today, -7), 1, "cal") || addDays(today, -372), alignDate(addDays(today, 14), 1, "cal") || addDays(today, -351)),
        getOutages([thisYear, thisYear + 1])
      ]);
      this.past = past;
      this.lastYear = lastYear;
      this.outages = outages;
      this.units = live.units.map(u => ({ ...u, since: parseUtc(u.since_utc), until: parseUtc(u.until_utc), key: stateKey(u) }));
      this.renderSummary();
      this.renderMap();
      this.renderList();
      this.renderAhead();
      this.renderHeat();
      this.renderChanges();
    } catch (error) {
      console.error(error);
      this.headline.textContent = `The nuclear data could not be loaded (${error.message}).`;
    }
  }

  // ---------- Summary ----------

  sameHourLastYear() {
    const x = shiftMsYears(Math.floor(this.now / HOUR) * HOUR, 1);
    const row = this.lastYear.find(r => r.x === x);
    return row?.available ?? null;
  }

  upcoming(days) {
    const end = this.now + days * DAY;
    const starts = this.outages.filter(o => o.status !== "DISMISSED" && o.start > this.now && o.start <= end
      && o.end - o.start >= DAY && o.offMw >= 0.25 * o.capMw);
    const unique = new Map();
    for (const o of starts) if (!unique.has(o.unit) || unique.get(o.unit).start > o.start) unique.set(o.unit, o);
    const returns = this.units.filter(u => u.state !== "online" && u.until && u.until <= end);
    return { starts: [...unique.values()], returns };
  }

  renderSummary() {
    const f = this.live.fleet;
    const units = this.units;
    const offline = units.filter(u => u.state === "offline");
    const reduced = units.filter(u => u.state === "reduced");
    const offPlanned = offline.filter(u => u.key === "planned").length;
    const offUnplanned = offline.length - offPlanned;
    const pct = 100 * f.available_mw / f.installed_mw;
    const ly = this.sameHourLastYear();
    const outputHour = this.past.filter(r => r.output != null).at(-1);
    const today = todayParis();

    // Five-year average for today's date (daily means).
    const prev = [1, 2, 3, 4, 5].map(k => this.daily.byDate.get(alignDate(today, k, "cal"))?.available_mw).filter(v => v != null);
    const avg5 = prev.length ? mean(prev) : null;
    const todayRow = this.daily.byDate.get(today);
    const { starts, returns } = this.upcoming(7);
    const backMw = returns.reduce((a, u) => a + u.off_mw, 0);

    const parts = [`French nuclear availability is ${fmtGW(f.available_mw)} of ${fmtGW(f.installed_mw)} installed (${fmtNumber(pct, 0)}%) at ${fmtTime(this.now)} Paris time`];
    parts[0] += `, with ${offline.length} of ${units.length} reactors offline (${offPlanned} planned, ${offUnplanned} unplanned)`;
    if (reduced.length) parts[0] += ` and ${reduced.length} running below capacity`;
    let text = `${parts[0]}.`;
    if (ly != null) text += ` That is ${fmtGW(Math.abs(f.available_mw - ly))} ${f.available_mw >= ly ? "more" : "less"} than at the same time last year (${fmtGW(ly)}).`;
    if (outputHour) text += ` Output in the hour from ${fmtTime(outputHour.x)} was ${fmtGW(outputHour.output)}.`;
    this.headline.textContent = text;

    const card = (label, value, detail = "", cls = "") =>
      `<div class="card${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="detail">${detail}</div></div>`;
    this.cards.innerHTML = [
      card("Available now", fmtGW(f.available_mw), `${fmtNumber(pct, 1)}% of ${fmtGW(f.installed_mw)} installed`, " accent"),
      outputHour ? card("Output, latest hour", fmtGW(outputHour.output), `${fmtTime(outputHour.x)}–${fmtTime(outputHour.x + HOUR)} · ${fmtNumber(100 * outputHour.output / f.available_mw, 0)}% of available`) : "",
      card("Reactors offline", `${offline.length}`, `${offPlanned} planned · ${offUnplanned} unplanned`),
      card("Running below capacity", `${reduced.length}`, `${fmtGW(reduced.reduce((a, u) => a + u.off_mw, 0))} unavailable`),
      card("Unavailable now", fmtGW(f.planned_off_mw + f.unplanned_off_mw), `${fmtGW(f.planned_off_mw)} planned · ${fmtGW(f.unplanned_off_mw)} unplanned`),
      ly != null ? card("vs same hour last year", fmtSignedGW(f.available_mw - ly, 1), `${fmtGW(ly)} a year ago`) : "",
      avg5 != null && todayRow ? card("Today vs 5-year average", fmtSignedGW(todayRow.available_mw - avg5, 1), `Daily mean ${fmtGW(todayRow.available_mw)} vs ${fmtGW(avg5)} (${prev.length} years)`) : "",
      card("Due back in 7 days", `${returns.length}`, `${fmtGW(backMw)} returning · ${starts.length} major outage${starts.length === 1 ? "" : "s"} due to start`)
    ].join("");

    const notices = parseUtc(this.live.latest_notice_utc);
    this.listSub.textContent = `${offline.length + reduced.length} reactors · notices to ${fmtDayTime(notices)}`;
  }

  // ---------- Map ----------

  colourFor(u) {
    const mode = this.state.colour;
    if (u.state === "online") return STATE_COLOUR.online;
    if (mode === "status") return STATE_COLOUR[u.key];
    if (mode === "since") return u.since ? SEQ[bucketOf((this.now - u.since) / DAY)] : SEQ[4];
    return u.until ? SEQ[bucketOf((u.until - this.now) / DAY)] : "--muted";
  }

  legendItems() {
    const mode = this.state.colour;
    if (mode === "status") {
      return [
        { name: "Online", colour: STATE_COLOUR.online, shape: "dot" },
        { name: "Reduced output", colour: STATE_COLOUR.reduced, shape: "dot" },
        { name: "Offline, planned", colour: STATE_COLOUR.planned, shape: "dot" },
        { name: "Offline, unplanned", colour: STATE_COLOUR.unplanned, shape: "dot" }
      ];
    }
    const items = DURATION_BUCKETS.map((b, i) => ({ name: b.label, colour: SEQ[i], shape: "dot" }));
    if (mode === "until") items.push({ name: "No return date", colour: "--muted", shape: "dot" });
    items.push({ name: "Online", colour: STATE_COLOUR.online, shape: "dot" });
    return items;
  }

  /** Reactor positions: a small ring around each site. */
  positions() {
    const bySite = new Map();
    for (const r of this.fleet.reactors) {
      if (!bySite.has(r.site)) bySite.set(r.site, []);
      bySite.get(r.site).push(r);
    }
    const pos = new Map();
    for (const [, reactors] of bySite) {
      const n = reactors.length;
      const radius = n === 1 ? 0 : n <= 2 ? 0.075 : n <= 4 ? 0.11 : 0.15;
      reactors.sort(siteSort).forEach((r, i) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / n + (n === 2 ? Math.PI / 2 : 0);
        const lat = r.lat + radius * Math.sin(angle);
        const lon = r.lon + (radius * Math.cos(angle)) / Math.cos((r.lat * Math.PI) / 180);
        pos.set(r.name, [lon, lat]);
      });
    }
    return pos;
  }

  tooltipFor(u) {
    const cap = u.mw;
    const colour = cssVar(this.colourFor(u));
    const status = u.state === "online" ? "Online" : u.state === "reduced" ? "Reduced capacity" : `Offline (${u.key})`;
    const lines = [
      `<div style="font-weight:700;font-size:13px;margin-bottom:2px"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${colour};margin-right:7px"></span>${u.label}</div>`,
      `<div class="muted">${this.fleet.reactors.find(r => r.name === u.name)?.series || ""} · ${fmtNumber(cap, 0)} MW</div>`,
      `<div style="margin-top:6px">${status}: <b>${fmtNumber(u.available_mw, 0)} MW</b> available</div>`
    ];
    if (u.output_mw != null) lines.push(`<div>Output ${fmtTime(parseUtc(u.output_hour_utc))}: <b>${fmtNumber(u.output_mw, 0)} MW</b></div>`);
    if (u.state !== "online") {
      lines.push(`<div style="margin-top:6px">Below full capacity since <b>${fmtWhen(u.since)}</b> (${fmtDuration(this.now - u.since)})</div>`);
      lines.push(`<div>Expected back <b>${u.until ? fmtWhen(u.until) : "no date given"}</b>${u.until ? ` (in ${fmtDuration(u.until - this.now)})` : ""}</div>`);
    }
    for (const n of u.notices.slice(0, 2)) {
      const first = parseUtc(n.first_end_utc);
      const end = parseUtc(n.end_utc);
      const delay = first && end && end - first > HOUR ? ` · <span style="color:${cssVar("--danger")}">${fmtDuration(end - first)} later than first announced</span>` : "";
      lines.push(`<div style="margin-top:6px;padding-top:6px;border-top:1px solid ${cssVar("--border")}">
        <b>${n.type === "planned" ? "Planned" : "Unplanned"}</b> · ${reasonLabel(n.reason, n.remark)} · ${fmtNumber(n.off_mw, 0)} MW off<br>
        ${fmtDayTime(parseUtc(n.start_utc))} → ${fmtDayTime(end)}${delay}<br>
        <span class="muted">Version ${n.versions}${n.remark ? ` · ${n.remark.slice(0, 140)}${n.remark.length > 140 ? "…" : ""}` : ""}</span></div>`);
    }
    return `<div style="max-width:330px;white-space:normal">${lines.join("")}</div>`;
  }

  renderMap() {
    if (!this.units) return;
    const pos = this.positions();
    const units = this.units;
    const sites = new Map();
    for (const r of this.fleet.reactors) if (!sites.has(r.site) && units.some(u => u.site === r.site)) sites.set(r.site, [r.lon, r.lat]);
    const mode = this.state.colour;
    const offLabel = { status: "status", since: "time offline so far", until: "time until expected return" }[mode];
    this.mapPanel.setTitle("Reactors", `Coloured by ${offLabel} · size shows capacity · scroll or pinch to zoom`);

    const option = (t, { forExport }) => ({
      backgroundColor: "transparent",
      animation: false,
      tooltip: forExport ? undefined : {
        trigger: "item", confine: true, backgroundColor: t.tooltip, borderColor: t.border, padding: [9, 12],
        textStyle: { color: t.text, fontSize: 12 },
        formatter: p => (p.seriesName === "reactors" ? this.tooltipFor(units[p.dataIndex]) : "")
      },
      geo: {
        map: "fr-region", roam: !forExport, scaleLimit: { min: 1, max: 6 },
        boundingCoords: [[-5.4, 51.25], [9.7, 41.9]],
        top: forExport ? 100 : 10, bottom: forExport ? 60 : 10,
        silent: true, label: { show: false },
        itemStyle: { areaColor: cssVar("--map-other"), borderColor: t.grid, borderWidth: 1 },
        regions: [{ name: "France", itemStyle: { areaColor: cssVar("--map-land"), borderColor: t.axis, borderWidth: 1.2 } }]
      },
      series: [
        {
          name: "sites", type: "scatter", coordinateSystem: "geo", silent: true, symbolSize: 0, z: 2,
          data: [...sites].map(([name, c]) => ({ name, value: c })),
          label: { show: true, formatter: p => p.name, position: "right", distance: 16, color: t.muted, fontSize: 10.5, fontFamily: "Inter" }
        },
        {
          name: "reactors", type: "scatter", coordinateSystem: "geo", z: 3,
          data: units.map(u => ({
            name: u.label, value: pos.get(u.name) || [0, 0],
            symbolSize: (u.state === "online" ? 7 : 10) + (u.mw - 880) / 120,
            itemStyle: {
              color: cssVar(this.colourFor(u)),
              borderColor: t.panel, borderWidth: 1.2,
              opacity: u.state === "online" ? 0.7 : 1,
              shadowBlur: u.state === "online" ? 0 : 6, shadowColor: cssVar(this.colourFor(u))
            }
          })),
          emphasis: { scale: 1.6, itemStyle: { borderColor: t.text, borderWidth: 2 } }
        }
      ]
    });

    this.mapPanel.render({
      series: [],
      custom: {
        option, legend: this.legendItems(), exportSize: 900,
        table: () => ({
          headers: ["Reactor", "Site", "Capacity (MW)", "Available (MW)", "Status", "Since (Paris)", "Expected back (Paris)", "Output latest hour (MW)", "Notice type", "Reason"],
          rows: [...units].sort(siteSort).map(u => [u.label, u.site, u.mw, u.available_mw, u.state === "offline" ? `offline (${u.key})` : u.state,
            u.since ? csvDateTime(u.since) : "", u.until ? csvDateTime(u.until) : "", u.output_mw ?? "", u.notices[0]?.type ?? "", u.notices[0] ? reasonLabel(u.notices[0].reason) : ""])
        }),
        onReady: chart => { this.mapChart = chart; }
      },
      legendCaption: null,
      notes: [
        "Status uses the latest version of every notice covering this moment. A reactor counts as offline below 10% of its capacity and as reduced below 90%.",
        "“Since” is when the reactor last had at least 90% of its capacity available, so back-to-back notices count as one stoppage. “Expected back” is when the current notices say it returns to 90% or more.",
        "Reactors are drawn in a small ring around each site, so positions are approximate. Map: Natural Earth."
      ]
    });
  }

  // ---------- Reactor list ----------

  renderList() {
    if (!this.units) return;
    const groups = [
      ["Offline, unplanned", this.units.filter(u => u.state === "offline" && u.key === "unplanned")],
      ["Offline, planned", this.units.filter(u => u.state === "offline" && u.key === "planned")],
      ["Reduced capacity", this.units.filter(u => u.state === "reduced")]
    ];
    const html = groups.filter(([, list]) => list.length).map(([title, list]) => `
      <div class="reactor-group">${title} <span class="muted">${list.length} · ${fmtGW(list.reduce((a, u) => a + u.off_mw, 0))}</span></div>
      ${list.sort((a, b) => (a.until ?? Infinity) - (b.until ?? Infinity)).map(u => {
        const total = u.until && u.since ? u.until - u.since : null;
        const done = total ? Math.min(1, Math.max(0, (this.now - u.since) / total)) : 0;
        const colour = cssVar(this.colourFor(u));
        return `<button type="button" class="reactor-row" data-unit="${u.name}">
          <span class="dot" style="background:${colour}"></span>
          <span class="reactor-name"><b>${u.label}</b><span>${fmtNumber(u.off_mw, 0)} of ${fmtNumber(u.mw, 0)} MW off</span></span>
          <span class="reactor-when"><span>${u.until ? `back ${fmtDayTime(u.until)}` : "no return date"}</span>
            <span class="progress" title="${fmtDuration(this.now - u.since)} so far${total ? ` of ${fmtDuration(total)}` : ""}"><i style="width:${(done * 100).toFixed(0)}%;background:${colour}"></i></span>
            <span class="muted">${fmtDuration(this.now - u.since)} so far${u.until ? ` · ${fmtDuration(u.until - this.now)} to go` : ""}</span></span>
        </button>`;
      }).join("")}`).join("");
    this.list.innerHTML = html || `<p class="muted" style="padding:12px 16px">Every reactor is at full capacity.</p>`;
    this.list.querySelectorAll("[data-unit]").forEach(row => {
      const index = this.units.findIndex(u => u.name === row.dataset.unit);
      row.addEventListener("mouseenter", () => {
        this.mapChart?.dispatchAction({ type: "highlight", seriesName: "reactors", dataIndex: index });
        this.mapChart?.dispatchAction({ type: "showTip", seriesName: "reactors", dataIndex: index });
      });
      row.addEventListener("mouseleave", () => {
        this.mapChart?.dispatchAction({ type: "downplay", seriesName: "reactors", dataIndex: index });
        this.mapChart?.dispatchAction({ type: "hideTip" });
      });
      row.addEventListener("click", () => { location.hash = `nuclear/outages?unit=${encodeURIComponent(row.dataset.unit)}&win=24m`; });
    });
  }

  // ---------- Next 14 days ----------

  renderAhead() {
    const n14 = this.live.next14;
    const start = parseUtc(n14.start_utc);
    const ahead = n14.available_mw.map((v, i) => [start + i * HOUR, v / 1000]);
    const installedAhead = n14.installed_mw.map((v, i) => [start + i * HOUR, v / 1000]);
    const past = this.past.filter(r => r.x < start);
    const pts = key => past.filter(r => r[key] != null).map(r => [r.x, r[key] / 1000]);
    const lyMap = new Map(this.lastYear.map(r => [r.x, r]));
    const lyPts = [];
    const end = start + ahead.length * HOUR;
    for (let x = past[0]?.x ?? start; x < end; x += HOUR) {
      const src = shiftMsYears(x, 1);
      const r = src != null ? lyMap.get(src) : null;
      if (r?.available != null) lyPts.push([x, r.available / 1000]);
    }
    const expected = past.length ? [[past.at(-1).x, past.at(-1).available / 1000], ...ahead] : ahead;
    this.aheadPanel.setTitle("Available capacity, past 7 days and next 14", "Hourly · GW · after now, as expected from the current notices");
    this.aheadPanel.render({
      xType: "time", xLabel: x => fmtDateTime(x), csvLabel: csvDateTime, yName: "GW", yFormat: v => fmtNumber(v, Number.isInteger(v) ? 0 : 1),
      series: [
        { name: "Installed", colour: "--s-avg", type: "line", data: [...pts("installed"), ...installedAhead], width: 1, dashed: true, unit: "GW", decimals: 2, step: "end" },
        { name: "Available, same dates last year", colour: "--s-ly", type: "line", data: lyPts, width: 1.5, unit: "GW", decimals: 2 },
        { name: "Output", colour: "--s-id", type: "line", data: pts("output"), width: 1.8, unit: "GW", decimals: 2 },
        { name: "Expected available", colour: "--s-fcst", type: "line", data: expected, width: 2.4, dashed: true, unit: "GW", decimals: 2, z: 19 },
        { name: "Available", colour: "--s-actual", type: "line", data: pts("available"), width: 2.6, unit: "GW", decimals: 2, z: 20 }
      ],
      markAreas: [{ from: start, to: end, label: "Expected", colour: "--today" }],
      notes: [
        "Available capacity is installed capacity minus the unavailable capacity in the latest version of each notice; past hours use the final versions.",
        "Expected availability only reflects outages EDF has announced: unplanned outages that have not happened yet are, by definition, missing, so it tends to be optimistic."
      ]
    });
  }

  // ---------- Output heat map ----------

  renderHeat() {
    const units = [...this.units].sort(siteSort);
    const weekStart = parseUtc(this.live.week_start_utc);
    const hours = units[0]?.output_week.length || 0;
    const xs = Array.from({ length: hours }, (_, i) => weekStart + i * HOUR);
    const data = [];
    units.forEach((u, y) => u.output_week.forEach((v, x) => {
      if (v != null) data.push([x, y, Math.max(0, Math.min(110, (100 * v) / u.mw)), v]);
    }));
    const labels = units.map(u => u.label);
    const option = (t, { forExport }) => ({
      backgroundColor: "transparent", animation: false, useUTC: true,
      grid: forExport ? { left: 120, right: 30, top: 108, bottom: 110 } : { left: 112, right: 16, top: 12, bottom: 70 },
      tooltip: forExport ? undefined : {
        confine: true, backgroundColor: t.tooltip, borderColor: t.border, textStyle: { color: t.text, fontSize: 12 },
        formatter: p => `<b>${labels[p.value[1]]}</b><br>${fmtDateTime(xs[p.value[0]])}<br>Output <b>${fmtNumber(p.value[3], 0)} MW</b> (${fmtNumber(p.value[2], 0)}% of capacity)`
      },
      xAxis: {
        type: "category", data: xs, axisTick: { show: false }, axisLine: { lineStyle: { color: t.axis } },
        axisLabel: { color: t.muted, fontSize: 11, fontFamily: "JetBrains Mono", interval: i => fmtTime(xs[i]) === "00:00", formatter: v => fmtDateShort(Number(v)) },
        splitLine: { show: false }
      },
      yAxis: { type: "category", data: labels, inverse: true, axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: t.soft, fontSize: 10.5, interval: 0 } },
      visualMap: {
        min: 0, max: 100, calculable: false, orient: "horizontal", left: "center", bottom: forExport ? 40 : 6, itemHeight: 220, itemWidth: 10,
        text: ["100% of capacity", "0%"], textStyle: { color: t.muted, fontSize: 11 }, dimension: 2,
        inRange: { color: [cssVar("--st-unplanned"), cssVar("--st-reduced"), cssVar("--map-land"), cssVar("--s-actual")] }
      },
      series: [{ type: "heatmap", data, progressive: 0, emphasis: { itemStyle: { borderColor: t.text, borderWidth: 1 } } }]
    });
    this.heatPanel.setTitle("Output by reactor, past 7 days", "Hourly output as a share of each reactor's capacity · grey means no output reported");
    this.heatPanel.render({
      series: [],
      custom: {
        option, exportSize: 1100,
        table: () => ({
          headers: ["Time (Europe/Paris)", ...labels.map(l => `${l} (MW)`)],
          rows: xs.map((x, i) => [csvDateTime(x), ...units.map(u => u.output_week[i] ?? "")])
        })
      },
      legendCaption: null,
      notes: ["Per-reactor output from RTE's actual generation data (hourly). Low values while a reactor is online usually mean it is modulating to follow demand or prices, or ramping around an outage."]
    });
  }

  // ---------- Notice changes ----------

  describe(c) {
    const end = parseUtc(c.end_utc);
    const prevEnd = parseUtc(c.prev_end_utc);
    const start = parseUtc(c.start_utc);
    const prevStart = parseUtc(c.prev_start_utc);
    if (c.status === "DISMISSED") return { kind: "cancelled", text: "Notice cancelled" };
    if (c.version === 1 || !c.prev_end_utc) return { kind: "new", text: `New ${c.type} outage, ${fmtDuration(end - start)}` };
    const bits = [];
    if (prevEnd && end && Math.abs(end - prevEnd) >= 30 * 60000) bits.push(`return ${end > prevEnd ? "delayed" : "brought forward"} by ${fmtDuration(Math.abs(end - prevEnd))}`);
    if (prevStart && start && Math.abs(start - prevStart) >= 30 * 60000) bits.push(`start moved ${start > prevStart ? "later" : "earlier"} by ${fmtDuration(Math.abs(start - prevStart))}`);
    if (bits.length) return { kind: "dates", text: bits.join("; ").replace(/^./, s => s.toUpperCase()) };
    return { kind: "other", text: "Updated (capacity or details)" };
  }

  filteredChanges() {
    const filter = this.root.querySelector("[data-change-filter]").value;
    return (this.live?.changes || []).map(c => ({ ...c, d: this.describe(c) })).filter(c => filter === "all" || c.d.kind === filter);
  }

  renderChanges() {
    if (!this.live) return;
    const label = name => this.fleet.reactors.find(r => r.name === name)?.label || name;
    const rows = this.filteredChanges();
    this.changesEl.innerHTML = rows.length ? `<table><thead><tr><th>Published</th><th>Reactor</th><th>Type</th><th>Change</th><th>MW off</th><th>Start</th><th>End</th><th>Remark</th></tr></thead><tbody>
      ${rows.map(c => `<tr class="${c.d.kind === "dates" && parseUtc(c.end_utc) > parseUtc(c.prev_end_utc) ? "delay" : ""}">
        <td>${fmtDayTime(parseUtc(c.published_utc))}</td><td class="text">${label(c.unit)}</td>
        <td class="text"><span class="tag ${c.type}">${c.type}</span></td><td class="text">${c.d.text}</td>
        <td>${fmtNumber(c.off_mw, 0)}</td><td>${fmtDayTime(parseUtc(c.start_utc))}</td><td>${fmtDayTime(parseUtc(c.end_utc))}</td>
        <td class="text remark" title="${(c.remark || "").replace(/"/g, "&quot;")}">${c.remark || ""}</td></tr>`).join("")}
      </tbody></table>` : `<p class="muted" style="padding:12px 16px">No notices match.</p>`;
  }

  exportChanges() {
    const rows = this.filteredChanges();
    const label = name => this.fleet.reactors.find(r => r.name === name)?.label || name;
    downloadBlob("nuclear-notice-changes.csv", new Blob([toCsv(
      ["Published (Paris)", "Reactor", "Version", "Type", "Reason", "Status", "Change", "MW off", "Start (Paris)", "End (Paris)", "Previous end (Paris)", "Remark", "Notice id"],
      rows.map(c => [csvDateTime(parseUtc(c.published_utc)), label(c.unit), c.version, c.type, reasonLabel(c.reason, c.remark), c.status, c.d.text, c.off_mw,
        csvDateTime(parseUtc(c.start_utc)), csvDateTime(parseUtc(c.end_utc)), c.prev_end_utc ? csvDateTime(parseUtc(c.prev_end_utc)) : "", c.remark, c.id])
    )], { type: "text/csv;charset=utf-8" }));
  }

  refreshTheme() {
    this.renderMap();
    this.renderList();
  }
}

