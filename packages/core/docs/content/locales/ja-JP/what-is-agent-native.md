---
title: "Agent-Native とは何ですか?"
description: "ほとんどの AI アプリが中途半端に構築されていると感じる理由、アプリが真のエージェントネイティブになる理由、その結果として日常のエクスペリエンスがどのようになるか"
---

# Agent-Native とは何ですか?

エージェント ネイティブは、AI エージェントとその周囲の製品表面が **対等なパートナー**となるソフトウェアを構築する方法です。そのサーフェスは、1 つのカスタム アクション、リッチ チャット、または完全な UI を備えたヘッドレス エージェントにすることができます。重要な部分は、エージェントと人間が同じ actions、データベース、状態を共有するということです。

このページで覚えていることが 1 つしかない場合は、これを覚えておいてください。今日のほとんどの AI アプリは、役に立つ一歩手前で止まっており、そのギャップが現在のこの分野における最大の間違いです。

## ユーザーとしてどのように見えるか {#what-it-looks-like}

バックグラウンド ワーカー、受信トレイ、カレンダー、フォーム ビルダー、または分析ダッシュボードを想像してください。カスタム画面がまだない場合もあります。1 つのアクションまたは 1 つのヘッドレス アプリエージェント プロンプトを実行します。場合によっては、最初の画面がチャットであ​​る場合があります。要望を尋ねると、エージェントがセットアップをガイドし、表やグラフを表示して、適切なアプリ ビューを開きます。場合によっては、チャットが完全なアプリケーションの右側にドッキングされることがあります。これらのシェイプ全体で、次のことができます。

- **実際の操作から始めます。** 1 つの永続アクションは、CLI、HTTP、MCP、A2A、アプリエージェント ループ、その後 UI から実行できます。
- **UI があるときに通常クリックするものをクリックします。** すべてのボタン、リスト、ダッシュボード、キーボード ショートカット - これらはすべて、エージェントが呼び出すことができる同じ操作を呼び出します。
- **または、質問してください。** エージェントに「3 時までに到着するというサラからのメールへの返信」と入力します。適切なスレッドを開き、返信の下書きを作成し、それを表示して承認を求めます。まさに手動で行うのと同じです。
- **内容を確認してください。** 電子メールを開くと、エージェントはどの電子メールであるかを認識します。チャートを選択すると、エージェントはどのチャートであるかを認識します。段落を強調表示して Cmd+I を押すと、エージェントはその段落のみに作用します。
- **動作を確認してください。** エージェントがビューを開く、下書きを編集する、レポートを実行するなどの作業を行うと、UI がリアルタイムで更新されます。マウスでいつでも停止、リダイレクト、または引き継ぐことができます。
- **チームメイトのように操作しましょう。** フィードバックを提供し、別のタスクをキューに入れ、指示を編集し、昨日の作業を監査します。記憶しており、時間の経過とともにワークフローが改善されます。

それがエージェントネイティブが設計されたエクスペリエンスです。ここで、ほとんどの製品がそこに到達できない理由を説明します。

## ほとんどの「AI アプリ」が不十分な理由 (はしごの原則) {#the-ladder}

ほとんどのチームははしごのように登る段階があり、ほとんどのチームが 1 段目で止まるのが早すぎます。

### ラング 1 — 単一の LLM 呼び出し (アンチパターン) {#rung-one}

テキスト ボックスがプロンプトを送信し、AI が文字列を返し、それを表示します。たぶんスピナー付き。ユーザーが軌道修正する方法も、AI が行動を起こす方法も、何が起こったのか、なぜ起こったのかを確認する方法もありません。

これはどこでも見かけます。「AI 機能」は、基本的に SaaS 製品に取り付けられた「要約」ボタンです。デモでは印象的に見えますが、現実が混乱した瞬間に壊れます。それは製品ではありません。それはおもちゃです。

### ラング 2 — ツールを使用したチャット {#rung-two}

