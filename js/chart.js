// A chart panel: title, ECharts chart, legend with averages for the period in
// view, notes, data table, and PNG/CSV export. Every chart in the site uses it.
//
// Behaviour:
//   * hover shows every series' value at that point;
//   * click and drag across the chart zooms to that period;
//     double-click (or "Reset zoom") returns to the full period;
//   * the legend shows each series' average over the period in view and
//     toggles the series on click;
//   * PNG exports the chart with its title and legend; CSV exports the data
//     in view.

import { cssVar, downloadBlob, el, fmtNumber, slug, toCsv } from "./util.js";

const panels = new Set();

window.addEventListener("resize", () => {
  for (const panel of panels) panel.chart?.resize();
});

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
    holiday: cssVar("--holiday")
  };
}

export class ChartPanel {
  /**
   * @param {HTMLElement} container
   * @param {{title: string, subtitle?: string, size?: "short"|"tall", table?: boolean}} options
   */
  constructor(container, { title, subtitle = "", size = "", table = true } = {}) {
    this.root = el("article", { class: "panel" });
    this.root.innerHTML = `
      <div class="panel-head">
        <div><h2></h2><p></p></div>
        <div class="panel-tools">
          <button class="btn" type="button" data-act="reset" title="Return to the full period (or double-click the chart)">Reset zoom</button>
          <button class="btn" type="button" data-act="png" title="Download the chart as an image">PNG</button>
          <button class="btn" type="button" data-act="csv" title="Download the data in view">CSV</button>
        </div>
      </div>
      <div class="chart ${size}"></div>
      <div class="legend"></div>
      <div class="notes"></div>
      ${table ? `<details class="table-wrap"><summary>Show data table</summary><div class="table-scroll"></div></details>` : ""}`;

    container.appendChild(this.root);
    this.titleEl = this.root.querySelector("h2");
    this.subtitleEl = this.root.querySelector(".panel-head p");
    this.chartEl = this.root.querySelector(".chart");
    this.legendEl = this.root.querySelector(".legend");
    this.notesEl = this.root.querySelector(".notes");
    this.tableEl = this.root.querySelector(".table-scroll");
    this.details = this.root.querySelector("details");
    this.setTitle(title, subtitle);

    this.root.querySelector('[data-act="png"]').addEventListener("click", () => this.exportPng());
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

  show(visible) {
    this.root.classList.toggle("hidden", !visible);
    if (visible) this.chart?.resize();
  }

  /**
   * spec = {
   *   xType: "time" | "category", categories?: string[],
   *   xLabel: x => string (tooltip, table, CSV), axisLabel?: x => string,
   *   yName, yFormat?: v => string, yMin?, yAxis2?: {name, format},
   *   series: [{ name, colour, type: "line"|"bar"|"band", data, dashed?, width?,
   *              area?, yAxis?, avg?: false | (values) => number, decimals?, unit?, step? }],
   *   markAreas?: [{ from, to, label }], notes?: string[], legendCaption?
   * }
   * Line/bar data are [x, y] pairs; band data are [x, low, high].
   */
  render(spec) {
    this.spec = spec;
    this.hidden = new Set(spec.series.filter(s => s.hidden).map(s => s.name));

    if (!this.chart) {
      this.chart = echarts.init(this.chartEl, null, { renderer: "canvas" });
      this.chart.on("datazoom", () => this.updateLegend());
      this.chart.getZr().on("dblclick", () => this.resetZoom());
    }

    this.chart.setOption(this.buildOption(spec), { notMerge: true });
    this.enableDragZoom();
    this.renderLegend();
    this.notesEl.innerHTML = (spec.notes || []).map(note => `<p>${note}</p>`).join("");
    if (this.details?.open) this.renderTable();
  }

  /** Re-draw with current theme colours. */
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

  buildOption(spec, { forExport = false } = {}) {
    const t = themeTokens();
    const series = [];
    const yFormat = spec.yFormat || (v => fmtNumber(v, 1));

    spec.series.forEach((s, index) => {
      const colour = resolveColour(s.colour);
      const common = { name: s.name, yAxisIndex: s.yAxis || 0, z: s.z ?? 10 - Math.min(index, 8) };

      if (s.type === "band") {
        series.push({
          ...common, type: "line", stack: `band-${index}`, symbol: "none", silent: true,
          lineStyle: { opacity: 0 }, data: s.data.map(([x, lo]) => [x, lo]), z: 1, tooltip: { show: false }
        });
        series.push({
          ...common, type: "line", stack: `band-${index}`, symbol: "none", silent: true,
          lineStyle: { opacity: 0 }, areaStyle: { color: colour, opacity: 1 },
          data: s.data.map(([x, lo, hi]) => [x, hi - lo]), z: 1, tooltip: { show: false }
        });
        return;
      }

      if (s.type === "bar") {
        series.push({
          ...common, type: "bar", data: s.data, barMaxWidth: 14, large: s.data.length > 2000,
          itemStyle: { color: s.colourFn ? p => resolveColour(s.colourFn(p.value[1])) : colour, borderRadius: [2, 2, 0, 0] }
        });
        return;
      }

      series.push({
        ...common, type: "line", data: s.data, showSymbol: s.symbols || false, symbolSize: 5,
        step: s.step || false, connectNulls: false, sampling: s.data.length > 4000 ? "lttb" : undefined,
        lineStyle: { color: colour, width: s.width ?? 2, type: s.dashed ? [6, 4] : "solid" },
        itemStyle: { color: colour },
        areaStyle: s.area ? { color: colour, opacity: 0.08 } : undefined,
        emphasis: { disabled: true }
      });
    });

    if (spec.markAreas?.length && series.length) {
      series[series.length - 1].markArea = {
        silent: true,
        itemStyle: { color: t.holiday },
        label: { color: t.muted, fontSize: 10, position: "insideTop" },
        data: spec.markAreas.map(area => [
          { xAxis: area.from, name: area.label, itemStyle: area.colour ? { color: resolveColour(area.colour) } : undefined },
          { xAxis: area.to }
        ])
      };
    }

    const legendNames = spec.series.map(s => s.name);
    const selected = Object.fromEntries(legendNames.map(name => [name, !this.hidden.has(name)]));

    const axisLabel = {
      color: t.muted, fontSize: 11, fontFamily: "JetBrains Mono", hideOverlap: true,
      formatter: spec.axisLabel || spec.xLabel
    };

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

    return {
      backgroundColor: forExport ? t.panel : "transparent",
      animation: false,
      title: forExport ? {
        text: this.title, subtext: this.subtitle, left: 16, top: 12,
        textStyle: { color: t.text, fontSize: 18, fontFamily: "Inter" },
        subtextStyle: { color: t.muted, fontSize: 12 }
      } : undefined,
      legend: {
        show: forExport, bottom: 10, left: 16, data: legendNames, selected,
        textStyle: { color: t.soft, fontSize: 12 }, itemWidth: 18, itemHeight: 4, icon: "roundRect"
      },
      grid: forExport
        ? { left: 64, right: spec.yAxis2 ? 64 : 28, top: 84, bottom: 70 }
        : { left: 56, right: spec.yAxis2 ? 56 : 20, top: 36, bottom: 34 },
      toolbox: forExport ? undefined : {
        show: true, right: 14, top: 0, itemSize: 13,
        iconStyle: { borderColor: t.muted },
        feature: { dataZoom: { yAxisIndex: "none", title: { zoom: "Drag to zoom", back: "Undo zoom" } } }
      },
      dataZoom: [{ type: "inside", xAxisIndex: 0, zoomOnMouseWheel: false, moveOnMouseMove: false, moveOnMouseWheel: false, filterMode: "none" }],
      tooltip: forExport ? undefined : {
        trigger: "axis", confine: true,
        backgroundColor: t.tooltip, borderColor: t.border, padding: [9, 12],
        textStyle: { color: t.text, fontSize: 12 },
        axisPointer: { type: "line", lineStyle: { color: t.axis } },
        formatter: params => this.tooltip(params)
      },
      xAxis: {
        type: spec.xType, data: spec.categories, min: spec.xMin, max: spec.xMax, boundaryGap: spec.series.some(s => s.type === "bar") && spec.xType === "category",
        axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false }, axisLabel,
        splitLine: { show: false }
      },
      yAxis: yAxes,
      series
    };
  }

