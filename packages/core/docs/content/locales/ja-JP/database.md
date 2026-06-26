---
title: "データベース"
description: "ポータブル SQL データベースをエージェント ネイティブ アプリに接続し、プロバイダーに依存しない Drizzle コードを作成します。"
---

# データベース

エージェント ネイティブ アプリは [Drizzle ORM](https://orm.drizzle.team) を使用し、ポータブル SQL バックエンドをサポートします。ローカル開発以外の場合は、`DATABASE_URL` を設定して、永続的な SQL データベース (Postgres、libSQL/Turso、または別の Drizzle 互換バックエンド) に接続します。この変数の設定が解除されると、アプリは設定ゼロのローカル SQLite ファイルに戻るため、すぐに開発を開始できます。

```an-diagram title="1 つのスキーマ、多数のバックエンド" summary="アプリ コードは、フレームワークの方言に依存しないヘルパーを使用します。方言は実行時に DATABASE_URL から自動検出されます。 unset はローカルの SQLite ファイルを意味します。"
{
  "html": "<div class=\"diagram-db\"><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">@agent-native/core/db/schema</span><small class=\"diagram-muted\">table · text · integer · real · now</small><small class=\"diagram-muted\">+ Drizzle query DSL</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>DATABASE_URL<br><small class=\"diagram-muted\">dialect auto-detected</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-grid\"><span class=\"diagram-pill\">Postgres<br><small class=\"diagram-muted\">Neon · Supabase</small></span><span class=\"diagram-pill\">libSQL / Turso</span><span class=\"diagram-pill\">Cloudflare D1</span><span class=\"diagram-pill warn\">SQLite file<br><small class=\"diagram-muted\">unset = local dev only</small></span></div></div>",
  "css": ".diagram-db{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-db .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px 16px}.diagram-db .diagram-arrow{font-size:22px;line-height:1}.diagram-db .diagram-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}"
}
```

## ローカルのデフォルト: SQLite ファイル {#default-sqlite}

`DATABASE_URL` が設定されていない場合、アプリは `data/app.db` に SQLite データベースを作成します。これはローカル開発のゼロ構成のデフォルトであり、セットアップは必要ありません。これは開発のみを目的としています。運用環境の場合は、`DATABASE_URL` を永続的な SQL データベースに設定します。

デプロイされたアプリについては、そのローカル ファイルに依存しないでください。コンテナー、サーバーレス関数、およびプレビュー環境はファイルシステムをリセットする場合があります。これは、再起動の間にローカルの SQLite ファイルが消える可能性があることを意味します。運用環境で使用する前に、`DATABASE_URL` を永続的なホスト型データベースに設定します。

## 実稼働データベースへの接続 {#production}

`.env` ファイルまたはデプロイプロバイダー環境で `DATABASE_URL` を設定し、ホストされたデータベースに接続します。 Turso は必要ありません。導入に適した Drizzle 互換の SQL バックエンドを使用してください:

```bash
# Neon の Postgres
DATABASE_URL=postgres://user:pass@ep-cool-name-123456.us-east-2.aws.neon.tech/mydb?sslmode=require

# Supabase の Postgres
DATABASE_URL=postgres://postgres.xxxx:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres

# 通常の Postgres
DATABASE_URL=postgres://user:pass@localhost:5432/mydb

# Turso (libSQL)
DATABASE_URL=libsql://my-db-org.turso.io
DATABASE_AUTH_TOKEN=your-token
```

フレームワークは URL から方言を自動検出し、それに応じて Drizzle を構成します。内蔵アダプターは、Postgres URL、libSQL/Turso URL、SQLite ファイル URL、および Cloudflare D1 バインディングをカバーします。一般的な本番環境の選択肢には、Neon、Supabase、Turso/libSQL、プレーン Postgres、耐久性のある SQLite、利用可能な場合は Builder.io で管理された環境が含まれます。

## Builder.io 管理データベース {#builder-managed}

_計画中 (まだ利用可能ではありません):_ Builder.io に接続すると、アプリは接続文字列を必要とせずに、自動的にプロビジョニングされたマネージド データベースを使用できるようになります。

## DB クライアントが存在する場所 {#db-client}

各テンプレートは、`@agent-native/core/db` から `createGetDb(schema)` を呼び出して、遅延シングルトン Drizzle クライアントを作成します。正規の場所は `server/db/index.ts` です:

```ts
// server/db/index.ts
import { createGetDb } from "@agent-native/core/db";
import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
```

`@agent-native/core` から直接ではなく、このテンプレート ローカル パス (ルート内の `../../server/db/index.js`、actions 内の `../server/db/index.js`) から `getDb` をインポートします。コア エクスポートは、汎用の型なしインスタンスを返します。テンプレートの `getDb()` にはスキーマ タイプが含まれます。 actions とカスタム ルートがそれぞれどのようにインポートするかについては、[Server](/docs/server#request-context) を参照してください。

## 方言に依存しないスキーマとクエリ {#schema}

アプリ データベース コードは、プロバイダー間で実行できるように、Drizzle のスキーマを使用し、DSL をクエリする必要があります。製品コードには、SQLite のみの構文 (`INSERT OR REPLACE`、`AUTOINCREMENT`、`datetime('now')`) または Postgres のみの構文を決して書かないでください。

`@agent-native/core/db/schema` のフレームワークのスキーマ ヘルパーを使用します:

```ts
import { table, text, integer, real, now } from "@agent-native/core/db/schema";

export const tasks = table("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  priority: integer("priority").notNull().default(0),
  weight: real("weight"),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  ownerEmail: text("owner_email").notNull(),
  createdAt: text("created_at").notNull().default(now()),
});
```

| ヘルパー  | 目的                                                               |
| --------- | ------------------------------------------------------------------ |
| `table`   | テーブルを定義します — `pgTable` または `sqliteTable` に委任します |
| `text`    | テキスト列、`{ enum: [...] }` をサポート                           |
| `integer` | 整数列、`{ mode: "boolean" }` は Postgres ブール値にマップされます |
| `real`    | 浮動列 — SQLite の `real`、Postgres の `double precision`          |
| `now`     | `.default(now())` の方言に依存しない現在のタイムスタンプ           |

上記の `tasks` テーブルは、すべてのバックエンドで同じ列を定義します。

```an-schema title="タスクテーブル" summary="Defined once with the framework helpers; the dialect is chosen at runtime from DATABASE_URL."
{
  "entities": [
    {
      "id": "tasks",
      "name": "tasks",
      "note": "Domain table. Add owner_email (or ...ownableColumns()) so SQL-level scoping can filter rows to the authenticated user.",
      "fields": [
        { "name": "id", "type": "text", "pk": true, "nullable": false },
        { "name": "title", "type": "text", "nullable": false },
        { "name": "priority", "type": "integer", "nullable": false, "note": "default 0" },
        { "name": "weight", "type": "real", "nullable": true },
        { "name": "done", "type": "integer (boolean mode)", "nullable": false, "note": "default false; maps to a Postgres boolean" },
        { "name": "owner_email", "type": "text", "nullable": false, "note": "enables data scoping" },
        { "name": "created_at", "type": "text", "nullable": false, "note": "default now()" }
      ]
    }
  ]
}
```

`drizzle-orm/sqlite-core` または `drizzle-orm/pg-core` から直接インポートしないでください。常に `@agent-native/core/db/schema` を使用してください。

ユーザー向けデータを保存するテーブルには、フレームワークの SQL レベルのスコープで行を認証されたユーザーにフィルターできるように、`owner_email` 列が含まれている必要があります。[Security](/docs/security#data-scoping) を参照してください。他のユーザーまたは組織との共有もサポートするテーブルでは、代わりに `...ownableColumns()` を分散する必要があります。これにより、1 回の呼び出しで `owner_email`、`org_id`、および `visibility` が追加されます。「[Sharing](/docs/sharing#building)」を参照してください。

読み取りと書き込みには、Drizzle のクエリ ビルダーと `drizzle-orm` のポータブル オペレーターを使用します。

```ts
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../server/db/index.js";
import { tasks } from "../server/db/schema.js";

const db = getDb();

const openTasks = await db
  .select()
  .from(tasks)
  .where(and(eq(tasks.ownerEmail, userEmail), eq(tasks.done, false)))
  .orderBy(desc(tasks.createdAt));

await db.update(tasks).set({ done: true }).where(eq(tasks.id, taskId));
```

## 生の SQL 脱出ハッチ {#raw-sql}

生の SQL は、デフォルトのアプリコード API ではありません。追加的な移行、ヘルスチェック、Drizzle では表現できない慎重にレビューされた高度なクエリ、または 1 回限りのメンテナンスの場合にのみ使用してください。パラメータ化され、方言に依存しないようにしてください。 Drizzle スキーマのタイムスタンプの場合は、`.default(now())` を優先します。 SQL の移行の場合は、`runMigrations()` を使用して、フレームワークでサポートされる互換性の書き換えと方言ゲートされたステートメントが一元化された状態を維持できるようにします。

Drizzle クエリ以外の生の SQL が本当に必要な場合:

- `getDbExec()` — Postgres の `?` パラメータを `$1` に自動変換します
- `isPostgres()` — ランタイム方言チェック
- `intType()` — 現在の方言の正しい整数型を返します

## 移行とスキーマの更新 {#migrations}

ホスト環境では、複数の展開プレビュー、ブランチ、実稼働サーバーが同じ基盤データベースを共有します。したがって、データベース スキーマの更新は、データ損失やサービスの中断を避けるために厳格な制約に従う必要があります。

### 「破壊的変更ゼロ」ルール

すべてのデータベース スキーマの更新は **厳密に追加的**である必要があります。

- **テーブルや列は削除しないでください。**
- **テーブルまたは列の名前を変更しないでください。** 列またはテーブルの名前を変更すると、Drizzle へのドロップと作成のシーケンスのように見えます。これにより、既存の実稼働データが完全に削除されます。
- 列の名前を変更または置換する必要がある場合は、古い列の横に新しい列を追加し、両方から読み取り/書き込みできるようにアプリケーション コードを更新し、データを移行し、アクティブなデプロイメントがその列を参照しなくなった場合にのみ、後のリリースで古い列を廃止します。

> [!WARNING]
> **運用データベースに対して `drizzle-kit push` を実行しないでください。**
> テンプレート データベース スキーマは、アプリ固有のドメイン テーブルのみを定義します。中央フレームワーク テーブル (`user`、`session`、`application_state` など) は定義されません。実稼働環境に対して `drizzle-kit push` を実行すると、Drizzle はこれらのフレームワーク テーブルを「スキーマにない」ものとして検出し、削除しようとします。これにより、ただちにシステム全体の障害が発生し、データが失われます。

### 安全な移行パス

スキーマの変更は、直接プッシュするのではなく、アプリケーションの起動時に実行される SQL 移行を介して適用する必要があります。フレームワークの `runMigrations()` ヘルパーを呼び出して、サーバー プラグイン (`server/plugins/db.ts` など) 内で追加の移行を実装します。

```an-annotated-code title="追加的な移行プラグイン"
{
  "filename": "server/plugins/db.ts",
  "language": "ts",
  "code": "import { runMigrations } from \"@agent-native/core/db\";\n\nexport default runMigrations(\n  [\n    {\n      version: 1,\n      sql: `ALTER TABLE projects ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0`,\n    },\n    {\n      // Dialect-gated: runs only on the matching backend. Omit the other key\n      // to make it a no-op on that dialect.\n      version: 2,\n      sql: {\n        postgres: `ALTER TABLE projects ADD COLUMN IF NOT EXISTS tsv tsvector`,\n        sqlite: `SELECT 1`, // no-op; tsvector is Postgres-only\n      },\n    },\n  ],\n  { table: \"my_app_migrations\" },\n);",
  "annotations": [
    { "lines": "6-7", "label": "添加剤のみ", "note": "`ADD COLUMN IF NOT EXISTS` は安全に再実行でき、データがドロップされることはありません。名前の変更は、drop+create から Drizzle に似ているため、代わりに追加してから移行します。" },
    { "lines": "13-16", "label": "方言ゲート", "note": "Pass an object keyed by dialect to run different SQL per backend. Make the other key a no-op (`SELECT 1`) for Postgres-only or SQLite-only features." },
    { "lines": "19", "label": "アプリごとのバージョン表", "note": "各アプリは適用された独自のバージョンを追跡するため、移行は再起動とインスタンス間で冪等になります。" }
  ]
}
```

## 環境変数 {#environment-variables}

| 変数                  | 目的                                                                         |
| --------------------- | ---------------------------------------------------------------------------- |
| `DATABASE_URL`        | 永続的な SQL 接続文字列 (未設定 = ローカル SQLite、ローカル開発でのみ永続的) |
| `DATABASE_AUTH_TOKEN` | 別のトークンを必要とするプロバイダー用の認証トークン (Turso/libSQL など)     |
