---
"@agent-native/core": minor
---

Brand Kits can store a design system's own named tokens, not just the seven color roles.

`BrandKitData.tokens` holds `{ name, cssVar, value, type, group?, source? }` entries so an imported system keeps the vocabulary its team actually uses (`interactive-01`, `md-sys-color-primary-container`) instead of being squashed into `primary`/`secondary`/`accent`. A new `@agent-native/core/brand-kit/tokens` subpath exports the pure helpers: `normalizeBrandKitTokens` (which reports rejected entries rather than silently storing a subset), `parseBrandKitTokensFromCss`, `resolveBrandKitTokens`, `brandKitRoleTokens`, `groupBrandKitTokens`, `classifyBrandKitToken`, and the canonical `isSafeCssVarName` / `isSafeCssTokenValue` predicates.

Kits with no stored `tokens` fall back to the names their `customCSS` declares, so existing Brand Kits gain named tokens without a migration.
