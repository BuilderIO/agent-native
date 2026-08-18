---
name: configuration
description: >-
  Where a configuration value belongs — app config schema, agent-native.config.ts,
  or an environment variable — and how the layers resolve. Use before adding an
  env var, a configure*/set* function, a plugin option, or a register* function,
  and when deciding whether something is config or a registry.
scope: dev
metadata:
  internal: true
---

# Configuration

Core had 301 distinct environment variables and only 48 of them were secrets.
The other 253 are product decisions that landed in `process.env` because at the
call site that needed them, nothing else was reachable. This skill exists so the
next value does not do the same thing.

## The rule

**Consumer code never reads `process.env`.** Exactly four resolvers do:

| Resolver | Covers |
| --- | --- |
| The app config env layer (`app-config/env-layer.ts`) | product behavior, via a declared `.meta({ env })` alias |
| `resolveDeployEnvironment()` | platform facts — `NODE_ENV`, `NETLIFY`, `AWS_*` |
| `readDeployCredentialEnv()` | secrets, as the deployment layer inside scoped resolution |
| `getAmbientUserEmail()` / `getAmbientOrgId()` | CLI identity when there is no request context |

The bottom three are not configuration: platform variables are facts nobody
sets in an app, credentials resolve per user or org, and ambient identity exists
only for CLI runs. Everything else is a field in the schema.

This is the credential rule ("one resolver per key, and every runtime path goes
through it") applied to all configuration, with a schema lookup replacing the
grep.

## Where a value goes

| Value | Where |
| --- | --- |
| Server behavior, closures, per-tenant resolvers, anything not for a browser | `defineAppConfig()` |
| Client-visible data | `agent-native.config.ts` |
| A deployment override of a server value | an `env` alias on the schema field |
| A secret value | the vault, via `resolveCredential` — see the `secrets` skill |
| Something a user changes at runtime in the UI | the settings store, not config |

`agent-native.config.ts` is serialized into the bundle and hard-cached in a
public SSR shell. Moving a value there to avoid threading it publishes a
deployment fact to every visitor. It also cannot carry a closure.

## Adding a field

Add it to the domain file under `packages/core/src/app-config/`, or add a new
domain file plus one line in `schema.ts`.

```ts
// packages/core/src/app-config/email.ts
export const emailConfig = z.object({
  brandColor: z.string().regex(HEX_COLOR).optional().meta({
    env: "EMAIL_BRAND_COLOR",
    doc: "Accent color for framework-rendered emails.",
  }),
  renderer: z.custom<EmailRenderer>().optional(),
});
```

Then read it: `getAppConfig().email.brandColor`.

Four things worth knowing before you write one:

- **Wrap a domain in `.prefault({})`, never `.optional()` or `.default({})`.**
  An optional domain never materializes the defaults declared inside it, and
  `.default({})` hands back the literal `{}` without parsing it. Both leave a
  reader with `undefined` where the type promises a value.
- **`.meta({ env })` belongs on leaf fields only.** Collection throws on a group
  that declares one, because the alias would silently never fire.
- **A closure is an ordinary field.** `z.custom<Fn>()` survives `.parse()`, so a
  renderer or a per-org resolver does not need a separate mechanism.
- **An env alias needs a parser for its type.** Strings, enums, booleans, and
  numbers are handled; anything else throws at startup rather than injecting a
  string into a field that cannot hold one.
- **`env` can be an ordered list**, and that is how one concept with many
  historical spellings collapses:
  `.meta({ env: ["AGENT_NATIVE_APP_ID", "APP_ID"] })`. First key that is set
  wins. A key that is unset, empty, or whitespace counts as absent, matching the
  `?.trim() ||` every hand-rolled chain used.

Adding a spelling to an existing field's alias list **widens every reader of
that field**, not just the one you are looking at. App identity is the worked
example: `credential-provider` had no `APP_ID` in its chain, so adding it there
changed which id scopes a credential grant. That can be the right call, but it
is a decision to make deliberately, not a tidy-up.

## Resolution order

Lowest opinion first: **declared default → env → deprecated `set*` setter →
`defineAppConfig()`**.

Env sits below app code, which inverts twelve-factor on purpose: a typed,
reviewed, checked-in value should beat an ambient string on the host. It is safe
because nothing above env sets these keys yet, so env still wins every lookup
until someone deliberately adds a layer above it.

Values are validated where they are set, so a bad value names the call site that
set it rather than whichever unrelated read ran first.

## Config or registry?

The distinguishing property is the merge rule, not the number of entries.

> Config layers **override** — the highest layer wins.
> Registries **accumulate** — every source's entries coexist.

If a module has `getActive*()` or a "first wins" rule, it is config wearing a
registry's name. If it has `list*()` and everything fires, or `get(id)`, it is a
registry and it stays one.

There is a third shape that is easy to get wrong in both directions:
accumulate-but-only-one-is-used. Private blob and file upload providers are
this. The registry is correct — apps really do add providers — and the defect is
only that nothing states which one is active. The fix is additive: keep the
registry, add a selector field, keep the old first-configured rule as the
fallback so no existing deployment changes behavior.

`defineTransactionalEmail` is the clearest case of a real registry: core
registers its system emails and each app registers its own. Model that as an
array setting and the app's value replaces core's, so password reset silently
disappears from the catalog.

## Antipatterns

- **Reading `process.env` outside the four resolvers.** Add the field, give it
  an `env` alias.
- **A bespoke `configure*` / `set*` function for one domain.** That is a second
  namespace with no precedence story and no discoverability. Add a field.
- **A `register*` for something with exactly one active instance.** Apply the
  merge-rule test.
- **A plugin option that duplicates an env var.** The ladder already makes one
  field reachable from both. `createAgentChatPlugin({ model })` keeps working —
  the option becomes the top layer of that field rather than a private closure
  value.
- **Moving a value to `agent-native.config.ts` to avoid threading it.**

## Deprecated paths

Deprecate, do not delete — core is published, so removal waits for a major and
that is how this gets deferred forever. Mark the old export `@deprecated` with
"Use `X` instead", point it at the `legacy` config layer so it keeps working,
and add a row to the register in
`plans/core-configuration-attack-plan.md`.
