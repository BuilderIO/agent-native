---
"@agent-native/core": patch
---

Run a hosted default-model A/B on first-party Builder apps: half of users on the default Luna/high setup move to Claude Haiku 5.5 at medium effort, with the arm recorded as `hosted_model_experiment_variant` on agent run traces, even when the turn is also in another experiment. Explicit model choices are unaffected.
