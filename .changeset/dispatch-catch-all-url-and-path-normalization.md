---
"@agent-native/dispatch": patch
---

Fix two bugs in `resolveCatchAllTarget` (the `/dispatch/<appId>` fallback resolver, used when no explicit dispatch route matches):

- Honour `app.url` from the workspace manifest. Workspaces can point at externally-hosted apps via an absolute URL on the manifest entry; the resolver was ignoring that field and falling through to the local path. `app.url` now takes precedence over `app.path`.
- Normalize `app.path` instead of silently rewriting to `/${appId}`. When the manifest path doesn't start with a slash (`path: "my-forms"`) the previous code returned `/${appId}`, which routed to the wrong app whenever an entry's mounted path differed from its id. Now the leading slash is just prepended, preserving the path.

Both surfaced by the Builder PR-review bot on #651.
