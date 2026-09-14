---
"@agent-native/core": patch
---

Derive a design system's color mode from its tokens and state it in the agent context, and add a slide contrast check so generated slides cannot ship unreadable. Adds `designSystemColorMode`, `designSystemColorModeFromData`, `formatDesignSystemColorModeDirective`, `isDarkColorValue`, `cssColorChannels`, `contrastRatio`, `findUnreadableTextColors`, and `formatSlideContrastWarning` to `@agent-native/core/shared`.
