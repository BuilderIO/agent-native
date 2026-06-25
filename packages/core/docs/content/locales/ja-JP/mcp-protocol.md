---
title: "MCP プロトコル"
description: "エージェント ネイティブ アプリをリモート MCP サーバーとして公開すると、Claude、ChatGPT、Claude コード、カーソル、その他の AI ツールがアプリの actions を直接呼び出すことができます。"
---

# MCP プロトコル

**このページ: 下位レベルの MCP サーバー リファレンス。** すべてのエージェント ネイティブ アプリが MCP 上で actions を公開する方法 (自動マウントされたエンドポイント、認証モード、`tools/call` / `ask-agent` サーフェス、カスタム マウント)。サーバーの内部情報が必要な場合は、それに手を伸ばしてください。ホストに接続するには、[External Agents](/docs/external-agents) から始めてください。

| もしご希望であれば…                                                          | 読む                                     |
| ---------------------------------------------------------------------------- | ---------------------------------------- |
| 外部エージェント/ホストをアプリに接続する                                    | [External Agents](/docs/external-agents) |
| エージェントにさらに多くのツールを提供します (他の MCP サーバーを使用します) | [MCP Clients](/docs/mcp-clients)         |
| Claude/ChatGPT でレンダリングするインライン UI を構築する                    | [MCP Apps](/docs/mcp-apps)               |
| 下位レベルの MCP サーバー参照 (認証、ツール、カスタム マウント)              | **このページ** — MCP プロトコル          |

すべてのエージェント ネイティブ アプリはリモート MCP (モデル コンテキスト プロトコル) サーバーを自動的に公開するため、Claude、ChatGPT カスタム MCP アプリ、Claude コード、カーソル、Codex、VS コード GitHub Copilot などの外部 AI ツールは、アプリの actions を検出して直接呼び出すことができます。追加のコードが必要です。目的が、これらのホストの 1 つをホストされたアプリに「接続」することである場合、[External Agents](/docs/external-agents) は、推奨される単一のディスパッチ コネクタ、アプリごとの URL、OAuth、MCP アプリ インライン UI、およびディープ リンクをカバーします。このページには、その下にあるものについて説明します。

## 概要 {#overview}

MCP は、AI ツールを外部機能に接続するための標準プロトコルです。エージェント ネイティブ アプリをデプロイすると、既存の A2A エンドポイントと並んで MCP エンドポイントが自動的にマウントされます。 MCP 互換クライアントは、アプリのツールに接続して使用できます。

重要な概念:

- **自動マウント** — すべてのアプリは無料で `/_agent-native/mcp` を入手でき、セットアップは必要ありません
- **ストリーミング可能な HTTP** — 標準の HTTP (POST + SSE) ではなく最新の MCP トランスポートを使用します
- **同じ actions** — エージェント チャットと A2A を強化するまったく同じアクション レジストリ
- **`ask-agent` ツール** — 複雑なタスクをエージェント ループ全体に委任するメタツール
- **MCP アプリ** — actions は、公式 `io.modelcontextprotocol/ui` 拡張機能を通じてインタラクティブな UI リソースをアドバタイズできます
- **標準リモート MCP OAuth** — OAuth 2.1 検出、動的クライアント登録、認可コード + PKCE、リフレッシュ トークン ローテーション
- **ベアラー認証フォールバック** — OAuth を実行できないクライアントには、`ACCESS_TOKEN`、`ACCESS_TOKENS`、または接続ミント JWT を使用します

```an-diagram title="MCP サーバーとしてのアプリ" summary="外部ホストは Streamable HTTP 経由で接続します。それぞれのアクションは 1 つのツールです。 ask-agent は完全なエージェント ループに委任します。"
{
  "html": "<div class=\"diagram-mcp\"><div class=\"diagram-col\"><div class=\"diagram-node\">Claude</div><div class=\"diagram-node\">ChatGPT</div><div class=\"diagram-node\">Cursor · Codex</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\"><span class=\"diagram-pill accent\">POST /_agent-native/mcp</span><small class=\"diagram-muted\">Streamable HTTP</small><small class=\"diagram-muted\">initialize &rarr; tools/list &rarr; tools/call</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\" data-rough>each action<br><small class=\"diagram-muted\">= one tool</small></div><div class=\"diagram-box\" data-rough>ask-agent<br><small class=\"diagram-muted\">&rarr; full agent loop</small></div></div></div>",
  "css": ".diagram-mcp{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.diagram-mcp .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-mcp .diagram-panel{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-mcp .diagram-arrow{font-size:20px;line-height:1}"
}
```

## MCP 対 A2A {#mcp-vs-a2a}

両方のプロトコルは自動マウントされます。ユースケースに合ったものを使用してください:

