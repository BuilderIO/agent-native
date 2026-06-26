---
title: "マルチアプリ ワークスペース"
description: "共有認証、RBAC、手順、skills、コンポーネント、資格情報を使用して、1 つのモノリポジトリで多くのエージェント ネイティブ アプリをホストします。"
---

# マルチアプリ ワークスペース

> **どのワークスペース ドキュメントですか?** このページでは、**デプロイ形態** (1 つのモノリポジトリ、多数のアプリ、共有認証、および統合デプロイ) について説明します。ワークスペースとは何か (カスタマイズ レイヤー: `AGENTS.md`、`LEARNINGS.md`、パーソナル メモリ、skills、カスタム エージェント) については、「[Workspace](/docs/workspace)」を参照してください。ガバナンス (誰が何を審査、承認、所有するか) については、[Workspace Governance](/docs/workspace-management) を参照してください。

社内ツールのバイブコーディングに午後を費やしても、1 時間で終わるわけではありません。チームは最終的に、CRM、サポート受信トレイ、ダッシュボード、運用コンソール、つまりそれぞれが独立して構築された 10 個の小さなアプリを作成します。それらすべての何かを変更する必要があるまでは、これで十分です。

その時点で、すべてのアプリは独自の `AGENTS.md`、独自の認証プラグイン、独自のコピー＆ペーストされたレイアウト コンポーネント、独自のハードコーディングされた Slack トークン、「組織」とは何かについての独自の考え方を持ちます。コンプライアンス ルールの変更は 10 人の PR を意味します。 API キーをローテーションすると、10 回の再デプロイが行われることになります。ブランドの更新は、10 個の異なるヘッダーが同期からずれることを意味します。構築を容易にしていたものが、今では管理を難しくしています。

**マルチアプリ ワークスペース** パターンは、エージェント ネイティブがこれを解決する方法です。すべてのアプリをプライベート `packages/shared` パッケージとともに 1 つのモノリポジトリでホストします。フレームワークは共通のデフォルトを所有しています。 `packages/shared` は、ワークスペースに真にカスタムされたコード、命令、skills、コンポーネント、またはプラグインのオーバーライドのみを対象としています。各アプリは少数の画面と actions にまで縮小され、それがユニークなものになります。

## 共有されるもの {#what-gets-shared}

組織内のすべてのアプリが同意する必要があるものはすべて、`packages/shared` に含めることができます。

| 共有のもの                           | それが住んでいる場所                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| 認証 / SSO オーバーライド            | `src/server/index.ts` から `authPlugin` をエクスポート                                              |
| 組織 / RBAC ルール                   | Better Auth 組織、オプションで `authPlugin` でラップ                                                |
| エージェント チャット オーバーライド | `src/server/index.ts` から `agentChatPlugin` をエクスポート                                         |
| エンタープライズ エージェントの指示  | `AGENTS.md`                                                                                         |
| エージェント skills                  | `.agents/skills/<skill-name>/SKILL.md`                                                              |
| 共有エージェント actions             | `actions/*.ts`                                                                                      |
| 共有 React コンポーネント            | `src/client/index.ts` からエクスポート                                                              |
| デザイントークン/ブランド            | 共有 CSS ファイルを追加し、各アプリからインポートします                                             |
| 共有 API 認証情報                    | フレームワーク スコープの資格情報を優先します。名前空間が必要な場合にのみヘルパーを追加してください |

個々のアプリは、ルート、ダッシュボード、ビュー、ドメイン固有の actions など、_単なる画面のセット_ になります。実際のワークスペースのカスタマイズを追加するまでは、フレームワークのデフォルトが残りの部分をカバーします。

アプリが別のファーストパーティ アプリを使用する場合にも、同じ境界が適用されます。電子メール、カレンダー、分析、社内メモリ コンテキストを必要とする新しいワークスペース ダッシュボードでは、リンクまたは A2A を介して接続された近隣アプリとして、既存のメール、カレンダー、分析、および Brain アプリを使用する必要があります。データやエージェントにアクセスするためだけに、これらのテンプレートを複製したり、それらをネストするラッパー アプリを作成したり、内部で子アプリをスキャフォールディングしたりしてはなりません。アプリを明示的にカスタマイズする場合にのみ、コピーをフォークまたはスキャフォールディングします。

