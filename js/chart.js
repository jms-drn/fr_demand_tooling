// A chart panel: title, ECharts chart, legend with averages for the period in
// view, notes, data table, and PNG / copy / CSV export. Every chart uses it.
//
//  * hover shows every series' value at that point;
//  * click and drag across the chart zooms in; double-click or "Reset" zooms
//    out; time charts can show an overview strip with draggable handles;
//  * the legend shows each series' average (or total) for the period in view
//    and hides/shows series on click;
//  * time axes are drawn in Paris wall-clock time, so ticks fall on Paris
//    midnight and round hours;
//  * lines break where data is missing instead of joining across the gap.

import { dashFor, settings, widthScale } from "./settings.js";
import {
  cssVar, downloadBlob, el, fmtDateTime, fmtNumber, fmtTick, fromWall, parisMidnight, slug, toast, toCsv, toWall
} from "./util.js";

const panels = new Set();
let exportBrand = "France Power Intelligence by jms-drn";

/** Name used in the source line of exported images (set per page). */
export function setExportBrand(text) {
  exportBrand = text;
}

window.addEventListener("resize", () => {
  for (const panel of panels) panel.chart?.resize();
});

function role(colour) {
  return colour?.startsWith("--s-") ? colour.slice(4) : null;
}

function resolveColour(colour) {
  return colour?.startsWith("--") ? cssVar(colour) : colour;
}

function themeTokens() {
  return {
    text: cssVar("--text"),
    soft: cssVar("--text-soft"),
    muted: cssVar("--muted"),
    grid: cssVar("--grid"),
    axis: cssVar("--axis"),
    tooltip: cssVar("--tooltip-bg"),
    border: cssVar("--border-strong"),
    panel: cssVar("--panel"),
    holiday: cssVar("--holiday"),
    event: cssVar("--event"),
    accent: cssVar("--accent")
  };
}

/** Typical spacing between points, used to detect gaps. */
function typicalStep(points) {
  if (points.length < 3) return Infinity;
  const diffs = [];
  const stride = Math.max(1, Math.floor(points.length / 400));
  for (let i = stride; i < points.length; i += stride) diffs.push(points[i][0] - points[i - stride][0]);
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)] / stride;
}

export class ChartPanel {
  /**
   * @param {HTMLElement} container
   * @param {{title: string, subtitle?: string, size?: string, table?: boolean, overview?: boolean}} options
   */
  constructor(container, { title, subtitle = "", size = "", table = true, overview = false } = {}) {
    this.overview = overview;
    this.root = el("article", { class: "panel" });
    this.root.innerHTML = `
      <div class="panel-head">
        <div><h2></h2><p></p></div>
        <div class="panel-tools">
          <button class="btn ghost" type="button" data-act="reset" title="Zoom back out (or double-click the chart)">Reset</button>
          <button class="btn ghost" type="button" data-act="copy" title="Copy the chart image to your clipboard">Copy</button>
          <button class="btn ghost" type="button" data-act="png" title="Download the chart as an image, with source line">PNG</button>
          <button class="btn ghost" type="button" data-act="csv" title="Download the data in view">CSV</button>
        </div>
      </div>
      <div class="chart-wrap"><div class="chart ${size}"></div><div class="chart-loading" hidden><span></span></div><div class="chart-empty" hidden></div></div>
      <div class="legend"></div>
      <div class="notes"></div>
      ${table ? `<details class="table-wrap"><summary>Show data table</summary><div class="table-scroll"></div></details>` : ""}`;

    container.appendChild(this.root);
    this.titleEl = this.root.querySelector("h2");
    this.subtitleEl = this.root.querySelector(".panel-head p");
    this.chartEl = this.root.querySelector(".chart");
    this.loadingEl = this.root.querySelector(".chart-loading");
    this.emptyEl = this.root.querySelector(".chart-empty");
    this.legendEl = this.root.querySelector(".legend");
    this.notesEl = this.root.querySelector(".notes");
    this.tableEl = this.root.querySelector(".table-scroll");
    this.details = this.root.querySelector("details");
    this.setTitle(title, subtitle);

    this.root.querySelector('[data-act="png"]').addEventListener("click", () => this.exportPng());
    this.root.querySelector('[data-act="copy"]').addEventListener("click", () => this.copyPng());
    this.root.querySelector('[data-act="csv"]').addEventListener("click", () => this.exportCsv());
    this.root.querySelector('[data-act="reset"]').addEventListener("click", () => this.resetZoom());
    this.details?.addEventListener("toggle", () => this.details.open && this.renderTable());

    panels.add(this);
  }

