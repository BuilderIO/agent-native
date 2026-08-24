---
"@agent-native/core": patch
---

Cut serverless function payloads across every app. `@xterm/*` is now stubbed out of the SSR graph by default (it is only reachable through a `React.lazy` boundary the server can never take), and `formatExtensionHtml` loads `prettier/standalone` plus the four plugins the HTML printer actually reaches instead of prettier's main entry, which `import()`s all 13 parsers and inlines ~3.5MB of flow/typescript/yaml parsers. Measured: calendar 46.7MB → 21.1MB, docs 51MB → 26MB.
