---
"@agent-native/core": minor
---

Deprecate `createAgentChatPlugin({ model })` and `({ durableBackgroundRuns })` in favour of the declared `agent.*` config surface.

`agent.model` (`AGENT_MODEL`) was declared but no agent-chat path read it — every model resolution site read the plugin option directly, so the field was inert. It is now the layer beneath the option, resolved through one helper instead of eight raw reads.

Fixes two delegated-run gates (A2A and MCP) that tested `durableBackgroundRuns === true` on the raw option instead of calling `isAgentChatDurableBackgroundEnabled`. On Netlify, where durable background is default-on, a mount that did not pass the option was capping delegated turns at the 40s foreground chunk budget while running inside the 13-minute background function.
