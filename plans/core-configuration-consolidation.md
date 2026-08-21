# Core configuration consolidation

Date: 2026-08-12
Scope: `packages/core` only. Templates and apps inherit whatever core makes easy.
Status: draft for review. Nothing implemented — this is a proposal only.

## Problem

An app author has **five** different ways to set a configuration value, and no
way to discover which one holds what. Core has 301 distinct environment
variables; of those, only 48 are secrets. 225 are product decisions — timeouts,
endpoints, model selectors, policy toggles — that ended up in `process.env`
because at the call site that needed them, nothing else was reachable.

The goal is one typed resolution path, with environment variables demoted to
what they should have been all along: a declared shortcut for initializing one
setting, never something consumer code reads.

## How to sell this

The obvious objection is that this adds an eleventh mechanism rather than
consolidating. Answering it requires separating things that were being counted
together. Core's ten "configuration mechanisms" answer six different questions:

| Question                           | Mechanism                                                                                   | App configuration?     |
| ---------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------- |
| How do I configure my app?         | env, `agent-native.config.ts`, plugin options, bespoke setters, implicit registry selection | **Yes — five of them** |
| How do I extend the framework?     | `register*()` registries                                                                    | No — extension points  |
| How does per-request state flow?   | `RequestContext`                                                                            | No — request state     |
| What can a user change at runtime? | Settings store                                                                              | No — mutable user data |
| What is in this repo?              | `agent-native.json`                                                                         | No — repo manifest     |
| How is this built?                 | Vite plugin options                                                                         | No — build tooling     |

**The number that moves is the first row: five app-facing surfaces become two** —
`defineAppConfig()` against one zod schema for server values, and
`agent-native.config.ts` for build-time and client-visible data. Environment
variables survive as declared aliases _into_ that schema rather than as a
parallel namespace.

Total mechanism count in core stays roughly flat, and the plan should say so
rather than claim otherwise. Registries, the settings store, request context, the
repo manifest, and Vite options are not going anywhere and should not.

So the argument is not the count. It is three things:

**1. It fixes defects, not tidiness.** Upload provider selected by module import
order. A2A secret precedence that flips on a flag. Private-blob setter-versus-env
precedence decided by statement order inside a function body. Security toggles
where a malformed string falls through to the permissive branch. Every one traces
back to having no single resolution path.

**2. The duplication already exists and is still growing.** `AgentChatPluginOptions`
has 38 fields, and several are the same knob as an environment variable:
`model` / `AGENT_MODEL`, `engine` / `AGENT_ENGINE` (11 separate reads),
`durableBackgroundRuns` / `AGENT_CHAT_DURABLE_BACKGROUND`, `runSoftTimeoutMs` /
`AGENT_RUN_SOFT_TIMEOUT`. Nobody decided those should be settable two ways with
hand-rolled precedence between them. It happened because there is no single
namespace, so each new knob gets added wherever its author happened to be
standing. That is the trend line, and it is why "be more disciplined" has not
worked.

**3. Discoverability is the real product.** "What can I configure?" is currently
unanswerable without grepping core — there is no list anywhere. Afterwards it is
`defineAppConfig({` with autocomplete from one zod schema. This is also the mechanism that stops
agents from adding environment variables: an agent that can see the surface uses
it, whereas today reaching for `process.env` genuinely is the path of least
resistance.

## What the code says today

Measured against `packages/core/src`, excluding `*.spec.ts`.

| Category                                        | Keys    |
| ----------------------------------------------- | ------- |
| Product behavior                                | 225     |
| Secrets                                         | 48      |
| Platform-set (`NODE_ENV`, `NETLIFY`, `AWS_*`)   | 14      |
| Deployment identity (`DATABASE_URL`, `APP_URL`) | 14      |
| **Total distinct keys**                         | **301** |

Within the 225: 44 URLs and endpoints, 16 timeouts and retention windows, 9
model/engine/mode selectors, and a long tail of policy toggles. Repo-wide across
`packages/` the figure is 501 distinct keys.

Three structural facts shape everything below.

**The cause is structural, not careless.** `AgentNativeConfig` is loaded only in
the Vite phase and serialized to `window.__AGENT_NATIVE_CONFIG__`. Every reader
of it lives under `client/`. There is no server-runtime reader. Below a plugin
boundary, on the server, `process.env` is the only mechanism that exists.

