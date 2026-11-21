---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Actions can ask for MCP approval from server state and say why. `mcpNeedsApproval` asks over MCP only, through the same grants, prompt and review page as `needsApproval`, without changing the action's listing, annotations or A2A exposure. `approvalNotice` adds server-computed facts, such as a cost and when an allowance expires, to the prompt, the review link and the review page; it runs with `ctx.askedAt`, the time the grant records as when the person was asked, and a notice over 2,000 characters fails the call. `approvalProof: "review-page"` accepts only the person's approval on the review page: a client's form answer never approves the call, and no-approvals mode does not skip it. An identical call uses the person's approval even after server state stops asking. `currentActionApproval()` from `@agent-native/core/action` tells a running action whether the review page or the client's prompt approved it, and `currentActionApprovalAskedAt()` when the person was asked for a review-page approval, so an allowance that expires at a set time can be recorded for the day they were asked.
