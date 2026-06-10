---
"@agent-native/core": patch
---

Fix the Cloudflare Pages deploy build failing on every attempt: externalize `@anthropic-ai/tokenizer` (tiktoken `.wasm`) and `@resvg/resvg-js` (native `.node`) from the worker bundle — esbuild has no loaders for those files, and both import sites already degrade gracefully (char/4 token estimates, SVG OG-image fallback). Teach `isResvgRuntimeUnavailableError` workerd's "No such module" wording so the OG route falls back to SVG instead of erroring. Also guard `e.key.toLowerCase()` keyboard shortcut handlers against undefined `e.key` (autofill/IME keydown events), which crashed the composer in production.
