---
"@agent-native/core": minor
---

Add a shared `@agent-native/core/brand-kit` module — template-agnostic Brand Kit types and brand-signal extraction, plus a single re-export surface over the existing design-token utilities (URL/GitHub/Tailwind/CSS/code/document extraction). This de-duplicates the design-system/brand logic that the `design` and `slides` templates previously copy-pasted, so it can be reused across design, slides, and assets for on-brand generation.
