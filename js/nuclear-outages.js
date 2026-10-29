// Nuclear outages: every outage notice (latest version) as a timeline per
// reactor and as a sortable table, with how far each one has moved from the
// end date first announced.

import { ChartPanel } from "./chart.js";
import { DAY, HOUR, addDays, copyText, cssVar, csvDateTime, dateKey, downloadBlob, fmtDateTime, fmtDayTime, fmtLongDate,
  fmtNumber, fmtTick, fromWall, heroHtml, parisMidnight, toCsv, toWall, todayParis, writeHash } from "./util.js";
import { fmtDuration, fmtStamp, reasonLabel, siteSort } from "./nuclear-common.js";
import { getFleet, getOutages } from "./power-data.js";

const DURATIONS = { 0: "Any length", 1: "1 day or more", 7: "1 week or more", 30: "1 month or more" };

function defaults() {
  return { win: "now", from: "", to: "", type: "all", dur: "1", size: "major", state: "all", running: "0", site: "all", unit: "", q: "", sort: "start", dir: "asc" };
}

export class NuclearOutages {
  constructor(root) {
    this.root = root;
    this.state = defaults();
    this.renderId = 0;
    this.build();
  }

  setParams(params) {
    const state = defaults();
    for (const key of Object.keys(state)) if (params.has(key)) state[key] = params.get(key);
    this.state = state;
    this.syncControls();
  }

  build() {
    const y = Number(todayParis().slice(0, 4));
    const years = [];
    for (let k = y + 1; k >= 2015; k--) years.push(k);
    this.root.innerHTML = `
      ${heroHtml("Nuclear outages,", "reactor by reactor.", "Every planned and unplanned outage notice, as a timeline for each reactor and as a table. The amber part of a bar is how far the outage has run, or is expected to run, beyond the end date first announced.")}
      <div class="toolbar" role="group" aria-label="Outage filters">
        <div class="toolbar-row">
          <label class="field"><span>Window</span>
            <select data-k="win">
              <option value="now">Ongoing and next 12 months</option><option value="12m">Last 12 months</option><option value="24m">Last 24 months and ahead</option>
              ${years.map(v => `<option value="y${v}">${v}</option>`).join("")}<option value="custom">Custom</option>
            </select>
          </label>
          <label class="field" data-custom><span>From</span><input type="date" data-k="from" min="2010-12-01"></label>
          <label class="field" data-custom><span>To</span><input type="date" data-k="to" min="2010-12-01"></label>
          <label class="field"><span>Type</span><select data-k="type"><option value="all">Planned and unplanned</option><option value="planned">Planned</option><option value="unplanned">Unplanned</option></select></label>
          <label class="field"><span>Length</span><select data-k="dur">${Object.entries(DURATIONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
          <label class="field"><span>Size</span><select data-k="size"><option value="major">A quarter of the reactor or more</option><option value="half">Half the reactor or more</option><option value="all">Any size</option></select></label>
          <label class="field"><span>Status</span>
            <select data-k="state"><option value="all">Any</option><option value="ongoing">Ongoing now</option><option value="upcoming">Not started yet</option>
              <option value="ended">Ended</option><option value="overran">Ran past first announced end</option><option value="early">Ended early</option></select>
          </label>
          <label class="field"><span>Offline for</span>
            <select data-k="running"><option value="0">Any time so far</option><option value="7">Over a week so far</option><option value="30">Over a month so far</option>
              <option value="91">Over 3 months so far</option><option value="182">Over 6 months so far</option></select>
          </label>
          <label class="field"><span>Site</span><select data-k="site" data-sites><option value="all">All sites</option></select></label>
          <label class="field grow"><span>Search</span><input type="search" data-k="q" placeholder="Reactor, reason or remark"></label>
          <div class="field"><span>Quick</span><div class="chips">
            <button class="chip" type="button" data-all-outages style="color:var(--accent)"><span class="swatch"></span><span class="chip-label">Show all outages</span></button>
          </div></div>
        </div>
      </div>
      <div class="filter-note" data-unit-note hidden></div>
      <div class="headline"><p data-headline>Loading…</p><button class="btn ghost small" type="button" data-copy title="Copy this sentence">Copy</button></div>
      <div class="cards" data-cards>${'<div class="card skeleton"></div>'.repeat(5)}</div>
      <div data-gantt></div>
      <article class="panel">
        <div class="panel-head">
          <div><h2 data-table-title>Outages</h2><p>Latest version of each notice. Click a column to sort. Times are Paris time.</p></div>
          <div class="panel-tools"><button class="btn ghost" type="button" data-csv>CSV</button></div>
        </div>
        <div class="table-scroll flat tall-table" data-table></div>
      </article>`;
    this.headline = this.root.querySelector("[data-headline]");
    this.cards = this.root.querySelector("[data-cards]");
    this.tableEl = this.root.querySelector("[data-table]");
    this.gantt = new ChartPanel(this.root.querySelector("[data-gantt]"), { title: "Outage timeline", size: "gantt" });
    this.root.querySelector("[data-copy]").addEventListener("click", () => copyText(this.headline.textContent));
    this.root.querySelector("[data-csv]").addEventListener("click", () => this.exportCsv());
    this.root.querySelector("[data-all-outages]").addEventListener("click", () => {
      const all = this.isAll();
      Object.assign(this.state, all ? { dur: "1", size: "major" } : { dur: "0", size: "all", type: "all", state: "all", running: "0", q: "" });
      this.syncControls();
      this.update();
    });
    this.root.querySelectorAll("[data-k]").forEach(input => input.addEventListener(input.type === "search" ? "input" : "change", () => {
      this.state[input.dataset.k] = input.value;
      if (input.dataset.k === "from" || input.dataset.k === "to") this.state.win = "custom";
      if (input.dataset.k === "site") this.state.unit = "";
      this.syncControls();
      clearTimeout(this.typing);
      this.typing = setTimeout(() => this.update(), input.type === "search" ? 250 : 0);
    }));
    this.tableEl.addEventListener("click", event => {
      const th = event.target.closest("th[data-sort]");
      if (!th) return;
      const key = th.dataset.sort;
      this.state.dir = this.state.sort === key && this.state.dir === "asc" ? "desc" : "asc";
      this.state.sort = key;
      this.renderTable();
      writeHash("nuclear/outages", this.state);
    });
  }

