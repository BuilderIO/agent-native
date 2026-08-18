---
"@agent-native/core": patch
---

Fix `provider-api-request` reporting a failed Slack send as a success. Slack's Web API always answers HTTP 200, even on failure, and encodes the real outcome as `ok: false` in the JSON body — `chat.postMessage` calls that failed (e.g. `not_in_channel`, `channel_not_found`, `msg_too_long`) looked identical to a delivered message to any caller checking `response.ok`, including the agent, which could then tell a user a Slack message was sent when it never was. Provider configs can now declare `bodyOkField` for this always-200-with-body-encoded-outcome convention; the Slack provider sets it, and a body-level `false` now flips the response's `ok` to `false` so a failed or unconfirmed send can no longer be reported as delivered.
