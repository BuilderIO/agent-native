---
"@agent-native/core": minor
"@agent-native/toolkit": minor
---

Show MCP approval reviews inside the app, in its own theme and components. When a signed-in reader opens a review link, an app whose agent chat mounts MCP (`appApprovalPage: true` on `mountMCP`) now sends them to its home page, with the grant id in the URL fragment (`#mcpApproval=<id>`). The fragment survives the redirects that apps' home routes often make. `AppProviders` then shows the review in place of the app: who the call reaches, every argument, times in the reader's time zone, the client that asked and when it was connected, and a warning when the identical call already ran. Approve and Deny go through the same framework route and token as before. The review is shown only in a top-level window, never under `sessionBypass`, on a public page or in another app's document. It sits outside the phone hand-off and first-run onboarding. Sign-in still happens at the link itself, so the link works after sign-in. A standalone `mountMCP` keeps the framework's plain page. The review's JSON now includes `locale`, and `@agent-native/core/client/mcp-approval` exports the browser helpers that read and decide a review.
