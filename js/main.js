// Site shell: sidebar pages, per-page tabs and titles, Display menu, What's
// new and About panels, data status, automatic refresh and the Refresh button.

import { CHANGELOG, VERSION } from "./changelog.js";
import { refreshAllCharts, setExportBrand } from "./chart.js";
import { CONFIG } from "./config.js";
import { dataVersion, getStatus, parseUtc, setDataVersion, setLiveOverride } from "./data.js";
import { PALETTES, apply, settings, updateSettings } from "./settings.js";
import { el, fmtDateTime, fmtTime, readHash, toast, writeHash } from "./util.js";

apply();

// Each page: header title (the part after "France Power"), tabs and loaders.
const PAGES = {
  overview: {
    accent: "Intelligence", doc: "France Power Intelligence",
    tabs: { main: { label: "Overview", load: async root => new (await import("./overview.js")).Overview(root) } }
  },
  demand: {
    accent: "Demand Intelligence", doc: "France Power Demand Intelligence",
    tabs: {
      today: { label: "Today", load: async root => new (await import("./today.js")).Today(root) },
      explorer: { label: "Explorer", load: async root => new (await import("./explorer.js")).Explorer(root) },
      accuracy: { label: "Forecast accuracy", load: async root => new (await import("./accuracy.js")).Accuracy(root) },
      outlook: { label: "Outlook", load: async root => new (await import("./outlook.js")).Outlook(root) }
    }
  },
  nuclear: {
    accent: "Unavailability Intelligence", doc: "France Power Unavailability Intelligence",
    tabs: {
      today: { label: "Today", load: async root => new (await import("./nuclear-today.js")).NuclearToday(root) },
      explorer: { label: "Explorer", load: async root => new (await import("./nuclear-explorer.js")).NuclearExplorer(root) },
      outages: { label: "Outages", load: async root => new (await import("./nuclear-outages.js")).NuclearOutages(root) },
      outlook: { label: "Outlook", load: async root => new (await import("./nuclear-outlook.js")).NuclearOutlook(root) }
    }
  },
  hydro: {
    accent: "Hydro Intelligence", doc: "France Power Hydro Intelligence",
    tabs: { main: { label: "Reservoirs", load: async root => new (await import("./hydro.js")).Hydro(root) } }
  }
};

const viewsRoot = document.getElementById("views");
const footer = viewsRoot.querySelector("footer");
const tabsEl = document.getElementById("tabs");
const titleEl = document.getElementById("page-title");
const views = {};
let current = null; // "page/tab"
let status = null;

function sectionFor(page, tab) {
  const id = `view-${page}-${tab}`;
  let section = document.getElementById(id);
  if (!section) {
    section = el("section", { id, "data-view": `${page}/${tab}`, class: "hidden" });
    viewsRoot.insertBefore(section, footer);
  }
  return section;
}

async function getView(key) {
  if (!views[key]) {
    const [page, tab] = key.split("/");
    views[key] = PAGES[page].tabs[tab].load(sectionFor(page, tab)).then(view => {
      view.setStatus?.(status);
      return view;
    });
  }
  return views[key];
}

function renderChrome(page, tab) {
  const config = PAGES[page];
  titleEl.innerHTML = `France Power <em>${config.accent}</em>`;
  document.title = tab && Object.keys(config.tabs).length > 1 ? `${config.tabs[tab].label} · ${config.doc}` : config.doc;
  setExportBrand(`${config.doc} by jms-drn`);
  document.querySelectorAll(".side-link[data-page]").forEach(link => {
    link.classList.toggle("active", link.dataset.page === page);
    if (link.dataset.page === page) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  });
  const names = Object.keys(config.tabs);
  tabsEl.hidden = names.length < 2;
  tabsEl.innerHTML = names.length < 2 ? "" : names.map(name =>
    `<button class="tab" role="tab" data-tab="${name}" aria-selected="${name === tab}">${config.tabs[name].label}</button>`).join("");
  document.body.dataset.page = page;
}

