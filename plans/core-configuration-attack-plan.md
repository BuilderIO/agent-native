# Core configuration — attack plan

Date: 2026-08-12
Scope: `packages/core`. Rationale and evidence live in
`plans/core-configuration-consolidation.md`; this file is the execution order.

## Decisions (locked)

|                  |                                                                         |
| ---------------- | ----------------------------------------------------------------------- |
| **Precedence**   | per-request → plugin options → `agent-native.config.ts` → env → default |
| **Breadth**      | six named domains (~90 keys), then on-touch for the rest                |
| **Deprecation**  | per domain, in the same PR as the migration                             |
| **First domain** | private blob storage                                                    |

Env sits below app code. Safe because nothing above env sets these keys today,
so env still wins every lookup until someone deliberately adds a higher layer.

## The rule this is all for

**Consumer code in core never reads `process.env`.** Exactly four resolvers do,
and each already exists or is created in step 2:

| Resolver                                                      | Covers                                                          |
| ------------------------------------------------------------- | --------------------------------------------------------------- |
| The config env layer — one startup pass over `.meta({ env })` | the 225 behavior keys                                           |
| `resolveDeployEnvironment()`                                  | the 14 platform facts (`NODE_ENV`, `NETLIFY`, `AWS_*`)          |
| `readDeployCredentialEnv()`                                   | the 48 secrets, as deployment fallback inside scoped resolution |
| `getAmbientUserEmail()` / `getAmbientOrgId()`                 | CLI identity when there is no request context                   |

Not "never": the bottom three are not configuration. Platform variables are facts
about the runtime that nobody sets in an app config; credentials resolve per
user or org with env as one layer; ambient identity exists only for CLI runs and
already warns when it fires in a process serving HTTP.

**Caveat — bootstrap.** Anything that must run before the config layer
initializes cannot call `getConfig()`. That is what the module-scope audit in
step 2 is for.

This generalizes a rule the repo already has for credentials — "one resolver per
credential key, and every runtime path goes through it" — to all configuration,
and replaces the prescribed grep with a schema lookup.

## Definition of done, per domain

Every migration PR ships all six:

- [ ] Fields added to `configSchema` with `.meta({ env, doc })`
- [ ] All call sites read via `getConfig()` — no `process.env` left
- [ ] Old path marked `@deprecated` with "Use `X` instead"
- [ ] Row added to the deprecation register below
- [ ] Antipattern rule added to the `configuration` skill if it is a new shape
- [ ] Tests: explicit value wins, env still works, deprecated path still works
- [ ] The chains the field replaces are **deleted**, not left running beside it

A domain is not done until its previous entry point is deprecated.

That last box is the one most likely to be skipped, because adding a field is
additive and safe while removing a fallback chain requires deciding which of
several disagreeing orders was correct. Skipping it is how a consolidation
becomes mechanism number eleven: the schema gains a field, every old reader
keeps its own ladder, and the only measurable change is one more place to look.
Step 4 is the worked example — nine chains in, three declared fields out.

---

## Progress

Steps 1–10 landed on 2026-08-13 (6, 7, 8, and 9 partly — see below). Deviations from the plan as written, each
deliberate:

- **`src/app-config/`, not `src/config/`.** `src/config.ts` already exists and
  backs the `./config` package export (the client-visible `AgentNativeConfig`).
  A `config/` directory beside it would collide on that specifier.
- **`getAppConfig()`, not `getConfig()`.** Pairs with `defineAppConfig` and
  cannot be misread as the client config's `getAgentNativeConfig`.
- **Domains wrap in `.prefault({})`, not `.optional()`.** Verified against zod
  4: an optional domain never materializes the defaults declared inside it, and
  `.default({})` returns the literal `{}` without parsing it. Both hand the
  reader `undefined` where the output type promises a value — the lying-type
  failure this repo's flagship rule is about. `.prefault` runs the domain schema
  over the empty object.
- **The skill is repo-only, not in `DEFAULT_WORKSPACE_SKILLS`.** It is
  `scope: dev` guidance about `packages/core` internals, in the same category as
  `writing-agent-instructions` and `extension-points`, neither of which syncs.
  Revisit at step 5/6, when the agent and email domains give an app author
  something to configure — today `defineAppConfig` has one domain.

- **App identity is three fields, not one.** The plan said seven chains collapse
  to `app.id`. Reading the code changed that: `vault_grants` rows are written
  with the workspace-assigned id, so `credential-provider` preferring
  `workspaceId` is load-bearing rather than an inconsistency to delete, and
  `getAppName()` is a _display name_ ("Acme on Forms") that the plan wrongly
  called a fourth identity resolver. Collapsing them into one field would have
  silently repointed credential grant lookups. Shipped as `app.id`,
  `app.workspaceId`, `app.name`, plus `app.packageName` and `app.template` for
  the tails that were also reading raw env.
