---
title: "MCP クライアント"
description: "エージェント ネイティブ アプリをローカル MCP サーバー (クロードインクローム、ファイルシステム、プレイライトなど) に接続して、エージェントがツールを入手できるようにします。"
---

# MCP クライアント

**このページ: エージェントにさらに多くのツールを提供します。** ローカルまたはリモートの MCP サーバーにエージェント ネイティブ アプリを指定すると、そのツールがエージェント チャットに表示されます。これは _client_ 方向であり、[MCP Protocol](/docs/mcp-protocol) の鏡像です (アプリを MCP _server_ にします)。

| もしご希望であれば…                                                          | 読む                                     |
| ---------------------------------------------------------------------------- | ---------------------------------------- |
| 外部エージェント/ホストをアプリに接続する                                    | [External Agents](/docs/external-agents) |
| エージェントにさらに多くのツールを提供します (他の MCP サーバーを使用します) | **このページ** — MCP クライアント        |
| Claude/ChatGPT でレンダリングするインライン UI を構築する                    | [MCP Apps](/docs/mcp-apps)               |
| 下位レベルの MCP サーバー参照 (認証、ツール、カスタム マウント)              | [MCP Protocol](/docs/mcp-protocol)       |

1 つの構成ファイルを使用すると、ワークスペース内のすべてのエージェント ネイティブ アプリが、マシン上の MCP サーバーによって提供されるツール (ブラウザ自動化用の `claude-in-chrome`、ファイル読み取り用の `@modelcontextprotocol/server-filesystem`、ブラウザ テスト用の `@playwright/mcp`、および MCP を話すその他のもの) にアクセスできるようになります。

