---
"@agent-native/core": patch
---

Deploying a new app now migrates at release time with no configuration.

`agent-native create` generates a `CONTEXT=production` migration step in the
app's Netlify build command, and the scaffold ships `scripts/migrate-production.ts`.
Create an app, connect Netlify, and schema is owned by the deploy — there is no
flag to set and no step to remember.

The serverless request-path migration skip is now the default rather than
opt-in. An earlier iteration gated it behind `AGENT_NATIVE_RELEASE_MIGRATIONS`,
which was the wrong shape: a flag you must remember is a flag half the fleet
will not have, and it left "migrate on every cold start" as the default for
every app that did not set it. All templates now ship the release step instead.

Also fixes a real regression this introduced: the Netlify rewrite detected the
existing build command with `command = "([^"]*)"`, which stops at the first
escaped quote. Every generated command now contains `\"` from the CONTEXT test,
so the `NETLIFY_DATABASE_URL_UNPOOLED` override silently vanished for the four
templates that use it, and a created app would have built against the pooled URL.
