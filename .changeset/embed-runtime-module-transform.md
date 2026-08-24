---
"@agent-native/core": patch
---

Transform virtual runtime modules before serving them to embed sessions. The
dev middleware loaded `/@id/__x00__virtual:*` modules through
`pluginContainer.load`, which returns plugin source with bare specifiers
intact, so react-router's `inject-hmr-runtime` reached the browser still
importing `virtual:react-router/hmr-runtime`. Any page loaded on an origin
that had an `an_embed_session` cookie failed to hydrate and hung on a spinner.
