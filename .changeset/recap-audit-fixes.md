---
"@agent-native/core": patch
---

Audit fixes for the PR visual-recap pipeline: emit diff byte/line size and a full-read instruction in the agent prompt so agents read the whole diff before authoring; add package-lock.json, bun.lockb, .next/, _.min.js, _.min.css, and \*.map to diff excludes; reorder diff file segments source-first before truncation so dotfile dirs (.changeset/, .github/) are sacrificed instead of src/; add a small-diff override sentence in the prompt to override the skill's skip-small-diffs advice; tighten find-plan-id extraction to require ^[A-Za-z0-9_-]{1,64}$ so injected bot-comment markers are rejected; port the auth probe step and gate skip-comment refresh (issues: write) to the reusable workflow for parity with the copy variant; fix docs to use the correct check title "Visual recap in progress", align the headline to reflect bundled-by-default skill sourcing, and complete the subcommand list.
