---
title: "ワークスペース"
description: "Claude ユーザーごとのコード レベルのカスタマイズ — skills、メモリ、命令、カスタム エージェント、スケジュールされたジョブ、MCP サーバー — ファイル システムではなく、SQL によってサポートされます。"
---

# ワークスペース

> **どのワークスペース ドキュメントですか?** このページでは **カスタマイズ レイヤー**、つまりワークスペースとは何かについて説明します。デプロイメントの形状 (1 つのモノリポジトリ、多数のアプリ) については、[Multi-App Workspaces](/docs/multi-app-workspace) を参照してください。ガバナンス (誰が何を審査、承認、所有するか) については、[Workspace Governance](/docs/workspace-management) を参照してください。

すべてのエージェント ネイティブ アプリには、エージェントを自分のものにするカスタマイズ レイヤーである **ワークスペース** が付属しています。これには、チームの指示 (`AGENTS.md`)、共有学習 (`LEARNINGS.md`)、個人の構造化メモリ (`memory/MEMORY.md`)、エージェントがオンデマンドで取り込む skills、カスタム サブエージェント、スケジュールされたジョブ、接続された MCP サーバーなど、Claude コード / Codex セットアップに期待されるすべてが含まれています。

工夫: **ファイルシステム ファイルではなく、SQL 行です。** 各ユーザーは、データベースに保存された独自のワークスペースを取得します。起動する開発ボックスも、ユーザーごとのコンテナも、マウントするファイルもありません。マルチテナント SaaS は、完全にカスタマイズ可能なエージェントをすべてのユーザーに実質的に無料で提供できます。これは、すべてが行 (個人メモリ、個人 MCP サーバー、個人 skills、個人サブエージェント) であり、共有コードベースがそれらすべてを一度にホストするためです。

```an-diagram title="Claude-Code ワークスペースですが、SQL に保存されます" summary="同じカスタマイズ層 (命令、スキル、メモリ、エージェント、ジョブ、MCP) ですが、すべてのファイルが共有マルチテナント データベース内の行である点が異なります。"
{
  "html": "<div class=\"ws-map\"><div class=\"diagram-card cc\"><span class=\"diagram-pill warn\">Claude Code / Codex</span><small class=\"diagram-muted\">~/.claude/ on a local disk</small><div class=\"ws-files\"><span class=\"diagram-box\">CLAUDE.md</span><span class=\"diagram-box\">skills/</span><span class=\"diagram-box\">memory</span><span class=\"diagram-box\">mcp.json</span></div><small class=\"diagram-muted\">one codebase per developer</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card an\"><span class=\"diagram-pill accent\">Agent-nativeワークスペース</span><small class=\"diagram-muted\">rows in one SQLデータベース</small><div class=\"ws-rows\"><span class=\"diagram-pill\">AGENTS.md</span><span class=\"diagram-pill\">skills/&hellip;</span><span class=\"diagram-pill\">memory/&hellip;</span><span class=\"diagram-pill\">mcp-servers/&hellip;</span></div><small class=\"diagram-muted\">1つのコードベース、多数のユーザー、スコープ付き <code>u:&lt;email&gt;:&hellip;</code></small></div></div>",
  "css": ".ws-map{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.ws-map .diagram-card{display:flex;flex-direction:column;gap:8px;padding:16px 18px;flex:1;min-width:220px}.ws-map .ws-files,.ws-map .ws-rows{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0}.ws-map .diagram-arrow{font-size:24px}"
}
```

| Claude コード / Codex                 | エージェントネイティブのワークスペース                       |
| ------------------------------------- | ------------------------------------------------------------ |
| ローカル ディスク上のファイル         | 共有 SQL データベース内の行                                  |
| 開発者ごとに 1 つのコードベース       | 1 つのコードベースで多数のユーザー                           |
| 開発ボックスまたはコンテナが必要です  | 任意のサーバーレス/エッジ ホスト上で実行                     |
| `~/.claude/` でのカスタマイズ         | ユーザーごとのカスタマイズ、スコープ指定された `u:<email>:…` |
| プロジェクトごと `CLAUDE.md` / skills | アプリごとの `AGENTS.md` + ワークスペース メモリ リソース    |
| JSON ファイル内の MCP 構成            | JSON の MCP 設定 _または_ スコープごとの設定 UI              |

同じ機能。異なる経済学。これが SaaS にとって重要な理由については、[Templates](/docs/cloneable-saas) を参照してください。