|                    | MCP                                                                                | A2A                                                  |
| ------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **最適な用途**     | アプリを呼び出す外部ツール                                                         | エージェント間のコミュニケーション                   |
| **プロトコル**     | MCP ストリーミング可能な HTTP                                                      | JSON-RPC 2.0                                         |
| **ツールの発見**   | `tools/list`                                                                       | `/.well-known/agent-card.json` のエージェント カード |
| **エンドポイント** | `/_agent-native/mcp`                                                               | `/_agent-native/a2a`                                 |
| **サポート対象**   | Claude、ChatGPT、Claude コード、カーソル、Codex、Cowork、およびその他の MCP ホスト | その他のエージェントネイティブ アプリ                |
| **実行**           | 直接ツール呼び出し (追加の LLM なし)                                               | 完全なエージェント ループ (LLM 推論)                 |

`ask-agent` MCP ツールを使用して、両方の長所を活用することもできます。Claude コードから呼び出して、アプリのエージェントに複雑なタスクを推論させます。

## 手動 MCP クライアント構成 {#manual-config}

推奨される 1 つのコマンド セットアップでは、[External Agents](/docs/external-agents) を使用します。 OAuth 対応クライアントの MCP 構成を手書きしている場合は、静的ヘッダーのないリモート MCP サーバーとしてアプリを追加します。

```bash
claude mcp add --transport http mail https://mail.example.com/_agent-native/mcp
```

または、`.mcp.json` (プロジェクト スコープ) または `~/.claude.json` (ユーザー スコープ) にエントリを手動で書き込みます。

```jsonc
// .mcp.json
{
  "mcpServers": {
    "mail": {
      "type": "http",
      "url": "https://mail.example.com/_agent-native/mcp",
    },
  },
}
```

次に、Claude コードで `/mcp` を実行し、**認証** を選択します。リモート MCP OAuth を実行できないクライアントの場合は、[接続] ページまたは `headers.Authorization` の静的ベアラー トークン エントリを使用します。認証されると、アプリのツールを自然に使用できるようになります。

```
> draft an email to John about the Q3 report

Claude Code calls: draft-email(to: "john@example.com", subject: "Q3 Report", body: "...")
```

## 他の MCP クライアントからの接続 {#other-clients}

ストリーミング可能な HTTP トランスポートをサポートするすべての MCP クライアントが接続できます。エンドポイントは次のとおりです:

```
POST https://your-app.example.com/_agent-native/mcp
```

サーバーは、標準の MCP ハンドシェイク: `initialize` → `initialized` → `tools/list` → `tools/call` をサポートします。

```an-api title="MCP エンドポイント" summary="すべてのエージェント ネイティブ アプリが公開する、自動マウントされる Streamable HTTP エンドポイント。"
{
  "method": "POST",
  "path": "/_agent-native/mcp",
  "summary": "MCP ストリーミング可能な HTTP エンドポイント",
  "description": "Auto-mounted on every app. Speaks the standard MCP handshake (`initialize` → `initialized` → `tools/list` → `tools/call`) plus `resources/list`, `resources/templates/list`, and `resources/read` when an action declares `mcpApp`. Each action maps to one tool; `ask-agent` delegates to the full agent loop.",
  "auth": "Standard remote MCP OAuth (Bearer access token), connect-minted JWT, or static ACCESS_TOKEN/ACCESS_TOKENS",
  "params": [
    { "name": "Authorization", "in": "header", "type": "string", "required": false, "description": "Bearer access token. Required except for loopback local-dev probes." },
    { "name": "method", "in": "body", "type": "string", "required": true, "description": "MCP method, e.g. initialize, tools/list, tools/call." }
  ],
  "request": {
    "contentType": "application/json",
    "example": "{\n  \"jsonrpc\": \"2.0\",\n  \"id\": 1,\n  \"method\": \"tools/call\",\n  \"params\": {\n    \"name\": \"ask-agent\",\n    \"arguments\": { \"message\": \"Summarize Q3 signups by source\" }\n  }\n}"
  },
  "responses": [
    { "status": "200", "description": "MCP result (POST + SSE)." },
    { "status": "401", "description": "Unauthenticated — responds with a WWW-Authenticate header pointing at OAuth discovery." }
  ]
}
```

