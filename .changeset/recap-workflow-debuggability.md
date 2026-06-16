---
"@agent-native/core": patch
---

Make the PR Visual Recap workflow easier to debug and safer against deploy
gaps: upload the agent-authored `recap-source.json` as a CI artifact when the
publish fails (previously only the screenshot was kept, so failures were
opaque), and add a pre-publish route-health probe that fails with a clear
"plan app routes return 404 - deploy not yet propagated" diagnostic instead of
letting the agent run and fail confusingly when the plan server is behind.
