---
"@agent-native/core": minor
---

Gate the forced `reasoning_effort: "none"` for GPT reasoning models with tools on the Builder gateway behind a new `agent.builderGatewayGptResponsesLane` app-config field (env `AGENT_BUILDER_GATEWAY_GPT_RESPONSES_LANE`, default `false`), so the real requested effort can be forwarded once the Builder gateway proxies GPT + tools requests to the OpenAI Responses API.