- **The env layer rebuilds each read, and the parse is cached behind a
  signature.** Caching the env read outright meant whichever code path ran
  first froze configuration for the process — it broke two existing specs that
  mutate `process.env` per test, which is exactly the stale-value-nobody-can-see
  failure this module exists to remove. Fixing the design beat annotating the
  specs.

`config-sprawl` is now a measured pattern key in `agent-friction-report.mjs`.
Baseline on the day it landed: **6 over 8 weeks, 4 over the last 2** — but 3 of
those 4 are this session's own framing, so the honest read is a low single-digit
signal that was never counted while core grew to 301 keys, not a spike. The
number to watch is whether it stays flat as domains migrate; a rising count
means declaring a field is still more expensive than reaching for `process.env`,
and step 9 is the missing half.

## Step 1 — `configuration` skill — done

No code. Unblocks review and stops the count growing while the rest is built.

- Write `.agents/skills/configuration/SKILL.md`: the ladder, where each kind of
  value goes (server schema / `agent-native.config.ts` / env), the merge-rule
  test, and the antipattern rules.
- Add to `workspaceSkillIncludes` in `scripts/sync-workspace-core-skills.ts`,
  then `pnpm sync:workspace-skills`.
- One invariant line in CLAUDE.md pointing at it.

**Merge-rule test**, the thing the skill exists to make routine:

> Registries accumulate — every source's entries coexist.
> Config overrides — the highest layer wins.
> If a module has `getActive*()` or "first wins", it is config, not a registry.

## Step 2 — The config schema — done

Additive. Nothing changes behavior, so it ships alone and reverts cleanly.

- One file per domain under `packages/core/src/config/`, composed by a thin
  `schema.ts`. Keeps each file small and makes a domain migration a one-file
  addition plus a one-line edit:

  ```
  packages/core/src/config/
    schema.ts        — composes the domains, nothing else
    email.ts         — emailConfig
    private-blob.ts  — privateBlobConfig
    agent.ts         — agentConfig
    a2a.ts           — a2aConfig
  ```

  ```ts
  // schema.ts
  export const configSchema = z.object({
    email: emailConfig.optional(),
    privateBlob: privateBlobConfig.optional(),
    agent: agentConfig.optional(),
  });
  ```

  `.meta({ env, doc })` on each field, in the domain file. One `config/`
  directory rather than colocating each schema next to its consumer, because
  "what can I configure?" should be answerable with `ls`.

  Use `import type` when a domain schema needs a type from the module that reads
  it (`EmailRenderer` from the email template), so the import is erased and no
  runtime cycle forms.

- `export type AppConfigInput = z.input<typeof configSchema>` for the setter and
  `AppConfig = z.output<...>` for reads. The `.default()` input/output split
  matters; without it, defaulted fields are wrongly required at the call site.
- `defineAppConfig(c: AppConfigInput): void` — validates via `configSchema.parse`
  and stores. `getConfig(): AppConfig` — returns the resolved object.
- Startup pass that walks the schema's `.meta({ env })`, builds a partial config
  from `process.env`, and merges it underneath the app config.

No `setting()` primitive, no token registry, no codegen, no `.d.ts`
augmentation. Zod already is the schema, the type, the validator, and the
metadata carrier. Verified against zod 4 in core: closures survive `.parse()`,
defaults apply, bad values throw at the boundary, and `.meta()` is readable at
runtime.

- Audit the 75 module-scope `process.env` reads and list the ones on runtime
  paths — each must become lazy before its key can migrate.
- Decide whether `registerRequiredSecret` folds into the schema as function-typed
  fields or stays as-is.
- Changeset required.

## Step 3 — Private blob storage — done

First domain. Fixes a live defect rather than adding a seam.

Today `putPrivateBlob` resolves one knob through two mechanisms, with precedence
decided by statement order:

```ts
if (!publicUploadFallbackRef.enabled) return null;
if (process.env.AGENT_NATIVE_PRIVATE_BLOB_PUBLIC_UPLOAD_FALLBACK === "0")
  return null;
```

- Add `privateBlob.provider` (selector) and `privateBlob.publicUploadFallback`
  (boolean, env alias `AGENT_NATIVE_PRIVATE_BLOB_PUBLIC_UPLOAD_FALLBACK`) to the schema.
- `getActivePrivateBlobProvider()` honors the selector, falling back to today's
  first-configured rule when unset — no existing deployment changes behavior.
- Deprecate `setPrivateBlobPublicUploadFallbackEnabled`.
- The registry itself is untouched. This step proves the additive path.

## Step 4 — App identity — done

Promoted ahead of `engine`/`model` on 2026-08-13. `AGENT_NATIVE_APP_ID` is one
string with **seven readers and seven different fallback chains**, so it is the
sharpest instance of the defect class in core — and unlike step 5 it needs no
parsing and no plugin-option reconciliation.

