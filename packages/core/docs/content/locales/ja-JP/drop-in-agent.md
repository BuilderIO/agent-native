---
title: "ドロップインエージェント"
description: "<AgentPanel>、<AgentSidebar>、sendToAgentChat() を使用して、エージェント チャット + ワークスペースを React アプリにマウントします。"
---

# ドロップインエージェント

> **開発者ページ。** このページは、React アプリにエージェントを埋め込む開発者向けです。エージェントを使用したエンドユーザー エクスペリエンスについては、[Using Your Agent](/docs/using-your-agent) を参照してください。

エージェントネイティブを最初から構築する必要はありません。エージェント チャット、ワークスペース タブ、CLI ターミナル、音声入力、およびすべての関連インフラストラクチャは、任意のアプリにドロップできる少数の React コンポーネントとして出荷されます。

> **前提条件:** サーバーは `agent-chat-plugin` を実行している必要があります (すべてのテンプレートで自動マウントされます)。最初から始める場合は、[Server](/docs/server) を参照してください。
>
> チュートリアルの代わりに公開された API マップが必要ですか? [Component API](/docs/components) を参照してください。

## コンポーネントの概要 {#components}

| コンポーネント        | それは何ですか                                                                                       | 次の場合に使用します                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `<AgentSidebar>`      | ルート アプリのレイアウトをラップし、完全なエージェントを含む切り替え可能なサイド パネルを追加します | すべての画面でアプリの横にエージェントを使用できるようにしたい           |
| `<AgentToggleButton>` | `<AgentSidebar>` を開く/閉じる (ヘッダーに入れます)                                                  | `<AgentSidebar>` とペアリング                                            |
| `<AgentPanel>`        | 生のパネル自体 — チャット + CLI + ワークスペース タブ                                                | レイアウトを完全に制御したい、または専用のエージェント ページが必要      |
| `<AgentChatSurface>`  | 配線済みのパネル/ページ チャット サーフェス                                                          | サイドバー ラッパーなしでチャットしたい                                  |
| `<AssistantChat>`     | コンポーザー/履歴フックを備えた下位レベルのチャット レンダラー                                       | 標準会話 UI の周囲にカスタム クロムが必要です                            |
| `sendToAgentChat()`   | プログラムによってメッセージをチャットに送信します                                                   | インラインで実行する代わりにエージェントに作業を渡すボタン               |
| `useActionMutation()` | アクションのタイプセーフなフロントエンド ラッパー                                                    | UI は、エージェント ツールが実行するのと同じ操作を実行する必要があります |

これらはすべて `@agent-native/core/client` からエクスポートされます。

