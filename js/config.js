// Site settings.
//
// workerUrl: address of the Cloudflare Worker that schedules updates and
// powers the Refresh button (see worker/SETUP.md). Leave empty to make the
// Refresh button only reload the latest published data.

export const CONFIG = {
  workerUrl: "",
  siteUrl: "https://jms-drn.github.io/fr_demand_tooling/",
  githubProfile: "https://github.com/jms-drn",
  repoUrl: "https://github.com/jms-drn/fr_demand_tooling",
  updateEveryMinutes: 15
};
