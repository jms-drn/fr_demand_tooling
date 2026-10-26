// Tabs, theme, status and URL routing.

import { refreshAllThemes } from "./chart.js";
import { getStatus } from "./data.js";
import { Explorer } from "./explorer.js";
import { Today } from "./today.js";
import { fmtDateTime, readHash } from "./util.js";

const loaders = {
  today: async root => new Today(root),
  explorer: async root => new Explorer(root),
  accuracy: async root => new (await import("./accuracy.js")).Accuracy(root),
  outlook: async root => new (await import("./outlook.js")).Outlook(root)
};

const views = {};
let current = null;

async function getView(name) {
  if (!views[name]) views[name] = await loaders[name](document.getElementById(`view-${name}`));
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
  // Charts created while hidden need a resize once visible.
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
}

document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));

// Links that set a hash (e.g. "open in Explorer") route through here.
window.addEventListener("hashchange", () => {
  const { tab, params } = readHash();
  if (tab !== current || [...params.keys()].length) switchTab(tab, params);
});

const themeButton = document.getElementById("theme-toggle");
const labelTheme = () => { themeButton.textContent = document.documentElement.dataset.theme === "light" ? "Dark mode" : "Light mode"; };
labelTheme();

themeButton.addEventListener("click", () => {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
  try { localStorage.setItem("theme", root.dataset.theme); } catch (error) { /* private mode */ }
  labelTheme();
  refreshAllThemes();
});

async function showStatus() {
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");
  try {
    const status = await getStatus();
    const stamp = status.last_live_update_utc || status.generated_utc;
    const ms = Date.parse(stamp.replace("Z", ":00Z"));
    const ageHours = (Date.now() - ms) / 3600000;
    dot.className = `status-dot ${ageHours < 3 ? "live" : ""}`;
    text.textContent = `Updated ${fmtDateTime(ms)}`;
    if (status.last_errors?.length) {
      dot.className = "status-dot error";
      text.title = status.last_errors.join("\n");
    }
  } catch (error) {
    dot.className = "status-dot error";
    text.textContent = "Status unavailable";
  }
}

const { tab, params } = readHash();
switchTab(tab, params);
showStatus();
setInterval(showStatus, 10 * 60 * 1000);