**The migration is mechanically feasible.** Of 1,105 `process.env` reads in core,
1,030 are inside functions and only 75 at module scope — and several of those 75
are in guard scripts rather than runtime code. Lazy reads can be redirected one
at a time.

**We have already done this twice.** `server/request-context.ts` replaced
per-request `process.env.AGENT_USER_EMAIL` mutation with AsyncLocalStorage, kept
env as a CLI-only fallback, and warns loudly when the fallback fires where it
shouldn't. `registerRequiredSecret()` already describes its `key` field as "env
var name & settings key" — one declaration, satisfied by env or by the vault.
The pattern proposed here is the one core reaches for when it gets this right.

## Correction to the first draft

The first version of this plan proposed a server-side `getAgentNativeConfig()`
returning one config object. That is wrong, for three reasons that all point the
same way:

- **Client leakage.** One object shared with the browser means every setting is
  public by default. Plenty of settings are not secrets but still have no
  business in a bundle — internal endpoints, org allow-lists, capacity limits.
- **Non-serializable values.** The most useful settings are closures. A custom
  `renderEmail`, a `resolveOrgId`, an `extraContext` builder cannot survive
  `JSON.stringify`, so a serialized blob can never carry them — which is exactly
  the customization gap that started this whole thread.
- **Wrong shape for secrets.** A single synchronous object cannot express a
  value that resolves per user or per org against the vault.

The mistake was reusing the **browser-serialized** `AgentNativeConfig` for server
values. The fix is not "no config object" — it is a _second_ object that is never
serialized, so closures, secrets, and internal values are safe in it by
construction. `agent-native.config.ts` keeps owning the public, client-visible
data; the server schema owns everything else.

## The model: one zod schema

One zod object of subobjects defines the whole configurable surface. That is the
entire mechanism.

It is split one file per domain under `packages/core/src/config/`, composed by a
thin `schema.ts`, so no single file gets large and each domain migration is a
one-file addition plus a one-line edit. Shown inline here for readability:

```ts
// packages/core/src/config/schema.ts
export const configSchema = z.object({
  email: z
    .object({
      brandColor: z
        .string()
        .regex(HEX_COLOR)
        .optional()
        .meta({ env: "EMAIL_BRAND_COLOR", doc: "Accent color for emails." }),
      renderer: z.custom<EmailRenderer>().optional(),
    })
    .optional(),
  privateBlob: z
    .object({
      provider: z.string().optional().meta({ env: "PRIVATE_BLOB_PROVIDER" }),
      publicUploadFallback: z
        .boolean()
        .default(false)
        .meta({ env: "AGENT_NATIVE_PRIVATE_BLOB_PUBLIC_UPLOAD_FALLBACK" }),
    })
    .optional(),
  agent: z
    .object({
      engine: z.string().optional().meta({ env: "AGENT_ENGINE" }),
      model: z.string().optional().meta({ env: "AGENT_MODEL" }),
    })
    .optional(),
});

export type AppConfigInput = z.input<typeof configSchema>;
export type AppConfig = z.output<typeof configSchema>;
```

Two functions, and nothing else:

```ts
export function defineAppConfig(c: AppConfigInput): void; // validates, stores
export function getConfig(): AppConfig; // resolved, typed
```

### What this gives, verified

Prototyped against the real zod 4 in core:

- **The type is free.** `z.infer` produces the autocomplete. No codegen, no
  derivation, no declaration merging, no `.d.ts` augmentation.
- **Closures survive `.parse()`.** `z.custom<EmailRenderer>()` round-trips a
  function, so `renderer` and `resolveOrgId` are ordinary fields.
- **Validation happens at the boundary.** A malformed `#zz` throws where it is
  set, not where it is read.
- **Defaults are declared inline** with `.default(false)`.
- **`.meta({ env })` is readable at runtime**, which is all the env layer needs:
  walk the schema once at startup, build a partial config from
  `process.env`, and merge it underneath.

One wrinkle worth knowing: `.default()` makes a field required in zod's _output_
type but optional in its _input_ type. So `defineAppConfig` takes
`z.input<...>` and `getConfig()` returns `z.output<...>`. With that split it
typechecks clean.

### What this replaces

Earlier drafts of this plan proposed, and this rejects: a `setting()` primitive,
a token registry, `read()` / `configure()` accessors, conditional mapped types
derived from a settings tree, and a codegen step emitting `.d.ts` augmentations.
None of it is necessary. A zod object already is a schema, a type, a validator,
and a metadata carrier.

