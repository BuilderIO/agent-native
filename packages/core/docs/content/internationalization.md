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

Use `useT()` for interface strings and `<LanguagePicker />` in settings:

```tsx
import { LanguagePicker, useT } from "@agent-native/core/client";

function SettingsLanguageCard() {
  const t = useT();
  return (
    <>
      <h2>{t("settings.languageTitle")}</h2>
      <LanguagePicker label={t("settings.languageLabel")} />
    </>
  );
}
```

Use `useFormatters()` for dates, numbers, relative time, and lists. Do not put
locale-sensitive date/number formatting inside translation strings.

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