| Reader                      | Chain                                                                   | Default                |
| --------------------------- | ----------------------------------------------------------------------- | ---------------------- |
| `agent-chat-plugin.ts:3866` | `options.appId` → `AGENT_NATIVE_APP_ID` → `VITE_AGENT_NATIVE_TEMPLATE`  | `"app"`                |
| `identity-sso.ts:137`       | `AGENT_NATIVE_APP_ID` → `…WORKSPACE_APP_ID` → `getAppName()` → hostname | `"app"`                |
| `credential-provider.ts:63` | `…WORKSPACE_APP_ID` → `VITE_…` → `AGENT_NATIVE_APP_ID` → `APP_NAME`     | **denied**             |
| `run-code-tools.ts:65`      | `AGENT_NATIVE_APP_ID` → `APP_ID` → `APP_NAME`                           | `"app"`                |
| `cli/agent.ts:214`          | `AGENT_NATIVE_APP_ID` → `APP_ID`                                        | `"app"`                |
| `default-steps.ts:364`      | `AGENT_NATIVE_APP_ID` → `APP_ID` → `npm_package_name`                   | `"app"`                |
| `app-profile.ts:399`        | explicit → `AGENT_NATIVE_APP_ID` → `APP_ID` → `npm_package_name`        | normalized `undefined` |

**The mess to clean up, not just declare over.** Adding `app.id` on top of seven
surviving chains would make it the eighth. Each item below is a decision this
step has to make and record, not a mechanical rewrite:

- **Two readers disagree on precedence.** `identity-sso` prefers
  `AGENT_NATIVE_APP_ID` over `AGENT_NATIVE_WORKSPACE_APP_ID`;
  `credential-provider` prefers the reverse. `workspace-deploy.ts` injects
  `AGENT_NATIVE_WORKSPACE_APP_ID` automatically, so an app that also sets
  `AGENT_NATIVE_APP_ID` to a different value gets one identity for SSO and
  another for scoping credential grants. Latent rather than confirmed — no
  deployment is known to set them differently — but nothing declares which order
  is correct, and the security-sensitive reader is the one that disagrees. Pick
  one order, in the schema, and delete the other six.
- **At least eight keys spell the same concept**: `AGENT_NATIVE_APP_ID`,
  `AGENT_NATIVE_WORKSPACE_APP_ID`, `VITE_AGENT_NATIVE_WORKSPACE_APP_ID`,
  `APP_ID`, `APP_NAME`, `AGENT_NATIVE_APP_NAME`, `VITE_APP_NAME`,
  `npm_package_name`. They stay as env aliases for compatibility; exactly one
  becomes canonical and the rest are documented as deprecated spellings of it.
- **`credential-provider`'s `denied` must survive.** It is the only reader that
  treats "no app identity configured" as a failure instead of inventing one, and
  it is right. So `app.id` is `.optional()` with **no default** — a schema
  default of `"app"` would scope credential grants to an app literally named
  `app`, which is the exact coercion this whole effort exists to remove. The
  five callers that want `"app"` apply it themselves, visibly.
- **`getAppName()` and `normalizeAppId()` are a third and fourth resolver** for
  the same value. Fold them in, or state why they stay.
  **Resolved on inspection: they are not.** `getAppName()` returns a display
  name ("Acme"), read from `APP_NAME` or `package.json`, and only leaks into
  identity because `identity-sso` had nothing better to fall back on. It stays,
  and `app.name` carries its env half. `normalizeAppId()` is a slug transform
  the onboarding profile applies, not a source of the value.

Every reader is function-scope, so nothing here is blocked by the module-scope
audit.

### What actually shipped

Nine chains removed, across `agent-chat-plugin`, `identity-sso`,
`credential-provider`, `run-code-tools`, `cli/agent`, `default-steps`,
`app-profile`, `workspace-provider-oauth`, and `durable-background`.

**One deliberate behavior change, in a security path.** `credential-provider`'s
chain did not include plain `APP_ID`, so a deployment setting `APP_ID` and
`APP_NAME` scoped grants by the _display name_. Reading `app.id` widens it to
prefer `APP_ID`, which is the more correct key — but it is a change, and it is
the one line in this step worth a reviewer's attention.

**Left alone on purpose, recorded rather than half-done.** Three more
`workspaceId` readers stay raw: `resources/store.ts` and
`mcp-client/workspace-servers.ts` derive an id from `APP_BASE_PATH` and a legacy
`AGENT_APP` spelling, and `workspace-oauth.ts` is a presence check that also
reads `import.meta.env`. Migrating them needs an `app.basePath` field and a
decision on `AGENT_APP`; adding `AGENT_APP` to `app.workspaceId`'s aliases would
widen credential scoping a second time, which is not a change to make in
passing. On-touch, or a follow-up step.

## Step 5 — `engine` and `model` — done

The proven cross-boundary case: `AGENT_ENGINE` is read by
`server/core-routes-plugin.ts`, `cli/code-agent-executor.ts`, and
`scripts/agent-engines/` — none of which the agent-chat plugin can reach.

- Add `agent.engine` and `agent.model` to the schema.
- `resolveEngine()` reads `getConfig().agent?.engine`; its existing 7-step ladder
  collapses into the declared one.
