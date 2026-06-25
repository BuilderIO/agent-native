---
title: "セキュリティ"
description: "エージェント ネイティブ アプリのセキュリティ モデル: 入力検証、SQL インジェクション防止、XSS、データ スコープ、シークレット管理、認証パターン。"
---

# セキュリティ

エージェント ネイティブ アプリは、デフォルトで安全になるように設計されています。このフレームワークは複数のレイヤーで自動保護を提供します。SQL レベルのデータ分離、パラメーター化されたクエリ、入力検証、認証をすぐに利用できます。

## 無料で手に入るものとあなたが所有するもの {#what-you-own}

```an-diagram title="多層防御" summary="フレームワークは脅威の表面の大部分を所有します。所有するものは 2 つあります。1 つは外部入力のスコープ設定と検証のためのテーブルのタグ付けです。"
{
  "html": "<div class=\"sec-layers\"><div class=\"diagram-card free\"><span class=\"diagram-pill ok\">フレームワークが所有</span><small class=\"diagram-muted\">SQL isolation &middot; parameterized queries &middot; XSS escaping &middot; auth guard &middot; CSRF cookies &middot; secret encryption</small></div><div class=\"diagram-card you\"><span class=\"diagram-pill warn\">自分で所有</span><small class=\"diagram-muted\">A. tag tables with ownableColumns() &amp; route through access guards<br>B. give every action a Zod schema &amp; send user URLs through the SSRF guard</small></div></div>",
  "css": ".sec-layers{display:flex;flex-direction:column;gap:12px}.sec-layers .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px}"
}
```

標準パターンに基づいて構築すると、フレームワークはすでに脅威の表面のほとんどを処理します。

