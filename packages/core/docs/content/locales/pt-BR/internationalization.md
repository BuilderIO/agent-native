---
title: "Internacionalização"
description: "Localize apps Agent Native com catálogos compartilhados, seletor de idioma, fallback do navegador e conteúdo de docs por locale."
---

# Internacionalização

Apps Agent Native podem localizar a UI do framework e dos templates com o runtime compartilhado `@agent-native/core/client/i18n`. O framework armazena a escolha de idioma do usuário em settings SQL, expõe essa preferência como actions e volta para English quando uma app ainda não traduziu uma string.

## Runtime {#runtime}

Use o provider por meio de `AppProviders`:

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

`getLocaleInitScript()` define o `lang`, `dir` e `window.__AGENT_NATIVE_LOCALE__` iniciais antes da hydration do React. Rotas SSR públicas podem chamar `resolveLocaleFromRequest()` de `@agent-native/core/server` e passar o locale/catalog resolvido para o script, evitando divergências de hydration.

## Catálogos {#catalogs}

Cada template localizado mantém catálogos em `app/i18n/`:

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

Sempre inclua `en-US` no bundle. Importe dinamicamente catálogos que não sejam English para que usuários baixem apenas o locale ativo. Os locale codes suportados são `en-US`, `zh-CN`, `es-ES`, `fr-FR`, `de-DE`, `ja-JP`, `ko-KR`, `pt-BR`, `hi-IN` e `ar-SA`.

## UI {#ui}

Use `useT()` para textos de interface e `<LanguagePicker />` em settings:

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

Use `useFormatters()` para datas, números, tempo relativo e listas. Não coloque formatação sensível a locale dentro de strings traduzidas.

## Conteúdo do site de docs {#docs-site-content}

Páginas públicas de docs usam o mesmo core provider, mas com `persistPreference={false}` para que tráfego anônimo use localStorage e o idioma do navegador em vez de actions de settings SQL. A fonte English continua em `packages/core/docs/content/*.md`. Overrides localizados ficam em `packages/core/docs/content/locales/<locale>/<slug>.md`.

Use os mesmos BCP-47 locale codes dos catálogos de app. Mantenha o mesmo slug da fonte English, preserve anchors estáveis com `{#anchor}` em headings traduzidos e não traduza routes, action names, protocol fields, env vars ou provider names. Se um locale não tiver Markdown traduzido para uma página, o site cai para English nessa página enquanto continua localizando navegação e chrome.

## Actions e persistência {#actions-and-persistence}

Toda app herda:

- `get-localization-preference` — lê o `{ locale }` do usuário atual
- `set-localization-preference` — define `"system"` ou um locale suportado

O valor durável fica em settings SQL com escopo de usuário sob `localization`. `localStorage` só é usado para pre-hydration e fallback anônimo. O locale ativo é espelhado no application state como contexto ambiente para que agents vejam o idioma atual da interface.

## Guard {#guard}

Rode:

```bash
pnpm guard:i18n-catalogs
```

O guard verifica nomes de arquivos locale suportados, key parity, placeholder parity, stale keys e categorias plurais CLDR via `Intl.PluralRules`. Ele verifica estrutura, não qualidade de tradução; strings de alta visibilidade ainda precisam de revisão humana.

Não traduza identificadores estáveis como action names, routes, enum values, app-state keys, database values, protocol fields, env var names ou provider names.