async function navigate(page, tab, params) {
  if (!PAGES[page]) page = "overview";
  const tabs = Object.keys(PAGES[page].tabs);
  if (!tabs.includes(tab)) tab = tabs[0];
  const key = `${page}/${tab}`;
  const pageChanged = !current || current.split("/")[0] !== page;
  renderChrome(page, tab);
  document.querySelectorAll("[data-view]").forEach(section => section.classList.toggle("hidden", section.dataset.view !== key));
  sectionFor(page, tab).classList.remove("hidden");
  current = key;
  closeSidebar();
  if (pageChanged) window.scrollTo({ top: 0 });
  const view = await getView(key);
  if (current !== key) return;
  if (params && [...params.keys()].length && view.setParams) view.setParams(params);
  if (!view.writesHash) writeHash(tabs.length > 1 ? key : page, params);
  view.activate();
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
}

tabsEl.addEventListener("click", event => {
  const tab = event.target.closest(".tab");
  if (!tab) return;
  const page = current.split("/")[0];
  navigate(page, tab.dataset.tab);
  tab.blur();
});

window.addEventListener("hashchange", () => {
  const { page, tab, params } = readHash();
  const key = `${page}/${tab}`;
  if (key !== current || [...params.keys()].length) navigate(page, tab, params);
});

// ---------- Sidebar ----------

const sidebar = document.getElementById("sidebar");
const scrim = document.querySelector(".sidebar-scrim");

function openSidebar() {
  sidebar.classList.add("open");
  scrim.hidden = false;
}

function closeSidebar() {
  sidebar.classList.remove("open");
  scrim.hidden = true;
}

document.getElementById("menu-button").addEventListener("click", openSidebar);
scrim.addEventListener("click", closeSidebar);
document.getElementById("collapse").addEventListener("click", () => {
  const collapsed = document.documentElement.dataset.sidebar !== "collapsed";
  if (collapsed) document.documentElement.dataset.sidebar = "collapsed";
  else delete document.documentElement.dataset.sidebar;
  try { localStorage.setItem("sidebar", collapsed ? "collapsed" : "open"); } catch (error) { /* private mode */ }
  setTimeout(() => window.dispatchEvent(new Event("resize")), 220);
});

// ---------- Data status and refresh ----------

const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const statusPill = document.getElementById("status-pill");
const refreshButton = document.getElementById("refresh");

function showStatus() {
  if (!status) return;
  const stamp = parseUtc(status.last_live_update_utc || status.generated_utc);
  const ageMinutes = (Date.now() - stamp) / 60000;
  statusDot.className = `status-dot ${ageMinutes < 90 ? "live" : ageMinutes < 360 ? "" : "error"}`;
  statusText.textContent = `Updated ${fmtTime(stamp)}`;
  const next = CONFIG.workerUrl ? ` New data is fetched every ${CONFIG.updateEveryMinutes} minutes.` : "";
  const problems = [...(status.last_errors || []), ...(status.power?.errors || [])];
  statusPill.title = `Latest data update: ${fmtDateTime(stamp)} Paris time.${next}${problems.length ? `\nLast update problems: ${problems.join("; ")}` : ""}`;
}

/** Re-read status.json; if there is a newer data update, reload the current view. */
async function checkForNewData({ rerender = true } = {}) {
  try {
    status = await getStatus();
  } catch (error) {
    statusDot.className = "status-dot error";
    statusText.textContent = "Status unavailable";
    return false;
  }
  const changed = setDataVersion(status.generated_utc);
  for (const view of Object.values(views)) (await view).setStatus?.(status);
  showStatus();
  if (changed && rerender && current) (await getView(current)).activate();
  return changed;
}

let pollTimer = null;

/** After triggering an update, look for it every 20 seconds for up to 5 minutes. */
function watchForUpdate() {
  clearInterval(pollTimer);
  const started = Date.now();
  pollTimer = setInterval(async () => {
    const changed = await checkForNewData();
    if (changed) toast("New data loaded");
    if (changed || Date.now() - started > 5 * 60000) clearInterval(pollTimer);
  }, 20000);
}