## はじめに {#getting-started}

ワークスペースは、エージェントネイティブ プロジェクトのデフォルトの形状です。足場 1 は次のとおりです。

```bash
npx @agent-native/core@latest create my-company-platform
```

CLI には、すべてのファーストパーティ テンプレートの複数選択ピッカーが表示されます。メール + カレンダー + フォームなど、必要なだけ選択すると、それらはすべて、認証とデータベースのデフォルトを共有する同じワークスペースに組み込まれます。

プライベート共有パッケージを含む pnpm モノリポジトリ、ワークスペース検出を接続するルート `package.json`、共有 `.env`、選択したアプリごとに 1 つのサブディレクトリを取得します。

```an-file-tree title="生成された workspace"
{
  "entries": [
    { "path": "package.json", "note": "agent-native.workspaceCore を宣言" },
    { "path": "pnpm-workspace.yaml", "note": "packages: [\"packages/*\", \"apps/*\"]" },
    { "path": ".env.example", "note": "共有の ANTHROPIC_API_KEY、A2A_SECRET、DATABASE_URL、..." },
    { "path": "packages/shared/", "note": "@my-company-platform/shared" },
    { "path": "packages/shared/src/server/", "note": "必要な場合のみ plugin overrides" },
    { "path": "packages/shared/src/client/", "note": "必要な場合のみ共有 React コード" },
    { "path": "packages/shared/AGENTS.md", "note": "workspace 全体の指示" },
    { "path": "apps/mail/" },
    { "path": "apps/calendar/" },
    { "path": "apps/forms/" }
  ]
}
```

次に、ブートします。

```bash
cd my-company-platform
cp .env.example .env             # ANTHROPIC_API_KEY、BETTER_AUTH_SECRET、...を入力します。
pnpm install
pnpm dev                         # opens Dispatch; other apps start on first visit
```

すべてのアプリは、ログイン方法、同じデータベースの共有方法、ワークスペース `AGENTS.md` のロード方法をすでに知っています。何も配線していません。フレームワークは、ルート `package.json` の `agent-native.workspaceCore` フィールドを介して共有パッケージを自動検出しました。

```json
{
  "name": "my-company-platform",
  "agent-native": {
    "workspaceCore": "@my-company-platform/shared"
  }
}
```

## 別のアプリを追加する {#adding-a-new-app}

ワークスペース内のどこからでも:

```bash
npx @agent-native/core@latest add-app
```

CLI では、既にインストールされているアプリがフィルターされて除外されたテンプレート ピッカーが再度表示されます。 1 つ以上を選択すると、`apps/` の下に足場が作成されます。非対話型のバリエーション:

```bash
npx @agent-native/core@latest add-app crm --template content
```

すべてのファーストパーティ テンプレートはワークスペース アプリとして機能します。CLI は、共有パッケージを dep として追加し、`workspace:*` 参照を解決するテンプレート上で小さな **workspacify** 変換を実行します。維持する必要のある並列「ワークスペース アプリ」スキャフォールドはありません。

```bash
pnpm install                     # at the workspace root
pnpm dev
```

それだけです。新しいアプリには、他のすべてのアプリと同じログインとワークスペースの手順があります。共有ブランド、actions、または認証情報は、ワークスペースが実際に必要とする場合にのみ追加してください。

## 何をどこでオーバーライドするか {#layering}

ワークスペース内のエージェント ネイティブ アプリは、次の順序で 3 つの場所から横断的な動作を解決します。

1. **ローカルアプリ** — `apps/<name>/` 内のファイル (最高優先度)
2. **共有ワークスペース** — `packages/shared/` (共有中間層) 内のファイル
3. **フレームワークのデフォルト** — `@agent-native/core` (最低)

マージはファイル名によって行われます。アプリが上流にも存在するローカル ファイルを提供する場合、ローカル ファイルが優先されます。そうでない場合は、ワークスペース共有バージョンが適用されます。共有でも提供されていない場合は、フレームワークのデフォルトが開始されます。これは、プラグイン skills、actions、および `AGENTS.md` に適用されます。

