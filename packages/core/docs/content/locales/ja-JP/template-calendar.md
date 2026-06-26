---
title: "カレンダー"
description: "Google Calendar 同期と Calendly スタイルの予約リンクを備えたエージェント主導のカレンダー。平易な英語でスケジュールを設定し、スロットを検索し、空き状況を管理します。"
---

# カレンダー

エージェントが利用するカレンダー アプリ。 Google Calendar に接続すると、エージェントはあなたのスケジュールを読み取り、空き枠を見つけ、イベントを作成し、Calendly スタイルの予約リンクを管理できます。これらはすべて平易な英語で行われます。 Google Calendar + Calendly のコンボを、あなたが所有する 1 つのアプリに置き換えます。

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;min-height:530px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1.4px solid var(--wf-line)'><button>Week</button><button>Today</button><button>‹</button><button>›</button><div style='flex:1'></div><strong>2026年5月3日-9日</strong><div style='flex:1'></div><button class='primary'>新しいイベント</button></div><div style='display:grid;grid-template-columns:56px repeat(7,minmax(0,1fr));grid-template-rows:36px repeat(5,72px);gap:7px;padding:14px;flex:1'><div></div><strong>日 3</strong><strong>月 4</strong><strong>火 5</strong><strong>水 6</strong><strong>木 7</strong><strong>金 8</strong><strong>土 9</strong><small class='wf-muted'>7 AM</small><div class='wf-box' style='opacity:.45'></div><div></div><div></div><div></div><div></div><div></div><div></div><small class='wf-muted'>9 AM</small><div class='wf-box'>全社会議</div><div class='wf-box'>エンジニアリングスタンドアップ</div><div class='wf-box'>エンジニアリングスタンドアップ</div><div class='wf-box'>エンジニアリングスタンドアップ</div><div></div><div class='wf-box'>Planning</div><div></div><small class='wf-muted'>11 AM</small><div class='wf-box'>デザインレビュー</div><div></div><div class='wf-box'>デザイン講評</div><div class='wf-box'>Roadmap</div><div class='wf-box'>金曜デモ</div><div></div><div></div><small class='wf-muted'>1 PM</small><div></div><div class='wf-box'>1:1</div><div class='wf-box'>集中ブロック</div><div></div><div></div><div class='wf-box'>全社会議</div><div></div><small class='wf-muted'>3 PM</small><div></div><div></div><div></div><div class='wf-box'>スキップレベル</div><div></div><div></div><div></div></div></div>"
}
```

アプリを開くと、アクティブなカレンダー ビューが主な画面になります。エージェントは、あなたがどの曜日、週、またはイベントを見ているのかを把握しているため、すべてを詳しく説明しなくても、「この日にアレックスとの 30 分間の通話をスケジュールしてください」と言うことができます。

```an-diagram title="スケジュールリクエストの流れ" summary="カレンダー内をクリックするか、エージェントに問い合わせるかにかかわらず、同じアクションが Google Calendar からライブで読み込まれ、同じビューに書き戻されます。"
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">クリックする<br><small class=\"diagram-muted\">ドラッグ、ツールバー、ショートカット</small></div><div class=\"diagram-node\">エージェントに依頼<br><small class=\"diagram-muted\">\"find a 1-hour slot next week\"</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Actions</span><small class=\"diagram-muted\">list-events · check-availability · create-event</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">Google Calendar<br><small class=\"diagram-muted\">ライブ、複数アカウント</small></div><div class=\"diagram-box\">SQL<br><small class=\"diagram-muted\">予約 · 空き状況</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-box\">カレンダー表示がライブ更新されます</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## それを使って何ができるか

- **複数のアカウントを重ね合わせて、日、週、月のビューで実際の Google Calendar を確認します**。
- **ICS フィードを購読** (人事休暇、会議スケジュール、チーム カレンダー) — 読み取り専用で、同じビューに混合されます。
- タイムゾーン サポートを使用して**毎週の空き状況を設定**します。エージェントは空きスロットを見つけるときにこれを使用します。
- **「15 分のイントロ」や「30 分のデモ」などの公開予約リンクを `/book/{slug}` で作成**します。期間、カスタム フィールド、使用する会議ツールを設定します。
- **スケジュールに関することはエージェントに質問してください**: 「木曜日の午後は空いていますか?」 「来週 1 時間の枠を見つけて、『アレックスとの計画』を付けてください。」 「デモ予約リンクを一時停止してください。」
- **予約リンク**をチームメイトと共有して、チームメイトも管理できるようにします。

## はじめに

