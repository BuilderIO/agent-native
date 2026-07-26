---
"@agent-native/core": patch
---

Stop scaffolded-app instructions from inviting oversized work on small prompts.

Two reported failures from a Claude CLI session in a generated app: asked for a
login screen with a placeholder test password, the agent wrote a Playwright
script from scratch to verify it, then abandoned a half-written action and built
three custom Nitro routes plus middleware instead.

The verification half came from the shipped `frontend-design` skill, whose
description fires on any UI work and whose Verification section told the agent
to "verify with browser screenshots" with no size threshold. That section is now
proportional: existing checks for a small change, browser tooling only when
asked or when a multi-step flow cannot be confirmed otherwise, and never author
a new browser-automation script or e2e harness for unrequested verification. The
`qa` skill's description no longer matches ordinary bug fixing, and
`adding-a-feature` now says a restyle or a screen with no new data model does
not need all four areas.

The routes half was not soft wording — the rule appears in every instruction
file. It lost to the shipped examples, so the `actions` skill now carries a
closed exception list, an explicit stop trigger for the moment a route file or
guard middleware is about to be created, and a note that the templates' existing
`/api/*` CRUD is a grandfathered baseline rather than a pattern to copy. The
same stop trigger is mirrored into the scaffold, chat, workspace, and registry
`AGENTS.md` files, which also gain a one-line "scale effort to the task" rule.
