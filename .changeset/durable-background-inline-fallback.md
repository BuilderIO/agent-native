---
"@agent-native/core": minor
---

Durable background agent runs are robust again, and **on by default** for hosted apps.

- **Graceful inline fallback (the safety fix).** When the foreground turn can't
  hand off to a background worker — the HMAC self-dispatch self-POST fails fast,
  e.g. a connection error or a non-2xx returned within the settle window — the
  agent-chat handler no longer breaks the chat with
  `Failed to dispatch background run`. It now degrades to a normal synchronous
  (inline) run, reusing the already-inserted run row. The run is claimed
  atomically (`claimBackgroundRun`, a conditional `dispatch_mode: background →
background-processing` UPDATE) before running inline, so the SQL atomic claim
  is the single owner — a delayed background delivery that arrives afterward
  loses the claim and no-ops, and the run can never double-execute. A dispatch
  that _did_ land (so a worker already owns the run) still streams the worker's
  events instead of running a second copy.

- **Default-on, safely.** `AGENT_CHAT_DURABLE_BACKGROUND` is now opt-out for
  hosted apps: unset/empty/unknown counts as enabled; opt a specific app back
  out with an explicit falsy value (`false`/`0`/`no`/`off`). The gate still
  composes with the existing guards, so a run only goes durable when the runtime
  is hosted/serverless **and** `A2A_SECRET` is configured — local dev and
  unconfigured apps stay on the synchronous inline path unchanged. Default-on is
  safe precisely because a failed dispatch degrades to a working inline run. The
  Netlify 15-min `-background` function emit (`isDurableBackgroundDeployEnabled`)
  remains opt-in until its path is separately verified; with it off, the
  default-on baseline runs the worker through the standard function and
  server-chains continuations.

- **More diagnosable dispatch errors.** Self-dispatch failures now log the
  resolved base URL so a failure tied to which host the self-POST targets
  (custom domain vs deploy URL) is visible in logs. The URL resolution order is
  unchanged (it matches the working A2A/agent-teams self-dispatch paths).