```an-diagram title="3 つのレイヤー、ファイル名ごとに結合" summary="各アプリは、最初にアプリローカルからプラグイン、スキル、アクション、AGENTS.md を解決し、次に共有パッケージ、次にフレームワークのデフォルトを解決します。"
{
  "html": "<div class=\"layer\"><div class=\"diagram-card accent\"><span class=\"diagram-pill accent\">1 &middot; App local</span><small class=\"diagram-muted\"><code>apps/&lt;name&gt;/</code> &mdash; highest priority</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">2 &middot; Workspace shared</span><small class=\"diagram-muted\"><code>packages/shared/</code> &mdash; the mid-layer</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">3 &middot; Framework default</span><small class=\"diagram-muted\"><code>@agent-native/core</code> &mdash; lowest</small></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box ok\">first match wins</div></div>",
  "css": ".layer{display:flex;flex-direction:column;align-items:center;gap:6px}.layer .diagram-card{display:flex;flex-direction:column;gap:3px;padding:12px 16px;width:320px}.layer .diagram-arrow{font-size:18px;line-height:1}.layer .diagram-box{margin-top:2px}"
}
```

あるアプリで別のものが必要な場合は、ローカル ファイルをドロップします。

| 上書きするもの                   | アプリ内に作成するファイル                          |
| -------------------------------- | --------------------------------------------------- |
| 認証プラグイン                   | `apps/<name>/server/plugins/auth.ts`                |
| エージェント チャット プラグイン | `apps/<name>/server/plugins/agent-chat.ts`          |
| 特定のスキル                     | `apps/<name>/.agents/skills/<skill-name>/SKILL.md`  |
| 特定のアクション                 | `apps/<name>/actions/<action-name>.ts`              |
| エージェントによる追加の指示     | `apps/<name>/AGENTS.md` (ワークスペース 1 とマージ) |

配線も設定も必要ありません。ファイルを作成すると、それが引き継がれます。

## 共有行動の編集 {#editing-shared-behavior}

横断的にカスタマイズできるものはすべて `packages/shared/` にあります。 `src/server/index.ts` から `authPlugin` をエクスポートすると、すべてのアプリが次回の開発リロード時にそれを取得します。 `.agents/skills/` の下にスキルを追加すると、すべてのアプリのエージェントがそれを認識します。 `actions/` にアクションを追加すると、すべてのアプリのエージェントがそれを呼び出すことができます。

共有パッケージは `workspace:*` 依存関係であるため、pnpm はそれを各アプリの `node_modules/` にシンボリックリンクします。ビルドしたり公開したりすることはありません。アプリはビルド時に必要なものをすべてバンドルします。

## ランタイム グローバル リソース {#runtime-global-resources}

リポジトリに同梱されるコードレベルのデフォルトには `packages/shared` を使用します: プラグイン、共有 actions、共有 React コード、ファイルシステム `AGENTS.md`、およびファイルシステム skills。管理者がコードを変更せずに管理したい実行時編集可能なグローバル コンテキストには、ディスパッチ ワークスペース リソースを使用します。

