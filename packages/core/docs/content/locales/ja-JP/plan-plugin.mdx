---
title: "プラグインとマーケットプレイスの計画"
description: "Agent-Native プラン skills (/visual-plan、/visual-recap) とホストされたプラン MCP コネクタを、Claude コードまたは Codex プラグインとして、またはユニバーサル CLI とともにインストールします。更新の仕組みと、何かを送信する必要があるかどうか。"
---

# プラグインとマーケットプレイスの計画

Agent-Native **プラン** アプリは、1 つのインストール可能なバンドルとして出荷されます。 1 回のインストールでプランのスラッシュ コマンド skills **と**の両方が追加され、ホストされたプラン MCP コネクタが接続されるため、エージェントはプランを生成でき、skills はそれらをプラン アプリに直接公開できます。

## 得られるもの {#what-you-get}

1 回のインストールで次のことが可能になります:

- **2 つの skills** — `/visual-plan` (正規のエントリ ポイント) と `/visual-recap`。
- **プラン MCP コネクタ** — `https://plan.agent-native.com` (MCP エンドポイント `https://plan.agent-native.com/_agent-native/mcp`、サーバー名 `plan`) でホストされているアプリに対して登録されています。

```an-diagram title="3つのルート、1つのバンドル" summary="ユニバーサル CLI、Claude Code プラグイン、および Codex プラグインはすべて、同じ 2 つのスキルとホストされたプラン コネクタをインストールします。"
{
  "html": "<div class=\"diagram-routes\"><div class=\"diagram-col\"><div class=\"diagram-node\">Universal CLI<br><small class=\"diagram-muted\">skills add visual-plan</small></div><div class=\"diagram-node\">Claude Codeプラグイン<br><small class=\"diagram-muted\">/plugin install</small></div><div class=\"diagram-node\">Codexプラグイン<br><small class=\"diagram-muted\">codex plugin add</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">/visual-plan</span><span class=\"diagram-pill accent\">/visual-recap</span><small class=\"diagram-muted\">two skills</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">Plan MCP connector<br><small class=\"diagram-muted\">plan.agent-native.com/_agent-native/mcp</small></div></div>",
  "css": ".diagram-routes{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-routes .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-routes .diagram-arrow{font-size:22px;line-height:1}.diagram-routes .center{display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}.diagram-routes .center .diagram-pill{margin:2px}"
}
```

デフォルトでは、両方の skills がホストされたプラン アプリに公開します。
MCP コネクタを接続し、確認するためのリンクまたはインライン プランを渡します。彼らは決してダンプしません
インライン Markdown/ASCII 計画を成果物としてチャットに追加します。計画ツール
`needs auth`、`Unauthorized`、または `Session terminated` を返し、再認証します
インライン出力にフォールバックするのではなく、コネクタを使用します。アクセストークンは
有効期間が長い（デフォルトは 30 日、スライド式で 365 日更新）ため、これはまれです。
問題が発生した場合の軽量修正は次のとおりです。

```bash
npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex
```

`reconnect` は、選択したローカルの URL によってコネクタを検索して更新します
クライアント — 再インストールは必要ありません。再接続後に新しい Codex スレッドを開始します。
ツール レジストリがリロードされます。 Claude コードでは、同等のものは `/mcp` →
**認証/再接続**、または `--client claude-code` を使用した同じコマンド。

例外は、明示的な **ローカル ファイル プライバシー モード**です。 DB なしを要求する場合
`AGENT_NATIVE_PLANS_MODE=local-files` を書き込むか設定します。skills は呼び出すことはできません
プラン MCP コネクタ。 `plans/<slug>/plan.mdx` とオプション
`canvas.mdx`、`prototype.mdx`、`.plan-state.json` を選択し、次のようにローカルでプレビューします。

```bash
npx @agent-native/core@latest plan local serve --dir plans/<slug> --kind plan --open
```

これにより、小さな localhost ブリッジが開始され、ローカルに対してプラン UI が開きます
フォルダー。 (`plan local preview` は、代わりにローカルの Plan dev-server ルートを実行します。
`plan local preview --out preview.html` は、
スタンドアロンの静的 HTML ファイル。 `plan serve` は
`plan local serve`.)

知っておく価値のあるローカル ファイル モードの注意事項:

- **Chromium ブラウザを使用してください。** Safari は、ホストされている HTTPS プラン ページをブロックします
  `http://127.0.0.1` ローカルホスト ブリッジの読み取り (混合コンテンツ / プライベート
  ネットワーク) のため、ページが「プランの読み込み中」でハングします。 macOS `--open` ではすでに
  Chrome/Chromium/Edge/Brave を優先します。とにかく Safari が開く場合は、印刷されたファイルを再度開きます
  Chromium ブラウザの URL。