- The plugin options stay and become the top layer. `createAgentChatPlugin({ model })`
  keeps working unchanged, no template edits.
- Same for `runSoftTimeoutMs`, `durableBackgroundRuns`, `codeExecution`: option
  stays, hand-merged env twin becomes a declared layer.

### What actually shipped

`agent.engine`, `agent.model`, `agent.mode`, and `agent.preferBringYourOwnKey`.
Thirteen raw reads removed across `agent/engine/registry.ts` (the ladder's env
step plus three copies of the same `preferByo` parse), `core-routes-plugin`,
`usage/metrics-store`, `scripts/agent-engines/list-agent-engines`,
`cli/code-agent-executor` (four), and `agent-chat-plugin`.

**Deviation: plugin options do not become a config layer.** The plan said the
option becomes the top layer of the ladder. Implementing that means
`createAgentChatPlugin` writing its per-mount options into a process-global
layer — which is the exact singleton problem this whole effort was started to
get away from, and two mounts would fight over one slot. `engineOption` stays a
function parameter, which is already per-call and already above the declared
field. `createAgentChatPlugin({ model })` keeps working unchanged, and
`resolveEngine`'s documented order is unchanged.

**One behavior change.** `AGENT_ENGINE_PREFER_BYO_KEY` was parsed with
`/^(1|true)$/i`, so `yes`, `on`, and any typo all read as `false` — a
misspelled opt-in silently selected the opposite policy. The declared boolean
accepts the documented spellings and throws on anything else, naming the key.
This is the outcome step 6 wants for the `ALLOW_*` family, arriving early.

**Correction to this plan.** `AGENT_MAX_ITERATIONS` was listed here as a key to
migrate. It does not exist — the only matches are the constant names
`MIN_/MAX_/DEFAULT_AGENT_MAX_ITERATIONS` in `agent/loop-settings.ts`, which are
plain numbers, not env reads.

## Step 6 — A2A and secrets — partly done

- Add `a2a.secret` as a function-typed field (per-org resolver), env alias
  `A2A_SECRET` for the static case.
- Consumers call the resolved field with `{ orgId }`. Remove the hand-rolled
  precedence in `a2a/client.ts` that flips on `preferGlobalSecret`.
- Same pass for the `ALLOW_UNSIGNED` / `ALLOW_UNVERIFIED` family — a declared
  parser turns a malformed security toggle into a startup error instead of a
  silent fall through to the permissive branch.

### What actually shipped

`a2a.allowUnsignedInternal` and `integrations.allowUnverifiedWebhooks`. Four
raw reads removed — `a2a/auth-policy.ts` plus three byte-identical copies of the
same check in the telegram, whatsapp, and email webhook adapters.

**`A2A_SECRET` is deliberately NOT in the schema, and this step's plan was
wrong to put it there.** Two reasons, both found by reading the code:

- It is a secret value. Secrets resolve through `readDeployCredentialEnv` and
  the vault — one of the four allowed resolvers — not through a plain config
  object that a future docs generator will walk.
- It is the key-derivation root the secrets vault uses to decrypt its own rows
  (`secrets/crypto.ts:124`). It is therefore read _below_ the config layer, on
  the bootstrap path, which is exactly the caveat at the top of this file.

**Still open, and needing a decision rather than a refactor:** the hand-rolled
precedence in `a2a/client.ts` that flips on `preferGlobalSecret`
(`process.env.A2A_SECRET || orgSecret` versus `orgSecret ||
process.env.A2A_SECRET`). Resolving it means choosing which secret signs
outbound calls between apps, which can break inter-app auth in a live
workspace. It is a security decision, not a tidy-up, and it does not get made
in passing.

**Correction to this plan.** This step claimed a malformed `ALLOW_*` value
"falls through to the permissive branch". It does not: all three adapters test
`=== "1"`, so a typo reads as `false` and fails _closed_. The declared parser
still improves things — a typo is now a startup error instead of a silently
ignored opt-in — but the original framing overstated the bug.

## Step 7 — Timeouts and retention windows — partly done

**This step's premise was wrong.** "16 numeric keys, all parsed ad hoc" does not
describe the code. Every timeout and retention key in core has exactly _one_
`process.env` read, already behind a named resolver with a documented default —
`resolveRunSoftTimeoutMs`, `resolveCompletedRunRetentionMs`, and so on. They are
the one-resolver-per-key shape the doctrine asks for; they were simply never
declared anywhere an app author could find them.

Migrated the three that are agent-run policy an app would plausibly set:
`agent.runSoftTimeoutMs`, `agent.completedRunRetentionMs`,
`agent.erroredRunRetentionMs`.

The rest (`AGENT_NATIVE_MCP_CLIENT_CONNECT_TIMEOUT_MS`, `DB_OP_TIMEOUT_MS`,
`AGENT_PROMPT_CACHE_TTL`, `AGENT_NATIVE_TRACE_RETENTION_DAYS`, and about a dozen
siblings) stay as they are for now. Each is one well-formed resolver, so
converting them buys no correctness — the real reason to finish them is step 9,
which can only generate docs for fields that are declared. That is the argument
to make when picking them up, not "they are parsed ad hoc".