refreshButton.addEventListener("click", async () => {
  refreshButton.disabled = true;
  refreshButton.classList.add("spinning");
  try {
    if (CONFIG.workerUrl) {
      const response = await fetch(`${CONFIG.workerUrl.replace(/\/$/, "")}/refresh`, { method: "POST" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (body.live) setLiveOverride(body.live);
      const changed = await checkForNewData({ rerender: false });
      (await getView(current)).activate();
      toast(body.dispatched
        ? "Latest RTE data loaded. The full archive update is running and will appear in a few minutes."
        : changed ? "New data loaded" : "Latest RTE data loaded");
      watchForUpdate();
    } else {
      const changed = await checkForNewData();
      toast(changed ? "New data loaded" : `You have the latest published data (${statusText.textContent.toLowerCase()}).`);
    }
  } catch (error) {
    console.error(error);
    await checkForNewData();
    toast("Couldn't reach the refresh service, so the latest published data is shown.", { error: true });
  } finally {
    refreshButton.disabled = false;
    refreshButton.classList.remove("spinning");
  }
});

// ---------- Display menu ----------

const displayButton = document.getElementById("display-button");
const displayMenu = document.getElementById("display-menu");

function swatches(palette, theme) {
  const c = palette[theme];
  return ["actual", "d1", "id", "d2", "ly"].map(r => `<i style="background:${c[r]}"></i>`).join("");
}

function renderDisplayMenu() {
  const s = settings();
  const theme = document.documentElement.dataset.theme;
  const seg = (key, options) => `<div class="segmented" role="group">${options.map(([value, label]) =>
    `<button type="button" data-set="${key}" data-value="${value}" aria-pressed="${String(s[key]) === value}">${label}</button>`).join("")}</div>`;

  displayMenu.innerHTML = `
    <div class="menu-section"><div class="menu-label">Theme</div>${seg("theme", [["dark", "Dark"], ["light", "Light"]])}</div>
    <div class="menu-section"><div class="menu-label">Line colours</div>
      <div class="palette-list">${Object.entries(PALETTES).map(([key, p]) => `
        <button type="button" class="palette${s.palette === key ? " selected" : ""}" data-set="palette" data-value="${key}" aria-pressed="${s.palette === key}">
          <span class="swatches">${swatches(p, theme)}</span><span>${p.name}</span>
        </button>`).join("")}
      </div>
    </div>
    <div class="menu-section"><div class="menu-label">Line thickness</div>${seg("thickness", [["thin", "Thin"], ["normal", "Normal"], ["thick", "Thick"]])}</div>
    <div class="menu-section"><label class="check"><input type="checkbox" data-set="markers" ${s.markers ? "checked" : ""}> Show a marker on each data point</label></div>`;
}

async function setDisplay(patch) {
  updateSettings(patch);
  renderDisplayMenu();
  refreshAllCharts();
  if (current && current.split("/")[0] !== "demand") (await getView(current)).refreshTheme?.();
}

displayMenu.addEventListener("click", event => {
  event.stopPropagation(); // the menu redraws itself; don't treat this as an outside click
  const button = event.target.closest("button[data-set]");
  if (button) setDisplay({ [button.dataset.set]: button.dataset.value });
});
displayMenu.addEventListener("change", event => {
  if (event.target.matches('input[data-set="markers"]')) setDisplay({ markers: event.target.checked });
});

function toggleMenu(open) {
  const show = open ?? displayMenu.hidden;
  displayMenu.hidden = !show;
  displayButton.setAttribute("aria-expanded", show);
  if (show) renderDisplayMenu();
}

displayButton.addEventListener("click", event => { event.stopPropagation(); toggleMenu(); });
document.addEventListener("click", event => {
  if (!displayMenu.hidden && !displayMenu.contains(event.target)) toggleMenu(false);
});

// ---------- Drawers: What's new, About ----------

const drawer = document.getElementById("drawer");
const backdrop = document.querySelector(".drawer-backdrop");
const whatsNewButton = document.getElementById("whats-new");
const newDot = whatsNewButton.querySelector(".new-dot");

function seenVersion() {
  try { return localStorage.getItem("seenVersion"); } catch (error) { return VERSION; }
}

newDot.hidden = seenVersion() === VERSION;
document.querySelector("[data-version]").textContent = VERSION;

function whatsNewHtml() {
  return CHANGELOG.map(v => `
    <section class="release">
      <div class="release-head"><span class="release-tag">v${v.version}</span><span class="muted">${v.date}</span></div>
      <h3>${v.title}</h3>
      ${v.sections.map(sec => `<h4>${sec.heading}</h4><ul>${sec.items.map(i => `<li>${i}</li>`).join("")}</ul>`).join("")}
    </section>`).join("");
}

function aboutHtml() {
  const term = (t, d) => `<dt>${t}</dt><dd>${d}</dd>`;
  return `
    <p>All figures come from RTE, the French transmission system operator, through its public APIs: consumption, actual generation and unavailability (REMIT notices). They cover mainland France. Times are Paris time.</p>
    <h3>Demand</h3>
    <p>Demand includes grid losses and excludes pumping at hydropower plants. It is average power over each interval, in MW or GW.</p>
    <h4>Forecasts</h4>
    <dl class="glossary">
      ${term("Actual", "Measured demand (RTE calls it \"realised\"), every 15 minutes.")}
      ${term("Intraday", "RTE's forecast for today, revised through the day.")}
      ${term("D-1", "Day-ahead forecast, made the day before (published around 19:30 Paris time).")}
      ${term("D-2", "Forecast made two days before (published around 07:00).")}
      ${term("Week-ahead", "Forecasts for 3 to 9 days ahead, published on weekdays, with the expected daily peak and RTE's temperature assumption.")}
      ${term("Annual forecast", "RTE's forecast for each week of the next year: a demand range and the expected supply margin.")}
      ${term("Lead time", "How far ahead a forecast was made.")}
    </dl>
    <h4>Accuracy measures</h4>
    <dl class="glossary">
      ${term("Error", "Forecast minus actual. Positive means RTE expected more demand than happened. Forecasts are compared every half-hour.")}
      ${term("MAE", "Mean absolute error: the average size of the miss in GW, ignoring direction.")}
      ${term("MAPE", "Mean absolute percentage error: the same, as a share of demand. Best for comparing seasons.")}
      ${term("Bias", "Average error keeping its sign: shows whether RTE tends to over- or under-forecast.")}
      ${term("Peak error", "Forecast daily maximum minus actual daily maximum.")}
    </dl>
    <h4>Comparisons</h4>
    <dl class="glossary">
      ${term("Calendar date", "Compares the same dates in earlier years (1–29 Oct with 1–29 Oct).")}
      ${term("Weekday", "Compares each day with the same weekday 52 weeks (364 days) earlier, so weekends line up.")}
      ${term("Like-for-like", "Percentage comparisons only use the days and times available this year, so a month to date is compared with the same days.")}
      ${term("Min–max range", "The band between the lowest and highest earlier year at each point.")}
      ${term("Daily profile", "The average shape of a day across the selected period, e.g. the typical October day.")}
      ${term("Forecast ahead", "In the Explorer, periods can run past today: after the last actual value the line continues with RTE's best available forecast.")}
    </dl>
    <h4>Data notes</h4>
    <ul>
      <li>History runs from 17 Dec 2012. The data updates automatically during the day.</li>
      <li>RTE time-stamps historical D-1 forecasts after the day they cover, so values before 26 Oct 2026 can't be confirmed as the versions published the day before. From that date the site records the version published in advance.</li>
      <li>RTE's D-1 data for 2–14 Oct 2019 contains corrupt values (around 0.7 GW) and is excluded.</li>
      <li>Clock-change days have 23 or 25 hours; daily figures account for this.</li>
    </ul>
    <h3 style="margin-top:22px">Nuclear availability</h3>
    <p>EDF publishes a notice for every planned or unplanned reduction in a reactor's available capacity, and a new version whenever it changes. The site stores every version since December 2010.</p>
    <dl class="glossary">
      ${term("Available capacity", "Installed capacity minus the unavailable capacity in the notices covering that moment. Where notices overlap on one reactor, the largest reduction counts (they are not added up).")}
      ${term("Planned / unplanned", "As declared by EDF: planned outages (refuelling, maintenance, ten-yearly inspections) are announced in advance; unplanned ones (failures, other incidents) are not. Modulation to follow demand is not an outage.")}
      ${term("Offline / reduced", "Offline means below 10% of the reactor's capacity; reduced means below 90%.")}
      ${term("Output", "Measured nuclear generation from RTE's actual generation data, hourly (fleet since 15 Dec 2014; per reactor for the past week).")}
      ${term("Load factor", "Output divided by installed capacity.")}
      ${term("Outlook as of a date", "The availability implied by the latest version of each notice published by the end of that day (Paris time), for each of the next 540 days. Comparing outlooks from different dates shows how expectations moved.")}
      ${term("First announced end", "The end date in the first version of a notice. The change against it shows extensions and early returns.")}
    </dl>
    <ul>
      <li>Fessenheim 1 and 2 leave the fleet when they closed (22 Feb and 30 Jun 2020); Flamanville 3 joins at its first grid connection (21 Dec 2024). EDF filed Fessenheim's closure as an outage to 2099 and later cancelled it, so closures come from the site's own reactor list.</li>
      <li>Notices before 2015, when the EU's REMIT transparency rules took full effect, may be less complete.</li>
      <li>Outlooks only contain outages already announced, so they are usually above what happens.</li>
    </ul>
    <h3 style="margin-top:22px">Hydro reservoirs</h3>
    <p>RTE's weekly figure for the energy stored in the hydro reservoirs it monitors, in MWh (shown as TWh), since December 2014. Weeks are compared by ISO week number.</p>
    <p class="muted">Map outline: Natural Earth (public domain). Methodology, data files and code: <a href="${CONFIG.repoUrl}" target="_blank" rel="noopener">GitHub repository</a>.</p>`;
}

function openDrawer(kind) {
  const title = drawer.querySelector("#drawer-title");
  const body = drawer.querySelector(".drawer-body");
  if (kind === "whatsnew") {
    title.textContent = "What's new";
    body.innerHTML = whatsNewHtml();
    try { localStorage.setItem("seenVersion", VERSION); } catch (error) { /* private mode */ }
    newDot.hidden = true;
  } else {
    title.textContent = "About the data";
    body.innerHTML = aboutHtml();
  }
  drawer.hidden = false;
  backdrop.hidden = false;
  requestAnimationFrame(() => { drawer.classList.add("open"); backdrop.classList.add("open"); });
  drawer.querySelector("[data-close]").focus();
}

function closeDrawer() {
  drawer.classList.remove("open");
  backdrop.classList.remove("open");
  setTimeout(() => { drawer.hidden = true; backdrop.hidden = true; }, 200);
}

whatsNewButton.addEventListener("click", () => openDrawer("whatsnew"));
document.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", () => openDrawer(b.dataset.open)));
drawer.querySelector("[data-close]").addEventListener("click", closeDrawer);
backdrop.addEventListener("click", closeDrawer);
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (!drawer.hidden) closeDrawer();
  if (!displayMenu.hidden) toggleMenu(false);
  closeSidebar();
});

// ---------- Start ----------

(async () => {
  await checkForNewData({ rerender: false });
  if (!dataVersion()) setDataVersion(String(Date.now()));
  const { page, tab, params } = readHash();
  await navigate(page, tab, params);
  setInterval(() => checkForNewData(), 2 * 60000);
  setInterval(showStatus, 60000);
})();

export { el };
