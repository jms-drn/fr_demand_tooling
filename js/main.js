// Page shell: tabs, Display menu, What's new and About panels, data status,
// automatic refresh and the Refresh button.

import { CHANGELOG, VERSION } from "./changelog.js";
import { refreshAllCharts } from "./chart.js";
import { CONFIG } from "./config.js";
import { dataVersion, getStatus, parseUtc, setDataVersion, setLiveOverride } from "./data.js";
import { Explorer } from "./explorer.js";
import { PALETTES, apply, settings, updateSettings } from "./settings.js";
import { Today } from "./today.js";
import { el, fmtDateTime, fmtTime, readHash, toast } from "./util.js";

apply();

const loaders = {
  today: async root => new Today(root),
  explorer: async root => new Explorer(root),
  accuracy: async root => new (await import("./accuracy.js")).Accuracy(root),
  outlook: async root => new (await import("./outlook.js")).Outlook(root)
};

const views = {};
let current = null;
let status = null;

async function getView(name) {
  if (!views[name]) {
    views[name] = await loaders[name](document.getElementById(`view-${name}`));
    views[name].setStatus?.(status);
  }
  return views[name];
}

async function switchTab(name, params) {
  if (!loaders[name]) name = "today";
  document.querySelectorAll("[data-view]").forEach(section => section.classList.toggle("hidden", section.dataset.view !== name));
  document.querySelectorAll(".tab").forEach(tab => tab.setAttribute("aria-selected", tab.dataset.tab === name));
  current = name;
  const view = await getView(name);
  if (params && [...params.keys()].length && view.setParams) view.setParams(params);
  view.activate();
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
}

document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => {
  switchTab(tab.dataset.tab);
  tab.blur();
}));

window.addEventListener("hashchange", () => {
  const { tab, params } = readHash();
  if (tab !== current || [...params.keys()].length) switchTab(tab, params);
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
  statusPill.title = `Latest data update: ${fmtDateTime(stamp)} Paris time.${next}${status.last_errors?.length ? `\nLast update problems: ${status.last_errors.join("; ")}` : ""}`;
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
  for (const view of Object.values(views)) view.setStatus?.(status);
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

function setDisplay(patch) {
  updateSettings(patch);
  renderDisplayMenu();
  refreshAllCharts();
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
    <p>All figures come from RTE, the French transmission system operator, through its public consumption API. They cover mainland France, include grid losses and exclude pumping at hydropower plants. Demand is average power over each interval, in MW or GW.</p>
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
    <p class="muted">Methodology, data files and code: <a href="${CONFIG.repoUrl}" target="_blank" rel="noopener">GitHub repository</a>.</p>`;
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
});

// ---------- Start ----------

(async () => {
  await checkForNewData({ rerender: false });
  if (!dataVersion()) setDataVersion(String(Date.now()));
  const { tab, params } = readHash();
  await switchTab(tab, params);
  setInterval(() => checkForNewData(), 2 * 60000);
  setInterval(showStatus, 60000);
})();

export { el };
