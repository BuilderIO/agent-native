---
"@agent-native/core": patch
---

Document the Slack-mention-to-Notion-row workflow end to end. The messaging docs now carry a worked example that connects the two halves nobody had joined up: getting mentions into the app, adding the opt-in provider API actions, storing `NOTION_API_KEY` in the encrypted vault (never `.env`, which the provider runtime deliberately does not read), sharing the Notion database with the integration to avoid the silent 404, the exact prompt to give the agent, the single app action it should write, and the failure signatures for each step. Localized into all ten shipped documentation locales.
