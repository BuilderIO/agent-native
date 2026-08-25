---
"@agent-native/core": minor
---

Move observability settings out of the settings table and into `defineAppConfig()`.

`observability` is now a declared config domain. The `observability-config` settings row is no longer read: nothing in core ever wrote it, so its only "UI" was a documented `putSetting(...)` snippet an app author pasted into their own code — which makes it deployment configuration, not a runtime preference. Deployments that wrote that row must move those values into `defineAppConfig({ observability: { … } })`; every field also has a deployment environment variable alias.

This also takes a database round-trip off the agent hot path. `getObservabilityConfig()` read the settings row on every instrumented run inside a bare `catch {}`, so a database outage was indistinguishable from "never configured" and silently served defaults.

`defineAppConfig()` now returns a Nitro plugin, so its canonical home is `server/plugins/config.ts` with `export default defineAppConfig({ … })` — the same shape as every other framework plugin. The config layer is still applied at module load, before any plugin reads it. Existing callers that ignore the return value are unaffected.

**Removed:** `ObservabilityConfig.exporters` and `ObservabilityExporterConfig`. Nothing ever read them — `observability/tracing.ts` states that core deliberately registers no OpenTelemetry provider or exporter — so the documented OTLP export never sent anything, and the docs recommended putting a backend bearer token into the settings table to configure it. Export now happens by registering a `TracerProvider` in the app, which keeps the credential in the app's own wiring and the vault.

**Removed:** `DEFAULT_OBSERVABILITY_CONFIG`. The schema's declared defaults are the single source now.