- **データ分離** — エージェント SQL は、現在のユーザー (およびアクティブな組織) の行のみを表示できるように書き換えられます。 [Data Scoping](#data-scoping) を参照してください。
- **SQL インジェクション** — `db-query`/`db-exec` および Drizzle は常にパラメータ化されます。 [SQL Injection Prevention](#sql-injection) を参照してください。
- **XSS** — React は自動エスケープ、TipTap および `react-markdown` はサニタイズします。 [XSS Prevention](#xss) を参照してください。
- **認証と CSRF** — すべての `defineAction` は認証で保護されています。クッキーは `httpOnly` + `SameSite=lax` です。 [Authentication](#auth) を参照してください。
- **秘密暗号化** — 資格情報とボールトは保存時に暗号化されます。 [Secrets Management](#secrets) を参照してください。

これにより、実際に考慮しなければならない部分が小さくなります:

- **A.スコープ用にテーブルにタグを付けます。** [`ownableColumns()`](#data-scoping) 経由で `owner_email` (チーム データの場合は `org_id`) を追加し、Drizzle の読み取り/書き込みを [access guards](#access-guards) 経由でルーティングします。
- **B.外部入力を検証してルーティングします。** すべてのアクションに Zod [`schema:`](#input-validation) を与え、ユーザー/エージェントのサーバー側フェッチ URL を [SSRF guard](#ssrf) 経由で送信します。

これら 2 つを正しく設定すれば、残りはデフォルトのままです。 [Production Checklist](#production-checklist) は、出荷前の 1 ページの確認です。

## 設計によるセキュリティ {#secure-by-design}

フレームワーク アーキテクチャは、標準パターンを使用する場合に一般的な脆弱性を防止します。

| 脆弱性                     | フレームワークの保護                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------- |
| SQL インジェクション       | `db-query`/`db-exec` および Drizzle ORM のパラメータ化されたクエリ                    |
| XSS                        | React は JSX を自動エスケープします。 TipTap はリッチ テキストをサニタイズします      |
| データ漏洩                 | 一時ビューによる SQL レベルのスコープ設定 (`owner_email`、`org_id`)                   |
| 認証バイパス               | 認証ガードはすべての `defineAction` エンドポイントを自動保護します                    |
| インプットインジェクション | `defineAction` での Zod スキーマ検証                                                  |
| CSRF                       | `SameSite=lax` + `httpOnly` クッキー                                                  |
| 秘密の暴露                 | `.env` は無視されました。認証情報と保存時の保管庫の暗号化 (AES-256-GCM)               |
| SSRF                       | `ssrfSafeFetch` は内部/メタデータ ターゲット + リダイレクト再バインドをブロックします |

## 入力の検証 {#input-validation}

すべてのアクションで `defineAction` を Zod `schema:` とともに使用します。フレームワークは、コードが実行される前に入力を自動的に検証します。

```ts
import { z } from "zod";
import { defineAction } from "@agent-native/core/action";

export default defineAction({
  description: "Create a note",
  schema: z.object({
    title: z.string().min(1).max(200).describe("Note title"),
    content: z.string().optional().describe("Note body"),
  }),
  run: async (args) => {
    // args is guaranteed valid — invalid input never reaches here
  },
});
```

無効な入力により、明確なエラー メッセージが返されます (HTTP の場合は 400、エージェント コールの構造化エラー)。従来の `parameters:` 形式では、実行時検証が提供されません。

## SQL インジェクション防止 {#sql-injection}

フレームワークの `db-query` ツールと `db-exec` ツールはパラメーター化されたクエリを使用します。ユーザー入力は引数として渡され、SQL 文字列に補間されることはありません:

```ts
// SAFE — parameterized query (framework default)
await exec({ sql: "INSERT INTO notes (title) VALUES (?)", args: [title] });

// SAFE — Drizzle ORM (always generates parameterized queries)
await db.insert(notes).values({ title, ownerEmail: email });

// DANGEROUS — string concatenation (never do this)
await exec(`INSERT INTO notes (title) VALUES ('${title}')`);
```

```an-callout
{
  "tone": "risk",
  "body": "文字列の連結またはテンプレート リテラルによって SQL を構築しないでください。ユーザー入力を `args` として `exec` / `db-query` に渡すか、Drizzle を使用します。どちらも常にパラメーター化されます。 `pnpm guards` チェックは、CI 時にスコープのないクエリと連結されたクエリをキャッチします。"
}
```

## XSS 防止 {#xss}

React はすべての JSX 式を自動エスケープします。追加のガイドライン:

- ユーザーが制御するコンテンツでは `dangerouslySetInnerHTML` を使用しないでください
- `innerHTML`、`eval()`、または `document.write()` は決して使用しないでください
- リッチ テキスト編集には、TipTap (フレームワークの依存関係) を使用します。スキーマを通じてサニタイズされます
- マークダウンのレンダリングには、`react-markdown` を使用します。安全に React 要素に変換されます

## サーバー側フェッチ (SSRF) {#ssrf}

ユーザーまたはエージェントによって制御される URL のサーバー側 `fetch` は、フレームワーク SSRF ガードを通過する必要があります。または、クラウド メタデータ (`169.254.169.254`)、`localhost`、または内部サービスを指すこともできます。

```ts
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";

const res = await ssrfSafeFetch(userProvidedUrl, {}, { maxRedirects: 3 });
```

`ssrfSafeFetch` はプライベート/内部ターゲットをブロックし、接続時に解決された IP を再チェックし (DNS 再バインド)、すべてのリダイレクト ホップを再検証して、パブリック URL がプライベート ネットワークにリダイレクトできないようにします。拡張 iframe プロキシ、`upload-image`、およびデザイン トークン インポーターはすべて、それを経由してルーティングされます。飛行前のみのチェックの場合は、`isBlockedExtensionUrlWithDns(url)` を `redirect: "manual"` とともに使用します。

## データの範囲 {#data-scoping}

運用環境では、フレームワークはエージェント SQL クエリを現在のユーザーのデータに自動的に制限します。これは SQL レベルで強制されます。エージェントはこれをバイパスできません。このセクションは、スコープ パイプラインの正規のリファレンスです。仕組みについては、[Authentication](/docs/authentication) および [Multi-Tenancy](/docs/multi-tenancy) のドキュメントのリンクを参照してください。

### スコーピング パイプライン {#scoping-pipeline}

認証されたセッションからエージェントが実行する SQL までのスコープ フロー:

```
session.orgId → AGENT_ORG_ID → SQL row scoping
```

```an-diagram title="スコーピングパイプライン" summary="エージェント SQL はベース テーブルに直接触れることはありません。現在の ID をスコープとする一時ビューを介して読み取ります。そのため、ベア テーブル名は所有されている行のみを返すことができます。"
{
  "html": "<div class=\"scope-pipe\"><div class=\"diagram-node\">サインイン済みセッション<br><small class=\"diagram-muted\">email &middot; orgId</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">Request context<br><small class=\"diagram-muted\">AGENT_ORG_ID</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">Temporary VIEW<br><small class=\"diagram-muted\">WHERE owner_email = ? AND org_id = ?</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node ok\">エージェントSQL<br><small class=\"diagram-muted\">bare table names only</small></div></div>",
  "css": ".scope-pipe{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.scope-pipe .diagram-node{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.scope-pipe .diagram-arrow{font-size:22px;line-height:1}"
}
```

サインインしたセッションには、`email` と (組織がアクティブな場合) `orgId` が含まれます。フレームワークは、そのセッションからリクエスト コンテキストを確立し、アクティブな組織を SQL エージェントに `AGENT_ORG_ID` として公開し、現在の ID が所有する行のみを表示できるようにすべてのクエリを書き換えます。クエリが UI、アクション、エージェントからのものであっても、同じパスが適用されます。エージェントは、ユーザーがメンバーではない組織のデータを読み取ることはできません。

### ユーザーごとのスコープ (`owner_email`)

ユーザー固有のデータを含むすべてのテーブルには、`owner_email` テキスト列が必要です\*\*。キャメルケースの Drizzle プロパティ名を使用します — `accessFilter` は `resourceTable.ownerEmail` と読み取られます:

```ts
import {
  table,
  text,
  integer,
  ownableColumns,
} from "@agent-native/core/db/schema";

// Minimal: just the owner column
export const notes = table("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  ownerEmail: text("owner_email").notNull(), // REQUIRED — camelCase property
});

// Or use ownableColumns() to add owner_email + org_id + visibility in one call
export const notes = table("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  ...ownableColumns(),
});
```

フレームワークは、クエリを自動的にフィルターする一時的な SQL ビューを作成します。

```sql
CREATE TEMPORARY VIEW "notes" AS
  SELECT * FROM main."notes"
  WHERE "owner_email" = 'alice@example.com';
```

列がまだ存在しない場合、INSERT ステートメントは `owner_email` 自動挿入されます。

`db-query` / `db-exec` ツールは、スキーマ修飾されたテーブル参照 (`public.<table>`、`main.<table>`) を拒否します。修飾名はベース テーブルに解決され、上記の一時ビューをバイパスします。エージェントは裸のテーブル名を使用します。スコープは自動的に適用されます。

### 組織ごとのスコープ (`org_id`)

チームがデータを共有するマルチユーザー アプリの場合は、`org_id` 列を追加します。両方の列が存在する場合、クエリのスコープは `WHERE owner_email = ? AND org_id = ?` の両方になります。

`ownableColumns()` スキーマ ヘルパーは、1 回の呼び出しで `owner_email`、`org_id`、および `visibility` を追加するため、新しいテナント対応テーブルはデフォルトで完全なスコープ コントラクトを取得します。

```ts
import { table, text, ownableColumns } from "@agent-native/core/db/schema";

export const projects = table("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  ...ownableColumns(), // adds owner_email + org_id + visibility
});
```

```an-schema title="What ownableColumns() adds" summary="テーブルをテナント認識し、共有可能にする 3 つの列。"
{
  "entities": [
    {
      "id": "ownable",
      "name": "ownable resource",
      "note": "Any table that spreads ...ownableColumns()",
      "fields": [
        { "name": "owner_email", "type": "text", "nullable": false, "note": "Creator. Auto-filled by write actions; auto-injected on INSERT." },
        { "name": "org_id", "type": "text", "nullable": true, "note": "作成時の所有者のアクティブな組織。組織の可視性チェックを推進します。" },
        { "name": "visibility", "type": "enum", "nullable": false, "note": "プライベート |組織 | public — 大まかなデフォルト、デフォルトはプライベートです。" }
      ]
    }
  ]
}
```

### actions のアクセス ガード {#access-guards}

Raw エージェント SQL は、上記の一時ビューによってスコープされます。 Drizzle で直接クエリを実行するアクション コードは、フレームワークのアクセス ヘルパーを経由する必要があるため、読み取りと書き込みのスコープは現在の ID に留まります。

- **`accessFilter`** — 現在のユーザー/組織が参照できる行にクエリを制限する `WHERE` 述語を返します。リスト/読み取りクエリで使用します。
- **`resolveAccess`** — 現在のリクエストに対する有効なアクセス スコープ (所有者、組織、共有) を解決します。
- **`assertAccess`** — 書き込みまたは単一レコードの読み取りを保護し、現在の ID がターゲット行に作用しない可能性がある場合にスローします。

`ownableColumns()` で構築されたテーブルには、これらのスコープ付きの読み取りと書き込みが必要です。カスタム Nitro ルートは、所有可能なデータをクエリする前にリクエスト コンテキストを確立する必要があります。 `guard-no-unscoped-queries` チェック (`pnpm guards` 経由で実行) は、CI 時にこれを強制します。完全なヘルパー API については、`sharing` スキルを参照してください。

### 検証

```bash
pnpm action db-check-scoping           # すべてのテーブルに owner_email があることを確認する
pnpm action db-check-scoping --require-org  # org_id も必要です
```

## 機密管理 {#secrets}

| シークレットの種類                           | 保管場所                                                |
| -------------------------------------------- | ------------------------------------------------------- |
| デプロイレベルのキー (アプリごとに 1 つ)     | `.env` ファイル (gitignored、サーバー側のみ)            |
| ユーザーごと / 組織ごとの API キー           | `saveCredential` / `resolveCredential` (保存時に暗号化) |
| 登録されたシークレット (サイドバー ボールト) | `app_secrets` ボールト (保存時に暗号化)                 |
| OAuth トークン (Google、GitHub)              | `saveOAuthTokens()` 経由で `oauth_tokens` ストア        |
| セッショントークン                           | 自動 (Better Auth がこれを処理します)                   |

ユーザーごと/組織ごとの資格情報とボールトは、`SECRETS_ENCRYPTION_KEY` によってキー付けされた AES-256-GCM で保存時に暗号化されます (`BETTER_AUTH_SECRET` にフォールバック)。生産はこれなしでは開始できません。既存の平文認証情報行を暗号化するには、`pnpm action db-migrate-encrypt-credentials` (冪等、非破壊) を実行します。

シークレットを `settings`、`application_state`、ソース コード、またはアクション レスポンスに保存しないでください。上記の資格情報/ボールト API を使用します。これらは暗号化とユーザーごとのスコープの両方を処理します。

## 認証 {#auth}

認証は自動です。完全なセットアップについては、[Authentication](/docs/authentication) ドキュメントを参照してください。

**セキュリティに関する重要なポイント:**

- `defineAction` エンドポイントは認証ガードによって自動保護されます
- カスタム `/api/` ルートは `getSession(event)` を呼び出して結果を確認する必要があります
- 状態変更操作では POST (actions のデフォルト) を使用する必要があります
- `SameSite=lax` + `httpOnly` Cookie は、ほとんどの CSRF 攻撃を防ぎます

## A2A 本人確認 {#a2a-identity}

アプリが A2A プロトコル経由で相互に呼び出しを行う場合、共有シークレットで署名された JWT トークンを使用して ID を検証します。

```bash
A2A_SECRET=your-shared-secret-at-least-32-chars
```

1. アプリ A は、`sub: "steve@example.com"` を含む JWT に署名します
2. アプリ B は同じシークレットを使用して JWT 署名を検証します
3. アプリ B は、検証された `sub` クレームをリクエスト コンテキストに読み取ります
4. データ スコープが適用されます - アプリ B は Steve のデータのみを表示します

運用環境に `A2A_SECRET` がないと、すべての A2A エンドポイントと `/_agent-native/integrations/process-task` 自己起動エンドポイントは **503** を返します。 A2A トラフィックを呼び出したり受信したりするすべてのアプリに設定します。 (ローカル開発の場合、フレームワークは引き続き認証されていない呼び出しを許可します。)

## インバウンド Webhooks {#webhooks}

受信 Webhook ハンドラー (Resend、SendGrid、Slack、Telegram、WhatsApp、Recall.ai、Deepgram、Zoom、Google Docs Pub/Sub) は、運用環境ではデフォルトで偽装リクエストを拒否します。対応する署名シークレット環境変数が欠落している場合、ハンドラーは受け入れてディスパッチする代わりに 401 を返します。

これは以前は「警告して受け入れる」というスタンスでした。さもなければ見逃してしまうシークレットを設定するか、ローカル開発専用の `AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS=1` による古い動作にオプトバックします。統合ごとの署名秘密変数については、[Messaging](/docs/messaging#env-vars) を参照してください。

## 制作チェックリスト {#production-checklist}

### 認証と秘密

- [ ] `BETTER_AUTH_SECRET` は、`A2A_SECRET` から派生したホストされたワークスペース デプロイでない限り、ランダムな 32 文字以上の文字列 (`openssl rand -hex 32`) に設定されます
- [ ] `OAUTH_STATE_SECRET` は、別のランダムな 32 文字以上の文字列に設定されます (`BETTER_AUTH_SECRET` は再利用しないでください) — [OAuth State Signing](#oauth-state) を参照
- [ ] A2A トラフィックを呼び出しまたは受信するすべてのアプリに `A2A_SECRET` が設定されます — [A2A Identity Verification](#a2a-identity) を参照
- [ ] `SECRETS_ENCRYPTION_KEY` セット (または `BETTER_AUTH_SECRET` フォールバックに依存) — [Secrets Management](#secrets) を参照
- [ ] `AUTH_SKIP_EMAIL_VERIFICATION` は運用環境では**設定されていません** (または QA プレビュー展開でのみ設定されます)

### Webhook シークレット (使用する統合用に設定します)

- [ ] 有効なインバウンド統合ごとに設定された署名シークレット — 統合ごとのリストについては、[Inbound Webhooks](#webhooks) および [Messaging](/docs/messaging#env-vars) を参照してください
- [ ] `AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS` は本番環境に**設定されていません**

### スキーマ

- [ ] すべてのユーザー向けテーブルには `owner_email` があり、マルチユーザー テーブルにも `org_id` があります — [Data Scoping](#data-scoping) を参照
- [ ] 所有可能テーブルの読み取り/書き込みは [access guards](#access-guards) を経由します
- [ ] すべての actions は `defineAction` と Zod `schema:` を使用します — [Input Validation](#input-validation) を参照
- [ ] ユーザー/エージェント URL のサーバー側フェッチは `ssrfSafeFetch` を経由します — [SSRF](#ssrf) を参照
- [ ] ユーザー コンテンツを含む `dangerouslySetInnerHTML` はありません (または出力は DOMPurify を通じて実行されます)
- [ ] 文字列連結なし SQL
- [ ] `pnpm guards` はクリーンです (`guard-no-unscoped-queries`、`guard-no-env-credentials`、`guard-no-env-mutation`、`guard-no-localhost-fallback`、`guard-no-unscoped-credentials`、`guard-no-drizzle-push`)
- [ ] データ分離を検証するために 2 つのユーザー アカウントでテスト済み

### その他の硬化

- [ ] `AGENT_NATIVE_DEBUG_ERRORS` は実際の本番環境では**設定されていません** (デバッグ プレビューのみ)
- [ ] `AGENT_NATIVE_KEYS_WORKSPACE_FALLBACK` は、組織が実際にワークスペースキーを共有しない限り**設定されません** — [Cross-User Tooling Secrets](#tooling-secrets) を参照
- [ ] マルチテナント展開では、**ユーザーは独自の `ANTHROPIC_API_KEY`** を使用します。フレームワークは展開レベルの環境変数へのフォールバックを拒否します。

---

以下のセクションでは、特定の展開でのみ利用できるニッチな環境フラグについて説明します。ほとんどのアプリはそれらに触れることはありません。

## OAuth 状態署名 {#oauth-state}

OAuth フロー (Google、Atlassian、Zoom) は、専用の HMAC キーを使用して状態エンベロープに署名します。

```bash
OAUTH_STATE_SECRET=$(openssl rand -hex 32)
```

以前は、これは `GOOGLE_CLIENT_SECRET` (Google と共有される認証情報) にフォールバックしていました。Google の秘密が漏洩すると、攻撃者は OAuth 状態エンベロープを偽造できました。専用キーはサードパーティの秘密から独立しています。 `OAUTH_STATE_SECRET` が設定されていない場合、フレームワークは `BETTER_AUTH_SECRET` に戻ります。ホストされたワークスペースのデプロイでは、すでに必要な `A2A_SECRET` から目的ごとの OAuth キーを派生することもできます。これらのサーバー シークレットがいずれも利用できない場合、OAuth フローは運用環境で失敗します。

`redirect_uri` クエリ パラメーターは、ホワイトリスト (同一オリジン + フレームワーク `/_agent-native/...` パス) に対しても検証されます。テンプレート内のカスタム OAuth フローは、状態に署名する前にフレームワークの `isAllowedOAuthRedirectUri()` ヘルパーを使用する必要があります。

## クロスユーザー ツールの秘密 {#tooling-secrets}

`${keys.NAME}` を参照するツールと自動化は、デフォルトでユーザーごとにシークレットを解決します。このバージョンでは、ワークスペース スコープのフォールバックは **デフォルトでオフになっています**。悪意のある組織メンバーがワークスペース `OPENAI_API_KEY` を植え付け、他のメンバーの API 呼び出しを収集する可能性があります。

組織が本当にワークスペース全体のキー (単一の企業 Stripe キーなど) を共有している場合は、次の方法で古い動作に戻します。

```bash
AGENT_NATIVE_KEYS_WORKSPACE_FALLBACK=1
```

ワークスペース スコープのシークレットの書き込みには、このフラグに関係なく、組織の所有者/管理者のロールが必要です。
