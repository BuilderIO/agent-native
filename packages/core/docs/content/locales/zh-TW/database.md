---
title: "資料庫"
description: "將便攜式 SQL 資料庫連線到您的 Agent-Native 應用，並編寫與提供者無關的 Drizzle 程式碼。"
---

# 資料庫

Agent-Native 應用程式使用 [Drizzle ORM](https://orm.drizzle.team) 並支援便攜式 SQL 後端。對於本機開發之外的任何內容，請透過設定 `DATABASE_URL` 連線持久性 SQL 資料庫 - Postgres、libSQL/Turso 或另一個 Drizzle 相容後端。取消設定該變數後，應用程式將回退到零設定本機 SQLite 檔案，以便您可以立即開始開發。

```an-diagram title="一個模式，多個後端" summary="應用程式的程式碼使用框架的與方言無關的幫助程式。執行時從 DATABASE_URL 自動偵測方言； 未設定表示本機 SQLite 檔案。"
{
  "html": "<div class=\"diagram-db\"><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">@agent-native/core/db/schema</span><small class=\"diagram-muted\">table · text · integer · real · now</small><small class=\"diagram-muted\">+ Drizzle query DSL</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>DATABASE_URL<br><small class=\"diagram-muted\">dialect auto-detected</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-grid\"><span class=\"diagram-pill\">Postgres<br><small class=\"diagram-muted\">Neon · Supabase</small></span><span class=\"diagram-pill\">libSQL / Turso</span><span class=\"diagram-pill\">Cloudflare D1</span><span class=\"diagram-pill warn\">SQLite file<br><small class=\"diagram-muted\">unset = local dev only</small></span></div></div>",
  "css": ".diagram-db{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-db .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px 16px}.diagram-db .diagram-arrow{font-size:22px;line-height:1}.diagram-db .diagram-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}"
}
```

## 本機預設：SQLite 檔案 {#default-sqlite}

當未設定 `DATABASE_URL` 時，應用程式會在 `data/app.db` 處建立 SQLite 資料庫。這是本機開發的零設定預設設定 - 無需設定。它僅用於開發；對於正式環境，將 `DATABASE_URL` 設定為持久 SQL 資料庫。

不要依賴該本機檔案來部署應用程式。容器、無伺服器功能和預覽環境可能會重設其檔案系統，這意味著本機 SQLite 檔案可能會在重新啟動之間消失。在正式環境使用之前將 `DATABASE_URL` 設定為持久託管資料庫。

## 連線正式環境資料庫 {#production}

在 `.env` 檔案或部署提供者環境中設定 `DATABASE_URL` 以連線託管資料庫。圖爾索不是必需的；使用適合您的部署的與 Drizzle 相容的 SQL 後端：

```bash
# Neon 託管的 Postgres 資料庫
DATABASE_URL=postgres://user:pass@ep-cool-name-123456.us-east-2.aws.neon.tech/mydb?sslmode=require

# Supabase 託管的 Postgres 資料庫
DATABASE_URL=postgres://postgres.xxxx:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres

# 普通 Postgres 資料庫
DATABASE_URL=postgres://user:pass@localhost:5432/mydb

# Turso (libSQL)
DATABASE_URL=libsql://my-db-org.turso.io
DATABASE_AUTH_TOKEN=your-token
```

框架自動偵測 URL 的方言並相應地設定 Drizzle。內建轉接器涵蓋 Postgres URL、libSQL/Turso URL、SQLite 檔案 URL 和 Cloudflare D1 綁定。常見的正式環境選取包括 Neon、Supabase、Turso/libSQL、普通 Postgres、持久 SQLite 和 Builder.io 託管環境（如果可用）。

## Builder.io 託管資料庫 {#builder-managed}

*計畫（尚不可用）：*連線到 Builder.io 時，您的應用將能夠使用自動設定的託管資料庫，無需連線字串。

## 資料庫用戶端所在的位置 {#db-client}

每個範本透過從 `@agent-native/core/db` 呼叫 `createGetDb(schema)` 來建立一個惰性的單例 Drizzle 用戶端。規範位置是 `server/db/index.ts`：

```ts
// server/db/index.ts
import { createGetDb } from "@agent-native/core/db";
import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
```

從此範本本機路徑匯入 `getDb` - 路由中的 `../../server/db/index.js`，actions 中的 `../server/db/index.js` - 而不是直接從 `@agent-native/core` 匯入。核心匯出返回一個通用的無型別執行個體；範本的 `getDb()` 包含您的架構型別。請參閱 [Server](/docs/server#request-context) 了解 actions 和自訂路由如何匯入它。

## 與方言無關的架構和查詢 {#schema}

應用程式資料庫程式碼應使用 Drizzle 的架構並查詢 DSL，以便它可以跨提供者執行。切勿在產品程式碼中編寫僅 SQLite 語法（`INSERT OR REPLACE`、`AUTOINCREMENT`、`datetime('now')`）或僅 Postgres 語法。

使用 `@agent-native/core/db/schema` 中的框架架構助手：

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

| 幫手      | 目的                                                          |
| --------- | ------------------------------------------------------------- |
| `table`   | 定義一個表——委托給`pgTable`或`sqliteTable`                    |
| `text`    | 文字欄，支援`{ enum: [...] }`                                 |
| `integer` | 整數列，`{ mode: "boolean" }` 對應到 Postgres 布爾值          |
| `real`    | 浮動列 - SQLite 上的 `real`、Postgres 上的 `double precision` |
| `now`     | `.default(now())` 與方言無關的目前時間戳                      |

上面的 `tasks` 表在每個後端定義了相同的列：

```an-schema title="工作表" summary="Defined once with the framework helpers; the dialect is chosen at runtime from DATABASE_URL."
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

切勿直接從 `drizzle-orm/sqlite-core` 或 `drizzle-orm/pg-core` 匯入。始終使用 `@agent-native/core/db/schema`。

儲存面向使用者的資料的表必須包含 `owner_email` 列，以便框架的 SQL 層級範圍可以篩選經過驗證的使用者的行 - 請參閱 [Security](/docs/security#data-scoping)。還支援與其他使用者或組織共用的表應改為傳播 `...ownableColumns()`，這會在一次呼叫中新增 `owner_email`、`org_id` 和 `visibility` — 請參閱 [Sharing](/docs/sharing#building)。

對於讀取和寫入，請使用 Drizzle 的查詢生成器和 `drizzle-orm` 中的可移植運算符：

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

## 原始 SQL 逃生艙口 {#raw-sql}

原始 SQL 不是預設的應用程式碼 API。僅將其用於附加遷移、執行狀況檢查、仔細審查 Drizzle 無法表達的進階查詢或一次性維護。保持參數化且與方言無關。對於 Drizzle 模式中的時間戳，優先選取 `.default(now())`；對於遷移 SQL，請使用 `runMigrations()`，以便框架支援的相容性重寫和方言門控語句保持集中。

對於您確實需要 Drizzle 查詢之外的原始 SQL 的情況：

- `getDbExec()` — 將 `?` 參數自動轉換為 Postgres 的 `$1`
- `isPostgres()` — 執行時方言檢查
- `intType()` — 返回目前方言的正確整數型別

## 遷移和架構更新 {#migrations}

在託管環境中，多個部署預覽、分支和正式環境伺服器共用相同的底層資料庫。因此，資料庫架構更新必須遵循嚴格的約束，以避免資料丟失和服務中斷。

### “零破壞性改變”規則

所有資料庫架構更新都必須**嚴格附加**。

- **不要刪除表或列。**
- **不要重新命名表或列。**重新命名列或表看起來像是 Drizzle 的 drop + create 序列，這將永久刪除您現有的正式環境資料。
- 如果需要重新命名或替換某一列，請在舊列旁邊新增新列，更新應用程式的程式碼以讀取/寫入兩者，遷移資料，並且僅在沒有活動部署引用舊列時才在後續版本中停用舊列。

> [!WARNING]
> **切勿針對正式環境資料庫執行 `drizzle-kit push`。**
> 範本資料庫模式僅定義特定於應用程式的域表；它們沒有定義中央框架表（`user`、`session`、`application_state` 等）。如果您在正式環境環境中執行 `drizzle-kit push`，Drizzle 會將這些框架表偵測為“不在架構中”並嘗試刪除它們，從而立即導致系統範圍內的故障和資料丟失。

### 安全遷移路徑

不應直接推送，而應透過在應用程式啟動時執行的 SQL 遷移來應用架構更改。透過呼叫框架的 `runMigrations()` 幫助程式，在伺服器外掛（例如 `server/plugins/db.ts`）中實現附加遷移：

```an-annotated-code title="附加遷移外掛"
{
  "filename": "server/plugins/db.ts",
  "language": "ts",
  "code": "import { runMigrations } from \"@agent-native/core/db\";\n\nexport default runMigrations(\n  [\n    {\n      version: 1,\n      sql: `ALTER TABLE projects ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0`,\n    },\n    {\n      // Dialect-gated: runs only on the matching backend. Omit the other key\n      // to make it a no-op on that dialect.\n      version: 2,\n      sql: {\n        postgres: `ALTER TABLE projects ADD COLUMN IF NOT EXISTS tsv tsvector`,\n        sqlite: `SELECT 1`, // no-op; tsvector is Postgres-only\n      },\n    },\n  ],\n  { table: \"my_app_migrations\" },\n);",
  "annotations": [
    { "lines": "6-7", "label": "僅新增劑", "note": "`ADD COLUMN IF NOT EXISTS` 可以安全地重新執行並且永遠不會丟失資料。重新命名看起來像 drop+create 為 Drizzle，所以改為新增然後遷移。" },
    { "lines": "13-16", "label": "方言門控", "note": "Pass an object keyed by dialect to run different SQL per backend. Make the other key a no-op (`SELECT 1`) for Postgres-only or SQLite-only features." },
    { "lines": "19", "label": "每個應用程式版本表", "note": "每個應用程式都會跟蹤自己的應用版本，因此遷移在重新啟動和執行個體之間是冪等的。" }
  ]
}
```

## 環境變數 {#environment-variables}

| 變數                  | 目的                                                        |
| --------------------- | ----------------------------------------------------------- |
| `DATABASE_URL`        | 持久化 SQL 連線字串（未設定=本機 SQLite，僅對本機開發持久） |
| `DATABASE_AUTH_TOKEN` | 需要單獨權杖的提供者的驗證權杖，例如 Turso/libSQL           |
