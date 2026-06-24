---
title: "التدويل"
description: "قم بتعريب تطبيقات Agent Native باستخدام كتالوجات locale مشتركة، واختيار اللغة، والرجوع إلى لغة المتصفح، ومحتوى docs حسب locale."
---

# التدويل

يمكن لتطبيقات Agent Native تعريب واجهة framework و templates عبر runtime المشترك `@agent-native/core/client/i18n`. يخزن framework اختيار لغة المستخدم في SQL settings، ويعرضه كـ actions، ويرجع إلى English عندما لا تكون string مترجمة في التطبيق بعد.

## Runtime {#runtime}

استخدم provider عبر `AppProviders`:

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

يضبط `getLocaleInitScript()` قيم `lang` و `dir` و `window.__AGENT_NATIVE_LOCALE__` قبل React hydration. يمكن لمسارات SSR العامة استدعاء `resolveLocaleFromRequest()` من `@agent-native/core/server` وتمرير locale/catalog الناتج إلى script لتجنب hydration mismatches.

## Catalogs {#catalogs}

كل template مترجم يحتفظ بالكتالوجات تحت `app/i18n/`:

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

احزم `en-US` دائماً. استخدم dynamic import للكتالوجات غير English حتى ينزل المستخدمون locale النشط فقط. locale codes المدعومة هي `en-US` و `zh-CN` و `es-ES` و `fr-FR` و `de-DE` و `ja-JP` و `ko-KR` و `pt-BR` و `hi-IN` و `ar-SA`.

## UI {#ui}

استخدم `useT()` لنصوص الواجهة و `<LanguagePicker />` في settings:

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

استخدم `useFormatters()` للتواريخ، والأرقام، والوقت النسبي، والقوائم. لا تضع تنسيق التاريخ أو الرقم المعتمد على locale داخل strings المترجمة.

## محتوى موقع docs {#docs-site-content}

تستخدم صفحات docs العامة نفس core provider، لكن مع `persistPreference={false}` حتى يستخدم زوار docs المجهولون localStorage ولغة المتصفح بدلاً من SQL settings actions. يبقى مصدر English في `packages/core/docs/content/*.md`. توجد overrides المترجمة في `packages/core/docs/content/locales/<locale>/<slug>.md`.

استخدم نفس BCP-47 locale codes الخاصة بكتالوجات التطبيقات. حافظ على نفس slug الموجود في مصدر English، واحفظ anchors ثابتة باستخدام `{#anchor}` على headings المترجمة، ولا تترجم routes أو action names أو protocol fields أو env vars أو provider names. إذا لم يملك locale ملف Markdown مترجماً لصفحة ما، يعود موقع docs إلى English لتلك الصفحة مع استمرار تعريب navigation و chrome.

## Actions والاستمرارية {#actions-and-persistence}

كل تطبيق يرث:

- `get-localization-preference` — يقرأ `{ locale }` للمستخدم الحالي
- `set-localization-preference` — يضبط `"system"` أو locale مدعوماً

القيمة الدائمة موجودة في SQL settings بنطاق المستخدم تحت `localization`. يستخدم `localStorage` فقط قبل hydration وللرجوع المجهول. ينعكس locale النشط في application state كسياق محيط حتى تتمكن agents من رؤية لغة الواجهة الحالية.

## Guard {#guard}

شغّل:

```bash
pnpm guard:i18n-catalogs
```

يتحقق guard من أسماء ملفات locale المدعومة، و key parity، و placeholder parity، و stale keys، وفئات CLDR plural عبر `Intl.PluralRules`. هو يتحقق من البنية لا جودة الترجمة؛ strings البارزة ما زالت تحتاج مراجعة بشرية.

لا تترجم المعرفات الثابتة مثل action names أو routes أو enum values أو app-state keys أو database values أو protocol fields أو env var names أو provider names.
