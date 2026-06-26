---
title: "國際化"
description: "使用共用區域設定目錄、語言選取器、瀏覽器語言回退和區域設定感知檔案內容本機化 Agent Native 應用。"
---

# 國際化

Agent Native應用程式可以通過共用本機化框架和範本UI
`@agent-native/core/client/i18n` 執行時。框架存儲使用者的
SQL 設定中的語言選取，將其公開為 actions，並回退到
當應用尚未翻譯字串時為英語。

## 執行時

通過`AppProviders`使用提供者：

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

`getLocaleInitScript()` 設定初始 `lang`、`dir` 和
`window.__AGENT_NATIVE_LOCALE__` 在 React 水合之前。公開SSR路線可以
從`@agent-native/core/server`調用`resolveLocaleFromRequest()`並傳遞
將區域設定/目錄解析到該腳本中以避免水合不匹配。

## 目錄

每個本機化範本都將目錄儲存在 `app/i18n/` 下：

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

始終捆綁 `en-US`。動態匯入非英語目錄，僅限使用者
下載活動區域設定。支援的區域設定程式碼為 `en-US`、`zh-CN`、
`es-ES`、`fr-FR`、`de-DE`、`ja-JP`、`ko-KR`、`pt-BR`、`hi-IN` 和 `ar-SA`。

## UI

使用 `useT()` 作為介面字串，並將 `<LanguagePicker />` 放在應用程式的
`/settings` 頁面。側邊欄應用程式應在應用程式側邊欄中公開**設定**；
標題語言圖標只是一個快捷方式。

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

“代理設定”控件應開啟右側代理側邊欄的“設定”分頁
用於模型、API 按鍵、自動化、語音和其他框架級控件。
應用可能會在自己的設定頁面中複製高價值的框架設定
當設定是應用程式的核心，但側邊欄設定分頁仍然是
事實來源。

使用 `useFormatters()` 表示日期、數字、相對時間和列表。不要放
翻譯字串中區域設定敏感的日期/數字格式。

## 檔案網站內容 {#docs-site-content}

公開檔案頁面使用相同的核心提供程序，但具有
`persistPreference={false}` 因此匿名檔案流量使用 localStorage 和
瀏覽器語言而不是 SQL 設定 actions。英文來源程式碼保留在
`packages/core/docs/content/*.md`。本機化頁面覆蓋其旁邊的實時頁面
`packages/core/docs/content/locales/<locale>/<slug>.md`.

使用與應用程式目錄相同的 BCP-47 區域設定程式碼。保留與
英文來源，在翻譯的標題上使用 `{#anchor}` 保留穩定的錨點，
並留下路由、操作名稱、協議欄位、環境變數和提供程序名稱
未翻譯。如果某個語言環境沒有為頁面翻譯 Markdown，則檔案站點
該頁面恢復為英語，同時仍本機化導覽和 Chrome。

Docs Markdown 可能包含結構化的 `an-*` 可視塊。請在合理時翻譯其中面向使用者的文本欄位，例如 file-tree 標題和 `entries[].note`、callout 內文、tab 標籤以及 annotated-code 的 labels/notes。保持穩定標識符不變：檔案名、路徑、env vars、路由字串、action 名稱、language tags、程式碼片段、JSON keys 和協議名稱。

## Actions和堅持

每個應用程式都會繼承：

- `get-localization-preference` — 讀取目前使用者的`{ locale }`
- `set-localization-preference` — 設定 `"system"` 或支援的區域設定

持久值存在於 `localization` 下的使用者範圍 SQL 設定中。
`localStorage` 僅用於預水合和匿名回退。主動
區域設定作為環境上下文鏡像到應用程式狀態中，以便代理可以看到
目前介面語言。

## 守衛

執行：

```bash
pnpm guard:i18n-catalogs
```

守衛驗證支援的區域設定檔案名、金鑰對等、預留位置對等，
過時的金鑰，以及 CLDR 複數類別到 `Intl.PluralRules`。它檢查
結構，而不是翻譯品質；高可見度字串仍然需要人類
審查。

不要翻譯穩定的標識符，例如操作名稱、路由、枚舉值，
應用程式狀態鍵、資料庫值、協議欄位、環境變數名稱或提供程序
名字。
