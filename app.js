const DATA_URL = "./data/latest.json";

const SERIES_COLOURS = {
  actual: "#35e6c2",
  id: "#57a7ff",
  d1: "#ffb454",
  d2: "#b28cff",
  positive: "#35e6c2",
  negative: "#ff7b8b"
};

let sourceData = null;
let demandChart = null;
let errorChart = null;

function findSeries(data, type) {
  return data.short_term.find(item => item.type === type);
}

function requireSeries(series, name) {
  if (!series || !Array.isArray(series.values) || series.values.length === 0) {
    throw new Error(`${name} series is missing or empty.`);
  }

  return series;
}

function formatGw(valueMw, decimals = 1) {
  if (!Number.isFinite(Number(valueMw))) {
    return "--";
  }

  return `${(Number(valueMw) / 1000).toFixed(decimals)} GW`;
}

function formatSignedGw(valueMw) {
  if (!Number.isFinite(Number(valueMw))) {
    return "--";
  }

  const valueGw = Number(valueMw) / 1000;
  const sign = valueGw > 0 ? "+" : "";

  return `${sign}${valueGw.toFixed(2)} GW`;
}

function formatParisDateTime(dateString) {
  if (!dateString) {
    return "--";
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short"
  }).format(new Date(dateString));
}

function formatParisDate(dateString) {
  if (!dateString) {
    return "--";
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(dateString));
}

function formatParisTime(dateString) {
  if (!dateString) {
    return "--";
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(dateString));
}

function formatShortDateTime(dateString) {
  if (!dateString) {
    return "--";
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(dateString));
}

function getLatestValue(series) {
  return [...series.values]
    .filter(item => Number.isFinite(Number(item.value)))
    .sort(
      (a, b) =>
        new Date(a.start_date).getTime() -
        new Date(b.start_date).getTime()
    )
    .at(-1);
}

function getPeak(series) {
  return series.values.reduce((highest, item) => {
    if (!highest || Number(item.value) > Number(highest.value)) {
      return item;
    }

    return highest;
  }, null);
}

function getMinimum(series) {
  return series.values.reduce((lowest, item) => {
    if (!lowest || Number(item.value) < Number(lowest.value)) {
      return item;
    }

    return lowest;
  }, null);
}

function findMatchingInterval(series, intervalStart) {
  return series.values.find(
    item => item.start_date === intervalStart
  );
}

function setText(id, value) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = value;
  }
}

function updateHeadlineMetrics(realised, idForecast, d1, d2) {
  const latestActual = getLatestValue(realised);
  const matchingId = findMatchingInterval(
    idForecast,
    latestActual.start_date
  );

  const d1Peak = getPeak(d1);
  const d2Peak = getPeak(d2);
  const actualPeak = getPeak(realised);
  const actualMinimum = getMinimum(realised);

  setText("actual-demand", formatGw(latestActual.value));
  setText(
    "actual-time",
    `${formatParisTime(latestActual.start_date)}–${formatParisTime(
      latestActual.end_date
    )} Paris time`
  );

  setText(
    "id-forecast",
    matchingId ? formatGw(matchingId.value) : "No match"
  );

  setText(
    "id-comparison",
    matchingId
      ? `Forecast for ${formatParisTime(matchingId.start_date)}–${formatParisTime(
          matchingId.end_date
        )}`
      : "No intraday forecast for the latest actual interval"
  );

  setText("d1-peak", formatGw(d1Peak.value));
  setText(
    "d1-context",
    `${formatParisDate(d1Peak.start_date)} at ${formatParisTime(
      d1Peak.start_date
    )}`
  );

  setText("d2-peak", formatGw(d2Peak.value));
  setText(
    "d2-context",
    `${formatParisDate(d2Peak.start_date)} at ${formatParisTime(
      d2Peak.start_date
    )}`
  );

  setText(
    "actual-interval",
    `${formatParisDateTime(latestActual.start_date)} to ${formatParisTime(
      latestActual.end_date
    )}`
  );

  setText(
    "actual-published",
    formatParisDateTime(latestActual.updated_date)
  );

  setText(
    "actual-peak",
    `${formatGw(actualPeak.value)} at ${formatParisTime(
      actualPeak.start_date
    )}`
  );

  setText(
    "actual-minimum",
    `${formatGw(actualMinimum.value)} at ${formatParisTime(
      actualMinimum.start_date
    )}`
  );

  if (matchingId) {
    const differenceMw =
      Number(latestActual.value) - Number(matchingId.value);

    const differenceElement =
      document.getElementById("forecast-difference");

    const direction =
      differenceMw > 0
        ? "above"
        : differenceMw < 0
          ? "below"
          : "equal to";

    differenceElement.textContent =
      differenceMw === 0
        ? "Actual demand matched the intraday forecast."
        : `Actual demand was ${formatGw(
            Math.abs(differenceMw),
            2
          )} ${direction} the intraday forecast.`;

    differenceElement.classList.remove("positive", "negative");

    if (differenceMw > 0) {
      differenceElement.classList.add("negative");
    } else if (differenceMw < 0) {
      differenceElement.classList.add("positive");
    }
  } else {
    setText(
      "forecast-difference",
      "No matching intraday forecast was available."
    );
  }
}

