---
title: "コンテキスト認識"
description: "エージェントがユーザーが何を見ているのかを知る方法: ナビゲーション状態、選択コンテキスト、ビュー画面、sendToAgentChat ハンドオフ、ナビゲート コマンド、ジッター防止。"
---

# コンテキスト認識

> **開発者ページ。** このページは、アプリのコンテキスト レイヤーを接続する開発者向けです。エンドユーザー エクスペリエンス (エージェントが会話でそのコンテキストをどのように使用するか) については、[Using Your Agent](/docs/using-your-agent) を参照してください。

エージェントがユーザーが見ているものをどのように認識するか、またエージェントがユーザーが見ているものをどのように制御できるか。

## 概要 {#overview}

コンテキスト認識がなければ、エージェントは盲目です。 「どのメールですか?」と尋ねられます。ユーザーがそれを見つめているとき。現在の選択内容に基づいて動作したり、関連する提案を提供したり、ユーザーに表示される内容を変更したりすることはできません。コンテキスト認識を使用すると、ユーザーは行をクリックするか、段落を強調表示するか、スライド要素を選択するか、Cmd+I を押して「これを要約してください」と言うことができ、エージェントは「これ」が何を意味するかをすでに理解しています。

どのサーフェスに何を配置するかを理解するには (AGENTS.md 対 skills 対 application_state)、[Writing Agent Instructions — The four surfaces the agent sees](/docs/writing-agent-instructions#four-surfaces) を参照してください。

6 つのパターンでこれを解決します:

1. **ナビゲーション状態** -- UI は、ルートが変更されるたびに `navigation` キーをアプリケーション状態に書き込みます
2. **現在の URL** -- フレームワークは `__url__` を書き込むため、クエリ パラメータはエージェントによって表示および編集可能です
3. **選択状態** -- ユーザーが意味のあるものをフォーカス、選択、または複数選択すると、UI は `selection` キーを書き込みます
4. **`view-screen`** -- アプリケーションの状態を読み取り、コンテキスト データをフェッチし、ユーザーに表示されるもののスナップショットを返すアクション
5. **プロンプトハンドオフ** -- クリックがエージェントターンになると、UI コントロールが `sendToAgentChat()` を呼び出します
6. **`navigate`** -- UI に行き先を伝えるエージェントからのワンショット コマンド

```an-diagram title="あなたが見ているものをエージェントはどう見るか" summary="UI は軽量の状態キーを書き込みます。ビュースクリーンはそれらを実際の記録に統合します。エージェントは、UI を移動するために「navigate back」を書き込むことができます。"
{
  "html": "<div class=\"diagram-ctx\"><div class=\"diagram-card col\"><span class=\"diagram-pill\">UIが書き込む</span><div class=\"diagram-node\">navigation<br><small class=\"diagram-muted\">ビュー、開いているID</small></div><div class=\"diagram-node\">__url__<br><small class=\"diagram-muted\">shareable filters</small></div><div class=\"diagram-node\">selection<br><small class=\"diagram-muted\">行、ブロック、図形</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">view-screen</span><small class=\"diagram-muted\">reads state &middot; fetches records</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">エージェントが実行<br><small class=\"diagram-muted\">on the real object</small></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-box diagram-accent\">navigate<br><small class=\"diagram-muted\">エージェントがUIを移動</small></div></div>",
  "css": ".diagram-ctx{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-ctx .col{display:flex;flex-direction:column;gap:8px;padding:14px}.diagram-ctx .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-ctx .diagram-arrow{font-size:22px;line-height:1}"
}
```

## コンテキスト レイヤー {#context-layers}

ジョブごとに異なるコンテキスト チャネルを使用する:

| レイヤー                                   | オーナー                    | 次の目的で使用してください                                                                   |
| ------------------------------------------ | --------------------------- | -------------------------------------------------------------------------------------------- |
| `navigation` アプリ状態キー                | UI                          | セマンティック ルートの状態: 現在のビュー、開いているレコード、アクティブなタブ、安定した ID |
| `__url__` アプリ状態キー                   | フレームワーク UI           | 現在のパス名、検索文字列、ハッシュ、および解析された URL クエリ パラメータ                   |
| `__set_url__` アプリ状態キー               | エージェント/フレームワーク | `set-search-params` および `set-url-path` からのワンショット URL 編集                        |
| `selection` アプリ状態キー                 | UI                          | 永続的なセマンティック選択: 行、ブロック、図形、アセット、メッセージ                         |
| `pending-selection-context` アプリ状態キー | UI / `AgentPanel`           | 次のチャット ターンに添付されるワンショットの選択テキスト (通常は Cmd+I から)                |
| `view-screen` アクション                   | エージェント                | アプリ状態キーを実際のレコードと画面概要にハイドレートする                                   |
| `sendToAgentChat()`                        | UI                          | クリック、コマンド、コメントピン、または選択した項目をチャットプロンプトに変える             |
| `navigate` アプリ状態キー                  | エージェント                | UI に別のルートに移動するか、別のオブジェクトにフォーカスするよう依頼する                    |

短いバージョン: URL クエリ パラメータは共有可能なフィルターの信頼情報源であり、`navigation` はセマンティック ID とビュー名を保存し、`view-screen` はそれらの状態レイヤーを有用なデータに変換し、`sendToAgentChat()` はユーザーがコマンドをクリックしたときに UI インテントをチャット メッセージに変換します。

## ナビゲーション状態 {#navigation-state}

UI は、ルートが変更されるたびに、`navigation` キーをアプリケーション状態に書き込みます。これにより、ユーザーがどのビューにいるか、どのアイテムが開いているか、どのセマンティック UI 状態が重要であるかがエージェントに伝わります。

```json
{
  "view": "inbox",
  "threadId": "thread-123",
  "focusedEmailId": "msg-456",
  "label": "important"
}
```

ナビゲーション状態に含めるもの:

- `view` -- 「受信箱」、「フォームビルダー」、「ダッシュボード」などの現在のページ/セクション
- アイテム ID -- 選択/開いているアイテム (`threadId` や `formId` など)
- セマンティック エイリアス -- アクティブなタブ、ラベル名、またはエージェントの推論に役立つその他の安定したアプリの概念
- ライトフォーカス状態 -- フォーカスされた行、アクティブなタブ、現在のパネル

`navigation` を小さくセマンティックに保ちます。レコード全体を複製したり、すべてのクエリ パラメータをミラーリングしたりするのではなく、現在の画面を識別する必要があります。 `view-screen` でレコードをフェッチし、エージェントが常に最新のデータを取得できるようにします。

エージェントは行動する前にこれを読みます:

```ts
import { readAppState } from "@agent-native/core/application-state";

const navigation = await readAppState("navigation");
// { view: "inbox", threadId: "thread-123", label: "important" }
```

## 現在の URL とフィルター {#current-url}

`AgentPanel` は、現在の React ルーター URL を `__url__` アプリケーション状態キーに自動的に同期します。組み込みエージェントは、毎ターンこれを `<current-url>` ブロックとして含めます:

```text
<current-url>
pathname: /adhoc/revenue
search: ?f_region=west&q=renewal
searchParams:
  f_region: west
  q: renewal
</current-url>
```

これは、共有可能なフィルター状態の正規レイヤーです。ユーザーが URL をコピーして、同じフィルター処理されたリストに戻ることができる場合、フィルターはクエリ文字列に属します。エージェントは、組み込みの `set-search-params` ツールを使用してこれらのフィルターを変更できます。

```text
set-search-params({ "params": { "f_region": "east", "q": null } })
```

`navigation` は、`view-screen` が適切なデータをフェッチまたは要約するのに役立つセマンティック エイリアスにのみ使用してください。ダッシュボードは `navigation.dashboardId` を保持し、`__url__.searchParams` が `f_region`、`f_dateStart`、および `q` を所有する可能性があります。

`view-screen` がより豊富なスナップショットを返す場合、重要な URL フィルターをフレンドリーな `activeFilters` オブジェクトにコピーできます。

```ts
const url = (await readAppState("__url__")) as {
  searchParams?: Record<string, string>;
} | null;

if (url?.searchParams) {
  screen.activeFilters = Object.fromEntries(
    Object.entries(url.searchParams).filter(
      ([key, value]) => key.startsWith("f_") && value,
    ),
  );
}
```

## 選択状態 {#selection-state}

選択はセマンティック UI 状態です。これは、「クリックしたグラフ」、「これらの 3 行」、「このスライドのタイトル」、または「現在のメールの下書き範囲」がモデルに表示されるコンテキストになる方法です。

ナビゲーション、空のチャットの提案、またはその後の `view-screen` 呼び出しの瞬間に存続する永続的な選択には、`selection` アプリ状態キーを使用します。

```json
{
  "kind": "slide.elements",
  "deckId": "deck-123",
  "slideId": "slide-4",
  "items": [
    {
      "id": "hero-title",
      "selector": "[data-block-id='hero-title']",
      "label": "Hero title",
      "text": "Q3 ローンチ plan"
    }
  ],
  "capturedAt": 1780332977027
}
```

ユーザーが意味のあるオブジェクトを選択、フォーカス、または複数選択したときに、UI から書き込みます。

```tsx
import { setClientAppState } from "@agent-native/core/client";

async function syncSelection(selection: unknown | null) {
  await setClientAppState("selection", selection, { keepalive: true });
}
```

良好な選択状態には次のものが含まれます:

- エージェントが actions で使用できる安定した ID (`threadId`、`slideId`、`assetId` など)
- プロンプトや提案が読みやすいように人間による短いラベル
- オブジェクトを明確にするのに十分なテキストまたはメタデータ
- エージェントが視覚要素を参照する必要がある場合のセレクターや座標などのオプションの UI ロケーター
- 古い選択が有害な場合の `capturedAt`

シークレット、完全なドキュメント、大きなバイナリ ペイロード、または API 応答全体を `selection` に保存することは避けてください。 ID と短い抜粋を保存し、`view-screen` に現在の信頼できる情報源を取得させます。

### 選択されたワンショットのテキスト {#pending-selection-context}

`AgentPanel` は、一般的なテキスト選択フローをすでに処理しています。ユーザーがページ上でテキストを選択した状態で Cmd+I (または Ctrl+I) を押すと、次のことが行われます。

1. `window.getSelection()` を読み取ります
2. `{ text, capturedAt }` を `pending-selection-context` に書き込みます
3. エージェントのチャットに焦点を当てます

本番エージェントは、そのキーを即時選択コンテキストとして次のターンに挿入し、キーが古くなると無視します。これは、ユーザーが選択内容をプロンプトにコピーしなくても、「テキストを選択し、Cmd+I を押して、「これをパンチにします」と尋ねる」を機能させるパスです。

カスタム エディターは、その選択内容がネイティブ ブラウザーの選択内容で表されない場合に、同じキーを書き込むことができます。

```tsx
import { setClientAppState } from "@agent-native/core/client";

await setClientAppState(
  "pending-selection-context",
  {
    text: selectedMarkdown,
    capturedAt: Date.now(),
  },
  { keepalive: true },
);
```

ワンショットの「この強調表示されたテキストに基づいて操作する」フローには、`pending-selection-context` を使用します。 `selection` は、`view-screen` と動的提案で継続的に表示される永続的なオブジェクトの選択に使用します。

## 画面表示アクション {#view-screen-action}

すべてのテンプレートには `view-screen` アクションが必要です。ナビゲーションと選択状態を読み取り、関連データをフェッチし、ユーザーに表示されているもののスナップショットを返します。これはエージェントの目です。

```an-annotated-code title="ビュースクリーン — エージェントの目"
{
  "filename": "actions/view-screen.ts",
  "language": "ts",
  "code": "import { defineAction } from \"@agent-native/core/action\";\nimport { readAppState } from \"@agent-native/core/application-state\";\nimport { eq, inArray } from \"drizzle-orm\";\nimport { z } from \"zod\";\nimport { getDb, schema } from \"../server/db/index.js\";\n\nexport default defineAction({\n  description:\n    \"See what the user is currently looking at on screen.\",\n  schema: z.object({}),\n  http: false,\n  run: async () => {\n    const navigation = (await readAppState(\"navigation\")) as any;\n    const selection = (await readAppState(\"selection\")) as any;\n    const screen: Record<string, unknown> = {};\n    if (navigation) screen.navigation = navigation;\n    if (selection) screen.selection = selection;\n\n    const db = getDb();\n\n    // Fetch data based on what the user is viewing\n    if (navigation?.view === \"inbox\") {\n      screen.emailList = await db\n        .select()\n        .from(schema.emails)\n        .where(eq(schema.emails.label, navigation.label));\n    }\n    if (navigation?.threadId) {\n      screen.thread = await db\n        .select()\n        .from(schema.threads)\n        .where(eq(schema.threads.id, navigation.threadId));\n    }\n    if (selection?.kind === \"email.messages\") {\n      screen.selectedMessages = await db\n        .select()\n        .from(schema.emails)\n        .where(inArray(schema.emails.id, selection.messageIds));\n    }\n\n    if (Object.keys(screen).length === 0) {\n      return \"No application state found. Is the app running?\";\n    }\n    return screen;\n  },\n});",
  "annotations": [
    { "lines": "10-11", "label": "工具表面", "note": "エージェントはこの説明を読んで、`view-screen` を呼び出して現在の UI を確認できることを知ります。" },
    { "lines": "13", "label": "http: false", "note": "内部アクション — HTTP では公開されません。ブラウザではなく、エージェントと `pnpm action` がそれを呼び出します。" },
    { "lines": "15-16", "label": "読み取り状態", "note": "UI が作成した軽量の `navigation` キーと `selection` キーを取得します。" },
    { "lines": "23-37", "label": "水分補給", "note": "これらの ID を SQL から直接**新鮮**レコードに変換するため、エージェントは動作する前にライブ オブジェクトを確認します。" }
  ]
}
```

エージェントは、現在の UI で動作する前に、`pnpm action view-screen` を呼び出す必要があります。これは、すべてのテンプレートにわたる厳格な規則です。新しいフィーチャを追加するときは、新しいビューと新しい選択形状のデータを返すように `view-screen` を更新します。

```an-callout
{
  "tone": "info",
  "body": "**`navigation` と `selection` は小さくしてください。**レコード全体ではなく、ID と短いラベルを保存します。 `view-screen` はオンデマンドで信頼できる情報源を取得するため、古い状態や大量の状態がエージェントに届くことはありません。"
}
```

## `sendToAgentChat()` による即時ハンドオフ {#send-to-agent-chat}

コンテキストはアプリの状態に留まるべきではない場合があります。ユーザーはボタンをクリックするか、コメントピンをドロップするか、項目を選択して「エージェントに質問」を選択するか、ツールバーの AI コマンドを押します。そのクリックが指示です。ブラウザ UI で、`sendToAgentChat()` を使用してエージェントに渡します。

```tsx
import { sendToAgentChat } from "@agent-native/core/client";

function askAgentAboutSelection(selection: {
  documentId: string;
  blockId: string;
  label: string;
  text: string;
}) {
  sendToAgentChat({
    message: `Improve the selected block: ${selection.label}`,
    context: [
      `Document id: ${selection.documentId}`,
      `Block id: ${selection.blockId}`,
      "Current selected text:",
      selection.text,
    ].join("\n"),
    submit: false,
    openSidebar: true,
  });
}
```

フィールドは慎重に使用してください:

| フィールド          | 意味                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `message`           | チャットに表示されるプロンプト テキスト                                                            |
| `context`           | モデルに表示される非表示のコンテキスト。ユーザー向けのチャット テキストとしては表示されません      |
| `submit: true`      | すぐに送信します。 「レイアウトを修正」などの明示的なコマンド ボタンに適しています。               |
| `submit: false`     | ユーザーレビュー用に事前入力; 「エージェントにこれについて質問する」または曖昧な選択に適しています |
| `openSidebar: true` | パネルが折りたたまれている場合でもエージェントの応答を表示できるようにします                       |
| `newTab: true`      | 大規模な作成タスク用に別のチャット スレッドを開始します                                            |
| `type: "code"`      | リクエストがアプリのソースの変更に関するものである場合は、コード編集フレームにルーティングします   |

`sendToAgentChat()` は、内部的に `agentNative.submitChat` として認識されることがある送信チャット パスのサポートされているブラウザ ラッパーです。アプリ UI は、`agentNative.submitChat` を直接ポストするのではなく、ラッパーを呼び出す必要があります。これは、ラッパーがローカル サイドバー、Builder/フレーム ルーティング、MCP アプリ ホスト ルーティング、タブ ID、およびコードリクエスト ルーティングを処理するためです。

ブラウザのサイドバーがないノード/スクリプト コンテキストには、`agentChat.submit()` または `agentChat.prefill()` を使用します。サーバー actions は通常、ブラウザ専用 `sendToAgentChat()` を呼び出すべきではありません。アクションでエージェントに何かを尋ねるためにオープンな UI が必要な場合は、小さなリクエストを `application_state` に書き込み、UI ブリッジがブラウザからリクエストを送信できるようにします。

### プロンプト内のクリックされたアイテム {#clicked-items-in-prompt}

「UI 内の項目をクリックするとプロンプトの一部になる」エクスペリエンスを実現するには、選択状態とプロンプトのハンドオフを組み合わせます。

1. クリックまたは複数選択時に、セマンティック `selection` 状態を書き込み、`view-screen`、動的提案、および将来のターンで確認できるようにします。
2. クリックもコマンドである場合は、簡潔な表示 `message` とより豊富な非表示 `context` を使用して `sendToAgentChat()` を呼び出します。
3. `view-screen` では、選択した ID を現在のレコードにハイドレートして、エージェントがオブジェクトを変更する前に検証できるようにします。
4. オブジェクトが選択されなくなったり、削除されたり、関連性がなくなった場合は、`selection` をクリアします。

これにより、ユーザーは、すべてのプロンプトに目に見えるかさばるコンテキストを詰め込むことなく、「これが私が言いたかったことです」という魔法のような動作を得ることができます。

## ナビゲートアクション {#navigate-action}

`navigate` は `navigation` の鏡像です。 `navigation` はエージェントにユーザーの居場所を伝える UI で、`navigate` は UI に行き先を伝えるエージェントです。エージェントは、ワンショット `navigate` コマンドを application-state に書き込みます。 UI はそれを読み取り、ナビゲーションを実行してから、エントリを削除します。

```ts
// Agent side -- write a navigate command
import { writeAppState } from "@agent-native/core/application-state";

await writeAppState("navigate", { view: "inbox", threadId: "thread-123" });
```

UI 側では、このキーを手動でポーリングしたり削除したりすることはありません。両方の方向 (ルート変更ごとに `navigation` を書き込むことと、エージェントの `navigate` コマンドを使用すること) は、次のセクションで説明する単一のフック [`useNavigationState`](#use-navigation-state) によって処理されます。

`navigation` キーは UI に属します。エージェントは決して直接書き込んではなりません。エージェントは `navigate` を書き込み、UI が移動を実行し、その移動によって `navigation` が更新されます。

宛先に実際の URL がある場合、同じオリジンの `path` を含めます
`navigate` コマンドを実行し、フォールバックする前に UI がそのパスを優先するようにします
セマンティックフィールド。アプリのナビゲーションを単一チャネルに保つ: 両方を記述しないでください
同じ動きの `navigate` と `__set_url__`。 `__set_url__` は
フレームワーク URL ツール (`set-url-path`、`set-search-params`) および URL 専用フィルター
変化します。チャットのストリーミング中に到着する可能性のあるコマンドについては、ルートをコミットします
ラップする代わりに `navigate(path, { replace: true, flushSync: true })` を使用
ビューの遷移では、アドレス バーと表示されているページが一緒に保たれます。

## useNavigationState フック {#use-navigation-state}

`useNavigationState` は **アプリのフックであり、フレームワーク インポートではありません。** すべてのテンプレートは `app/hooks/use-navigation-state.ts` に 1 つ付属しており、アプリ シェル (`root.tsx`) から 1 回呼び出します。これは、ナビゲーションを両方向に接続する単一の場所です:

- **アウトバウンド (UI → エージェント):** ルートが変更されるたびに `navigation` キーを書き込むため、エージェントは常に現在のビューを認識できます。
- **受信 (エージェント → UI):** `navigate` コマンドをポーリングし、ナビゲーションを実行し、コマンドを削除します。

これは実際のフレームワーク プリミティブ `useAgentRouteState` (`@agent-native/core/client` からエクスポート) の薄いラッパーであるため、短くなります。アプリ固有の関数を 2 つ指定すると、残りはフレームワークが実行します。

```tsx
// app/hooks/use-navigation-state.ts -- this file lives in YOUR app
import { useAgentRouteState } from "@agent-native/core/client";
import { TAB_ID } from "@/lib/tab-id";

interface NavigationState {
  view: "inbox" | "thread";
  threadId?: string;
  path?: string;
}

export function useNavigationState() {
  useAgentRouteState<NavigationState>({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,

    // UI → agent: derive semantic state from the current URL.
    getNavigationState: ({ pathname }) => {
      const match = pathname.match(/^\/thread\/([^/]+)/);
      return match ? { view: "thread", threadId: match[1] } : { view: "inbox" };
    },

    // agent → UI: turn a `navigate` command into a route to push.
    getCommandPath: (command) =>
      command.path ??
      (command.view === "thread" && command.threadId
        ? `/thread/${command.threadId}`
        : "/"),
    navigateOptions: { replace: true, flushSync: true },
  });
}
```

| あなたが書きます                                                 | フレームワークのハンドル                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `getNavigationState` — URL をセマンティック状態にマッピングする  | `navigation` は、タブスコープとグローバル フォールバック キーを書き込みます        |
| `getCommandPath` — `navigate` コマンドをルートにマッピングします | コマンドポーリング、読み取り後の削除、重複コマンド保護、リクエストソースのタグ付け |

`useAgentRouteState` は React ルーターを想定しています。ナビゲーションが URL (ウィザード ステップ、キャンバス選択、非ルーター シェル) に存在しない場合は、代わりに下位レベルの `useSemanticNavigationState` にドロップダウンします。既製の `state` 値に `navigationKeys`/`commandKeys` および `onCommand` コールバックを加えたものを渡すと、React については完全に認識されなくなります。ルーター。

## ジッター防止 {#jitter-prevention}

エージェントが application-state に書き込むと、同期システムにより、UI が書き込んだばかりのデータを再フェッチする可能性があります。これによりジッターが発生します。解決策はソースのタグ付けです:

ブラウザ側のアプリケーション状態アクセスには、`@agent-native/core/client` の `setClientAppState`、`writeClientAppState`、`readClientAppState`、および `deleteClientAppState` を使用します。 `useDbSync({ ignoreSource: TAB_ID })` とペアリングする場合は、UI 書き込みで `{ requestSource: TAB_ID }` を渡します。アンロード中の選択のクリーンアップなどの短期間の書き込みには、`{ keepalive: true }` を渡します。

```ts
// app/root.tsx
import { TAB_ID } from "@/lib/tab-id";

useDbSync({
  queryClient,
  ignoreSource: TAB_ID, // ignore events from this tab's own writes
});
```

仕組み:

- エージェントの書き込みには `requestSource: "agent"` のタグが付けられます (アクション ヘルパーがこれを自動的に行います)
- UI 書き込みには、`X-Request-Source` ヘッダーを介してタブの一意の ID が含まれます
- サーバーは各イベントのソースを保存します
- 同期イベントを処理するとき、UI は自身の `ignoreSource` 値に一致するイベントをフィルターで除外します。そのため、書き込んだばかりのデータは再フェッチされません
- エージェント、他のタブ、actions からのイベントは引き続き正常に受信されます

```an-diagram title="ソースのタグ付けにより自己再フェッチのジッターが阻止される" summary="タブは、独自の TAB_ID がスタンプされた同期イベントを無視しますが、エージェントと他のタブの書き込みには引き続き反応します。"
{
  "html": "<div class=\"diagram-jitter\"><div class=\"diagram-node\">このタブが書き込む<br><small class=\"diagram-muted\">X-Request-Source: TAB_ID</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>サーバーがソースを保存<br>on the event</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card col\"><div class=\"diagram-pill warn\">source == TAB_ID &rarr; ignored</div><small class=\"diagram-muted\">再取得なし、ちらつきなし</small><div class=\"diagram-pill ok\">agent / other tab &rarr; applied</div><small class=\"diagram-muted\">UI がライブ更新</small></div></div>",
  "css": ".diagram-jitter{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-jitter .col{display:flex;flex-direction:column;gap:6px;padding:14px}.diagram-jitter .diagram-arrow{font-size:22px;line-height:1}"
}
```
