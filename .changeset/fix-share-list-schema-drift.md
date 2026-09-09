---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Keep share dialogs readable while additive migrations are pending, and let
ordinary iframe pages load cross-origin subresources. Improve new-project setup
and Slack identity recovery guidance. Keep Cloudflare Workers builds below the
static-header rule limit, allow local Ollama endpoints on local non-production
servers, surface provider-setting errors, keep one PGlite client across dev
reload realms, permit the optional terminal build in fresh scaffolds, and
clarify standalone deployment.