  syncControls() {
    const s = this.state;
    this.root.querySelectorAll("[data-k]").forEach(input => {
      if (input.tagName === "SELECT" && !input.querySelector(`option[value="${CSS.escape(s[input.dataset.k])}"]`)) return;
      input.value = s[input.dataset.k];
    });
    const [from, to] = this.window();
    if (s.win !== "custom") {
      this.root.querySelector('[data-k="from"]').value = from;
      this.root.querySelector('[data-k="to"]').value = to;
    }
    this.root.querySelector("[data-all-outages]").setAttribute("aria-pressed", this.isAll());
    const note = this.root.querySelector("[data-unit-note]");
    note.hidden = !s.unit;
    if (s.unit) {
      note.innerHTML = `Showing <b>${this.labelOf(s.unit)}</b> only. <button class="link" type="button" data-clear>Show all reactors</button>`;
      note.querySelector("[data-clear]").addEventListener("click", () => { this.state.unit = ""; this.syncControls(); this.update(); });
    }
  }

  isAll() {
    const s = this.state;
    return s.dur === "0" && s.size === "all" && s.type === "all" && s.state === "all" && s.running === "0" && !s.q;
  }

  labelOf(name) {
    return this.fleet?.reactors.find(r => r.name === name)?.label || name;
  }

  window() {
    const s = this.state;
    const today = todayParis();
    if (s.win === "now") return [addDays(today, -30), addDays(today, 365)];
    if (s.win === "12m") return [addDays(today, -365), today];
    if (s.win === "24m") return [addDays(today, -730), addDays(today, 365)];
    if (s.win.startsWith("y")) return [`${s.win.slice(1)}-01-01`, `${s.win.slice(1)}-12-31`];
    return [s.from || addDays(today, -90), s.to || today];
  }

  activate() {
    this.update();
  }