  tooltip(params) {
    if (!params.length) return "";
    const spec = this.spec;
    const first = params[0];
    const x = spec.xType === "category" ? spec.categories[first.dataIndex] : first.value[0];
    const xIndex = first.dataIndex;
    const rows = [];

    const nearest = new Map(params.filter(p => Array.isArray(p.value)).map(p => [p.seriesName, p.value[1]]));

    for (const s of spec.series) {
      if (this.hidden.has(s.name)) continue;
      let value = this.valueAt(s, x, xIndex);
      // Series on a different time grid (e.g. half-hourly) have no point at
      // exactly x; use the nearest point ECharts picked for that series.
      if (value == null && s.type !== "band" && spec.xType !== "category") value = nearest.get(s.name) ?? null;
      if (value == null) continue;
      const colour = resolveColour(s.colour);
      const text = Array.isArray(value)
        ? `${this.formatValue(s, value[0])} – ${this.formatValue(s, value[1])}`
        : this.formatValue(s, value);
      rows.push(`<div style="display:flex;justify-content:space-between;gap:22px;margin-top:4px">
        <span><span style="display:inline-block;width:10px;height:${s.type === "band" ? 8 : 3}px;border-radius:2px;background:${colour};margin-right:7px;vertical-align:middle"></span>${s.name}</span>
        <b style="font-family:JetBrains Mono,monospace">${text}</b></div>`);
    }

    const extra = spec.tooltipExtra ? spec.tooltipExtra(x) : "";
    return `<div style="font-weight:700;margin-bottom:2px">${spec.xLabel(x)}</div>${rows.join("")}${extra}`;
  }

