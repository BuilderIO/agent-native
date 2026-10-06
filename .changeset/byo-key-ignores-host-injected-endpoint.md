---
"@agent-native/core": patch
---

Fix chats with your own OpenAI or Anthropic key failing with 401 Unauthorized on hosts that inject a provider gateway URL (Netlify AI Gateway sets `OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL` at runtime). A user, org, or workspace key now goes to the endpoint saved with it, or to the provider's official API; a deployment `OPENAI_BASE_URL` or `ANTHROPIC_BASE_URL` applies only to the deployment's own key.
