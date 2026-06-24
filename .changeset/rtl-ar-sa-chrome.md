---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Fix right-to-left (`ar-SA`) layout in shared framework chrome. Physical directional CSS in the agent panel, command menu, language picker, shadcn `ui/*` primitives, settings/composer/org/sharing/onboarding panels, and the agent-conversation/blocks/rich-markdown styles is converted to logical utilities (`ms`/`me`, `ps`/`pe`, `start`/`end`, `text-start`/`text-end`, `border-s`/`border-e`), and directional icons are mirrored with `rtl:-scale-x-100`. No change to left-to-right rendering (logical utilities are identical to physical in LTR).
