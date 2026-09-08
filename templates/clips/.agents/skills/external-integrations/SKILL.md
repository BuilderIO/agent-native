---
name: external-integrations
description: >-
  How Clips connects to Slack and Atlassian/Jira, and the provider-API
  boundary for credentialed integrations.
  Use when installing or debugging the Slack app, connecting Atlassian/Jira, or
  adding raw provider API access to a Clips integration.
---

# External Integrations

## Slack

Slack installs should go through the Clips Settings OAuth flow (`connect-slack`,
`/api/slack/oauth/callback`) so each Slack workspace gets its own encrypted bot
token in `app_secrets`. `SLACK_BOT_TOKEN` is only a legacy single-workspace
fallback and must remain behind the team allowlist.

Link previews are handled by the unfurl webhook; see the **video-sharing** skill
for the `/api/slack/unfurl` contract, the required scopes and events, and which
clips may produce a playable video block.

## Atlassian / Jira

Atlassian/Jira is available through the shared MCP integration catalog. It uses
Atlassian Rovo MCP OAuth. Explain that an Atlassian organization admin may need
to allow the Clips app domain and enable the required Read, Write, and Search
permissions before the connection can complete.

## Provider API boundary

Credentialed provider integrations normally belong on the shared provider API
substrate (`provider-api-catalog`, `provider-api-docs`,
`provider-api-request`). Clips has one deliberate exception: Google Calendar.
Calendar grants live in Clips `calendar_accounts` with encrypted `app_secrets`
token refs rather than core `oauth_tokens`, so raw provider requests would
bypass the account sharing/status boundary. See the **meetings** skill before
touching that path.

## Related skills

- `video-sharing` — Slack unfurl route, scopes, and playable-clip rules.
- `meetings` — Google Calendar connection model and why raw provider requests
  are not wired up yet.
- `security` — encrypted per-workspace credential storage in `app_secrets`.
