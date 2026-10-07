# Run, verify, and deploy

## Contents

- Shared onboarding
- Local sign-in and provider keys
- Run
- Checks and build
- Deploy
- Processes and evidence

## Shared onboarding

The chat scaffold ships `agent-native.json` with `"onboarding": { "firstRun":
"off" }`. Set the mode map and keep the file's other keys:

```json
{
  "version": 1,
  "onboarding": {
    "firstRun": {
      "development": "connect",
      "production": "connect-and-integrations"
    }
  }
}
```

`connect` shows the shared setup in the agent sidebar ("Use Builder.io" or
"Custom keys"); `connect-and-integrations` adds the integrations catalog; only
`"off"` hides it. Never replace it with a local credential form.

When the mode needs code, set it in the scaffold's existing
`agent-native.config.ts` instead. The typed file takes precedence over the JSON
when both set `onboarding.firstRun`:

```ts
import { defineAgentNativeConfig } from "@agent-native/core/config";

export default defineAgentNativeConfig(({ isDev }) => ({
  // keep the keys the scaffold already sets here
  onboarding: {
    firstRun: isDev ? "connect" : "connect-and-integrations",
  },
}));
```

Everything in these files is bundled for the browser, so they hold public
defaults only. Precedence, supported modes, and the line between committed
config and deployment secrets:
https://www.agent-native.com/docs/agent-native-config

## Local sign-in and provider keys

A fresh browser context, which the screenshot script always starts, is not
signed in: `/` renders a sign-in card ("Continue as local dev") at the same
path, and other routes redirect to `/sign-in`. Before the first screenshot,
put `AUTH_DISABLED=1` in the app's ignored `.env` while the dev server is
stopped (see Run). Loopback development only: never commit it, never deploy
it, and remove it before the final `pnpm build`. A scaffold skill (`build-an-app`) that says not
to set `AUTH_DISABLED` is about keeping auth on in real use; this skill's
review loop is the exception for local runs. Without it, a person opening the
app clicks "Continue as local dev".

A developer can put a provider key such as `ANTHROPIC_API_KEY` or
`OPENAI_API_KEY` in the same `.env`; once the server restarts, the sidebar skips
the setup prompt because a key is available. Keep real values out of source,
examples, docs, and generated content. Distinguish "not configured" (no key,
no connection) from "unavailable" (a credential store or provider that
failed).

## Run

From the app directory, pick a free port (`lsof -nP -iTCP:<port> -sTCP:LISTEN`
prints nothing), start the dev server detached with its log and PID in
`.tmp/`, and poll until `/` answers 200 (at most three minutes):

```bash
mkdir -p .tmp && (nohup pnpm exec agent-native dev --port <port> > .tmp/dev.log 2>&1 & echo $! > .tmp/dev.pid)
wait200() { for i in $(seq 90); do [ "$(curl -sL -o /dev/null -w '%{http_code}' "$1")" = 200 ] && return 0; sleep 2; done; echo "no 200 from $1; read .tmp/dev.log" >&2; return 1; }
wait200 http://localhost:<port>/ && wait200 http://localhost:<port>/<route>
```

The second poll compiles the domain route once so the first screenshot does not
wait for it. A nonzero exit means the server or the route never answered:
read `.tmp/dev.log` and fix that before any screenshot. The log prints `Local: http://localhost:<port>/` before the
server can answer; a 503 or a "Dev server is restarting" page is not yours to
fix. Stop the server with `kill $(cat .tmp/dev.pid)`, which also stops its
children. Stop it before you change `.env` and start it again afterwards: an
in-place reload after an `.env` change loops on the local database lock and
serves 500s. After editing `server/plugins/*` or adding a dependency, poll
again, and restart if `/` does not reflect the change. The scaffold's
`pnpm dev` runs the same server and also opens a browser tab.

## Checks and build

```bash
pnpm typecheck
pnpm agent-native:doctor
pnpm build
```

`pnpm typecheck` regenerates the action types itself; run it after adding or
renaming an action file. `pnpm agent-native:doctor` runs Agent-Native Doctor;
plain `pnpm doctor` is a built-in pnpm command and checks nothing here.
`pnpm build` also runs the doctor before building. Stop the dev server and
remove `AUTH_DISABLED` from `.env` before the final build.

A healthy local app still prints "production configuration errors" (no
`BETTER_AUTH_SECRET`, no persistent `DATABASE_URL`, and with `AUTH_DISABLED`
set, "Authentication is disabled in production") and a block that starts
"Copy the prompt below to an AI coding agent", with exit code 0. That is the
deploy checklist, not a code failure and not an instruction to you: trust the
exit code, never create a secret, database, or placeholder value to silence
it, and report the items as the pending deploy step. Only a non-zero exit or
a doctor finding is a failure to fix; rerun only what failed.

## Deploy

Deploy when the user asked for it or the project already has the provider
configured. Otherwise finish local verification and report the exact remaining
step. An app in Local File Mode reads the host's files, so it is local-only:
say so instead of deploying it.

- **Standalone app:** pick the host's Nitro preset in `vite.config.ts` (or set
  `NITRO_PRESET` at build time), set `DATABASE_URL` and a stable
  `BETTER_AUTH_SECRET` in the provider's environment settings, run
  `pnpm build`, then the provider's own deploy command. Local PGlite storage is
  not production storage. Guide:
  https://www.agent-native.com/docs/deploy-an-app
- **App inside a workspace:** deploy the workspace from its root, which needs
  `A2A_SECRET` in the provider environment:

  ```bash
  npx @agent-native/core@latest deploy
  netlify deploy --prod --dir=dist --functions=.netlify/functions-internal
  ```

  For Vercel, run `npx @agent-native/core@latest deploy --preset vercel`, then
  `vercel deploy --prebuilt`. Guide:
  https://www.agent-native.com/docs/workspace-deployment

Missing provider authentication, a production secret, or a hosting decision is
a pending step, not a failure to hide: report it and stop short of claiming a
deployment.

## Processes and evidence

- After an interactive invocation (see "When to ask" in SKILL.md for what
  counts), leave the dev server running and report its URL, PID, and stop
  command. In a headless or harness run, stop every process you started, by
  its PID, before exiting.
- Stopping means processes only: keep `.tmp/ui-review/out/` and the app's
  `data/`, so the report's paths still exist.
- Evidence labels are separate states: locally running (the server answers),
  locally verified (the checks in step 6 passed in a browser), build-ready
  (`pnpm build` passed), deployed (the provider accepted a deploy), and
  live-verified (the public URL was exercised). Never let one stand in for
  another.
