---
"@agent-native/core": minor
"@agent-native/skills": patch
---

Long-lived MCP OAuth tokens and lightweight reconnect command.

- Access tokens are now long-lived (30-day default, env-overridable) with a
  sliding 365-day refresh window, so random 401s after one hour are eliminated.
- Audience and signing-secret verification tolerances have been tightened to
  prevent spurious auth failures on host-drift or MCP URL variations.
- `reconnect` command now detects any agent-native MCP config entry whose URL
  ends in `/_agent-native/mcp` for the given host, matching by URL regardless
  of connector name — no more breakage when the entry is named `plan` vs
  `agent-native-plans`.
- Installs no longer write duplicate alias entries and clean up existing
  duplicates on the next connect or skills-add run.
- All CLI, server, skill, and docs guidance now uses `npx @agent-native/core@latest reconnect <app-url>`
  as the documented one-line reauth path and consistently teaches that
  reinstalling from scratch is never needed to fix auth.
