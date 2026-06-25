---
title: "メール"
description: "エージェントを利用した電子メール クライアント。 Gmail を接続すると、エージェントがメールの読み取り、下書き、送信、整理を行うことができます。"
---

# メール

エージェントを利用した電子メール クライアント。 Gmail アカウントに接続すると、エージェントがメールの読み取り、下書き、送信、整理を行うことができます。同時に、キーボードファーストの高速受信トレイを自分で操作できます。スーパーヒューマンを思い浮かべてください。しかし、エージェントは第一級市民であり、コードベースはあなたのものです。

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;min-height:500px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1.4px solid var(--wf-line)'><strong>受信トレイ 16</strong><div style='flex:1'></div><span data-icon='search' aria-label='検索'></span><span data-icon='edit' aria-label='作成'></span><span data-icon='bell' aria-label='通知'></span></div><div style='display:flex;flex-direction:column;padding:8px 14px;gap:6px'><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><strong>三田 プリヤ</strong><span><strong>Q3 ローンチ</strong> — 最終アセットはレビュー準備完了</span><span>★</span></div><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><strong>Acme請求</strong><span>月次請求書の準備ができました</span><span>11:10 AM</span></div><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><span>真田 誠</span><span>オンボーディングフロー research findings</span><span>昨日</span></div><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><span>GitHub</span><span>[framework] PR レビュー準備完了</span><span>昨日</span></div><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><span>Linear</span><span>Issue ENG-1287 があなたに割り当てられました</span><span>5月2日</span></div><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><span>Stripe</span><span>週間支払いサマリー</span><span>4月29日</span></div><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><span>Calendly</span><span>新しい予約が確定</span><span>4月28日</span></div></div></div>"
}
```

アプリを開くと、キーボードファーストの受信トレイとスレッドビューはメール自体にフォーカスされたままになります。エージェントは、あなたがどのビューにいるのか、どのスレッドが開いているのかを常に知っているため、「これ」が何であるかを説明することなく、「これをアーカイブする」または「友好的な辞退を作成する」と言うことができます。

```an-diagram title="メールリクエストの流れ" summary="キーボード ショートカットとエージェント プロンプトは同じアクションを実行します。電子メールは Gmail にあります。ドラフト、自動化、追跡は SQL と application_state で実行されます。"
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">あなたが操作<br><small class=\"diagram-muted\">J/K/E/R ショートカット</small></div><div class=\"diagram-node\">エージェントに依頼<br><small class=\"diagram-muted\">\"丁寧な断り文を下書き\"</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Actions</span><small class=\"diagram-muted\">list-emails · get-thread · manage-draft · send</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">Gmail<br><small class=\"diagram-muted\">複数アカウント、OAuth 経由</small></div><div class=\"diagram-box\">SQL + application_state<br><small class=\"diagram-muted\">下書き · 自動化 · トラッキング</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-box\">受信トレイをライブ更新</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## それを使って何ができるか

- **キーボード ショートカットを使用してメールを読み、優先順位を付けます** (`J`/`K` で移動、`E` でアーカイブ、`R` で返信、`C` で作成)。
- **複数の Gmail アカウント** を接続します。個人用と仕事用を 1 つの受信トレイに入れます。
- **エージェントにできることは何でもしてもらいます。** 「未読メールを要約してください。」 「丁重にお断りする返信文を作成してください。」 「1 週間以上古いすべての Netlify ボット メールをアーカイブします。」
- **ドラフトをレビュー用にキューに入れます。** チームメイトと Slack ユーザーは、エージェントに組織メンバー用のメールを準備するよう依頼できます。所有者はそれを確認、編集し、メールから送信します。
- **ルールによる自動トリアージ。** actions (ラベル、アーカイブ、既読マーク、スター、ゴミ箱) を使用して、平易な英語 (「ニュースレターから」) で自動化ルールを設定します。
- **送信したメールをクリックすると**トラックが開きます。
- **接続されているすべての受信トレイを 1 つのクエリで検索**します。
- **一括アーカイブ、エクスポート、ラベル付け** — 受信トレイのクリーンアップに役立ちます。

## はじめに

