# Neon ↔ Netlify integration — per-deploy DB branches

Each hosted template runs `drizzle-kit push --force` during its Netlify build
(see every `templates/*/netlify.toml`). Without deploy-context-aware DB URLs,
that means **preview deploys mutate the prod database** — a fresh PR with a
schema change will `ALTER` prod before the PR is even reviewed.

The Netlify↔Neon extension solves this. On every deploy it creates a
copy-on-write Neon branch from the prod branch, injects the branch's
connection string as `NETLIFY_DATABASE_URL` into that deploy's env, and
deletes the branch when the deploy is cleaned up. Production deploys on
`main` keep using the prod branch.

## What's already done (config)

Every template's `netlify.toml` build command now starts with:

```
export DATABASE_URL=${NETLIFY_DATABASE_URL:-$DATABASE_URL} && ...
```

That's the whole mapping. If the Netlify↔Neon extension is installed and the
site is linked, Netlify injects `NETLIFY_DATABASE_URL` per deploy context
(prod branch for prod, preview branch for previews) and the shell expansion
overrides `DATABASE_URL` with it before `pnpm install`, `drizzle-kit push`,
and the Nitro build all read it. If the extension is not installed, the
fallback leaves the existing `DATABASE_URL` untouched.

`@agent-native/core` stays provider-agnostic — it only ever reads
`DATABASE_URL`. The Netlify-specific convention lives in each template's
`netlify.toml`, not in framework code.

## What has to be done in the Netlify UI (one-time per team + per site)

### 1. Install the Neon extension (team-wide, once)

1. <https://app.netlify.com/teams/steve-sewell/extensions>
2. Search **Neon** → **Install**
3. Authorize against the existing Neon account (the one that owns
   `agent-native-*` Neon projects)

Confirm with `cd /tmp && netlify db status` — it should print
`Neon extension: installed on team`.

### 2. Per-site: claim the existing Neon project and enable branching

For each of the 8 sites below, from the Netlify site dashboard:

1. **Project configuration → Database** (or **Extensions → Neon**)
2. **Connect existing Neon project** → pick the matching project (names will
   line up: `agent-native-forms` site ↔ `agent-native-forms` Neon project,
   etc.)
3. Set the **production branch** to `main` (or whatever the Neon prod branch
   is called for that project — usually `main`).
4. Enable **Create a branch per deploy preview**. Leave branch-naming and
   TTL at defaults.

After step 4 Netlify writes `NETLIFY_DATABASE_URL` and
`NETLIFY_DATABASE_URL_UNPOOLED` into every deploy's env. Preview deploys get
a per-deploy branch URL; prod deploys get the prod-branch URL.

### 3. Do NOT remove the existing `DATABASE_URL`

Leave the existing `DATABASE_URL` env var in place as a belt-and-suspenders
fallback for any tooling that still reads it directly (drizzle CLI outside
the build, local `pnpm action`, etc.). `NETLIFY_DATABASE_URL` wins when
present, so the integration still takes over on Netlify deploys.

## Sites to configure

| Template  | Netlify site           | Neon project           |
| --------- | ---------------------- | ---------------------- |
| forms     | agent-native-forms     | agent-native-forms     |
| calendar  | agent-native-calendar  | agent-native-calendar  |
| clips     | agent-native-clips     | agent-native-clips     |
| content   | agent-native-content   | agent-native-content   |
| slides    | agent-native-slides    | agent-native-slides    |
| videos    | agent-native-videos    | agent-native-videos    |
| analytics | agent-native-analytics | agent-native-analytics |
| mail      | agent-native-mail      | agent-native-mail      |

(Add `scheduling`, `issues`, `recruiting`, `dispatch`, `macros` if/when they
start using Neon. Today they either use SQLite locally or haven't shipped.)

## Verification

After enabling on one site (pilot with `forms` or `videos` — small data):

1. Open a throwaway PR that adds a no-op column: e.g. add
   `test_column text` to a table, commit, push.
2. Wait for the Netlify preview deploy to finish building.
3. Inspect the deploy's function env — `NETLIFY_DATABASE_URL` should be set
   to a branch-specific URL (it'll contain a branch identifier, not `main`).
4. Connect to the prod Neon branch directly (via Neon console) and confirm
   `test_column` is **not** present — the preview build pushed it to the
   preview branch, not prod.
5. Close the PR without merging. Netlify tears down the preview deploy; Neon
   deletes the branch. Prod is untouched throughout.

Once verified on the pilot, roll out to the remaining sites.

## Follow-ups (not done yet)

- **Committed migrations for prod.** `drizzle-kit push --force` on `main`
  still auto-approves destructive statements. Once we have a first rename or
  drop to ship, move the prod branch's build to `drizzle-kit migrate` against
  generated migration files and leave `push` only for previews. Until then,
  follow the additive-only schema rule in `CLAUDE.md`.
- **Preview-only actions.** Actions that mutate data (e.g. `delete-form`,
  `publish-recording`) run against whatever branch the deploy points at.
  That's fine — a preview branch is disposable. But if we ever add actions
  that reach outside the DB (send email, charge a card, post to Slack),
  they need their own preview-vs-prod gating.
