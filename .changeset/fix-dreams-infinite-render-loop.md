---
"@agent-native/dispatch": patch
---

Fix infinite render loop in DreamsRoute caused by the `useEffect` fallback clearing `selectedDreamId` to `null` while `dreams` was still loading. Added a `dreamsQuery.isLoading` guard to prevent the fallback from running before data resolves.
