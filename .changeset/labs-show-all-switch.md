---
"@agent-native/core": minor
"@agent-native/toolkit": minor
---

Settings › Labs has a "Show all Labs features" switch that turns on every Lab the person hasn't chosen for. `set-labs-show-all` lets the agent flip it, the on/off state of each Lab is mirrored into the `labs` application state, and `assertLabEnabled` lets an action used only by a Lab refuse callers who haven't turned it on.