アクションが `mcpApp` を宣言する場合、サーバーは公式の MCP アプリ拡張機能 (`io.modelcontextprotocol/ui`) もアドバタイズし、アプリ リソースの `resources/list`、`resources/templates/list`、および `resources/read` をサポートします。 MCP アプリをレンダリングするホストは、UI をインラインで表示できます。そうでないホストでもツールを呼び出してディープリンク フォールバックを使用できます。製品 UI は、`embedApp()` を使用する必要があります。これにより、インライン サーフェスは、別のプレーン HTML 実装ではなく、実際の React アプリ ルート、または分析チャートなどの共有 React コンポーネントをレンダリングする焦点の高いルートになります。サーバーは標準の MCP アプリ メタデータと ChatGPT アプリ SDK 互換性メタデータの両方を発行するため、アプリ対応ホストは同じ `ui://` リソースを見つけることができます。現在の公式拡張機能マトリックスには、Claude、Claude デスクトップ、VS Code GitHub Copilot、Goose、Postman、MCPJam、ChatGPT、および Cursor が含まれています。ホストのサポートはバージョンやプランによって異なるため、ユーザー向けのガイダンスとして [External Agents MCP Apps notes](/docs/external-agents#mcp-apps-compatibility) を使用してください。

### MCP アプリ埋め込みブリッジ {#mcp-app-embed-bridge}

`embedApp()` は、低レベルの URL-first MCP アプリ ヘルパーです。署名されたアプリを起動します
移植 (Claude)、制御フレーム (ChatGPT)、または直接経由のインライン ルート
ナビゲーション、`ui/*` JSON-RPC ブリッジ (および
制御フレーム パスの `agentNative.mcpHost.*` postMessage リレー)、および
フルアプリのルートがレンダリングされないようにリソース シェルの高さを固定します
特大のチャット アーティファクト。

埋め込みブリッジの完全な詳細については、[MCP Apps](/docs/mcp-apps#mcp-app-bridge) を参照してください。移植と制御フレーム、`ui/*` と postMessage テーブル、`create_embed_session` / `embedStartUrl`、CSP とドメイン ルール、拡張機能 `srcDoc` 埋め込み、高さクランプ、およびホスト ブリッジ クライアント API。

## ツール {#tools}

すべての呼び出し元は、**デフォルトでコンパクトなカタログ** (テンプレートで宣言されたアプリ actions とクロスアプリの組み込み) を取得します。完全なアクション サーフェスは明示的なオプトインでのみ提供され、`tool-search` は残りの部分に常にアクセスできます。完全な説明については、[External Agents → Catalog tiers](/docs/external-agents#catalog-tiers) を参照してください。

各アクションは 1 つの MCP ツールに直接マッピングされます:

| アクションプロパティ | MCP ツール プロパティ |
| -------------------- | --------------------- |
| `tool.description`   | `description`         |
| `tool.parameters`    | `inputSchema`         |
| アクション名         | ツール名              |

`mcpApp` が存在する場合、ツール エントリには `_meta.ui.resourceUri`、`_meta["ui/resourceUri"]`、および `_meta["openai/outputTemplate"]` も含まれ、対応する `ui://` リソースは `text/html;profile=mcp-app` として返されます。

### `ask-agent` ツール {#ask-agent}

個々のアクション ツールに加えて、すべての MCP サーバーには `ask-agent` メタツールが含まれています。これにより、アプリの AI エージェントに自然言語メッセージが送信され、応答が返されます。

エージェントの推論とコンテキストから恩恵を受ける複雑なタスクには、`ask-agent` を使用します。

```json
{
  "name": "ask-agent",
  "arguments": {
    "message": "Draft a follow-up email to the Q3 planning thread with John, summarizing the action items we discussed"
  }
}
```

エージェントは対話型チャットと同じループを実行します。エージェントは複数のツールを呼び出し、コンテキストを推論し、思慮深い応答を生成できます。

## 認証 {#authentication}

MCP エンドポイントは、標準のリモート MCP OAuth に加えて、既存のベアラー トークン フォールバックをサポートします。

| モード                         | 仕組み                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 標準 MCP OAuth                 | クライアントは `WWW-Authenticate` から認証を検出し、登録し、PKCE を実行し、`Authorization: Bearer <access-token>` を送信します |
| コネクトミント JWT             | `npx @agent-native/core@latest connect` / 接続ページはユーザーごとに取り消し可能な JWT を作成します                            |
| `ACCESS_TOKEN`                 | 静的ベアラー トークン — クライアントが `Authorization: Bearer <token>` を送信                                                  |
| `ACCESS_TOKENS`                | 有効な静的ベアラー トークンのカンマ区切りリスト                                                                                |
| `A2A_SECRET`                   | JWT ベースの認証 — トークンは暗号的に検証されます                                                                              |
| _(設定なし、ループバックのみ)_ | ローカル開発プローブには認証は必要ありません                                                                                   |

OAuth 対応の MCP ホストの場合は、静的ヘッダーなしでリモート サーバー URL を構成します。

```bash
claude mcp add --transport http agent-native https://dispatch.agent-native.com/_agent-native/mcp
```

最初の未認証の MCP リクエストは以下を受け取ります。

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://dispatch.agent-native.com/.well-known/oauth-protected-resource", scope="mcp:read mcp:write mcp:apps"
```

検出エンドポイント:

| エンドポイント                            | 目的                                    |
| ----------------------------------------- | --------------------------------------- |
| `/.well-known/oauth-protected-resource`   | RFC 9728 保護されたリソースのメタデータ |
| `/.well-known/oauth-authorization-server` | OAuth 認可サーバーのメタデータ          |
| `/_agent-native/mcp/oauth/register`       | 動的パブリッククライアント登録          |
| `/_agent-native/mcp/oauth/authorize`      | ブラウザの承認 + 同意                   |
| `/_agent-native/mcp/oauth/token`          | 認可コードとリフレッシュトークンの付与  |

```an-diagram title="OAuth 検出フロー" summary="401 によって検出、登録、PKCE による承認→トークン交換が開始されます。 Bearer トークンは、対象者に限定され、スコープが設定されています。"
{
  "html": "<div class=\"diagram-oauth\"><div class=\"diagram-box\" data-rough>first request<br><small class=\"diagram-muted\">no token</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill warn\">401 · WWW-Authenticate</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\"><span class=\"diagram-pill\">/.well-known/oauth-protected-resource</span><span class=\"diagram-pill\">/.well-known/oauth-authorization-server</span><small class=\"diagram-muted\">discover</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill\">register</div><div class=\"diagram-pill\">authorize (PKCE)</div><div class=\"diagram-pill\">token</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Bearer access token<br><small class=\"diagram-muted\">audienceバインド · mcp:read / write / apps</small></div></div>",
  "css": ".diagram-oauth{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-oauth .diagram-panel{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-oauth .diagram-col{display:flex;flex-direction:column;gap:6px}.diagram-oauth .diagram-arrow{font-size:20px;line-height:1}"
}
```

アクセス トークンは、対象者が正確な MCP リソース URL である署名付き JWT です。サーバーは、サーバー自体に対して発行されたトークンのみを受け入れ、ツールをリストしたり呼び出したりする前にスコープを適用します。

| 範囲        | 許可                                        |
| ----------- | ------------------------------------------- |
| `mcp:read`  | 読み取り専用 actions                        |
| `mcp:write` | actions と `ask-agent` を変更します         |
| `mcp:apps`  | MCP アプリ リソース (`ui://` HTML リソース) |

リフレッシュ トークンはハッシュとしてのみ保存され、リフレッシュのたびにローテーションされます。 `npx @agent-native/core@latest connect` は、デフォルトで、Claude コード クライアントに対してこの URL 専用の OAuth エントリを書き込みます。接続ページ、`npx @agent-native/core@latest connect --token <token>`、ローカル stdio プロキシ、古いクライアント、緊急/デバッグ フロー用の静的ベアラー設定を保持します。

## カスタム MCP セットアップ {#custom-setup}

MCP サーバーは、エージェント チャット プラグインによって自動マウントされます。ほとんどのアプリでは、構成は必要ありません。カスタム動作が必要な場合は、サーバー プラグインで手動でマウントできます。

```ts
// server/plugins/mcp.ts
import { mountMCP } from "@agent-native/core/mcp";
import { autoDiscoverActions } from "@agent-native/core/server";

export default defineNitroPlugin(async (nitro) => {
  const actions = await autoDiscoverActions(import.meta.url);

  mountMCP(nitro, {
    name: "My App",
    description: "Custom MCP server",
    actions,
    // Optional: provide ask-agent handler
    askAgent: async (message) => {
      // Your custom agent logic
      return "Response";
    },
    // Optional: override the route prefix (default "/_agent-native")
    // routePrefix: "/_agent-native",
  });
});
```

## 例: Claude コードからの分析 {#example}

`analytics.example.com` に分析アプリがデプロイされています。 Claude コードから:

```bash
claude mcp add --transport http analytics https://analytics.example.com/_agent-native/mcp
```

または、`.mcp.json` に手動で追加します。

```jsonc
// .mcp.json
{
  "mcpServers": {
    "analytics": {
      "type": "http",
      "url": "https://analytics.example.com/_agent-native/mcp",
    },
  },
}
```

Claude コードでは次のようになります。

```
> How many signups did we get last week?

Claude Code calls: run-query(sql: "SELECT count(*) FROM signups WHERE created_at > now() - interval '7 days'")
→ "1,247 signups last week"
```

より複雑な分析の場合:

```
> Ask the analytics agent to prepare a full breakdown of Q3 signups by source, with trends

Claude Code calls: ask-agent(message: "Prepare a full breakdown of Q3 signups by source, with trends")
→ The analytics agent runs multiple queries, reasons about the data, and returns a formatted report
```