```an-diagram title="マウントモデル" summary="<AgentSidebar> は、既存のレイアウトをラップします。ルートはメイン領域にレンダリングされます。エージェントパネルはその横に取り付けられます。 <AgentPanel> は、ラッパーを除いた同じパネルです。"
{
  "html": "<div class=\"diagram-mount\"><div class=\"diagram-box sidebar\" data-rough><span class=\"diagram-pill accent\">&lt;AgentSidebar&gt;</span><div class=\"inner\"><div class=\"diagram-node main\">あなたのアプリ<br><small class=\"diagram-muted\">children: header + &lt;Outlet/&gt;</small></div><div class=\"diagram-node panel\">エージェントパネル<br><small class=\"diagram-muted\">chat &middot; CLI &middot; workspace</small></div></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&harr;</div><div class=\"diagram-card alt\"><span class=\"diagram-pill\">&lt;AgentPanel&gt;</span><small class=\"diagram-muted\">same panel, no wrapper &mdash; you own the layout</small></div></div>",
  "css": ".diagram-mount{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-mount .sidebar{display:flex;flex-direction:column;gap:8px;padding:14px}.diagram-mount .inner{display:flex;gap:10px}.diagram-mount .main{flex:2}.diagram-mount .panel{flex:1}.diagram-mount .alt{display:flex;flex-direction:column;gap:6px;padding:14px}.diagram-mount .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 80% のケース: `<AgentSidebar>` {#sidebar}

最も一般的な設定は、どの画面でも右側から開くサイドバーです。
既存のルート レイアウトを `<AgentSidebar>` でラップします。
子はメイン アプリ領域に留まります。エージェント チャットはサイド パネルです。

```an-annotated-code title="<AgentSidebar> によるルート レイアウトのラップ"
{
  "filename": "app/root.tsx",
  "language": "tsx",
  "code": "import { Outlet } from \"react-router\";\nimport { AgentSidebar, AgentToggleButton } from \"@agent-native/core/client\";\n\nexport default function Root() {\n  return (\n    <AgentSidebar\n      emptyStateText=\"何をお手伝いできますか？\"\n      suggestions={[\n        \"Summarize my inbox\",\n        \"Draft a reply to the latest email\",\n        \"Show me yesterday's signup numbers\",\n      ]}\n      dynamicSuggestions\n      defaultSidebarWidth={420}\n      position=\"right\"\n    >\n      <header>\n        <AgentToggleButton />\n      </header>\n\n      <main>\n        <Outlet />\n      </main>\n    </AgentSidebar>\n  );\n}",
  "annotations": [
    { "lines": "6", "label": "ラッパー", "note": "`<AgentSidebar>` wraps your whole layout. It adds the toggleable side panel; everything you pass as children stays in the main app area." },
    { "lines": "8-12", "label": "スタータープロンプト", "note": "`suggestions` は空のチャット上でクリック可能なチップとしてレンダリングされます。" },
    { "lines": "13", "label": "コンテキスト認識チップ", "note": "`dynamicSuggestions` merges screen-aware prompts (e.g. \"Summarize this selection\") with your static ones. On by default." },
    { "lines": "18-20", "label": "トグルボタン", "note": "Put `<AgentToggleButton />` anywhere in your header to open and close the panel." },
    { "lines": "22-24", "label": "あなたのアプリ", "note": "`<Outlet/>` (your routes) renders in the main area, untouched." }
  ]
}
```

それだけです。ユーザーは、チャット履歴、ワークスペース タブ、CLI ターミナル、音声入力、全画面モードを備えた、すべてのページに切り替え可能なエージェントを表示できるようになりました。状態は `localStorage` 経由でリロードしても維持されます。

### 小道具

- **`children`** — アプリの通常のレイアウトとルート。メインエリアにレンダリングされます。エージェント パネルは、デスクトップでは横に、モバイル/フルスクリーンではその上にマウントされます。
- **`emptyStateText`** — チャットにメッセージがない場合に表示される挨拶。デフォルト: `"How can I help you?"`。
- **`suggestions`** — スターター プロンプトが空の場合、クリック可能なチップとしてレンダリングされます。
- **`dynamicSuggestions`** — `suggestions` と統合されたコンテキスト認識プロンプト チップ。デフォルトで有効になっています。静的な提案のみを表示するには `false` を渡し、カスタマイズするには `{ max, includeStatic, getSuggestions }` を渡します。
- **`defaultSidebarWidth`** — 初期ピクセル幅 (マウントのみ。ユーザーによるサイズ変更と保存された値の上書き)。デフォルト: `380`。
- **`position`** — `"left"` または `"right"`。デフォルト: `"right"`。
- **`defaultOpen`** — サイドバーを開いた状態で開始するかどうか (デスクトップのみ)。デフォルト: `false`。

## 残りの 20%: `<AgentPanel>` {#panel}

専用の `/chat` ルート、管理するサイド列の埋め込みパネル、またはポップアップなど、レイアウトを完全に制御する必要がある場合は、`<AgentPanel>` を直接レンダリングします。

```tsx
// app/routes/agent.tsx
import { AgentPanel } from "@agent-native/core/client";

