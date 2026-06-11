---
"@agent-native/core": patch
---

Skills installer: offer the two plan skills independently, prompt for scope, and
install built-in instructions in-process.

The interactive `agent-native skills` installer now offers exactly `visual-plan`
and `visual-recap` as two separate, independently selectable entries (both
checked by default) instead of a single bundled "Agent-Native Plan" row.
Selecting both still registers the shared hosted plan MCP connector once;
selecting only one installs just that skill. `agent-native skills add
visual-plan` / `visual-recap` likewise install only the named skill, while the
bundle aliases (`visual-plans`, `plannotate`, …) still install both. The PR
Visual Recap GitHub Action offer is now gated on `visual-recap` being part of
the install.

The installer also prompts for install scope (Project vs User) when `--scope`
is not passed, matching the open `skills` CLI UX.

Built-in skill instructions are now written straight into each client's skills
directory instead of shelling out to `npx @agent-native/skills@latest` — that
package is not published yet, so the previous delegation failed with a 404
mid-install. External/plain skill repos still use the standalone installer.
