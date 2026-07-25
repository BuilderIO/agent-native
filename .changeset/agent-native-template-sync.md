---
"@agent-native/core": minor
---

Add `agent-native template` — pull later upstream first-party template changes into an app that was generated from a template, via a real per-file 3-way merge.

`agent-native create` now records what a later merge needs in `agent-native.scaffold`: the exact `templateRef` the template came from, its `templateSource` (`github` / `bundled` / `local-checkout`), the `coreVersion`, and the app `shape`. The pristine upstream tree is stored as a git ref under `refs/agent-native/template-baseline/<app-path>` written entirely with plumbing and a throwaway index, so HEAD, the index, and the working tree are never touched.

Commands:

- `agent-native template status [app]` — recorded ref, latest ref, baseline health, and counts of upstream-changed and locally-modified files.
- `agent-native template diff [app] [--to <ref>]` — read-only unified diff of what upstream changed.
- `agent-native template sync [app] [--to <ref>] [--dry-run] [--force]` — 3-way merge upstream changes into the app. `--to` defaults to the ref matching the installed `@agent-native/core`, so `agent-native upgrade` followed by `agent-native template sync` is the coherent story.
- `agent-native template baseline [app] [--ref <ref>] [--template <name>]` — record a baseline for an app scaffolded before provenance existed.
- `agent-native template accept [app]` — advance the baseline after resolving conflicts.

Secrets, lockfiles, generated output, pending changelog entries, and `learnings.md` are never merged; binary files are never marker-merged; and the baseline only advances when the merge came out clean.