### An app's own settings

An app that needs its own configuration defines its own schema in its own file
with the same helper. It does **not** need to extend core's object:

```ts
// app/config.ts
export const appConfigSchema = z.object({
  digest: z.object({ hour: z.number().int().default(7) }).optional(),
});
```

The requirement that app settings flow into core's namespace was invented in an
earlier draft, and dropping it removes the hardest constraint in the design.

## How an app sets values

```ts
// app/server/plugins/config.ts
import { defineAppConfig } from "@agent-native/core/server";

import { renderMarketingEmail } from "../lib/emails.js";

export default defineAppConfig({
  email: {
    brandColor: "#0e7c86",
    renderer: renderMarketingEmail, // closure — server-only, never serialized
  },
  privateBlob: { provider: "s3" },
  agent: { model: "claude-opus-5" },
});
```

Declarative, one object, full autocomplete from `z.infer`, validated on the way
in.

Core reads it the obvious way:

```ts
const color = getConfig().email?.brandColor;
```

### Per-tenant values

A field whose value legitimately varies per org is typed as a function:

```ts
a2a: z.object({
  secret: z.custom<(ctx: { orgId?: string }) => Promise<string | undefined>>()
    .optional()
    .meta({ env: "A2A_SECRET" }),
}).optional(),
```

The environment variable sets the static case; the function handles the
per-org case. No union ambiguity, because the field is declared as one or the
other.

### Where each kind of value goes

| Value                                                     | Where                                                  |
| --------------------------------------------------------- | ------------------------------------------------------ |
| Closures, secrets, per-tenant resolvers, server-only data | `defineAppConfig()` in a server plugin                 |
| Client-visible data                                       | `agent-native.config.ts` — the only serialized surface |
| Deployment overrides                                      | Environment variable, unchanged                        |

`agent-native.config.ts` keeps its existing hand-written interface and is
untouched by this plan.

## What replaces a registry, and what does not

Declared settings should absorb very few registries. The distinguishing property
is **the merge rule**, not how many entries there are:

> **Config layers override** — the highest layer wins and replaces the value
> below it. **Registries accumulate** — every source's entries coexist.

That gives three shapes, not two:

| Shape                      | Mechanism                                 | Examples                                          |
| -------------------------- | ----------------------------------------- | ------------------------------------------------- |
| Accumulate, all used       | Registry                                  | Email catalog, error capture, tracking, events    |
| Accumulate, one used       | Registry **+ config names the active id** | File upload, private blob, agent engine           |
| Single slot, no collection | Config value                              | Sandbox adapter, email renderer, timeouts, colors |

The middle row is the one that is easy to get wrong in both directions. Those
registries are legitimate — apps really do add providers — and the defect is only
that nothing states _which_ one is active.

### Why a registry is not just a setting holding an array

Worth working through, because it is the obvious simplification and it does not
hold. `defineTransactionalEmail` has 26 call sites across 9 files: core registers
its system emails, and each template app registers its own from
`server/lib/emails.ts`.

Model that as `email.transactional: [...]` in config, and the Content app's value
replaces core's — password reset silently disappears from the catalog and from
`authorize.ts`, which checks that every template id exists. Special-casing arrays
to concatenate instead avoids that, but then an app can never override or remove
a core entry, and the result is a registry with extra steps and a misleading
name.

When the intent is "everyone contributes", override semantics are actively wrong.
That is the whole distinction.

(An aside worth fixing whenever that file is touched: the return value of
`defineTransactionalEmail` is unused at all 26 sites. It is a purely
side-effecting registration wearing a `define*` name — the only such case in
core, and the reason it was missed in the first inventory pass.)

### Core already implements the proposed ladder, once

`resolveEngine()` in `agent/engine/registry.ts` documents its resolution order in
seven steps: plugin options → `AGENT_ENGINE` → org/user app default → settings
store → request credentials → auto-detect → default.

That is the ladder this plan proposes, hand-rolled for one domain, with the
registry holding engines by name and a separate chain selecting among them. The
pattern is right and already native to the codebase. The problem is that it is
bespoke: A2A re-implements a worse version of the same idea with precedence that
flips on a flag, and file upload skips it entirely and falls through to Map
insertion order.

Generalizing `resolveEngine`'s shape is a more accurate description of this whole
plan than "replace registries with config".

