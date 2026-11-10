---
name: feedback-ingest
description: >-
  Collect product feedback themes for the first-touch radar. Use during a weekly
  report or after a fired first-session check.
scope: dev
---

# Feedback ingest

- Read `.tmp/first-touch-radar/slack-watermark.json`; if absent, use the prior
  24 hours for the first scan.
- Search `#product-agent-native-feedback`, `#dev-agent-native`,
  `#dev-agent-native-feedback`, `#design-an-feedback`, `#qa-agent-native`, and
  `#plg-agent-native` from the watermark through now using Slack MCP.
- Keep the search read-only: do not post, react, mark messages read, or open the
  Slack desktop app.
- Group feedback into themes with counts, app, dates, and permalinks. Join a
  theme to a fired radar check only when the app and date overlap; otherwise mark
  it unlinked.
- Store only the new watermark and aggregate theme notes in the private radar
  run directory. Do not copy full messages, emails, or prompt text.
