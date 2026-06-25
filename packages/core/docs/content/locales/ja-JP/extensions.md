---
title: "拡張機能"
description: "ユーザーがテンプレート内に構築するミニアプリ - Analytics のカスタム KPI タイル、カレンダーの会議準備チェックリスト、メールの連絡先 CRM ウィジェット。デプロイ、コード編集、スキーマ変更は必要ありません。"
---

# 拡張機能

拡張機能は **ユーザーがテンプレート内に構築するミニアプリ**です。

QuickBooks Online を使用したことがある方は、このモデルを見たことがあるでしょう。QBO にはコアの会計製品が同梱されており、ユーザーは同じアプリ内に存在し、同じデータを使用する小さなカスタム ウィジェット (カスタム レポート、給与計算ツール、税金規則チェッカー) を重ねていきます。拡張機能は、ユーザーがコードを記述しない点を除いて、そのアイデアのエージェント ネイティブ バージョンです。彼らが望むものを説明し、エージェントがそれを構築します。

フレームワークは重要です。拡張機能は、一般的な「何でもできる」サンドボックスではありません。これは、特定のテンプレート** (メール、アナリティクス、カレンダー、クリップ、デザイン) を拡張する **ミニアプリであり、そのテンプレートの actions とデータを使用します。 Mail 拡張機能は電子メールを読み取ります。 Analytics 拡張機能は、ダッシュボードのメトリクスを読み取ります。カレンダー拡張機能は、開いているイベントに作用します。それらはホスト製品の一部であるため、ホスト製品の一部のように感じられます。

拡張機能を機能させるには 3 つの要素があります:

- **コードもデプロイも必要ありません。** エージェントがそれらを作成すると、数秒で有効になります。リポジトリではなくデータベースに保存されます。
- **テンプレートのデータへの完全なアクセス。** 拡張機能は、エージェントが呼び出すのと同じ actions (メールでは `list-emails`、スライドでは `list-decks`、クリップでは `list-recordings`) を呼び出すことができるため、ホスト アプリが持つすべての機能を備えています。
- **組み込みストレージ。** 各拡張機能にはユーザーごと/組織ごとに独自のキーと値のストアがあるため、新しい SQL テーブルを追加しなくても状態を保存できます。

テンプレートがユーザー作成の拡張機能を公開しない場合は、
`extensionTools: false` 上の `createAgentChatPlugin()`。これで
エージェント向けの内線番号 actions と、残りの部分を残す際のプロンプト ガイダンス
アプリエージェントはそのままです。

```an-diagram title="サンドボックスブリッジ" summary="拡張機能 HTML は分離された iframe で実行され、ブリッジ ヘルパーの固定セットを介してのみホストに到達します。すべての呼び出しはスコープ設定され、アクセス チェックされます。"
{
  "html": "<div class=\"ext-bridge\"><div class=\"diagram-card sandbox\" data-rough><span class=\"diagram-pill warn\">Sandboxed iframe</span><small class=\"diagram-muted\">Alpine.js HTML &middot; no host cookies, session, or DOM</small><div class=\"ext-helpers\"><span class=\"diagram-pill\">appAction</span><span class=\"diagram-pill\">appFetch</span><span class=\"diagram-pill\">dbQuery / dbExec</span><span class=\"diagram-pill\">extensionData</span><span class=\"diagram-pill\">extensionFetch</span></div></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&harr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">ホストテンプレート<br><small class=\"diagram-muted\">actions、自動スコープSQL</small></div><div class=\"diagram-box\">Secret proxy<br><small class=\"diagram-muted\"><code>${keys.NAME}</code>、ドメイン固定</small></div><div class=\"diagram-box\">外部API<br><small class=\"diagram-muted\">extensionFetchのみ</small></div></div></div>",
  "css": ".ext-bridge{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.ext-bridge .sandbox{display:flex;flex-direction:column;gap:8px;padding:16px 18px;flex:1;min-width:240px}.ext-bridge .ext-helpers{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}.ext-bridge .diagram-col{display:flex;flex-direction:column;gap:8px}.ext-bridge .diagram-arrow{font-size:24px}"
}
```

