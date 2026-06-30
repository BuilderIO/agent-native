---
"@agent-native/core": patch
---

Stop chat reconnect from falsely reporting "stopped before finishing" on long but healthy runs. The active-run reconnect now treats the stuck threshold as an idle deadline that resets on every streamed event, instead of a one-shot cap on total reconnect duration — so a long-running tool (e.g. image generation) that keeps emitting activity heartbeats is never aborted with a no-progress error just for running longer than the threshold. Also surfaces active tool progress while reconnecting, and waits for interrupted write-tool results before re-running them so long-running tools do not appear stopped or duplicate work.
