---
title: "エージェントの言及"
description: "チャット内のカスタム エージェント、接続されているエージェント、ファイルに @ メンションを付けてタグ付けします。"
---

# エージェントの言及

カスタム エージェント、接続されているエージェント、ファイル、リソースについて言及するには、チャット コンポーザに `@` と入力します。

## 概要 {#overview}

`@` メンション システムは、チャット コンポーザーをより広範なエージェント エコシステムに接続します。 `@` と入力すると、ポップオーバーが表示され、利用可能なカスタム エージェント、接続されているエージェント、コードベース ファイル、およびリソースがリストされます。

これは、単一のチャットから複数のエージェントのワークフローを調整する方法です。ローカルの `@design` エージェントにレイアウトの批評を依頼し、`@analytics` に別のアプリから最新の数値を取得してもらい、メイン エージェントは 1 つの会話に両方を組み込むことができます。

## エージェントについての言及 {#mentioning-agents}

チャット コンポーザでエージェントに言及するには:

1. 「`@`」と入力してメンションのポップオーバーを開きます
2. 利用可能なエージェントのリストを参照または検索します
3. エージェントを選択します - メッセージ内にタグとして表示されます
4. メッセージを送信します — サーバーはメンションを解決し、そのエージェントの応答を会話コンテキストに含めます

エージェント パスは 2 つあります:

- **カスタム エージェント** — `agents/*.md` のローカル ワークスペース エージェント プロファイル。これらは、エージェント プロファイルの命令とオプションのモデル オーバーライドを使用して、現在のアプリ/ランタイム内で実行されます。
- **接続されたエージェント** — リモート A2A ピア。これらは、[A2A protocol](/docs/a2a-protocol) 経由で呼び出されます。

どちらの場合も、メイン エージェントは応答を確認し、それを参照したり、それに基づいて構築したりできます。

```an-diagram title="@メンションがルーティングされる場所" summary="サーバーは各メンションをタイプ別に分割します。カスタム エージェントはローカルで実行され、接続されたエージェントは A2A を経由します。両方の応答はメイン エージェントのコンテキストに折り返されます。"
{
  "html": "<div class=\"diagram-mention\"><div class=\"diagram-node\">@-mention<br><small class=\"diagram-muted\">in the composer</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">サーバーが解決</span><small class=\"diagram-muted\">extract refs by type</small></div><div class=\"diagram-col\"><div class=\"row\"><span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</span><div class=\"diagram-box\">カスタムエージェント<br><small class=\"diagram-muted\">agents/*.md &middot; runs local</small></div></div><div class=\"row\"><span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</span><div class=\"diagram-box\">接続済みエージェント<br><small class=\"diagram-muted\">A2A peer &middot; remote call</small></div></div></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box diagram-accent\">&lt;agent-response&gt;<br><small class=\"diagram-muted\">injected into main agent</small></div></div>",
  "css": ".diagram-mention{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-mention .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-mention .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-mention .row{display:flex;align-items:center;gap:8px}.diagram-mention .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 仕組み {#how-it-works}

`@` メンションを含むメッセージが送信されると、サーバー上で次のことが起こります:

1. サーバーはメッセージからメンション参照を抽出します
2. 言及された各エージェントについて:
   - カスタム エージェントはプロファイルの指示に従ってローカルで実行されます
   - 接続されたエージェントは A2A 経由で呼び出されます
3. エージェントの応答は `<agent-response>` XML ブロックでラップされ、会話コンテキストに挿入されます
4. メイン エージェントは、ユーザーのテキストと言及されたエージェントの応答の両方を確認しながら、強化されたメッセージを処理します

メイン エージェントがコンテキスト内で認識するもの:

```text
User: Draft an email with the latest signup numbers. @analytics

<agent-response agent="analytics">
Last week's signups: 1,247 total
  - Organic: 623
  - Paid: 412
  - Referral: 212
