---
title: "部署"
description: "将代理原生应用部署到具有 Nitro 预设的任何平台 - Node.js、Vercel、Netlify、Cloudflare、AWS 等。"
---

# 部署

代理本机应用程序在底层使用 [Nitro](https://nitro.build)，这意味着您可以部署到任何平台，无需进行零配置更改 - 只需设置预设即可。

## 部署之前：选择持久数据库 {#persistent-database}

每个部署的应用程序都需要一个持久的 SQL 数据库。在本地开发中，agent-native 回退到 `data/app.db` 处的 SQLite 文件；这在您的计算机上很方便，但在可以重置文件系统的容器、预览或无服务器环境中并不持久。

在将应用推广到生产环境之前，在部署提供程序中设置 `DATABASE_URL`。 Agent-native 使用 Drizzle 进行架构和查询，因此数据层可跨 Drizzle 兼容的 SQL 后端移植，并且框架会自动检测 URL 的方言。有关适配器列表和方言详细信息，请参阅 [Database](/docs/database#production)。

仅当您的数据库提供程序需要单独的令牌（例如 Turso/libSQL）时才使用 `DATABASE_AUTH_TOKEN`。对于工作区，所有应用默认继承根`DATABASE_URL`；当一个应用程序应使用不同的数据库时设置 `<APP_NAME>_DATABASE_URL`。

## 工作区部署：一个源，多个应用 {#workspace-deploy}

如果您的项目是 [workspace](/docs/multi-app-workspace)，您可以使用一个命令将其中的每个应用程序发送到单个源：

```bash
npx @agent-native/core@latest deploy
# https://your-agents.com/mail/*       → apps/mail
# https://your-agents.com/calendar/*   → apps/calendar
# https://your-agents.com/forms/*      → apps/forms
```

每个应用程序均使用 `APP_BASE_PATH=/<name>` 和 `VITE_APP_BASE_PATH=/<name>` 构建，然后打包为目标 Nitro 预设。 Cloudflare Pages 是默认预设，并使用 `dist/_worker.js` 生成的调度程序工作人员； Netlify 在 `.netlify/functions-internal/<app>-server` 中为每个应用程序使用一个函数以及生成的重定向； Vercel 使用构建输出 API 编写工作区级 `.vercel/output`。

```an-diagram title="一个来源，多个应用程序" summary="每个工作区应用程序都使用自己的基本路径构建，并安装在单个源的路径前缀下 - 因此登录和跨应用程序 A2A 是同源且免费的。"
{
  "html": "<div class=\"diagram-ws\"><div class=\"diagram-panel\" data-rough><strong>https://your-agents.com</strong><div class=\"diagram-row\"><span class=\"diagram-pill accent\">/mail/*</span><small class=\"diagram-muted\">apps/mail</small></div><div class=\"diagram-row\"><span class=\"diagram-pill accent\">/calendar/*</span><small class=\"diagram-muted\">apps/calendar</small></div><div class=\"diagram-row\"><span class=\"diagram-pill accent\">/forms/*</span><small class=\"diagram-muted\">apps/forms</small></div></div><div class=\"diagram-col wins\"><span class=\"diagram-pill ok\">shared login session</span><span class=\"diagram-pill ok\">跨应用 A2A 零配置</span></div></div>",
  "css": ".diagram-ws{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.diagram-ws .diagram-panel{display:flex;flex-direction:column;gap:6px;padding:14px 16px}.diagram-ws .diagram-row{display:flex;align-items:center;gap:8px}.diagram-ws .wins{display:flex;flex-direction:column;gap:8px;align-items:flex-start}"
}
```

同源部署免费为您带来两大胜利：

- **共享登录会话** — 登录任何应用程序，每个应用程序都会登录。
- **零配置跨应用程序 A2A** — 从邮件中标记 `@calendar` 是同源获取；兄弟姐妹之间没有 CORS、JWT 签名。

发布输出：

```bash
wrangler pages deploy dist
```

对于 Netlify 统一部署，请使用 Netlify 预设：

```bash
npx @agent-native/core@latest deploy --preset netlify
```

对于 Vercel 统一部署，请使用 Vercel 预设：

```bash
npx @agent-native/core@latest deploy --preset vercel
```

配置提供程序构建命令时，请使用与 `--build-only` 相同的命令。 Vercel 应运行 `npx @agent-native/core@latest deploy --preset vercel --build-only`；该命令直接写入 `.vercel/output`，因此工作区路由不需要 `vercel.json`。

托管工作区构建需要部署提供程序环境中的 `A2A_SECRET`。
这使得 Slack、入站 webhooks 和跨应用 A2A 通过签名恢复工作
后台处理器。本地 `--build-only` 工件检查在没有它的情况下仍然可以运行。

仍然支持每个应用程序独立部署 - 只是 `cd apps/<name> && npx @agent-native/core@latest build` 就像独立的脚手架。

## 它是如何工作的 {#how-it-works}

当您运行`npx @agent-native/core@latest build`时，Nitro将客户端SPA和服务器API构建为`.output/`：

```an-file-tree title="构建输出"
{
  "entries": [
    { "path": ".output/", "note": "自包含：复制到任何环境即可运行" },
    { "path": ".output/public/", "note": "构建后的 SPA（静态 assets）" },
    { "path": ".output/server/index.mjs", "note": "服务器入口点" },
    { "path": ".output/server/chunks/", "note": "服务器代码 chunks" }
  ]
}
```

输出是独立的 - 将 `.output/` 复制到任何环境并运行它。

```an-diagram title="构建部署" summary="一棵源树构建为 Nitro 预设；相同的独立输出在 Node、Vercel、Netlify、Cloudflare、AWS 或 Deno 上运行。每个实例都指向同一个持久的 DATABASE_URL。"
{
  "html": "<div class=\"diagram-deploy\"><div class=\"diagram-box\" data-rough>应用源码</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">build</span><small class=\"diagram-muted\">Nitro preset</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-grid\"><span class=\"diagram-pill\">Node.js</span><span class=\"diagram-pill\">Vercel</span><span class=\"diagram-pill\">Netlify</span><span class=\"diagram-pill\">Cloudflare</span><span class=\"diagram-pill\">AWS Lambda</span><span class=\"diagram-pill\">Deno</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>持久 DATABASE_URL<br><small class=\"diagram-muted\">shared by every instance</small></div></div>",
  "css": ".diagram-deploy{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-deploy .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px 16px}.diagram-deploy .diagram-arrow{font-size:22px;line-height:1}.diagram-deploy .diagram-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}"
}
```

## 设置预设 {#setting-the-preset}

默认情况下，Nitro 为 Node.js 构建。要针对不同的平台，请在 `vite.config.ts` 中设置预设：

```ts
import { agentNative } from "@agent-native/core/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [agentNative({ nitro: { preset: "vercel" } })],
});
```

或者在构建时使用 `NITRO_PRESET` 环境变量：

```bash
NITRO_PRESET=netlify npx @agent-native/core@latest build
```

## Node.js（默认） {#nodejs}

默认预设。构建并运行：

```bash
npx @agent-native/core@latest build
node .output/server/index.mjs
```

设置`PORT`配置监听端口（默认：`3000`）。

使用当前的 Node.js LTS 系列进行生产部署。截至 2026 年 5 月，
是Node.js 24； Node.js 20 已于 2026 年 4 月 30 日达到使用寿命，不再适用
接收上游安全更新。

### Docker {#docker}

```dockerfile
FROM node:24-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-slim
WORKDIR /app
COPY --from=build /app/.output .output
# data/ 是运行时创建的 SQLite 目录 - 不要将开发数据库复制到产品中。
# 对于生产，将 DATABASE_URL 设置为托管的 Postgres 或 Turso 实例。
RUN mkdir -p /app/data
ENV PORT=3000
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
```

## 韦尔塞尔 {#vercel}

```ts
// vite.config.ts
export default defineConfig({
  plugins: [agentNative({ nitro: { preset: "vercel" } })],
});
```

通过 Vercel CLI 或 git Push 进行部署：

```bash
vercel deploy
```

对于工作区，将每个应用程序构建到一个 Vercel Build Output API 捆绑包中：

```bash
npx @agent-native/core@latest deploy --preset vercel
```

对于 Vercel Git 部署，将构建命令设置为：

```bash
npx @agent-native/core@latest deploy --preset vercel --build-only
```

工作区构建将每个应用程序的 Nitro `vercel` 输出复制到根 `.vercel/output` 中，为每个函数提供自己的挂载路径环境，并编写为 `/<app-id>` 处的应用程序提供服务的路由配置。

## Netlify {#netlify}

Nitro `netlify` 预设运行良好，在实践中，对于与外部 Postgres (Neon) 通信的模板，它比 Cloudflare Pages 更快地冷启动（TTFB 与 ~9 秒相比约为 200 毫秒）。在 `vite.config.ts` 中设置预设：

```ts
// vite.config.ts
export default defineConfig({
  plugins: [agentNative({ nitro: { preset: "netlify" } })],
});
```

...或在构建时设置 `NITRO_PRESET=netlify`。

对于工作区，通过运行以下命令从一个 Netlify 站点部署每个应用：

```bash
npx @agent-native/core@latest deploy --preset netlify
```

工作区构建在 `dist/_workspace_static/` 下写入静态资产，并将每个应用程序路由到自己的 Netlify 函数，而无需强制资产重定向，因此像 `/mail/assets/...` 这样的文件会在服务器函数处理应用程序路由之前静态提供服务。

## Cloudflare 页面 {#cloudflare-pages}

```ts
// vite.config.ts
export default defineConfig({
  plugins: [agentNative({ nitro: { preset: "cloudflare_pages" } })],
});
```

## AWS 拉姆达 {#aws-lambda}

```ts
// vite.config.ts
export default defineConfig({
  plugins: [agentNative({ nitro: { preset: "aws_lambda" } })],
});
```

## 德诺部署 {#deno-deploy}

```ts
// vite.config.ts
export default defineConfig({
  plugins: [agentNative({ nitro: { preset: "deno_deploy" } })],
});
```

## 环境变量 {#environment-variables}

### 构建/运行时 {#env-runtime}

| 变量                        | 描述                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                      | 服务器端口（仅限Node.js）                                                                                                      |
| `NITRO_PRESET`              | 在构建时覆盖构建预设                                                                                                           |
| `APP_BASE_PATH`             | 将应用程序安装在前缀下（例如 `/mail`）。由`npx @agent-native/core@latest deploy`自动设置；保持未设置为独立。                   |
| `AGENT_PROD_CODE_EXECUTION` | 可选的生产代码执行模式：`off`（默认）、`sandboxed` 或 `trusted`。参见[Production Code Execution](#production-code-execution)。 |

数据库连接变量（`DATABASE_URL`、`DATABASE_AUTH_TOKEN`、每个应用程序 `<APP_NAME>_DATABASE_URL`）位于 [Database](/docs/database#production) 中。

### 生产中需要 {#env-required-prod}

这些必须在将应用程序升级到真正的产品部署之前设置。缺失值要么失败关闭（框架拒绝启动/拒绝处理请求），要么回退到较弱的行为并发出响亮的警告。

| 变量                     | 描述                                                                                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`     | 32+ 字符随机字符串。签署会话 cookies AND 是 `OAUTH_STATE_SECRET` 和 `SECRETS_ENCRYPTION_KEY` 的后备 HMAC。硬性要求：如果在生产中缺失，框架将在启动时抛出异常。                            |
| `BETTER_AUTH_URL`        | 此应用程序的公共来源（例如 `https://mail.example.com`）。用于cookie域和OAuth重定向构造。                                                                                                  |
| `ANTHROPIC_API_KEY`      | API 嵌入式生产代理密钥。 **在多租户部署中**，当用户没有每用户密钥时，框架拒绝回退到此 - 需要自带密钥。单租户自托管安装将其用作全局密钥。                                                  |
| `OAUTH_STATE_SECRET`     | 用于 OAuth 状态信封（Google、Atlassian、Zoom）的专用 HMAC 密钥。未设置时回落到 `BETTER_AUTH_SECRET`，但建议使用专用值，以便旋转一个值不会使另一个值无效。通过`openssl rand -hex 32`生成。 |
| `A2A_SECRET`             | 为应用程序间 A2A JSON-RPC 共享 HMAC。如果没有它，每个 A2A 端点和 `/_agent-native/integrations/process-task` 自发射端点在生产中都会返回 503。                                              |
| `SECRETS_ENCRYPTION_KEY` | AES-256-GCM 静态加密机密保管库的密钥。回落至 `BETTER_AUTH_SECRET`。当两者都未设置时，生产中会发生硬故障。                                                                                 |

### 身份验证和身份 {#env-auth}

OAuth 提供商凭证（Google、GitHub）、静态 MCP 承载后备（`ACCESS_TOKEN` / `ACCESS_TOKENS`）和电子邮件验证切换记录在 [Authentication](/docs/authentication) 中。根据您选择的身份验证模式将它们设置在那里。

### 入站Webhooks {#env-webhooks}

每个消息集成在生产中都需要自己的签名密钥（当密钥丢失时，处理程序会因伪造请求而失败关闭）。每个积分变量列在 [Messaging](/docs/messaging) 和 [Security](/docs/security) 中。仅对于本地开发，`AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS=1` 选择返回“警告并接受”——永远不要在产品中设置它。

### 安全配置（选择加入） {#security-config}

默认值是严格的。一些选择加入标志放松了行为（调试堆栈跟踪、未经验证的 webhooks、工作区范围的密钥回退、MCP 集线器多组织切换、运行时 env-var 写入）。它们的安全权衡记录在 [Security](/docs/security) 中。除非您特别想要宽松的路径，否则不要设置它们。

### 工作区.env继承 {#env-inheritance}

在工作空间内，根 `.env` 会自动加载到每个应用程序中，因此 `ANTHROPIC_API_KEY`、`A2A_SECRET`、`BETTER_AUTH_SECRET` 和 `OAUTH_STATE_SECRET` 等共享密钥只需设置一次。每个应用 `apps/<name>/.env` 在冲突中获胜。

### 生成强大的秘密 {#env-generate-secrets}

对于任何标记为“32+ char random”的密钥（`BETTER_AUTH_SECRET`、`OAUTH_STATE_SECRET`、`A2A_SECRET`、`SECRETS_ENCRYPTION_KEY`），请使用以下命令生成新值：

```bash
openssl rand -hex 32
```

通过替换每个实例上的环境变量并重新部署来轮换它们 — 使用旧密钥签名的会话/OAuth 状态信封将变得无效，因此用户可能需要再次登录。

## 生产代理工具 {#production-agent-tools}

生产代理从
代理聊天插件。默认情况下启用数据库写入，因为原始数据库
工具的范围仅限于经过身份验证的用户/组织，但应用程序所有者可以缩小范围
何时部署应该更加固执己见：

```ts
// server/plugins/agent-chat.ts
export default createAgentChatPlugin({
  // Default: "write" (also true)
  databaseTools: "read", // "write" | "read" | "off"
  extensionTools: false,
});
```

- `databaseTools: "write"` — 默认。寄存器`db-schema`、`db-query`、
  `db-exec` 和 `db-patch`。写入范围仅限于当前用户/组织和
  架构更改被阻止。
- `databaseTools: "read"` — 仅注册 `db-schema` 和 `db-query`；代理
  使用 SQL 检查数据，但必须使用类型化应用程序 actions 进行写入。
- `databaseTools: "off"` 或 `false` — 从
  代理表面，因此应用程序的 actions 是唯一的数据访问路径。
- `extensionTools: false` — 删除框架扩展管理 actions 和
  针对以下应用的提示指导（`create-extension`、`update-extension` 等）
  不希望代理创建沙盒迷你应用程序。

## 生产代码执行 {#production-code-execution}

默认情况下，生产代理在没有代码执行工具的情况下运行。他们可以调用应用程序 actions、数据库工具、MCP 工具、浏览器/会话工具和其他已注册的框架工具，但他们无法获得 shell 或文件系统访问权限。

节点兼容的部署可以通过代理聊天插件或环境覆盖选择生产代码执行：

```ts
// server/plugins/agent-chat.ts
export default createAgentChatPlugin({
  codeExecution: { production: "sandboxed" },
});
```

可用模式有：

- `off` — 默认值。生产环境中未注册任何代码执行工具。
- `sandboxed` — 注册 `run-code`，一个隔离的 Node.js JavaScript 运行器，具有清理环境、新的临时目录、输出/时间限制以及本地主机桥，以连接到允许列入名单的注册工具，例如 `provider-api-request`、`provider-api-docs`、`provider-api-catalog`、`web-request` 以及使用的资源支持的工作区文件桥作者：`workspaceRead` / `workspaceWrite`。
- `trusted` — 注册 `run-code` 以及完整的编码工具注册表（`bash`、`read`、`edit`、`write`）。仅将其用于单租户或操作员控制的部署，其中有意对主机进行完全 shell 访问。

设置 `AGENT_PROD_CODE_EXECUTION=sandboxed` 或 `AGENT_PROD_CODE_EXECUTION=trusted` 以覆盖特定部署的插件选项，而无需更改代码。即使插件选项启用了它，`AGENT_PROD_CODE_EXECUTION=off` 也会强制代码执行。

`run-code` 沙箱是进程级隔离，而不是操作系统容器。它从子进程环境中剥离应用程序机密，并在可用时使用 Node 权限模型，但出站网络不会被 Node 本身阻止；经过身份验证的调用应通过该工具公开的桥接助手。

## 在生产中更新 UI {#updating-ui-in-production}

agent-native 的核心功能之一是代理可以修改应用程序的源代码 - 组件、路由、样式、actions。在本地开发期间，这可以无缝工作，因为代理具有完整的文件系统访问权限。

在 [production code execution](#production-code-execution) 关闭的标准生产部署中，代理可以访问应用程序工具（actions、数据库、MCP），但不能访问文件系统。这意味着代理可以读取和写入数据、运行 actions 以及与外部服务交互 - 但它无法编辑 React 组件或在已部署的实例上添加新路由。

### Builder.io：制作中的可视化编辑 {#builderio}

[Builder.io](https://www.builder.io) 通过提供托管云环境来解决此问题，在该环境中，代理保留在生产中修改应用程序的 UI 的能力。将您的存储库连接到 Builder.io 并直接提示 UI 更改 - 无需重新部署。

**工作原理：**

1. 将您的代理本机存储库连接到 Builder.io
2. Builder.io提供具有代理、可视化编辑和实时协作的云框架
3. 提示代理进行 UI 更改 - 它会实时编辑您的组件、路线和样式
4. 更改将提交回您的存储库

有关嵌入式代理面板与云框架选项的更多信息，请参阅 [Frames](/docs/frames)。

## 多实例部署 {#multi-instance}

代理本机应用程序通过 Drizzle 将所有状态存储在 SQL 中，并通过 [polling](/docs/key-concepts#polling-sync) 与数据库同步 UI — 无文件系统状态、无粘性会话、无内存缓存。这意味着多实例和无服务器部署开箱即用：将每个实例指向同一个 `DATABASE_URL`，它们会自动聚合。请参阅 [Key Concepts — Data in SQL](/docs/key-concepts#data-in-sql) 和 [Portability](/docs/key-concepts#hosting-agnostic)。
