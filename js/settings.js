// Display settings: theme, line colour scheme, line thickness and data-point
// markers. Saved in this browser only.

const KEY = "display";

// Each scheme gives colours for every chart role, for dark and light themes.
// Roles: actual, id, d1, d2, week, ly, avg, band, temp, fcst (forecast
// extension of actual demand).
export const PALETTES = {
  default: {
    name: "Teal (default)",
    dark: { actual: "#2dd4bf", id: "#60a5fa", d1: "#fbbf24", d2: "#c084fc", week: "#f472b6", ly: "#a3e635", avg: "#cbd5e1", band: "rgba(148,163,184,0.22)", temp: "#f87171" },
    light: { actual: "#0d9488", id: "#2563eb", d1: "#d97706", d2: "#9333ea", week: "#db2777", ly: "#65a30d", avg: "#475569", band: "rgba(71,85,105,0.16)", temp: "#dc2626" }
  },
  ocean: {
    name: "Ocean",
    dark: { actual: "#38bdf8", id: "#818cf8", d1: "#f59e0b", d2: "#a78bfa", week: "#fb7185", ly: "#34d399", avg: "#94a3b8", band: "rgba(56,189,248,0.16)", temp: "#fb7185" },
    light: { actual: "#0369a1", id: "#4f46e5", d1: "#b45309", d2: "#7c3aed", week: "#be123c", ly: "#047857", avg: "#64748b", band: "rgba(3,105,161,0.13)", temp: "#be123c" }
  },
  sunset: {
    name: "Sunset",
    dark: { actual: "#fb923c", id: "#f472b6", d1: "#facc15", d2: "#c084fc", week: "#60a5fa", ly: "#4ade80", avg: "#d6d3d1", band: "rgba(251,146,60,0.16)", temp: "#f87171" },
    light: { actual: "#c2410c", id: "#be185d", d1: "#a16207", d2: "#7e22ce", week: "#1d4ed8", ly: "#15803d", avg: "#57534e", band: "rgba(194,65,12,0.12)", temp: "#b91c1c" }
  },
  nordic: {
    name: "Nordic",
    dark: { actual: "#88c0d0", id: "#81a1c1", d1: "#ebcb8b", d2: "#b48ead", week: "#d08770", ly: "#a3be8c", avg: "#d8dee9", band: "rgba(136,192,208,0.16)", temp: "#bf616a" },
    light: { actual: "#2e6f86", id: "#4c6a92", d1: "#a3741c", d2: "#7d5d7a", week: "#a3543a", ly: "#5f7f45", avg: "#4c566a", band: "rgba(46,111,134,0.13)", temp: "#a33d47" }
  },
  vivid: {
    name: "Vivid",
    dark: { actual: "#00e5ff", id: "#448aff", d1: "#ffea00", d2: "#e040fb", week: "#ff5252", ly: "#76ff03", avg: "#e0e0e0", band: "rgba(0,229,255,0.14)", temp: "#ff5252" },
    light: { actual: "#00838f", id: "#1565c0", d1: "#b28704", d2: "#9c27b0", week: "#d32f2f", ly: "#2e7d32", avg: "#424242", band: "rgba(0,131,143,0.12)", temp: "#d32f2f" }
  },
  contrast: {
    name: "High contrast",
    dark: { actual: "#ffffff", id: "#00b0ff", d1: "#ffd600", d2: "#ff4081", week: "#00e676", ly: "#ff9100", avg: "#9e9e9e", band: "rgba(255,255,255,0.18)", temp: "#ff5252" },
    light: { actual: "#000000", id: "#0047b3", d1: "#9a6700", d2: "#c2185b", week: "#00695c", ly: "#d84315", avg: "#616161", band: "rgba(0,0,0,0.14)", temp: "#c62828" },
    width: 1.25
  },
  colourblind: {
    name: "Colourblind-friendly",
    // Okabe–Ito palette, plus dash patterns so series differ by more than colour.
    dark: { actual: "#56b4e9", id: "#009e73", d1: "#e69f00", d2: "#cc79a7", week: "#d55e00", ly: "#f0e442", avg: "#bbbbbb", band: "rgba(86,180,233,0.16)", temp: "#d55e00" },
    light: { actual: "#0072b2", id: "#009e73", d1: "#e69f00", d2: "#cc79a7", week: "#d55e00", ly: "#000000", avg: "#777777", band: "rgba(0,114,178,0.13)", temp: "#d55e00" },
    dashes: { id: [6, 4], d2: [10, 3, 2, 3], week: [2, 3], ly: [12, 4], avg: [6, 4] }
  }
};

export const THICKNESS = { thin: 0.7, normal: 1, thick: 1.5 };

const defaults = { theme: "dark", palette: "default", thickness: "normal", markers: false };

let current = load();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    const legacyTheme = localStorage.getItem("theme");
    return { ...defaults, ...(legacyTheme ? { theme: legacyTheme } : {}), ...saved };
  } catch (error) {
    return { ...defaults };
  }
}

export function settings() {
  return current;
}

export function updateSettings(patch) {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch (error) { /* private mode */ }
  apply();
}

/** Line width multiplier for the chosen thickness and scheme. */
export function widthScale() {
  return (THICKNESS[current.thickness] || 1) * (PALETTES[current.palette]?.width || 1);
}

export function dashFor(role) {
  return PALETTES[current.palette]?.dashes?.[role] || null;
}

/** Write the theme and colour scheme onto the page as CSS variables. */
export function apply() {
  const root = document.documentElement;
  root.dataset.theme = current.theme === "light" ? "light" : "dark";
  const palette = PALETTES[current.palette] || PALETTES.default;
  const colours = palette[root.dataset.theme];
  for (const [role, colour] of Object.entries(colours)) root.style.setProperty(`--s-${role}`, colour);
  root.style.setProperty("--s-fcst", colours.actual);
}
