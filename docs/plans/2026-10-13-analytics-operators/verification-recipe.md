# Analytics local verification recipe (isolated worktree)

Proven end to end on 2026-10-13 against clean `origin/main` at `4715962a57`, macOS arm64,
default `node` v26.7.0 (Homebrew), pnpm 10.29.1, `@playwright/test` 1.63.0 (browsers already cached;
nothing installed). Every command below runs from inside YOUR worktree. `W` = your worktree root.

Pick one port per agent in 42000-42019 and use it everywhere (examples use 42003).

## 1. Setup

```bash
W=/path/to/your/worktree        # absolute
PORT=42003
cd "$W"
mkdir -p .tmp/verify/shots
pnpm install --frozen-lockfile --prefer-offline      # ~150 s; postinstall already builds core + toolkit + friends
pnpm --filter @agent-native/core build               # ~10 s after install (incremental). Re-run after editing packages/core
```

No `.env` is needed. Do not copy one from another checkout.

## 2. Start the dev server (own port, own PGlite DB)

```bash
cd "$W/templates/analytics"
DATABASE_URL=pglite:./data/pglite nohup pnpm exec agent-native dev \
  --port $PORT --strictPort --host 127.0.0.1 > "$W/.tmp/verify/dev.log" 2>&1 &
# wait for readiness (first boot ~55 s: runs ~1000 core migrations into the fresh DB)
for i in $(seq 1 120); do curl -s -o /dev/null --max-time 2 http://127.0.0.1:$PORT/ && break; sleep 1; done
```

