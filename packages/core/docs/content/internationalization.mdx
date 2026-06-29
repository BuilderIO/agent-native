---
title: "Internationalization"
description: "Localize Agent Native apps with shared locale catalogs, a language picker, browser-language fallback, and locale-aware docs content."
---

# Internationalization

Agent Native apps can localize framework and template UI through the shared
`@agent-native/core/client/i18n` runtime. The framework stores the user's
language choice in SQL settings, exposes it as actions, and falls back to
English when an app has not translated a string yet.

## Runtime

Use the provider through `AppProviders`:

```tsx
import { AppProviders, getLocaleInitScript } from "@agent-native/core/client";
import { i18nCatalog } from "./i18n";

const LOCALE_INIT_SCRIPT = getLocaleInitScript();

<script
  data-agent-native-locale-init
  dangerouslySetInnerHTML={{ __html: LOCALE_INIT_SCRIPT }}
/>;

<AppProviders queryClient={queryClient} i18n={{ catalog: i18nCatalog }}>
  <Outlet />
</AppProviders>;
```

`getLocaleInitScript()` sets the initial `lang`, `dir`, and
`window.__AGENT_NATIVE_LOCALE__` before React hydrates. Public SSR routes can
call `resolveLocaleFromRequest()` from `@agent-native/core/server` and pass the
resolved locale/catalog into that script to avoid hydration mismatches.

## Catalogs

Each localized template keeps catalogs under `app/i18n/`:

```ts
// app/i18n/index.ts
import enUS from "./en-US";
import type { AgentNativeI18nCatalog } from "@agent-native/core/client";

export const i18nCatalog = {
  sourceLocale: "en-US",
  messages: enUS,
  loadMessages: async (locale) => {
    switch (locale) {
      case "zh-CN":
        return (await import("./zh-CN")).default;
      default:
        return null;
    }
  },
} satisfies AgentNativeI18nCatalog;
```

Always bundle `en-US`. Dynamic-import non-English catalogs so users only
download the active locale. The supported locale codes are `en-US`, `zh-CN`,
`es-ES`, `fr-FR`, `de-DE`, `ja-JP`, `ko-KR`, `pt-BR`, `hi-IN`, and `ar-SA`.

## UI

Use `useT()` for interface strings and put `<LanguagePicker />` on the app's
`/settings` page. Sidebar apps should expose **Settings** in the app sidebar;
the header language icon is only a shortcut.

```tsx
import {
  LanguagePicker,
  openAgentSettings,
  useT,
} from "@agent-native/core/client";

function SettingsPage() {
  const t = useT();
  return (
    <>
      <h2>{t("settings.languageTitle")}</h2>
      <LanguagePicker label={t("settings.languageLabel")} />

      <h2>{t("settings.agentTitle")}</h2>
      <p>{t("settings.agentDescription")}</p>
      <button type="button" onClick={() => openAgentSettings()}>
        {t("settings.openAgentSettings")}
      </button>
    </>
  );
}
```

The "Agent settings" control should open the right agent sidebar's Settings tab
for model, API key, automation, voice, and other framework-level controls.
Apps may duplicate high-value framework settings in their own settings page
when the setting is central to the app, but the sidebar settings tab remains the
source of truth.

Use `useFormatters()` for dates, numbers, relative time, and lists. Do not put
locale-sensitive date/number formatting inside translation strings.

## Docs Site Content {#docs-site-content}

Public docs pages use the same core provider, but with
`persistPreference={false}` so anonymous docs traffic uses localStorage and the
browser language instead of SQL settings actions. The English source remains in
`packages/core/docs/content/*.md`. Localized page overrides live next to it under
`packages/core/docs/content/locales/<locale>/<slug>.md`.

Use the same BCP-47 locale codes as app catalogs. Keep the same slug as the
English source, preserve stable anchors with `{#anchor}` on translated headings,
and leave routes, action names, protocol fields, env vars, and provider names
untranslated. If a locale has no translated Markdown for a page, the docs site
falls back to English for that page while still localizing navigation and chrome.

Docs Markdown may include structured `an-*` visual blocks. Translate their
user-facing prose fields where it makes sense, such as file-tree titles and
`entries[].note`, callout bodies, tab labels, and annotated-code labels/notes.
Keep stable identifiers unchanged: filenames, paths, env vars, route strings,
action names, language tags, code snippets, JSON keys, and protocol names.

## Actions And Persistence

Every app inherits:

- `get-localization-preference` — read the current user's `{ locale }`
- `set-localization-preference` — set `"system"` or a supported locale

The durable value lives in user-scoped SQL settings under `localization`.
`localStorage` is only used for pre-hydration and anonymous fallback. The active
locale is mirrored into application state as ambient context so agents can see
the current interface language.

## Guard

Run:

```bash
pnpm guard:i18n-catalogs
```

The guard verifies supported locale filenames, key parity, placeholder parity,
stale keys, and CLDR plural categories through `Intl.PluralRules`. It checks
structure, not translation quality; high-visibility strings still need human
review.

Do not translate stable identifiers such as action names, routes, enum values,
app-state keys, database values, protocol fields, env var names, or provider
names.
