---
title: "अंतरराष्ट्रीयकरण"
description: "shared locale catalogs, language picker, browser-language fallback और locale-aware docs content के साथ Agent Native apps को localize करें।"
---

# अंतरराष्ट्रीयकरण

Agent Native apps shared `@agent-native/core/client/i18n` runtime के जरिए framework और template UI को localize कर सकते हैं। framework उपयोगकर्ता की भाषा पसंद को SQL settings में store करता है, उसे actions के रूप में expose करता है, और जब किसी app में कोई string translate नहीं होती तो English पर fallback करता है।

## Runtime {#runtime}

Provider को `AppProviders` के जरिए इस्तेमाल करें:

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

`getLocaleInitScript()` React hydration से पहले शुरुआती `lang`, `dir`, और `window.__AGENT_NATIVE_LOCALE__` सेट करता है। Public SSR routes `@agent-native/core/server` से `resolveLocaleFromRequest()` call कर सकते हैं और resolved locale/catalog को script में pass कर सकते हैं ताकि hydration mismatch न हो।

## Catalogs {#catalogs}

हर localized template catalogs को `app/i18n/` में रखता है:

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

हमेशा `en-US` bundle करें। Non-English catalogs को dynamic import करें ताकि users केवल active locale download करें। Supported locale codes हैं `en-US`, `zh-CN`, `es-ES`, `fr-FR`, `de-DE`, `ja-JP`, `ko-KR`, `pt-BR`, `hi-IN`, और `ar-SA`।

## UI {#ui}

Interface strings के लिए `useT()` और settings में `<LanguagePicker />` इस्तेमाल करें:

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

Dates, numbers, relative time और lists के लिए `useFormatters()` इस्तेमाल करें। Locale-sensitive date/number formatting को translation strings में embed न करें।

## Docs site content {#docs-site-content}

Public docs pages वही core provider इस्तेमाल करते हैं, लेकिन `persistPreference={false}` के साथ, ताकि anonymous docs traffic SQL settings actions की जगह localStorage और browser language इस्तेमाल करे। English source `packages/core/docs/content/*.md` में रहता है। Localized page overrides `packages/core/docs/content/locales/<locale>/<slug>.md` में रहते हैं।

App catalogs जैसे ही BCP-47 locale codes इस्तेमाल करें। English source जैसा slug रखें, translated headings पर `{#anchor}` से stable anchors preserve करें, और routes, action names, protocol fields, env vars या provider names translate न करें। अगर किसी locale में किसी page का translated Markdown नहीं है, docs site उस page के लिए English fallback करेगा और navigation/chrome फिर भी localize रहेगा।

## Actions और persistence {#actions-and-persistence}

हर app को मिलता है:

- `get-localization-preference` — current user का `{ locale }` पढ़ता है
- `set-localization-preference` — `"system"` या supported locale सेट करता है

Durable value user-scoped SQL settings में `localization` key के तहत रहता है। `localStorage` केवल pre-hydration और anonymous fallback के लिए है। Active locale application state में ambient context के रूप में mirror होता है ताकि agents current interface language देख सकें।

## Guard {#guard}

चलाएं:

```bash
pnpm guard:i18n-catalogs
```

Guard supported locale filenames, key parity, placeholder parity, stale keys, और `Intl.PluralRules` के जरिए CLDR plural categories verify करता है। यह structure check करता है, translation quality नहीं; high-visibility strings को human review चाहिए।

Stable identifiers जैसे action names, routes, enum values, app-state keys, database values, protocol fields, env var names या provider names translate न करें।