ライブデモ: [calendar.agent-native.com](https://calendar.agent-native.com)。

初めてアプリを開いたとき:

1. [**設定**] をクリックします。
2. [**Google Calendar に接続**] をクリックして承認します。
3. （オプション）個人用と仕事用を重ねて表示したい場合は、さらに Google アカウントを接続します。
4. メイン ビューを開きます。実際のカレンダーが読み込まれます。

最初の予約リンクを作成するには:

1. サイドバーの **予約リンク** をクリックします。
2. **新しい予約リンク** をクリックし、タイトルと期間を設定します。
3. パブリック URL を共有します — 訪問者は利用可能なスロットから選択します。

または、エージェントに「名前フィールドを含む 15 分間の紹介予約リンクを作成してください」と依頼してください。

### 便利なプロンプト

- 「今日のカレンダーには何が入っていますか?」
- 「木曜日の午後、30 分間空いていますか?」
- 「来週 1 時間の枠を見つけて、それに『アレックスとの計画』を付けてください。」
- 「このイベントを金曜日の午後 2 時に変更します。」 (イベント選択時)
- 「日表示に切り替えて、次の月曜日にジャンプします。」
- 「メモ フィールドを使用して、15 分に「15 分イントロ」という予約リンクを作成します。」
- 「「30 分デモ」の予約リンクを一時停止します。」
- 「金曜日の午後は私の都合に合わせてブロックします。」
- 「今月は『立ち上げ』についてどのような会議がありますか?」

エージェントはスケジュールに関する質問についてライブで Google Calendar にクエリを実行します。決して推測することはありません。

## 開発者向け

このドキュメントの残りの部分は、カレンダー テンプレートをフォークしたり拡張したりする人を対象としています。

### クイックスタート

カレンダー テンプレートを使用して新しいワークスペースを作成します:

```bash
npx @agent-native/core@latest create my-app --standalone --template calendar
cd my-app
pnpm install
pnpm dev
```

`http://localhost:8082` (デフォルトのカレンダー開発ポート) を開きます。

開発環境で Google Calendar に接続するには、設定ビューを開き、[Google Cloud Console](https://console.cloud.google.com/) から `GOOGLE_CLIENT_ID` と `GOOGLE_CLIENT_SECRET` を貼り付けて、[Google Calendar を接続] をクリックします。 OAuth リダイレクト URI は、開発環境では `http://localhost:8082/_agent-native/google/callback` です。トークンは `oauth_tokens` SQL テーブルに保存され、自動的に更新されます。

### 主な機能

**ライブ カレンダー ビュー。** 日、週、月のビューは、接続されている Google アカウントから直接読み取られ、オプションの読み取り専用 ICS フィードが同じスケジュールに階層化されます。

**空き状況と空きスロットの検索。** 毎週の空き状況ルール、タイムゾーンのサポート、および既存のイベントはすべて、UI とエージェントが使用する同じ空き状況アクションをフィードします。

**予約リンク。** 公開 `/book/{slug}` ページでは、名前、電子メール、カスタム フィールド、会議設定、キャンセル/再スケジュール トークンが収集されます。

**共有可能な管理。** 予約リンクはデフォルトでは非公開ですが、フレームワーク共有 actions を通じてチームメイトと共有できます。

**インライン イベント プレビュー。** エージェントは、タイトル、時間、場所、出席者、およびジャンプバック ボタンを備えたコンパクトなイベント カードをチャットに埋め込むことができます。

### エージェントとの連携

エージェントはあなたが見ているものを見ます。現在のカレンダー ビュー、選択した日付、および選択したイベントは、`current-screen` ブロックとしてすべてのメッセージに含まれるため、「このイベント」または「この日」と言うと、正しく解決されます。

内部では、エージェントは `list-events`、`check-availability`、`create-event`、`navigate`、`update-availability` などの actions を呼び出します。イベントは Google Calendar に存在するため、エージェントは推測ではなく常に API をクエリします。最初にスクリプトを実行しない限り、空の結果は返されません。

### データモデル

`templates/calendar/server/db/schema.ts` で定義されています。非イベント データのみがローカルに保存されます:

- `bookings` — 公開予約ページから予約を確認しました。名前、電子メール、開始、終了、スラッグ、オプションのメモ、カスタム フィールドの応答、会議リンク、パブリック管理 URL の `cancelToken`、および `confirmed` または `cancelled` ステータスを保存します。
- `booking_links` — Calendly スタイルのリンク定義。スラッグ、タイトル、説明、プライマリ `duration`、オプションの `durations` リスト、`customFields`、`conferencing`、`color`、および `isActive` フラグ。フレームワークの `ownableColumns` を使用するため、共有システムが適用されます。
- `booking_slug_redirects` — リンクの名前が変更されたときに古いスラッグを記憶するため、既存のパブリック URL は動作し続けます。
- `booking_link_shares` — 予約リンクの共有許可。

```an-schema title="カレンダーデータモデル" summary="イベント以外のデータのみがローカルに保存されます。イベントは Google カレンダーに保存されます。予約リンクは ownableColumns を使用するため、共有システムが適用されます。"
{
  "entities": [
    {
      "id": "booking_links",
      "name": "booking_links",
      "note": "Calendly-style link definitions (ownable)",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "slug", "type": "string", "note": "public page at /book/{slug}" },
        { "name": "title", "type": "string" },
        { "name": "description", "type": "string", "nullable": true },
        { "name": "duration", "type": "int", "note": "primary duration in minutes" },
        { "name": "durations", "type": "json", "nullable": true, "note": "alternative durations" },
        { "name": "customFields", "type": "json", "nullable": true },
        { "name": "conferencing", "type": "string", "note": "Google Meet / Zoom / カスタム" },
        { "name": "color", "type": "string", "nullable": true },
        { "name": "isActive", "type": "bool", "note": "pause without deleting" }
      ]
    },
    {
      "id": "bookings",
      "name": "bookings",
      "note": "公開予約ページからの予約の確認",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "slug", "type": "string", "fk": "booking_links.slug" },
        { "name": "name", "type": "string" },
        { "name": "email", "type": "string" },
        { "name": "start", "type": "datetime" },
        { "name": "end", "type": "datetime" },
        { "name": "notes", "type": "string", "nullable": true },
        { "name": "customFields", "type": "json", "nullable": true, "note": "custom field responses" },
        { "name": "meetingLink", "type": "string", "nullable": true },
        { "name": "cancelToken", "type": "string", "note": "powers /booking/manage/{token}" },
        { "name": "status", "type": "enum", "note": "確認済み |キャンセル" }
      ]
    },
    {
      "id": "booking_slug_redirects",
      "name": "booking_slug_redirects",
      "note": "リンクの名前が変更された後も古いパブリック URLs が機能し続ける",
      "fields": [
        { "name": "oldSlug", "type": "string", "pk": true },
        { "name": "linkId", "type": "id", "fk": "booking_links.id" }
      ]
    },
    {
      "id": "booking_link_shares",
      "name": "booking_link_shares",
      "note": "予約リンクの共有許可",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "linkId", "type": "id", "fk": "booking_links.id" },
        { "name": "principal", "type": "string", "note": "user or org" },
        { "name": "role", "type": "enum", "note": "ビューア |編集者 |管理者" }
      ]
    }
  ],
  "relations": [
    { "from": "booking_links", "to": "bookings", "kind": "1-n", "label": "has bookings" },
    { "from": "booking_links", "to": "booking_slug_redirects", "kind": "1-n", "label": "has old slugs" },
    { "from": "booking_links", "to": "booking_link_shares", "kind": "1-n", "label": "has share grants" }
  ]
}
```

可用性ルールとユーザーごとの構成は、`calendar-availability` をキーとする設定テーブルに存在します。 Google OAuth トークンは、フレームワーク `oauth_tokens` テーブルに存在します。一時的な UI 状態 (現在のビュー、日付、選択されたイベント) は、`navigation` キーの下の `application_state` に存在します。

### カスタマイズ

アプリのすべての部分は編集可能なソースです。ここから始めてください:

- `templates/calendar/actions/` — エージェント呼び出し可能なすべての操作。 `defineAction` を含む新しいファイルを追加して、エージェントとフロントエンドの両方に新しい機能を公開します。キー ファイル: `check-availability.ts`、`create-event.ts`、`list-events.ts`、`create-booking-link.ts`、`update-availability.ts`、`add-external-calendar.ts`、`navigate.ts`、`view-screen.ts`。
- `templates/calendar/app/routes/` — UI。 `_app._index.tsx` はカレンダー、`_app.availability.tsx` はスケジュール エディター、`_app.booking-links._index.tsx` と `_app.booking-links.$id.tsx` は予約リンクを管理、`_app.bookings.tsx` は予約リスト、`_app.settings.tsx` は設定、`book.$slug.tsx` と `meet.$username.$slug.tsx` は公開予約ページです。
- `templates/calendar/server/db/schema.ts` — Drizzle を使用して列またはテーブルを追加します。テンプレートが SQLite、Postgres、Turso、D1、および Neon で実行されるように、コードを方言に依存しないようにしてください。
- `templates/calendar/AGENTS.md` — エージェントの指示。エージェントに新しい機能や規則を教える場合は、これを更新してください。
- `templates/calendar/.agents/skills/` — エージェントが従う詳細なパターン。関連する skills: `event-management`、`availability-booking`、`real-time-sync`、`storing-data`、`delegate-to-agent`、`frontend-design`。
- `templates/calendar/shared/api.ts` — サーバーとクライアントの両方で使用される共有 TypeScript タイプ (`AvailabilityConfig`、`BookingLink`、`ExternalCalendar` など)。

機能を追加する場合は、UI、アクション、スキル、または AGENTS.md エントリ、およびエージェントが確認する必要があるアプリケーションの状態の 4 つの領域をすべて更新することを忘れないでください。これにより、エージェントと UI が同等に保たれます。
