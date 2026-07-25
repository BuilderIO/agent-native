---
"@agent-native/core": patch
---

Remove duplicated guidance from the in-app runtime agent's system prompt. Anthropic's guidance is that overlapping/conflicting instructions are handled worse by modern models than a single clear statement, and that tool-level detail belongs in tool descriptions rather than being repeated in the system prompt.

- Production (tool) mode no longer re-lists every action's name and truncated description in `## Available Actions` — the native tool schemas already carry that. Only native-chat-widget annotations and a `tool-search` pointer for actions outside the initial tool set remain (dev/CLI mode, where template actions are invoked via `pnpm action` and are not native tools, is unchanged).
- The Navigation Rule, previously stated once as a numbered core rule and again in its own section, is now stated once.
- The three overlapping anti-fabrication / no-fake-success / verify-before-claiming-done rules are consolidated into one rule with three clearly labeled sub-behaviors (don't fabricate data, don't fabricate success, recover instead of giving up), removing a rule that existed only to explain how it differed from the other two.
- The "Extended Capabilities" section no longer repeats "call `get-framework-context` with key X" once per capability for capabilities the tool's own topic list already documents; it collapses to one line, keeping only the agent-teams delegation-intent guidance and the call-agent warning that carry unique, non-redundant behavior.

Full framework core prompt shrinks by roughly 1.8 KB (~10%); the already-condensed compact variant shrinks by a smaller amount since it had less of this duplication to begin with. The tool-mode `## Available Actions` block shrinks by an amount proportional to the number of registered actions (roughly 85%+ for typical action counts), since it stops repeating what the native tool schema already tells the model.
