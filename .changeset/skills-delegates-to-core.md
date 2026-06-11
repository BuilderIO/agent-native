---
"@agent-native/skills": minor
"@agent-native/core": minor
---

Unify the two skills installers onto one codebase + UX.

- `npx @agent-native/skills add` / `list` now delegate to `@agent-native/core`'s
  clack-based installer (`runSkills`, newly exported at `@agent-native/core/cli/skills`),
  so the standalone CLI and `agent-native skills` share the exact same interactive
  experience, MCP-server registration, and authentication. A `AGENT_NATIVE_SKILLS_DIRECT`
  env guard keeps core's plain-repo delegation from looping back.
- `agent-native skills add`: the optional PR Visual Recap GitHub Action is now offered
  **before** any install/registration, with copy that explains it's a GitHub Action and
  what it does. The final summary is rendered with clack (a boxed note + a "✅ All set!"
  outro that points you at the new slash command and a reload).