ライブデモ: [mail.agent-native.com](https://mail.agent-native.com)。

> **Google は警告を表示する場合があります:** ホストされたデモでは、Gmail アクセスに Agent-Native の共有 Google アプリを使用するため、続行する前に Google が確認を求める場合があります。ローカルで実行して、独自の Google OAuth クライアントを使用します。

初めてアプリを開いたとき:

1. サイドバーの [**設定**] をクリックします。
2. [**Google アカウントを接続**] をクリックし、Gmail にサインインして、承認します。
3. (オプション) 仕事用と個人用に 2 つ目の Google アカウントを接続します。
4. 受信トレイに戻ります - 本物の Gmail が同期されます。

Google アカウントが接続されていない場合、アプリは空のローカル メールボックスに対して実行されます (スクリーンショットやデモに役立ちますが、他にはあまり役に立ちません)。

## エージェントと話しています

エージェントは毎ターン `application_state.navigation` を読み取るため、現在どのビューにいるか、どのスレッドが開いているか、どのメッセージがフォーカスされているかをすでに知っています。エージェントに伝える必要はありません。次のようなことを言うだけです:

- 「未読のメールを要約します。」
- 「予算に関するアリスの最新スレッドを見つけてください。」
- 「丁重にお断りする返信の下書きを作成してください。」
- 「1 週間以上古い Netlify ボットのメールをすべてアーカイブします。」
- 「スター付きメールを開いてください。」
- 「この草案をより正式なものにしてください。」
- 「彼らは私のメールを開封しましたか?」

テキストを選択して Cmd+I を押すと、その選択内容が次のメッセージに反映されます。そのため、「強調表示する」は強調表示した内容に正確に適用されます。

## キーボード ショートカット

| 鍵        | アクション                           |
| --------- | ------------------------------------ |
| `J`       | 次のメール                           |
| `K`       | 前のメール                           |
| `Up/Down` | J/K と同じ                           |
| `Enter`   | 焦点を絞った電子メールを開く         |
| `E`       | メールまたはスレッドをアーカイブする |
| `D`       | メールまたはスレッドをゴミ箱に入れる |
| `S`       | スターを付けるか外す                 |
| `R`       | 返信                                 |
| `U`       | 既読/未読を切り替える                |
| `C`       | 新しいメールを作成                   |
| `/`       | フォーカス検索バー                   |
| `Cmd+K`   | コマンド パレットを開く              |
| `G I`     | 受信トレイに移動                     |
| `G S`     | スター付きに移動                     |
| `G T`     | 送信済みに移動                       |
| `G D`     | 下書きに移動                         |
| `G A`     | アーカイブに移動                     |
| `Esc`     | スレッドを閉じる / 検索をクリア      |

## 開発者向け

このドキュメントの残りの部分は、メール テンプレートをフォークしたり拡張したりする人を対象としています。

### クイックスタート

メール テンプレートを使用して新しいワークスペースを作成します。

```bash
npx @agent-native/core@latest create my-mail --standalone --template mail
cd my-mail
pnpm install
pnpm dev
```

または、メールを既存のエージェント ネイティブ ワークスペースに追加します。

```bash
npx @agent-native/core@latest add-app
```

開発環境で Gmail に接続するには、Google OAuth クライアントが必要です。

1. [Google Cloud Console](https://console.cloud.google.com/) を開いてプロジェクトを作成します。
2. API とサービス → ライブラリで **Gmail API** を有効にします。
3. OAuth 2.0 資格情報を作成します (タイプ: Web アプリケーション)。 `http://localhost:8085/_agent-native/google/callback` を承認されたリダイレクト URI として追加します。
4. クライアント ID とクライアント シークレットを実行中のアプリの [設定] ページにコピーし、[**Google アカウントに接続**] をクリックします。

トークンは `oauth_tokens` SQL テーブルに保存され、自動的に更新されます。最初のアカウントが設定されたら、複数の Gmail アカウントを接続できます。

### 主な機能

**マルチアカウント Gmail.** 1 つ以上の Google アカウントを接続し、接続されている受信トレイ全体でリスト、検索、下書き、送信、ラベル付け、アーカイブ、スター、またはゴミ箱に追加します。

**ドラフト ワークフロー。** 複数の作成ドラフトはアプリケーションの状態を通じて同期され、キューに入れられた SQL ドラフトにより、チームメイトまたは Slack ユーザーは所有者に確認して送信するメールをリクエストできます。

**自動化と追跡。** 自然言語トリアージ ルールにより、ラベル付け、アーカイブ、既読マーク付け、スター付け、ゴミ箱設定、または手動でのトリガーが可能です。送信されたメッセージは開封とクリックを追跡できます。

**検索、一括 actions、およびプレビュー。** 共有 actions パワーインボックス検索、一括アーカイブ/エクスポート、およびエージェントがチャットに埋め込むことができるインライン スレッド プレビュー。

### エージェントがあなたのコンテキストをどのように認識しているか

- **現在のビューとスレッド** — ナビゲートするたびに、UI は `navigation` (view、threadId、focusedEmailId、search、label) を書き込みます。エージェントは `readAppState("navigation")` または `pnpm action view-screen` 経由でそれを読み取ります。
- **下書きを開く** — 返信を作成中に「これを言うのを手伝ってください」と尋ねると、エージェントは一致する `compose-{id}` エントリを読み取って現在の件名と本文を確認し、更新された下書きを書き戻します。 UI は編集をライブで取得します。
- **スレッド履歴** — 応答中のコンテキストの場合、エージェントは `pnpm action get-thread --id=<threadId>` を使用してスレッド全体を取得します。

### エージェントがどのようにアクションを起こすか

- **メール操作** — アーカイブ、ゴミ箱、スター、既読マーク、送信、下書き — すべては、`templates/mail/actions/` の下で `pnpm action <name>` スクリプトとして実行されます。
- **ナビゲーション** — スレッドを開いたり、ビューを切り替えたりするために、エージェントは `application_state.navigate` を書き込み、UI がそれを消費して削除します。 `pnpm action navigate` スクリプトはこれをラップします。
- **更新** — 変更後、エージェントは `pnpm action refresh-list` を実行し、UI が再フェッチされます。

### データモデル

Google アカウントが接続されている場合、電子メールは Gmail に存在します。アプリは最上位のビューです。アカウントが接続されていない場合、電子メールは `getSetting("local-emails")` の下の SQL 設定ストアに保存されます (デフォルトでは空)。

| ストア / テーブル              | それに含まれるもの                                                          |
| ------------------------------ | --------------------------------------------------------------------------- |
| `getSetting("local-emails")`   | Google アカウントが接続されていない場合のローカルメールフォールバック       |
| `getSetting("labels")`         | システムラベルとユーザーラベル、未読数                                      |
| `getSetting("mail-settings")`  | ユーザー プロファイル、追跡設定、署名、エイリアス                           |
| `getSetting("aliases")`        | メール エイリアス                                                           |
| `queued_email_drafts` テーブル | チームメイトがリクエストしたドラフトはオーナーのレビュー/送信を待っています |
| `email_tracking` テーブル      | 送信メッセージのオープンピクセル イベント                                   |
| `email_link_tracking` テーブル | 送信メッセージのリンククリック イベント                                     |
| `application_state` テーブル   | `navigation`、`navigate`、`compose-{id}` エントリ (一時的)                  |
| `oauth_tokens` テーブル        | Google OAuth トークン (プロバイダー `"google"`、アカウントごとに 1 行)      |

API を通過する電子メールの形式は `{ id, threadId, from, to, cc, subject, snippet, body, date, isRead, isStarred, isArchived, isTrashed, labelIds, accountEmail, attachments }` です。

```an-schema title="メール SQL テーブル" summary="メール自体は Gmail 内に存在します。 SQL テーブルには、キューに入れられた下書き、送信追跡イベント、OAuth トークンなど、Gmail にはないものが保持されます。設定と一時的な状態は、settings ストアと application_state ストアに存在します。"
{
  "entities": [
    {
      "id": "queued_email_drafts",
      "name": "queued_email_drafts",
      "note": "Teammate/Slack-requested 件のドラフトがオーナーのレビューを待っています",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "assignedTo", "type": "string", "note": "org member who reviews/sends" },
        { "name": "subject", "type": "string" },
        { "name": "body", "type": "markdown" },
        { "name": "status", "type": "enum", "note": "review at /draft-queue/<id>" }
      ]
    },
    {
      "id": "email_tracking",
      "name": "email_tracking",
      "note": "送信されたメッセージのオープンピクセル イベント",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "messageId", "type": "string" },
        { "name": "openedAt", "type": "datetime" }
      ]
    },
    {
      "id": "email_link_tracking",
      "name": "email_link_tracking",
      "note": "送信されたメッセージのリンククリック イベント",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "messageId", "type": "string", "fk": "email_tracking.messageId" },
        { "name": "url", "type": "string" },
        { "name": "clickedAt", "type": "datetime" }
      ]
    },
    {
      "id": "oauth_tokens",
      "name": "oauth_tokens",
      "note": "フレームワーク テーブル — 接続された Google アカウントごとに 1 行",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "provider", "type": "string", "note": "\"google\"" },
        { "name": "accountEmail", "type": "string" },
        { "name": "accessToken", "type": "string" },
        { "name": "refreshToken", "type": "string" }
      ]
    }
  ],
  "relations": [
    { "from": "email_tracking", "to": "email_link_tracking", "kind": "1-n", "label": "click events" }
  ]
}
```

UI のルート:

- `/_index.tsx` — デフォルトの受信トレイ ビューにリダイレクトします。
- `/$view.tsx` — リストビュー (`inbox`、`starred`、`sent`、`drafts`、`archive`、`trash` など)。
- `/$view.$threadId.tsx` — 特定のスレッドが開いているリスト ビュー。
- `/email` — エージェント チャットで使用される埋め込みスレッド プレビュー。
- `/settings` — アカウント接続、追跡、自動化。
- `/team` — チームメンバーと共有リソース。

### カスタマイズ

メールはあなたが変更できます。重要なものはすべて、いくつかの場所に保存されています。そこから始めましょう。

**エージェント機能の追加。** `defineAction` を使用して、`templates/mail/actions/` の下に新しいファイルを追加します。アクションは、エージェント ツール、CLI コマンド (`pnpm action <name>`)、および `useActionQuery` / `useActionMutation` を介した型付きフロントエンド フック サーフェスになります。短い例については `templates/mail/actions/star-email.ts` を、複数のサブ actions を持つものについては `templates/mail/actions/manage-automations.ts` をご覧ください。完全なパターンについては、[actions](/docs/actions) のドキュメントを参照してください。

**UI の変更。** ルートは `templates/mail/app/routes/` にあり、コンポーネントは `templates/mail/app/components/email/` および `templates/mail/app/components/layout/` にあります。このアプリは、`app/components/ui/` の shadcn/ui プリミティブと Tabler アイコンを使用しています。これらを使用してください。

**エージェントの動作の変更。** エージェントのガイダンスは `templates/mail/AGENTS.md` にあり、skills は `templates/mail/.agents/skills/` (`email-drafts`、`real-time-sync`、`security`、`self-modifying-code` など) にあります。エージェントの動作はコードではなくマークダウンを編集することで変更されます。

**データまたは設定の変更。** 追跡テーブルおよび関連構造のスキーマは、`templates/mail/server/db/` にあります。設定の読み取りと書き込みは、`@agent-native/core/settings` から `readSetting` / `writeSetting` を経由します。アプリケーションの状態 (ナビゲーション、ドラフト、ワンショット コマンド) は、`@agent-native/core/application-state` の `readAppState` / `writeAppState` を使用します。

**新しいオートメーション アクション タイプを追加します。** `templates/mail/actions/manage-automations.ts` のアクション スキーマと `templates/mail/actions/trigger-automations.ts` のエグゼキュータを拡張します。

**キーボード ショートカットの変更。** キーバインド ハンドラーは `templates/mail/app/components/email/` にあります — `useHotkeys` または `addEventListener("keydown"` を検索して、各キーが接続されている場所を見つけます。

これらの変更をエージェントに依頼してください。エージェントは独自のソースを編集できます。[Self-Modifying Code](/docs/key-concepts#agent-modifies-code) を参照してください。