function toChartData(series) {
  return series.values
    .filter(item => Number.isFinite(Number(item.value)))
    .sort(
      (a, b) =>
        new Date(a.start_date).getTime() -
        new Date(b.start_date).getTime()
    )
    .map(item => [
      new Date(item.start_date).getTime(),
      Number(item.value) / 1000
    ]);
}

function createLineSeries(name, series, colour, options = {}) {
  return {
    name,
    type: "line",
    data: toChartData(series),
    showSymbol: false,
    smooth: options.smooth ?? 0.2,
    connectNulls: false,
    z: options.z ?? 2,
    lineStyle: {
      width: options.width ?? 2.4,
      type: options.lineType ?? "solid",
      color: colour
    },
    itemStyle: {
      color: colour
    },
    emphasis: {
      focus: "series",
      lineStyle: {
        width: (options.width ?? 2.4) + 1.2
      }
    },
    areaStyle: options.area
      ? {
          opacity: 0.08,
          color: colour
        }
      : undefined
  };
}

function renderDemandChart(realised, idForecast, d1, d2) {
  const element = document.getElementById("demand-chart");

  demandChart = echarts.init(element);

  demandChart.setOption({
    animationDuration: 700,
    backgroundColor: "transparent",

    color: [
      SERIES_COLOURS.actual,
      SERIES_COLOURS.id,
      SERIES_COLOURS.d1,
      SERIES_COLOURS.d2
    ],

    grid: {
      top: 70,
      right: 24,
      bottom: 62,
      left: 58,
      containLabel: true
    },

    legend: {
      top: 20,
      left: 8,
      icon: "roundRect",
      itemWidth: 22,
      itemHeight: 3,
      itemGap: 24,
      textStyle: {
        color: "#c3cede",
        fontFamily: "Inter",
        fontSize: 12
      },
      data: [
        "Actual",
        "Intraday",
        "D-1 forecast",
        "D-2 forecast"
      ]
    },

    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(6, 16, 29, 0.96)",
      borderColor: "rgba(148, 163, 184, 0.28)",
      borderWidth: 1,
      padding: 13,
      textStyle: {
        color: "#f7fbff",
        fontFamily: "Inter",
        fontSize: 12
      },
      axisPointer: {
        type: "line",
        lineStyle: {
          color: "rgba(195, 206, 222, 0.35)"
        }
      },
      formatter(parameters) {
        if (!parameters.length) {
          return "";
        }

        const timestamp = parameters[0].value[0];
        const heading = formatParisDateTime(timestamp);

        const rows = parameters
          .map(parameter => {
            const value = Number(parameter.value[1]).toFixed(2);

            return `
              <div style="
                display:flex;
                justify-content:space-between;
                gap:28px;
                margin-top:8px;
              ">
                <span>
                  ${parameter.marker}
                  ${parameter.seriesName}
                </span>
                <strong>${value} GW</strong>
              </div>
            `;
          })
          .join("");

        return `
          <div style="font-weight:700">${heading}</div>
          ${rows}
        `;
      }
    },

    xAxis: {
      type: "time",
      boundaryGap: false,
      axisLine: {
        lineStyle: {
          color: "rgba(148, 163, 184, 0.18)"
        }
      },
      axisTick: {
        show: false
      },
      axisLabel: {
        color: "#8494aa",
        fontFamily: "JetBrains Mono",
        fontSize: 10,
        hideOverlap: true,
        formatter(value) {
          return formatShortDateTime(value);
        }
      },
      splitLine: {
        show: false
      }
    },

    yAxis: {
      type: "value",
      scale: true,
      name: "Demand (GW)",
      nameTextStyle: {
        color: "#8494aa",
        padding: [0, 0, 10, 0],
        fontFamily: "Inter"
      },
      axisLine: {
        show: false
      },
      axisTick: {
        show: false
      },
      axisLabel: {
        color: "#8494aa",
        fontFamily: "JetBrains Mono",
        fontSize: 10,
        formatter: value => `${value.toFixed(0)}`
      },
      splitLine: {
        lineStyle: {
          color: "rgba(148, 163, 184, 0.09)"
        }
      }
    },

    dataZoom: [
      {
        type: "inside",
        filterMode: "none"
      },
      {
        type: "slider",
        bottom: 10,
        height: 22,
        borderColor: "transparent",
        backgroundColor: "rgba(255, 255, 255, 0.025)",
        fillerColor: "rgba(87, 167, 255, 0.12)",
        dataBackground: {
          lineStyle: {
            color: "rgba(132, 148, 170, 0.35)"
          },
          areaStyle: {
            color: "rgba(132, 148, 170, 0.08)"
          }
        },
        selectedDataBackground: {
          lineStyle: {
            color: SERIES_COLOURS.id
          },
          areaStyle: {
            color: "rgba(87, 167, 255, 0.12)"
          }
        },
        handleStyle: {
          color: SERIES_COLOURS.id,
          borderColor: SERIES_COLOURS.id
        },
        textStyle: {
          color: "#8494aa"
        }
      }
    ],

    series: [
      createLineSeries(
        "Actual",
        realised,
        SERIES_COLOURS.actual,
        {
          width: 3.3,
          area: true,
          z: 5
        }
      ),
      createLineSeries(
        "Intraday",
        idForecast,
        SERIES_COLOURS.id,
        {
          width: 2.2,
          lineType: "dashed",
          z: 4
        }
      ),
      createLineSeries(
        "D-1 forecast",
        d1,
        SERIES_COLOURS.d1,
        {
          width: 2.2,
          z: 3
        }
      ),
      createLineSeries(
        "D-2 forecast",
        d2,
        SERIES_COLOURS.d2,
        {
          width: 2.2,
          z: 2
        }
      )
    ]
  });
}

