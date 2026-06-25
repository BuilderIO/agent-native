---
title: "はじめに"
description: "エージェント アプリを作成し、命令、skills、actions を理解してから、エージェントが最初のアクションを呼び出す様子を観察します。"
---

# はじめに

Agent-Native アプリは、AI エージェントと UI に同じ actions、データ、および
状態。基本的なエージェントは、それをガイドする命令 (skills) から作成されます。
再現可能な動作と、実際の作業を可能にする actions。

**完全なアプリから開始したいですか?** 豊富なテンプレートの 1 つを複製します —
[Chat](/docs/template-chat), [Mail](/docs/template-mail),
[Calendar](/docs/template-calendar), [Content](/docs/template-content),
[Analytics](/docs/template-analytics)、および [many more](/docs/cloneable-saas) —
それぞれがカスタマイズしたフル機能のアプリです。

ゼロから構築しますか?事前の唯一の選択肢は、UI が必要かどうかです —
その後のすべて (命令の作成、skills の追加、actions の定義、実行
エージェント）はどちらの方法でも同じです。

```an-file-tree title="基本的な Agent-Native エージェント"
{
  "entries": [
    { "path": "AGENTS.md", "note": "常時有効な指示: 目的、ルール、トーン、エージェントができることのマップ" },
    { "path": ".agents/skills/customer-research/SKILL.md", "note": "タスクが一致したときにエージェントが読み込む再利用可能な playbook" },
    { "path": "actions/summarize-week.ts", "note": "エージェント、UI、CLI、HTTP、MCP、A2A、jobs、webhooks が実行できる型付きコード" }
  ]
}
```

これは、チャット UI、ヘッドレス エージェント、または完全なアプリから開始するかどうかに当てはまります。
UI は表面を変更します。命令、skills、および actions はエージェントに
指導と行動。

## 1.アプリを作成します

[Node.js 22+](https://nodejs.org) と [pnpm](https://pnpm.io) が必要です。

フラグなしで `create` を実行すると、どのように開始するかを尋ねられます (完全なテンプレート、
チャット、またはヘッドレス) 他の何よりも前に:

```bash
npx @agent-native/core@latest create my-app
```

または、フラグを渡してプロンプトをスキップします。

**UI が必要ですか?** チャット テンプレートから開始します。作業エージェントに加えて
カスタマイズ可能なチャット UI、追加したすべてのアクションが自動的にチャットに表示されます:

```bash
npx @agent-native/core@latest create my-app --template chat
```

**単なるヘッドレス プリミティブですか?** ヘッドレスで開始します — 同じ actions とエージェント
ループ、UI シェルなし:

```bash
npx @agent-native/core@latest create my-agent --headless
```

次に、作成したフォルダーからインストールします。

```bash
cd my-agent # または、チャット テンプレートを選択した場合は my-app
pnpm install
```

ここからは、この 2 つは同じです。

## 2.アクションを追加

アクションとは、エージェント (および UI) が呼び出すことができる 1 つの操作です。両方の足場
このサンプルが同梱されています:

```an-annotated-code title="最初の action"
{
  "filename": "actions/hello.ts",
  "language": "ts",
  "code": "import { defineAction } from \"@agent-native/core/action\";\nimport { z } from \"zod\";\n\nexport default defineAction({\n  description: \"ローカルエージェントから挨拶します。\",\n  schema: z.object({\n    name: z.string().default(\"world\"),\n  }),\n  http: { method: \"GET\" },\n  readOnly: true,\n  run: async ({ name }) => {\n    return { message: `Hello, ${name}!` };\n  },\n});",
  "annotations": [
    { "lines": "5", "label": "ツール説明", "note": "エージェントは `description` を読み、いつツールとして呼び出すかを判断します。" },
    { "lines": "6-8", "label": "型付き契約", "note": "1 つの zod `schema` が、エージェント、UI、HTTP、MCP、A2A のすべての入力を検証します。" },
    { "lines": "9", "label": "HTTP 動詞", "note": "このアクションを自動マウントされる HTTP エンドポイントとして公開します。" },
    { "lines": "10", "label": "読み取り専用", "note": "`readOnly` は、このアクションが承認なしで安全に呼び出せ、クエリとしてキャッシュ可能であることを示します。" },
    { "lines": "11-13", "label": "単一の実装", "note": "`run` 本体は、すべてのサーフェスが実行する唯一の信頼できる実装です。" }
  ]
}
```

`hello` をドメイン内の最初の実際の操作に置き換えます。一度定義すれば、
あらゆる表面がそれを拾います。

毎ターン適用されるガイダンスとして `AGENTS.md` を使用してください。
エージェントには、再利用可能なワークフローまたはドメイン プロシージャが必要です。
エージェントには、データの読み取り、書き込み、API の呼び出しなどを行うための、型指定されたテスト可能な方法が必要です。
承認を実行します。

## 3.実行してください

アクションを直接呼び出します:

```bash
pnpm action hello --name Steve
```

または、エージェントに電話してもらうよう依頼してください。

```bash
pnpm agent "Call the hello action for Steve and explain what happened."
```

チャット テンプレートから開始した場合は、アプリを実行し、同じエージェントを使用します。
ブラウザ — 定義したすべてのアクションをすでに呼び出すことができます:

```bash
pnpm dev
```

その 1 つのアクションは、チャット UI、CLI、HTTP、MCP、A2A からアクセスできるようになりました。
スケジュールされたジョブ、および webhooks。一度定義すれば、どこからでも呼び出すことができます。

```an-diagram title="1 つのアクションであらゆる面に対応" summary="単一の defineAction ファイルは、追加の配線なしですべてのコンシューマに展開されます。"
{
  "html": "<div class=\"diagram-fan\"><div class=\"diagram-box\" data-rough>defineAction</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-surfaces\"><span class=\"diagram-pill\">チャット UI</span><span class=\"diagram-pill\">CLI</span><span class=\"diagram-pill\">HTTP</span><span class=\"diagram-pill\">MCP</span><span class=\"diagram-pill\">A2A</span><span class=\"diagram-pill\">スケジュール済みジョブ</span><span class=\"diagram-pill\">Webhooks</span></div></div>",
  "css": ".diagram-fan{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-fan .diagram-surfaces{display:flex;flex-wrap:wrap;gap:8px;max-width:420px}.diagram-fan .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 状態は組み込まれています

ヘッドレスはステートレスを意味するものではありません。 Actions、セッション、アプリケーションの状態、スレッド、
実行履歴と資格情報はすべて SQL に存在します。ローカルでは、
`data/app.db`;運用環境では、`DATABASE_URL` を設定します。参照
[Deployment](/docs/deployment).

```an-callout
{
  "tone": "info",
  "body": "**ヘッドレスは依然として実際のアプリです。**アプリとエージェントのループは、セッション、スレッド、実行、設定、資格情報を SQL に保持します。これはステートレス プロンプトではありません。アクションや状態に手を加えずに、後から UI を追加できます。"
}
```

## UI をカスタマイズ

チャット テンプレートから開始した場合は、UI を編集できます。チャット自体
`<AgentChatSurface>` コンポーネント上に構築された 1 つの小さなルートです:

```tsx
// app/routes/_index.tsx
import { AgentChatSurface } from "@agent-native/core/client";

export default function ChatRoute() {
  return <AgentChatSurface mode="page" className="h-full" />;
}
```

- **`app/routes/_index.tsx`** — チャット ページ。提案を変更します。空白
  状態、レイアウト。
- **`app/root.tsx`** — アプリシェル。
  エージェント。
- `<AgentSidebar>` を使用してエージェントを任意の画面にドロップし、手動で操作します
  `sendToAgentChat()` でボタンを押すか、
  `useActionMutation()`.

完全なコンポーネント セットについては、[Drop-in Agent](/docs/drop-in-agent) を参照してください。
[Native チャット UI](/docs/native-chat-ui) はアクションの結果をテーブルとしてレンダリングします。
プレーンテキストの代わりにグラフと入力されたカード。

**ヘッドレスで始めましたが、後で UI が必要ですか?** チャット テンプレートは UI オンランプです —
その `app/` レイヤー (React ルーター + Vite) はまさにヘッドレス足場です
は除外されます。最もクリーンな方法は、チャットから開始 (または再スキャフォールディング) することです
テンプレート; `actions/`、エージェント、および SQL の状態は変更されずに引き継がれます。参照
間にあるすべてのサーフェスに対して [Agent Surfaces](/docs/agent-surfaces)。

## プロジェクトの構造

```text
my-app/
  actions/         # エージェントが呼び出せるアクション
  app/             # React フロントエンド（UI テンプレートのみ。headless では省略）
  server/          # Nitro API サーバー（ルート、プラグイン）
  AGENTS.md        # 常に適用されるエージェント指示
  .agents/         # 必要に応じてエージェントが読み込むスキル
  data/app.db      # DATABASE_URL 未設定時のローカル SQLite 状態
```

## 次にどこに行くか

- **[Key Concepts](/docs/key-concepts)** — コア アーキテクチャ: SQL、actions、
  同期とコンテキスト認識。
- **[Actions](/docs/actions)** — 完全なアクション API: スキーマ、HTTP、認証、
  承認。
- **[Agent Surfaces](/docs/agent-surfaces)** — ヘッドレス、チャット、埋め込みサイドカー
  および完全なアプリ。
- **[Drop-in Agent](/docs/drop-in-agent)** — エージェント チャットを React アプリに追加します。
- **[Deployment](/docs/deployment)** — アプリを独自のドメインに配置します。
- **[FAQ](/docs/faq)** — セットアップと製品に関する質問。