**Behavior change where migrated.** The old resolvers used
`Number.isFinite(raw) && raw >= 0`, so `AGENT_RUN_RETENTION_MS=abc` or a
negative value silently fell back to the default. A declared
`z.number().nonnegative()` throws instead, naming the key.

## Step 8 — URLs and endpoints

**Rescoped on 2026-08-13 after counting properly.** The earlier "44 keys,
mechanical" was wrong twice: the real figure is 56 URL-ish keys (the old grep
both missed some and counted `DATA`**`BASE`**`_AUTH_TOKEN` and
`ALLOW_LOCAL`**`HOST`** as URLs), and they are not 56 settings. They are three
clusters, and only two are in scope.

### 8a — Three concepts, not nine keys — done

Nine keys look like nine settings. Counted by _what question they answer_, they
are three concepts, one transport, and three platform facts.

| Concept                      | Question                                     | Keys                                                                    |
| ---------------------------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| **Self-address**             | Where does _this running deployment_ answer? | `DEPLOY_PRIME_URL`, `DEPLOY_URL`, `URL` (platform-set) → `app.url` last |
| **Canonical public URL**     | What URL does a user see?                    | `APP_URL`, `BETTER_AUTH_URL`                                            |
| **Workspace gateway origin** | Where is the gateway fronting N apps?        | `WORKSPACE_GATEWAY_URL`, `WORKSPACE_OAUTH_ORIGIN`                       |

Not concepts: `VITE_*` is transport (see 8b); `URL` / `DEPLOY_URL` /
`DEPLOY_PRIME_URL` are Netlify-set platform facts an operator never sets, so
they belong with `resolveDeployEnvironment()`, not app config;
`BETTER_AUTH_URL` is another library's config surface holding the same value as
`APP_URL`, so it is an alias; `WEBHOOK_BASE_URL` is a scoped override of
self-address for callers with no inbound request — plugin init, retry jobs, and
dev tunnels, where the app's real address is not `APP_URL`.

**Self-address and canonical URL cannot be merged.** They coincide on an
ordinary production deploy and diverge on previews and workspaces — which is
exactly where both bugs were. Merging them is what caused both.

**The design: self-address is derived, never configured.** `app.url` is the
only operator-facing key, and it is the _lowest_ rung of self-address so the
platform's own deploy URL always wins. One `resolveSelfDispatchBaseUrl()` that
no call site reimplements.

Nine keys answer "what is my own public origin?": `APP_URL`, `URL`,
`DEPLOY_URL`, `DEPLOY_PRIME_URL`, `VERCEL_URL`,
`VERCEL_PROJECT_PRODUCTION_URL`, `BETTER_AUTH_URL`, `WEBHOOK_BASE_URL`,
`WORKSPACE_GATEWAY_URL`. Sixteen files read `APP_URL`, each with its own chain.

Two of them are the _same function_ — resolve my own base URL, apply
`withConfiguredAppBasePath`, throw in production if unset — with the order
shuffled:

| Function                                                    | Chain                                                             |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| `resolveSelfDispatchBaseUrl` (`server/self-dispatch.ts:63`) | `DEPLOY_PRIME_URL → DEPLOY_URL → URL → APP_URL → BETTER_AUTH_URL` |
| `resolveBaseUrl` (`integrations/webhook-handler.ts:613`)    | `APP_URL → URL → DEPLOY_URL → BETTER_AUTH_URL`                    |

Netlify sets `DEPLOY_PRIME_URL`/`DEPLOY_URL` to the preview URL while `APP_URL`
is usually production, and `DEPLOY_PRIME_URL` is missing from the second chain
entirely. On a deploy preview, agent self-dispatch targets the preview and
integration self-dispatch targets production — from one running process. Fix
this whether or not the rest of step 8 happens.

**Shipped.** `app.url` added, aliases `APP_URL` then `BETTER_AUTH_URL`.

- `resolveSelfDispatchBaseUrl` now ends in `getAppConfig().app.url` instead of
  two raw reads; the three platform facts stay raw ahead of it, on purpose.
- Both duplicate self-dispatch resolvers deleted, not left alongside:
  `integrations/webhook-handler.ts` `resolveBaseUrl` and
  `integrations/a2a-continuation-processor.ts` `dispatchA2AContinuation`. The
  second was worse than the first — besides omitting `DEPLOY_PRIME_URL` it fell
  back to `http://localhost:${PORT}` in production, where the POST never
  arrives and the continuation is dropped with no error. Both callers already
  catch and log, and the continuation is rescheduled before dispatch, so the
  throw surfaces the failure without losing the work.
- The four sites with the identical `APP_URL || BETTER_AUTH_URL` chain now read
  `app.url`: `create-agent-resource-link.ts`, `a2a/client.ts`,
  `embed-session.ts`, `auth.ts`.
