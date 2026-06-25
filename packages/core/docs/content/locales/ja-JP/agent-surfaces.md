---
title: "エージェント サーフェス"
description: "Agent-Native をヘッドレスで、リッチ チャットとして、既存のアプリ内で、または完全なエージェント ネイティブ アプリケーションとして使用します。"
search: "ヘッドレス エージェント リッチ チャット フル アプリ BYO エージェント ランタイム AgentChatRuntime 埋め込み actions MCP A2A HTTP CLI"
---

# エージェント サーフェス

Agent-Native は意図的に構成可能です。 UI をあまり必要とせずにエージェントを使用できます。
組み込みエージェント ランタイムなしで UI を使用するか、両方を完全なものとして一緒に使用します
アプリケーション。

選択する便利な方法は、最初にプロトコルに基づいて選択することではありません。製品の表面を選択してください
必要に応じて、一致するプリミティブを使用します。

| 表面                                  | 次の場合に使用します                                                                                                              | から始めましょう                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **ヘッドレス エージェント**           | コード、ジョブ、スクリプト、別のアプリ、または別のエージェントは、作業を直接呼び出す必要があります。                              | `agent-native create --headless`, `defineAction`, `agent-native agent`, HTTP, CLI, MCP, A2A |
| **Agent-Native でのリッチなチャット** | 組み込みエージェント ループを利用したスタンドアロン チャットまたは埋め込みチャットが必要です。                                    | [Chat template](/docs/template-chat), `<AgentChatSurface>`, `<AssistantChat>`               |
| **エージェントでのリッチ チャット**   | 他の場所でエージェントを構築し、Agent-Native のコンポーザー、トランスクリプト、ツール カード、ネイティブ ウィジェットが必要です。 | `AgentChatRuntime`, `<AssistantChat runtime={runtime}>`                                     |
| **埋め込みサイドカー**                | あなたはすでに SaaS アプリを持っており、ページ コンテキストとホスト コマンドを備えたエージェントを必要としています。              | `createAgentNativeEmbeddedPlugin()`, `AgentNativeEmbedded`                                  |
| **完全なアプリケーション**            | 人間とエージェントは、耐久性のある画面、データ、ナビゲーション、コラボレーションを共有する必要があります。                        | テンプレート、actions、SQL 状態、コンテキスト認識                                           |

これらは段階であり、個別の製品ではありません。ワークフローはヘッドレスとして開始できます
エージェントは 1 つのアクションを持ち、表またはグラフとしてチャットに表示され、後にエージェントになります
エージェントが呼び出す操作を変更せずにアプリを全画面表示します。

```an-diagram title="表面スペクトル" summary="1 つのアクション サーフェス、4 つの製品シェイプ — それぞれが、その下の操作を変更せずに UI を追加します。"
{
  "html": "<div class=\"diagram-spectrum\"><div class=\"diagram-card\"><strong>Headless</strong><small class=\"diagram-muted\">actions、ジョブ、スクリプト、他のエージェント</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><strong>リッチチャット</strong><small class=\"diagram-muted\">コンポーザー、文字起こし、ツールカード</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><strong>埋め込み sidecar</strong><small class=\"diagram-muted\">agent beside an existing app</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card accent-card\"><span class=\"diagram-pill accent\">ほとんどの UI</span><strong>完全なアプリケーション</strong><small class=\"diagram-muted\">永続画面、データ、コラボレーション</small></div></div><div class=\"diagram-base\" data-rough><span class=\"diagram-muted\">同じ actions · 同じ SQL · 同じエージェントループ</span></div>",
  "css": ".diagram-spectrum{display:flex;align-items:stretch;gap:10px;flex-wrap:wrap}.diagram-spectrum .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;min-width:150px;flex:1}.diagram-spectrum .diagram-arrow{align-self:center;font-size:22px;line-height:1}.diagram-base{margin-top:12px;padding:10px 14px;text-align:center}"
}
```

## ヘッドレスエージェント {#headless}

カスタム アプリ画面を見つめる必要がない場合は、ヘッドレス パスを使用します。
作業の実行: スケジュールされたジョブ、統合、バックエンド ワークフロー、CLI ループ
別のエージェント、または Agent-Native を呼び出す既存の製品。

これは、**エージェントが製品である**場合に到達する形状でもあります。
app-agent ループはダッシュボードではなくフロントドアです。
ターミナル、Slack、電子メール、スケジュールされたジョブ、別のエージェント、またはチャット - 「私の要約
未読メール」、「日々の指標を Slack に投稿」、「候補者を見つける
先週返信しました」 - エージェントが動作し、どこにいても結果を返します
に属します。これはステートレス プロンプトではなく実際のアプリです: actions、認証セッション
アプリの状態、スレッド/実行履歴、設定、認証情報、共有レコードはすべてライブです
SQL にあります。

