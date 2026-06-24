---
title: "国際化"
description: "共有 locale カタログ、言語ピッカー、ブラウザー言語フォールバック、locale 対応 docs コンテンツで Agent Native アプリをローカライズします。"
---

# 国際化

Agent Native アプリは共有ランタイム `@agent-native/core/client/i18n` を通じて、フレームワークとテンプレートの UI をローカライズできます。フレームワークはユーザーの言語選択を SQL settings に保存し、それを actions として公開し、アプリがまだ翻訳していない文字列は English にフォールバックします。

## ランタイム {#runtime}

`AppProviders` から provider を使います。

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

`getLocaleInitScript()` は React の hydration 前に初期 `lang`、`dir`、`window.__AGENT_NATIVE_LOCALE__` を設定します。公開 SSR ルートでは `@agent-native/core/server` の `resolveLocaleFromRequest()` を呼び、解決された locale/catalog をこの script に渡すことで hydration mismatch を避けられます。

## カタログ {#catalogs}

ローカライズされた各テンプレートは `app/i18n/` にカタログを置きます。

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

`en-US` は必ずバンドルします。English 以外のカタログは動的 import にして、ユーザーが現在の locale だけをダウンロードするようにします。対応する locale codes は `en-US`、`zh-CN`、`es-ES`、`fr-FR`、`de-DE`、`ja-JP`、`ko-KR`、`pt-BR`、`hi-IN`、`ar-SA` です。

## UI {#ui}

インターフェイス文字列には `useT()` を使い、settings には `<LanguagePicker />` を置きます。

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

日付、数値、相対時間、リストには `useFormatters()` を使います。locale に依存する日付や数値の整形を翻訳文字列の中に入れないでください。

## Docs サイトのコンテンツ {#docs-site-content}

公開 docs ページは同じ core provider を使いますが、`persistPreference={false}` にして匿名 docs トラフィックが SQL settings actions ではなく localStorage とブラウザー言語を使うようにします。English のソースは `packages/core/docs/content/*.md` に残ります。ローカライズされたページ override は `packages/core/docs/content/locales/<locale>/<slug>.md` に置きます。

アプリのカタログと同じ BCP-47 locale codes を使ってください。English ソースと同じ slug を維持し、翻訳された見出しでは `{#anchor}` で安定したアンカーを保ち、routes、action names、protocol fields、env vars、provider names は翻訳しません。ある locale に翻訳 Markdown がないページは English にフォールバックしつつ、ナビゲーションと chrome はローカライズされます。

## Actions と永続化 {#actions-and-persistence}

すべてのアプリは以下を継承します。

- `get-localization-preference` — 現在のユーザーの `{ locale }` を読む
- `set-localization-preference` — `"system"` または対応 locale を設定する

永続値はユーザー単位の SQL settings の `localization` に保存されます。`localStorage` は pre-hydration と匿名フォールバックにだけ使います。アクティブな locale は application state に環境コンテキストとして反映されるため、agents は現在の UI 言語を確認できます。

## Guard {#guard}

実行:

```bash
pnpm guard:i18n-catalogs
```

guard は対応 locale ファイル名、key parity、placeholder parity、stale keys、`Intl.PluralRules` による CLDR plural categories を検証します。構造を検証するもので、翻訳品質は検証しません。目立つ文字列は人によるレビューが必要です。

action names、routes、enum values、app-state keys、database values、protocol fields、env var names、provider names などの安定した識別子は翻訳しないでください。