## 概要 {#overview}

リソースには 3 つの実行時スコープがあります。

- **個人** — 単一のユーザー (電子メール) を対象としています。設定、メモ、ユーザーごとのコンテキストに適しています。
- **共有 / 組織** — アプリまたは組織内のすべてのユーザーに表示されます。アプリ/チームの指示、skills、共有設定に適しています。
- **Workspace** — ディスパッチ リソースから管理される継承されたグローバル デフォルト。企業の事実、ポジショニング、ブランド ガイドライン、グローバル ガードレール、ワークスペース全体の skills、および共有 MCP サーバーに適しています。アプリは実行時にこれらを読み取ります。各アプリにはコピーされません。

アプリ内のワークスペース パネルには、3 つのスコープすべてが表示されます。個人リソースと共有/組織リソースはそこで編集できます。ワークスペース スコープのリソースは、アプリ パネルでは読み取り専用であり、Dispatch から一元的に編集されるため、同期手順を行わなくても、すべてのアプリで同じ正規ファイルが表示されます。

エージェントが各リソースを使用する方法を制御する正規パス:

| ランタイム リソース                | パス                                        | エージェントによる使用方法                                           |
| ---------------------------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| ガードレールの説明                 | `AGENTS.md` または `instructions/<slug>.md` | 受信したすべてのアプリで毎ターンロードされます                       |
| グローバル skills                  | `skills/<slug>/SKILL.md`                    | ワークスペース skills としてリストされ、オンデマンドで読み取られます |
| ブランド/会社リソース              | `context/<slug>.md`                         | 毎ターンインデックスが作成され、関連する場合は読む                   |
| カスタム エージェント プロファイル | `agents/<slug>.md`                          | 再利用可能なローカル エージェント プロファイルとして利用可能         |
| 共有 HTTP MCP サーバー             | `mcp-servers/<slug>.json`                   | 許可されたアプリの MCP ツール レジストリにロードされます             |

これらのパスは、ワークスペース、組織/アプリ、個人の 3 つのスコープすべてに適用されます。同じパスが複数のレベルに存在する場合、後のスコープが優先されます。

```an-diagram title="3 つのスコープ、1 つの有効なファイル" summary="ランタイムは、読み取り時にワークスペース、アプリ、および個人のスコープにわたる同じパスを解決します。最も具体的なスコープが優先されます。"
{
  "html": "<div class=\"ws-stack\"><div class=\"diagram-card\"><span class=\"diagram-pill\">Workspace</span><small class=\"diagram-muted\">Dispatchからの全社デフォルト</small><code>context/brand.md</code></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">組織 / アプリ</span><small class=\"diagram-muted\">team override for one app</small><code>context/brand.md</code></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Personal</span><small class=\"diagram-muted\">per-user override &mdash; wins</small><code>context/brand.md</code></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box ok\">Effective <code>context/brand.md</code></div></div>",
  "css": ".ws-stack{display:flex;flex-direction:column;align-items:flex-start;gap:8px}.ws-stack .diagram-card{display:flex;flex-direction:column;gap:4px;padding:12px 16px;min-width:280px}.ws-stack .diagram-arrow{font-size:20px;align-self:center}.ws-stack code{font-size:.85em}.ws-stack .diagram-box{align-self:center;margin-top:4px}"
}
```

## はじめに: 1 分間のウォークスルー {#getting-started}

エージェントの動作を 60 秒以内に変更します。

1. **ワークスペース** タブ → **共有** → `AGENTS.md` を開きます (見つからない場合は、`+` → **ファイル** で作成します)。
2. ルールを 1 つ追加します。例:

   ```マークダウン
   ## トーン

   簡潔にしてください。答えを導きましょう。
   ```

3. 保存し、**チャット**に切り替えて、何でも質問してください。エージェントは新しいルールにすぐに従います。

```an-callout
{ "tone": "info", "body": "再起動や再デプロイは必要ありません。 `AGENTS.md` は各ターンの開始時に読み取られるため、編集内容を保存すると、次のメッセージでのエージェントの動作が変更されます。" }
```

**次のステップは必要に応じて実行できます:**

- **Skills** (`+` → **スキル**) — `/skill-name` とのチャットで呼び出される、集中的なハウツー ファイルです。
- **エージェント** (`+` → **エージェント**) — `@agent-name` で呼び出される再利用可能なサブエージェント ペルソナ。
- **スケジュールされたタスク** (`+` → **スケジュールされたタスク**) — cron 上で実行されるプロンプト。スケジュールとトリガーについては、[Recurring Jobs](/docs/recurring-jobs) を参照してください。
- **メモリ** — 共有 `LEARNINGS.md` と個人 `memory/MEMORY.md` により、会話全体で利用可能な耐久性のあるコンテキストが維持されます。