function buildForecastErrorData(realised, idForecast) {
  const idByTime = new Map(
    idForecast.values.map(item => [
      item.start_date,
      Number(item.value)
    ])
  );

  return realised.values
    .filter(item => idByTime.has(item.start_date))
    .sort(
      (a, b) =>
        new Date(a.start_date).getTime() -
        new Date(b.start_date).getTime()
    )
    .map(item => ({
      timestamp: item.start_date,
      difference:
        (Number(item.value) - idByTime.get(item.start_date)) / 1000
    }));
}

function renderErrorChart(realised, idForecast) {
  const element = document.getElementById("error-chart");
  const errorData = buildForecastErrorData(
    realised,
    idForecast
  );

  errorChart = echarts.init(element);

  errorChart.setOption({
    animationDuration: 700,

    grid: {
      top: 28,
      right: 18,
      bottom: 48,
      left: 54,
      containLabel: true
    },

    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(6, 16, 29, 0.96)",
      borderColor: "rgba(148, 163, 184, 0.28)",
      textStyle: {
        color: "#f7fbff",
        fontFamily: "Inter"
      },
      formatter(parameters) {
        const point = parameters[0];
        const value = Number(point.value[1]);

        return `
          <strong>${formatParisDateTime(point.value[0])}</strong>
          <div style="margin-top:7px">
            Actual minus ID:
            <strong>${value > 0 ? "+" : ""}${value.toFixed(2)} GW</strong>
          </div>
        `;
      }
    },

    xAxis: {
      type: "time",
      axisLine: {
        lineStyle: {
          color: "rgba(148, 163, 184, 0.18)"
        }
      },
      axisTick: {
        show: false
      },
      axisLabel: {
        color: "#8494aa",
        fontFamily: "JetBrains Mono",
        fontSize: 10,
        formatter(value) {
          return formatParisTime(value);
        }
      },
      splitLine: {
        show: false
      }
    },

    yAxis: {
      type: "value",
      name: "Difference (GW)",
      nameTextStyle: {
        color: "#8494aa",
        fontFamily: "Inter"
      },
      axisLine: {
        show: false
      },
      axisTick: {
        show: false
      },
      axisLabel: {
        color: "#8494aa",
        fontFamily: "JetBrains Mono",
        fontSize: 10,
        formatter: value => `${value.toFixed(1)}`
      },
      splitLine: {
        lineStyle: {
          color: "rgba(148, 163, 184, 0.09)"
        }
      }
    },

    series: [
      {
        type: "bar",
        barMaxWidth: 11,
        data: errorData.map(item => [
          new Date(item.timestamp).getTime(),
          item.difference
        ]),
        itemStyle: {
          borderRadius: [3, 3, 0, 0],
          color(parameters) {
            return parameters.value[1] >= 0
              ? SERIES_COLOURS.negative
              : SERIES_COLOURS.positive;
          }
        },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: {
            color: "rgba(195, 206, 222, 0.25)",
            width: 1
          },
          data: [
            {
              yAxis: 0
            }
          ]
        }
      }
    ]
  });
}