  setTitle(title, subtitle = "") {
    this.title = title;
    this.subtitle = subtitle;
    this.titleEl.textContent = title;
    this.subtitleEl.textContent = subtitle;
    this.subtitleEl.hidden = !subtitle;
  }

  setLoading(loading) {
    this.loadingEl.hidden = !loading;
    this.root.classList.toggle("is-loading", loading);
  }

  show(visible) {
    this.root.classList.toggle("hidden", !visible);
    if (visible) this.chart?.resize();
  }

  isTime() {
    return this.spec?.xType === "time";
  }

  /** Chart-space x for a real x (Paris wall clock on time axes). */
  cx(x) {
    return this.isTime() ? toWall(x) : x;
  }

  /** Real x for a chart-space x. */
  rx(x) {
    return this.isTime() ? fromWall(x) : x;
  }

  /**
   * spec = {
   *   xType: "time" | "category", categories?: string[],
   *   xLabel: x => string (tooltip and table), csvLabel?: x => string,
   *   axisLabel?: x => string, xHeader?, xMin?, xMax?,
   *   yName, yFormat?: v => string, yMin?, yScale?, yAxis2?: {name, format},
   *   series: [{ name, colour, type: "line"|"bar"|"band", data, dashed?, width?,
   *              yAxis?, avg?: false | (values) => number, decimals?, unit?, format?,
   *              symbols?, step?, colourFn?, hidden?, barColours? }],
   *   markAreas?: [{ from, to, label, colour? }], events?: [{from, to?, label}],
   *   zeroLine?: boolean, notes?: string[], legendCaption?, empty?: string
   * }
   * Line and bar data are [x, y] pairs; band data are [x, low, high].
   */
  render(spec) {
    this.spec = spec;
    this.setLoading(false);
    spec.series = spec.series || [];
    this.hidden = new Set(spec.series.filter(s => s.hidden).map(s => s.name));
    for (const s of spec.series) delete s._lookup;

    if (!this.chart) {
      this.chart = echarts.init(this.chartEl, null, { renderer: "canvas" });
      this.chart.on("datazoom", () => this.updateLegend());
      this.chart.getZr().on("dblclick", () => this.resetZoom());
    }

    const empty = spec.empty || (!spec.custom && !spec.series.some(s => s.data?.length) ? "No data for this selection." : "");
    this.emptyEl.hidden = !empty;
    this.emptyEl.textContent = empty;

    this.chart.setOption(this.buildOption(spec), { notMerge: true });
    if (!spec.custom) this.enableDragZoom();
    spec.custom?.onReady?.(this.chart);
    this.renderLegend();
    this.notesEl.innerHTML = (spec.notes || []).filter(Boolean).map(note => `<p>${note}</p>`).join("");
    if (this.details?.open) this.renderTable();
  }

  refreshTheme() {
    if (this.spec) this.render(this.spec);
  }

  enableDragZoom() {
    this.chart.dispatchAction({ type: "takeGlobalCursor", key: "dataZoomSelect", dataZoomSelectActive: true });
  }

  resetZoom() {
    if (!this.chart) return;
    this.chart.dispatchAction({ type: "dataZoom", start: 0, end: 100 });
    this.updateLegend();
  }