Core has 34 `register*()` functions plus one `define*` helper that registers
(`defineTransactionalEmail` — every other `define*` only returns or freezes a
value). 35 registration points, and they are three different things.

### Bootstrap — 11, not an extension surface

`registerBuiltinEngines`, `registerBuiltinAcpHarnesses`,
`registerBuiltinAgentHarnesses`, `registerBuiltinNotificationChannels`,
`registerBuiltinProviders`, `registerCoreSystemEmails`,
`registerDefaultOnboardingSteps`, `registerFrameworkSecrets`,
`registerChatThreadsShareable`, `registerDataProgramsShareable`,
`registerExtensionsShareable`.

All take no arguments and populate core's own defaults at startup. They are
initialization, not configuration, and are out of scope here. Worth stating
because counting them makes the extension surface look twice as large as it is.

### Genuinely plural — 20, keep as registries

`registerAgentEngine`, `registerAgentHarness`, `registerNotificationChannel`,
`registerTrackingProvider`, `registerErrorCaptureProvider`, `registerEvent`,
`registerShareableResource`, `registerReviewableResource`,
`registerVersionedResource`, `registerOnboardingStep`, `registerFeatureFlags`,
`registerRequiredSecret`, `registerBlocks`, `registerDevPanel`,
`registerPackageActions`, `registerPromptContextProvider`,
`registerWorkspaceConnectionLifecycleListener`,
`registerFirstRunOnboardingExtension`,
`registerWorkspaceConnectionOnboardingStep`, `defineTransactionalEmail`.

Many entries coexist; either all of them fire or lookup is by id.
`registerErrorCaptureProvider` is the clearest case — `captureError()` fans out
to every registered provider, so there is no "the" provider to configure. The
process-global lifetime is correct for these.

Email is a tidy illustration of the split, since both halves live in one domain:

- **`defineTransactionalEmail` is a catalog and stays.** It records which emails
  exist (id, name, owning app) and exposes `listTransactionalEmails()` and
  `getTransactionalEmail(id)`. Plural by the test above.
- **Rendering has no configuration seam at all.** `renderEmail()` is one
  function that reads per-call `args.brandColor` / `args.brandLogoUrl` and
  otherwise falls back to a hardcoded `cid:` logo. An app cannot set a default
  or replace the renderer without forking core.

So the migration adds a seam where none exists rather than converting a
registry — which is why it is a weaker first proof than private blob storage.

### Missing a selector — 2, keep the registry and add config

| Function                      | How "the" active one is chosen today                         |
| ----------------------------- | ------------------------------------------------------------ |
| `registerFileUploadProvider`  | First whose `isConfigured()` is true, in Map insertion order |
| `registerPrivateBlobProvider` | Same                                                         |

These accumulate from several sources — core's built-in Builder provider plus
anything an app registers — so the registry itself is correct and stays. What is
missing is a way to say which one wins. Today that is decided by module import
order: an app cannot say "use this one", it can only hope its provider
registered first. That is not an extension point, it is an implicit precedence
rule nobody can state.

The fix is additive rather than structural:

```ts
configure(fileUploadProvider, "s3");
```

with the current first-configured rule kept as the fallback when no explicit
choice is set, so existing deployments do not change behavior.

### Single slot — 2, these are configuration

| Function                         | Why it is not a registry                                      |
| -------------------------------- | ------------------------------------------------------------- |
| `registerSandboxAdapter`         | No collection at all; the signature is `(adapter \| null)`    |
| `registerSandboxExecutionRunner` | One `registeredRunner` slot, first-wins with a `replace` flag |

Both are setters that were named `register*`. Nothing accumulates, so nothing is
lost by making them ordinary settings.

### A tenth mechanism: bespoke config setters

Not counted in the nine above, and closer to what the config schema replaces
than the registries are: roughly eight to ten hand-rolled setters, including
`configureTracking`, `configureLocalSqlite`,
`configureCloudflareModuleWorkerOutput`, `setTrackingContentCaptureEnabled`,
`setBrowserDemoModeEnabled`, `setToolsOrder`, `setContextXraySystemSections`,
and `setPrivateBlobPublicUploadFallbackEnabled`.

That last one is the whole problem in six lines. There is a setter, and then in
`putPrivateBlob`:

```ts
const provider = getActivePrivateBlobProvider();
if (provider) return provider.put(input);
if (!publicUploadFallbackRef.enabled) return null;
if (process.env.AGENT_NATIVE_PRIVATE_BLOB_PUBLIC_UPLOAD_FALLBACK === "0")
  return null;
```

