---
"@agent-native/toolkit": patch
---

`useCollabReconcile` takes `quietSeedEditability`, which `SharedRichEditor` sets for a server-seeded document. Without it the editability flips around the initial seed emit `update` again, as they did before server seeding was shared, which Content relies on to report an edit typed before the seed settled; with it they stay silent, so Plan's save-on-update does not save an unchanged document.
