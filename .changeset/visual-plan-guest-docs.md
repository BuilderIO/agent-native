---
"@agent-native/core": patch
---

Correct the `/visual-plan` setup & authentication docs to match the real model.
The CLI install (`agent-native skills add visual-plan`) installs the skill,
registers the hosted Plans MCP connector, AND authenticates it in one step (a
one-time browser sign-in at setup is intended; `--no-connect` skips it) — it does
not run "no-login local by default". The no-sign-up experience is the
browser/guest path: anyone you share with can create and edit a plan as a guest
and only sign in to save or share, at which point their guest plans are claimed
into their account. Public/shared plans are viewable by anyone with the link;
commenting requires an agent-native account. Local mode (offline, plans synced to
your repo as MDX) is documented as a separate advanced path. Updates the shared
`PLAN_SETUP_AUTH_MD` block across all Plans skills (`/visual-plan`, `/ui-plan`,
`/visual-questions`, `/visualize-plan`) and the public Visual Plans docs page,
including its frontmatter description.