Two mechanisms for one knob — a setter and an environment variable — with
precedence decided by which `if` happens to come first in a function body. No
declaration states that both exist or which should win.

**This makes private-blob a better first migration target than email:** it is
small, it exercises the singular-provider case and the boolean-knob case at
once, and it fixes a real precedence ambiguity rather than only adding a seam.

## Why not just keep adding to `createAgentChatPlugin`?

The strongest objection to this plan, and worth answering with numbers rather
than assertion. `AgentChatPluginOptions` already has 38 fields and is where most
new app configuration currently lands.

### The case for doing nothing

It is genuinely strong:

- It exists, it is typed, and every template already uses it.
- It already carries closures — `resolveOrgId`, `anonymousOwner`, `extraContext`,
  `mentionProviders` — so the non-serializable problem is already solved there.
- It is server-only by construction and never serialized, so the client-leakage
  problem is solved there too.
- It is colocated with the mount.
- Option 39 costs nothing: no plan, no phases, no migration, no new primitive.

For configuring agent-chat behavior, nothing beats it, and this plan should not
try to. The question is what happens to everything that is not agent-chat.

### Where it stops working

**Reach.** A plugin option is a closure variable inside the plugin factory. It
reaches code the plugin calls. `renderEmail()` is called by `sendEmail()` from
the auth flows — the auth plugin's path, not agent-chat's. `putPrivateBlob()` is
called from upload routes. `resolveCredential()` is called from everywhere.
Adding option 39 does not help any of them unless someone threads it through
every intervening call frame, and not threading it is exactly why those call
sites read `process.env` today.

**Scope.** Of the 166 files in core that read an environment variable, **13 are
under `agent/` — about 8%**. The rest are in `server/` (49), `integrations/`
(16), `cli/` (12), `mcp/` (10), `mcp-client/` (8), `a2a/` (6), and a long tail.
Even scoping agent-chat's domain generously, the large majority of configuration
is outside anything that plugin could own. Email branding is not agent-chat
config; the private blob provider is not agent-chat config.

**It is already fragmenting.** `CoreRoutesPluginOptions` and
`CollabPluginOptions` exist alongside agent-chat's 38, plus roughly ten bespoke
setters. In practice "just use plugin options" means "one option bag per plugin",
which is the situation this plan is describing.

**Not every app mounts it.** The headless template has no `server/plugins/`
directory at all.

**The env twins are the proof.** `model` / `AGENT_MODEL`, `engine` /
`AGENT_ENGINE` (11 reads), `durableBackgroundRuns` /
`AGENT_CHAT_DURABLE_BACKGROUND`. Each exists in two mechanisms because the value
had to be reachable from two places and there was no shared namespace. Option 39
plus environment variable 302 repeats the pattern rather than resolving it.

### The resolution: options gain reach, they are not replaced

These are not competing mechanisms, and framing them as competitors is what makes
this plan sound more disruptive than it is.

- **Mount-specific options stay options.** `path`, `actions`, `scripts`,
  `mcpServerInfo` — which instance, mounted where. These are genuinely about the
  plugin, not the app.
- **App-wide behavior becomes a field in the config schema**, and the plugin option becomes
  the top layer of that setting's ladder instead of a private closure value.

The important consequence: `createAgentChatPlugin({ model: "..." })` keeps
working, unchanged, still highest precedence. No template edits. The only
difference is that the value now lands somewhere `getConfig()` can see it, so
`resolveEngine` and anything else can stop re-deriving it from the environment.

So the config schema does not take configuration away from plugin options — it
gives plugin options reach beyond the plugin.

### The test for option 39 versus a setting

> Can this plugin hand the value to everything that needs it?
> If yes, it is an option. If no, it is a setting.

### Applying the test to the existing 38

Run against every current option, using "is the value read outside the
agent-chat call graph" as the evidence rather than judgment. The result argues
for leaving most of the surface alone.

**Two must become settings — the plugin cannot reach the consumer:**

| Option   | Read where the plugin cannot reach                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `engine` | `server/core-routes-plugin.ts` (a different plugin), `cli/code-agent-executor.ts` (CLI, mounts no plugin), `scripts/agent-engines/` |
| `model`  | `cli/code-agent-executor.ts` only — the option and the CLI's env read are two disconnected paths for one concept                    |

