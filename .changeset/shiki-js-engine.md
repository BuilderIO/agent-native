---
"@agent-native/core": patch
---

Replace shiki's Oniguruma WASM engine with the JavaScript regex engine in all client-side highlighters, removing ~608 KB from every template's asset bundle.
