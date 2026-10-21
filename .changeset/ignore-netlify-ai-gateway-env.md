---
"@agent-native/core": patch
---

Deploys on Netlify no longer treat the AI Gateway's injected provider keys and endpoints as a configured model provider. Netlify fills `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and the matching `*_BASE_URL` vars at runtime on credit-based teams, so a fresh deploy skipped the Connect AI step and ran on the deployer's Netlify credits. These values are now ignored, so Builder and bring-your-own keys behave as on any other host. A key or endpoint the deployer sets themselves is still used.