- **提供される URL は `plans/<slug>/.plan-url`** に書き込まれます (
  `--url-file`)。バックグラウンドまたはヘッドレス エージェントは、
  長時間実行されている `serve` stdout をスクレイピングしています。それをローカル トークン ファイルとして扱います。
  コミットしないでください。
- 使用可能なブラウザがない場合は**ヘッドレスで検証**:
  `npx @agent-native/core@latest plan local verify --dir plans/<slug>` が
  ブリッジ、プライベート ネットワーク プリフライトと JSON ペイロードをチェックし、出力します
  診断、失敗時にゼロ以外で終了 - 人間の目は必要ありません。
- **最初に `plan local check` を実行します。** 計画に対して MDX を検証します
  レンダラーのブロック スキーマ (`checklist` 項目などの必須フィールドを含む
  `id`/`label` および `question-form` の質問 `id`/`title`/`mode`)、オーサリング
  間違いはローダーのスタックとしてではなく、ブラウザのハンドオフの前に表面化します。

現在のリポジトリ内のフォルダーの場合、直接ローカル ルートには `?path=...` が含まれるため
ローカルの Plan アプリでは、ブラウザーの編集内容をリポジトリ フォルダーに保存し続けることができます。計画
アプリはデフォルトの場所として `agent-native.json` の `apps.plan.roots[0].path` を使用します
プロモートされたローカル プランを保存し、`plans/` にフォールバックします。

これにより、計画の内容が Agent-Native 計画データベースに保存されなくなります。ホスト型共有、
コメント、スクリーンショット、プラン履歴は、明示的にユーザーが指定するまで利用できません
後で公開します。

```an-diagram title="ホスト ファイル モードとローカル ファイル モード" summary="デフォルトでは、スキルはコネクタを通じて公開されます。ローカル ファイル モードは、MDX をディスクに書き込み、代わりにローカルホスト ブリッジ経由でプレビューします。"
{
  "html": "<div class=\"diagram-modes\"><div class=\"diagram-card\"><span class=\"diagram-pill accent\">デフォルト · ホスト済み</span><strong>Planアプリに公開</strong><small class=\"diagram-muted\">MCP connector &rarr; hosted DB &rarr; share links, comments, history, screenshots</small></div><div class=\"diagram-card\"><span class=\"diagram-pill warn\">ローカルファイルのプライバシー</span><strong>MDX をディスクに書き込む</strong><small class=\"diagram-muted\">plan.mdx + canvas.mdx + prototype.mdx &rarr; localhost bridge &rarr; hosted Plan UI reads local source. No DB 書き込みs until <code>publish-visual-plan</code>.</small></div></div>",
  "css": ".diagram-modes{display:flex;gap:14px;flex-wrap:wrap}.diagram-modes .diagram-card{flex:1 1 260px;display:flex;flex-direction:column;gap:6px;padding:16px 18px}"
}
```

Agent Native デスクトップには、ホスト型プラン用の別のローカル ファイル同期パスがあります:
デスクトップ アプリは、ホストされたプランをローカルの MDX ファイルにミラーリングし、編集内容をインポートして戻すことができます
プラン アプリのクローンを作成したり、CLI を実行したりする必要はありません。このワークフローにより、ホストされた状態が維持されます
信頼できる情報源としてデータベースを計画します。目標
プラン DB への書き込みはありません。

> プラグイン (`agent-native-visual-plans`) にはアプリ ID `visual-plans` が含まれているため、Claude コード プラグイン名と Codex プラグイン名は両方とも `agent-native-visual-plans` です。プラン アプリの表示名は「Agent-Native プラン」です。

## ルートのインストール {#install}

3 つの方法があります。**ユニバーサル CLI ルート**は、skills をインストールし、\*\* 1 つのフローでホスト モード、ローカル ファイル モード、またはセルフホスト モードを選択できるため、デフォルトで推奨されるルートです。プラグイン ルートは、ファーストクラスのプラグイン/マーケットプレイス システムを備えたホスト用であり、デフォルトでホストされたプランを使用します。

### ユニバーサル スキル ルート (任意の MCP ホスト) {#universal}

あらゆるホストで動作します - Claude コード、Codex、カーソル、Cline、Goose、ChatGPT カスタム MCP アプリ、Claude Cowork、およびその他の MCP 互換のもの。 Agent-Native CLI は、両方の skills をインストールし、ホストされたプラン MCP コネクタを登録し、**同じステップで選択したローカル クライアントの認証を実行します**。そのため、最初のツール呼び出しで OAuth の壁にぶつかることがありません。

