---
"@agent-native/core": minor
---

Let a deployment refuse framework default plugins and narrow which integration
platforms mount, without writing a stub plugin file.

`plugins.disabled` (env `AGENT_NATIVE_DISABLED_PLUGINS`) names default plugin
slots the framework should not auto-mount — the same list that shows up as
`[agent-native] Auto-mounting N default plugin(s)` under `DEBUG`. It is honored
by the runtime bootstrap and by the generated edge worker entry, so a slot is
withheld on every host. An app that ships its own `server/plugins/<slot>.ts` is
unaffected.

`integrations.platforms` (env `AGENT_NATIVE_INTEGRATION_PLATFORMS`) is an
allow-list of platforms for the integrations plugin, matched against each
adapter's `platform` id. Unset mounts every adapter, as before; a name no
adapter provides throws at plugin init rather than silently mounting a set
nobody asked for.

Both switches withhold registration rather than reject at request time: a
refused slot never runs its plugin, so its routes are absent from the
middleware chain and its background jobs and pollers never start. The
allow-list now also gates the routes mounted under a platform's literal name —
`/slack/interactions`, `/slack/manifest`, and the two Slack OAuth endpoints
previously stayed mounted whatever the adapter set was. They are gated only
when `integrations.platforms` is declared, so a deployment that does not set it
keeps today's behavior.
