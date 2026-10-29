// France Power Demand Intelligence — refresh service (Cloudflare Worker).
//
// What it does:
//  1. Every 15 minutes (Cron Trigger), it starts the GitHub workflow that
//     fetches RTE data and updates the archive. GitHub's own scheduler skips
//     many runs, so this keeps the site current.
//  2. POST /refresh (the site's Refresh button) returns the latest RTE data
//     straight away and, at most once every 5 minutes, starts the workflow
//     so the full archive catches up.
//  3. GET /latest returns the latest RTE data only.
//
// Secrets (Settings → Variables and Secrets in the Cloudflare dashboard):
//   RTE_CLIENT_ID, RTE_CLIENT_SECRET  – the same values as the GitHub secrets
//   GITHUB_TOKEN                       – fine-grained token, Actions: read and write,
//                                        for jms-drn/fr_demand_tooling only
// Variable (optional):
//   ALLOWED_ORIGINS – comma-separated sites allowed to call this service,
//                     default https://jms-drn.github.io

const REPO = "jms-drn/fr_demand_tooling";
const WORKFLOW = "update-rte.yml";
const RTE = "https://digital.iservices.rte-france.com";
const LIVE_TTL_MS = 2 * 60 * 1000;        // reuse the live RTE response for 2 minutes
const REFRESH_GAP_MS = 5 * 60 * 1000;     // Refresh starts an update at most every 5 minutes
const ACTIVE = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);

// Kept between requests while this copy of the worker stays warm.
let rteToken = null;
let liveCache = null;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(maybeDispatch(env, 0).then(result => console.log("scheduled run:", JSON.stringify(result))));
  },

  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const { pathname } = new URL(request.url);
    try {
      if (pathname === "/latest" && request.method === "GET") {
        return json({ live: await live(env) }, cors);
      }
      if (pathname === "/refresh" && request.method === "POST") {
        const [liveData, run] = await Promise.all([
          live(env),
          maybeDispatch(env, REFRESH_GAP_MS).catch(error => ({ dispatched: false, reason: String(error.message || error) }))
        ]);
        return json({ live: liveData, dispatched: run.dispatched, reason: run.reason }, cors);
      }
      if (pathname === "/") return json({ ok: true, service: "France Power Demand Intelligence refresh service" }, cors);
      return json({ error: "Not found" }, cors, 404);
    } catch (error) {
      return json({ error: String(error.message || error) }, cors, 502);
    }
  }
};

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || "https://jms-drn.github.io").split(",").map(s => s.trim()).filter(Boolean);
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
  if (origin && allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(body, headers, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

// ---------- RTE ----------

async function rteAccessToken(env, force = false) {
  if (!force && rteToken && Date.now() < rteToken.expires) return rteToken.value;
  const response = await fetch(`${RTE}/token/oauth/`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${env.RTE_CLIENT_ID}:${env.RTE_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded"
    }
  });
  if (!response.ok) throw new Error(`RTE token request failed (HTTP ${response.status})`);
  const body = await response.json();
  if (!body.access_token) throw new Error("RTE did not return an access token");
  rteToken = { value: body.access_token, expires: Date.now() + Math.max((body.expires_in || 3600) - 120, 60) * 1000 };
  return rteToken.value;
}

async function live(env) {
  if (liveCache && Date.now() - liveCache.at < LIVE_TTL_MS) return liveCache.data;
  let token = await rteAccessToken(env);
  let response = await fetch(`${RTE}/open_api/consumption/v1/short_term`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });
  if (response.status === 401) {
    token = await rteAccessToken(env, true);
    response = await fetch(`${RTE}/open_api/consumption/v1/short_term`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    });
  }
  if (!response.ok) throw new Error(`RTE data request failed (HTTP ${response.status})`);
  const data = await response.json();
  if (!Array.isArray(data.short_term)) throw new Error("Unexpected response from RTE");
  liveCache = { at: Date.now(), data };
  return data;
}

// ---------- GitHub ----------

function github(env, path, init = {}) {
  return fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "fr-demand-refresh-worker",
      ...(init.body ? { "Content-Type": "application/json" } : {})
    }
  });
}

/**
 * Start the update workflow unless one is already queued or running, or one
 * was started less than `gapMs` ago.
 */
async function maybeDispatch(env, gapMs) {
  const runs = await github(env, `/actions/workflows/${WORKFLOW}/runs?per_page=5`);
  if (!runs.ok) throw new Error(`GitHub run list failed (HTTP ${runs.status})`);
  const { workflow_runs: list = [] } = await runs.json();

  if (list.some(run => ACTIVE.has(run.status))) return { dispatched: false, reason: "an update is already running" };
  const latest = list[0] ? Date.parse(list[0].created_at) : 0;
  if (gapMs && Date.now() - latest < gapMs) return { dispatched: false, reason: "an update ran in the last few minutes" };

  const response = await github(env, `/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: "main" })
  });
  if (response.status !== 204) throw new Error(`GitHub dispatch failed (HTTP ${response.status})`);
  return { dispatched: true };
}