拡張機能は **ローカル ファイル モードでリポバックアップ**することもできます。そのワークフローでは、
`agent-native.json` は `extensions` フォルダーを宣言しており、各拡張子には
`extension.json` マニフェストと HTML エントリ ファイル、およびアプリはそれらをレンダリングします
ファイルは同じサンドボックスを経由します。ファイルベースの拡張子は、
リポジトリ ファイル。データベースベースの拡張機能により、ランタイムの作成/編集/共有が維持されます
以下に説明する経験

## 簡単なギャラリー {#gallery}

ユーザーが実際に構築する実際の拡張機能が、使用しているテンプレートごとにグループ化されています。それぞれが 1 つの焦点を当てたものであり、スイスアーミー ナイフではありません。

### メール

ユーザーが `priya@acme.com` からの電子メールを読んでいます。そこで役立つウィジェットは何ですか?

- **連絡先メモ** — ユーザーが電子メールを送信する相手に固定された付箋パッド。その連絡先のメモをロードし、ユーザーがさらに書き留められるようにします。
- **このユーザーとの最近のスレッド** — 受信トレイ ビューとは別に、オープンな連絡先との最近の 5 つのスレッドの小さなリスト。
- **CRM エンリッチメント** — 連絡先の会社規模、最終会議日、またはオープンな取引を CRM から取得します。
- **会議スケジューラのショートカット** — 「来週の時間を検索」をワンクリックの「これらのスロットを送信」ウィジェットに変えます。

スケッチ — 連絡先メモ (メールの送信者に関連付けられたメモを保存します):

```html
<div
  class="p-4"
  x-data="{
    contactEmail: window.slotContext?.contactEmail,
    note: '',
    async init() {
      if (!this.contactEmail) return;
      const saved = await extensionData.get('notes', this.contactEmail);
      if (saved) this.note = JSON.parse(saved.data).text;
    },
    async save() {
      await extensionData.set('notes', this.contactEmail, { text: this.note });
    }
  }"
>
  <p class="text-xs text-muted-foreground mb-2" x-text="contactEmail"></p>
  <textarea
    x-model="note"
    @blur="save()"
    class="w-full rounded-md border bg-background p-2 text-sm"
    rows="4"
    placeholder="Notes about this contact..."
  ></textarea>
</div>
```

### 分析

ユーザーはダッシュボードを見つめています。欠けているタイルは何ですか?

- **カスタム KPI ボックス** — 組み込みパネルではないメトリックの単一の大きな数値。 「トライアルは今週始まりました」、「MRR デルタと先月の比較」
- **目標トラッカー** — ユーザーが選択した指標を取得し、ユーザーが入力した目標に対する進捗状況を表示します。
- **上位顧客リーダーボード** — 指標を顧客テーブルと結合し、上位 10 位をランク付けします。

スケッチ — カスタム KPI ボックス (分析テンプレートの `appAction` クエリの 1 つを呼び出します):

```html
<div
  class="p-4"
  x-data="{
  value: null,
  async init() {
    const result = await appAction('query-agent-native-analytics', {
      metric: 'trials_started',
      range: '7d'
    });
    this.value = result?.total ?? 0;
  }
}"
>
  <p class="text-xs uppercase tracking-wider text-muted-foreground">
    Trials this week
  </p>
  <p class="text-3xl font-bold mt-1" x-text="value ?? '—'"></p>
</div>
```

### カレンダー

ユーザーはイベントを開いています。その瞬間に何が役立つでしょうか?

- **会議準備チェックリスト** — 公開イベントの議題項目、出席者、および以前のスレッドの概要を自動読み込みします。
- **移動時間** — 「ミッション会場での次の会議まで 35 分あります。」
- **タイムゾーン ヘルパー** — すべての出席者の現地時間で会議時間を一目で表示します。

### クリップ

ユーザーが画面録画をレビューしています。その見方を強化するものは何でしょうか?

- **アクション アイテム エクストラクター** — クリップ トランスクリプトを読み取り (エージェントは `appAction` 経由で取得します)、To-Do をリストします。
- **自動共有** — ワンクリックで「このクリップのリンクを私の #recordings Slack チャンネルに投稿します。」
- **ハイライト リール** — エージェントが生成したチャプターを取得し、クイック ナビゲーション メニューに変換します。