## グローバル リソースと正規パス {#global-resources}

ワークスペース スコープのリソースは、Dispatch の **リソース** ページから管理され、実行時にアプリによって継承されます。コピーや同期の手順はありません。 Dispatch は、次の 2 つの許可スコープをサポートします。

- **すべてのアプリ** — ワークスペース内のすべてのアプリが継承するグローバル リソース。ほとんどの会社、ブランド、ペルソナ、ポジショニング、メッセージング、ガードレール コンテキストは **すべてのアプリ** である必要があります。
- **選択されたアプリ** — アプリ固有のコンテキストまたはツールのために特定のアプリに付与されたリソース。これらは慎重に使用してください。

パスによって、エージェントがリソースを使用する方法が決まります (上記の [Overview](#overview) の表を参照)。これは、多くのアプリが恩恵を受けるはずの、コア ペルソナ、ポジショニング、メッセージング、会社概要、ブランド ガイドライン、サポート ポリシー、共有 skills ツール、または共有 HTTP MCP ツールの適切なホームです。

新しいワークスペースに役立つスターター パック:

```text
context/company.md              # 会社の内容、ICP、製品、リンク
context/brand.md                # 声、ビジュアルアイデンティティ、スペル、禁止された使用法
context/messaging.md            # ポジショニング、価値の裏付け、証拠のポイント、反論
instructions/guardrails.md      # コンプライアンス、エスカレーション、承認ルール
skills/company-voice/SKILL.md   # on-demand guidance for customer-facing writing
agents/<slug>.md                # reusable custom agent profiles
```

`context/` ファイルを事実に基づいたものにし、簡単に確認できるようにしてください。 `instructions/guardrails.md` に毎ターン適用しなければならないルールを入れます。エージェントが会社の声に合わせてコピーを意図的に変換またはレビューする必要がある場合は、`skills/company-voice/SKILL.md` を使用します。

1 つのアプリまたはチームのグローバルなデフォルトをオーバーライドするには、そのアプリ内に同じパスを使用して共有/組織リソースを作成します。 1 人の個人に対してこれをオーバーライドするには、同じパスを持つ個人リソースを作成します。ワークスペース ファイルをすべてのアプリにコピーしないでください。ランタイムは読み取り時にスタックを解決します。

```text
workspace context/brand.md
-> shared/app context/brand.md
-> personal context/brand.md
```

`context/` ファイルは短く事実に基づいたものにしてください。エージェントがざっと目を通すことができるいくつかの箇条書きです。

```text
<!-- context/brand.md -->

# ブランド

- Voice: direct, warm, concrete
- Use: "workspace", "agent", "team"
- Avoid: unsupported superlatives and vague AI claims
```

## ワークスペースパネル {#workspace-panel}

エージェント パネルには、チャットと CLI の隣に **ワークスペース** タブが含まれています。すべてのリソースのフォルダー編成ツリー、任意のテキスト ファイル (Markdown、JSON、YAML、プレーン テキスト) のインライン エディター、および `+` メニューの入力された作成フロー (ファイル、Skills、エージェント、スケジュールされたタスク) が表示されます。ユーザーは、継承されたワークスペースのデフォルトを参照し、個人または組織のリソースを作成/編集/削除できます。

リソースを開くと、エディターに `workspace default -> organization/app override -> personal override` スタックを含む **有効なコンテキスト** ストリップが表示されるため、何が継承されたのか、およびオーバーライドがアクティブである理由がわかります。 Dispatch は、コントロール プレーン側からの同じモデルを示します。**リソース** ページで **アプリ内で有効**を使用するか、アプリ カードの **コンテキスト** ダイアログのリソース行で **スタック** を展開します。

ディスパッチ承認ポリシーが有効になっている場合、**すべてのアプリ** リソースを作成、更新、または削除すると、すぐに適用されるのではなく、承認リクエストがキューに入れられます。作成/編集/削除ダイアログには、保存する前に影響プレビューが表示されます。

ワークスペース ツールバーの `?` アイコンをクリックすると、いつでもこれらのドキュメントに戻ることができます。

## エージェントがリソースを使用する方法 {#how-the-agent-uses-resources}

組み込みアプリ エージェントは、統合 `resources` ツールを使用してリソースを管理します。`action: "list"`、`"read"`、`"effective"`、`"write"`、`"promote"`、または `"delete"` を使用します。外部 CLI/コード エージェントは、同等の `pnpm action resource-*` コマンドを使用できます。

すべての会話の開始時に、エージェントは自動的に次の内容を読み上げます。

### AGENTS.md と説明書 {#agents-md}

`AGENTS.md` はデフォルトでシードされ、毎ターン、ワークスペース、共有/組織、個人スコープからこの順序でロードされます。ワークスペースは会社全体のデフォルト、共有/アプリはチーム ルール、個人はユーザーごとの設定です。 `instructions/` の下のファイルは別個のガードレール ドキュメントであり、これも毎ターン適用され (コンプライアンス ルール、エスカレーション ポリシー、ブランド ボイス)、同じ優先順位に従います。通常のチャットと統合によってトリガーされる実行は両方とも、応答する前にそれらを読み込みます。

```text
AGENTS.md
instructions/customer-support-guardrails.md
instructions/legal-review-policy.md
```

### 参考リソース {#reference-resources}

再利用可能な企業コンテキストは `context/` (ペルソナ、ポジショニング、製品事実、ブランド ガイドライン、競合メモ) の下にあります。エージェントはこれらのインデックスを参照し、タスクがそれに依存している可能性がある場合、`resources` ツール (`action: "read"`) を使用して関連ファイルを読み取ります。 `action: "effective"` を使用して、ワークスペースのデフォルトがアプリまたはユーザーに対してオーバーライドされているかどうかを確認します。

### メモリ {#memory}

ワークスペースには 2 つの現在のメモリ サーフェスがあります:

- プロジェクト全体の規約、修正、永続的なチームの知識のための **共有** スコープ内の `LEARNINGS.md`。
- 現在のユーザーに関する構造化メモリの **個人** スコープ内の `memory/MEMORY.md`。

リソース システムは、古いワークスペースとの互換性のために個人用 `LEARNINGS.md` もシードしますが、チャットのプリロード パスは共有 `LEARNINGS.md` と個人用 `memory/MEMORY.md` です。

**保存される内容。** エージェントを修正したり (「Y ではなく常に X を使用する」)、好みを共有したり (「簡潔な回答を好みます」)、またはコンテキストを明らかにしたり (「私のチームではこれを「ディスパッチ層」と呼んでいます」) と、エージェントはその学習内容をキャプチャして、間違いを繰り返したり再質問したりすることがなくなります。プロジェクト全体の学習は共有 `LEARNINGS.md` に反映されます。ユーザー固有のメモリは `memory/` の下に置かれます。 `capture-learnings` スキルは、いつ、どのように行うかを詳しく説明します。

**適切な場所。**

| 表面               | スコープ              | 作者                                             | いつ読む                                           |
| ------------------ | --------------------- | ------------------------------------------------ | -------------------------------------------------- |
| `AGENTS.md`        | 共有                  | 人間 / リクエストに応じてエージェント            | 毎ターン                                           |
| `LEARNINGS.md`     | 共有                  | 人間 / リクエストに応じてエージェント            | 毎ターン (共有コピーのみ)                          |
| `memory/MEMORY.md` | 個人                  | エージェント / 人間                              | 毎ターン                                           |
| `instructions/…`   | 共有                  | 人間 / リクエストに応じてエージェント            | 毎ターン                                           |
| `skills/…`         | 共有                  | 人間 / リクエストに応じてエージェント            | オンデマンド (`/slash` コマンド)                   |
| `context/…`        | 共有                  | 人間 / リクエストに応じてエージェント            | 毎ターンインデックスが作成され、関連する場合は読む |
| `mcp-servers/…`    | ワークスペース / 共有 | Dispatch またはアプリ ワークスペースを介した人間 | MCP 設定の更新                                     |

ユーザーはこれらのメモリ ファイルを [ワークスペース] タブで直接編集できます。これらは通常のリソースです。エージェントが間違えた行を削除するか、個人の設定を `memory/MEMORY.md` に保持するか、チーム全体のルールを `AGENTS.md` に昇格させます。

これらのサーフェス (`AGENTS.md`、skills、メモリ、カスタム エージェント、MCP サーバー) はすべて、同じ基盤となるリソース形状 (`path` + `scope` + `content`) であり、同じ方法でアドレス指定され、解決されます。

```an-schema title="ワークスペースのリソースモデル" summary="1 つのリソース シェイプがすべてのワークスペース ファイルをサポートします。ランタイムはパスとスコープによってキーを設定し、読み取り時に有効な値を解決します。"
{
  "entities": [
    {
      "id": "resource",
      "name": "workspace resource",
      "note": "ユーザーのワークスペース内の 1 つのファイル - 指示、スキル、メモリ、エージェント、MCP 構成、またはジョブ。",
      "fields": [
        { "name": "path", "type": "string", "note": "Canonical path, e.g. AGENTS.md, skills/<slug>/SKILL.md" },
        { "name": "scope", "type": "workspace | shared | personal", "note": "この行が存在するレベル" },
        { "name": "owner", "type": "string", "nullable": true, "note": "u:<email> for personal scope" },
        { "name": "content", "type": "text", "note": "マークダウン / JSON / YAML ボディ" }
      ]
    }
  ]
}
```

## Skills {#skills}

Skills は、`skills/` パス (`skills/<name>/SKILL.md` が望ましい) にある Markdown リソース ファイルで、エージェントにオンデマンドのドメイン知識を提供し、`/skill-name` とのチャットで呼び出されます。 [ワークスペース] タブから追加するか、コード モードで `.agents/skills/` から追加します。

[Skills Guide](/docs/skills-guide) を参照してください。スキルの形式、範囲、検出、およびオーサリングに関する単一のソースです。

## カスタム エージェント {#custom-agents}

カスタム エージェントは、`agents/*.md` の下に Markdown リソースとして保存される再利用可能なローカル サブエージェント プロファイルです。これは、カスタム エージェント形式の正規のホームです。

独自の名前、説明、モデル設定、および命令セットを備えたフォーカスされたデリゲートが必要な場合にこれらを使用します。 skills とは異なり、カスタム エージェントは受動的ガイダンスではありません。カスタム エージェントは、メイン エージェントが `@` のメンションを通じて、またはサブエージェントの生成中に選択することによって呼び出すことができる運用ペルソナです。

### エージェントの形式 {#agent-format}

カスタム エージェントは、YAML フロントマターと Markdown 命令を使用します。

```an-annotated-code title="カスタムエージェントプロファイル"
{
  "filename": "agents/design.md",
  "language": "markdown",
  "code": "---\nname: Design\ndescription: >-\n  Reviews layouts, interaction patterns, and product UX decisions.\nmodel: inherit\ntools: inherit\ndelegate-default: false\n---\n\n# 役割\n\nあなたは、重点を置いたデザイン エージェントです。\n\n## 責任\n\n- レイアウトとインタラクション フローを確認する\n- より強力な視覚的方向性を提案する\n- 簡潔かつ意見を述べてください。",
  "annotations": [
    { "lines": "2", "label": "@mention handle", "note": "`name` は、`@` ドロップダウンに表示されるもので、メイン エージェントが委任するものです。" },
    { "lines": "3-4", "label": "いつ委任するか", "note": "`description` は、このプロファイルがタスクに適合するかどうかを判断するためにオーケストレーターが読み取るものです。" },
    { "lines": "5", "label": "モデル", "note": "`inherit` はメイン エージェントのモデルを再利用します。プロファイルに明らかに別のプロファイルが必要な場合にのみオーバーライドします。" },
    { "lines": "6", "note": "現時点では `tools: inherit` — このフィールドは将来のエージェントごとのツール ポリシー用に予約されています。" }
  ]
}
```

推奨される規則:

- カスタム エージェントを `agents/<slug>.md` に保存します
- プロファイルに明らかに別のモデルが必要でない限り、`model: inherit` を使用してください
- 今のところ、`tools: inherit` を保持します。このフィールドは将来のツール ポリシーのために予約されています

### リモート エージェントとカスタム エージェント {#remote-vs-custom-agents}

ワークスペースには 2 つのエージェント タイプがあります:

- **カスタム エージェント** — `agents/*.md` のローカル プロファイル、現在のアプリ/ランタイム内で実行されます
- **接続されたエージェント** — `remote-agents/*.json` のマニフェストによって記述されたリモート A2A ピア (従来の `agents/*.json` マニフェストは引き続き認識されます)

1 つのアプリ内での委任にはカスタム エージェントを使用します。 A2A 経由で別のアプリを呼び出す必要がある場合は、接続されたエージェントを使用します。

## @ タグ付け {#at-tagging}

ワークスペース項目を参照するには、チャット入力に「`@`」と入力します。カーソルの位置にドロップダウンが表示され、一致するエージェントとファイルが表示されます。矢印キーを使用して移動し、Enter キーを使用して選択します。選択したアイテムは入力内にインライン チップとして表示されます。

メッセージを送信すると、**ファイル/リソース**がエージェントが読み取ることができる参照として渡され、**カスタム エージェント**がプロファイル命令に従ってローカルで実行され、**接続されているエージェント**が A2A 経由で呼び出されます。

## / スラッシュコマンド {#slash-commands}

スキルを呼び出すには、行の先頭に「`/`」と入力します。ドロップダウンには、利用可能な skills がその名前と説明とともに表示されます。いずれかを選択するとインライン チップが追加され、メッセージ送信時にその内容がコンテキストとして含まれます。 skills が設定されていない場合、ドロップダウンはこれらのドキュメントにリンクします。

## コード対アプリモード {#dev-vs-prod}

リソース システムはどちらのモードでも同様に動作します。異なるのは、`@` タグ付けと `/` コマンドで使用できる追加のソースです。

| 機能                           | コードモード                                                                                     | アプリモード                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| @ タグ付け                     | コードベース ファイル + ワークスペース リソース + カスタム エージェント + 接続されたエージェント | ワークスペース リソース + カスタム エージェント + 接続されたエージェント |
| /スラッシュコマンド            | .agents/skills/ + リソース skills                                                                | リソース skills のみ                                                     |
| エージェント ファイル アクセス | ファイルシステム + リソース                                                                      | リソースのみ                                                             |
| ワークスペースパネル           | フルアクセス                                                                                     | フルアクセス                                                             |
| AGENTS.md / メモリ             | 利用可能                                                                                         | 利用可能                                                                 |

## ワークスペース接続 {#workspace-connections}

ワークスペース接続を使用すると、アプリは資格情報を重複せずに同じプロバイダー アカウント (Slack、GitHub、HubSpot など) を共有できます。接続は、プロバイダー ID、アカウント ラベル、ステータス、スコープ、アプリの許可、資格情報の参照を SQL に記録します。シークレットは資格情報ストアに残ります。接続は、`SLACK_BOT_TOKEN` などの資格情報キー名のみを指します。

クイックスタート、connection/grant/credentialRef API、具体的な Slack、HubSpot、GitHub の例については、[Workspace Connections](/docs/workspace-connections) を参照してください。

---

# リファレンス

## リソース API {#resource-api}

リソースはサーバー コード、actions、または REST API から管理できます。

### サーバー API {#server-api}

REST エンドポイントは自動的にマウントされました:

| メソッド | エンドポイント                                | 説明                                        |
| -------- | --------------------------------------------- | ------------------------------------------- |
| `GET`    | `/_agent-native/resources?scope=all`          | リソースのリスト                            |
| `GET`    | `/_agent-native/resources?scope=workspace`    | 継承されたワークスペース リソースの一覧表示 |
| `GET`    | `/_agent-native/resources/tree?scope=all`     | フォルダ ツリーを取得                       |
| `GET`    | `/_agent-native/resources/effective?path=...` | 効果的な継承スタックを表示する              |
| `POST`   | `/_agent-native/resources`                    | リソースを作成する                          |
| `GET`    | `/_agent-native/resources/:id`                | コンテンツを含むリソースを取得              |
| `PUT`    | `/_agent-native/resources/:id`                | リソースを更新する                          |
| `DELETE` | `/_agent-native/resources/:id`                | リソースを削除する                          |
| `POST`   | `/_agent-native/resources/upload`             | ファイルをリソースとしてアップロードする    |

### アクション API {#script-api}

エージェントはこれらの組み込み actions を使用します。自分の actions から呼び出すこともできます:

```bash
# すべてのリソースをリストする
pnpm action resource-list --scope all

# リソースを読む
pnpm action resource-read --path "skills/my-skill/SKILL.md"

# Dispatch によって管理される継承されたワークスペース コンテキストを読み取る
pnpm action resource-read --scope workspace --path "context/brand.md"

# Show workspace -> organization/app -> personal precedence for a path
pnpm action resource-effective --path "context/brand.md"

# リソースを書く
pnpm action resource-write --path "notes/meeting.md" --content "# 会議メモ…」

# リソースを削除する
pnpm action resource-delete --path "notes/old.md"
```
