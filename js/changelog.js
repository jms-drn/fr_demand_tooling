// Version history shown in the "What's new" panel. Newest first.

export const VERSION = "3.1";

export const CHANGELOG = [
  {
    version: "3.1",
    date: "29 Oct 2026",
    title: "Unavailability first, hydro fill levels and a cleaner nuclear Today page",
    sections: [
      {
        heading: "Nuclear availability: Today",
        items: [
          "Tiles regrouped into three labelled rows: Availability, Output and Reactors. New tiles for average output today and over the last 7 days (each against the same hours last year), the share of available capacity actually used, and reactors modulating (online but producing under 80% of their available capacity). \"Running below capacity\" is now \"Partially available\", meaning notices that take out only part of a reactor.",
          "New map colours: planned outages red, unplanned outages red-and-yellow striped, partial availability amber. Time offline and time until return now run from yellow (shortest) through orange to deep crimson (6 months or more).",
          "The list of reactors not at full capacity can be sorted by return date, time offline, most recent or size.",
          "The availability chart has Past (week to a year, or custom) and Next (none to three months) choices, and now shows the 5-year average and range. Longer windows switch to daily averages.",
          "The output heat map runs red (0%) through amber (50%) to green (100%), or a blue-to-yellow scale with the colourblind-friendly palette.",
          "Notice changes can be sorted by clicking any column heading, and a \"Delays only\" switch shows just the notices that pushed a return date back."
        ]
      },
      {
        heading: "Explorer and Outlook",
        items: [
          "Both now open on unavailability, with a switch to change to availability. The Explorer adds an unavailability rate (% of installed capacity).",
          "Outlook lines follow one rule, shown above the chart: colour shows the year, solid is what the notices said at the time, dashed is this year's outlook at an earlier date, dotted is what actually happened. Names read e.g. \"Nov 2025: expected on 29 Oct 2025\".",
          "New 5-year average of the outlook at the same point ahead, and of what happened, for the same period. The expected split between planned and unplanned unavailability is now stored and shown."
        ]
      },
      {
        heading: "Hydro reserves",
        items: [
          "New \"Measure in\" switch: stored energy (TWh) or fill level (% of RTE's 3,591 GWh capacity). In fill level, every comparison is in percentage points, on the cards and the charts.",
          "The headline adds the recent trend: the change over the past four weeks against the usual change at this time of year, and whether the gap to the average is widening or narrowing."
        ]
      },
      {
        heading: "General",
        items: [
          "The nuclear page is now France Power Nuclear Availability Intelligence. The colour-blind palette is renamed Colourblind-friendly.",
          "The site has a new address to match its name: jms-drn.github.io/fr_power_intel/.",
          "Prices (day-ahead spot prices for France and neighbouring markets) added to the sidebar and Overview as coming soon. Softer colours on the reactor output heat map."
        ]
      }
    ]
  },
  {
    version: "3.0",
    date: "29 Oct 2026",
    title: "France Power Intelligence: nuclear availability, hydro reservoirs and a new layout",
    sections: [
      {
        heading: "New layout",
        items: [
          "The site is now France Power Intelligence, with a sidebar for its pages: Overview, Demand, Nuclear availability and Hydro reserves (Generation is coming). Each page keeps its own tabs and header. The sidebar can be collapsed to icons, and opens from the menu button on phones.",
          "New Overview page: the latest demand, nuclear availability and reservoir level, each against earlier years with a trend line, and a list of main points you can copy in one go.",
          "Old links to the demand tabs still work."
        ]
      },
      {
        heading: "Nuclear availability: Today",
        items: [
          "Available capacity now, output in the latest hour, reactors offline (planned and unplanned) and running below capacity, against the same hour last year and the five-year average for today.",
          "Map of France with every reactor, sized by capacity. Colour them by status, by how long they have been offline, or by how long until they are due back. Hover for each reactor's notices, including how far the return date has moved since first announced.",
          "List of reactors not at full capacity with a progress bar from the start of the stoppage to its expected end; click one to see its outage history.",
          "Available capacity over the past 7 days and the next 14, against the same dates last year; output by reactor over the past week as a heat map; and every notice changed in the past 72 hours (new outages, delays, early returns, cancellations), downloadable."
        ]
      },
      {
        heading: "Nuclear availability: Explorer, Outages, Outlook",
        items: [
          "Explorer: available or unavailable capacity (split into planned and unplanned), availability rate, output, load factor or reactors offline for any period since 2011, hourly to monthly, for the whole fleet or one site or reactor series. Compare with last year, the average and range of up to 10 earlier years, run the period into the months ahead using the current notices, and rank it against every year.",
          "Outages: every outage as a timeline per reactor and a sortable table, filtered by window, type, length, size (by default at least a quarter of the reactor), status (ongoing, not started, ended, overran, ended early), how long a reactor has been offline so far, site or text, with a one-click “Show all outages” switch. The red part of each bar shows an overrun beyond the end date first announced; the headline gives the share of planned outages that overran and by how much on average.",
          "Outlook: expected availability for any period up to 18 months ahead, compared with the outlook a week or a month earlier, on the same date in up to three earlier years, or as of any date you pick — e.g. November as seen today against November 2025 as seen on the same date last year — and with what actually happened. A second chart shows how the outlook for the period has moved, and a third compares the outlook and the outcome at the same lead time in every year."
        ]
      },
      {
        heading: "Hydro reserves",
        items: [
          "Weekly energy stored in hydro reservoirs since December 2014, against last year, the average and range of earlier years or every year, by calendar or hydro year (October start), with a difference view, a ranking of the week across years and the full history."
        ]
      },
      {
        heading: "Data",
        items: [
          "Every version of every nuclear outage notice since December 2010, nuclear output since December 2014 and reservoir levels since December 2014 are now stored and updated with the demand data. Image exports name the page they come from, and the preview image for shared links is updated."
        ]
      }
    ]
  },
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