### デザイン

ユーザーが Alpine/Tailwind ページのドラフトを開いています。プロトタイピングのループをスムーズにするものは何でしょうか?

- **ブランド カラー見本** — ユーザーのブランド設定から取得されたパレット。クリックして色をエディターにコピーします。
- **アセット ピッカー** — ユーザーがアップロードした画像をリストし、クリックすると URL をドロップします。
- **間隔インスペクター** — アクティブ ページが使用するギャップ/パディング/マージン トークンを表示するため、ユーザーは一貫性を保つことができます。

これらすべてのパターン: 拡張機能は、ユーザーがホスト テンプレート内にいる**瞬間**に関するものです。エージェントは、どの連絡先、どのダッシュボード、どのイベント、どのクリップをすでに知っています。拡張機能はそのコンテキストを使用します。

## ユーザーが構築する方法 {#building}

単純なパス:

1. **サイドバーの [新しい拡張機能]** をクリックします (またはチャットで質問してください)。
2. **欲しいものを一文で説明してください。** 「メールする連絡先用の付箋パッド。」 「今週からトライアル用の KPI ボックスが始まりました。」
3. **エージェントがそれを作成すると、拡張機能リストに表示され、すぐに使用できるようになります。**

編集するファイルもデプロイも必要ありません。エージェントは適切なヘルパー (`appAction`、`extensionData`、`extensionFetch`) を選択し、Alpine.js HTML を書き込みます。

内線番号に API キー (CRM トークン、天気 API) が必要な場合、エージェントは何を追加するか、どこに追加するかを指示します。キーは暗号化されて保存され、特定のドメインにロックされます。

後で何かを変更したい場合は、「連絡先メモに検索ボックスを追加してください」と言うだけです。エージェントは HTML をその場で編集します。全体を再生成することはありません。

すべての変更はバージョン管理されます。拡張機能ビューアの履歴コントロールを開いて確認してください。
保存されたバージョン、以前のバージョンとの差分を検査し、
所有権を変更しない古い名前/説明/アイコン/コンテンツのスナップショット、または
共有。

## 拡張機能でできること {#capabilities}

iframe サンドボックス内では、すべての拡張機能に `window` の次のヘルパーがあります:

| ヘルパー                                         | 目的                                                                   | 例                                                        |
| ------------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------- |
| `appAction(name, params)`                        | ホスト テンプレートの actions のいずれかを呼び出します                 | `appAction('list-emails', { view: 'inbox' })`             |
| `appFetch(path, options)`                        | `/_agent-native/*` で許可されたフレームワーク エンドポイントを呼び出す | `appFetch('/_agent-native/application-state/navigation')` |
| `dbQuery(sql, args)`                             | SQL から読み取り (ユーザーに自動スコープ設定)                          | `dbQuery('SELECT id, name FROM tools')`                   |
| `dbExec(sql, args)`                              | SQL に書き込みます                                                     | `dbExec('INSERT INTO ...')`                               |
| `extensionFetch(url, options)`                   | シークレットを使用して安全なプロキシを介して外部 API にアクセスする    | `extensionFetch('https://api.github.com/user')`           |
| `extensionData.set(collection, id, data, opts?)` | 拡張子ごとにデータを保持する (ユーザー/組織のスコープ設定)             | `extensionData.set('notes', id, { text: '...' })`         |
| `extensionData.list(collection, opts?)`          | 永続化された項目をリストする                                           | `extensionData.list('notes', { scope: 'all' })`           |
| `extensionData.get(collection, id, opts?)`       | アイテムを 1 つ入手                                                    | `extensionData.get('notes', 'note-1')`                    |
| `extensionData.remove(collection, id, opts?)`    | 永続化されたアイテムを削除する                                         | `extensionData.remove('notes', 'note-1')`                 |

3 つの経験則:

- **`dbQuery` よりも `appAction` を優先します。** Actions はテンプレートの公式サーフェイスであり、アクセス制御、スコープ設定、検証を自動的に処理します。適切なアクションがない場合にのみ、生の SQL に手を伸ばしてください。
- **テンプレート データには `appAction` を使用します。** 拡張機能 `appFetch` はフレームワーク `/_agent-native/*` エンドポイントに限定されます。テンプレート `/api/*` ルートは iframe ブリッジによってブロックされています。
- **新しいテーブルを作成するよりも、`extensionData` を優先します。** 各拡張機能は、独自の分離されたキーと値のストアを取得します。スキーマも移行もありません。 `{ scope: 'org' }` をユーザーの組織と共有するように設定し、`'user'` (デフォルト) をプライベートに設定します。

```html
<script>
  // Private to me
  await extensionData.set('notes', 'note-1', { title: 'My note' });

  // Shared with my org
  await extensionData.set('notes', 'team-note', { title: 'Team note' }, { scope: 'org' });

  // List everything visible to me (mine + org)
  const all = await extensionData.list('notes', { scope: 'all' });
</script>
```

外部 API は `extensionFetch` を経由し、サーバー側で呼び出しをプロキシし、`${keys.NAME}` テンプレート経由でシークレットを置き換えます。

```html
<script>
  const res = await extensionFetch('https://api.github.com/user', {
    headers: { Authorization: 'Bearer ${keys.GITHUB_TOKEN}' },
  });
</script>
```

実際のキーはブラウザに到達しません。各キーはドメインの許可リストにロックされているため、漏洩した拡張機能が他の場所に流出することはありません。

## スロット — ホスト UI 内に拡張機能を配置する {#slots}

上記のギャラリーでは、拡張機能が「何をするか」を説明しています。スロットはそれが出現する*場所*を説明します。

デフォルトでは、拡張機能は拡張機能リスト内の独自のページに存在し、小さなアプリのように開きます。ダッシュボード、電卓、スタンドアロン ウィジェットにはこれで十分です。

しかし、最も QBO 型のユースケースは異なります。ユーザーは、ウィジェットをテンプレートの UI の内部に固定したいと考えています。メールのサイドバーの連絡先情報の下、Analytics ダッシュボードの隅、カレンダー イベントの右側に固定されます。 **スロット**はそのためにあります。

スロットは、テンプレートに付属する名前付きのウィジェット領域です。

| テンプレート   | スロットの例                   | それが現れる場所                      |
| -------------- | ------------------------------ | ------------------------------------- |
| **メール**     | `mail.contact-sidebar.bottom`  | 各電子メール スレッドの連絡先情報の下 |
| **分析**       | `analytics.dashboard.tiles`    | ダッシュボードの内蔵パネルの横        |
| **カレンダー** | `calendar.event-detail.bottom` | オープンイベントの下                  |
| **クリップ**   | `clips.right-panel.tabs`       | クリップレビューパネルの新しいタブ    |

拡張機能が **スロットにインストール**されると、ホストは関連するコンテキスト (連絡先の電子メール、ダッシュボード ID、イベント ID) を iframe にプッシュします。拡張機能は `window.slotContext` を読み取り、ユーザーが何を見ているかを把握します。

```an-diagram title="スロットはコンテキストをウィジェットにプッシュします" summary="ホスト テンプレートは名前付きスロットを所有します。拡張機能を拡張機能にインストールすると、ユーザーが現在表示しているものに対して window.slotContext がフィードされます。"
{
"html": "<div class=\"slot\"><div class=\"diagram-card\"><span class=\"diagram-pill\">メールスレッド</span><small class=\"diagram-muted\">slot <code>mail.contact-sidebar.bottom</code></small></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box accent\"><code>window.slotContext</code><br><small class=\"diagram-muted\">{ contactEmail }</small></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">連絡先メモ</span><small class=\"diagram-muted\">loads notes for that contact &mdash; same widget, different context</small></div></div>",
"css": ".slot{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.slot .diagram-card{display:flex;flex-direction:column;gap:4px;padding:14px 16px;min-width:180px}.slot .diagram-arrow{font-size:22px}"
}

```

### 具体的な例

ギャラリーからの連絡先メモ拡張機能を想像してください。それ自体はスタンドアロンのウィジェットです。メール連絡先サイドバー内に表示するには:

1. 拡張機能を 1 回ビルドします。 `window.slotContext.contactEmail` を使用して、ユーザーがどの連絡先にいるかを認識します。
2. 埋めることができるスロットを伝えます: `add-extension-slot-target { extensionId, slotId: "mail.contact-sidebar.bottom" }`。
3. `install-extension { extensionId, slotId: "mail.contact-sidebar.bottom" }` をインストールします。

次に電子メール スレッドを開くと、連絡先情報のすぐ下に付箋パッドが表示され、電子メールを送信している相手へのメモが入力されます。別のスレッドに切り替えて、_that_ コンタクトのメモをロードします。同じ拡張子、異なるコンテキスト、書き換えなし。

実際には、これら 3 つのコマンドを手動で実行することはありません。 「このウィジェットを連絡先サイドバーにピン留めする」と言うだけで、エージェントがターゲットとインストールを自動的に処理します。

> **スロットは追加された機能であり、前提条件ではありません。** 多くの便利な拡張機能はスロットにインストールされることはなく、独自のページで問題なく動作します。ユーザーがホスト テンプレートで見ているものの*隣*にウィジェットを配置する必要がある場合は、スロットに手を伸ばします。

スロットの詳細 (テンプレート内でスロットを宣言する方法、コンテキスト コントラクトがどのように機能するか、インストールのスコープがどのように設定されるかなど) については、`extension-points` スキルを参照してください。 Skills は、`.agents/skills/` の下のすべてのスキャフォールド テンプレート内に同梱されます。仕組みについては、[Skills Guide](/docs/skills-guide) を参照してください。

## ローカル ファイル拡張子 {#local-file-extensions}

ローカル ファイル モードでは、ワークスペースで拡張機能をリポジトリに保持できます:

```text
extensions/
  doc-status/
    extension.json
    index.html
```

```json
{
  "id": "doc-status",
  "name": "Doc Status",
  "description": "Shows metadata for the selected Content file.",
  "entry": "index.html",
  "slots": ["content.sidebar.bottom"],
  "permissions": {
    "appActions": ["list-documents"],
    "extensionData": true
  }
}
```

`agent-native.json` の関連アプリにフォルダーを追加します。

```json
{
  "apps": {
    "content": {
      "mode": "local-files",
      "roots": [{ "name": "Docs", "path": "docs", "extensions": [".mdx"] }],
      "components": "components",
      "extensions": "extensions"
    }
  }
}
```

アプリは、ファイルベースの拡張機能をデータベースベースの拡張機能と並べてリストし、レンダリングします
それらは通常のサンドボックス iframe を介して送信されます。 `extension.json`
拡張機能を一致する `ExtensionSlot` に自動マウントします。ユーザーごとの設定はありません
ローカル拡張機能の SQL インストール行。

ローカル拡張機能には、より厳密な v1 権限モデルがあります:

- `extensionData` は、無効になっていない限り、小規模なランタイム状態で使用できます。
- `appAction` 呼び出しは、`permissions.appActions` に明示的にリストする必要があります。
- `dbQuery`、`dbExec`、および `extensionFetch` は現在ブロックされています。
- SQL による更新、削除、共有、履歴 actions は次のメッセージを返します。
  ローカルエントリファイルを指します。

ユーザーがウィジェットを作成/共有/編集する必要がある場合は、データベースベースの拡張機能を使用します
ランタイム。拡張子がリポジトリの一部である場合は、ローカル ファイル拡張子を使用します
ワークスペースであり、レビュー可能、パッチ適用可能、および残りの部分とバージョン管理できる必要があります
ファイル。

## 共有 {#sharing}

拡張機能は、デフォルトでは、拡張機能を作成したユーザーにのみ公開されます。共有するには:

- **組織に表示** — 組織内の全員が表示して使用できます。
- **ユーザーごとの許可** — 特定のユーザーを閲覧者/編集者/管理者として招待します。

共有拡張機能には独自の URL があり、ドキュメント、デッキ、ダッシュボードと同じ共有ダイアログにプラグインされます。スロットのインストールは常に個人的なものです。拡張機能を共有すると、他の人がそれをインストール*できる*ということになります。 UI に自動的に固定されません。

## 拡張機能とアプリ コードの編集 {#vs-app-code}

