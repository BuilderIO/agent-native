---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Give a tool that stops on a missing integration something to click. `connectRequiredResult()` from `@agent-native/core/shared` is the shared shape a gated tool spreads into its own result, and chat renders a Connect control by matching that shape rather than by knowing the tool's name, so a newly gated tool gets the affordance without an allow-list entry.

Dispatch app creation was the reported case: every Builder authorization failure collapsed into the transient `builder-error` reason ("try again in a moment") even when the real cause was a disconnected Builder account, so the agent narrated a dead end and the `builder-not-connected` Connect control that the create-app popover and `NewWorkspaceAppFlow` already implement could never render. `startWorkspaceAppCreation` (and `remix-workspace-template` through it) now classifies a missing Builder connection as `builder-not-connected` with a connect action attached, and keeps an unreadable credential store as its own retryable `credential-store-unavailable` reason.

Because the renderer matches by shape, a card can arrive from an MCP server or a remote A2A agent, so the contract only accepts a root-relative path or an absolute http(s) URL as a connect target and drops anything else before it reaches an `href`.

A Builder API call that comes back 401 now raises a `builder_not_connected` contract error instead of a plain one, so a credential revoked upstream also reaches the Connect action rather than retry prose. A 403 stays an ordinary error, since Builder also returns it for a Space membership problem where reconnecting is the wrong advice.

The blocker card asks for a reconnect rather than showing a Connected badge, because Builder can revoke a credential upstream without that landing in the local connection status.
