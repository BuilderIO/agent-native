---
"@agent-native/core": minor
---

The CLI now reports three anonymous project activity events: `cli_create_finished`, `cli_dev_ready` and `cli_deploy_finished`. They show how many machines that ran `create` went on to start a dev server and finish a production build, and from which templates. They follow every telemetry setting, and the telemetry docs list every property they can send.
