---
title: "Internacionalización"
description: "Localiza apps Agent Native con catálogos compartidos, selector de idioma, fallback al navegador y contenido de docs por locale."
---

# Internacionalización

Las apps Agent Native pueden localizar la UI del framework y de las plantillas con el runtime compartido `@agent-native/core/client/i18n`. El framework guarda la elección de idioma del usuario en settings SQL, la expone como actions y vuelve a English cuando una app aún no tradujo una cadena.

## Runtime {#runtime}

Usa el provider a través de `AppProviders`:

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

`getLocaleInitScript()` define el `lang`, `dir` y `window.__AGENT_NATIVE_LOCALE__` iniciales antes de que React hidrate. Las rutas SSR públicas pueden llamar a `resolveLocaleFromRequest()` desde `@agent-native/core/server` y pasar el locale/catalog resuelto al script para evitar desajustes de hydration.

## Catálogos {#catalogs}

Cada plantilla localizada mantiene catálogos en `app/i18n/`:

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

Incluye siempre `en-US`. Importa dinámicamente los catálogos que no sean English para que cada usuario descargue solo el locale activo. Los locale codes admitidos son `en-US`, `zh-CN`, `es-ES`, `fr-FR`, `de-DE`, `ja-JP`, `ko-KR`, `pt-BR`, `hi-IN` y `ar-SA`.

## UI {#ui}

Usa `useT()` para textos de interfaz y `<LanguagePicker />` en settings:

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

Usa `useFormatters()` para fechas, números, tiempo relativo y listas. No pongas formatos sensibles al locale dentro de cadenas traducidas.

## Contenido del sitio de docs {#docs-site-content}

Las páginas públicas de docs usan el mismo core provider, pero con `persistPreference={false}` para que el tráfico anónimo use localStorage y el idioma del navegador en vez de actions de settings SQL. La fuente English queda en `packages/core/docs/content/*.md`. Las páginas localizadas que sobrescriben esa fuente viven en `packages/core/docs/content/locales/<locale>/<slug>.md`.

Usa los mismos BCP-47 locale codes que los catálogos de app. Conserva el mismo slug que la fuente English, preserva anclas estables con `{#anchor}` en headings traducidos y no traduzcas routes, action names, protocol fields, env vars ni provider names. Si un locale no tiene Markdown traducido para una página, el sitio cae a English para esa página mientras sigue localizando la navegación y el chrome.

## Actions y persistencia {#actions-and-persistence}

Cada app hereda:

- `get-localization-preference` — lee el `{ locale }` del usuario actual
- `set-localization-preference` — define `"system"` o un locale admitido

El valor durable vive en settings SQL con alcance de usuario bajo `localization`. `localStorage` solo se usa para pre-hydration y fallback anónimo. El locale activo se refleja en application state como contexto ambiental para que los agents vean el idioma actual de la interfaz.

## Guard {#guard}

Ejecuta:

```bash
pnpm guard:i18n-catalogs
```

El guard verifica nombres de archivos locale admitidos, key parity, placeholder parity, stale keys y categorías plurales CLDR mediante `Intl.PluralRules`. Revisa estructura, no calidad de traducción; las cadenas de alta visibilidad necesitan revisión humana.

No traduzcas identificadores estables como action names, routes, enum values, app-state keys, database values, protocol fields, env var names o provider names.