  /** Line points in chart space, with nulls inserted at gaps. */
  chartPoints(data) {
    if (!this.isTime()) return data;
    const step = typicalStep(data);
    const out = [];
    let prevReal = null;
    let prevWall = null;
    for (const point of data) {
      const [x, ...rest] = point;
      const w = toWall(x);
      if (prevWall !== null && w <= prevWall) continue; // repeated October hour
      // Break the line for gaps of three or more intervals; bridge single missing points.
      if (prevReal !== null && x - prevReal > step * 2.5) out.push([(prevWall + w) / 2, ...rest.map(() => null)]);
      out.push([w, ...rest]);
      prevReal = x;
      prevWall = w;
    }
    return out;
  }

  buildOption(spec, { forExport = false } = {}) {
    const t = themeTokens();
    if (spec.custom) {
      // Charts drawn by the caller (map, timeline); the panel adds export framing.
      const option = spec.custom.option(t, { forExport });
      if (forExport) {
        option.backgroundColor = t.panel;
        option.title = {
          text: this.title, subtext: this.subtitle, left: 20, top: 14,
          textStyle: { color: t.text, fontSize: 20, fontFamily: "Inter", fontWeight: 700 },
          subtextStyle: { color: t.muted, fontSize: 13 }
        };
        option.graphic = [...(option.graphic || []), {
          type: "text", left: 20, bottom: 14,
          style: { text: `Source: RTE (French TSO) · ${exportBrand} · Exported ${fmtDateTime(Date.now())} Paris time`, fill: t.muted, font: "12px Inter, sans-serif" }
        }];
      }
      return option;
    }
    const scale = widthScale();
    const markers = settings().markers;
    const series = [];
    const yFormat = spec.yFormat || (v => fmtNumber(v, 1));

    spec.series.forEach((s, index) => {
      const colour = resolveColour(s.colour);
      const common = { name: s.name, yAxisIndex: s.yAxis || 0, z: s.z ?? 10 - Math.min(index, 8) };
      const points = this.chartPoints(s.data);

      if (s.type === "band") {
        series.push({
          ...common, type: "line", stack: `band-${index}`, symbol: "none", silent: true, connectNulls: false,
          lineStyle: { opacity: 0 }, data: points.map(([x, lo]) => [x, lo]), z: 1, tooltip: { show: false }
        });
        series.push({
          ...common, type: "line", stack: `band-${index}`, symbol: "none", silent: true, connectNulls: false,
          lineStyle: { opacity: 0 }, areaStyle: { color: colour, opacity: 1 },
          data: points.map(([x, lo, hi]) => [x, hi == null || lo == null ? null : hi - lo]), z: 1, tooltip: { show: false }
        });
        return;
      }

      if (s.type === "bar") {
        series.push({
          ...common, type: "bar", data: points.filter(p => p[1] != null), barMaxWidth: s.barWidth || 16, large: points.length > 2000,
          label: s.labels ? { show: true, position: "top", color: t.soft, fontSize: 11, fontFamily: "JetBrains Mono", formatter: p => s.labels(p.value[1], p.dataIndex) } : undefined,
          itemStyle: {
            borderRadius: [2, 2, 0, 0],
            color: s.colourFn ? p => resolveColour(s.colourFn(p.value[1], p.dataIndex)) : colour
          }
        });
        return;
      }

      const dash = s.dash || (s.dashed ? (dashFor(role(s.colour)) || [6, 4]) : dashFor(role(s.colour)));
      const showSymbols = s.symbols ?? markers;
      series.push({
        ...common, type: "line", data: points, connectNulls: false,
        stack: s.stack, areaStyle: s.stack || s.area ? { color: colour, opacity: s.areaOpacity ?? 0.55 } : undefined,
        showSymbol: showSymbols, showAllSymbol: showSymbols ? "auto" : undefined, symbol: "circle",
        symbolSize: points.length > 400 ? 3 : 5,
        step: s.step || false, sampling: points.length > 4000 && !showSymbols ? "lttb" : undefined,
        lineStyle: { color: colour, width: (s.width ?? 2) * scale, type: dash || "solid" },
        itemStyle: { color: colour },
        emphasis: { disabled: true }
      });
    });

    // Shaded periods (holidays, today) and events live on an invisible helper series.
    const areas = (spec.markAreas || []).map(area => [
      { xAxis: this.cx(area.from), name: area.label, itemStyle: { color: area.colour ? resolveColour(area.colour) : t.holiday } },
      { xAxis: this.cx(area.to) }
    ]);
    const lines = [];
    for (const e of spec.events || []) {
      const from = parisMidnight(e.from);
      if (e.to && e.to !== e.from) {
        const to = parisMidnight(e.to) + 24 * 3600000;
        areas.push([{ xAxis: this.cx(from), name: e.label, itemStyle: { color: t.event } }, { xAxis: this.cx(to) }]);
      } else {
        lines.push({ xAxis: this.cx(from), name: e.label });
      }
    }
    if (spec.zeroLine) lines.push({ yAxis: 0, name: "", label: { show: false }, lineStyle: { type: "solid", color: t.axis } });

    if (areas.length || lines.length) {
      series.push({
        name: "__marks", type: "line", data: [], silent: true, tooltip: { show: false },
        markArea: areas.length ? { silent: true, label: { color: t.muted, fontSize: 10, position: "insideTop" }, data: areas } : undefined,
        markLine: lines.length ? {
          silent: true, symbol: "none", lineStyle: { color: t.muted, type: [4, 4], width: 1 },
          label: { color: t.muted, fontSize: 10, formatter: p => p.name, position: "insideEndTop" }, data: lines
        } : undefined
      });
    }

    const legendNames = spec.series.map(s => s.name);
    const selected = Object.fromEntries(legendNames.map(name => [name, !this.hidden.has(name)]));
    const labelFn = spec.axisLabel || (this.isTime() ? fmtTick : spec.xLabel);

    const yAxes = [{
      type: "value", scale: spec.yScale ?? spec.yMin === undefined, min: spec.yMin, name: spec.yName,
      nameTextStyle: { color: t.muted, align: "left" },
      axisLabel: { color: t.muted, fontSize: 11, fontFamily: "JetBrains Mono", formatter: v => yFormat(v) },
      splitLine: { lineStyle: { color: t.grid } }
    }];

    if (spec.yAxis2) {
      yAxes.push({
        type: "value", scale: true, name: spec.yAxis2.name,
        nameTextStyle: { color: t.muted, align: "right" },
        axisLabel: { color: t.muted, fontSize: 11, fontFamily: "JetBrains Mono", formatter: spec.yAxis2.format || (v => v) },
        splitLine: { show: false }
      });
    }

    const overview = this.overview && this.isTime() && !forExport;
    const exportFooter = forExport
      ? `Source: RTE (French TSO) · ${exportBrand} · Exported ${fmtDateTime(Date.now())} Paris time`
      : "";

    return {
      backgroundColor: forExport ? t.panel : "transparent",
      animation: false,
      useUTC: true,
      title: forExport ? {
        text: this.title, subtext: this.subtitle, left: 20, top: 14,
        textStyle: { color: t.text, fontSize: 20, fontFamily: "Inter", fontWeight: 700 },
        subtextStyle: { color: t.muted, fontSize: 13 }
      } : undefined,
      graphic: forExport ? [{
        type: "text", left: 20, bottom: 14,
        style: { text: exportFooter, fill: t.muted, font: "12px Inter, sans-serif" }
      }] : undefined,
      legend: {
        show: forExport, bottom: 40, left: 20, data: legendNames, selected,
        textStyle: { color: t.soft, fontSize: 13 }, itemWidth: 20, itemHeight: 4, icon: "roundRect"
      },
      grid: forExport
        ? { left: 70, right: spec.yAxis2 ? 70 : 32, top: 108, bottom: 96 }
        : { left: 56, right: spec.yAxis2 ? 56 : 20, top: 36, bottom: overview ? 74 : 34 },
      toolbox: forExport ? undefined : {
        show: true, right: 14, top: 0, itemSize: 13,
        iconStyle: { borderColor: t.muted },
        feature: { dataZoom: { yAxisIndex: "none", title: { zoom: "Drag to zoom", back: "Undo zoom" } } }
      },
      dataZoom: [
        { type: "inside", xAxisIndex: 0, zoomOnMouseWheel: false, moveOnMouseMove: false, moveOnMouseWheel: false, filterMode: "none" },
        ...(overview ? [{
          type: "slider", xAxisIndex: 0, filterMode: "none", height: 26, bottom: 10,
          borderColor: t.grid, backgroundColor: "transparent", fillerColor: `${t.accent}22`,
          dataBackground: { lineStyle: { color: t.muted, opacity: 0.5 }, areaStyle: { color: t.muted, opacity: 0.08 } },
          selectedDataBackground: { lineStyle: { color: t.accent }, areaStyle: { color: t.accent, opacity: 0.12 } },
          handleStyle: { color: t.accent, borderColor: t.accent }, moveHandleStyle: { color: t.accent, opacity: 0.4 },
          textStyle: { color: t.muted, fontSize: 10 }, labelFormatter: v => fmtTick(fromWall(v))
        }] : [])
      ],
      tooltip: forExport ? undefined : {
        trigger: "axis", confine: true,
        backgroundColor: t.tooltip, borderColor: t.border, padding: [9, 12],
        textStyle: { color: t.text, fontSize: 12 },
        axisPointer: { type: "line", lineStyle: { color: t.axis } },
        formatter: params => this.tooltip(params)
      },
      xAxis: {
        type: spec.xType, data: spec.categories,
        min: spec.xMin == null ? undefined : this.cx(spec.xMin), max: spec.xMax == null ? undefined : this.cx(spec.xMax),
        boundaryGap: spec.series.some(s => s.type === "bar") && spec.xType === "category",
        axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false },
        axisLabel: {
          color: t.muted, fontSize: 11, fontFamily: "JetBrains Mono", hideOverlap: true,
          showMinLabel: this.isTime() ? false : undefined, showMaxLabel: this.isTime() ? false : undefined,
          formatter: this.isTime() ? v => labelFn(fromWall(v)) : labelFn
        },
        splitLine: { show: false }
      },
      yAxis: yAxes,
      series
    };
  }

  tooltip(params) {
    const spec = this.spec;
    params = params.filter(p => !p.seriesName.startsWith("__"));
    if (!params.length) return "";
    const first = params[0];
    const x = spec.xType === "category" ? first.dataIndex : this.rx(first.value[0]);
    const nearest = new Map(params.filter(p => Array.isArray(p.value)).map(p => [p.seriesName, p.value[1]]));
    const rows = [];

    for (const s of spec.series) {
      if (this.hidden.has(s.name)) continue;
      let value = this.valueAt(s, x);
      // Series on a coarser grid (e.g. half-hourly) have no point at exactly x.
      if (value == null && s.type !== "band" && spec.xType !== "category") value = nearest.get(s.name) ?? null;
      if (value == null) continue;
      const colour = resolveColour(s.barColours ? s.barColours(x) : s.colour);
      const text = Array.isArray(value)
        ? `${this.formatValue(s, value[0])} – ${this.formatValue(s, value[1])}`
        : this.formatValue(s, value);
      rows.push(`<div style="display:flex;justify-content:space-between;gap:22px;margin-top:4px">
        <span><span style="display:inline-block;width:10px;height:${s.type === "band" ? 8 : 3}px;border-radius:2px;background:${colour};margin-right:7px;vertical-align:middle"></span>${s.name}</span>
        <b style="font-family:JetBrains Mono,monospace">${text}</b></div>`);
    }

    const label = spec.xType === "category" ? spec.categories[x] : spec.xLabel(x);
    const extra = spec.tooltipExtra ? spec.tooltipExtra(x) : "";
    return `<div style="font-weight:700;margin-bottom:2px">${label}</div>${rows.join("")}${extra}`;
  }

  formatValue(s, value) {
    if (s.format) return s.format(value);
    const decimals = s.decimals ?? 2;
    return `${fmtNumber(value, decimals)}${s.unit ? ` ${s.unit}` : ""}`;
  }

  lookup(s) {
    if (!s._lookup) {
      s._lookup = new Map();
      for (const point of s.data) s._lookup.set(point[0], s.type === "band" ? [point[1], point[2]] : point[1]);
    }
    return s._lookup;
  }

  valueAt(s, x) {
    return this.lookup(s).get(x) ?? null;
  }

  /** [min, max] of the x-axis in view, in real x (indices on category axes). */
  visibleExtent() {
    try {
      const axis = this.chart.getModel().getComponent("xAxis", 0).axis;
      const [lo, hi] = axis.scale.getExtent();
      return this.isTime() ? [this.rx(lo), this.rx(hi)] : [lo, hi];
    } catch (error) {
      return [-Infinity, Infinity];
    }
  }

  inView(s) {
    const [lo, hi] = this.visibleExtent();
    return s.data.filter(p => p[0] >= lo - 1e-9 && p[0] <= hi + 1e-9);
  }

  renderLegend() {
    const spec = this.spec;
    this.legendEl.innerHTML = "";
    if (spec.custom) {
      this.legendEl.innerHTML = (spec.custom.legend || []).map(item =>
        `<span class="legend-item static"><span class="key ${item.shape || "bar"}${item.stripes ? " stripes" : ""}" style="background:${resolveColour(item.colour)};color:${resolveColour(item.colour)}"></span><span>${item.name}</span></span>`).join("")
        + (spec.legendCaption ? `<span class="legend-caption">${spec.legendCaption}</span>` : "");
      this.legendEl.hidden = !this.legendEl.innerHTML;
      return;
    }
    this.legendEl.hidden = false;

    for (const s of spec.series) {
      const colour = resolveColour(s.colour);
      const item = el("button", { class: `legend-item${this.hidden.has(s.name) ? " off" : ""}`, type: "button", title: "Show or hide this series" });
      const keyClass = s.type === "band" ? "key band" : s.type === "bar" ? "key bar" : s.dash ? "key dotted" : s.dashed || dashFor(role(s.colour)) ? "key dashed" : "key";
      item.innerHTML = `<span class="${keyClass}" style="background:${colour};color:${colour}"></span><span>${s.name}</span><b data-avg></b>`;
      item.addEventListener("click", () => {
        if (this.hidden.has(s.name)) this.hidden.delete(s.name);
        else this.hidden.add(s.name);
        item.classList.toggle("off", this.hidden.has(s.name));
        this.chart.dispatchAction({ type: "legendToggleSelect", name: s.name });
      });
      s._legendItem = item;
      this.legendEl.appendChild(item);
    }

    if (spec.legendCaption !== null) {
      this.legendEl.appendChild(el("span", { class: "legend-caption" }, spec.legendCaption ?? "Average for the period in view"));
    }
    requestAnimationFrame(() => this.updateLegend());
  }

  updateLegend() {
    if (!this.spec || this.spec.custom) return;
    for (const s of this.spec.series) {
      const slot = s._legendItem?.querySelector("[data-avg]");
      if (!slot) continue;
      if (s.avg === false || s.type === "band") { slot.textContent = ""; continue; }
      const values = this.inView(s).map(p => p[1]).filter(Number.isFinite);
      const value = typeof s.avg === "function" ? s.avg(values) : values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
      slot.textContent = value == null ? "–" : this.formatValue(s, value);
    }
  }

  /** Rows of the data in view: [x label, ...values], with headers. */
  tableData() {
    const spec = this.spec;
    if (spec.custom) return spec.custom.table ? spec.custom.table() : { headers: [], rows: [] };
    const headers = [spec.xHeader || "Time (Europe/Paris)"];
    const columns = [];

    for (const s of spec.series) {
      const unit = s.unit ? ` (${s.unit})` : "";
      if (s.type === "band") {
        headers.push(`${s.name} low${unit}`, `${s.name} high${unit}`);
        columns.push({ s, part: 0 }, { s, part: 1 });
      } else {
        headers.push(`${s.name}${unit}`);
        columns.push({ s, part: null });
      }
    }

    const keys = new Set();
    const keyed = spec.series.map(s => {
      const map = new Map();
      for (const p of this.inView(s)) {
        keys.add(p[0]);
        map.set(p[0], s.type === "band" ? [p[1], p[2]] : p[1]);
      }
      return map;
    });

    const label = spec.xType === "category" ? k => spec.categories[k] : spec.csvLabel || spec.xLabel;
    const rows = [...keys].sort((a, b) => a - b).map(key => [
      label(key),
      ...columns.map(({ s, part }) => {
        const v = keyed[spec.series.indexOf(s)].get(key);
        const raw = part === null ? v : v?.[part];
        return raw == null || !Number.isFinite(raw) ? "" : Number(raw.toFixed(s.decimals ?? 3));
      })
    ]);

    return { headers, rows };
  }

  renderTable() {
    if (!this.spec || !this.tableEl) return;
    const { headers, rows } = this.tableData();
    const shown = rows.slice(0, 1500);
    this.tableEl.innerHTML = `<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
      <tbody>${shown.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>
      ${rows.length > shown.length ? `<p class="muted" style="padding:6px 10px">Showing the first ${shown.length} of ${rows.length} rows. The CSV contains all of them.</p>` : ""}`;
  }

  exportCsv() {
    if (!this.spec) return;
    const { headers, rows } = this.tableData();
    downloadBlob(`${slug(this.title)}.csv`, new Blob([toCsv(headers, rows)], { type: "text/csv;charset=utf-8" }));
  }

  /** The chart as a PNG blob, with title, legend and source footer. */
  async pngBlob() {
    const holder = el("div");
    holder.style.cssText = "position:absolute;left:-10000px;top:0;width:1400px;height:760px";
    document.body.appendChild(holder);
    if (this.spec.custom?.exportSize) holder.style.height = `${this.spec.custom.exportSize}px`;
    const exporter = echarts.init(holder, null, { renderer: "canvas" });
    const option = this.buildOption(this.spec, { forExport: true });
    const [lo, hi] = this.spec.custom ? [NaN, NaN] : this.visibleExtent();
    if (Number.isFinite(lo)) {
      option.xAxis.min = this.isTime() ? this.cx(lo) : Math.ceil(lo);
      option.xAxis.max = this.isTime() ? this.cx(hi) : Math.floor(hi);
    }
    exporter.setOption(option);
    const url = exporter.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: themeTokens().panel });
    exporter.dispose();
    holder.remove();
    return (await fetch(url)).blob();
  }

  async exportPng() {
    if (!this.spec) return;
    downloadBlob(`${slug(this.title)}.png`, await this.pngBlob());
  }

  async copyPng() {
    if (!this.spec) return;
    try {
      const blob = await this.pngBlob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast("Chart copied to clipboard");
    } catch (error) {
      toast("Your browser doesn't allow copying images here. Use PNG instead.", { error: true });
    }
  }
}

export function refreshAllCharts() {
  for (const panel of panels) panel.refreshTheme();
}
