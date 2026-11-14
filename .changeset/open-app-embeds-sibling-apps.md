---
"@agent-native/core": patch
---

`open_app` now embeds another workspace app mounted on the MCP server's origin, such as Mail opened from Dispatch, instead of returning a link. The caller signs a short, single-use handoff with the workspace `A2A_SECRET`, and the target app's embed start route exchanges it for its own embed ticket. Apps on another origin, or a workspace without `A2A_SECRET`, still get a link.
