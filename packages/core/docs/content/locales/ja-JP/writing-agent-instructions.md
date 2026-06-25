---
title: "エージェントの指示と スキル の作成"
description: "エージェント ネイティブ アプリまたはテンプレートの優れたエージェント手順を作成する方法: AGENTS.md、skills、およびツールの説明。"
---

# エージェントの指示と スキル の作成

エージェント ネイティブ アプリにおけるエージェントの動作は、ユーザーが与えた指示によって決まります。 `AGENTS.md` (マップ)、skills (詳細)、およびアクション/ツールの説明 (エージェントが適切なツールを選択する方法) の 3 つのサーフェスでそのガイダンスが伝えられます。散文ではなく、迅速に検索できるようにそれぞれを書きます。

```an-diagram title="3 つの作成済みサーフェス + 1 つのランタイム サーフェス" summary="AGENTS.md とツールの説明は毎ターンロードされます。スキルはオンデマンドでロードされます。 application_state は UI によってライブで書き込まれます。"
{
  "html": "<div class=\"diagram-surfaces\"><div class=\"diagram-card always\" data-rough><span class=\"diagram-pill accent\">毎ターン</span><strong>AGENTS.md</strong><small class=\"diagram-muted\">地図: 目的、基本ルール、状態キー、action + skills索引</small></div><div class=\"diagram-card always\" data-rough><span class=\"diagram-pill accent\">毎ターン</span><strong>ツール説明</strong><small class=\"diagram-muted\">ツール選択を導く — それぞれ1つの正確な文</small></div><div class=\"diagram-card ondemand\" data-rough><span class=\"diagram-pill\">オンデマンド</span><strong>スキル</strong><small class=\"diagram-muted\">詳細な手順、説明が一致したときに読み込み</small></div><div class=\"diagram-card runtime\" data-rough><span class=\"diagram-pill ok\">Live</span><strong>application_state</strong><small class=\"diagram-muted\">UIが書き込む: ナビゲーション、選択、フォーカス</small></div></div>",
  "css": ".diagram-surfaces{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.diagram-surfaces .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px}"
}
```

## AGENTS.md は小さく、スキミングできるようにしてください {#small-agents-md}

`AGENTS.md` が方向としてロードされます。これは、エージェントが正しく動作するための最小のものであり、すべてが skills に深くプッシュされている必要があります。以下のセクションとその他のセクションを目指してください:

- **目的行** — アプリとは何か、および主要なワークフローについての 1 文。
- **コア ルール** — 常に保持する必要がある少数の不変条件 (データは SQL、操作は actions を経由し、AI はエージェント チャットを経由し、スキーマの変更は追加的です)。短くて命令的な箇条書き。
- **アプリケーション状態キー** — ユーザーが見ているものとその形状を知るためにエージェントが読み取る `navigation`/選択/フォーカス キー。
- **アクション テーブル** — アクション名と目的をまとめたコンパクトなテーブル。
- **スキル インデックス** — 存在する skills のリストと、それぞれをいつ読み取るか。

セクションが画面を超えて拡大する場合、それはスキルに属します。 `AGENTS.md` は、「難しいことを具体的にどのようにすればよいか」ではなく、「このアプリは何ですか、何ができるでしょうか」と答えます。

```markdown
# プロジェクトアプリ

One workspace for projects, tasks, and notes. Agent and UI share the same SQL
data and the same actions.

## コアルール

- Data lives in Drizzle 経由の SQL. Use actions for all writes.
- All AI work goes through the agent chat; never call an LLM inline.
- Schema changes are additive only.

## アプリケーションの状態

- `navigation.view`: `home` | `project`
- `navigation.projectId`: selected project on a project page

## アクション

| Action           | Purpose                     |
| ---------------- | --------------------------- |
| `list-projects`  | List accessible projects    |
| `create-project` | Create a project            |
| `update-project` | Rename or archive a project |

## スキル

- `project-imports` — read before importing legacy CSV exports.
- `sharing` — read before exposing a project to other users.
```

## 単一ソース AGENTS.md {#single-source}