```bash
npx @agent-native/core@latest skills add visual-plan
```

これにより、`visual-plan` とコンパニオンの `visual-recap` スキルがインストールされ、その後、`plan` コネクタが登録され、認証が実行されます (ホスト型/アカウントバックアップ共有の OAuth プロンプト)。便利なフラグ:

- `--client codex|claude-code|claude-code-cli|cowork|all` — MCP 構成を書き込むローカル エージェント (デフォルトは `all`)。
- `--no-connect` — 認証せずにコネクタを登録します。後で `npx @agent-native/core@latest connect https://plan.agent-native.com --client all` を実行するか、より狭い `--client` を選択してください。
- `--mode hosted|local-files|self-hosted` — ホスト型共有、すべてローカルの MDX ファイル、または独自のプラン アプリを選択します。
- `--mcp-url <url>` — ホストされたデフォルトではなく、カスタム起点 (ngrok トンネル、ローカル開発サーバー、または自己ホスト型展開) をコネクターに向けます。
- `--with-github-action` — PR Visual Recap GitHub アクションも記述します ([PR Visual Recap](/docs/pr-visual-recap) を参照)。

インタラクティブ インストールでは、ワークフローがない場合に PR Visual Recap アクションも提供されます
存在します。スキルのセットアップ中に「はい」と答えて追加するか、後で上記のコマンドを実行します
`--with-github-action` 付き。ワークフローを作成したら、次を実行します。

```bash
npx @agent-native/core@latest recap setup
npx @agent-native/core@latest recap doctor
```

`recap setup` は、可能であれば GitHub アクションのシークレットと変数を構成します。
そして、`recap doctor` はワークフロー、ローカル公開トークン、GitHub リポジトリを検証します
アクセス、および必要な Actions 構成。インストールが完了したら、再起動するか、
エージェント クライアントをリロードして、新しい skills とツールをロードしてから実行します
`/visual-plan`.

> 注: ベア `npx skills@latest add BuilderIO/agent-native --skill visual-plan` (Vercel/open Skills CLI) は **手順のみ** をインストールします。MCP コネクタは登録されません。コネクタも配線したい場合は、上記の Agent-Native CLI を使用してください。

### Claude コード (プラグイン) {#claude-code}

パブリック `BuilderIO/agent-native` リポジトリ自体は Claude コード プラグイン マーケットプレイスであるため、ビルド手順なしで直接追加します。 Claude コード内:

```text
/plugin marketplace add BuilderIO/agent-native
/plugin install agent-native-visual-plans@agent-native-apps
/reload-plugins
/mcp        # authenticate the Plan connector (one OAuth approval)
```

`/plugin install` は、プラン skills と **URL のみ** MCP 構成の両方を追加します (パッケージにシークレットはありません)。 `/mcp` → **認証**により、OAuth ハンドシェイクが完了します。ローカル ファイルまたはセルフホスト モードが必要な場合は、代わりにユニバーサル CLI ルートを使用してください。

> マーケットプレイス カタログの名前は `agent-native-apps`、プラン プラグインの名前は `agent-native-visual-plans` であるため、インストール ターゲットは常に `agent-native-visual-plans@agent-native-apps` です。

### Codex (プラグイン) {#codex}

同じリポジトリは Codex プラグイン マーケットプレイスです。それを追加し、プラグインをインストールして、コネクタを認証します。

```bash
codex plugin marketplace add BuilderIO/agent-native
codex plugin add agent-native-visual-plans@agent-native-apps
codex mcp login plan   # ブラウザのOAuth
```

インストール後、**新しい Codex スレッドを開始**して、skills ツールと MCP ツールがセッションに読み込まれるようにします。このプラグインには、URL 専用コネクタ (`[mcp_servers.plan]` → `https://plan.agent-native.com/_agent-native/mcp`) が同梱されています。 `codex mcp login plan` は OAuth フローを実行します。インストールと認証を一緒に行う 1 つのコマンドを使用する場合、またはローカル ファイルまたはセルフホスト モードが必要な場合は、上記のユニバーサル CLI ルートは Codex (`npx @agent-native/core@latest skills add visual-plan --client codex`) にも機能します。

> **古いインストール:** 構成に同じ URL を指す `agent-native-plans` エントリがまだある場合、Codex に対して `npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex` を実行するか、ターゲット `--client` で同じコマンドを実行すると、それが正規の `plan` 名に統合されます。

## アップデート {#updates}

プラグインは自動更新をルーティングします。日常的なスキル変更のためにマーケットプレイスを再パックしたり、再追加したりする必要はありません。