- Regression tests pin preview-not-production for both self-dispatch paths, and
  the localhost fallback for the continuation one.

Still open: chains that mix in platform facts —
`APP_URL > URL > DEPLOY_URL > BETTER_AUTH_URL` at `a2a/server.ts:78` and
`action-filters-a2a.ts:235` (identical to each other), the `appSlugFromUrl`
trio, and the two disagreeing chains inside `deploy/workspace-deploy.ts`. Each
needs a call on whether it wants self-address or canonical URL.

### 8b — The `VITE_` mirrors are a transport, not a setting — done

Seven keys mirror a server key: `APP_URL`, `BETTER_AUTH_URL`,
`WORKSPACE_GATEWAY_URL`, `WORKSPACE_OAUTH_ORIGIN`, `FUSION_ENV_ORIGIN`,
`POSTHOG_HOST`, `SENTRY_INGEST_HOST`. The prefix exists because Vite only
inlines `VITE_`-prefixed variables into the browser bundle — so it answers "how
does this value reach the client", not "what is this value".

**The repo already has a better answer, and two of the seven already use it.**
`window.__AGENT_NATIVE_CONFIG__` is assembled by `deploy/build.ts`,
`server/posthog-config.ts`, and `server/sentry-config.ts`, and
`client/analytics.ts:1344` prefers that shell over `env?.VITE_POSTHOG_HOST`.
PostHog and Sentry are migrated; the mirror is a legacy fallback.

Costs of keeping the mirror, all observable today:

- Consumers write both spellings. `client/frame.ts:208` chains eight lookups
  where half are structurally dead on whichever side is running — in a browser
  only `import.meta.env.VITE_*` can resolve; on the server both can.
- `VITE_FUSION_ENV_ORIGIN` has **zero** client reads. It is read only from
  `server/builder-browser.ts` and `server/credential-provider.ts`. The prefix
  buys nothing.
- A `VITE_` value is frozen at build, so it can never express anything resolved
  per request.

So: the server schema owns the value, the shell projection owns delivery, and
no field needs a `VITE_` twin. Constraint to respect —
`__AGENT_NATIVE_CONFIG__` rides the impersonal, hard-cached public SSR shell, so
anything projected there is public to every visitor. That is exactly why the
server schema is a separate object that is never serialized.

**Shipped.** The server schema owns the value; the shell owns delivery.

- New `workspace` domain: `gatewayUrl` and `oauthOrigin`, each declaring the
  plain and `VITE_` spelling as aliases of one field. `app.url` gained
  `VITE_APP_URL` and `VITE_BETTER_AUTH_URL`, ordered canonical-then-mirror so
  `oauth-public-origin.ts`'s relative order is preserved exactly.
- `server/app-origin-config.ts` projects `appUrl`, `workspaceGatewayUrl`, and
  `workspaceOAuthOrigin` into `window.__AGENT_NATIVE_CONFIG__`, alongside the
  Sentry, PostHog, and realtime scripts, from both `ssr-handler.ts` and the
  emitted worker in `deploy/build.ts`. `client/frame.ts` reads the shell first.
- Server readers migrated off the dual spellings: `getPublicOAuthOrigin`,
  `agent-discovery.workspaceBaseUrl`, `a2a/client.workspacePrivateOrigins`.

**One deliberate narrowing.** `getPublicOAuthOrigin` walked eight keys and
skipped loopback origins _per key_, so a loopback `APP_URL` could fall through
to a public `BETTER_AUTH_URL`. Those are now one declared value, so the skip is
per concept. `getWorkspaceGatewayReturnOrigin` narrows the same way, inverted —
it wants the loopback one. The lost case is a deployment whose canonical URL is
loopback while a mirror is public, a misconfiguration for OAuth either way.

**And one thing the tests caught.** `app.url` was first declared `.url()`, which
broke `runner.spec.ts`: that test sets a deliberately malformed `APP_URL` and
expects the actionable "Secure browser handoff found an invalid app URL"
diagnostic, which a zod throw from `getAppConfig()` pre-empted. Format
validation was removed from `app.url` and `workspace.*`. The schema's job is
presence and type; a value this widely read must not make every config call in
the process throw over one bad character, and the consumer that cares already
reports a better error than a zod path would.

**Left as-is, with reasons.** `deploy/workspace-deploy.ts` still writes the
`VITE_` spellings when launching child apps: it is the tool _setting_ the
variables, not a consumer reading them, and the mirrors must keep existing for
apps built before the projection. `server/workspace-oauth.ts` reads both
`process.env` and `import.meta.env` because it runs in both bundles — the same
problem the shell solves, but it is a presence check rather than a URL.
`FUSION_ENV_ORIGIN` and `BUILDER_PREVIEW_URL` keep their mirrors under 8c.

The generated worker in `deploy/build.ts` carries a string copy of the alias
order, because that bundle cannot import. It sits next to the identical
constraint already documented for the realtime config, and both are marked to
stay consistent with their server-side originals.

### 8c — `BUILDER_*` is out of scope

