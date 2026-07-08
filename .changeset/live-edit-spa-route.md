---
"@agent-native/core": patch
---

Fix design live-edit preview showing a 404/NotFound for client-side-routed
(SPA) dev apps. The bridge served every snapshot from its own `/live-edit`
path, so the proxied app's router booted at `location.pathname === "/live-edit"`
and matched no route. The bridge now injects a synchronous pre-boot
`history.replaceState` shim that rewrites the iframe path to the real target
route before the app bundle runs. Asset resolution (via the injected
`<base href>`) is unchanged, and static/non-SPA apps are unaffected.
