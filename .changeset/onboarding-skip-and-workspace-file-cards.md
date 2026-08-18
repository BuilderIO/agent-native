---
"@agent-native/core": patch
---

Fix two bugs where a failure looked like success:

- First-run onboarding's Skip/Continue no longer silently do nothing when the completion save fails. `completeFirstRun()` now rejects instead of swallowing a failed fetch or non-ok response, and `FirstRunOnboarding` surfaces the failure with a "Try again" affordance instead of bouncing to an unrelated full-screen error.
- A workspace file (including binary exports) now renders a download card the moment it's created — `show-workspace-file`'s binary content-type gate is gone, and any tool result shaped like a workspace-file card (e.g. `web-request`/`provider-api-request`'s `saveToFile`) renders one automatically, without a second discretionary `show-workspace-file` call.
