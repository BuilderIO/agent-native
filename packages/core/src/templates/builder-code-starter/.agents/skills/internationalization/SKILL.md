---
name: internationalization
description: >-
  How to add localized UI copy when the user explicitly requests i18n.
  Do not load or apply this skill for ordinary English UI edits in this
  starter — it ships inline English strings with no catalogs.
scope: dev
metadata:
  internal: true
---

# Internationalization

## Rule

**Opt-in only.** Do not add i18n catalogs, `LanguagePicker`, locale init scripts,
or `AppProviders i18n={{...}}` unless the user explicitly asks for
internationalization / localization / multiple languages.

This starter ships **English-only inline copy**. For normal UI text edits,
change the string in the component and stop — do not create `app/i18n/`.

When the user does request i18n, then: visible UI copy belongs in the app's i18n
catalog, not inline in components. Update the English source catalog first,
update existing locale catalogs, and run the i18n guard.

## Catalogs

When enabling i18n, use `app/i18n/`:

- `en-US.ts` is the canonical source tree and fallback.
- Other locale files keep the same non-plural keys and the same placeholders.
- `index.ts` exports an `AgentNativeI18nCatalog` with English bundled and
  non-English catalogs loaded by dynamic import.

Use BCP-47 filenames from the supported set: `en-US`, `zh-CN`, `zh-TW`, `es-ES`,
`fr-FR`, `de-DE`, `ja-JP`, `ko-KR`, `pt-BR`, `hi-IN`, `ar-SA`.

## Verification

Run:

```bash
pnpm guard:i18n-catalogs
```

For broader changes, also run the affected tests and a single `pnpm typecheck`
at the end of the batch.