Ten keys (`BUILDER_HOST`, `BUILDER_API_HOST`, `BUILDER_APP_HOST`,
`BUILDER_PUBLIC_APP_HOST`, `BUILDER_ADMIN_API_HOST`, `BUILDER_PROXY_ORIGIN`,
and four `*_BASE_URL`s). Decided: these are internal service endpoints, not app
configuration, and they already sit behind named resolvers
(`getBuilderProxyOrigin`, `getBuilderGatewayBaseUrl`, …). Leave them.

## Step 9 — Generate docs and key sets — partly done

Emit by walking `configSchema`'s `.meta({ env, doc })`:

- `docs/environment-variables.md`
- `packages/core/docs/content/environment-variables.mdx`
- `PUBLIC_EXACT_KEYS` in `scripts/guard-env-documentation.ts`
- the hosted-deploy allow-list in `scripts/sync-template-netlify-env.ts`

This is what makes declaring cheaper than adding an env var. Not optional.

### What actually shipped

`packages/core/src/app-config/describe.ts` reflects the schema —
`describeConfigFields()` and `declaredEnvKeys()` — and
`scripts/sync-config-docs.ts` writes the field table into
`docs/environment-variables.md` between generated markers. Registered as
`pnpm sync:config-docs` and `pnpm guard:config-docs`, matching the existing
`sync-workspace-core-skills` pair, and added to `run-guards.ts`. 54 checks now.

**Only one of the four targets is generated.** The other three were the wrong
shape for a generator:

- `docs/environment-variables.md` — generated block added. The surrounding
  40KB of curated prose is hand-written and stays that way; the generator owns
  the marked block only.
- `packages/core/docs/content/environment-variables.mdx` — the published,
  deliberately _curated_ page. It excludes template-only and CI plumbing on
  purpose, so generating it wholesale would undo an editorial decision. It also
  has localized copies under `locales/*`.
- `PUBLIC_EXACT_KEYS` in `guard-env-documentation.ts` — that set exists to
  catch `process.env` reads the schema does not know about. Deriving it from
  the schema would make the guard tautological.
- The hosted-deploy allow-list in `sync-template-netlify-env.ts` — a
  security-relevant list of what may reach a hosted deploy. It should not
  silently grow because someone added a schema field.

So the honest claim is that declaring is now cheaper for the maintainer
inventory, not that all four bookkeeping entries are gone. The remaining three
need a decision about what each list is _for_ before anything derives them.

## Step 10 — `guard:no-legacy-config` — done

One guard, not one per entry. Default-deny with a schema lookup and a
per-line opt-out pragma, same shape as `no-env-credentials`. Two rules:

- A `process.env.X` read in core with no matching `.meta({ env })` is an error.
- A call to anything on the deprecation register is an error.

Scoped to lines the branch adds, matching `no-silent-coercion` and
`no-raw-colors`. Register in `scripts/run-guards.ts` and `package.json`.

Last on purpose: before step 9 a guard makes the correct path expensive.

---

### What actually shipped

`scripts/guard-no-legacy-config.mjs`, registered as `pnpm guard:no-legacy-config`
and in `run-guards.ts`. 55 checks now. Two rules, on lines the branch adds:

1. `process.env.X` in `packages/core/src` — unless the file is one of the four
   resolvers (or build/deploy/CLI tooling, which composes env for a child rather
   than reading config), or `X` is a platform fact the app never sets.
2. A call to an entry point on the deprecation register.

Opt out per line with `// config-ok: <reason>`, same shape as
`no-silent-coercion`'s pragma.

**Verified in both directions**, because a guard that only ever prints "clean"
is indistinguishable from one that inspects nothing: a planted
`process.env.SOME_NEW_BEHAVIOR_KNOB` and a planted call to
`setPrivateBlobPublicUploadFallbackEnabled` both failed it with the right
message and exit 1; the `// config-ok:` pragma suppressed it; removing the probe
returned it to clean. It also caught its first real regression immediately —
`guard:config-docs` failed the moment `a2a.allowedOrigins` was added without
regenerating.

## Leftovers, and why each is where it is

- **`appSlugFromUrl` in `better-auth-instance.ts` and `tracking-identity.ts`** —
  the helper is byte-identical and both walk the same six URL keys, but the
  callers differ: one composes with `knownTemplateSlug` and a `readPackageName()`
  fallback, the other with plain `normalizeTrackingSlug`. Deduping the helper is
  safe; deduping the composition needs someone to decide whether the two were
  specialized deliberately or drifted. Tracking-only, so it waits.
- **`a2a/server.ts:78` `expectedJwtAudience`** — reads the origin cluster to
  decide an expected JWT `aud`. Not merged with the artifact/canonical helper,
  because "what audience will a caller have used" is a third question and
  getting it wrong is an auth failure, not a bad link.
- **`deploy/workspace-deploy.ts:1507` and `:1553`** — two chains in one file
  that disagree on whether `APP_URL` or `VITE_WORKSPACE_OAUTH_ORIGIN` wins.
  This file is the deploy tool that _writes_ those variables for child apps, so
  it is a producer, not a consumer.
