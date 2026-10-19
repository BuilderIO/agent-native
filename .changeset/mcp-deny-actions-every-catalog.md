---
"@agent-native/core": patch
---

`externalAgents.denyActions` now removes an action from every MCP catalog. Before, it applied only to the connector, directory and app catalogs, so a denied action could still be listed by the default compact catalog, found through `tool-search`, and called with the full-catalog opt-in. Denying `ask_app` or `ask-agent` also removes the full catalog's `ask-agent` tool, which runs `ask_app`. A directory profile that lists a denied action, in its catalog or in a widget grant, now fails validation, as it does for an action that isn't exposed to MCP.
