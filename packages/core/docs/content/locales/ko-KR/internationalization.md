---
title: "국제화"
description: "공유 locale 카탈로그, 언어 선택기, 브라우저 언어 fallback, locale-aware docs 콘텐츠로 Agent Native 앱을 현지화합니다."
---

# 국제화

Agent Native 앱은 공유 `@agent-native/core/client/i18n` 런타임으로 framework 및 template UI를 현지화할 수 있습니다. framework는 사용자의 언어 선택을 SQL settings에 저장하고 actions로 노출하며, 앱에 번역되지 않은 문자열이 있으면 English로 fallback합니다.

## 런타임 {#runtime}

`AppProviders`를 통해 provider를 사용합니다.

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

`getLocaleInitScript()`는 React hydration 전에 초기 `lang`, `dir`, `window.__AGENT_NATIVE_LOCALE__`를 설정합니다. 공개 SSR route는 `@agent-native/core/server`에서 `resolveLocaleFromRequest()`를 호출하고 해결된 locale/catalog를 script에 전달해 hydration mismatch를 피할 수 있습니다.

## 카탈로그 {#catalogs}

현지화된 각 template은 `app/i18n/` 아래에 카탈로그를 둡니다.

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

항상 `en-US`를 bundle에 포함하세요. English가 아닌 카탈로그는 dynamic import로 불러와 사용자가 활성 locale만 다운로드하게 합니다. 지원 locale codes는 `en-US`, `zh-CN`, `es-ES`, `fr-FR`, `de-DE`, `ja-JP`, `ko-KR`, `pt-BR`, `hi-IN`, `ar-SA`입니다.

## UI {#ui}

인터페이스 문자열에는 `useT()`를 사용하고 settings에는 `<LanguagePicker />`를 둡니다.

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

날짜, 숫자, 상대 시간, 목록에는 `useFormatters()`를 사용하세요. locale에 민감한 날짜나 숫자 formatting을 번역 문자열 안에 넣지 마세요.

## Docs 사이트 콘텐츠 {#docs-site-content}

공개 docs 페이지는 같은 core provider를 사용하지만 `persistPreference={false}`로 설정해 익명 docs 트래픽이 SQL settings actions가 아니라 localStorage와 브라우저 언어를 사용하게 합니다. English 원본은 `packages/core/docs/content/*.md`에 남습니다. 현지화된 페이지 override는 `packages/core/docs/content/locales/<locale>/<slug>.md`에 둡니다.

앱 카탈로그와 같은 BCP-47 locale codes를 사용하세요. English 원본과 같은 slug를 유지하고, 번역된 heading에는 `{#anchor}`로 안정적인 anchor를 보존하며, routes, action names, protocol fields, env vars, provider names는 번역하지 마세요. 특정 locale에 번역 Markdown이 없으면 그 페이지는 English로 fallback하고 navigation과 chrome은 계속 현지화됩니다.

## Actions 및 지속성 {#actions-and-persistence}

모든 앱은 다음을 상속합니다.

- `get-localization-preference` — 현재 사용자의 `{ locale }` 읽기
- `set-localization-preference` — `"system"` 또는 지원 locale 설정

지속 값은 user-scoped SQL settings의 `localization`에 저장됩니다. `localStorage`는 pre-hydration과 익명 fallback에만 사용됩니다. 활성 locale은 ambient context로 application state에 반영되어 agents가 현재 UI 언어를 볼 수 있습니다.

## Guard {#guard}

실행:

```bash
pnpm guard:i18n-catalogs
```

guard는 지원 locale filename, key parity, placeholder parity, stale keys, 그리고 `Intl.PluralRules`를 통한 CLDR plural categories를 검증합니다. 구조만 확인하며 번역 품질은 확인하지 않습니다. 노출도가 높은 문자열은 사람의 검토가 필요합니다.

action names, routes, enum values, app-state keys, database values, protocol fields, env var names, provider names 같은 안정적인 식별자는 번역하지 마세요.
