---
"@agent-native/core": patch
---

Harden the shell command policy and the untrusted-text prompt boundaries.

- `classifyCodeAgentCommandPermission` now matches its blocked and
  approval-required rules against the quote-stripped form of the command as well
  as the raw text. The shell removes quoting before the command word exists, so
  `git 'checkout' main`, `gi''t checkout main`, `drizzle-kit "push"` and
  `rm -'r'f /` previously ran as unclassified writes. A command using `$'…'`
  escaping, which this pass cannot decode, now asks for approval instead of
  falling through.
- `runCodingCommand` settles on `exit` with a short grace for `close` instead of
  waiting on `close` alone, and spawns detached so a timeout signals the whole
  process group. A command that backgrounds anything (`npm run dev &`) left a
  grandchild holding the output pipe and the call never returned — past its
  timeout too, whose `SIGTERM` went to an `sh -c` wrapper that had already
  exited. When output is cut short this way the result says so rather than
  reading as a clean finish.
- Automation trigger payloads are capped, wrapped in `<event_payload>` tags with
  an explicit untrusted-data instruction, and no longer sit ahead of the
  automation's own body — the same defense `condition-evaluator.ts` already
  applied before this data reached a tool-less classifier, now applied on the
  path that reaches an agent with the full tool surface.
- Prompt `<resource>` blocks escape both halves of the fence in the body, so
  shared `AGENTS.md`/`LEARNINGS.md` content cannot forge a block header and pass
  itself off as framework instructions.
