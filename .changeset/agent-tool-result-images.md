---
"@agent-native/core": minor
---

Let the embedded agent see images in tool results. Actions can attach screenshots or previews by returning a well-known optional `_agentImages` field (`{ url | data, mediaType, label }[]`, stripped from the JSON the model reads), and images returned by external MCP tools are converted instead of being collapsed to `[image: <mime>]` placeholders. Attached images ride the tool result as real vision blocks on the native Anthropic API and vision-capable AI-SDK providers (anthropic, openai, google, openrouter), and degrade to compact text notes everywhere else (Builder gateway, non-vision providers). Caps apply per result (max 4 images, ~2MB base64 each; oversize entries become explanatory notes), and the run ledger only ever stores the string result plus `[image: …]` notes — never base64 payloads. Also thread the model id into the direct-Anthropic max-output-token ceiling so 128K-capable models are no longer clamped to 64K on BYO-key deployments.
