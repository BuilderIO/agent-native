# Core keep-view (#9509) and Desktop follow-up (#9527)

## PR #9509 — Agent reads and edits keep the user's current view, for every caller
- **PR URL:** https://github.com/BuilderIO/agent-native/pull/9509
- **Status:** Merged (squash)
- **Merge SHA:** `4502521b41db4c83648fa0df2fdec56f59c11c5b`
- **What landed:**
  - Single `isAgentCaller(ctx)` helper across core (`tool`, `mcp`, `webmcp`, `a2a`, plus legacy `"agent"`).
  - Store-boundary `assertNavigateWriteAllowed` guard on `navigate` and `__set_url__` writes: refuses reads, refuses non-navigate write actions (including before their first observed write) and nested writes without `intent: "open"` or `allowsAgentNavigation: true`, and refuses detail opens without `intent: "open"` while keeping `/settings/*`, `/admin/<section>`, and `/admin/integrations/*` section routes open and `/admin/<section>/<id>` detail routes gated.
  - Default `createNavigateAction()` and default scaffold enforce this out of the box; all 15 shipped templates + Dispatch expose `intent: navigationIntentSchema` on their `navigate` schemas; Clips `import-loom-recording` and `youtube-import` use `navigateAfterWrite` so agent/MCP imports succeed while keeping the user's view.
  - Updated `context-awareness` skill and `packages/core/docs/content/context-awareness.mdx` + all 10 locales; all 110 repo guards and `verify:execution-lease` passed.

## PR #9527 — MCP no-approvals identity fallback + `window` `agent-native:tool-done` in-place query refetch
- **PR URL:** https://github.com/BuilderIO/agent-native/pull/9527
- **Status:** Merged (squash)
- **Merge SHA:** `f2b5851035fc056096baff7e451cd58501947a14`
- **What landed (from `agent-guidance-1120` / desktop #524 `RESULT.md`):**
  1. Verified `#9507` already wired `isNoApprovalsMode` into `preparedCallClearsReview` and `preparedCallNeedsApproval` for `direct` and `pageApprovalOnly` MCP gates, and closed the remaining gap in `packages/core/src/mcp/execute-action-call.ts` where `authorizeApproval` only read `getRequestUserEmail()` (which could fall back to ambient `AGENT_USER_EMAIL` or return `undefined` without a request context). `authorizeApproval` now resolves `getRequestContext()?.userEmail ?? verifiedIdentityEmail ?? getRequestUserEmail()`. Verified with failing-first regression tests in `packages/core/src/mcp/execute-action-call.spec.ts`.
  2. Fixed multi-subscriber `useDbSync.applyRunEvents` starvation on `agent-native:tool-done` (an earlier `useDbSync({ onEvent })` without `queryClient` no longer blocks `queryClient` invalidation; distinct `actionInvalidatePredicate` / filter hooks sharing a `QueryClient` each run their own invalidation; `onEvent` delivers consistently to every hook) and added a ref-counted fallback `window` `agent-native:tool-done` listener with in-flight trailing refresh in `useActionQuery` (`packages/core/src/client/tool-done-refresh.ts`) for apps without `useDbSync({ queryClient })`, deferring cleanly to `useDbSync` whenever `useDbSync({ queryClient })` owns that `QueryClient`. Verified with failing-first tests in `packages/core/src/client/tool-done-refresh.spec.tsx`.
  - All CI checks green (12/12 Fast tests targeted, Mutation test changed Core lines, Security guards, Build artifacts, Typecheck, Lint & format, Content convergence, Generate + run standalone Chat) and Review Agent clean.

## Follow-ups needing a `@agent-native/core` version bump
Once changesets release the new `@agent-native/core` patch version containing `4502521b41db4c83648fa0df2fdec56f59c11c5b` and `f2b5851035fc056096baff7e451cd58501947a14`:
- **Labs (`BuilderIO/agent-native-labs`):** `mail-2`, `tasks-2`, `calendar-2` (and any other hosted Labs apps) need a `@agent-native/core` version bump to pick up the shared store-level keep-view primitive, `isAgentCaller`, the MCP verified-identity no-approvals precedence fix, and the `window` `agent-native:tool-done` in-place query refetch fixes. (Their app-level keep-view PRs #283/#286/#287/#295 are already merged and served on `2190ab676e`.)
- **Desktop (`BuilderIO/agent-native-desktop`):** Already merged #524 (`9fd27333e5`); no desktop code change needed once hosted apps bump `@agent-native/core`.
