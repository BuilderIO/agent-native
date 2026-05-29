---
"@agent-native/core": patch
---

Stop losing agent chat turns that span a serverless timeout. A turn that is cut off mid-stream (the Builder gateway's 45s wall or the function/heartbeat limit) and resumed via auto-continuation now folds every continuation run onto a single durable assistant message keyed by a stable `turnId`, instead of each run persisting only its own events and dropping the earlier text. This fixes the "the agent stopped, then the last paragraphs disappear and it says it's just getting started" failure: the streamed text and completed tool calls are preserved in `thread_data` (monotonic, never-shrinking) so reloads and follow-up turns keep full context. Errored/cut-off runs are also now classified (`error_code`/`error_detail`) and retained longer than completed runs so failure patterns can be analyzed.