- The DB is `templates/analytics/data/pglite`, relative to the cwd, so each worktree gets its own. It is gitignored.
- `--port` and `--strictPort` go straight to Vite (the plugin's default is 8080). `--strictPort` fails loudly instead of
  silently moving to another port. Use `--host 127.0.0.1`, because the dev auto-login only works for loopback requests.
- The server writes `templates/analytics/.agent-native/dev-server.json` (origin, pid, DB key, a dev action token).
  `pnpm action` uses this file to forward calls to the server. Never print or copy the token.

## 3. Sign in (no credentials)

Core has a loopback-only dev sign-in. It creates a throwaway `dev@local.test` account with a random password
that is never logged. It only works while the DB has no user other than `dev@local.test`, so never sign up
other users in this DB. It is NOT `AUTH_DISABLED`. Don't set that, and don't set `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT`.

- `GET  /_agent-native/auth/local-dev` returns `{"available":true}` when it can be used.
- `POST /_agent-native/auth/local-dev` sets the session cookie. Restarts reuse the same account (`created:false`).

curl form (for HTTP action calls):

```bash
J="$W/.tmp/verify/cookies.txt"
curl -s -c $J -b $J -X POST -H 'content-type: application/json' -d '{}' \
  http://127.0.0.1:$PORT/_agent-native/auth/local-dev -o /dev/null -w "signin %{http_code}\n"   # expect 200
```

## 4. Demo data (no real providers)

`ensure-demo-dashboards` installs a private "Demo Node Exporter Full" dashboard for the signed-in user.
`app/root.tsx` also calls it on every app load. Its panels use `source: "demo"`, which queries the public
demo Prometheus at `https://prometheus.agent-native.foo`. That needs outbound network but no credentials.
You can point it somewhere else with `ANALYTICS_DEMO_PROMETHEUS_URL`. The dashboard id is per user
(`demo-node-exporter-<hash>`), so read `path` from the action result instead of hardcoding it.

```bash
curl -s -b $J -X POST -H 'content-type: application/json' -d '{}' \
  http://127.0.0.1:$PORT/_agent-native/actions/ensure-demo-dashboards
# -> {"dashboards":[{"id":"demo-node-exporter","dashboardId":"demo-node-exporter-1a255422",
#     "path":"/dashboards/demo-node-exporter-1a255422?tab=App+%2F+Overview",...}],"defaultDashboardPath":...}
```

## 5. Playwright smoke: sign in, demo dashboard, Ask, screenshots

Save as `$W/.tmp/verify/smoke.mjs` (in gitignored `.tmp/`). Run it from `$W`:
`node .tmp/verify/smoke.mjs http://127.0.0.1:$PORT .tmp/verify/shots`

```js
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(path.resolve("package.json"));       // repo root @playwright/test 1.63.0
const { chromium } = require("@playwright/test");

const BASE = process.argv[2] ?? "http://127.0.0.1:42003";
const OUT = path.resolve(process.argv[3] ?? ".tmp/verify/shots");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
// The first SSR of each route on a cold Vite server takes 30-60 s, longer than Playwright's 30 s default.
page.setDefaultNavigationTimeout(180_000);
page.setDefaultTimeout(60_000);
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text().slice(0, 300)}`));
page.on("response", (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()} ${r.url()}`));

try {
  // Sign in: context.request shares cookies with `page`.
  const login = await context.request.post(`${BASE}/_agent-native/auth/local-dev`, { data: {} });
  if (!login.ok()) throw new Error(`local-dev sign-in failed: ${login.status()} ${await login.text()}`);
  const session = await (await context.request.get(`${BASE}/_agent-native/auth/session`)).json();
  console.log("signed in as", session.email);                       // dev@local.test. Never log session.token

  const ensure = await context.request.post(`${BASE}/_agent-native/actions/ensure-demo-dashboards`, { data: {} });
  const dashPath = (await ensure.json())?.dashboards?.[0]?.path;
  if (!dashPath) throw new Error("no demo dashboard path returned");

  await page.goto(`${BASE}${dashPath}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {});
  const charts = await page
    .waitForFunction(() => document.querySelectorAll("svg.recharts-surface").length >= 2, null, { timeout: 90_000 })
    .then(() => page.locator("svg.recharts-surface").count())
    .catch(() => 0);
  console.log("dashboard charts rendered:", charts);                 // 0 means it is stuck on skeletons (see pitfalls)
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: `${OUT}/dashboard.png` });

  await page.goto(`${BASE}/ask`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: `${OUT}/ask.png` });
} finally {
  console.log(`problems (${problems.length}):\n  ` + [...new Set(problems)].slice(0, 40).join("\n  "));
  await browser.close();
}
```

When warm, the expected output is `signed in as dev@local.test`, `dashboard charts rendered: 2` (or more),
and `problems (0)`. The dashboard screenshot shows Request Latency, Chaos Mode and Active Workload Phase with
live data. Ask (`/ask`) shows "What should we explore?" with a "Connect AI" banner, because no LLM provider is
configured. Do not add real provider keys to send a message.

## 6. Call an action directly

CLI (forwarded to the running server, so it uses the same DB and runs as `dev@local.test`). It must run from
`templates/analytics`:

```bash
cd "$W/templates/analytics"
pnpm action list-sql-dashboards                       # -> [{ id: 'demo-node-exporter-…', ownerEmail: 'dev@local.test', … }]
pnpm -s action query-dashboard-panel '{"source":"demo","query":{"promql":"up","mode":"instant"}}'
pnpm action ensure-demo-dashboards --reset true       # flags form; booleans are coerced
```

HTTP (with the cookie jar from step 3). GET-flagged reads accept GET, and everything accepts POST with a JSON body:

```bash
curl -s -b $J http://127.0.0.1:$PORT/_agent-native/actions/list-sql-dashboards
curl -s -b $J -X POST -H 'content-type: application/json' \
  -d '{"source":"demo","query":{"promql":"up","mode":"instant"}}' \
  http://127.0.0.1:$PORT/_agent-native/actions/query-dashboard-panel
