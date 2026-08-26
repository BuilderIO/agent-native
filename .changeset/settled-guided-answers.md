---
"@agent-native/core": patch
---

Stop the agent re-asking clarifying questions the user already answered. Answers submitted from a guided-question card now restate the question they belong to, so they stay interpretable when history trimming drops the turn that asked, and answers to different questions are no longer all labelled with the `ask-question` tool's placeholder `q1` id.