正規の命令ファイル `AGENTS.md` を 1 つ保持します。クライアントが `CLAUDE.md` を予期している場合は、2 番目のコピーではなく `AGENTS.md` へのシンボリックリンクを作成します。手動で管理された 2 つのファイルが漂流し、エージェントは矛盾したルールを使用することになります。真実の情報源は 1 つで、必要に応じてリンクされます。

## SKILL.md のフロントマターには、いつ AND を記載する必要があります {#skill-frontmatter}

エージェントがスキルを読み取るかどうかを決定するときに参照するのは、`description` だけです。スキルがカバーする内容と、それをいつトリガーするかという 2 つの質問に答える必要があります。トピックを説明するだけの説明は起動されません。

```markdown
---
name: project-imports
description: >-
  How to import projects from the legacy CSV export. Use when the user uploads
  a project CSV or asks to migrate projects from the old system.
---
```

- 機能を説明してから、明示的な **「Use when…」** 句を追加します。
- 少し強引になってください。過度にトリガーすると、ロードされないスキルに勝ります。
- 最大 40 語以内に収めてください。すべての会話のコンテキストにロードされます。

## 段階的な開示 {#progressive-disclosure}

`SKILL.md` を無駄のない必知のレイヤーとして作成します: ルール、その方法、やるべきこと/やってはいけないリスト、およびポインタ。長い例、網羅的なフィールド参照、API の癖、およびエッジケースのテーブルを `references/` ファイルにプッシュし、エージェントが必要な場合にのみ読み取ります。

```text
.agents/skills/project-imports/
├── SKILL.md            # ルール + ハッピー パス + do/don't
└── references/
    └── csv-format.md   # 完全な列仕様、エンコーディング、エッジケース
```

これにより、常に読み込まれるサーフェスが小さく保たれ、コンテキストを肥大化させることなく深度をスケールできるようになります。完全なスキル形式については、[スキル Guide](/docs/skills-guide) を参照してください。

## アクション指向のテーブルを作成する {#action-tables}

エージェントは、散文よりも速くテーブルをスキャンします。各操作を説明する段落よりも、目的に応じた名前の表を使用することをおすすめします。同じことが、状態キー、フィールド タイプ、および列挙可能なセットにも当てはまります。テーブルはスキミングや比較が可能で、アクションを追加するときに簡単に同期を保つことができます。

## 明確なツールの説明を書きます {#tool-descriptions}

アクションの説明はツールの説明であり、ツールの選択を決定します。それぞれを正確で単一目的の文にします:

- 実装方法ではなく、何を実行し、何を返すかを説明します。
- エージェントが正しく入力できるように、`.describe()` に各パラメータを記述します。
- アクションごとに 1 つの責任。説明に「そして…」が必要な場合は分割してください。
- 読み取り専用 actions (`readOnly: true` または `http: { method: "GET" }`) にマークを付けると、エージェントは自由に電話しても安全であることがわかります。

```ts
defineAction({
  description: "Create a project. Returns the new project id and title.",
  schema: z.object({
    title: z.string().min(1).describe("Project title shown in the sidebar"),
  }),
  // ...
});
```

## スキル 対 actions {#skills-vs-actions}

スキル と actions は相補的です。スキルとは、エージェントが読むガイダンスです。
アクションは、エージェントが実行できるコードです。

| 必要                                                                                         | 使用                             |
| -------------------------------------------------------------------------------------------- | -------------------------------- |
| エージェントはワークフロー、ポリシー、チェックリスト、またはルーブリックに従う必要があります | **スキル**                       |
| エージェントには例、参考資料、またはドメイン固有のルールが必要です                           | **スキル**                       |
| エージェントはアプリ データの読み取りまたは書き込みを行う必要があります                      | **アクション**                   |
| エージェントは外部 API に電話するか、承認を実行する必要があります                            | **アクション**                   |
| エージェントは正しい操作を呼び出していますが、その方法が間違っています                       | **スキル**を向上させる           |
| エージェントが操作を確実に呼び出すことができません                                           | **アクション**を改善             |
| エージェントが間違ったツールを選択した                                                       | **アクションの説明**を改善します |

