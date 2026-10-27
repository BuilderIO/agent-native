---
"@agent-native/core": patch
---

The turn-into-app skill now asks, on a local agent, whether the app runs on your machine (Node.js and pnpm) or is hosted with Builder (a free Builder account). It recommends Builder when Node.js or pnpm is missing or in Claude Cowork, and with Builder it hands the brief and source files to Dispatch without installing or running anything locally.