- **`FUSION_ENV_ORIGIN`, `BUILDER_PREVIEW_URL`** — under 8c, internal.

## Deprecation register

Filled in as domains migrate. This is the end-state deliverable.

| Deprecated                                                                                                       | Replacement                                                          | Step                          |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------- | ---- |
| `process.env.X` in consumer code                                                                                 | `getConfig().<path>`                                                 | all                           |
| Nine ad-hoc app-identity fallback chains                                                                         | `getAppConfig().app.{id,workspaceId,name}`                           | 4 ✅                          |
| `APP_ID`, `npm_package_name`, `VITE_AGENT_NATIVE_TEMPLATE` read raw at a call site                               | Declared aliases on an `app.*` field                                 | 4 ✅                          |
| `AGENT_APP` / `APP_BASE_PATH` identity derivation in `resources/store`, `mcp-client/workspace-servers`           | An `app.basePath` field                                              | on-touch                      |
| `AGENT_ENGINE` read at 8 call sites, `AGENT_MODEL`, `AGENT_MODE`                                                 | `getAppConfig().agent.*`                                             | 5 ✅                          |
| Three copies of `/^(1                                                                                            | true)$/i.test(AGENT_ENGINE_PREFER_BYO_KEY)`                          | `agent.preferBringYourOwnKey` | 5 ✅ |
| `A2A_ALLOW_UNSIGNED_INTERNAL`, and 3 copies of the `AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS` check                | `a2a.allowUnsignedInternal`, `integrations.allowUnverifiedWebhooks`  | 6 ✅                          |
| `preferGlobalSecret` precedence flip in `a2a/client.ts`                                                          | A decided order — needs a security call                              | open                          |
| Ad-hoc numeric parsing in `resolveRunSoftTimeoutMs` / `resolve*RunRetentionMs`                                   | `agent.runSoftTimeoutMs`, `agent.*RunRetentionMs`                    | 7 ✅                          |
| Duplicate origin chain in `integrations/webhook-handler.ts` (preferred `APP_URL`, no `DEPLOY_PRIME_URL`)         | `resolveSelfDispatchBaseUrl`                                         | 8a ✅                         |
| Silent `localhost` self-dispatch fallback in `dispatchA2AContinuation`                                           | `resolveSelfDispatchBaseUrl` (throws instead)                        | 8a ✅                         |
| Four copies of the `APP_URL \|\| BETTER_AUTH_URL` chain                                                          | `getAppConfig().app.url`                                             | 8a ✅                         |
| `VITE_APP_URL`, `VITE_BETTER_AUTH_URL`, `VITE_WORKSPACE_*` read as separate settings                             | Aliases on `app.url` / `workspace.*`, delivered via the client shell | 8b ✅                         |
| `AGENT_NATIVE_A2A_ALLOWED_ORIGINS` parsed inline                                                                 | `a2a.allowedOrigins` (declared array)                                | 8a ✅                         |
| Two `resolveArtifactBaseUrl` functions with different chains                                                     | One exported helper reading `app.url`                                | 8a ✅                         |
| `setPrivateBlobPublicUploadFallbackEnabled` (`@deprecated`, writes the `legacy` layer)                           | `defineAppConfig({ privateBlob })`                                   | 3 ✅                          |
| Implicit first-configured selection in `getActivePrivateBlobProvider`                                            | `privateBlob.provider` (old rule is the unset fallback)              | 3 ✅                          |
| Implicit first-configured selection in `getActiveFileUploadProvider`                                             | Explicit selector setting                                            | on-touch                      |
| `registerSandboxAdapter`, `registerSandboxExecutionRunner`                                                       | `defineAppConfig` — setters, not registries                          | on-touch                      |
| `configureTracking`, `configureLocalSqlite`, `configureCloudflareModuleWorkerOutput`                             | `defineAppConfig`                                                    | on-touch                      |
| `setToolsOrder`, `setContextXraySystemSections`, `setBrowserDemoModeEnabled`, `setTrackingContentCaptureEnabled` | `defineAppConfig`                                                    | on-touch                      |

Deprecate, do not delete. Core is published; removal is a later, separate
decision once usage is zero.

## Antipatterns for new features

- Do not read `process.env` outside the schema. Add the field and give it an
  `env` alias in `.meta()`.
- Do not add a bespoke `configure*` / `set*` function for one domain. Add a field
  to the schema; a per-domain setter is a second namespace with no precedence
  story and no discoverability.
- Do not add a `register*` for something with exactly one active instance.
- Do not add a plugin option that duplicates an env var — the ladder already
  makes one schema field reachable from both.
- Do not move a value into `agent-native.config.ts` just to avoid threading it. That publishes a
  deployment fact into a permanently cached public shell.

## Out of scope

Registries that accumulate (20 of them), the settings store, `RequestContext`,
`agent-native.json`, and Vite plugin options. These answer different questions
and are not app configuration.
