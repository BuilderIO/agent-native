---
"@agent-native/core": patch
---

Let an app open the extension iframe's `img-src` and `media-src` to remote origins.

The sandboxed extension iframe shipped `img-src 'self' data: blob:` and `media-src 'self' data: blob:`, so an extension could not show a product photo, avatar, or CDN asset without proxying the bytes through the app. `extensions.iframeImageSources` and `extensions.iframeMediaSources` (env `AGENT_NATIVE_EXTENSION_IFRAME_IMAGE_SOURCES` / `AGENT_NATIVE_EXTENSION_IFRAME_MEDIA_SOURCES`) now replace those two lists, comma-separated, defaulting to the previous values. Each entry is validated as a single CSP source expression, so a configured value cannot terminate the directive and append a new one. `connect-src` is deliberately not configurable and stays `'self'`: the host bridge remains the only egress path out of the sandbox.