function csvEscape(value) {
  const text = String(value ?? "");

  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

function downloadCsv() {
  if (!sourceData) {
    return;
  }

  const rows = [];

  sourceData.short_term.forEach(series => {
    series.values.forEach(item => {
      rows.push({
        series: series.type,
        interval_start: item.start_date,
        interval_end: item.end_date,
        published_at: item.updated_date ?? "",
        value_mw: item.value
      });
    });
  });

  rows.sort(
    (a, b) =>
      new Date(a.interval_start).getTime() -
      new Date(b.interval_start).getTime()
  );

  const headings = [
    "series",
    "interval_start",
    "interval_end",
    "published_at",
    "value_mw"
  ];

  const csv = [
    headings.join(","),
    ...rows.map(row =>
      headings
        .map(heading => csvEscape(row[heading]))
        .join(",")
    )
  ].join("\n");

  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8"
  });

  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = downloadUrl;
  link.download = "france-power-demand-latest.csv";

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(downloadUrl);
}

function setLiveStatus() {
  const statusDot = document.getElementById("status-dot");

  statusDot.classList.add("live");
  setText("data-status", "RTE data loaded");
}

function showError(error) {
  console.error("Dashboard error:", error);

  const statusDot = document.getElementById("status-dot");
  const errorBanner = document.getElementById("error-message");

  statusDot.classList.add("error");
  setText("data-status", "Data error");
  errorBanner.hidden = false;
}

async function initialiseDashboard() {
  try {
    const response = await fetch(DATA_URL, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        `Data request failed with HTTP status ${response.status}.`
      );
    }

    sourceData = await response.json();

    if (!Array.isArray(sourceData.short_term)) {
      throw new Error(
        "The RTE response does not contain a short_term array."
      );
    }

    const realised = requireSeries(
      findSeries(sourceData, "REALISED"),
      "REALISED"
    );

    const idForecast = requireSeries(
      findSeries(sourceData, "ID"),
      "ID"
    );

    const d1 = requireSeries(
      findSeries(sourceData, "D-1"),
      "D-1"
    );

    const d2 = requireSeries(
      findSeries(sourceData, "D-2"),
      "D-2"
    );

    updateHeadlineMetrics(
      realised,
      idForecast,
      d1,
      d2
    );

    renderDemandChart(
      realised,
      idForecast,
      d1,
      d2
    );

    renderErrorChart(
      realised,
      idForecast
    );

    setLiveStatus();
  } catch (error) {
    showError(error);
  }
}

document
  .getElementById("download-csv")
  .addEventListener("click", downloadCsv);

window.addEventListener("resize", () => {
  demandChart?.resize();
  errorChart?.resize();
});

initialiseDashboard();