  async update() {
    const id = ++this.renderId;
    writeHash("nuclear/outages", this.state);
    try {
      this.fleet = await getFleet();
      const sites = [...new Set(this.fleet.reactors.map(r => r.site))].sort();
      const siteSelect = this.root.querySelector("[data-sites]");
      if (siteSelect.options.length === 1) {
        siteSelect.insertAdjacentHTML("beforeend", sites.map(v => `<option value="${v}">${v}</option>`).join(""));
        this.syncControls();
      }
      const [from, to] = this.window();
      const y0 = Number(from.slice(0, 4)) - 2;
      const y1 = Number(to.slice(0, 4));
      const years = [];
      for (let y = y0; y <= y1; y++) years.push(y);
      const rows = await getOutages(years);
      if (id !== this.renderId) return;
      this.winFrom = parisMidnight(from);
      this.winTo = parisMidnight(addDays(to, 1));
      this.rows = this.filter(rows);
      this.syncControls();
      this.renderSummary(from, to);
      this.renderGantt();
      this.renderTable();
    } catch (error) {
      console.error(error);
      this.headline.textContent = `The outage data could not be loaded (${error.message}).`;
    }
  }

  filter(rows) {
    const s = this.state;
    const q = s.q.trim().toLowerCase();
    const site = name => this.fleet.reactors.find(r => r.name === name)?.site;
    return rows.filter(o => {
      if (o.status === "DISMISSED") return false;
      if (!(o.start < this.winTo && o.end > this.winFrom)) return false;
      if (o.end - o.start >= 50 * 365 * DAY) return false; // placeholder end dates (e.g. permanent closures filed to 2099)
      if (s.type !== "all" && o.type !== s.type) return false;
      if (o.end - o.start < Number(s.dur) * DAY) return false;
      if (s.size === "major" && o.offMw < 0.25 * o.capMw) return false;
      if (s.size === "half" && o.offMw < 0.5 * o.capMw) return false;
      if (s.unit && o.unit !== s.unit) return false;
      const now = Date.now();
      if (s.state === "ongoing" && !(o.start <= now && o.end > now)) return false;
      if (s.state === "upcoming" && !(o.start > now)) return false;
      if (s.state === "ended" && !(o.end <= now)) return false;
      if (s.state === "overran" && !(o.end - o.firstEnd > HOUR && o.firstEnd < now)) return false;
      if (s.state === "early" && !(o.end <= now && o.firstEnd - o.end > HOUR)) return false;
      if (Number(s.running) > 0 && !(o.start <= now && o.end > now && now - o.start >= Number(s.running) * DAY)) return false;
      if (s.site !== "all" && site(o.unit) !== s.site) return false;
      if (q && !`${this.labelOf(o.unit)} ${o.unit} ${reasonLabel(o.reason, o.remark)} ${o.remark} ${o.type}`.toLowerCase().includes(q)) return false;
      return true;
    }).map(o => ({ ...o, label: this.labelOf(o.unit), delay: o.end - o.firstEnd }));
  }

