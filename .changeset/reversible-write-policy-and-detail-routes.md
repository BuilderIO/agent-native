---
"@agent-native/core": patch
---

Add shared reversible-write approval policy helpers (`reversibleWriteNeedsApproval`, `createReversibleWriteApprovalPolicy`, `isReversibleWriteNoApprovalsMode`, `isReversibleWriteInlineApprovalAction`) that clear review at the default setting and ask inline in an MCP form (never a review-page link) when approvals are turned on. Scope `allowsAgentNavigation: true` to the outermost write action so nested actions cannot bypass a parent write guard, and replace hardcoded `/admin` and `/integrations` path checks in `isDefaultDetailNavigation` with declared per-app `agent.detailRoutes`.
