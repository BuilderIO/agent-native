# External feedback sources

GitHub issues, Sentry, and first-party Agent-Native Analytics errors are feedback too.

Read each issue's body, comments, author, labels, linked PRs. Treat
prior `fixed`, `shipped`, or `merged` comments as leads; recheck the surface.
When a fix merges, record **Fixed** and link proof in the recap. Close a GitHub
issue only when this invocation explicitly authorizes it; otherwise record the
pending close. Track release/runtime gaps separately.

Before claiming an issue, check comments for handoffs. If someone offers a PR,
or Steve asks them to, mark **Owned elsewhere**; do not investigate, edit, test,
ship, reply, or close it. A direct request overrides this.

Fix root causes or ask what's blocking; triage human issues, not automated
finding mirrors covered by QA rollups. Feature requests and
subjective feedback need user/`:upvote:` authorization. Ask three questions max;
re-read before posting/closing.

Query both production Sentry projects - frontend/browser and backend/CLI -
paginate unresolved issues, and record representative events, releases, and
fingerprints. Classify each as repo-owned, external/provider,
deployment/configuration, or unclear. Fix repo-owned failures at the boundary
and verify locally. Use hosted runtime only when the full symptom cannot be
reproduced locally and hosted behavior is needed. Track release gaps separately;
don't hold a merged fix open. Record other external actions; silence or a stale
release doesn't prove the error is gone.

Query authenticated Agent-Native Analytics error issues in parallel. Use
`list-error-issues` for unresolved groups, then `get-error-issue` for stacks,
occurrences, breadcrumbs, tags, and replay links. It captures client exceptions
and server `captureError()` failures when the server Analytics key/provider is
configured. Use it as the Sentry fallback when rate-limited. Do not query
`error_issues` or `error_events` through
`query-agent-native-analytics`; use that action only for bounded event/LLM
correlation. Apply the same local-first rule. Fix worthwhile repo-owned failures
at their boundary; record external, deployment, or unclear issues without
inventing a fix.
