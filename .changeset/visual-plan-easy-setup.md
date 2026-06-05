---
"@agent-native/core": patch
---

Super-easy `/visual-plan` setup: `agent-native skills add visual-plan` now
installs the skill, registers the Plans MCP connector, AND authenticates it in
one step (reusing the existing `agent-native connect` OAuth / browser
device-code flow) so you no longer hit an OAuth wall on the first tool call. Add
a `--no-connect` flag to skip auth, and in non-interactive shells / CI the auth
step is skipped and the exact `agent-native connect <url>` command is printed
instead. The unauthorized MCP response (`401`) now returns an actionable JSON
body with a human-readable message plus the exact remediation (the
`agent-native connect <url>` command and the authorize / resource-metadata URLs)
while keeping the `WWW-Authenticate` header for OAuth-capable clients. Adds a
public docs quick-start page for Visual Plans.
