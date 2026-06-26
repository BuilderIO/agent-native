---
title: "純粋なエージェント アプリ"
description: "エージェントが製品全体であるアプリ: アプリとエージェントのループが玄関口であり、UI は人間が必要とする場合にのみ追加されます。"
---

# 純粋なエージェント アプリ

純粋なエージェント アプリは、エージェント ネイティブの最小限の終端です。アプリとエージェントのループは、
製品であり、ダッシュボードではありません。端末 Slack、電子メール、
スケジュールされたジョブ、別のエージェント、またはチャット — 「未読メールの要約」、「投稿」
毎日のメトリクスを Slack に送信します。エージェントはどこにいても動作し、結果を返します。
に属します。これはまだ実際のアプリです: actions、セッション、アプリの状態、履歴
設定、認証情報、共有レコードはすべて SQL に保存されます。

```an-diagram title="アプリとエージェントのループが玄関口です" summary="多くのエントリ ポイントは、SQL-backed アクションと状態を介して 1 つのエージェント ループに到達します。結果はリクエストの送信元に返されます。 UIは人間が監視する必要がある場合にのみ追加されます。"
{
  "html": "<div class=\"diagram-pure\"><div class=\"diagram-col\"><div class=\"diagram-pill\">Terminal</div><div class=\"diagram-pill\">Slack · メール</div><div class=\"diagram-pill\">スケジュール済みジョブ</div><div class=\"diagram-pill\">Another agent (A2A)</div><div class=\"diagram-pill\">Chat</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">アプリエージェントループ</span><small class=\"diagram-muted\">アクション · セッション · SQL 内のアプリ状態</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>結果が返る<br><small class=\"diagram-muted\">to where it belongs</small></div></div>",
  "css": ".diagram-pure{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-pure .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-pure .diagram-arrow{font-size:22px;line-height:1}.diagram-pure .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

作業がバックグラウンドで実行されているときにこの形状に到達すると、出力が残ります
アプリ、ドメインはワンショットであるか、プロトタイピング中です。エージェントには依然として UI が必要です —
ダッシュボードではなく、人間が管理、設定、操作するための場所です —
これが、純粋なエージェント アプリでも通常、組み込みのチャット シェルをマウントする理由です。

これは **ヘッドレス** 製品形状です。完全な意思決定ガイド、同梱物
ボックス、スキャフォールド、リポジトリへのアクセス、および実行共有が 1 か所に存在するようになりました:

→ [**Agent Surfaces — Headless agent**](/docs/agent-surfaces#headless)

## 次は何ですか

- [**Agent Surfaces — Headless**](/docs/agent-surfaces#headless) — 完全なヘッドレス意思決定ガイドと API
- [**Getting Started**](/docs/getting-started) — まずチャット アプリまたはヘッドレス エージェントを作成します
- [**Dispatch**](/docs/template-dispatch) — 純粋なエージェントの優れた出発点となるワークスペース テンプレート
- [**Messaging the agent**](/docs/messaging) — ユーザーがウェブ、Slack、電報、電子メールでエージェントと会話する方法
- [**Recurring Jobs**](/docs/recurring-jobs) — エージェントが独自に実行するスケジュールされたプロンプト
- [**Actions**](/docs/actions) — 純粋なエージェントが呼び出すツール
