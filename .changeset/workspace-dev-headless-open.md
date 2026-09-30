---
"@agent-native/core": patch
---

`agent-native dev` no longer crashes in headless environments when no browser opener is installed. Workspace dev skips browser auto-open in CI, remote containers, and Linux without a display, and accepts `--no-open`.
