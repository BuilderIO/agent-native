---
"@agent-native/core": minor
---

Durable background agent runs are now **on by default** for hosted apps. Previously the `AGENT_CHAT_DURABLE_BACKGROUND` flag was opt-in (off unless set truthy); it is now opt-out — unset means enabled, and an app disables it with an explicit falsy value (`AGENT_CHAT_DURABLE_BACKGROUND=false`).

The gate still composes with the existing guards, so a run only goes durable when the runtime is hosted/serverless **and** `A2A_SECRET` is configured — local dev and unconfigured apps stay on the synchronous inline path unchanged. Default-on uses the server-driven agnostic continuation path (verified in prod: long multi-step runs complete past the 40s soft-timeout with no thrash and no int4 overflow). The Netlify 15-min `-background` function emit (`isDurableBackgroundDeployEnabled`) remains opt-in until its path is separately verified.
