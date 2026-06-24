---
title: "Internationalisation"
description: "Localisez les apps Agent Native avec des catalogues partagés, un sélecteur de langue, un fallback navigateur et du contenu docs par locale."
---

# Internationalisation

Les apps Agent Native peuvent localiser l'UI du framework et des modèles via le runtime partagé `@agent-native/core/client/i18n`. Le framework stocke le choix de langue de l'utilisateur dans les settings SQL, l'expose sous forme d'actions et revient à English lorsqu'une app n'a pas encore traduit une chaîne.

## Runtime {#runtime}

Utilisez le provider via `AppProviders` :

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

`getLocaleInitScript()` définit le `lang`, le `dir` et `window.__AGENT_NATIVE_LOCALE__` initiaux avant l'hydratation React. Les routes SSR publiques peuvent appeler `resolveLocaleFromRequest()` depuis `@agent-native/core/server` et transmettre le locale/catalog résolu au script pour éviter les écarts d'hydratation.

## Catalogues {#catalogs}

Chaque modèle localisé conserve ses catalogues dans `app/i18n/` :

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

Emballez toujours `en-US`. Importez dynamiquement les catalogues non English afin que les utilisateurs ne téléchargent que le locale actif. Les locale codes pris en charge sont `en-US`, `zh-CN`, `es-ES`, `fr-FR`, `de-DE`, `ja-JP`, `ko-KR`, `pt-BR`, `hi-IN` et `ar-SA`.

## UI {#ui}

Utilisez `useT()` pour les textes d'interface et `<LanguagePicker />` dans les settings :

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

Utilisez `useFormatters()` pour les dates, nombres, temps relatifs et listes. Ne placez pas de formatage sensible au locale dans les chaînes traduites.

## Contenu du site docs {#docs-site-content}

Les pages publiques de docs utilisent le même core provider, mais avec `persistPreference={false}` afin que le trafic anonyme utilise localStorage et la langue du navigateur au lieu des actions de settings SQL. La source English reste dans `packages/core/docs/content/*.md`. Les remplacements localisés vivent dans `packages/core/docs/content/locales/<locale>/<slug>.md`.

Utilisez les mêmes BCP-47 locale codes que les catalogues d'app. Gardez le même slug que la source English, préservez les ancres stables avec `{#anchor}` sur les titres traduits, et ne traduisez pas les routes, action names, protocol fields, env vars ou provider names. Si un locale n'a pas de Markdown traduit pour une page, le site revient à English pour cette page tout en localisant la navigation et le chrome.

## Actions et persistance {#actions-and-persistence}

Chaque app hérite de :

- `get-localization-preference` — lit le `{ locale }` de l'utilisateur actuel
- `set-localization-preference` — définit `"system"` ou un locale pris en charge

La valeur durable vit dans les settings SQL à portée utilisateur sous `localization`. `localStorage` sert uniquement au pre-hydration et au fallback anonyme. Le locale actif est reflété dans application state comme contexte ambiant afin que les agents voient la langue actuelle de l'interface.

## Guard {#guard}

Exécutez :

```bash
pnpm guard:i18n-catalogs
```

Le guard vérifie les noms de fichiers locale pris en charge, key parity, placeholder parity, stale keys et catégories plurales CLDR via `Intl.PluralRules`. Il vérifie la structure, pas la qualité de traduction ; les chaînes très visibles nécessitent encore une revue humaine.

Ne traduisez pas les identifiants stables comme action names, routes, enum values, app-state keys, database values, protocol fields, env var names ou provider names.