このフレームワークを使用すると、エージェントはアプリのソース コード (コンポーネント、ルート、スタイル) を直接編集できます。では、いつ延長を求めるべきでしょうか?

|                        | 延長                                                         | アプリコードの編集                   |
| ---------------------- | ------------------------------------------------------------ | ------------------------------------ |
| **作成者**             | 実行時のエージェント (またはユーザー)                        | エージェント編集ソース ファイル      |
| **保存場所**           | データベース                                                 | git リポジトリ                       |
| **ビルドが必要です**   | いいえ                                                       | はい                                 |
| **デプロイが必要です** | いいえ                                                       | はい                                 |
| **範囲**               | 1 人のユーザー (または組織と共有)                            | 製品全体、すべてのユーザー           |
| **こんな方に最適**     | 個人用ウィジェット、カスタム KPI、チームごとのユーティリティ | すべてのユーザーに提供されるコア機能 |

経験則: **1 ユーザーまたは 1 チーム用の場合、それは拡張機能です。** テンプレートのすべてのユーザーがそれを入手する必要がある場合は、実際の機能として出荷してください。

## セキュリティ {#security}

```an-callout
{ "tone": "success", "body": "**The raw secret never reaches the browser.** `extensionFetch` substitutes `${keys.NAME}` server-side and each key is locked to a URL allowlist, so even a leaked extension can't exfiltrate it elsewhere." }
```

拡張機能はサンドボックス iframe で実行されます:

- 親アプリの Cookie、セッション、DOM から**分離**。
- `${keys.NAME}` テンプレートを使用した**サーバー側のシークレット インジェクション** — 実際のキーの値がブラウザーに到達することはありません。
- **ドメインロックされたシークレット** — 各キーは URL ホワイトリストにバインドされています。プロキシは他のホストへのリクエストを拒否します。
- **プライベート ネットワーク保護** — 拡張機能は内部アドレスに到達できません。
- **認証が必要** — 拡張機能はログイン ユーザーに対してのみ実行され、`dbQuery` / `dbExec` 呼び出しは自動スコープされます。

## 名前付けについて知っておくべきいくつかのこと {#naming-back-compat}

SQL またはソースを調べていると、「拡張機能」と「ツール」の名前が混在しているのがわかります。クイック デコーダ:

- ユーザー向けのプリミティブは、以前は「ツール」と呼ばれていました。現在は **拡張機能** です。
- 物理 SQL テーブル (`tools`、`tool_data`、`tool_shares`、`tool_slots`、`tool_slot_installs`) は元の名前を保持します。テーブルの名前変更は破壊的な移行であり、フレームワークは破壊的な移行を提供しません。
- Drizzle / TypeScript エクスポートでは、新しい名前: `extensions`、`extensionData`、`extensionShares`、`extensionSlots`、`extensionSlotInstalls` が使用されます。
- 拡張機能の iframe 内では、正規ヘルパーは `extensionFetch` と `extensionData` です。従来の名前 `toolFetch` および `toolData` は引き続き解決されるため、古い拡張機能 HTML は引き続き機能します。

これも通常の使用では見られませんが、エージェントには「LLM ツール」と呼ばれる 3 番目の関連概念があります。これは、モデル ターンにおける関数呼び出しの表面積 (`defineAction`、MCP などで定義) です。これらは関数呼び出しプリミティブであり、ユーザー向けのウィジェットではありません。このページに「拡張機能」と記載されている場合、それはユーザー向けのウィジェットを意味します。他のドキュメントで `defineAction` と並んで「ツール」と書かれている場合、それは LLM の概念です。

## 次は何ですか

- [**Templates**](/docs/cloneable-saas) — ホスト アプリ拡張機能の拡張
- [**Actions**](/docs/actions) — 拡張機能が `appAction` 経由で呼び出す操作
- [**Sharing & Privacy**](/docs/sharing) — 拡張機能の公開設定、組織共有、ユーザーごとの付与の仕組み
- [**Onboarding & API Keys**](/docs/onboarding) — 設定 UI で秘密がどのように表面化するか
- [**Security**](/docs/security) — フレームワークのデータスコープとアクセスモデル