ほとんどの実際の機能は両方を使用します。スキルはタスクへのアプローチ方法を説明します。
アクションは型指定された操作を提供します。たとえば、`invoice-review` スキル
`list-invoices` ながらレビュー ポリシーとエスカレーション ルールを説明できる
`flag-invoice` および `approve-invoice` actions は実際の読み取りと書き込みを行います。

## 製造防止処理をベークし、完了前に検証を行う {#anti-fabrication}

アプリの指示では、誠実さと検証をデフォルトの動作にする必要があります:

- **絶対に捏造しないでください。** データが見つからない場合、またはアクションが失敗した場合は、そう言って回復してください。結果をでっち上げたり、成功を主張したりしないでください。レポートする前に、アクションまたはクエリを通じて実際の値を読み取ります。
- **完了を宣言する前に確認してください。** 変更後は、書き込みが機能したと仮定するのではなく、リードバック (行を再クエリし、`view-screen` 経由で画面を再読み取り) して確認してください。
- **諦めないで回復してください。** 回復可能なエラー (クエリの失敗、一時的なフェッチ) が発生した場合は、タスクを放棄するのではなく、入力を再試行するか修正してください。これを捏造防止ルールとは別にしてください。「でっちあげてはいけない」と「最初の間違いでやめてください」を混同しないでください。

これらを `AGENTS.md` のコア ルールとして置き、すべてのターンに適用されるようにします。

## エージェントが見る 4 つの表面 {#four-surfaces}

あなたが作成したすべてのガイダンスは、4 つの表面のいずれかに配置されます。どのサーフェスを使用するかを把握すると、重複や細部の配置ミスを防ぐことができます:

| 表面                             | 誰が書いたのか     | ロード時                                                       | そこに属するもの                                                                  |
| -------------------------------- | ------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `AGENTS.md` 命令                 | あなた（開発者）   | 毎ターン、オリエンテーションとして                             | 目的、コアルール、状態キー、アクションインデックス、skills インデックス           |
| スキル (`SKILL.md`)              | あなた（開発者）   | エージェントがスキルが関連していると判断した場合のオンデマンド | 特定のパターンのステップバイステップのハウツー、やるべきこと/やらないことのリスト |
| アクションの説明 (ツール)        | あなた（開発者）   | 毎ターン、ツールリストとして                                   | アクションの動作、アクションが返す内容、パラメータのセマンティクス                |
| `application_state` コンテキスト | UI コード (実行時) | 毎ターン、アプリのライブ状態として                             | 現在のナビゲーション、選択範囲、フォーカスされたオブジェクト、URL                 |

**簡単な診断:**

- 「レコードが開いている場合でも、エージェントはどのレコードを処理するかを尋ね続けます」→修正: 現在のアイテム ID を UI から `application_state` (`navigation` キー) に書き込みます。それは `application_state` の差であり、スキルの差ではありません。
- 「エージェントが間違ったアクションを呼び出しているか、パラメーターを誤って使用しています。」→修正: パラメーターのアクションの `description` および `.describe()` を改善します。これはツールの説明の修正であり、スキルではありません。

## 何がどこに行くのか {#what-goes-where}

- **AGENTS.md** — 毎ターン、アプリ全体に適用されます: 目的、コアルール、状態キー、アクションインデックス、skills インデックス。
- **スキル** — オンデマンドでロードされる、特定のパターンの再利用可能なハウツー。アプリで作業している全員に適用されます。
- **メモリ (`memory/MEMORY.md`)** — ユーザーごとの設定と修正。作成されたガイダンスではありません。

## 次は何ですか {#whats-next}

- [スキル Guide](/docs/skills-guide) — スキル ファイル形式、フレームワーク skills、およびアプリベースの skills。
- [Creating Templates](/docs/creating-templates) — `AGENTS.md` と skills を出荷可能なテンプレートにどのように適合させるか。
- [The four-area checklist](/docs/key-concepts#four-area-checklist) — すべての特徴が満たさなければならない 4 エリア モデル。
