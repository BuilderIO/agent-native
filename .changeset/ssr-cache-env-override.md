---
"@agent-native/core": minor
---

Add `AGENT_NATIVE_SSR_CACHE`, a deployment-wide override for the SSR shell cache
policy. The default is unchanged: SSR HTML and React Router `.data` are still
stamped `public, max-age=600, stale-while-revalidate=604800, stale-if-error=3600`
because the shell is impersonal — cookies are stripped before render and all
personalization happens on the client. Set the variable to `off` for `no-store`,
or to a duration such as `30s` / `5m` for a shorter freshness (the
`stale-while-revalidate` window mirrors the chosen `max-age`, so a short
freshness does not hand back a seven-day stale window). Unrecognized values warn
and keep the default, so a typo cannot silently disable the CDN.

Use it when your host does not purge its CDN on deploy, or when loaders return
mutable public data and a post-mutation `useRevalidator()` re-reads a cached
`.data` copy. The override is deliberately deployment-wide rather than
per-route: a cache policy that varies per request is how one visitor's payload
lands in another visitor's shared CDN entry. Turning it off shortens caching
only — it does not make SSR personalized, and mutation-fresh app data still
belongs in actions read through `useActionQuery` / `useActionMutation` with
`useDbSync()` polling.