# with no cookie: 401 {"error":"Unauthorized","hint":"No valid session cookie reached the dev server ..."}
```

## 7. Stop everything

```bash
pkill -TERM -f "agent-native.js dev --port $PORT"     # the supervisor forwards SIGTERM to Vite and exits
for i in $(seq 1 15); do lsof -nP -tiTCP:$PORT -sTCP:LISTEN >/dev/null || break; sleep 1; done
lsof -nP -iTCP:42000-42019 -sTCP:LISTEN               # must print nothing for YOUR port
pgrep -fl "port $PORT"                                # must print nothing
```

Playwright closes its browser in `finally`. Only kill processes you started. Other agents' headless shells
(for example `chromium_headless_shell-1228` started by someone else's script) are not yours.

## 8. Baseline checks on clean main

| Check | Command (from `$W`) | Result on main | Time / peak RSS |
|---|---|---|---|
| Analytics typecheck | `pnpm --filter analytics typecheck` | PASS (0 TS errors). Needs `.generated/*`, which the dev server writes on boot, so start dev once first | 25 s / 1.9 GB |
| Analytics vitest (full) | `pnpm --filter analytics exec vitest --run` | **FAIL**: 3 of 4943 tests, 2 of 330 files (details below) | 485 s wall / 1.56 GB largest process |
| i18n catalogs | `pnpm guard:i18n-catalogs` | PASS ("checked 19 catalog directories") | 77 s while vitest ran in parallel (expect less alone) / 0.37 GB |
| i18n changed copy | `pnpm guard:i18n-changed-copy` | PASS ("checked 0 changed copy surfaces") | 4 s / 0.2 GB |
| All guards | `pnpm guards` | PASS ("All 89 checks passed"). Expected warnings: 6 template version-drift warnings, 4 agent-chat-context soft-limit warnings, and test-title-production SKIPPED outside PR events | 152 s / 1.29 GB |

Pre-existing vitest failures (on unmodified main):

1. `app/components/layout/Sidebar.spec.ts` › Sidebar visibility helpers › "defaults dashboard visibility to all when
   nothing is stored" and "persists and restores dashboard visibility choices". **Node 26 only**:
   ```
   TypeError: Cannot read properties of undefined (reading 'removeItem')
    ❯ app/components/layout/Sidebar.spec.ts:33:25   window.localStorage.removeItem(...)
   TypeError: Cannot read properties of undefined (reading 'getItem')
    ❯ app/components/layout/Sidebar.spec.ts:43:32
   ```
   It passes 10/10 under Node 22 (CI uses `node-version: "22"`):
   `cd templates/analytics && PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" node ./node_modules/vitest/vitest.mjs --run app/components/layout/Sidebar.spec.ts`
2. `server/lib/first-party-analytics.spec.ts` › scopedAnalyticsSql › "returns the same scoped event rows for the
   legacy union and single scan". The failure is `Error: Test timed out in 30000ms.` (PGlite `memory://`, line 1217).
   It is **load-dependent**: it passes when run alone (`pnpm exec vitest --run server/lib/first-party-analytics.spec.ts`).

Treat these three as baseline unless your change touches those files. Prefer running only the specs you touched:
`cd templates/analytics && pnpm exec vitest --run <files>` (about 30 s for two files).

## 9. Pitfalls hit and fixes

- **Cold first navigation exceeds 30 s.** The first SSR of `/dashboards/:id` took 33.8 s, which failed `page.goto`
  with a timeout. Fix: `setDefaultNavigationTimeout(180_000)` (included above).
- **The first browser load after boot hits Vite dependency re-optimization.** You get many
  `HTTP 504 /node_modules/.vite/deps/*.js (Outdated Optimize Dep)`, the framework's recovery reload appends
  `__an_vite_dev_recovery=` to the URL, and the dashboard screenshot shows only skeletons
  (`charts rendered: 0`). You may also see a console warning, `demo dashboard install failed ... Failed to fetch`.
  Fix: run the smoke a second time. The second run on the same server rendered charts with 0 problems.
  For a single-shot script, add one warm-up `page.goto` of the dashboard and wait for it before the real pass.
- **The demo source needs outbound HTTPS** to `prometheus.agent-native.foo`. Without network, panels error but
  sign-in, Ask and actions still work.
- **The demo panel `query` must be a descriptor object**, `{"promql":"…","mode":"instant"|"range","range":"1h"}`.
  A bare string like `"up"` returns HTTP 500 `{"error":"Internal server error"}`. The real message
  (`demo Prometheus panel sql must be a JSON object`) appears only in `dev.log`.
- **Auto sign-in turns off permanently for a DB once any other user exists.** If you see a sign-in page or
  `{"available":false,"reason":"existing-user"}`, stop the server, delete only your worktree's
  `templates/analytics/data/pglite`, and restart. Don't create accounts.
- **CLI forwarding conditions.** Forwarding requires a live server pid, a loopback origin, and a matching DB key in
  `.agent-native/dev-server.json`. Don't export a different `DATABASE_URL` or `ANALYTICS_DATABASE_URL` in the
  shell where you run `pnpm action`. Without a running server, the CLI runs in-process and binds to the single
  session owner in the DB. That path was not exercised here.
- **The worktree-isolation hook in Claude Code refuses compound shell constructs.** This includes
  `$(( … ))` arithmetic, and `/usr/bin/time -l` inside `( … ; … )` subshells. Run timing as plain sequential
  commands (`date +%s` before and after, or `/usr/bin/time -l <cmd> > log 2>&1; echo "exit $?"`).
- **`guard:i18n-changed-copy` uses `git diff <merge-base>`.** That covers staged and unstaged changes to tracked
  files, but new untracked files are invisible until you `git add` them (or `git add -N`). Run it after staging.
- **Expected `pnpm` noise.** The `[WARN] The "pnpm" field in package.json is no longer read` and
  `DEP0205 module.register()` lines show up on every command and don't matter.