**Three stay options but need their env twin reconciled:**
`runSoftTimeoutMs`, `durableBackgroundRuns`, and `codeExecution` are all properly
threaded — `options?.runSoftTimeoutMs` is passed at every call site, and
`durableBackgroundRuns` even reaches A2A through `config.durableBackgroundRuns`.
Reach is not their problem. Their problem is that the environment variable is a
deliberate _parallel_ opt-in merged by hand;`durable-background.ts` says so
outright ("or the existing env/app opt-in path is used on another hosted
platform"). These do not move. The option stays and becomes the declared top
layer, so the merge is stated once instead of re-derived per file.

**The remaining 33 are correctly options.** `systemPrompt`, `mentionProviders`,
`extraContext`, `initialToolNames`, `toolLimits`, `anonymousOwner` and the rest
are agent-chat behavior reached entirely within the plugin's call graph, and
nothing outside reads them.

So roughly 87% of the option surface is already in the right place, and the
failures are specifically the values that escape into the CLI, another plugin, or
a script. That is a much narrower change than "move configuration out of plugin
options", and it is the whole intervention this section is asking for.

## Precedence

Per setting, highest opinion wins.

**Server setting**

1. Per-request override (only when the declaration allows request scope)
2. Plugin options — `createAgentChatPlugin({ ... })`
3. `agent-native.config.ts`, server section
4. Environment variable (declared alias)
5. Declared default

**Scoped secret**

1. Per-user or per-org vault value
2. Deployment vault value
3. Environment variable (declared alias)
4. Absent — no default

**Client setting**

Resolved at build, projected into the bundle. No request layer, by the SSR
invariant above.

### Why this cannot break an existing deployment

Environment variables sit below the config file and plugin options, inverting
the usual twelve-factor order. It is still safe, provably: today nothing above
env sets any of these keys, because the layers above it do not exist yet for
server values. An absent layer has no opinion, so env wins every lookup on day
one. Behavior changes only when someone deliberately adds a higher layer for a
specific key. Compatibility holds by construction rather than by care.

## Why this sticks instead of becoming mechanism number eleven

The failure mode for any consolidation is that the new thing joins the old
things. The defense is making declaration _cheaper_ than the status quo, because
a guard alone would not have stopped any of the 225.

Adding an env var today costs, by hand:

- an entry in `docs/environment-variables.md`
- an entry in `packages/core/docs/content/environment-variables.mdx`
- an entry in `PUBLIC_EXACT_KEYS` in `scripts/guard-env-documentation.ts`
- a decision about `isForbiddenHostedTemplateEnvKey` in
  `scripts/sync-template-netlify-env.ts`, which gates what reaches hosted deploys
- ad-hoc parsing at each call site, typically a fresh `/^(1|true)$/i.test(...)`

A declaration generates the first four and centralizes the fifth. CLAUDE.md
currently instructs us to "grep the key name before reading `process.env`"
because one-resolver-per-key is not enforceable; a registry makes duplicate
readers a lookup rather than a grep.

## Phases

Numbered by dependency, not priority. Only phase 1 must precede the others.

### Phase 0 — Write down the doctrine

A `configuration` skill carrying the three surfaces, the precedence ladders, and
the decision procedure. Referenced from `adding-a-feature`, `server-plugins`,
`customizing-agent-native`, and `writing-agent-instructions`; one invariant line
in CLAUDE.md pointing at it.

Deliberately standalone and first: it stops the count growing while the rest is
under review, and it is reviewable with no implementation landed. Roughly half a
day.

### Phase 1 — Declaration registry and readers

`packages/core/src/config/schema.ts` (one zod object), `defineAppConfig()`,
`getConfig()`, and the startup pass that builds the env layer from `.meta({ env })`. No
migration in this phase — nothing changes behavior, so it ships alone and
reverts cleanly.

Two things to settle during this phase rather than discovering them later:

- Audit the 75 module-scope env reads. Each one in a runtime path freezes at
  import, before any layer above env can be installed, and must become lazy
  before its key can migrate.
- Decide whether reading a request-scoped field outside a request throws
  or returns the deployment value. Recommendation is to throw in development and
  return the deployment value in production, matching the posture of the ambient
  identity warning in `request-context.ts`.

### Phase 2 — Migrate by domain

**Not all 225.** Most are internal plumbing no app author will ever set, and
churning them buys nothing. Migrate two categories: keys an app author would
plausibly want to control, and any key a PR already touches.

Suggested order:

1. **Private blob storage** — small, and the best first proof: it exercises the
   add-a-selector case and the boolean-knob case at once, and it resolves a real
   precedence ambiguity between a setter and an env var rather than only adding a
   seam. It also proves the additive path — the registry survives untouched and
   only gains an explicit selector — which is the shape most of the remaining
   work takes. See the registry section above.
2. **Email branding and rendering** — the next smallest self-contained case:
   `renderEmail` currently has no app-reachable seam at all, so the six
   framework-rendered emails cannot be restyled without forking core.
3. **A2A and secret handling** — `A2A_SECRET` and the `ALLOW_UNSIGNED` /
   `ALLOW_UNVERIFIED` family. Pulled ahead of the larger groups because it is the
   clearest argument for the effort: an untyped string currently gates a security
   decision and a malformed value falls toward the permissive branch. A declared
   parser turns that into a startup error.
4. **Agent engine and model selection** — `AGENT_ENGINE`, `AGENT_MODEL`,
   `AGENT_MAX_ITERATIONS`, `AGENT_MODE`.
5. **Timeouts and retention windows** — 16 keys, all numeric, all parsed ad hoc.
6. **URLs and endpoints** — 44 keys, the largest single group.

### Phase 3 — Generate docs and key sets from declarations

Emit both environment-variable docs pages, the `guard-env-documentation` key
set, and the hosted-deploy allow-list from the registry. Retires the multi-entry
bookkeeping and makes the docs correct by construction. This is what converts
the new path from "equally annoying" to "obviously easier", so it is not
optional polish.

### Phase 3.5 — Deprecate the replaced paths and publish the antipattern list

The plan adds two functions: `defineAppConfig()` and `getConfig()`. That is a
small cost for an effort whose goal is _fewer_
surfaces, and it is only repaid if the replaced paths stop being used.

**Deprecate, do not delete.** Core is a published package with template apps and
external consumers; removing an export is a breaking change that would have to
wait for a major, which is exactly how this phase gets deferred forever.
Deprecation lands immediately and costs nobody a migration. Removal is a separate
decision, later, once usage is actually zero.

Three mechanisms, all of which already exist in this repo:

1. **`@deprecated` JSDoc on every replaced export**, in the established
   "Use `X` instead" form — 37 files in core already do this. Gives editor
   strikethrough at the call site, which is where the decision gets made.
2. **The antipattern list in the `configuration` skill** from phase 0. This is
   what agents actually read, and it is the difference between a rule that
   holds and a rule that is technically written down somewhere.
3. **`guard:no-legacy-config`** in phase 4, following the dozen existing `guard-no-*`
   scripts. Scoped to lines the branch adds, matching how `no-silent-coercion`
   and `no-raw-colors` already work, so the existing backlog stays a separate
   cleanup.

#### The deprecation register

The concrete end-state deliverable — what is deprecated and what replaces it:

| Deprecated                                                                                            | Replacement                                                                     |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `process.env.X` read in consumer code                                                                 | `getConfig().<path>`                                                            |
| `configureTracking`, `configureLocalSqlite`, `configureCloudflareModuleWorkerOutput`                  | A field in the config schema                                                    |
| `setToolsOrder`, `setContextXraySystemSections`, `setBrowserDemoModeEnabled`                          | A field in the config schema                                                    |
| `setTrackingContentCaptureEnabled`, `setPrivateBlobPublicUploadFallbackEnabled`                       | A field in the config schema                                                    |
| `registerSandboxAdapter`, `registerSandboxExecutionRunner`                                            | A field in the config schema — these are setters, not registries                |
| Implicit first-configured selection in `getActiveFileUploadProvider` / `getActivePrivateBlobProvider` | An explicit selector setting, with today's rule as the fallback                 |
| Plugin options `engine` and `model` as the only source                                                | A config-schema field — the CLI, other plugins, and scripts read the same value |
| Hand-merged env twins for `runSoftTimeoutMs`, `durableBackgroundRuns`, `codeExecution`                | The option stays; it becomes the declared top layer instead of a closure value  |

#### The antipatterns for new features

Stated as rules, because this is the part that has to be legible to someone
adding a feature six months from now:

- **Do not read `process.env` outside a declaration.** If a value needs an
  environment variable, declare the setting and give it an `env` alias.
- **Do not add a `configure*` or `set*` function for a deployment value.** That
  is a second namespace with no precedence story. Add a setting.
- **Do not add a `register*` for something with exactly one active instance.**
  Apply the merge-rule test: registries accumulate, config overrides.
- **Do not add a plugin option that duplicates an environment variable.** Pick
  one config-schema field; the ladder already makes it settable from both.
- **Do not mark a setting client-visible to avoid threading it.** That publishes
  a deployment fact into a permanently cached public shell.

Each rule names the positive alternative rather than only the prohibition,
following the repo's own stated approach: when a rule keeps getting broken, write
the workflow for the moment of temptation instead of adding a wall.

### Phase 4 — Enforce the register with one guard

`guard:no-legacy-config` — one guard covering the whole deprecation register
above, not a separate guard per entry. It is default-deny with a declaration
lookup and a per-line opt-out pragma, the same shape as `no-env-credentials`,
which already default-denies across app source. Two rules:

- An undeclared `process.env.X` read in core is an error.
- A call to anything on the deprecation register is an error.

Scoped to lines the branch adds, matching `no-silent-coercion` and
`no-raw-colors`, so the existing 301 keys and current callers stay a separate
cleanup and no one is forced into a migration by a guard.

Last on purpose. A guard before phase 3 makes the correct path expensive and the
wall merely annoying. After phase 3 the declared path is the cheap one, so the
guard only catches genuine slips — which is the only situation where a wall is
the right tool.

## Open decisions

1. **Does env sit below or above `agent-native.config.ts`?** Recommendation:
   below. An app author's typed, reviewed, checked-in value should beat an
   ambient string on the host, and a deployment that genuinely needs to override
   can read env explicitly from the config file. Compatibility holds either way
   today.

2. **Resolved — how much new API?** Two functions, `defineAppConfig()` and
   `getConfig()`, over one zod schema. Three earlier drafts proposed more
   (`defineSetting`, a token registry with `read()`/`configure()`, and a codegen
   step emitting `.d.ts` augmentations); all were rejected as over-engineering.
   The remaining open piece is whether `registerRequiredSecret` folds into the
   schema as function-typed fields or stays as-is — decide during step 2 rather
   than up front.

   Related: **do registries stay for plural, id-keyed implementations?**
   Recommendation: yes, and stop calling them configuration. Roughly twenty
   `register*()` functions exist; under this model most are implementations and
   stay, while single-implementation swaps become config-schema fields holding
   closures.

3. **How hard is scope enforced?** Recommendation: throw in development, no-op in
   production.

4. **How far does phase 2 go?** Full migration of all 225 is perhaps three to
   four weeks of low-risk, high-churn work across most of core. Recommendation is
   the middle: migrate the five named domains deliberately, roughly 80 keys, then
   on-touch for the rest. Gives a finishable milestone without a core-wide churn
   PR nobody can review.

## Risks

**It becomes mechanism number eleven.** The plan adds three primitives —
`defineAppConfig()` and `getConfig()` — both new API today. Phase 3 makes the new path the easy one; phase 3.5 is what makes
the old ones stop spreading.

Note that deprecation does not reduce the count on its own — every deprecated
export still exists and still works. What it does is make the count stop
growing, and give the next feature an unambiguous answer about where a value
belongs. The count only actually falls at removal, which is a later and separate
decision. So the honest claim to a reviewer is "five app-facing surfaces, one of
them recommended and four marked as antipatterns", not "five became two" — the
latter is only true from the perspective of someone writing new code, which is
the perspective that matters but is worth naming explicitly rather than blurring.

If phase 3.5 slips, the effort has made the problem worse rather than better,
and that is the single most likely way it fails.

**Module-scope reads block specific keys.** 75 of them; most are in guards and
CLI code and do not matter, but each one in a runtime path is a small
prerequisite refactor. Audited in phase 1 rather than discovered per-key in
phase 2.

**Some keys migrate twice.** A timeout is data until someone wants a retry
policy, then it wants to be a function. This model handles that better than a
serialized config would — a server setting can hold either — but the value's
shape still changes, and so does every call site that reads it.

**The client projection tempts people to widen it.** Every request to "just
expose this one value to the browser" is a request to make a deployment fact
public and permanently cached. The type constraint stops closures, but nothing
stops someone marking an internal endpoint `client`. Worth a review convention:
a new `visibility: "client"` declaration is a public-surface change.
