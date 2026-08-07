---
"@agent-native/core": patch
---

Fix `frameworkTools` silently ignoring eight of its own switches.

`sharing`, `review`, `history`, `featureFlags`, `localization`, `contextXray`, `userProfile`, and `audit` are removed by `filterFrameworkToolGroups`, which matched on `ActionEntry.frameworkGroup`. That tag is written in exactly one place — `mergeCoreSharingActions` — and the plugin calls it against `httpActions`, the registry documented as deliberately ungated so the UI keeps working. So the tag never reached the agent registry: any app loading core kits through `loadActionsFromStaticRegistry` or its own actions directory held untagged entries, and setting those eight groups to `false` did nothing. The other groups (`database`, `extensions`, `automation`, `docs`, `resources`, `web`, `workspaceApps`, `chat`, `email`) were unaffected — they are gated at construction, where the registry is built empty.

Group membership now resolves by name first and tag second (`resolveFrameworkGroup`), so a switch works no matter how the action was registered. `CORE_ACTION_GROUPS` moves to `framework-tools.ts` (still re-exported from `action-discovery.ts`) so the filter can read it without an import cycle; the `frameworkGroup` stamp stays as a pre-resolved copy but nothing depends on it any more.

The same tag dependency broke `resolveInitialToolNames`, which excludes framework kits from the DEFAULT first-request tool list — untagged apps were promoting ~45 framework schemas into every first request. Fixed by the same change.

Guard tests cover both consumers using deliberately **untagged** fixtures built from `CORE_ACTION_GROUPS`, since the previous tests hand-stamped `frameworkGroup` and so passed against inputs no real app produced. They also assert an app action that merely resembles a kit name (`share-portfolio` under `sharing: false`) is left alone.
