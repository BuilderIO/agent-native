---
"@agent-native/toolkit": patch
---

Chat no longer offers to connect an integration just because a prompt mentions it or links to it. Pasting a prompt with a `builder.io` link showed a "Builder.io Publish" connect card, and naming HubSpot or Slack in a prompt did the same. The composer no longer suggests connections while you type. A connect card now appears only on the newest reply, once it finishes, and only when that reply or the message you sent asks for the connection by name ("Connect Notion", "please reconnect Linear", "Slack isn't connected"). It never appears next to the agent's own connection request for the same provider. `McpConnectionSuggestionProps.requestedByUser` is removed.