export default function AgentRoute() {
  return (
    <div className="h-screen">
      <AgentPanel defaultMode="chat" className="h-full" />
    </div>
  );
}
```

`<AgentPanel>` は、サイドバー ラッパー、折りたたみボタン、または状態の永続性のない生のタブ (チャット / CLI / ワークスペース) を提供します。好きな場所に置いてください。レイアウトを扱うのはあなたです。

### 選択された小道具

- **`defaultMode`** — `"chat"` または `"cli"`。デフォルト: `"chat"`。
- **`className`** — 外側コンテナの CSS クラス。
- **`onCollapse`** — 指定すると、ヘッダーに折りたたみボタンが表示されます。
- **`isFullscreen`** / **`onToggleFullscreen`** — Claude スタイルの中央揃えの列が必要な場合は、外部の全画面状態を接続します。
- **`storageKey`** — `localStorage` キーの名前空間。同じページ内で複数のパネル (異なるアプリ インスタンスまたはワークスペース) をレンダリングする場合に便利です。

完全なプロパティ: `AgentPanelProps` の `@agent-native/core/client`。

## プログラムメッセージ: `sendToAgentChat()` {#send}

エージェントに作業を引き渡すボタン (インライン `llm()` 呼び出しを実行する代わりに - [ladder](/docs/what-is-agent-native#the-ladder) からのアンチパターン):

```tsx
import { sendToAgentChat } from "@agent-native/core/client";

<Button
  onClick={() =>
    sendToAgentChat({
      message: "Generate a chart showing signups by source",
      context: `Dashboard ID: ${dashboardId}, date range: last 30 days`,
      submit: true,
    })
  }
>
  Generate chart
</Button>;
```

### オプション

- **`message`** — チャットに表示されるプロンプト。
- **`context`** — プロンプトに追加される隠しコンテキスト (選択されたテキスト、カーソル位置、現在のエンティティ ID — エージェントが知っておく必要があるが、ユーザーが二度見すべきでないもの)。
- **`submit`** — `true` は自動実行、`false` は事前入力されますが待機します。プロジェクトのデフォルトを使用する場合は省略します。
- **`newTab`** — このプロンプトに対して別のチャット スレッドを作成します。
- **`background`** — `newTab` では、新しいスレッドをフォーカスせずに実行します。非表示の実行は `RunsTray` で追跡されます。
- **`openSidebar`** — バックグラウンド/サイレント送信の場合は `false` に設定します。デフォルトではサイドバーが開き、ユーザーに応答が表示されます。
- **`type`** — `"content"` (デフォルト) は、組み込みアプリ エージェントで作業を保持します。 `"code"` はコード編集フレームにルーティングされます (エージェントが作成したコードの変更については、[Frames](/docs/frames) を参照してください)。

`sendToAgentChat` は、チャットの実行を追跡するために使用できる安定した `tabId` を返します。

サイレント作業の場合は、`newTab`、`background`、`openSidebar: false` をペアリングします。

```ts
sendToAgentChat({
  message: "Summarize the selected thread and save the summary",
  context: `Thread id: ${threadId}`,
  submit: true,
  newTab: true,
  background: true,
  openSidebar: false,
});
```

これは、ツール、actions、スレッド状態、および実行を使用して実行される完全なエージェントです
追跡。ユーザーの現在のサイドバー状態からフォーカスを盗むわけではありません。

同じルートが MCP アプリとして埋め込まれている場合、送信されます
`sendToAgentChat()` 通話は、サポートされている場合はホスト チャットに転送されます。
MCP アプリ ブリッジ動作の [Client](/docs/client#sendtoagentchat)。

読み込み状態が必要な場合は、`useSendToAgentChat()` フックを使用します。これは、`send` と `isGenerating` の両方を返します。

```ts
import { useSendToAgentChat } from "@agent-native/core/client";