</agent-response>
```

メイン エージェントは、このデータを応答に自然に使用できます。たとえば、電子メールの下書きに数値を組み込むことができます。

```an-callout
{
  "tone": "info",
  "body": "Mentioned-agent output arrives as an `<agent-response agent=\"…\">` block in the **main agent's** context — not as separate chat bubbles. The main agent decides how to weave it into the reply."
}
```

## エージェントの追加 {#adding-agents}

エージェントは、いくつかのメカニズムを通じてメンションできるようになります。

- **カスタム ワークスペース エージェント** — [ワークスペース] タブでエージェント プロファイルを `agents/*.md` として作成します
- **自動検出** — フレームワークは、既知のポートまたは設定された URL で実行されている接続されたエージェントを自動的に検出します
- **リモート マニフェスト** — 接続されたエージェント マニフェストを `remote-agents/*.json` として追加します

### カスタム ワークスペース エージェント

カスタム エージェントは、ワークスペースに保存されている Markdown ファイルです。

```markdown
---
name: Design
description: Reviews layouts, product UX, and visual direction.
model: inherit
---

You are a focused design agent.
```

完全な形式については、[Workspace — Custom Agents](/docs/workspace#custom-agents) を参照してください (`tools`、`delegate-default`、モデル オーバーライドを含む)。

次のコマンドを使用して、[ワークスペース] タブから作成できます。

- `Create Agent` -> `Describe It`
- `Create Agent` -> `Fill Form`

### 接続されたエージェントのマニフェスト

リモート A2A エージェントは引き続き JSON マニフェストを使用します:

```json
// remote-agents/analytics.json
{
  "name": "Analytics Agent",
  "url": "https://analytics.example.com",
  "apiKey": "env:ANALYTICS_A2A_KEY",
  "description": "Runs analytics queries and returns data",
  "skills": ["run-query", "generate-chart"]
}
```

---

## 開発者向け: メンションの拡張 {#extending-mentions}

テンプレートはカスタム メンション プロバイダーを登録して、エージェントやファイルを超えてドメイン固有のメンション可能なアイテムを追加できます。メンション プロバイダーは `MentionProvider` インターフェイスを実装します。

```an-annotated-code title="カスタム MentionProvider"
{
  "filename": "server/mentions/contacts.ts",
  "language": "ts",
  "code": "import type { MentionProvider } from \"@agent-native/core/server\";\n\nconst contactsProvider: MentionProvider = {\n  id: \"contacts\",\n  label: \"Contacts\",\n\n  // 検索 for mentionable items\n  async search(query: string) {\n    const contacts = await db.query.contacts.findMany({\n      where: like(contacts.name, `%${query}%`),\n      limit: 10,\n    });\n    return contacts.map((c) => ({\n      id: c.id,\n      label: c.name,\n      description: c.email,\n      type: \"contact\",\n    }));\n  },\n\n  // Resolve a mention into context for the agent\n  async resolve(id: string) {\n    const contact = await db.query.contacts.findFirst({\n      where: eq(contacts.id, id),\n    });\n    return {\n      type: \"context\",\n      text: `Contact: ${contact.name} (${contact.email})`,\n    };\n  },\n};",
  "annotations": [
    { "lines": "4-5", "label": "アイデンティティ", "note": "`id` namespaces the provider; `label` is the section heading shown in the `@` popover." },
    { "lines": "8-9", "label": "search", "note": "Runs as the user types after `@`. Return up to a handful of matches as `{ id, label, description, type }`." },
    { "lines": "23-24", "label": "resolve", "note": "Called when the message is sent. Turns a picked id into `{ type: \"context\", text }` that is injected into the agent's context." }
  ]
}
```

エージェント チャット プラグイン構成にプロバイダーを登録します。

```ts
// server/plugins/agent-chat.ts
import { createAgentChatPlugin } from "@agent-native/core/server";

export default createAgentChatPlugin({
  actions: scriptRegistry,
  systemPrompt: "You are a helpful assistant...",
  mentionProviders: { contacts: contactsProvider },
});
```

カスタム メンション プロバイダーは、メンション ポップオーバーの組み込みエージェントおよびファイル プロバイダーと並んで表示されます。

## ファイルを参照しています {#referencing-files}

`@` ポップオーバーはエージェントに限定されません。以下を参照することもできます。

- **コードベース ファイル** — `@` と入力してファイル名を検索します。ファイルの内容はエージェントのコンテキストに含まれるため、ファイルの読み取り、分析、または変更が可能です。
- **ワークスペース リソース** — [ワークスペース] タブで定義された参照ファイル。これらは、データ ファイル、設定、またはその他の構造化コンテンツです。
- **Skills** — スキルを参照するには、「`/`」と入力します。 Skills は、エージェントがタスクにどのように取り組むかをガイドする構造化された指示を提供します。

すべての参照タイプは同じパターンに従います。ポップオーバーから選択すると、参照されたコンテンツが解決され、メッセージの送信時にエージェントのコンテキストに挿入されます。

## サブエージェントの選択 {#sub-agent-selection}

メイン エージェントは、`agent-teams` でサブエージェントを生成するときにカスタム エージェントを使用することもできます (アクション: "生成")。

`agent` パラメータを渡して、`agents/*.md` からプロファイルを選択します。そのプロファイルの命令は委任された実行に追加され、その `model` フロントマターはそのサブエージェントのデフォルト モデルをオーバーライドできます。
