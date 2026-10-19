---
"@agent-native/core": patch
---

`externalAgents.denyActions` now removes an action from every MCP catalog. Before, it applied only to the connector, directory and app catalogs, so a denied action could still be listed by the default compact catalog, found through `tool-search`, and called with the full-catalog opt-in. `tools/list` and `tools/call` also refuse a denied name, which covers tools built outside the action map, such as the full catalog's `ask-agent` and the directory widget's `create_embed_session`. Denying `ask_app` also removes `ask-agent`, which runs it. A directory profile that lists a denied action, in its catalog or in a widget grant, now fails validation, as it does for an action that isn't exposed to MCP.
