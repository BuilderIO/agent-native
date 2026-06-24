---
title: "Internationalisierung"
description: "Lokalisiere Agent Native Apps mit gemeinsamen Locale-Katalogen, Sprachauswahl, Browser-Fallback und locale-bewussten Docs."
---

# Internationalisierung

Agent Native Apps können Framework- und Template-UI über die gemeinsame Runtime `@agent-native/core/client/i18n` lokalisieren. Das Framework speichert die Sprachwahl des Benutzers in SQL-Settings, stellt sie als actions bereit und fällt auf English zurück, wenn eine App einen String noch nicht übersetzt hat.

## Runtime {#runtime}

Verwende den Provider über `AppProviders`:

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

`getLocaleInitScript()` setzt das anfängliche `lang`, `dir` und `window.__AGENT_NATIVE_LOCALE__`, bevor React hydriert. Öffentliche SSR-Routen können `resolveLocaleFromRequest()` aus `@agent-native/core/server` aufrufen und den aufgelösten locale/catalog an das Script übergeben, um Hydration-Abweichungen zu vermeiden.

## Kataloge {#catalogs}

Jedes lokalisierte Template hält Kataloge unter `app/i18n/`:

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

Bundle immer `en-US`. Importiere Nicht-English-Kataloge dynamisch, damit Benutzer nur den aktiven locale herunterladen. Unterstützte locale codes sind `en-US`, `zh-CN`, `es-ES`, `fr-FR`, `de-DE`, `ja-JP`, `ko-KR`, `pt-BR`, `hi-IN` und `ar-SA`.

## UI {#ui}

Verwende `useT()` für UI-Texte und `<LanguagePicker />` in den Settings:

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

Verwende `useFormatters()` für Datumswerte, Zahlen, relative Zeiten und Listen. Lege locale-abhängige Datums- oder Zahlenformatierung nicht in Übersetzungsstrings ab.

## Docs-Site-Inhalt {#docs-site-content}

Öffentliche Docs-Seiten verwenden denselben core provider, aber mit `persistPreference={false}`, damit anonymer Docs-Traffic localStorage und die Browsersprache nutzt statt SQL-Settings-actions. Die English-Quelle bleibt in `packages/core/docs/content/*.md`. Lokalisierte Seiten-Overrides liegen unter `packages/core/docs/content/locales/<locale>/<slug>.md`.

Verwende dieselben BCP-47 locale codes wie App-Kataloge. Behalte denselben slug wie die English-Quelle, bewahre stabile Anker mit `{#anchor}` auf übersetzten Überschriften und übersetze keine routes, action names, protocol fields, env vars oder provider names. Wenn ein locale keine übersetzte Markdown-Datei für eine Seite hat, fällt die Docs-Site für diese Seite auf English zurück, lokalisiert aber weiterhin Navigation und Chrome.

## Actions und Persistenz {#actions-and-persistence}

Jede App erbt:

- `get-localization-preference` — liest `{ locale }` des aktuellen Benutzers
- `set-localization-preference` — setzt `"system"` oder einen unterstützten locale

Der dauerhafte Wert liegt in benutzerbezogenen SQL-Settings unter `localization`. `localStorage` wird nur für Pre-Hydration und anonymen Fallback genutzt. Der aktive locale wird als Umgebungskontext in application state gespiegelt, damit agents die aktuelle UI-Sprache sehen.

## Guard {#guard}

Ausführen:

```bash
pnpm guard:i18n-catalogs
```

Der Guard prüft unterstützte locale-Dateinamen, key parity, placeholder parity, stale keys und CLDR-Pluralkategorien über `Intl.PluralRules`. Er prüft Struktur, nicht Übersetzungsqualität; gut sichtbare Strings brauchen weiterhin menschliche Prüfung.

Übersetze keine stabilen Bezeichner wie action names, routes, enum values, app-state keys, database values, protocol fields, env var names oder provider names.