  renderSummary(from, to) {
    const rows = this.rows;
    const now = Date.now();
    const overlap = o => Math.max(0, Math.min(o.end, this.winTo) - Math.max(o.start, this.winFrom)) / HOUR;
    const twh = rows.reduce((a, o) => a + o.offMw * overlap(o), 0) / 1e6;
    const ended = rows.filter(o => o.type === "planned" && o.end <= now && o.end >= this.winFrom);
    const overran = ended.filter(o => o.delay > HOUR);
    const avgDelay = ended.length ? ended.reduce((a, o) => a + o.delay, 0) / ended.length : null;
    const ongoing = rows.filter(o => o.start <= now && o.end > now);
    const upcoming = rows.filter(o => o.start > now);
    const unplanned = rows.filter(o => o.type === "unplanned");
    const reactors = new Set(rows.map(o => o.unit)).size;

    let text = `${rows.length} outage${rows.length === 1 ? "" : "s"} on ${reactors} reactor${reactors === 1 ? "" : "s"} overlap ${fmtLongDate(from)} to ${fmtLongDate(to)}, removing about ${fmtNumber(twh, 1)} TWh of nuclear capacity in that window.`;
    if (ended.length) {
      text += ` Of the ${ended.length} planned outages that have ended, ${overran.length} (${fmtNumber(100 * overran.length / ended.length, 0)}%) ran past the end date first announced; on average they finished ${fmtDuration(Math.abs(avgDelay))} ${avgDelay >= 0 ? "later" : "earlier"} than first announced.`;
    }
    this.headline.textContent = text;
    const card = (l, v, d = "", c = "") => `<div class="card${c}"><div class="label">${l}</div><div class="value">${v}</div><div class="detail">${d}</div></div>`;
    this.cards.innerHTML = [
      card("Outages in view", `${rows.length}`, `${reactors} reactors · ${unplanned.length} unplanned`, " accent"),
      card("Capacity lost in window", `${fmtNumber(twh, 1)} TWh`, "Unavailable MW × hours, inside the window"),
      card("Ongoing now", `${ongoing.length}`, `${fmtNumber(ongoing.reduce((a, o) => a + o.offMw, 0) / 1000, 1)} GW off`),
      card("Still to start", `${upcoming.length}`, upcoming.length ? `Next: ${upcoming.sort((a, b) => a.start - b.start)[0].label}, ${fmtDayTime(upcoming[0].start)}` : ""),
      ended.length ? card("Planned outages overrunning", `${fmtNumber(100 * overran.length / ended.length, 0)}%`, `${overran.length} of ${ended.length} that ended in view`) : "",
      avgDelay != null ? card("Average change vs first end date", `${avgDelay >= 0 ? "+" : "−"}${fmtNumber(Math.abs(avgDelay) / DAY, 1)} days`, "Planned outages that ended") : ""
    ].join("");
  }

