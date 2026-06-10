---
"@agent-native/core": patch
---

AppProviders parity polish: add `disableThemeTransitions` prop (default `true`),
wire it through ThemeProvider `disableTransitionOnChange`; restore pre-migration
per-template parity — calendar `position="bottom-center"`, dispatch `closeButton`,
content animated transitions + deduped toaster, slides `defaultTheme="dark"` (drops
outer ThemeProvider workaround), brain `tooltipDelayDuration={250}`, macros
`defaultTheme="dark"` + `tooltipDelayDuration={300}`; migrate plan root to
AppProviders; reconcile scaffold/starter `entry.client.tsx` and enable byte-identity
guard.
