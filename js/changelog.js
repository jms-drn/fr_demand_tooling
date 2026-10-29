// Version history shown in the "What's new" panel. Newest first.

export const VERSION = "2.0";

export const CHANGELOG = [
  {
    version: "2.0",
    date: "29 Oct 2026",
    title: "Forecast-extended Explorer, rankings and a polished interface",
    sections: [
      {
        heading: "Explorer",
        items: [
          "Periods can now run past today to the end of RTE's week-ahead forecast (around 9 days ahead). Days so far show actual demand; the rest show RTE's best available forecast (intraday, then D-1, then D-2, then week-ahead) as a dashed line. Comparisons with earlier years cover the whole period.",
          "A projection card shows where the period is heading, e.g. the expected average for the whole month against the same dates in earlier years.",
          "New ranking chart: the same period in every year since 2013, with this year highlighted and its rank (e.g. \"3rd lowest of 14 years\").",
          "New difference view: show the gap to the earlier-years average or to last year, in % or GW, instead of absolute values.",
          "Optional event markers on charts: Covid-19 lockdowns, the February 2018 cold snap, the nuclear stress corrosion crisis, Russia's invasion of Ukraine and the 2022 energy sobriety plan.",
          "Copy button next to each headline sentence, ready to paste into copy."
        ]
      },
      {
        heading: "Charts",
        items: [
          "Time axes now tick at Paris midnight and round hours.",
          "Overview strip under the main charts shows where you are zoomed within the full period; drag its handles to move or resize the window.",
          "PNG exports now include a footer with the source (RTE), the site name and the export time, so charts can go straight into articles.",
          "New \"Copy\" button puts a chart image on your clipboard.",
          "Lines now break where data is missing instead of joining across the gap (this caused the flat D-2 line on the Today tab).",
          "Loading placeholders while data arrives."
        ]
      },
      {
        heading: "Display menu",
        items: [
          "Seven line colour schemes: Teal (default), Ocean, Sunset, Nordic, Vivid, High contrast and Colour-blind safe. The colour-blind scheme uses the Okabe–Ito palette and adds dash patterns so series differ by more than colour.",
          "Line thickness (thin, normal, thick) and an option to show markers on each data point.",
          "Light and dark mode moved into the same menu. All choices are remembered in your browser."
        ]
      },
      {
        heading: "Today",
        items: ["Actual demand is now a bold line drawn on top of the forecasts, rather than a shaded area."]
      },
      {
        heading: "Forecast accuracy",
        items: [
          "New chart showing the distribution of daily errors for the selected forecast and measure.",
          "Marker from 26 Oct 2026 on D-1 charts: from that date the site records the D-1 version published the day before.",
          "Event markers on the error-over-time chart."
        ]
      },
      {
        heading: "Outlook",
        items: [
          "Reorganised into two sections, \"Next 10 days\" and \"The year\", with a short guide to reading the tab.",
          "Timeline showing which forecast covers which day: intraday today, D-1 tomorrow, D-2 the day after, week-ahead for days 3 to 9.",
          "The annual chart now compares like with like: RTE's forecast weekly minimum–maximum range against the actual weekly minimum and peak. The actual weekly average is optional, and the forecast weekly average only appears for years when RTE published it (2015–16).",
          "The supply margin chart now shows RTE's year-ahead margin for every year since 2015, one bar per year. RTE publishes a single figure per year, so the old weekly view repeated the same value."
        ]
      },
      {
        heading: "Data and updates",
        items: [
          "Updates every 15 minutes through a dedicated scheduler, plus a Refresh button that fetches the latest RTE data in seconds.",
          "The page checks for new data every two minutes and reloads it automatically.",
          "All files on screen now always come from the same data update."
        ]
      },
      {
        heading: "Site",
        items: [
          "This What's new panel and an About the data panel with a glossary and methodology.",
          "Site icon in the browser tab and a preview card when the link is shared in Teams, Slack or email.",
          "Each tab now opens with a one-line description; fixed a stray line that could appear beside the selected tab."
        ]
      }
    ]
  },
  {
    version: "1.2",
    date: "27 Oct 2026",
    title: "More reliable data updates",
    sections: [
      {
        heading: "Data and updates",
        items: [
          "Automatic updates scheduled every 30 minutes instead of hourly, because GitHub skips many scheduled runs.",
          "Re-running an update from GitHub is now safe: each run starts from the latest data rather than the version it was first queued with.",
          "If two updates clash, the later one refreshes and fetches the data again instead of failing."
        ]
      }
    ]
  },
  {
    version: "1.1",
    date: "26 Oct 2026",
    title: "Four-tab dashboard with history since 2012",
    sections: [
      {
        heading: "Data",
        items: [
          "Archive of actual demand, D-1 and D-2 forecasts every 15 or 30 minutes from 17 Dec 2012, every week-ahead forecast published since then, and RTE's annual forecasts from 2015.",
          "Automatic hourly updates that also re-check the past 7 days, so later corrections by RTE are picked up.",
          "Data cleaning: RTE's corrupt D-1 values for 2–14 Oct 2019 (around 0.7 GW) are excluded, and daily energy is calculated so that missing quarter-hours don't understate it."
        ]
      },
      {
        heading: "Tabs",
        items: [
          "Today: actual demand against intraday, D-1 and D-2 forecasts, with same-weekday comparisons from earlier years.",
          "Explorer: any period at 15-minute, hourly, daily, weekly or monthly resolution; average, peak, minimum or energy; comparisons with last year, the average of the previous 2–5 years and their min–max range; alignment by calendar date or weekday; public holidays marked or excluded; average daily (diurnal) profile view.",
          "Forecast accuracy: D-1, D-2 and week-ahead (3–9 days) errors as MAPE, MAE and bias, over time, by lead time, weekday, hour and season, plus the biggest misses.",
          "Outlook: the next 10 days, week-ahead peaks with RTE's temperature assumptions, and RTE's annual forecast and supply margin."
        ]
      },
      {
        heading: "Charts",
        items: [
          "Hover for values, click and drag to zoom, legend showing each series' average for the period in view.",
          "PNG and CSV export of every chart, data tables, and shareable links that keep your settings.",
          "Light and dark mode."
        ]
      }
    ]
  },
  {
    version: "1.0",
    date: "23 Oct 2026",
    title: "First live page",
    sections: [
      {
        heading: "Features",
        items: [
          "Latest day of actual French demand against RTE's intraday, D-1 and D-2 forecasts.",
          "Headline figures: latest demand, forecast peaks and the day's peak and minimum.",
          "Chart of actual minus intraday forecast, and CSV download of the latest data."
        ]
      }
    ]
  }
];
