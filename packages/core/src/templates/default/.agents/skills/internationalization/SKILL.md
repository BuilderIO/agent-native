---
name: internationalization
description: >-
  How to add or edit localized UI copy in agent-native apps. Use when adding,
  removing, or changing user-visible interface text, prompts, toasts, labels,
  empty states, or date/number/list formatting.
scope: dev
metadata:
  internal: true
---

# Internationalization

## Rule

Visible framework/template UI copy belongs in the app's i18n catalog, not
inline in components. When you add or edit UI text, update the English source
catalog first, update existing locale catalogs, and run the i18n guard.

## Catalogs

Templates use `app/i18n/`:

- `en-US.ts` is the canonical source tree and fallback.
- Other locale files keep the same non-plural keys and the same placeholders.
- `index.ts` exports an `AgentNativeI18nCatalog` with English bundled and
  non-English catalogs loaded by dynamic import.

Use BCP-47 filenames from the supported set: `en-US`, `zh-CN`, `es-ES`,
`fr-FR`, `de-DE`, `ja-JP`, `ko-KR`, `pt-BR`, `hi-IN`, `ar-SA`.

## UI Pattern

- Wrap apps with `AppProviders i18n={{ catalog: i18nCatalog }}`.
- Read strings with `useT()` and keep keys stable.
- Sidebar apps should expose a `/settings` route in the app sidebar. Put
  `<LanguagePicker />` in that settings page, usually in a Language or General
  section, and keep the header language icon only as a quick-access shortcut.
- Settings pages should include an "Agent settings" row/card that calls
  `openAgentSettings()` from `@agent-native/core/client` to open the right
  agent sidebar's Settings tab. Localize the title, description, and button.
- Use `useFormatters()` for dates, numbers, relative time, and lists instead
  of embedding formatted values in translation strings.
- Do not translate stable identifiers: action names, route names, enum values,
  app-state keys, database values, protocol fields, env var names, or provider
  names.

## Plurals And Placeholders

Plural strings use i18next/CLDR suffixes. Do not force every locale to copy
English plural categories:

- English uses `_one` and `_other`.
- Chinese and Japanese usually use `_other`.
- Arabic uses `_zero`, `_one`, `_two`, `_few`, `_many`, and `_other`.

Keep interpolation placeholders identical across locales, such as
`{{count}}`, `{{name}}`, or ICU-style `{count}` arguments.

## RTL

New UI should be RTL-safe. Prefer logical CSS utilities/properties such as
`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`, and
`text-end` when direction matters. Avoid hardcoded left/right positioning for
new localized UI unless it is genuinely physical.

## Verification

Run:

```bash
pnpm guard:i18n-catalogs
```

For broader changes, also run the affected template tests and `pnpm typecheck`.
Machine translation is only a starting point; high-visibility strings need
human review.
