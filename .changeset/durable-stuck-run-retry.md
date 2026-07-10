---
"@agent-native/core": patch
---

Avoid false stuck warnings while a durable worker is alive inside its bounded tool window, make retries wait for the prior run to be durably aborted, and keep concurrent progress updates from moving the displayed no-progress clock backward.
