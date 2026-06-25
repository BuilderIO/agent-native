---
title: "服务器"
description: "Nitro 服务器路由、插件、框架安装的路由、请求上下文和 SQL 支持的同步。"
---

# 服务器

代理本机应用程序使用 [Nitro](https://nitro.build) 作为服务器路由和插件。大多数产品行为应该存在于 [Actions](/docs/actions) 中；自定义路由适用于 actions 不适合的协议表面：上传、流式传输、公共页面、webhooks、OAuth 回调和特定于提供商的 API。

```an-diagram title="服务器上运行什么" summary="操作是默认的。自定义文件路由和框架安装的路由共享相同的 Nitro 应用程序和相同的 SQL 数据库。"
{
  "html": "<div class=\"diagram-server\"><div class=\"diagram-col entry\"><div class=\"diagram-node\">浏览器 / UI</div><div class=\"diagram-node\">代理循环</div><div class=\"diagram-node\">外部客户端<br><small class=\"diagram-muted\">HTTP · MCP · A2A</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\" data-rough><strong>Nitro 服务器</strong><div class=\"diagram-row\"><span class=\"diagram-pill accent\">Actions</span><small class=\"diagram-muted\">默认表面</small></div><div class=\"diagram-row\"><span class=\"diagram-pill\">/_agent-native/*</span><small class=\"diagram-muted\">framework routes</small></div><div class=\"diagram-row\"><span class=\"diagram-pill\">/api/*</span><small class=\"diagram-muted\">custom file routes</small></div><div class=\"diagram-row\"><span class=\"diagram-pill\">plugins</span><small class=\"diagram-muted\">启动：迁移、任务</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>SQL 数据库<br><small class=\"diagram-muted\">Drizzle · 协调点</small></div></div>",
  "css": ".diagram-server{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-server .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-server .diagram-panel{display:flex;flex-direction:column;gap:8px;padding:14px 16px}.diagram-server .diagram-row{display:flex;align-items:center;gap:8px}.diagram-server .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 基于文件的路由 {#file-based-routes}

`server/routes/` 和 Nitro 中的路由将文件名映射到方法和路径：

```text
server/routes/
  api/
    health.get.ts              -> GET  /api/health
    uploads.post.ts            -> POST /api/uploads
    webhooks/
      stripe.post.ts           -> POST /api/webhooks/stripe
  [...page].get.ts             -> SSR catch-all for public pages
```

每条路由导出一个`defineEventHandler`：

```ts
// server/routes/api/health.get.ts
import { defineEventHandler } from "h3";

export default defineEventHandler(() => ({
  ok: true,
  service: "my-template",
}));
```

### 路由命名约定 {#route-naming-conventions}

| 文件名模式         | HTTP方法 | 示例路径                  |
| ------------------ | -------- | ------------------------- |
| `index.get.ts`     | GET      | `/api/items`              |
| `index.post.ts`    | POST     | `/api/items`              |
| `[id].get.ts`      | GET      | `/api/items/:id`          |
| `[id].patch.ts`    | PATCH    | `/api/items/:id`          |
| `[id].delete.ts`   | DELETE   | `/api/items/:id`          |
| `[...slug].get.ts` | GET      | `/api/items/*` 或包罗万象 |

## 首选 Actions 进行应用操作 {#actions-first}

如果 UI 和代理都需要执行某些操作，请定义操作而不是自定义 API 路由。 Actions自动变成：

- 代理工具。
- 类型化前端挂钩。
- `/_agent-native/actions/:name`下的HTTP端点。
- MCP 和 A2A 可调用工具。
- CLI 用于开发的命令。

仅当您需要路由型协议或二进制/流行为时才使用自定义 `/api/*` 路由。参见[Actions](/docs/actions)。

## 一次性文本完成 {#complete-text}

大多数人工智能工作应通过代理聊天进行，以便用户可以查看、引导和审核
发生了什么。对于有意不需要的窄服务器端转换
工具、聊天记录或运行状态，使用 `completeText()` 作为显式转义
孵化。

```ts
// actions/classify-message.ts
import { defineAction } from "@agent-native/core/action";
import { completeText } from "@agent-native/core/server";
import { z } from "zod";

export default defineAction({
  description: "Classify a short message",
  schema: z.object({ body: z.string() }),
  run: async ({ body }) => {
    const result = await completeText({
      systemPrompt:
        "Return exactly one label: urgent, follow-up, waiting, or archive.",
      input: body,
      maxOutputTokens: 16,
      temperature: 0,
    });

    return { label: result.text.trim() };
  },
});
```

`completeText()` 通过与代理相同的配置引擎层运行
聊天，包括 Builder、Anthropic、AI SDK 提供商、用户/应用模型默认值，
请求范围的秘密和引擎规范化的错误。它仅适用于服务器；不要
从客户端代码调用模型提供者。如果操作是面向用户的，则将其包装起来
在一个操作中，以便 UI 和代理共享相同的功能。

## 请求上下文和访问 {#request-context}

Actions 由框架自动安装并与请求上下文一起运行。自定义路线则不然。如果自定义路由读取或写入可拥有的资源，则加载会话并包装工作：

```an-annotated-code title="将自定义路由范围限定为请求用户"
{
  "filename": "server/routes/api/projects.get.ts",
  "language": "ts",
  "code": "import { defineEventHandler, createError } from \"h3\";\nimport { getSession, runWithRequestContext } from \"@agent-native/core/server\";\nimport { getDb } from \"../../db/index.js\";\nimport { accessFilter } from \"@agent-native/core/sharing\";\nimport * as schema from \"../../db/schema\";\n\nexport default defineEventHandler(async (event) => {\n  const session = await getSession(event);\n  if (!session?.email) {\n    throw createError({ statusCode: 401, statusMessage: \"Unauthorized\" });\n  }\n\n  return runWithRequestContext(\n    { userEmail: session.email, orgId: session.orgId },\n    async () => {\n      const db = getDb();\n      return db\n        .select()\n        .from(schema.projects)\n        .where(accessFilter(schema.projects, schema.project分享s));\n    },\n  );\n});",
  "annotations": [
    {
      "lines": "7-10",
      "label": "自定义路由没有自动上下文",
      "note": "与操作不同，文件路由必须加载会话本身，并且在没有经过身份验证的用户时无法关闭。"
    },
    {
      "lines": "12-13",
      "label": "建立请求上下文",
      "note": "`runWithRequestContext` 使 user/org 在工作期间可供范围界定助手使用。"
    },
    {
      "lines": "18-19",
      "label": "范围可拥有的读取",
      "note": "`accessFilter` constrains the query to rows the caller may see. Never run an unscoped `db.select().from(ownableTable)` here."
    }
  ]
}
```

`getDb`是通过`server/db/index.ts`中的`createGetDb(schema)`为每个应用程序创建的，因此自定义路由从模板（`../../db/index.js`）导入，而不是从`@agent-native/core/db`导入；见[Database — Where the DB Client Lives](/docs/database#db-client)。不要在自定义路由中运行无作用域的 `db.select().from(ownableTable)`。

## 服务器插件 {#server-plugins}

插件位于 `server/plugins/` 中并在启动时运行。将它们用于迁移、提供程序设置、重复作业、集成适配器和框架插件配置。

```ts
// server/plugins/db.ts
import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      org_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    },
  ],
  { table: "my_app_migrations" },
);
```

迁移必须是累加的。切勿将破坏性的 SQL 放入启动插件中。

## 框架安装路由 {#framework-routes}

框架在`/_agent-native/`下挂载自己的路由。将该命名空间视为保留。

| 路由前缀                         | 目的                                                     |
| -------------------------------- | -------------------------------------------------------- |
| `/_agent-native/actions/:name`   | 操作 HTTP 端点                                           |
| `/_agent-native/agent-chat`      | 代理聊天循环                                             |
| `/_agent-native/poll`            | SQL 支持的 UI 同步                                       |
| `/_agent-native/resources/*`     | 工作区资源                                               |
| `/_agent-native/extensions/*`    | 运行时扩展和扩展代理（旧别名：`/_agent-native/tools/*`） |
| `/_agent-native/integrations/*`  | 消息传递/webhook 集成                                    |
| `/_agent-native/a2a`             | 代理到代理 JSON-RPC                                      |
| `/_agent-native/mcp`             | MCP端点                                                  |
| `/_agent-native/onboarding/*`    | 设置清单                                                 |
| `/_agent-native/observability/*` | 跟踪、反馈、评估、实验                                   |
| `/_agent-native/file-upload`     | 文件上传提供程序端点                                     |

自定义应用路由应使用 `/api/*`、公共应用路径或不与 `/_agent-native/` 冲突的提供商特定回调路径。

## SQL 支持的同步 {#sync}

代理本机不依赖于文件系统观察程序或粘性内存状态。当 actions 或框架助手更改数据时，数据库同步版本会递增。客户端 `useDbSync()` 挂钩轮询 `/_agent-native/poll` 并使 React 查询缓存无效。

这适用于无服务器和多实例部署，因为数据库是协调点。如果您在 actions 之外编写自定义突变，请使用框架助手或发出适当的同步失效，以便打开 UI 刷新。

```an-diagram title="SQL-backed 同步循环" summary="没有观察者，没有粘性状态。写入会碰撞 SQL 中的版本；每个客户端都会轮询版本并重新获取。"
{
  "html": "<div class=\"diagram-sync\"><div class=\"diagram-box\" data-rough>Action / 辅助函数<br><small class=\"diagram-muted\">mutates data</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\" data-rough><strong>SQL 数据库</strong><small class=\"diagram-muted\">sync version increments</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&larr;</div><div class=\"diagram-col\"><div class=\"diagram-node\">useDbSync()<br><small class=\"diagram-muted\">polls /_agent-native/poll</small></div><div class=\"diagram-pill ok\">invalidate caches &rarr; UI refreshes</div></div></div>",
  "css": ".diagram-sync{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-sync .diagram-col{display:flex;flex-direction:column;gap:8px;align-items:flex-start}.diagram-sync .diagram-arrow{font-size:22px;line-height:1}"
}
```

```an-api title="轮询端点" method="GET" path="/_agent-native/poll"
{
  "method": "GET",
  "path": "/_agent-native/poll",
  "summary": "返回当前的每个源数据库同步版本，以便客户端可以检测更改。",
  "description": "`useDbSync()` calls this on an interval (and falls back to it when SSE is unavailable). When a returned version is higher than the client's last-seen value, the matching React Query caches are invalidated and refetch.",
  "auth": "Session cookie (request-scoped identity)",
  "responses": [
    { "status": "200", "description": "Current sync versions keyed by source." }
  ]
}
```

## Webhooks {#webhooks}

入站 webhooks 应验证、保留并快速返回。长时间运行的代理工作应使用集成队列模式：

1. 验证平台签名或质询。
2. 将持久工作插入SQL。
3. 自触发签名的处理器路由。
4. 立即返回 200。
5. 让新的处理器执行运行代理循环并发布结果。

```an-diagram title="集成队列模式" summary="Webhook 处理程序以毫秒为单位返回；单独的签名执行运行缓慢的代理工作。"
{
  "html": "<div class=\"diagram-webhook\"><div class=\"diagram-box\" data-rough>入站 webhook<br><small class=\"diagram-muted\">Slack · Stripe · email</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\" data-rough><strong>Handler</strong><div class=\"diagram-step\"><span class=\"diagram-pill\">1</span><small class=\"diagram-muted\">verify signature</small></div><div class=\"diagram-step\"><span class=\"diagram-pill\">2</span><small class=\"diagram-muted\">将工作写入 SQL</small></div><div class=\"diagram-step\"><span class=\"diagram-pill\">3</span><small class=\"diagram-muted\">self-fire processor</small></div><div class=\"diagram-step\"><span class=\"diagram-pill ok\">4</span><small class=\"diagram-muted\">return 200 now</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Signed processor<br><small class=\"diagram-muted\">运行代理循环并发布结果</small></div></div>",
  "css": ".diagram-webhook{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-webhook .diagram-panel{display:flex;flex-direction:column;gap:6px;padding:14px 16px}.diagram-webhook .diagram-step{display:flex;align-items:center;gap:8px}.diagram-webhook .diagram-arrow{font-size:22px;line-height:1}"
}
```

> [!WARNING]
> 不要依赖返回响应后未等待的承诺 — 无服务器主机会冻结执行。请参阅 [Messaging](/docs/messaging) 以了解规范集成队列。

## 高级：逃生舱口 {#advanced-escape-hatches}

大多数模板永远不需要这些。 Nitro 文件路由和框架的代理
聊天插件已经连接应用服务器和生产代理处理程序。
仅在外部构建自定义服务器集成时才使用它们
标准模板插件堆栈。

### 编程式 H3 服务器 {#create-server}

对于直接需要 H3 应用的自定义包或测试，`createServer()`
返回预配置的应用程序和路由器：

```ts
import { createServer } from "@agent-native/core/server";
import { defineEventHandler } from "h3";

const { app, router } = createServer();

router.get(
  "/api/health",
  defineEventHandler(() => ({ ok: true })),
);
```

### 生产代理处理程序 {#agent-handler}

框架的代理聊天插件已安装生产代理处理程序
用于模板。仅在构建时直接调用`createProductionAgentHandler()`
标准模板插件堆栈之外的自定义服务器集成 -
否则通过`AGENTS.md`、skills、actions和
代理聊天插件。

```ts
import { createProductionAgentHandler } from "@agent-native/core/server";

const handler = createProductionAgentHandler({
  scripts,
  systemPrompt: "You are the app agent...",
});
```
