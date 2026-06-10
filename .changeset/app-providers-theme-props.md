---
"@agent-native/core": patch
---

Extend `AppProviders` with customisation props needed for dark-first and theme-customised templates.

New props on `AppProvidersProps`:

- `defaultTheme` — passed to next-themes `ThemeProvider`. Defaults to `"system"`. Dark-first templates (videos, slides, macros, analytics) pass `"dark"`.
- `themeAttribute` — passed to next-themes `ThemeProvider.attribute`. Defaults to `"class"`. Use `["class", "data-theme"]` when CSS variables are keyed off a data-theme attribute.
- `tooltipDelayDuration` — passed to Radix `TooltipProvider.delayDuration` (ms).
- `toaster` — custom Toaster element. Pass `null` to suppress the built-in Toaster when children include a styled one.