ディスパッチ リソースのスコープは、**すべてのアプリ** (すべてのアプリが実行時に継承し、コピーや同期手順はありません) または **選択されたアプリ** (アプリ固有のコンテキストに対してアプリごとに付与されます) です。完全なリソース モデル テーブル、パス規則、推奨スターター パックについては、[Workspace](/docs/workspace#global-resources) を参照してください。

## 認証と RBAC {#auth-and-rbac}

すべてのエージェント ネイティブ アプリには、[Better Auth](/docs/authentication) とフレームワークの組み込み組織システムがすでに付属しています。ワークスペースでは、同じデータベースに支えられたすべてのアプリでそれを無料で利用できます。完全なマルチテナンシー モデル (組織、役割、データ分離) については、[Multi-Tenancy](/docs/multi-tenancy) を参照してください。

企業固有のルール (許可リスト ドメイン、SSO 強制、追加のロール チェック) の場合は、`packages/shared/src/server/index.ts` から `authPlugin` をエクスポートします。ワークスペース内のすべてのアプリがこれらのルールを適用するようになりました。

アクティブな組織は自動的にフローします: `session.orgId` → `AGENT_ORG_ID` → SQL 行スコープ。そのため、`org_id` でタグ付けされたデータは、エージェントであっても他の組織には表示されません。完全なモデルについては、[Security & Data Scoping](/docs/security) を参照してください。

## 共有 MCP サーバー {#shared-mcp}

ワークスペース アプリ間で MCP サーバーを共有するための推奨オプション (優先順):

1. **ディスパッチ ワークスペース MCP リソース** — **すべてのアプリ** スコープのディスパッチに `mcp-servers/<name>.json` リソースを追加します。ワークスペース内のすべてのアプリは、ファイルの編集や再デプロイを行わずに、実行時に MCP サーバーを継承します。サーバーがアプリ固有の場合にのみ、選択したアプリに付与します。トークンは Dispatch ボールトに存在します。リソース JSON から `${keys.NAME}` を使用してそれらを参照します。

2. **ルート `mcp.config.json`** — ワークスペースのルートにファイルをドロップすると、ワークスペース内のすべてのアプリが同じ MCP サーバーに接続します。個々のアプリは独自の `mcp.config.json` でオーバーライドできます (app-root が優先)。これは、ユーザーごとのボールト認証情報を必要としないローカル/ファイルシステム MCP サーバー (`@modelcontextprotocol/server-filesystem`、`claude-in-chrome`、Playwright) に使用します。

3. **設定 UI (個人/組織スコープ)** — リモート HTTP MCP サーバーの場合、ユーザーは設定 UI から個人またはチーム (組織) スコープで追加できます — ファイル編集は不要で、実行中のエージェントにホットリロードされます。

構成スキーマ、優先順位ルール、ハブのセットアップについては、[MCP Clients](/docs/mcp-clients) を参照してください。

## 共有環境変数 {#shared-env}

The workspace root `.env` is loaded into every app automatically for deployment-level configuration such as `A2A_SECRET`, `BETTER_AUTH_SECRET`, and `DATABASE_URL`. User, org, and workspace API keys should be saved as scoped DB secrets instead of being written into `.env`. Per-app deploy-time overrides can still go in `apps/<name>/.env` and win on conflict.

ランタイム アプリの資格情報については、`.env` ファイルを手動で編集するよりも、Dispatch ボールトを使用することをお勧めします。ボールトはデフォルトですべてのアプリにアクセスするため、保存されたすべてのボールト キーはすべてのワークスペース アプリで使用でき、`sync-vault-to-app` でプッシュできます。アプリがキーごとの明示的な許可を必要とする場合にのみ、ボールトを手動モードに切り替えます。

```text
my-company-platform/
├── .env                           # shared: ANTHROPIC_API_KEY=... , A2A_SECRET=... , ...
└── apps/
    └── mail/
        └── .env                   # optional overrides just for mail
```

いくつかのオンボーディング フローは、すぐに使えるワークスペース対応です。

- **Builder `/cli-auth`**: clicking "Connect Builder" from any app writes `BUILDER_PRIVATE_KEY` and related metadata to scoped DB secrets, so every app can resolve the connection without sharing a deploy-global key.
- **Compatibility key route** (`POST /_agent-native/env-vars`): older onboarding forms still call this route name, but it now saves values as scoped DB secrets. Pass `scope: "workspace"` to share with the active org, or omit it for a per-user key.

## 共有認証情報 {#shared-credentials}

同じワークスペース内のアプリはデフォルトで同じ `DATABASE_URL` を指すため、フレームワーク認証情報ストレージにより、アプリごとの構成を行わずにすべてのアプリで認証情報を利用できるようになります。 `@agent-native/core/credentials` を直接使用するか、ワークスペースでより厳密な命名規則が必要な場合は、`packages/shared` にシン ヘルパーを追加します。

## 共有デザイン トークン {#design-tokens}

フレームワークは Tailwind v4 です。ワークスペースに共有する実際のブランド トークンがある場合にのみ、共有 CSS ファイルを `packages/shared` に追加し、各アプリの `app/global.css` からインポートします。

```css
@import "tailwindcss";
@import "@my-company-platform/shared/styles/tokens.css";
@source "./**/*.{ts,tsx}";

:root {
  --background: 0 0% 100%; /* ...brand tokens... */
}
.dark {
  --background: 220 6% 6%; /* ... */
}
```

ブランド カラー、タイポグラフィ、間隔スケール、および共有コンポーネント クラスは、その 1 つの CSS ファイル内に存在できます。 `packages/shared` で更新すると、すべてのアプリのブランドが次のビルドで変更されます。

## 展開 {#deployment}

**統合デプロイ** (ワークスペースのデフォルト) またはアプリごとに独立したデプロイの 2 つのオプションがあります。

### 統合展開 (推奨)

1 つのコマンドでワークスペース内のすべてのアプリをビルドし、単一のオリジン、アプリごとに 1 つのパスの背後で配布します。

```bash
npx @agent-native/core@latest deploy
# https://your-agents.com/mail/*       → apps/mail
# https://your-agents.com/calendar/*   → apps/calendar
# https://your-agents.com/forms/*      → apps/forms
```

各アプリは `APP_BASE_PATH=/<name>` および `VITE_APP_BASE_PATH=/<name>` で構築され、選択した Nitro プリセットを通じて出力されます。 Cloudflare Pages がデフォルトのプリセットで、`dist/_worker.js` と `_routes.json` でディスパッチャー ワーカーを使用します。 Netlify は `npx @agent-native/core@latest deploy --preset netlify` でサポートされています。 `.netlify/functions-internal/<app>-server` の下でアプリ関数を発行し、静的アセットを強制されないままにするリダイレクトを生成するため、CDN が最初にファイルを提供します。 Vercel は `npx @agent-native/core@latest deploy --preset vercel` でサポートされています。 Vercel のビルド出力 API を使用して、ルート `.vercel/output` バンドルを書き込みます。

```an-diagram title="統合デプロイ: アプリごとに 1 つのオリジン、1 つのパス" summary="すべてのアプリは単一のオリジンで出荷されるため、ログイン セッションとアプリ間の A2A は無料です。"
{
  "html": "<div class=\"deploy\"><div class=\"diagram-box accent\">your-agents.com<br><small class=\"diagram-muted\">one DNS record &middot; one cert &middot; one CDN</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"deploy-apps\"><div class=\"diagram-box\">/mail/*</div><div class=\"diagram-box\">/calendar/*</div><div class=\"diagram-box\">/forms/*</div></div><div class=\"diagram-pill ok\">shared login cookie on the apex &bull; same-origin A2A, no CORS</div></div>",
  "css": ".deploy{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.deploy .deploy-apps{display:flex;flex-direction:column;gap:8px}.deploy .diagram-arrow{font-size:24px}.deploy .diagram-pill{flex-basis:100%}"
}
```

**同じオリジン**に存在することが、本当の利益を生む場所です:

- **共有ログイン セッション。** Better Auth は apex ドメインに Cookie を設定するため、どのアプリにログインしても、すべてのアプリにログインすることになります。クロスドメイン SSO ダンスはありません。
- **ゼロ構成クロスアプリ A2A.** `@mail` タグ付け `@calendar` は同一オリジンフェッチになります — 兄弟間での CORS や JWT 署名はありません。外部 A2A は、現在と同様に JWT を使用します。
- **1 つの DNS レコード、1 つの証明書、1 つの CDN キャッシュ。**

`dist/` 出力を公開します:

```bash
wrangler pages deploy dist
```

Netlifyの場合:

```bash
npx @agent-native/core@latest deploy --preset netlify --build-only
```

Vercel Git デプロイメントの場合、ビルド コマンドを次のように設定します。

```bash
npx @agent-native/core@latest deploy --preset vercel --build-only
```

### パブリックアプリルート

ワークスペース アプリはデフォルトで内部にあります。ログイン専用の管理ページがある公開サイトの場合は、公開対象者を設定し、そのアプリの `package.json` で管理者プレフィックスを保護します。

```json
{
  "agent-native": {
    "workspaceApp": {
      "audience": "public",
      "protectedPaths": ["/admin"]
    }
  }
}
```

ほとんどが内部アプリで、いくつかの公開ページがある場合は、対象ユーザーを内部のままにし、ページのプレフィックスをリストします。

```json
{
  "agent-native": {
    "workspaceApp": {
      "publicPaths": ["/", "/share"]
    }
  }
}
```

これらの設定は、読み取り専用ページのナビゲーションにのみ影響します。フレームワーク ツール、エージェント チャット、A2A、ボールト アクセス、および任意の API は、アプリが `createAuthPlugin({ publicPaths: [...] })` でパブリック プレフィックスを明示的に宣言しない限り、認証されたままになります。

### アプリごとに独立したデプロイ

独自のドメイン (`mail.company.com`、`calendar.company.com`) 上の各アプリを好みますか?ワークスペース内のすべてのアプリは依然として独立して展開可能です。`cd apps/mail && npx @agent-native/core@latest build` はスタンドアロンの足場とまったく同じように動作します。次に、クロスアプリ A2A は、共有 `A2A_SECRET` を使用して、標準の JWT 署名付きパスを通過します。個別にデプロイされたアプリ間のクロスドメイン SSO は、ハブとして Dispatch を使用する ID フェデレーションによって処理されます。「[Cross-App SSO](/docs/cross-app-sso)」を参照してください。統合されたシングルオリジンのデプロイにより、その必要がなくなります。

### 共有データベース、共有資格情報

何を選択しても、すべてのアプリはすぐに使用できるクロスアプリ状態 (ユーザー アカウントの 1 セット、組織の 1 セット、共有設定の 1 セット) に対して同じ `DATABASE_URL` を指します。各アプリに独自のデータベースがある場合でも、ワークスペース パターンは引き続き機能します。共有状態のストーリーが失われるだけです。

共有パッケージ自体はスタンドアロンで展開されることはありません。これは、pnpm が各アプリの `node_modules/` にシンボリックリンクする `workspace:*` のデプロイであるため、すべてのアプリはビルド時に必要なものを透過的にバンドルします。

## （現時点では）範囲外 {#out-of-scope}

ワークスペースのパターンは意図的に狭くなっています。意図的にまだ処理していないことがいくつかあります:

- **暗号化された資格情報ボールト。** ランタイム アプリの資格情報には Dispatch ボールトを優先します ([Shared environment variables](#shared-env) を参照)。非 Vault フォールバック パス (フレームワーク `settings` テーブルに直接書き込まれる共有認証情報) は、現在プレーン テキストとして保存されるため、これに依存する場合は責任を持ってローテーションしてください。
- **共有コードをプライベート npm に公開しています。** 共有パッケージは `workspace:*` のみです。プライベート レジストリを介したマルチリポジトリの共有は実行可能ですが、スキャフォールディングはできません。
- **独自のコンポーネント ライブラリ。** `packages/shared` は、共有コンポーネントを\_配置する場所です。フレームワークは、shadcn/ui やその他のシステムをそのスロットに強制しません。

## こちらもご覧ください {#see-also}

- [Workspace](/docs/workspace) — ワークスペース内のすべてのアプリが共有するカスタマイズ レイヤー (`AGENTS.md`、`LEARNINGS.md`、個人メモリ、skills、カスタム エージェント)。
- [Workspace Governance](/docs/workspace-management) — 1 つのリポジトリ内の多くのアプリにわたる分岐、CODEOWNERS、PR レビュー。
- [Multi-Tenancy](/docs/multi-tenancy) — 組織、役割、組織ごとのデータ分離。
- [Cross-App SSO](/docs/cross-app-sso) — 個別ドメイン展開用の ID フェデレーション。
- [Dispatch](/docs/dispatch) — 通常、シークレット ボールト、統合カタログ、承認ハブとしてマルチアプリ ワークスペース内に存在するランタイム コントロール プレーン。