AI が*できるようになりました*。 「メールの下書き」、「連絡先の検索」、「クエリの実行」といったツールと、目の前で機能するチャット インターフェイスがあり、ツールの呼び出しと結果が進行中に表示されます。これは、Claude、ChatGPT、および Cursor の内部の外観です。

これは本当のステップアップです。しかし、それ自体は依然としてチャット ウィンドウです。適切な UI はありません。ダッシュボード、リスト、フォーム、キーボード ショートカット、チーム コラボレーションはありません。 AI が混乱すると、右ボタンをクリックするだけでなく、再入力することになります。開発者以外は、この形式で実際の作業を行うのに苦労しています。

### ラング 3 — エージェント + UI が同等のパートナーとして {#rung-three}

これはエージェントネイティブです。エージェントの周りに実際のフル機能のアプリを追加します。そして重要なことに、エージェントが実行できるすべてのアクションは UI のボタンでもあり、ユーザーがクリックするすべてのボタンはエージェントが使用するのと同じロジックを実行します。 1 つの実装で 2 つの方法が可能です。

横線 3 に到達すると 3 つのことが変わります:

- **チャットボットへのボタンの追加を停止しました。アプリにエージェントを追加しました。** これは、両面ではるかに高品質の製品です。
- **エージェントは実際のコンテキストを持っています。** エージェントは、あなたが何を見ているのか、何を選択しているのか、何をしたのかを認識します。 UI が読み取るのと同じデータベースに書き込むため、その作業はすぐに表示されます。
- **外部エージェントもこれを使用できます。** 他のエージェント ネイティブ アプリは、[A2A protocol](/docs/a2a-protocol) を介してこのアプリの actions を呼び出すことができます。 Claude コード、Codex、ChatGPT カスタム MCP アプリ、カーソル、およびその他の MCP ホストは、[MCP server](/docs/mcp-protocol) として駆動できます。 1 つのアプリに多数のエントリ ポイント。

それは 3 番です。これはエージェントネイティブです。

```an-diagram title="はしごの原理" summary="ほとんどのチームはラング 1 または 2 で停止します。エージェントネイティブはラング 3、つまり 1 つの共有アクション サーフェス上の実際のアプリと実際のエージェントです。"
{
  "html": "<div class=\"diagram-ladder\"><div class=\"diagram-card rung rung-3\"><span class=\"diagram-pill accent\">段 3 · agent-native</span><strong>エージェント + UI が対等なパートナー</strong><small class=\"diagram-muted\">One action surface. Every agent tool is also a button; every button runs the same logic the agent uses.</small></div><div class=\"diagram-card rung rung-2\"><span class=\"diagram-pill\">段 2</span><strong>ツール付きチャット</strong><small class=\"diagram-muted\">エージェントは行動できますが、まだチャットウィンドウにすぎません。ダッシュボード、リスト、ショートカットはありません。</small></div><div class=\"diagram-card rung rung-1\"><span class=\"diagram-pill warn\">段 1</span><strong>単一のLLM呼び出し</strong><small class=\"diagram-muted\">Prompt in, string out. Impressive in a demo; breaks the moment reality gets messy.</small></div></div>",
  "css": ".diagram-ladder{display:flex;flex-direction:column;gap:14px}.diagram-ladder .rung{display:flex;flex-direction:column;gap:6px;padding:16px 18px}.diagram-ladder .rung-2{margin-inline-end:48px}.diagram-ladder .rung-1{margin-inline-end:96px}"
}
```

