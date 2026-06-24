---
title: "国际化"
description: "使用共享语言目录、语言选择器、浏览器语言回退和按语言区分的文档内容来本地化 Agent Native 应用。"
---

# 国际化

Agent Native 应用可以通过共享的 `@agent-native/core/client/i18n` 运行时来本地化框架和模板 UI。框架把用户的语言选择存储在 SQL 设置中，将它暴露为 actions，并在应用尚未翻译某个字符串时回退到 English。

## 运行时 {#runtime}

通过 `AppProviders` 使用 provider：

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

`getLocaleInitScript()` 会在 React hydration 之前设置初始的 `lang`、`dir` 和 `window.__AGENT_NATIVE_LOCALE__`。公共 SSR 路由可以从 `@agent-native/core/server` 调用 `resolveLocaleFromRequest()`，并把解析出的 locale/catalog 传入脚本，避免 hydration 不一致。

## 目录 {#catalogs}

每个本地化模板都把目录放在 `app/i18n/` 下：

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

始终打包 `en-US`。非 English 目录使用动态导入，这样用户只下载当前语言。支持的 locale codes 是 `en-US`、`zh-CN`、`es-ES`、`fr-FR`、`de-DE`、`ja-JP`、`ko-KR`、`pt-BR`、`hi-IN` 和 `ar-SA`。

## UI {#ui}

界面字符串使用 `useT()`，设置页使用 `<LanguagePicker />`：

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

日期、数字、相对时间和列表使用 `useFormatters()`。不要把依赖 locale 的日期或数字格式直接放进翻译字符串。

## 文档站点内容 {#docs-site-content}

公共文档页使用同一个 core provider，但设置 `persistPreference={false}`，因此匿名文档流量使用 localStorage 和浏览器语言，而不是 SQL 设置 actions。English 源文件仍在 `packages/core/docs/content/*.md`。本地化页面覆盖文件放在 `packages/core/docs/content/locales/<locale>/<slug>.md`。

使用与应用目录相同的 BCP-47 locale codes。文件 slug 要与 English 源保持一致，翻译后的标题要用 `{#anchor}` 保留稳定锚点，并且不要翻译 routes、action names、protocol fields、env vars 或 provider names。如果某个 locale 没有某页 Markdown，文档站点会对该页回退到 English，同时继续本地化导航和 chrome。

## Actions 与持久化 {#actions-and-persistence}

每个应用都会继承：

- `get-localization-preference` — 读取当前用户的 `{ locale }`
- `set-localization-preference` — 设置 `"system"` 或支持的 locale

持久值存储在用户作用域 SQL 设置的 `localization` 下。`localStorage` 只用于 hydration 前和匿名回退。当前 locale 会同步到 application state，作为环境上下文，让 agents 能看到当前界面语言。

## Guard {#guard}

运行：

```bash
pnpm guard:i18n-catalogs
```

guard 会通过 `Intl.PluralRules` 验证支持的 locale 文件名、key parity、placeholder parity、stale keys 和 CLDR plural categories。它检查结构，不检查翻译质量；高可见度字符串仍需要人工审校。

不要翻译稳定标识符，例如 action names、routes、enum values、app-state keys、database values、protocol fields、env var names 或 provider names。
