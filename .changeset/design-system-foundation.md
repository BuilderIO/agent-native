---
"@agent-native/design-system": minor
"@agent-native/toolkit": patch
---

Add `@agent-native/design-system`: primitive and semantic tokens in W3C design token files that round-trip through Figma, an app theme per template, the type scale (10, 12 and 13px UI steps on 16px lines) and named text styles (`body`, `label`, `title`) as tokens, CSS, `type-*` utilities and a Figma text-style export, and a part catalog whose prop definitions generate each component's types, Storybook controls and manifest entry. Toolkit gains the components built on it under `@agent-native/toolkit/ui/base-ui/*` (Base UI with Radix Themes' props: `variant`, `color`, `size` 1–4 at 16/20/24/32px, `radius`, `highContrast`), documented in Storybook. Nothing in toolkit or the apps renders them yet.
