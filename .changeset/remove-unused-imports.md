---
"@agent-native/creative-context": patch
"@agent-native/dispatch": patch
"@agent-native/recap-cli": patch
"@agent-native/skills": patch
"@agent-native/toolkit": patch
---

Remove unused imports and unreachable declarations. Dispatch drops unused
imports from its layout, transactional email pages, and MCP gateway;
creative-context drops unused type imports and an unread `headingStyle`;
recap-cli drops the `node:os` import and two unread locals; skills drops the
unreferenced `maybeUpdateInstructions` helper; toolkit drops unused imports and
an unread `REALTIME_VOICE_REQUEST_SOURCE`. No runtime behavior changes.
`eslint/no-unused-vars` is now an oxlint error instead of a warning, so CI
blocks new ones.