- **Claude コード** — マーケットプレイス エントリは `autoUpdate: true` を設定し、プラグインは commit-SHA バージョン管理を使用するため、Claude コードは起動時にリポジトリから新しいバージョンを取得します。 `/reload-plugins` を実行してアクティブ化します。リポジトリのデフォルト ブランチへのプッシュはすべて、インストールされているユーザーに自動的に届きます。
- **Codex** — プラグイン `version` は、バンドルされた skills および MCP エンドポイント (例: `1.0.0+codex.<hash>`) のコンテンツ ハッシュを埋め込むため、スキルまたはエンドポイントを変更すると新しいバージョンが生成されます。 Codex のスタートアップ自動アップグレードは、設定された git マーケットプレイスを独自に再インストールします。 **新しいスレッドを開始**して、変更を反映してください。定期的な更新に手動の `codex plugin marketplace upgrade` は必要ありません。
- **ユニバーサル CLI ルート** — `npx @agent-native/core@latest skills status visual-plan` を実行してコピーされたスキル フォルダーを確認するか、`npx @agent-native/core@latest skills update visual-plan` を実行してそれらを所定の場所に更新します。コネクタを再登録/認証する場合も、`skills add visual-plan` を再実行すると機能します。 `@latest` は常に、公開された `@agent-native/core` パッケージから現在の skills をプルします。

コネクタは **ホスト** アプリを指しているため、プラン アプリの actions とライブ ツールの表面は、いつインストールしたかに関係なく、常にデプロイされたバージョンを反映します。上記の更新メカニズムに従うのは、バンドルされたスキルの手順のみです。

> **メンテナー:** マーケットプレイス バンドル (`.claude-plugin/`、`.agents/plugins/`) は、`pnpm sync:plan-marketplace` によって正規プラン skills から生成され、`pnpm guard:plan-marketplace` によって CI で検証されるため、公開されたマーケットプレイスは常に正規 skills と一致します。スキルを編集し、`pnpm sync:plan-marketplace` を実行して、コミットします。

## 何か提出する必要がありますか? {#submission}

**これを配布またはインストールするには提出やレビューは必要ありません。** `BuilderIO/agent-native` は自己ホスト型のパブリック git マーケットプレイスであるため、ユーザーは **Claude コードと Codex の両方**に上記のコマンドを使用して直接追加します。申請や承認は必要ありません。ユニバーサル CLI ルートにはマーケットプレイスはまったく必要ありません。

公開リストが必要な場合は、オプションの検出可能性:

- **Claude コード** には、出品のために*オプションで* 送信できるコミュニティ マーケットプレイスがあります (送信と自動レビュー)。 Anthropic が厳選した公式のマーケットプレイスは、Anthropic の裁量によってリストされています。オープンなセルフサービス アプリケーションはありません。上記のインストール コマンドを使用する必要はありません。
- **Codex** には、OpenAI が厳選したプラグイン カタログ (セルフサービスの提出ではなくパートナーシップとして提供される非公開の許可リスト) があります。自己ホスト型 Git マーケットプレイスと CLI ルートは機能するために送信を必要としません。

簡単に言うと、自己ホスト型/パブリック git マーケットプレイスとして出荷され、ユーザーは直接インストールします。検索対象としてリストに掲載したい場合にのみ、厳選されたカタログに送信してください。

## プラグインとスキル {#plugin-vs-skill}

**スキル** は、タスクが一致したときにエージェントが読み取る単一の `SKILL.md` 命令ファイルです。 **プラグイン** (Claude コード マーケットプレイス プラグインまたは Codex プラグイン) は、1 つ以上の skills **プラス** MCP コネクタとメタデータをバンドルするパッケージであるため、ホストはすべてを 1 ステップでインストールできます。

内部では、3 つのルートはすべて、`npx @agent-native/core@latest app-skill` CLI によって同じソースから生成されます。`app-skill pack` はマーケットプレイス/プラグイン アダプターを構築し、`skills add` は MCP コネクタの登録と認証も行う使いやすいワンステップ インストーラーです。アプリスキルのマニフェスト形式については [Skills Guide](/docs/skills-guide) を、MCP ホストと `npx @agent-native/core@latest connect` フローの接続については [External Agents](/docs/external-agents) を参照してください。

## 次は何ですか {#whats-next}

- [**Visual Plans**](/docs/template-plan) — skills の機能とその使用方法
- [**PR Visual Recap**](/docs/pr-visual-recap) — すべてのプル リクエストで `/visual-recap` を自動的に実行します
- [**Skills Guide**](/docs/skills-guide) — アプリベースの skills とマニフェスト形式
- [**External Agents**](/docs/external-agents) — 任意の MCP ホストとラウンドトリップ アーティファクトを接続します
