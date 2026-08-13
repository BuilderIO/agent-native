---
"@agent-native/core": minor
---

Add `defineAppConfig()` and `getAppConfig()` — one zod schema under `src/app-config/` that owns server-side configuration, so a value can be set in typed app code instead of only through an environment variable. Environment variables become declared `.meta({ env })` aliases into a schema field, parsed and validated in one place rather than at each call site, and resolve below explicit app configuration. A field can declare several aliases in precedence order, which is how one concept with many historical spellings collapses to a single declared ladder.

Five domains are declared so far, replacing roughly thirty hand-rolled `process.env` reads:

- **`privateBlob`** — `provider` selects which registered provider is active, replacing the implicit "first one whose `isConfigured()` returns true in module import order" rule (still the fallback when unset), and throwing when the named provider is not registered. `publicUploadFallback` replaces a setter and an environment variable whose precedence was decided by statement order inside `putPrivateBlob`. `setPrivateBlobPublicUploadFallbackEnabled` is deprecated but keeps working, now with a stated position in the ladder.
- **`app`** — `id`, `workspaceId`, `name`, `packageName`, and `template` replace nine fallback chains across agent chat, SSO, credential scoping, onboarding, the CLI, data programs, durable background dispatch, and workspace OAuth. They stay separate fields on purpose: `vault_grants` rows are written with the workspace-assigned id, so credential scoping keeps preferring it, and `name` is a display name rather than an identifier. None has a default, so an app with no configured identity is still denied a credential grant lookup instead of resolving one scoped to an app literally named `app`.
- **`agent`** — `engine`, `model`, `mode`, `preferBringYourOwnKey`, `runSoftTimeoutMs`, `completedRunRetentionMs`, `erroredRunRetentionMs`. `resolveEngine`'s documented resolution order is unchanged and `createAgentChatPlugin({ model })` keeps working; the explicit option stays a function parameter above the declared field.
- **`a2a`** and **`integrations`** — `allowUnsignedInternal` and `allowUnverifiedWebhooks`, the latter replacing three byte-identical copies of the same check in the telegram, whatsapp, and email webhook adapters.

- **`workspace`** — `gatewayUrl` and `oauthOrigin`. Together with `app.url` these retire the `VITE_` mirrors of the URL keys: the prefix only ever answered "how does this value reach the browser", so the value is now one declared field and delivery goes through `window.__AGENT_NATIVE_CONFIG__` alongside the existing Sentry, PostHog, and realtime scripts.

Two self-dispatch bugs are fixed along the way. `integrations/webhook-handler.ts` and `integrations/a2a-continuation-processor.ts` each carried their own copy of "resolve my own base URL"; both omitted `DEPLOY_PRIME_URL`, so a Netlify deploy preview dispatched background work to production, and the continuation copy silently fell back to `http://localhost:${PORT}` in production, where the request never arrives and the work is dropped with no error. Both now delegate to `resolveSelfDispatchBaseUrl`.

A new guard keeps the surface from growing back: `pnpm guard:no-legacy-config` fails when a line this branch adds reads `process.env` in `packages/core/src` outside the four resolvers, or calls a deprecated entry point. Opt out per line with `// config-ok: <reason>`.

Declared configuration now generates its own documentation: `pnpm sync:config-docs` writes the field table into `docs/environment-variables.md`, and `pnpm guard:config-docs` fails when it is stale.

Malformed values in migrated keys now fail at startup naming the key, instead of silently reading as `false` or falling back to a default. This affects `AGENT_ENGINE_PREFER_BYO_KEY`, `A2A_ALLOW_UNSIGNED_INTERNAL`, `AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS`, and the three agent run timeout/retention keys.
