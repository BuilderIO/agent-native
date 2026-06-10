---
"@agent-native/core": patch
---

Fix several PR Visual Recap pipeline reliability issues:

- **playwright optionalDependency**: add `playwright@^1` as an `optionalDependency` of `@agent-native/core` so consumer repos running `npx @agent-native/core@latest` can take screenshots without manual install steps; the existing dynamic-import fallback chain is preserved.
- **plan-id continuity**: `buildCommentBody` now threads the last-known plan id (`PREV_PLAN_ID`) into every comment branch (failure, suppressed, tiny) so a transient error never orphans the plan; the failure branch also keeps a labeled stale link to the previous recap.
- **freshness line**: all comment branches that have a `HEAD_SHA` now emit `_As of \`<short-sha>\`\_` so reviewers can tell whether the recap matches the latest push.
- **deterministic visibility**: `create-visual-recap` action accepts a `visibility` input (enum `private|org|public`, default `org`) and applies it server-side after import, so the recap is never accidentally private; the agent prompt now passes `visibility: "org"` in the `create-visual-recap` call and demotes `set-resource-visibility` to a fallback note.
- **playwright browser cache**: adds an `actions/cache` step for `~/.cache/ms-playwright` (keyed on runner OS + playwright major) to avoid re-downloading Chromium on every workflow run.
- **guard scoping**: the `packages/core/**` self-modifying guard in the gate now only triggers for the `BuilderIO/agent-native` monorepo; consumer repos with an unrelated `packages/core/` directory no longer have their recaps silently gated.
