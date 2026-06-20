---
"@agent-native/core": minor
---

`create` now asks how you want to start (Full template / Chat / Headless) before
the template picker. Chat and Headless scaffold a single standalone app; Full
template continues into the workspace multi-select. Flag-driven paths
(`--template`, `--headless`, `--standalone`) skip the prompt and are unchanged.
