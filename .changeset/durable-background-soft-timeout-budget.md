---
"@agent-native/core": minor
---

Durable background agent-chat runs now complete cleanly instead of looping at
the 60s Netlify wall.

- The Netlify `-background` function (15-min async budget) is now emitted by
  default. The deploy gates (`isDurableBackgroundDeployEnabled` in
  `deploy/build.ts` and `deploy/workspace-deploy.ts`) are inverted to default-ON
  to match the runtime gate — unset/empty means enabled; opt out with a falsy
  `AGENT_CHAT_DURABLE_BACKGROUND` (`false`/`0`/`no`/`off`). This makes the chat
  `_process-run` self-dispatch land on the real 15-min async function, so the
  worker runs with its full budget (and likely fixes the app-specific dispatch
  fast-fail, since the self-POST now hits an instant-202 async function).
- The run soft-timeout is now tied to the REAL function budget rather than
  merely "I am the background worker." A new `isInBackgroundFunctionRuntime()`
  guard (the Lambda function name ends in `-background`) gates the ~13-min
  soft-timeout. A worker that lands on the regular ~60s function — or the
  graceful inline fallback running in the foreground ~60s function — keeps the
  ~40s soft-timeout and checkpoints before the hard wall instead of overshooting
  and re-dispatching in a loop.