次の場合にこのパターンを選択してください。

- **作業はバックグラウンドで行われます。** 価値のほとんどは、トリアージ エージェント、日次レポート エージェント、オンコール対応者など、ユーザーが見ていない間に作成されます。
- **出力はアプリから出ます。** エージェントは Slack に投稿するか、電子メールを送信するか、サードパーティ システムを更新します。アプリ内で閲覧できるものは何もありません。
- **ドメインはワンショットです。** リサーチ ボット、概要ジェネレーター、レポート ライター — リスト ビューを必要とする永続的なオブジェクトはありません。
- **プロトタイピング中です。** 今すぐエージェントを出荷してください。ユーザーが必要に応じて、後でよりリッチな UI を追加します。

製品が永続オブジェクトを中心に構築されている場合、ユーザーは参照、ピボット、および
共有 — 電子メール、イベント、ドキュメント、グラフ — [full application](#full-application) を選択
または代わりに [template](/docs/cloneable-saas);これらは完全な UI に加えてエージェントを追加します。

### 同梱品 {#in-the-box}

ヘッドレス アプリは数週間にわたるダッシュボード作業を省略し、一日中チャネルに依存しません
1 つ - 同じエージェントが Web、Slack、テレグラム、電子メール、その他のエージェントから実行されます
すべてが UI ではなくエージェントを経由するためです。トレードオフは次のとおりです
「一目ですべてを参照」ビューはありません。ユーザーがそれを必要とする場合は、パターンを組み合わせて
小さなステータス ページまたはリスト ビューを追加します。

組み込みのチャット シェルを追加すると、フレームワークによって 5 つの管理が提供されます
構築する必要のないサーフェス: **チャット** (メイン入力)、**ワークスペース**
(skills、メモリ、命令、サブエージェント、接続された MCP サーバー、スケジュール済み
ジョブ)、**ジョブ履歴**、**スレッド履歴**、**設定**。それらは通常
十分です — 話しかけて、何が行われるかを確認し、どのように動作するかを設定してください。手を伸ばして
ブラウザ UI を追加する準備ができたら [Chat](/docs/template-chat)、または
ワークスペース スタイルで開始する場合は [Dispatch template](/docs/template-dispatch)
Slack/テレグラム、スケジュールされたジョブ、すぐに使用できる共有シークレットをポイントします。

最小のローカル パスは、ヘッドレス エージェント スキャフォールドと 1 つのアクションです。

```bash
npx @agent-native/core@latest create my-agent --headless
cd my-agent
pnpm install
```

次に、永続的な操作を定義します。

```ts
// actions/summarize-week.ts
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

export default defineAction({
  description: "Summarize this week's submissions.",
  readOnly: true,
  schema: z.object({ formId: z.string() }),
  run: async ({ formId }) => {
    return { formId, summary: "34 submissions, up 18% from last week." };
  },
});
```

1 つのアクションは次のように呼び出し可能です。

- **HTTP** — `POST /_agent-native/actions/summarize-week`
- **CLI** — `pnpm action summarize-week --formId form_123`
- **アプリエージェント CLI** — `pnpm agent "Summarize form_123"`
- **MCP** — Claude、ChatGPT、Codex、Cursor、OpenCode、Copilot、およびその他の MCP ホストから
- **A2A** — 別のエージェント ネイティブ アプリまたはエージェント ピアから
- **UI** — `useActionQuery`、`useActionMutation`、または `callAction` 経由
- **エージェント ツール** — 組み込みチャット ループから

```an-api title="HTTP を介したアクションの呼び出し"
{
  "method": "POST",
  "path": "/_agent-native/actions/summarize-week",
  "summary": "HTTP を介して名前でアクションを呼び出します",
  "description": "Every `defineAction` is auto-mounted at `/_agent-native/actions/<name>`. The JSON body is validated against the action's zod schema before `run` executes.",
  "request": {
    "contentType": "application/json",
    "example": "{ \"formId\": \"form_123\" }"
  },
  "responses": [
    { "status": "200", "description": "The action's return value as JSON", "example": "{ \"formId\": \"form_123\", \"summary\": \"34 submissions, up 18% from last week.\" }" },
    { "status": "400", "description": "Input failed schema validation" }
  ]
}
```

これはデータベースなしモードやステートレス モードではありません。アプリとエージェントのループはセッションを保存します。
スレッド、実行、設定、資格情報、アプリケーションの状態、および共有レコード
SQL。ローカル開発のデフォルトは SQLite です。ホストされているヘッドレス アプリは、
永続的な SQL データベース。

プロジェクト フォルダーからエージェント全体をヘッドレスでループする必要がある場合は、次を使用します。

```bash
pnpm agent "Summarize this week's forms."
```

別のアプリまたはスクリプトがエージェント全体を呼び出す必要がある場合は、
`agentNative.invoke("analytics", "...")` または `agent-native invoke` CLI。それ
ローカル作業は actions に維持されますが、クロスアプリ作業は A2A パスに維持されます。

ワーカー、ジョブ、統合 webhooks、およびカスタム ホストがエージェント ループを駆動できる
サーバー API 経由で直接。これは actions よりも低レベルです。
エンジン、モデル、メッセージ、actions、イベント シンクを自分で作成します:

```ts
import { runAgentLoop } from "@agent-native/core/server";

await runAgentLoop({ engine, model, systemPrompt, actions, messages, send });
```

ほとんどのアプリでは、スケジュールされたプロンプトと統合 webhooks がすでにこのループを呼び出しています
あなたのために。カスタム ヘッドレス ホスト eval
ランナー、またはサーバー側のオーケストレーション サーフェス — 「サーバー — 実稼働エージェント
handler](/docs/server#agent-handler)。

### フォルダに対して実行中 {#folder-loop}

目標が「このフォルダに対してエージェントを実行する」ことである場合は、app-agent から始めます
そのフォルダー内をループします: ヘッドレス アプリをスキャフォールディングし、actions/instructions を追加し、実行します
`pnpm agent "..."`。これにより、同じアクション/ランタイム/状態内での作業が維持されます
アプリが運用環境で使用する契約。

外部コーディング ハーネスは、Claude を組み込むための別の製品表面です
Agent-Native アプリ内のコード、Codex、Pi、Cursor、Mastra、または同様のランタイム。
デフォルトの方法としてではなく、コーディング エージェント製品を構築するときに使用してください。
ローカル エージェント ネイティブ ワークフローを開始します。

### クラウド リポジトリへのアクセス {#cloud-repo-access}

リポジトリ アクセスが必要なクラウド ヘッドレス アプリの場合は、GitHub コネクタを使用します
プラストークン CRUD モデル: リポジトリの一覧表示、ファイルの検索、ファイルの読み取り、作成、または
プロバイダー スコープによるファイルの編集、ファイルの削除、アクセスの取り消し
資格情報。ローカル開発では、ターゲット リポジトリを明示的に設定します。

```bash
GITHUB_REPOSITORY=owner/repo pnpm agent "Read README.md and suggest the next action."
```

VM クローンまたは長期存続するサンドボックス チェックアウトをプライマリ クラウドとして扱わないでください
リポジトリ アクセス モデル。サンドボックスは分離されたコードの実行には依然として重要ですが、
リポジトリへのアクセスは明示的で、権限があり、監査可能で、取り消し可能である必要があります
コネクタ層を経由します。

### セッションと実行の共有 {#sharing-runs}

ヘッドレス セッションと実行は耐久性のあるオブジェクトです。共有性は段階的に行う必要があります:
チームメイトがサニタイズされたプロンプトや出力を検査できるように、最初にリンクを読み取り/共有します。
および実行ステータス。後で許可された書き込み可能なコラボレーションのため、実行を続行します。
actions の承認、スケジュールの編集、または構成の変更が完了します
明示的なアクセス チェック。

## Agent-Native での充実したチャット {#rich-chat}

ユーザーがエージェントと話す必要がある場合は、組み込みチャットを使用します。ツールの呼び出しを参照してください。
作業を承認し、ネイティブ結果を検査し、永続的なスレッド履歴を保存します。

完全なアプリの開始点については、[Chat template](/docs/template-chat) を使用します。

```bash
npx @agent-native/core@latest create my-chat-app --template chat
```

最も単純な全ページチャット:

```tsx
import { AgentChatSurface } from "@agent-native/core/client/chat";

export default function ChatRoute() {
  return <AgentChatSurface mode="page" className="h-screen" />;
}
```

アプリにフルページ チャット タブと `AgentSidebar` の両方がある場合は、同じものを使用します
両方の表面で `storageKey` を有効にし、`chatViewTransition` を有効にして、
レイアウト内のチャット ホーム ハンドオフ ヘルパー。チャット外の通常のアプリ内リンク
ページでは、アクティブな状態を維持したまま、チャット全体をサイドバーにモーフィングできます
スレッド:

```tsx
import {
  AgentChatSurface,
  AgentSidebar,
  useAgentChatHomeHandoff,
  useAgentChatHomeHandoffLinks,
} from "@agent-native/core/client/chat";
import { useLocation } from "react-router";

function ChatRoute() {
  return (
    <AgentChatSurface mode="page" storageKey="my-app" chatViewTransition />
  );
}

function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const handoffActive = useAgentChatHomeHandoff({
    storageKey: "my-app",
    activePath: location.pathname,
    enabled: location.pathname !== "/chat",
  });
  useAgentChatHomeHandoffLinks({ storageKey: "my-app", chatPath: "/chat" });

  return (
    <AgentSidebar
      storageKey="my-app"
      chatViewTransition
      openOnChatRunning={handoffActive}
    >
      {children}
    </AgentSidebar>
  );
}
```

独自の Chrome を使用した最も単純な埋め込みチャット:

```tsx
import { AssistantChat } from "@agent-native/core/client/chat";

export function ProjectChat({ threadId }: { threadId: string }) {
  return <AssistantChat threadId={threadId} />;
}
```

Actions は明示的なネイティブ ウィジェット結果を返すことができるため、チャット出力は単なるものではありません
テキスト。表、グラフ、および型指定された製品カードは、ファーストパーティ React としてレンダリングされます
コンポーネント (iframe なし)。 [Native チャット UI](/docs/native-chat-ui) を参照してください。

## エージェントとのリッチなチャット {#byo-agent}

エージェントがすでに別のフレームワークで構築されている場合、または
ランタイムで、Agent-Native のチャット UI が必要です。 `AgentChatRuntime` は
境界: ランタイムは正規化されたイベントをストリームし、Agent-Native は
作曲者、トランスクリプト、ツール呼び出し、承認、ネイティブ ウィジェット、アプリ レイアウト。

```tsx
import {
  AssistantChat,
  createHttpAgentChatRuntime,
} from "@agent-native/core/client/chat";

const runtime = createHttpAgentChatRuntime({
  endpoint: "/api/support-agent/chat",
});

export function SupportAgentChat() {
  return <AssistantChat runtime={runtime} threadId="support" />;
}
```

OpenAI エージェント、OpenAI レスポンス、Claude 用の既製のランタイム ヘルパーが存在します
エージェント SDK、Vercel AI SDK、AG-UI、および上記の正規化された HTTP ランタイム
他のエージェント (Mastra、Flue、Eve、LangGraph、またはカスタム サービス) 用。 ACP は
エンドユーザー アプリのチャットや A2A トランスポートではなく、Agent-Native は現在サポートされていません
A2UI サポートを主張します。 ACP は 1 つの特定の場所でサポートされています - ローカルの運転
コーディング エージェント (Gemini CLI、Claude コードなど)
[harness layer](/docs/harness-agents#acp)、ここではチャット ランタイムとしては使用しません。

[Native チャット UI — BYO agent runtimes](/docs/native-chat-ui#byo-agent-runtimes)
は、イベント シェイプ、ランタイム ヘルパー、および `chatUI` の正規のホームです
ツール結果のメタデータ。外部エージェントをチャットに接続するときは、そこから始めてください。

## 埋め込みサイドカー {#embedded-sidecar}

メイン製品がすでに存在しており、必要な場合は埋め込みサイドカーを使用します
その隣にエージェントがいます。

サーバー プラグインは、Agent-Native ルートをホスト アプリにマウントし、解決します
ホスト ID サーバー側:

```ts
import { createAgentNativeEmbeddedPlugin } from "@agent-native/core/server";

export default createAgentNativeEmbeddedPlugin({
  databaseUrl: process.env.AGENT_NATIVE_DATABASE_URL,
  auth: getHostSession,
  actions: hostActions,
});
```

React サイドカーは、ページ コンテキストとホスト コマンドを渡します。

```tsx
import { AgentNativeEmbedded } from "@agent-native/core/client";

export function AppShell({ children }) {
  return (
    <AgentNativeEmbedded
      getContext={() => ({
        route: { pathname: window.location.pathname },
        selection: { text: window.getSelection()?.toString() || undefined },
      })}
      onNavigate={(payload) =>
        router.navigate((payload as { path: string }).path)
      }
      onRefresh={() => queryClient.invalidateQueries()}
    >
      {children}
    </AgentNativeEmbedded>
  );
}
```

```an-diagram title="サイドカーがホスト アプリにブリッジする方法" summary="プラグインは Agent-Native ルーティングをサーバー側にマウントします。 React サイドカーは、ページ コンテキストをストリーム入力し、ホスト コマンドを出力します。"
{
  "html": "<div class=\"diagram-sidecar\"><div class=\"diagram-panel\"><strong>ホストアプリ</strong><small class=\"diagram-muted\">既存の SaaS</small><div class=\"diagram-node\">getContext()<br><small class=\"diagram-muted\">ルート · 選択</small></div><div class=\"diagram-node\">onNavigate / onRefresh<br><small class=\"diagram-muted\">ホストコマンド</small></div></div><div class=\"diagram-col-arrows\"><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&larr;</div></div><div class=\"diagram-panel accent-panel\"><span class=\"diagram-pill accent\">AgentNativeEmbedded</span><small class=\"diagram-muted\">agent + workspace</small><div class=\"diagram-box\" data-rough>Agent-Native ルート<br><small class=\"diagram-muted\">mounted by the server plugin</small></div></div></div>",
  "css": ".diagram-sidecar{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-sidecar .diagram-panel{display:flex;flex-direction:column;gap:8px;padding:14px 16px;min-width:200px}.diagram-sidecar .diagram-col-arrows{display:flex;flex-direction:column;gap:6px}.diagram-sidecar .diagram-arrow{font-size:22px;line-height:1}"
}
```

ホスト認証、データベース分離については、[Embedding SDK](/docs/embedding-sdk) を参照してください。
iframe/ピッカー モード、および下位レベルのブリッジ API。

## 完全なアプリケーション {#full-application}

ユーザーが耐久性のあるオブジェクトやワークフローを必要とする場合は、完全なアプリ パスを使用します: フォーム
ダッシュボード、カレンダー、受信トレイ、エディタ、ドキュメント、アセット、またはレポート。

完全なアプリは、同じアクションとエージェント契約に基づいて製品 UI を追加します:

- **SQL 状態** — アプリのデータ、ナビゲーション、設定、チャット履歴は永続的です。
- **コンテキスト認識** — エージェントは現在のルート、選択内容、およびフォーカスされているオブジェクトを認識します。
- **ライブ同期** — エージェントの変更により UI が更新され、UI の変更によりエージェントのコンテキストが更新されます。
- **ディープリンク** — アクションの結果により適切なアプリビューを開くことができます。
- **ネイティブ チャット ウィジェット** — 表、グラフ、カード、承認、入力された結果がインラインで表示されます。

最小限のアプリが必要な場合は、[Chat template](/docs/template-chat) から始めてください
actions の周囲、またはドメイン [template](/docs/cloneable-saas) から
完全な製品形状が必要です。

## 選び方 {#how-to-choose}

| 考えているなら...                                                                          | 選択                              |
| ------------------------------------------------------------------------------------------ | --------------------------------- |
| 「呼び出し可能なツールまたはワークフローが必要なだけです。」                               | ヘッドレスエージェント            |
| 「フレームワークのエージェントが必要ですが、チャットをメインの UI にする必要があります。」 | Agent-Native での充実したチャット |
| 「すでにエージェントがいます。そのエージェントには洗練されたチャット UI が必要です。」     | エージェントとのリッチなチャット  |
| 「すでに SaaS アプリを持っています。その横にエージェントを追加してください。」             | 埋め込みサイドカー                |
| 「エージェントと UI は製品として一緒に進化する必要があります。」                           | 完全なアプリケーション            |

コントラクトを小さく保ちます: 永続的な操作を actions として定義し、明示的に返します
チャットにリッチな UI が必要な場合はウィジェットの結果が表示され、ユーザーがいる場合にのみ全画面が追加されます
永続オブジェクトを参照、比較、構成、または共同作業する必要があります。

## 関連ドキュメント {#related-docs}

- [Actions](/docs/actions) — ヘッドレス操作を 1 回定義します。
- [Native チャット UI](/docs/native-chat-ui) — 入力されたアクションの結果をチャットにレンダリングします。
- [Drop-in Agent](/docs/drop-in-agent) — チャット、サイドバー、またはパネルの表面をマウントします。
- [Component API](/docs/components) — 下位レベルの React チャット/作曲家作品。
- [Embedding SDK](/docs/embedding-sdk) — Agent-Native を既存のアプリに追加します。
- [External Agents](/docs/external-agents) — MCP 互換ホストをアプリに接続します。
- [A2A Protocol](/docs/a2a-protocol) — 他のエージェントからエージェントに電話をかけます。
