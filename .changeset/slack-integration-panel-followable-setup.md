---
"@agent-native/core": patch
---

Make the Slack entry in the integrations panel followable in a standalone app.
The setup steps previously opened with "Open Settings → Messaging", a page that
only exists in the Dispatch template, and then told users not to set
`SLACK_BOT_TOKEN` while the panel listed it as a required secret directly below.
The steps now cover the scopes, tokens, Event Subscriptions request URL, and the
`app_mention` subscription needed to @mention the agent in a thread, and they
end with a way to confirm it works. The Dispatch managed-OAuth path is now a
closing note instead of a blocking first step.
