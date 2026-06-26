---
title: "チャット テンプレート"
description: "最小限のチャットファーストのエージェントネイティブ アプリ: 耐久性のあるチャット スレッド、actions、アプリケーションの状態、ライブ同期、認証、独自の UI を追加するための余地。"
---

# チャット テンプレート

チャットは、エージェントネイティブ アプリの基本的な開始点です。中央にチャット、左側にスレッド リスト、標準のアプリ ナビゲーション、認証、ライブ同期、actions、および 1 つのサンプル アクションを備えたクリーンな ChatGPT スタイルのシェルが提供されます。ドメイン テンプレートにコミットせずに構築できる実際のブラウザ アプリが必要な場合は、ここから始めてください。

ブラウザー UI を使用しない最小のアクションのみのランタイムが必要な場合は、[Pure-Agent Apps](/docs/pure-agent-apps) から始めてください。完成したドメイン プロダクトの形状が必要な場合は、[Calendar](/docs/template-calendar)、[Mail](/docs/template-mail)、[Content](/docs/template-content)、[Forms](/docs/template-forms)、[Analytics](/docs/template-analytics)、または別のドメイン テンプレートから開始してください。

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='min-height:560px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;padding:56px 40px'><div style='display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;width:min(700px,92%);min-height:430px'><div style='height:34px'></div><div style='text-align:center'><h1 style='margin:0'>何をお手伝いできますか？</h1><p class='wf-muted' style='margin:10px 0 0'>何でもチャットできます。actions、コンポーネント、ページ、ジョブ、独自バックエンドを追加できます。</p></div><div class='wf-card' style='width:100%;min-height:150px;display:flex;flex-direction:column;gap:18px'><span class='wf-muted'>エージェントにメッセージ...</span><div style='flex:1'></div><div style='display:flex;align-items:center;gap:10px'><span data-icon='plus' aria-label='Attach'></span><div style='flex:1'></div><span class='wf-pill'>Sonnet 4.6 · Auto</span><span class='wf-pill'>Act</span><button class='primary'>↑</button></div></div><div style='height:34px'></div></div></div>"
}
```

## 何が入っているのか {#whats-in-it}

- フレームワーク チャット サーフェスと耐久性のあるチャット スレッドを使用した、`/` 上の**フルページ チャット**。
- **アプリのサイドバーのスレッド リスト**。これにより、ユーザーはチャットを作成、再度開く、名前変更、固定、アーカイブできるようになります。
- **エージェント チャット プラグイン** は、エージェントの認証情報が設定されると、チャットが組み込みのアプリエージェント ループと通信するように事前設定されています。
- **認証** (Better Auth 経由) — ログイン、サインアップ、セッション、組織。同じフローがローカルと本番環境で実行されます。開発中、電子メール検証はスキップされます。
- **Actions ディレクトリ** 1 つの例 (`actions/hello.ts`) と標準の `view-screen` および `navigate` actions。
- アプリケーションの状態、設定、セッション、リソース、チャット スレッド、実行履歴、その他の実行時状態に関する**フレームワークのコア テーブル**。
- **ライブ同期** (`useDbSync`) はすでに接続されているため、エージェントが SQL に書き込むときに UI が自動更新されます。
- **AGENTS.md** には、actions、ルート、skills、アプリケーションの状態を追加するためのチャットファースト ガイダンスが含まれます。

## 何が含まれていないのか {#not-in-it}

- ドメイン テーブルやシード データはありません。
- ダッシュボード、リスト、グラフ、フォーム、プロバイダーの統合はありません。
- サンプル スタブ以外にドメイン固有の actions はありません。

それがポイントです。 Chat は、汎用のふりをしたドメイン製品ではなく、独自のエージェント用の薄くて便利なデフォルト シェルです。

```an-diagram title="Chat シェルに同梱されるもの" summary="フレームワークの標準ランタイム (アクション、耐久性のあるスレッド、ライブ同期、認証) 上の薄いチャット サーフェス。独自の UI を追加する余地があります。"
{
  "html": "<div class=\"diagram-chat\"><div class=\"diagram-col left\"><div class=\"diagram-node\">スレッド一覧<br><small class=\"diagram-muted\">作成 · 再開 · 固定 · アーカイブ</small></div><div class=\"diagram-node\">全画面チャット<br><small class=\"diagram-muted\">/ 上のフレームワークチャット画面</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Actions</span><small class=\"diagram-muted\">hello.ts · view-screen · navigate</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col right\"><div class=\"diagram-box\">コア SQL テーブル<br><small class=\"diagram-muted\">threads · application_state · settings · sessions · runs</small></div><div class=\"diagram-pill ok\">ライブ同期 &#8635;</div><div class=\"diagram-box\">Better Auth<br><small class=\"diagram-muted\">ログイン · 組織 · セッション</small></div></div></div>",
  "css": ".diagram-chat{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-chat .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-chat .diagram-arrow{font-size:22px;line-height:1}.diagram-chat .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## いつ選択するか {#when-to-pick}

- **ユーザーがすぐに会話できる基本的なアプリが必要です**。その後、actions および UI で拡張できます。
- **最初のブラウザー サーフェイスとしてチャットを必要とするヘッドレス アプリ**があります。
- **Agent-Native の actions、状態、認証、展開の形状を維持しながら、独自のエージェント バックエンドを使い慣れたチャット UI** に接続したいと考えています。
- **ドメイン テンプレートと一致しないカスタム内部ツール** のプロトタイプを作成しています。

## 足場 {#scaffolding}

```bash
npx @agent-native/core@latest create my-chat-app --template chat
cd my-chat-app
pnpm install
pnpm dev
```

または、UI なしで開始し、後でチャット サーフェスを追加します。

```bash
npx @agent-native/core@latest create my-agent --headless
```

そこから、チャット テンプレートの `/` ルートとサイドバー スレッド リストをアプリにコピーするか、チャット アプリをスキャフォールディングして actions をヘッドレス エージェントから `actions/` ディレクトリに移動します。重要な不変条件は変わりません。actions はチャット、UI、HTTP、MCP、A2A、CLI の共有サーフェスです。

## 検査する最初のコード {#first-code}

- `actions/hello.ts` は、エージェントが呼び出すことができるスターター動作です。交換するか、
  その横に actions を追加します。
- `app/routes/_index.tsx` は、フルページのチャット サーフェスをレンダリングします。
  ここに提案、空の状態、コンポーザー、または周囲のレイアウトを入力します。
- `AGENTS.md` は、組み込みエージェントにこのアプリ内での動作方法を指示します。

```an-file-tree title="Chat テンプレートのレイアウト"
{
  "entries": [
    { "path": "actions/hello.ts", "note": "1 つの example action; 置き換えるか横に actions を追加" },
    { "path": "actions/view-screen.ts", "note": "エージェントが読む標準 context action" },
    { "path": "actions/navigate.ts", "note": "標準 navigation action" },
    { "path": "app/routes/_index.tsx", "note": "フルページの chat 画面を描画; suggestions、empty state、composer を編集" },
    { "path": "AGENTS.md", "note": "組み込みエージェントが読む chat-first のガイダンス" }
  ]
}
```

チャット ページは意図的に薄くされています。

```tsx
// app/routes/_index.tsx
import { AgentChatSurface } from "@agent-native/core/client";

export default function ChatRoute() {
  return (
    <AgentChatSurface
      mode="page"
      suggestions={[
        "What can you do?",
        "Help me customize this chat app",
        "Show me the actions and pages I can add",
      ]}
    />
  );
}
```

## 独自のエージェント バックエンドを使用する {#own-agent-backend}

テンプレートは、デフォルトで組み込みの app-agent ループを使用します。カスタム バックエンドに接続するには、UI を書き換えるのではなく、エージェント チャット プラグインの背後にあるチャット ランタイムを交換します。チャット ルートは、共有チャット サーフェスの周囲のシン レンダラーのままである必要があります。バックエンドの選択はサーバー プラグイン/ランタイム アダプターに属します。

モデル オーケストレーションがすでに別の場所に存在しているが、それでも認証、スレッド、actions、UI 状態、およびデプロイ可能なページを備えたアプリが必要な場合に、これを使用します。

## 最初の編集 {#first-edits}

足場を構築した後、エージェントに次のことを尋ねます:

> `notes` のデータ モデルを追加します。メモには ID、タイトル、本文、所有者が含まれます。 `/notes` でメモ ページをレンダリングし、actions の作成/リストを追加して、チャットでメモを作成できるようにします。

エージェントは、Drizzle スキーマ、actions、ルート、ナビゲーション、および指示を追加する必要があります。その後、UI またはチャットからメモ機能を使用できるようになります。

## 次は何ですか

- [**Getting Started**](/docs) — ヘッドレス、チャット、ドメイン テンプレートから選択します
- [**Agent Surfaces**](/docs/agent-surfaces) — ヘッドレス、チャット、埋め込み、フルアプリのパターン
- [**Actions**](/docs/actions) — アクション システム チャットと UI の両方を呼び出します
- [**Native チャット UI**](/docs/native-chat-ui) — チャット サーフェス プリミティブとランタイム オプション
- [**Pure-Agent Apps**](/docs/pure-agent-apps) — 後でチャットに成長できるアクション専用アプリ
