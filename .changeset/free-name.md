---
"@agent-native/core": minor
---

Two files created under one name at the same moment no longer collide. Core adds `nextFreeName` in `@agent-native/core/free-name`, which gives `name.html`, then `name-2.html`, `name-3.html` and so on, and `nameTaken` in `@agent-native/core/free-name/server`, one typed `name_taken` refusal that carries a free name to use instead. Design uses them first: copies made at once each save under their own name, a rename onto a taken name says so and suggests a free one, and older files that already share a name are given free names so Design's unique filename index can hold.
