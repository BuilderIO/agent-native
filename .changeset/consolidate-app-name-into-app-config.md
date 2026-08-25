---
"@agent-native/core": minor
---

Resolve the app's name, slug, and description once, through app config.

`server/app-name.ts` is removed. `getAppName()`, `getAppSlug()`, and `getAppDescription()` become `getAppConfig().app.name` / `.slug` / `.description`, and the first-party-template lookup they performed now runs over the resolved config, keyed on `app.packageName` (`npm_package_name`). It fills only what is still unset, so `APP_NAME` or a `defineAppConfig()` value always wins.

**`getAppConfig()` no longer touches the filesystem.** `getAppName()` read package.json from `process.cwd()` on every resolution path; the repo already treats that as a development-only fallback (`server/cookie-namespace.ts` uses one solely in its non-production branch). A deployment where `npm_package_name` does not reach the runtime should set `app.name` in `server/plugins/config.ts` or `APP_NAME`.

This removes a second resolver for a declared field: `getAppName()` read `process.env.APP_NAME` directly while `app.name` already declared that alias, so the two disagreed. `core-routes-plugin.ts` resolved the same app name both ways, thirty lines apart — the runtime config report got `undefined` for every first-party template while the MCP connect page got "Mail". Both now read one value.

`app.slug` and `app.description` are new fields with no env alias: the slug selects the per-app transactional email sender on agent-native.com, so a name the first-party template table already contains is its only source. `app.packageName` and `app.template` are deliberately still env-only — both are read as app-id fallbacks when matching stored workspace connection grants, and filling them from package.json would repoint those lookups.

A package.json that exists but cannot be read or parsed now throws and names the file, instead of being silently indistinguishable from having none — which previously branded the app "Agent Native" and sent from the generic mailbox with nothing in the log.
