---
"@agent-native/core": minor
---

Move the `callout` block into the shared core block library so any app that
registers the library (plan, content, future templates) gets it — not just plan.

- New `library/callout.config.ts` (React-free schema + MDX) and `library/callout.tsx`
  (`Read`/`Edit` + `calloutBlock` spec), added to both `libraryBlockSpecs`
  (client) and `libraryBlockConfigs` (server) and exported from both the
  `@agent-native/core/blocks` and `@agent-native/core/blocks/server` entries
  (the React-free `calloutSchema`/`calloutMdx`/`CALLOUT_TONES`/`CalloutData`/
  `CalloutTone` now sit alongside the other library configs on the server entry).
- The block markup now carries app-neutral `an-callout` classes alongside the
  legacy `plan-callout` ones. A new `styles/blocks.css` (imported by
  `agent-native.css`) styles `an-callout` against shadcn theme tokens
  (`--border`, `--muted-foreground`) with fixed semantic tone accents, so the
  callout renders correctly in any app using that app's palette. Because
  `blocks.css` loads before a template's own `global.css`, the plan template's
  existing `.plan-callout` rules still win there — plan renders unchanged.

Plan's local `callout` registration (client + server) is removed in favor of the
shared library copy.
