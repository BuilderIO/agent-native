---
"@agent-native/core": patch
---

Modularise the system-prompt stack: extract FRAMEWORK_CORE and FRAMEWORK_CORE_COMPACT into typed builder functions under `packages/core/src/server/prompts/`, share rules 8–10 and the new rules 14–15 between both variants via a single source of truth, make provider/action examples injectable via `AgentChatPluginOptions.promptExamples`, add per-model-family overlays (GPT/Gemini), gate the 2 KB first-session personalization block to new threads only, add a "Response length" guidance section to both variants, and strengthen the `manage-progress` tool description with Codex-style plan discipline.
