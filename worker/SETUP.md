# Setting up the refresh service (Cloudflare Worker)

The refresh service is a small piece of code on Cloudflare's servers. It:

- starts the data update every 15 minutes (GitHub's own scheduler skips many runs);
- gives the site's **Refresh** button the latest RTE data within seconds;
- starts a full archive update when someone presses Refresh, at most once every 5 minutes.

It keeps your RTE and GitHub credentials private: the public website never sees them.

Time needed: about 15 minutes. Everything is free. Cloudflare's menus change from time to time, so a label may differ slightly from what's written here.

---

## Step 1. Create a GitHub access token

This lets the service start the update workflow, and nothing else.

1. On GitHub, click your profile picture → **Settings**.
2. At the bottom of the left menu: **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
3. Fill in:
   - **Token name:** `fr-demand refresh worker`
   - **Expiration:** the longest offered (usually 1 year). Put a reminder in your calendar to renew it.
   - **Repository access:** *Only select repositories* → `jms-drn/fr_power_intel`
   - **Permissions → Repository permissions → Actions:** *Read and write*
     (GitHub adds *Metadata: Read-only* automatically; leave everything else as *No access*.)
4. Click **Generate token** and copy it. GitHub shows it only once, so keep the tab open until Step 3.

## Step 2. Create the Worker

1. Sign up at Cloudflare (free plan) and open the dashboard.
2. In the left menu open **Compute (Workers)** → **Workers & Pages** → **Create** → **Create Worker** (or *Start with Hello World*).
3. Name it `fr-demand-refresh` and click **Deploy**.
4. Click **Edit code**. Delete everything in the editor, paste the whole contents of
   [`worker/worker.js`](worker.js) from this repository, then click **Deploy**.
5. Note the Worker's address, shown near the top. It looks like
   `https://fr-demand-refresh.<your-name>.workers.dev`.

## Step 3. Add the credentials

In the Worker, open **Settings** → **Variables and Secrets** → **Add**. Add three entries, each with type **Secret**:

| Name | Value |
|---|---|
| `RTE_CLIENT_ID` | Your RTE application's client ID (the same value as the GitHub secret of the same name) |
| `RTE_CLIENT_SECRET` | Your RTE application's client secret |
| `GITHUB_TOKEN` | The token from Step 1 |

GitHub doesn't let you view secrets after saving them. If you no longer have the RTE values, find them in your application on the RTE data portal (data.rte-france.com → your account → your applications), where the ID and secret are shown.

Click **Deploy** (or **Save and deploy**) when done.

Optional: if the site ever moves to a different address, add a plain-text variable `ALLOWED_ORIGINS` with that address (for example `https://jms-drn.github.io`).

## Step 4. Schedule it every 15 minutes

In the Worker, open **Settings** → **Trigger events** (or **Triggers**) → **Add** → **Cron Triggers**. Enter:

```
*/15 * * * *
```

and save. (Cloudflare's schedule uses UTC; every 15 minutes is the same in any time zone.)

## Step 5. Check it works

1. Open `https://fr-demand-refresh.<your-name>.workers.dev/` in your browser. You should see
   `{"ok":true,"service":"France Power Demand Intelligence refresh service"}`.
2. Open the same address followed by `/latest`. You should see a long block of RTE data starting `{"live":{"short_term":[`.
   If you see an error mentioning RTE, re-check the two RTE secrets.
3. After 15 minutes, the repository's **Actions** tab should show a new *Update RTE data* run started by *workflow_dispatch*.
   If there's none, re-check the GitHub token's permissions and the cron trigger.

## Step 6. Connect the site

Send Claude the Worker's address, or edit [`js/config.js`](../js/config.js) and set:

```js
workerUrl: "https://fr-demand-refresh.<your-name>.workers.dev",
```

Until this is set, the Refresh button just reloads the latest published data.

---

### Costs and limits

The free Workers plan allows 100,000 requests a day; this service uses a few hundred. Each update run uses about a minute of GitHub Actions time, which is free for public repositories.

### Renewing the GitHub token

When the token expires, updates stop. Create a new token as in Step 1 and replace the `GITHUB_TOKEN` secret in the Worker (Step 3).
