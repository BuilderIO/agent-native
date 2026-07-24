---
"@agent-native/core": patch
---

Fix `agent-native create --template design` scaffolding a workspace where every `/design` page 500'd. `shouldSkipScaffoldEntry` skipped the entire `.generated` directory, including `templates/design/.generated/bridge/*.generated.ts` — 10 git-tracked files that `DesignCanvas.tsx` and friends import at module load. `.generated/bridge` is now copied while ephemeral dev-time siblings like `actions-registry.ts` and `action-types.d.ts` are still skipped.