  renderGantt() {
    const s = this.state;
    const rows = this.rows;
    const reactors = this.fleet.reactors.filter(r => {
      if (s.unit) return r.name === s.unit;
      if (s.site !== "all") return r.site === s.site;
      const inService = (!r.from_utc || Date.parse(r.from_utc.replace("Z", ":00Z")) < this.winTo) && (!r.to_utc || Date.parse(r.to_utc.replace("Z", ":00Z")) > this.winFrom);
      return inService || rows.some(o => o.unit === r.name);
    }).sort(siteSort);
    const index = new Map(reactors.map((r, i) => [r.name, i]));
    const labels = reactors.map(r => r.label);
    const items = rows.filter(o => index.has(o.unit)).map((o, i) => [index.get(o.unit), toWall(o.start), toWall(o.end), toWall(o.firstEnd), o.offMw / o.capMw, o.type === "planned" ? 0 : 1, i]);
    const height = Math.max(260, reactors.length * 14 + 90);
    this.gantt.chartEl.style.height = `${height}px`;
    this.gantt.chart?.resize();
    const now = toWall(Date.now());
    const lo = toWall(this.winFrom);
    const hi = toWall(this.winTo);

    const option = (t, { forExport }) => {
      const colours = [cssVar("--st-planned"), cssVar("--st-unplanned")];
      const overrun = cssVar("--warn");
      return {
        backgroundColor: "transparent", animation: false, useUTC: true,
        grid: forExport ? { left: 120, right: 30, top: 108, bottom: 60 } : { left: 112, right: 18, top: 10, bottom: 56 },
        tooltip: forExport ? undefined : {
          confine: true, backgroundColor: t.tooltip, borderColor: t.border, textStyle: { color: t.text, fontSize: 12 },
          formatter: p => this.tooltip(rows[p.value[6]])
        },
        dataZoom: forExport ? [] : [
          { type: "inside", xAxisIndex: 0, filterMode: "weakFilter", zoomOnMouseWheel: "ctrl", moveOnMouseWheel: false },
          { type: "slider", xAxisIndex: 0, filterMode: "weakFilter", height: 22, bottom: 8, borderColor: t.grid, fillerColor: `${t.accent}22`,
            handleStyle: { color: t.accent, borderColor: t.accent }, textStyle: { color: t.muted, fontSize: 10 }, labelFormatter: v => fmtTick(fromWall(v)) }
        ],
        xAxis: {
          type: "time", min: lo, max: hi, axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false },
          axisLabel: { color: t.muted, fontSize: 11, fontFamily: "JetBrains Mono", hideOverlap: true, formatter: v => fmtTick(fromWall(v)) },
          splitLine: { show: true, lineStyle: { color: t.grid } }
        },
        yAxis: { type: "category", data: labels, inverse: true, axisTick: { show: false }, axisLine: { show: false },
          axisLabel: { color: t.soft, fontSize: 10.5, interval: 0 }, splitLine: { show: false } },
        series: [{
          type: "custom", data: items, encode: { x: [1, 2], y: 0 }, clip: true,
          renderItem: (params, api) => {
            const y = api.value(0);
            const start = api.coord([api.value(1), y]);
            const end = api.coord([api.value(2), y]);
            const firstEnd = api.coord([api.value(3), y]);
            const h = Math.max(5, api.size([0, 1])[1] * 0.68);
            const share = api.value(4);
            const colour = colours[api.value(5)];
            const children = [{
              type: "rect", shape: { x: start[0], y: start[1] - h / 2, width: Math.max(1.5, end[0] - start[0]), height: h, r: 2 },
              style: { fill: colour, opacity: 0.35 + 0.65 * share }
            }];
            if (end[0] - Math.max(firstEnd[0], start[0]) > 1) {
              const x0 = Math.max(firstEnd[0], start[0]);
              children.push({ type: "rect", shape: { x: x0, y: start[1] - h / 2, width: end[0] - x0, height: h, r: 2 }, style: { fill: overrun, opacity: 0.9 } });
            }
            return { type: "group", children };
          }
        }, {
          type: "line", data: [], silent: true,
          markLine: { silent: true, symbol: "none", data: [{ xAxis: now }], lineStyle: { color: t.text, type: [4, 4], width: 1 },
            label: { formatter: "Now", color: t.muted, fontSize: 10 } }
        }]
      };
    };
    this.gantt.setTitle("Outage timeline", `${reactors.length} reactors · bar shade shows the share of the reactor unavailable · Ctrl + scroll or drag the strip below to zoom`);
    this.gantt.render({
      series: [],
      custom: {
        option, exportSize: height + 170,
        legend: [{ name: "Planned", colour: "--st-planned" }, { name: "Unplanned", colour: "--st-unplanned" }, { name: "Beyond the end date first announced", colour: "--warn" }],
        table: () => this.tableRows()
      },
      legendCaption: null,
      notes: ["Overlapping notices on one reactor are drawn on top of each other. Notices that EDF later cancelled are left out, and so are placeholder notices running to 2099 (Fessenheim's closure)."]
    });
  }

  tooltip(o) {
    if (!o) return "";
    const delay = o.delay;
    const delayText = Math.abs(delay) < HOUR ? "as first announced" : `${fmtDuration(Math.abs(delay))} ${delay > 0 ? "later" : "earlier"} than first announced`;
    return `<div style="max-width:340px;white-space:normal">
      <div style="font-weight:700;font-size:13px">${o.label}</div>
      <div><span class="tag ${o.type}">${o.type}</span> ${reasonLabel(o.reason, o.remark)} · ${fmtNumber(o.offMw, 0)} of ${fmtNumber(o.capMw, 0)} MW off</div>
      <div style="margin-top:6px">${fmtDateTime(o.start)} → ${fmtDateTime(o.end)} (${fmtDuration(o.end - o.start)})</div>
      <div>End first announced: ${fmtDateTime(o.firstEnd)} · <b style="color:${delay > HOUR ? cssVar("--danger") : "inherit"}">${delayText}</b></div>
      <div class="muted">First published ${fmtDayTime(o.firstPub)} · ${o.versions} version${o.versions === 1 ? "" : "s"} · last ${fmtDayTime(o.lastPub)}</div>
      ${o.remark ? `<div class="muted" style="margin-top:4px">${o.remark}</div>` : ""}</div>`;
  }

  sorted() {
    const { sort, dir } = this.state;
    const key = {
      unit: o => o.label, type: o => o.type, reason: o => reasonLabel(o.reason, o.remark), start: o => o.start, end: o => o.end,
      dur: o => o.end - o.start, firstEnd: o => o.firstEnd, delay: o => o.delay, mw: o => o.offMw, versions: o => o.versions, pub: o => o.lastPub
    }[sort] || (o => o.start);
    const sign = dir === "asc" ? 1 : -1;
    return [...this.rows].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      return (ka < kb ? -1 : ka > kb ? 1 : 0) * sign;
    });
  }

  tableRows() {
    return {
      headers: ["Reactor", "Type", "Reason", "Start (Paris)", "End (Paris)", "Duration (days)", "End first announced (Paris)", "Change vs first end (days)", "MW off", "Capacity (MW)", "Versions", "First published (Paris)", "Last updated (Paris)", "Remark", "Notice id"],
      rows: this.sorted().map(o => [o.label, o.type, reasonLabel(o.reason, o.remark), csvDateTime(o.start), csvDateTime(o.end), Number(((o.end - o.start) / DAY).toFixed(2)),
        csvDateTime(o.firstEnd), Number((o.delay / DAY).toFixed(2)), o.offMw, o.capMw, o.versions, csvDateTime(o.firstPub), csvDateTime(o.lastPub), o.remark, o.id])
    };
  }

  renderTable() {
    const s = this.state;
    const rows = this.sorted();
    const head = (key, label) => `<th class="sortable${s.sort === key ? ` sorted ${s.dir}` : ""}" data-sort="${key}">${label}</th>`;
    const shown = rows.slice(0, 800);
    this.root.querySelector("[data-table-title]").textContent = `Outages (${rows.length})`;
    this.tableEl.innerHTML = `<table><thead><tr>${head("unit", "Reactor")}${head("type", "Type")}${head("reason", "Reason")}${head("start", "Start")}${head("end", "End")}${head("dur", "Length")}${head("firstEnd", "First announced end")}${head("delay", "Change")}${head("mw", "MW off")}${head("versions", "Versions")}${head("pub", "Updated")}<th>Remark</th></tr></thead><tbody>
      ${shown.map(o => {
        const d = o.delay;
        const change = Math.abs(d) < HOUR ? "–" : `${d > 0 ? "+" : "−"}${fmtDuration(Math.abs(d))}`;
        return `<tr><td class="text"><button class="link" type="button" data-unit="${o.unit}">${o.label}</button></td><td class="text"><span class="tag ${o.type}">${o.type}</span></td><td class="text">${reasonLabel(o.reason, o.remark)}</td>
          <td>${fmtStamp(o.start)}</td><td>${fmtStamp(o.end)}</td>
          <td>${fmtDuration(o.end - o.start)}</td><td>${fmtStamp(o.firstEnd)}</td>
          <td class="${d > HOUR ? "bad" : d < -HOUR ? "good" : ""}">${change}</td><td>${fmtNumber(o.offMw, 0)}</td><td>${o.versions}</td><td>${fmtStamp(o.lastPub)}</td>
          <td class="text remark" title="${(o.remark || "").replace(/"/g, "&quot;")}">${o.remark || ""}</td></tr>`;
      }).join("")}</tbody></table>
      ${rows.length > shown.length ? `<p class="muted" style="padding:6px 10px">Showing the first ${shown.length} of ${rows.length}. The CSV has all of them.</p>` : ""}
      ${rows.length ? "" : `<p class="muted" style="padding:12px">No outages match these filters.</p>`}`;
    this.tableEl.querySelectorAll("[data-unit]").forEach(b => b.addEventListener("click", () => {
      this.state.unit = b.dataset.unit;
      this.syncControls();
      this.update();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }));
  }

  exportCsv() {
    const { headers, rows } = this.tableRows();
    downloadBlob("nuclear-outages.csv", new Blob([toCsv(headers, rows)], { type: "text/csv;charset=utf-8" }));
  }

  refreshTheme() {
    if (this.rows) this.renderGantt();
  }
}