構成ファイルを編集せずに、個々のユーザーまたは組織全体で [connect remote (HTTP) MCP servers at runtime](#remote-via-ui) を実行することもできます。

すべてのソースは 1 つのランタイム **MCP マネージャー**に解決され、学習したすべてのツールは、衝突防止の `mcp__<server-id>__<tool>` プレフィックスの下でエージェントのツール レジストリに配置されます。`tool-search` を通じて意図によって検索できます。

```an-diagram title="クライアントの方向性: 多数のソース、1 つのツール レジストリ" summary="構成ファイル、環境、およびランタイム UI はすべて MCP マネージャーにマージされます。そのツールは接頭辞付きで表示され、アプリのアクションと一緒にツール検索可能です。これはサーバーの方向性を反映したものです。"
{
  "html": "<div class=\"mcp-merge\"><div class=\"diagram-col sources\"><div class=\"diagram-box\" data-rough>Workspace <code>mcp.config.json</code><br><small class=\"diagram-muted\">アプリ間で共有</small></div><div class=\"diagram-box\" data-rough>アプリルート <code>mcp.config.json</code><br><small class=\"diagram-muted\">アプリごとの上書き</small></div><div class=\"diagram-box\" data-rough><code>MCP_SERVERS</code> env<br><small class=\"diagram-muted\">CI / 本番</small></div><div class=\"diagram-box\" data-rough>設定 UI からリモート設定<br><small class=\"diagram-muted\">personal &amp; org scope</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">MCP マネージャー</span><small class=\"diagram-muted\">merge &middot; hot-reload</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col out\"><div class=\"diagram-node\">エージェントツール registry<br><small class=\"diagram-muted\"><code>mcp__&lt;server-id&gt;__&lt;tool&gt;</code></small></div><div class=\"diagram-node\"><code>tool-search</code><br><small class=\"diagram-muted\">意図で発見</small></div></div></div>",
  "css": ".mcp-merge{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.mcp-merge .diagram-col{display:flex;flex-direction:column;gap:8px}.mcp-merge .center{display:flex;flex-direction:column;align-items:center;gap:4px}.mcp-merge .diagram-arrow{font-size:22px;line-height:1}.mcp-merge code{font-size:.85em}"
}
```

> 逆の方向 (_your_ アプリを他のホストが使用する MCP サーバーにする) は、[MCP Protocol](/docs/mcp-protocol) と [External Agents](/docs/external-agents) に存在します。

## 内蔵ブラウザおよびコンピュータ使用機能 {#built-in-capabilities}

エージェント ネイティブには、一般的な stdio MCP サーバー用のローカル開発切り替えが含まれています。
デフォルトではオフになっており、ユーザーごとまたは組織ごとにのみ有効にできます
アプリがローカルで実行されているとき。運用環境およびホスト型サーバーレス ランタイムはスキップ
古い設定行が存在する場合でもこれらの組み込みとワークスペース リソース
ツリーにはデフォルトの `mcp-servers/*.json` リソースとして表示されません。

| 能力                      | サーバー ID       | コマンド                                                                |
| ------------------------- | ----------------- | ----------------------------------------------------------------------- |
| Chrome デベロッパーツール | `chrome-devtools` | `npx -y chrome-devtools-mcp@latest --autoConnect --no-usage-statistics` |
| 劇作家ブラウザ            | `playwright`      | `npx -y @playwright/mcp@latest`                                         |
| コンピュータの使用        | `computer-use`    | `npx -y computer-use-mcp@latest`                                        |

スコープ内で一度に有効にできるブラウザ機能は 1 つだけです。 Chrome DevTools を有効にすると、同じユーザーまたは組織の Playwright が無効になり、Playwright を有効にすると Chrome DevTools が無効になります。

コンピュータの使用は macOS のみです。他のプラットフォームでは、この設定は使用不可としてリストされ、古い設定行にその設定が含まれている場合でもスキップされます。

Chrome DevTools はデフォルトで `--autoConnect` を使用します。これは、適格な実行中の Chrome インスタンスに接続されます。分離されたブラウザー プロファイルを作成したり、ユーザーの通常のプロファイルにサインインしたりすることはありません。リモート デバッグが有効になっている Chrome 144 以降が必要です。手動の `browser-url` 構成は、展開で特定のデバッグ エンドポイントが必要になったときに、後で追加できます。

ビルトインは、個人切り替えの場合は `u:<email>:mcp-builtin-capabilities`、チーム切り替えの場合は `o:<orgId>:mcp-builtin-capabilities` の下にあるフレームワークの `settings` テーブルに保存されます。有効にすると、`mcp__user_<emailhash>_playwright__*` や `mcp__org_<orgId>_chrome-devtools__*` など、リモート サーバーと同じ範囲指定された可視性形式でランタイム MCP マネージャーにマージされます。

### ユーザー向けのセットアップに関する注意事項

機密性の高い組み込みには、簡潔で明示的なセットアップ コピーを使用します。

- **Chrome DevTools** は、実行中の Chrome デバッグ ターゲットに接続します。ユーザーに伝える
  これはブラウザのテストとログイン検証を目的としており、
  ツールが表示される前に Chrome リモート デバッグを有効にする必要がある場合があります。
- **Playwright** は分離されたブラウザを起動します。決定論的に推奨
  ユーザーのライブ Chrome プロファイルが必要ない場合の QA。
- **コンピュータ使用** はローカル アプリを操作できます。デフォルトではオフにしておきます。
  macOS 画面録画とアクセシビリティ プロンプト、および撮影前に質問する
  購入、財務上の変更、アカウントの変更などの機密性の高い actions。

### 組み込みエンドポイント

| メソッド | ルート                       | 目的                                                                                   |
| -------- | ---------------------------- | -------------------------------------------------------------------------------------- |
| GET      | `/_agent-native/mcp/builtin` | 組み込み機能、有効なスコープ、マージされた ID、およびライブ ステータスをリストします。 |
| POST     | `/_agent-native/mcp/builtin` | スコープを更新します。本文: `{ scope, enabledIds }` または `{ scope, id, enabled }`。  |

## ローカル MCP サーバーの追加 {#adding-a-server}

ワークスペース ルート (または個々のアプリ ルート - 両方が存在する場合はワークスペース ルートが優先) で `mcp.config.json` を作成します。

```jsonc
{
  "$schema": "https://agent-native.com/schema/mcp.config.json",
  "servers": {
    "claude-in-chrome": {
      "command": "claude-in-chrome-mcp",
      "args": [],
      "env": { "LOG_LEVEL": "info" },
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"],
    },
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem@latest",
        "/Users/me/projects",
      ],
    },
  },
}
```

形状は小さく、サーバー ID をキーとする `servers` マップで、各エントリは標準入出力ランチャー (`command` + `args` + オプションの `env`) またはリモート `{ "type": "http", "url", "headers" }` エントリのいずれかです。

```an-annotated-code title="mcp.config.json、注釈付き"
{
  "filename": "mcp.config.json",
  "language": "jsonc",
  "code": "{\n  \"$schema\": \"https://agent-native.com/schema/mcp.config.json\",\n  \"servers\": {\n    \"claude-in-chrome\": {\n      \"command\": \"claude-in-chrome-mcp\",\n      \"args\": [],\n      \"env\": { \"LOG_LEVEL\": \"info\" }\n    },\n    \"filesystem\": {\n      \"command\": \"npx\",\n      \"args\": [\"-y\", \"@modelcontextprotocol/server-filesystem@latest\", \"/Users/me/projects\"]\n    }\n  }\n}",
  "annotations": [
    { "lines": "3", "label": "サーバーID", "note": "キーはツールのプレフィックスになります。このサーバーのツールはエージェントのレジストリ内で `mcp__claude-in-chrome__*` として表示されるため、テンプレートのアクションと衝突することはありません。" },
    { "lines": "4-6", "label": "stdio launcher", "note": "`command` + `args` はローカル バイナリを生成します。 Stdio サーバーは**ローカル開発**を目的としており、エッジ ランタイムでは何も操作されません。" },
    { "lines": "6", "label": "プロセス環境", "note": "Optional `env` is passed to the spawned process. Keep secrets out of committed config; prefer `MCP_SERVERS` or the settings UI for tokens." }
  ]
}
```

次回アプリを起動すると、次のように表示されます。

```
[mcp-client] loaded config from /path/to/mcp.config.json (3 server(s))
[mcp-client] connected to claude-in-chrome: 12 tools
[mcp-client] connected to playwright: 9 tools
[mcp-client] connected to filesystem: 4 tools
```

ツールは、プレフィックス `mcp__<server-id>__<tool-name>` を付けてエージェントのツール レジストリに登録されているため、テンプレートの actions と衝突することはありません。これらは `tool-search` にも含まれているため、エージェントは事前に正確な接頭辞付きの名前を必要とするのではなく、意図によって新しく接続された MCP 機能を検出できます。

## 構成の優先順位 {#precedence}

MCP 設定は次の順序で解決され、最初に一致したものが優先されます:

1. **ワークスペース ルート `mcp.config.json`** — `package.json` の `agent-native.workspaceCore` 経由で検出されました。ワークスペース内のすべてのアプリ間で共有されます。
2. **アプリルート `mcp.config.json`** — すべてのアプリで MCP サーバーを使用したくない場合は、アプリごとのオーバーライド。
3. **`MCP_SERVERS` env var** — ファイルが意味をなさない CI/運用環境用の、同じ形状の JSON 文字列。

## 本番デプロイ: `MCP_SERVERS` {#mcp-servers-env}

実稼働デプロイの場合は、リモート HTTP MCP サーバーを優先し、完全な構成を設定します
環境変数としての形状 (または内部サーバー マップ):

```bash
MCP_SERVERS='{"servers":{"zapier":{"type":"http","url":"https://mcp.example.com/mcp","headers":{"Authorization":"Bearer paste-token-value-here"}}}}'
```

`MCP_SERVERS` は JSON として解析されるため、`${...}` プレースホルダーは展開されません
文字列内。トークンを別のシークレットに保存する場合は、
最終的な JSON 値を書き込みます。

Stdio MCP サーバーはローカル バイナリを生成し、ローカル開発を目的としています。
MCP ツールはノード ランタイムでのみ有効になります — Cloudflare ワーカーおよびその他のエッジ
ターゲットは MCP をサイレントにスキップし、残りのアプリの動作を続行します
通常通りです。

## 自動検出: `claude-in-chrome` {#autodetect}

**no** `mcp.config.json` があり、`claude-in-chrome-mcp` バイナリが `PATH` (または既知のインストール場所 `~/.claude-in-chrome/bin/claude-in-chrome-mcp`) にある場合、エージェントネイティブはそれをデフォルトの MCP サーバーとして自動登録します。 `AGENT_NATIVE_DISABLE_MCP_AUTODETECT=1` をオプトアウトに設定します。

これは、claude-in-chrome 拡張機能をインストールしたユーザーは、設定を変更することなく、開いたすべてのエージェント ネイティブ アプリにわたってブラウザー制御を取得できることを意味します。

## 設定 UI によるリモート MCP サーバー {#remote-via-ui}

MCP (モデル コンテキスト プロトコル) サーバーは、Zapier、Cloudflare、Composio、または会社の内部ツールへの接続など、エージェントに新しい機能を提供します。接続すると、エージェントはこれらのツールを組み込みツールと同じように使用できるようになります。

### リモート MCP サーバーに接続する方法

1. **サーバー名** — 独自の参照用の短いラベル (例: "zapier"、"slack-tools")。
2. **URL** — MCP サーバープロバイダーから提供された HTTPS エンドポイント (例: `https://mcp.zapier.com/s/abc123/mcp`)。これは通常、プロバイダーのダッシュボードまたは統合ドキュメントに記載されています。
3. **説明** (オプション) — このサーバーの動作に関するメモ。
4. **Headers** — サーバーが必要とする認証資格情報 (1 行に 1 つ)。ほとんどのサーバーには `Authorization` ヘッダーが必要です。例: `Authorization: Bearer sk-your-key-here`。ここに何を入力するかについては、プロバイダのドキュメントを参照してください。

保存する前に [**テスト**] をクリックして接続を確認します。成功すると、使用可能なツールの数が表示されます。 [**接続**] をクリックして追加します。

### 個人と組織の範囲

2 つのスコープがサポートされています:

- **個人** — サインインしているユーザーのみがツールを取得します。ユーザースコープ設定として保存されます。
- **チーム** — アクティブな組織の全員がツールを利用できます。所有者と管理者は追加できます。メンバーにはリストが読み取り専用で表示されます。組織スコープ設定として保存されます。

実行中の MCP マネージャーにホットリロードを追加および削除します。プロセスの再起動やサーバーの再起動はありません。新しい `mcp__<scope>-<name>__*` ツールは次のメッセージでエージェントに表示され、`tool-search` 経由で検索できます。

HTTPS URL はどこでも受け入れられます。プレーン `http://` は、開発中に `localhost` に対してのみ許可されます。オプションの認証は、リクエストごとに `Authorization: Bearer …` 経由で送信されるベアラー トークンとして入力されます。

内部では、これらのサーバーはキー `u:<email>:mcp-servers-remote` (個人) または `o:<orgId>:mcp-servers-remote` (チーム) の下でフレームワークの `settings` テーブルに保存され、起動時に `mcp.config.json` とマージされます。

### HTTP エンドポイント

| メソッド | ルート                                                | 目的                                                                                  |
| -------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| GET      | `/_agent-native/mcp/servers`                          | 現在のユーザーの個人サーバーと組織サーバーをライブ ステータスとともに一覧表示します。 |
| POST     | `/_agent-native/mcp/servers`                          | サーバーを追加します。本文: `{ scope, name, url, headers?, description? }`。          |
| DELETE   | `/_agent-native/mcp/servers/:id?scope=user\|org`      | Remove a server and reconfigure the manager.                                          |
| POST     | `/_agent-native/mcp/servers/:id/test?scope=user\|org` | Dry-run the existing server's connect + list-tools.                                   |
| POST     | `/_agent-native/mcp/servers/test`                     | 永続化する前に、任意の URL をドライランします。本文: `{ url, headers? }`。            |

Stdio サーバーは Node ランタイム外では引き続き no-op ですが、リモート HTTP MCP サーバーは、デスクトップ実稼働ビルドを含む、`fetch` を備えたあらゆる環境で動作します。

## ハブ経由で MCP サーバーを共有 {#hub}

ワークスペースで複数のエージェント ネイティブ アプリ (ディスパッチ + メール + クリップなど) を実行している場合、**1 つ** のアプリをハブとして構成し、他のアプリがその組織スコープの MCP サーバーを自動的にプルするようにできます。 URL とベアラー トークンをアプリごとにコピーアンドペーストする必要はありません。ディスパッチ ワークスペース MCP リソースを使用した正規のアプローチについては、[Multi-App Workspace](/docs/multi-app-workspace) を参照してください。

Dispatch は従来のハブであり、すでにアプリ間で調整されています。

```an-diagram title="ハブ モデル: 1 つのアプリが組織スコープの MCP サーバーにサービスを提供します" summary="Dispatch は組織スコープの MCP サーバーを保持します。コンシューマ アプリは、それらを mcp__hub_<orgId>_<name>__* としてプルしてマージします。組織スコープの行のみが共有され、個人の認証情報は保持されます。"
{
  "html": "<div class=\"mcp-hub\"><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">Dispatch hub</span><small class=\"diagram-muted\">組織スコープのMCPサーバー</small><small class=\"diagram-muted\"><code>GET /mcp/hub/servers</code></small></div><div class=\"diagram-col arrows\"><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div></div><div class=\"diagram-col consumers\"><div class=\"diagram-box\" data-rough>Mail<br><small class=\"diagram-muted\"><code>mcp__hub_&lt;orgId&gt;_&lt;name&gt;__*</code></small></div><div class=\"diagram-box\" data-rough>Clips<br><small class=\"diagram-muted\">約60秒ごとにpull + merge</small></div></div></div><p class=\"diagram-muted note\">Bearer-gated by <code>AGENT_NATIVE_MCP_HUB_TOKEN</code>. Personal (user-scope) servers are never re-exposed.</p>",
  "css": ".mcp-hub{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.mcp-hub .center{display:flex;flex-direction:column;align-items:center;gap:4px}.mcp-hub .diagram-col{display:flex;flex-direction:column;gap:10px}.mcp-hub .arrows .diagram-arrow{font-size:22px;line-height:1}.mcp-hub .note{margin:8px 0 0;font-size:.85em}.mcp-hub code{font-size:.85em}"
}
```

新しいワークスペースのセットアップの場合は、**ワークスペース MCP リソースをディスパッチする**ことを選択してください。
ワークスペース skills で使用される同じすべてのアプリと選択されたアプリの付与モデルが必要です。
説明書、および参照リソース。次のコマンドを使用してワークスペース リソースを追加します。

```json
{
  "type": "http",
  "url": "https://example.com/mcp",
  "headers": {
    "Authorization": "Bearer ${keys.MCP_SERVER_TOKEN}"
  },
  "description": "Shared MCP ツールs for workspace apps"
}
```

種類 `mcp-server` で `mcp-servers/<name>.json` の下に保存します。すべてのアプリ
リソースはすべてのワークスペース アプリによって読み込まれます。選択したリソースは
アクティブなディスパッチ許可を持つアプリ。シークレット プレースホルダーはアプリから解決されます
秘密ストアなので、生のベアラー トークンを Dispatch Vault に入れて参照します
リソース本体に保存する代わりに、`${keys.NAME}` を使用します。

アプリはマージされた MCP 構成を 1 分に 1 回程度更新するため、中央リソースが必要になります
編集、変更の付与、および削除は、デプロイしなくても有効になります。セット
`AGENT_NATIVE_MCP_CONFIG_REFRESH_MS=0` を使用してバックグラウンド更新を無効にするか、
間隔を調整するには、少なくとも `5000` ミリ秒の値に設定します。

以下の古いハブ モードは、大まかな「すべての組織スコープ MCP の共有」に引き続き役立ちます
「Dispatch からのサーバー」セットアップおよびすでに MCP を使用している展開の場合
真実の情報源として UI を設定します。

### 1.ハブ アプリでハブ サーブを有効にする (ディスパッチ)

ディスパッチのデプロイメントで環境変数を設定します:

```bash
AGENT_NATIVE_MCP_HUB_TOKEN=<a-long-random-secret>
```

Dispatch は `GET /_agent-native/mcp/hub/servers` をマウントするようになり、`settings` テーブルに格納されているすべての組織スコープの MCP サーバーを、トークンによって認証された完全な URL + ヘッダーとともに返します。

### 2.ハブでのポイント消費アプリ

すべてのコンシューマ (メール、クリップなど) に設定:

```bash
AGENT_NATIVE_MCP_HUB_URL=https://dispatch.acme.com
AGENT_NATIVE_MCP_HUB_TOKEN=<the-same-secret>
```

起動時に、各コンシューマーはハブのサーバー リストを取得し、それを独自の MCP マネージャーにマージします。ツールはエージェントには `mcp__hub_<orgId>_<name>__*` として表示されます。これはコンシューマ自身のローカル `mcp__org_…` とは異なるため、衝突は発生しません。

### 3.共有されるもの

**org-scope** サーバーのみが共有されます。ユーザー スコープ (個人) サーバーは、サーバーを追加したユーザーとともにあり、ハブがアプリ間で個人認証情報を再公開することはありません。

ハブの応答には、完全な認証ヘッダー (ベアラー トークンなど) が含まれます。トランスポートは HTTPS で、エンドポイントは共有シークレットを必要とし、組織スコープの行のみを返します。ハブ URL + トークンをデータベース認証情報のように扱います。

### 4.ホットリロードと再起動

ローカル UI は、`McpClientManager.reconfigure()` 経由で各アプリにホットリロードを追加します。再起動は必要ありません。ハブソースのサーバーは、ワークスペース リソース パスが使用するのと同じ定期的なバックグラウンド更新 (約 60 秒、`AGENT_NATIVE_MCP_CONFIG_REFRESH_MS` によって調整可能または無効化可能) によって選択されるため、Dispatch で行われた変更は、再起動せずに約 1 分以内にすべてのコンシューマー アプリに反映されます。さらに、コンシューマ アプリのローカルな変更が発生すると、そのアプリの再構成が即座にトリガーされます。

### エンドポイントの概要

| メソッド | ルート                           | 目的                                                                                                                                                   |
| -------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET      | `/_agent-native/mcp/hub/servers` | すべての組織スコープのサーバーを完全な認証情報で提供します (ベアラーゲート、`AGENT_NATIVE_MCP_HUB_TOKEN` が設定されている場合にのみマウントされます)。 |
| GET      | `/_agent-native/mcp/hub/status`  | 設定 UI カードの `{ serving, consuming, hubUrl }` を返します。                                                                                         |

## ステータスルート {#status-route}

すべてのアプリはツールとオンボーディングのために `GET /_agent-native/mcp/status` を公開します:

```an-api
{
  "method": "GET",
  "path": "/_agent-native/mcp/status",
  "summary": "ツールとオンボーディングに関する MCP クライアントのステータス",
  "description": "Reports which configured servers connected, the total live tool count, the merged prefixed tool list, and any per-server connection errors. Use it to build \"detected — your agent can now drive X\" hints or to debug connection problems.",
  "responses": [
    {
      "status": "200",
      "description": "Configured vs connected servers, tool inventory, and per-server errors.",
      "example": "{\n  \"configuredServers\": [\"claude-in-chrome\", \"playwright\"],\n  \"connectedServers\": [\"claude-in-chrome\", \"playwright\"],\n  \"totalTools\": 21,\n  \"tools\": [\n    {\n      \"source\": \"claude-in-chrome\",\n      \"name\": \"mcp__claude-in-chrome__navigate\",\n      \"description\": \"Navigate the browser to a URL\"\n    }\n  ],\n  \"errors\": {}\n}"
    }
  ]
}
```

```json
{
  "configuredServers": ["claude-in-chrome", "playwright"],
  "connectedServers": ["claude-in-chrome", "playwright"],
  "totalTools": 21,
  "tools": [
    {
      "source": "claude-in-chrome",
      "name": "mcp__claude-in-chrome__navigate",
      "description": "Navigate the browser to a URL"
    }
  ],
  "errors": {}
}
```

これを使用して、「claude-in-chrome が検出されました - エージェントは Chrome を操作できるようになりました」オンボーディング ヒントを作成したり、MCP 接続の問題をデバッグしたりできます。

## 障害モード {#failures}

個々の MCP サーバーの障害によってエージェントがダウンすることはありません:

- `command` の設定が間違っている → サーバーはスキップされ、そのエラーは `errors.<server-id>` の下の `/mcp/status` に表示され、他のすべてのサーバーは引き続き動作します。
- MCP SDK が `node_modules` にありません → すべての MCP 機能が警告とともにスキップされます。エージェント チャットは、MCP ツールを使用しなくても機能し続けます。
- エッジ ランタイムで実行 → MCP クライアントは何もしません。

エージェントネイティブは常に起動します。 MCP 構成が壊れているということは、ツールが少ないことを意味します。

## セキュリティ {#security}

MCP ツールは、生成されたプロセスが持つ権限を使用してマシン上で実行されます。 `mcp.config.json` は、エージェントに実行させたい他の実行可能ファイルのリストと同様に扱います。 MCP サーバーのツールは、テンプレート独自の actions と同様に、エージェントのツール使用ループに表示されるため、構成するすべてのサーバーを信頼していることを確認してください。
