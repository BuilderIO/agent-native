---
name: github-refactor-findings
description: >-
  The GitHub issues tracker for refactor findings: issues labeled
  refactor-findings in the fragility repo, with the plan in the body. Read
  when fragility-common/config.json sets tracker to github and you need to
  know how findings map onto issues, or when changing that mapping.
scope: dev
metadata:
  internal: true
---

# GitHub refactor findings

Don't call these scripts directly. Use fragility-common's `findings-doctor`,
`findings-match`, and `findings-upsert`. They load this skill when
`fragility-common/config.json` sets `"tracker": "github"`. Don't hand-roll
`gh issue` writes for findings either.

Settings live in `config.json`: the label, the comment cooldown, and the
per-run ticket cap. The repo is fragility-common's `repo`. Auth is whatever
`gh` is logged in as. That account needs triage or write access, and it is
the account the issues are filed under.

## How a finding maps onto an issue

- **Ticket**: an issue with the `refactor-findings` label. Its key is `#<n>`;
  `--key` also takes a bare number or the issue URL.
- **Plan**: the current plan, without its frontmatter, sits in the body
  between `<!-- fragility-plan:start … -->` and `<!-- fragility-plan:end -->`.
  A later sighting with a new plan replaces it. The plan goes in when the
  issue is created, so no open issue is ever missing it.
- **State**: fingerprint, systems, paths, and sightings go in a hidden
  `<!-- fragility-finding {json} -->` block. Plan versions go in
  `<!-- fragility-plans [...] -->`.
- **Fixed**: closed as completed. A new plan for it opens a recurrence issue
  that names the old one, which GitHub cross-links.
- **Declined**: closed as not planned or duplicate. It is never re-filed.
- **Sightings**: comments, with the same cooldown rules as Jira.

The scripts rewrite only the marked sections, so people can edit the rest of
the body. Don't edit inside the markers by hand.

Open `refactor-findings` issues are work orders: the factory picks them up
and implements the plan (see `factory-run`). Close an issue as not planned to
stop that. Plans from a bug report also get `needs-member-approval`, which a
member removes to release them.
