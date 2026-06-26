---
title: "数据库"
description: "将便携式 SQL 数据库连接到您的代理本机应用，并编写与提供商无关的 Drizzle 代码。"
---

# 数据库

代理本机应用程序使用 [Drizzle ORM](https://orm.drizzle.team) 并支持便携式 SQL 后端。对于本地开发之外的任何内容，请通过设置 `DATABASE_URL` 连接持久性 SQL 数据库 - Postgres、libSQL/Turso 或另一个 Drizzle 兼容后端。取消设置该变量后，应用程序将回退到零配置本地 SQLite 文件，以便您可以立即开始开发。

```an-diagram title="一个模式，多个后端" summary="应用程序代码使用框架的与方言无关的帮助程序。运行时从 DATABASE_URL 自动检测方言； unset 表示本地 SQLite 文件。"
{
  "html": "<div class=\"diagram-db\"><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">@agent-native/core/db/schema</span><small class=\"diagram-muted\">table · text · integer · real · now</small><small class=\"diagram-muted\">+ Drizzle query DSL</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>DATABASE_URL<br><small class=\"diagram-muted\">dialect auto-detected</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-grid\"><span class=\"diagram-pill\">Postgres<br><small class=\"diagram-muted\">Neon · Supabase</small></span><span class=\"diagram-pill\">libSQL / Turso</span><span class=\"diagram-pill\">Cloudflare D1</span><span class=\"diagram-pill warn\">SQLite file<br><small class=\"diagram-muted\">unset = local dev only</small></span></div></div>",
  "css": ".diagram-db{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-db .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px 16px}.diagram-db .diagram-arrow{font-size:22px;line-height:1}.diagram-db .diagram-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}"
}
```

## 本地默认：SQLite 文件 {#default-sqlite}

当未设置 `DATABASE_URL` 时，应用程序会在 `data/app.db` 处创建 SQLite 数据库。这是本地开发的零配置默认设置 - 无需设置。它仅用于开发；对于生产，将 `DATABASE_URL` 设置为持久 SQL 数据库。

不要依赖该本地文件来部署应用程序。容器、无服务器功能和预览环境可能会重置其文件系统，这意味着本地 SQLite 文件可能会在重新启动之间消失。在生产使用之前将 `DATABASE_URL` 设置为持久托管数据库。

## 连接生产数据库 {#production}

在 `.env` 文件或部署提供程序环境中设置 `DATABASE_URL` 以连接托管数据库。图尔索不是必需的；使用适合您的部署的与 Drizzle 兼容的 SQL 后端：

```bash
# Neon 托管的 Postgres 数据库
DATABASE_URL=postgres://user:pass@ep-cool-name-123456.us-east-2.aws.neon.tech/mydb?sslmode=require

# Supabase 托管的 Postgres 数据库
DATABASE_URL=postgres://postgres.xxxx:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres

# 普通 Postgres 数据库
DATABASE_URL=postgres://user:pass@localhost:5432/mydb

# Turso (libSQL)
DATABASE_URL=libsql://my-db-org.turso.io
DATABASE_AUTH_TOKEN=your-token
```

框架自动检测 URL 的方言并相应地配置 Drizzle。内置适配器涵盖 Postgres URL、libSQL/Turso URL、SQLite 文件 URL 和 Cloudflare D1 绑定。常见的生产选择包括 Neon、Supabase、Turso/libSQL、普通 Postgres、持久 SQLite 和 Builder.io 托管环境（如果可用）。

## Builder.io托管数据库 {#builder-managed}

*计划（尚不可用）：*连接到 Builder.io 时，您的应用将能够使用自动配置的托管数据库，无需连接字符串。

## 数据库客户端所在的位置 {#db-client}

每个模板通过从 `@agent-native/core/db` 调用 `createGetDb(schema)` 来创建一个惰性的单例 Drizzle 客户端。规范位置是 `server/db/index.ts`：

```ts
// server/db/index.ts
import { createGetDb } from "@agent-native/core/db";
import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
```

从此模板本地路径导入 `getDb` - 路由中的 `../../server/db/index.js`，actions 中的 `../server/db/index.js` - 而不是直接从 `@agent-native/core` 导入。核心导出返回一个通用的无类型实例；模板的 `getDb()` 包含您的架构类型。请参阅 [Server](/docs/server#request-context) 了解 actions 和自定义路由如何导入它。

## 与方言无关的架构和查询 {#schema}

应用程序数据库代码应使用 Drizzle 的架构并查询 DSL，以便它可以跨提供程序运行。切勿在产品代码中编写仅 SQLite 语法（`INSERT OR REPLACE`、`AUTOINCREMENT`、`datetime('now')`）或仅 Postgres 语法。

使用 `@agent-native/core/db/schema` 中的框架架构助手：

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

| 帮手      | 目的                                                          |
| --------- | ------------------------------------------------------------- |
| `table`   | 定义一个表——委托给`pgTable`或`sqliteTable`                    |
| `text`    | 文本栏，支持`{ enum: [...] }`                                 |
| `integer` | 整数列，`{ mode: "boolean" }` 映射到 Postgres 布尔值          |
| `real`    | 浮动列 - SQLite 上的 `real`、Postgres 上的 `double precision` |
| `now`     | `.default(now())` 与方言无关的当前时间戳                      |

上面的 `tasks` 表在每个后端定义了相同的列：

```an-schema title="任务表" summary="Defined once with the framework helpers; the dialect is chosen at runtime from DATABASE_URL."
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

切勿直接从 `drizzle-orm/sqlite-core` 或 `drizzle-orm/pg-core` 导入。始终使用 `@agent-native/core/db/schema`。

存储面向用户的数据的表必须包含 `owner_email` 列，以便框架的 SQL 级别范围可以筛选经过身份验证的用户的行 - 请参阅 [Security](/docs/security#data-scoping)。还支持与其他用户或组织共享的表应改为传播 `...ownableColumns()`，这会在一次调用中添加 `owner_email`、`org_id` 和 `visibility` — 请参阅 [Sharing](/docs/sharing#building)。

对于读取和写入，请使用 Drizzle 的查询生成器和 `drizzle-orm` 中的可移植运算符：

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

## 原始 SQL 逃生舱口 {#raw-sql}

原始 SQL 不是默认的应用代码 API。仅将其用于附加迁移、运行状况检查、仔细审查 Drizzle 无法表达的高级查询或一次性维护。保持参数化且与方言无关。对于 Drizzle 模式中的时间戳，优先选择 `.default(now())`；对于迁移 SQL，请使用 `runMigrations()`，以便框架支持的兼容性重写和方言门控语句保持集中。

对于您确实需要 Drizzle 查询之外的原始 SQL 的情况：

- `getDbExec()` — 将 `?` 参数自动转换为 Postgres 的 `$1`
- `isPostgres()` — 运行时方言检查
- `intType()` — 返回当前方言的正确整数类型

## 迁移和架构更新 {#migrations}

在托管环境中，多个部署预览、分支和生产服务器共享相同的底层数据库。因此，数据库架构更新必须遵循严格的约束，以避免数据丢失和服务中断。

### “零破坏性改变”规则

所有数据库架构更新都必须**严格附加**。

- **不要删除表或列。**
- **不要重命名表或列。**重命名列或表看起来像是 Drizzle 的 drop + create 序列，这将永久删除您现有的生产数据。
- 如果需要重命名或替换某一列，请在旧列旁边添加新列，更新应用程序代码以读取/写入两者，迁移数据，并且仅在没有活动部署引用旧列时才在后续版本中停用旧列。

> [!WARNING]
> **切勿针对生产数据库运行 `drizzle-kit push`。**
> 模板数据库模式仅定义特定于应用程序的域表；它们没有定义中央框架表（`user`、`session`、`application_state` 等）。如果您在生产环境中运行 `drizzle-kit push`，Drizzle 会将这些框架表检测为“不在架构中”并尝试删除它们，从而立即导致系统范围内的故障和数据丢失。

### 安全迁移路径

不应直接推送，而应通过在应用程序启动时执行的 SQL 迁移来应用架构更改。通过调用框架的 `runMigrations()` 帮助程序，在服务器插件（例如 `server/plugins/db.ts`）中实现附加迁移：

```an-annotated-code title="附加迁移插件"
{
  "filename": "server/plugins/db.ts",
  "language": "ts",
  "code": "import { runMigrations } from \"@agent-native/core/db\";\n\nexport default runMigrations(\n  [\n    {\n      version: 1,\n      sql: `ALTER TABLE projects ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0`,\n    },\n    {\n      // Dialect-gated: runs only on the matching backend. Omit the other key\n      // to make it a no-op on that dialect.\n      version: 2,\n      sql: {\n        postgres: `ALTER TABLE projects ADD COLUMN IF NOT EXISTS tsv tsvector`,\n        sqlite: `SELECT 1`, // no-op; tsvector is Postgres-only\n      },\n    },\n  ],\n  { table: \"my_app_migrations\" },\n);",
  "annotations": [
    { "lines": "6-7", "label": "仅添加剂", "note": "`ADD COLUMN IF NOT EXISTS` 可以安全地重新运行并且永远不会丢失数据。重命名看起来像 drop+create 为 Drizzle，所以改为添加然后迁移。" },
    { "lines": "13-16", "label": "方言门控", "note": "Pass an object keyed by dialect to run different SQL per backend. Make the other key a no-op (`SELECT 1`) for Postgres-only or SQLite-only features." },
    { "lines": "19", "label": "每个应用程序版本表", "note": "每个应用程序都会跟踪自己的应用版本，因此迁移在重新启动和实例之间是幂等的。" }
  ]
}
```

## 环境变量 {#environment-variables}

| 变量                  | 目的                                                       |
| --------------------- | ---------------------------------------------------------- |
| `DATABASE_URL`        | 持久化SQL连接字符串（未设置=本地SQLite，仅对本地开发持久） |
| `DATABASE_AUTH_TOKEN` | 需要单独令牌的提供商的身份验证令牌，例如 Turso/libSQL      |