これらすべてが同じアクション定義にどのように影響するかについては、[Key Concepts — Protocols](/docs/key-concepts#protocols) を参照してください。

## すべてのエージェントに UI が必要な理由 {#why-every-agent-needs-a-ui}

エージェントがすべての面倒な作業を行っても、人間は依然として次のことを行う必要があります。

- **動作を確認** — 進行状況、中間出力、変更内容
- **ステアリング** — フィードバックを提供し、中断し、次のタスクをキューに入れます
- **管理** — 命令、skills、メモリ、スケジュールされたジョブ、接続されているアカウントを編集します
- **作業内容を検査** — ドラフトを確認し、履歴を監査し、間違いをロールバックします
- **出力を共有** — チームメイトに送信するダッシュボード、レポート、フォーム、リンク

少なくとも、「エージェントの UI」は可観測性と管理のダッシュボードです。最大でも、エージェントが副操縦士として組み込まれた完全な SaaS アプリになります。両端はエージェントネイティブとしてカウントされ、サーフェスは書き換えることなく一方から拡張できます。

事前に形状を選択する必要はありません。エージェントは、ヘッドレスで実行したり、リッチ チャットの背後に座ったり、同じアクション サーフェスを中心とした完全なアプリケーション内で実行したりできます。具体的な形状と API については、[Agent Surfaces](/docs/agent-surfaces) を参照してください。

## すべてのアプリがエージェントから恩恵を受ける理由 {#why-every-app-benefits-from-an-agent}

裏側も同様に重要です。既存の SaaS 製品は同じ壁にぶつかり続けています。必要なものの 80% はうまく機能しますが、20% はまったく変更できません。チャット サイドバーを追加しても、この問題が解決されることはほとんどありません。通常、チャットでは、UI でできることを実際には「実行」できません。

エージェントネイティブではそれが逆転します。アプリ内のすべてのアクションは一度定義され、ボタンとエージェント ツールの両方として公開されるため、エージェントは維持するための別の「AI ワールド」を必要とせずに、ボタンで実行できることすべて、さらにはそれ以上のことを実行できます。自然言語は、クリックと並んで第一級の入力になります。

その議論は「エージェントが UI を置き換える」というものではありません。それは、「**エージェントは、UI を頂点として、対等なパートナーとしてアプリケーション内に属します**」です。エージェントが製品であるアプリであっても、人間が監視、設定、操作するために UI が必要です。[Agent Surfaces — Headless](/docs/agent-surfaces#headless) を参照してください。

## エージェント + UI パリティ {#agent-ui-parity}

これが決定的な原則です。

> **UI から** — ボタンをクリックし、フォームに入力し、ビューを移動します。 UI はデータベースに書き込みます。エージェントは結果を確認します。
>
> **エージェントから** — 自然言語、A2A、Slack、テレグラム経由の他のエージェント。エージェントはデータベースに書き込みます。 UI は自動的に更新されます。

```an-diagram title="1 つのシステムで 2 つの方法で" summary="エージェントと UI は、同じアクションと同じデータベースに書き込みます。どちらかが何をしても、もう一方はそれを見ます。"
{
  "html": "<div class=\"diagram-parity\"><div class=\"diagram-col\"><div class=\"diagram-node\">Human<br><small class=\"diagram-muted\">クリック、フォーム、ショートカット</small></div><div class=\"diagram-node\">Agent<br><small class=\"diagram-muted\">自然言語 · A2A · Slack</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Actions</span><small class=\"diagram-muted\">defined once</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">SQLデータベース</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-box\">UI がライブ更新</div></div>",
  "css": ".diagram-parity{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-parity .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-parity .diagram-arrow{font-size:22px;line-height:1}.diagram-parity .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

エージェントが下書きメールを作成すると、UI に表示されます。 「送信」をクリックすると、エージェントは送信されたことを認識します。個別の「エージェント ワールド」と「UI ワールド」は存在せず、それは 1 つのシステムです。これを機能させるアーキテクチャについては、[Key Concepts](/docs/key-concepts) を参照してください。

## カスタマイズは通常電動工具用に予約されています {#workspace-customization}

Claude コードのようなツールが非常に強力であると感じられる理由は、モデルではなく、**カスタマイズ レイヤー**です。プロジェクトごとの指示、skills、メモリ、サブエージェント、接続されたサービスです。コードベース、好み、チームに合わせてエージェントを形成できます。

エージェント ネイティブでは、アプリを離れることなく、すべてのユーザーに同じカスタマイズ レイヤーが提供されます。各アプリには個人用 **ワークスペース** が付属しており、あなた (またはチームのメンバー) は次のことができます。

- 全員のエージェントが読むチーム全体のルールを編集します
- 設定を修正すると、エージェントに自動的に設定を記憶させます
- 再利用可能なハウツー ガイドを `/slash` コマンドとして作成します
- 特定のタスク用のカスタム サブエージェントを保持します (`@mentions` で呼び出されます)
- cron でジョブを実行するようにスケジュールを設定します (例: 「毎週月曜日の朝、先週の要約」)
- ユーザーごとの MCP サーバー経由で外部サービス (Gmail、ストライプ、Slack、内部 API) に接続

ひねり: すべてはファイル システムではなくデータベースに保存されます。起動する開発環境も、ユーザーごとのコンテナもありません。すべてのユーザーは、テーブル内のすべての行であるため、自分の完全なワークスペース (個人のメモリ、個人の接続、個人の skills) を基本的に無料で利用できます。これが、実際のマルチテナント SaaS 製品内で Claude コード レベルの柔軟性を実現できる理由です。

完全な概念については、[Workspace](/docs/workspace) を参照してください。

## 何が違うのか {#what-makes-it-different}

| アプローチ                                       | 説明                                                                                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AI が組み込まれた従来のアプリ**                | AI は後付けです。オートコンプリート、概要、またはアプリ内で実際には何もできないチャット サイドバーに限定されます。                                    |
| **純粋なチャット/エージェント インターフェイス** | 強力だがアクセスできない。ダッシュボードもワークフローも永続性もありません。開発者以外はそれらを効果的に使用できません。                              |
| **SaaS 用 Claude コード / Codex**                | 独自のマシンを使用する開発者に最適です。マルチテナント SaaS には変換されません。開発ボックス上のユーザーごとに 1 つのコードベースでは拡張できません。 |
| **エージェントネイティブ アプリ**                | エージェントは第一級市民です。同じデータベース、同じ状態を共有し、UI が実行できることはすべて実行でき、その逆も同様です。                             |

## チーム全体の開発 {#whole-team-development}

エージェントネイティブは開発者だけを対象としたものではありません。エージェントはアプリ自身のコードを編集できるため、アプリの進化は開発者のみのアクティビティではなくなります。

- **デザイナー** は、エージェントを通じて実行中のアプリでデザインを直接更新します
- **プロダクト マネージャー** は機能を追加し、フローを説明することでフローを更新します
- **QA** はアプリをテストし、エージェントに問題のある部分を修正するよう依頼します
- **チームの誰もが** 自然言語を通じて貢献します

ビジョン: 引き継ぎを減らし、小規模なチームの仕事を 1 人で行う

## フォークしてカスタマイズ {#fork-and-customize}

エージェント ネイティブ アプリは、フォークとカスタマイズのモデルに従います。 **テンプレート** (カレンダー、コンテンツ、スライド、アナリティクス、メール、クリップ、デザイン、フォーム、ディスパッチ) から始めて、それを自分のものにします。それぞれは、空の足場ではなく、卸売でフォークした完全に機能する SaaS 製品です。

1. [agent-native.com/templates](/templates) でテンプレートを選択してください
2. ホストされたアプリ (例: mail.agent-native.com) としてすぐに使用します
3. カスタマイズしたいときにフォークしてください — 「Stripe アカウントに接続する」、「コホート チャートを追加する」
4. エージェントはニーズに合わせてコードを変更します
5. フォークを独自のドメインにデプロイするか、agent-native.com に留まる

これは共有インフラストラクチャではなく、自分のアプリであるため、エージェントは安全にコードを進化させることができます。アプリは使用するにつれて改善され続けます。全文については、[Templates](/docs/cloneable-saas) を参照してください。

テンプレート全体をフォークする準備ができていませんか?すでに使用しているコーディング エージェントに **スキル** を追加して、エージェント ネイティブを試すこともできます。`npx @agent-native/core@latest skills add visual-plan` で計画スキルをインストールします。 [Skills Guide](/docs/skills-guide#app-backed-skills) を参照してください。

## コンポーザブルエージェント {#composable-agents}

エージェント ネイティブ アプリは相互に通信できます。メール アプリ内から、分析エージェントにタグを付けてデータをクエリし、その結果を下書きメールに含めることができます。エージェントは、他にどのようなエージェントが利用可能かを検出し、相互に仕事を引き継ぎ、結果をすでにいる UI に表示します。

これは内部で [A2A](/docs/a2a-protocol) と [MCP](/docs/mcp-protocol) によって強化されています (同じ定義、複数のサーフェス)。しかしユーザーとして知っておくべきことは、「アプリでできることはすべて、アプリにヘルプを求めることができる」ということだけです。

## これはコードではどのようになりますか? {#what-does-it-look-like-in-code}

エージェント ネイティブ アプリを構築または拡張している場合、中心的なパターンは次のとおりです。アプリ内のすべての操作は **アクション** であり、一度定義されると、エージェントと UI の両方で使用できます。

```an-annotated-code title="1 つのアクションを 1 回定義"
{
  "filename": "actions/reply-to-email.ts",
  "language": "ts",
  "code": "import { defineAction } from \"@agent-native/core/action\";\nimport { z } from \"zod\";\n\nexport default defineAction({\n  description: \"Reply to an email thread\",\n  schema: z.object({ emailId: z.string(), body: z.string() }),\n  run: async ({ emailId, body }) => {\n    // db and schema come from your app's server/db setup\n    await db.insert(schema.replies).values({ emailId, body });\n  },\n});",
  "annotations": [
    { "lines": "5", "label": "工具表面", "note": "`description` は、これをいつツールとして呼び出すかを決定するためにエージェントが読み取るものです。" },
    { "lines": "6", "label": "型付き契約", "note": "1つの zod `schema` が、エージェント、UI、HTTP、MCP、A2A という**すべて**のサーフェスからの入力を検証します。" },
    { "lines": "7-10", "label": "1 つの実装", "note": "`run` ボディは唯一の真実の情報源です。 UI ボタン​​とエージェント ツールは両方とも、まさにこれを実行します。" }
  ]
}
```

```tsx
// In any React component — same action, called from a button
const { mutate } = useActionMutation("reply-to-email");

<Button onClick={() => mutate({ emailId, body: "Thanks!" })}>
  Send Reply
</Button>;
```

```tsx
// And the agent panel mounted anywhere in your app
import { AgentSidebar } from "@agent-native/core/client";

<AgentSidebar />;
```

1 つのアクション、多くのサーフェス: エージェントはツールとして呼び出し、UI はタイプセーフなミューテーションとして呼び出し、[native chat](/docs/native-chat-ui) は明示的なウィジェット結果をレンダリングでき、外部エージェントは [A2A](/docs/a2a-protocol) 経由でそれに到達し、MCP ホストはアプリの [MCP server](/docs/mcp-protocol) 経由で呼び出し、オプションで MCP アプリ UI リソースと標準リモートを使用します。 MCP OAuth はフレームワークによって処理されます。完全なリファレンスについては、[Actions](/docs/actions) を参照してください。

## 次は何ですか {#whats-next}

- [**Getting Started**](/docs/getting-started) — start with one action, pick a template, or install a skill
- [**Agent Surfaces**](/docs/agent-surfaces) — choose headless, rich chat, embedded sidecar, or full app
- [**Key Concepts**](/docs/key-concepts) — the architecture: SQL, actions, polling sync, context awareness, portability
- [**Templates**](/docs/cloneable-saas) — templates as complete products you own
- [**Workspace**](/docs/workspace) — the per-user customization layer (skills, memory, instructions, MCP) backed by SQL, not files
- [**Dispatch**](/docs/dispatch) — the workspace control plane: secrets vault, Slack/email inbox, cross-app delegation
- [**Extensions**](/docs/extensions) — sandboxed mini-apps the agent creates instantly without code changes
- [**Drop-in Agent**](/docs/drop-in-agent) — mount `<AgentPanel>` into any React app
