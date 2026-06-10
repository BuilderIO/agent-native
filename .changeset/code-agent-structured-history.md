---
"@agent-native/core": patch
---

code-agent-executor: structured multi-turn history and bash improvements

Replace the flat transcript-blob approach in `buildCodeAgentMessages` with proper `EngineMessage[]` reconstruction. The most-recent 40 transcript events are rebuilt as native user/assistant/tool-call/tool-result message pairs; older events are folded into a compact summarised preamble. This gives the model the same structured conversation replay that the sidebar uses, preserving tool-call ↔ tool-result pairing across follow-up turns and resumes.

Also raises the bash default timeout from 30 s to 120 s, and adds a `background: true` parameter to the bash tool that spawns the command detached, returning the PID and a log-file path immediately.