  formatValue(s, value) {
    if (s.format) return s.format(value);
    const decimals = s.decimals ?? 2;
    return `${fmtNumber(value, decimals)}${s.unit ? ` ${s.unit}` : ""}`;
  }

  lookup(s) {
    if (!s._lookup) {
      s._lookup = new Map();
      s.data.forEach((point, i) => {
        const key = this.spec.xType === "category" ? i : point[0];
        s._lookup.set(key, s.type === "band" ? [point[1], point[2]] : point[1]);
      });
    }
    return s._lookup;
  }

  valueAt(s, x, index) {
    const map = this.lookup(s);
    return this.spec.xType === "category" ? map.get(index) ?? null : map.get(x) ?? null;
  }

  /** [min, max] of the x-axis in view (indices for category axes). */
  visibleExtent() {
    try {
      const axis = this.chart.getModel().getComponent("xAxis", 0).axis;
      return axis.scale.getExtent();
    } catch (error) {
      return [-Infinity, Infinity];
    }
  }

  inView(s) {
    const [lo, hi] = this.visibleExtent();
    if (this.spec.xType === "category") {
      return s.data.filter((_, i) => i >= lo - 1e-9 && i <= hi + 1e-9);
    }
    return s.data.filter(p => p[0] >= lo && p[0] <= hi);
  }

  renderLegend() {
    const spec = this.spec;
    this.legendEl.innerHTML = "";

    for (const s of spec.series) {
      const colour = resolveColour(s.colour);
      const item = el("button", { class: `legend-item${this.hidden.has(s.name) ? " off" : ""}`, type: "button", title: "Show or hide this series" });
      const keyClass = s.type === "band" ? "key band" : s.dashed ? "key dashed" : "key";
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

    const caption = el("span", { class: "legend-caption" }, spec.legendCaption ?? "Average for the period in view");
    this.legendEl.appendChild(caption);
    // Wait one frame so the axis extent reflects the new option.
    requestAnimationFrame(() => this.updateLegend());
  }

  updateLegend() {
    if (!this.spec) return;
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
      this.inView(s).forEach(p => {
        const key = spec.xType === "category" ? s.data.indexOf(p) : p[0];
        keys.add(key);
        map.set(key, s.type === "band" ? [p[1], p[2]] : p[1]);
      });
      return map;
    });

    const sorted = [...keys].sort((a, b) => a - b);
    const rows = sorted.map(key => {
      const label = spec.xType === "category" ? spec.categories[key] : (spec.csvLabel || spec.xLabel)(key);
      const values = columns.map(({ s, part }) => {
        const v = keyed[spec.series.indexOf(s)].get(key);
        const raw = part === null ? v : v?.[part];
        return raw == null || !Number.isFinite(raw) ? "" : Number(raw.toFixed(s.decimals ?? 3));
      });
      return [label, ...values];
    });

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

  exportPng() {
    if (!this.spec) return;
    const holder = el("div");
    holder.style.cssText = "position:absolute;left:-10000px;top:0;width:1400px;height:720px";
    document.body.appendChild(holder);
    const exporter = echarts.init(holder, null, { renderer: "canvas" });
    const option = this.buildOption(this.spec, { forExport: true });
    const [lo, hi] = this.visibleExtent();
    if (Number.isFinite(lo)) {
      option.xAxis.min = this.spec.xType === "category" ? Math.ceil(lo) : lo;
      option.xAxis.max = this.spec.xType === "category" ? Math.floor(hi) : hi;
    }
    exporter.setOption(option);
    const url = exporter.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: themeTokens().panel });
    exporter.dispose();
    holder.remove();
    fetch(url).then(r => r.blob()).then(blob => downloadBlob(`${slug(this.title)}.png`, blob));
  }
}

export function refreshAllThemes() {
  for (const panel of panels) panel.refreshTheme();
}