const { send, isGenerating } = useSendToAgentChat();
```

## 標準のサイドバーが適合しない場合 {#custom-chat-ui}

`<AgentSidebar>` と `<AgentPanel>` はほとんどのアプリをカバーします。
エージェントの周りのレイアウト、またはエージェントとの会話を促進したい
他の場所でビルドした場合は、レイヤーをドロップダウンしますが、フレームワークがそのレイヤーを所有し続ける
ランタイム、actions、および SQL をサポートする状態:

- **標準ランタイム周辺のクロムを所有します。** `<AgentChatSurface>` を使用してください
  専用のチャット ルート、またはカスタム ヘッダーが必要な場合は `<AssistantChat>`
  タブ、および標準会話の周りの空の状態。完全なレイヤー マップ —
  インポート パスを含むすべてのコンポーネント、フック、コンポーザー、アダプターは、
  [Component API](/docs/components#agent-chat-ui).
- **独自のエージェント ランタイムを使用してください。** 他の場所で構築したエージェントを使用する場合は、
  Agent-Native が作曲家、トランスクリプト、ツールを維持しながら会話を強化
  カード、承認、ネイティブ ウィジェットは、`AgentChatRuntime` を
  `<AssistantChat runtime={...} />`。コネクタ
  (`createHttpAgentChatRuntime()` および OpenAI / Claude / Vercel AI / AG-UI
  ヘルパー) とイベント コントラクトは
  [Native チャット UI — BYO agent runtimes](/docs/native-chat-ui#byo-agent-runtimes).

どのレイヤーを選択しても、actions および SQL をサポートするアプリの状態をコントラクトとして維持します。
製品 UI から `/_agent-native/agent-chat` に直接投稿することは避けてください。もし
実際のカスタム サーフェスに名前付きヘルパーがありません。最初にそのヘルパーを追加してください。
クライアント コードは 2 番目のアドホック トランスポートを学習しません。

## UI からのタイプセーフ actions: `useActionMutation()` {#use-action-mutation}

UI がエージェント ツールが実行するのと同じ操作を実行する必要がある場合 ([ladder](/docs/what-is-agent-native#rung-three) の行 3)、`useActionMutation` を使用します。

```tsx
import { useActionMutation } from "@agent-native/core/client";

const { mutate, isPending } = useActionMutation("reply-to-email");

<Button onClick={() => mutate({ emailId, body: "Thanks!" })}>
  Send Reply
</Button>;
```

タイプセーフな引数は、`defineAction()` の zod スキーマから取得されます。フルアクションシステムについては[Actions](/docs/actions)を参照してください。

```an-callout
{
  "tone": "decision",
  "body": "**`useActionMutation` vs `sendToAgentChat`.** Run the operation directly with `useActionMutation` when the user clicked a deterministic button (\"Send reply\"). Hand it to `sendToAgentChat` when the work needs the agent's reasoning, tools, or multi-step planning. Never call an inline `llm()` from UI — that is rung 1 of the [ladder](/docs/what-is-agent-native#the-ladder)."
}
```

## 選択 + カーソル認識 {#selection}

エージェントは、アプリケーション状態で `navigation` キーと `selection` キーを使用して、ユーザーが選択した内容 (テキスト、セル、スライド、連絡先) を確認できます。また、空のチャットでは、現在の画面に関連性がある場合に、これらのキーを使用して、「この選択内容を要約する」や「このスライドを改善する」などの動的な提案を提供します。 Cmd-I (または同様のもの) を使用して、選択した範囲をコンテキストとしてチャットに送信したい場合は、[Context Awareness](/docs/context-awareness) を参照してください。

## すべてをまとめる {#putting-it-together}

典型的なドロップイン設定:

```tsx
// app/root.tsx
import {
  AgentSidebar,
  AgentToggleButton,
  sendToAgentChat,
} from "@agent-native/core/client";

export default function Root() {
  return (
    <AgentSidebar suggestions={["Draft a reply", "Summarize selection"]}>
      <Header>
        <AgentToggleButton />
      </Header>

      <Main>
        <YourRoutes />
      </Main>
    </AgentSidebar>
  );
}
```

```tsx
// Anywhere else in the app
<Button
  onClick={() =>
    sendToAgentChat({
      message: "Summarize this thread",
      context: `Thread id: ${threadId}`,
      submit: true,
    })
  }
>
  Summarize
</Button>
```

ユーザーはヘッダーにチャット ボタンが表示され、それを開いてエージェントと会話できます。ボタンは、ワンショットの LLM コールを実行するのではなく、同じエージェントに対して手動で動作します。

## 次は何ですか

- [**Actions**](/docs/actions) — `defineAction()` および `useActionMutation()`
- [**Context Awareness**](/docs/context-awareness) — 選択、ナビゲーション、画面表示
- [**Workspace**](/docs/workspace) — [ワークスペース] タブに含まれるもの (skills、メモリ、MCP サーバー、スケジュールされたジョブ)
- [**Voice Input**](/docs/voice-input) — チャット コンポーザーのマイク
