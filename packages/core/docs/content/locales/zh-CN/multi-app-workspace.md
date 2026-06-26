---
title: "多应用工作区"
description: "在一个单一存储库中托管许多代理本机应用程序，并具有共享身份验证、RBAC、指令、skills、组件和凭据。"
---

# 多应用工作区

> **哪个工作区文档？** 此页面涵盖 **部署形状** - 一个单一存储库、许多应用程序、共享身份验证和统一部署。对于工作空间*是什么*（自定义层：`AGENTS.md`、`LEARNINGS.md`、个人内存、skills、自定义代理），请参阅 [Workspace](/docs/workspace)；有关治理（谁审查、批准和拥有什么），请参阅 [Workspace Governance](/docs/workspace-management)。

当对内部工具进行振动编码需要一个下午时，您不会停下来。一个团队最终得到了一个 CRM、一个支持收件箱、一个仪表板、一个操作控制台——十个小应用程序，每个应用程序都是独立搭建的。这很好，直到您需要更改所有内容为止。

那时，每个应用程序都有自己的 `AGENTS.md`、自己的身份验证插件、自己的复制粘贴布局组件、自己的硬编码 Slack 令牌、自己关于“组织”是什么的想法。合规规则的变更意味着十个 PR。轮换 API 密钥意味着十次重新部署。品牌刷新意味着十个不同的标题变得不同步。原本让构建它们变得容易的事情现在却让它们变得难以管理。

**多应用程序工作区**模式是代理本机解决此问题的方式。您可以将所有应用程序与私有 `packages/shared` 包一起托管在一个单一存储库中。该框架拥有通用的默认值； `packages/shared` 仅适用于真正针对您的工作区定制的代码、指令、skills、组件或插件覆盖。每个应用程序都缩小到少数几个屏幕和 actions，这使其独一无二。

## 分享什么内容 {#what-gets-shared}

您组织中的每个应用都应同意的任何内容都可以存在于 `packages/shared` 中：

| 共享的东西      | 它居住的地方                                       |
| --------------- | -------------------------------------------------- |
| 验证/SSO覆盖    | 从 `src/server/index.ts` 导出 `authPlugin`         |
| 组织/RBAC规则   | 更好的身份验证组织，可选地由 `authPlugin` 包装     |
| 代理聊天覆盖    | 从 `src/server/index.ts` 导出 `agentChatPlugin`    |
| 企业代理说明    | `AGENTS.md`                                        |
| 特工skills      | `.agents/skills/<skill-name>/SKILL.md`             |
| 共享代理actions | `actions/*.ts`                                     |
| 共享React组件   | 从`src/client/index.ts`导出                        |
| 设计代币/品牌   | 添加共享的 CSS 文件并从每个应用导入                |
| 共享 API 凭证   | 更喜欢框架范围的凭据；仅当需要命名空间时才添加助手 |

每个单独的应用程序都变成*只是一组屏幕* — 路线、仪表板、视图、特定于域的 actions。框架默认值涵盖其余部分，直到您添加真正的工作区自定义。

当您的应用想要使用另一个第一方应用时，同样的边界也适用。需要电子邮件、日历、分析和公司内存上下文的新工作区仪表板应使用现有的邮件、日历、分析和大脑应用程序作为通过链接或 A2A 连接的邻居。它不应该克隆这些模板，创建嵌套它们的包装应用程序，或者在其内部搭建子应用程序只是为了访问其数据或代理。仅当您明确想要自定义该应用程序时，才分叉或搭建副本。

## 开始使用 {#getting-started}

工作区是代理本机项目的默认形状。脚手架一具有：

```bash
npx @agent-native/core@latest create my-company-platform
```

CLI 显示每个第一方模板的多选选择器。选择任意数量的邮件 + 日历 + 表单，例如，它们都会被搭建到同一个工作区中，共享身份验证和数据库默认值。

您将获得一个包含私有共享包的 pnpm monorepo、一个连接工作区发现的根 `package.json`、一个共享 `.env` 以及您选择的每个应用程序的一个子目录：

```an-file-tree title="一个脚手架生成的 workspace"
{
  "entries": [
    { "path": "package.json", "note": "声明 agent-native.workspaceCore" },
    { "path": "pnpm-workspace.yaml", "note": "packages: [\"packages/*\", \"apps/*\"]" },
    { "path": ".env.example", "note": "共享的 ANTHROPIC_API_KEY、A2A_SECRET、DATABASE_URL、..." },
    { "path": "packages/shared/", "note": "@my-company-platform/shared" },
    { "path": "packages/shared/src/server/", "note": "仅在需要时使用 plugin overrides" },
    { "path": "packages/shared/src/client/", "note": "仅在需要时共享 React 代码" },
    { "path": "packages/shared/AGENTS.md", "note": "整个 workspace 的指令" },
    { "path": "apps/mail/" },
    { "path": "apps/calendar/" },
    { "path": "apps/forms/" }
  ]
}
```

然后启动它：

```bash
cd my-company-platform
cp .env.example .env             # 填写ANTHROPIC_API_KEY、BETTER_AUTH_SECRET、...
pnpm install
pnpm dev                         # opens Dispatch; other apps start on first visit
```

每个应用程序都已经知道如何登录、共享相同的数据库以及加载工作区 `AGENTS.md`。您没有连接任何这些 - 框架通过根 `package.json` 中的 `agent-native.workspaceCore` 字段自动发现共享包：

```json
{
  "name": "my-company-platform",
  "agent-native": {
    "workspaceCore": "@my-company-platform/shared"
  }
}
```

## 添加另一个应用 {#adding-a-new-app}

从工作区内的任何位置：

```bash
npx @agent-native/core@latest add-app
```

CLI 再次显示模板选择器，其中已过滤掉您已安装的应用程序。选择一个或多个，它们就会被搭建在 `apps/` 下。非交互式变体：

```bash
npx @agent-native/core@latest add-app crm --template content
```

任何第一方模板都可以用作工作区应用程序 - CLI 在模板上运行一个小型 **workspacify** 转换，将共享包添加为 dep 并解析 `workspace:*` 引用。无需维护并行的“工作空间应用程序”脚手架。

```bash
pnpm install                     # at the workspace root
pnpm dev
```

就是这样。新应用程序具有与其他应用程序相同的登录和工作区说明。仅在工作区实际需要时添加共享品牌、actions 或凭据。

## 您在何处覆盖内容 {#layering}

工作区中的代理本机应用程序按以下顺序从三个位置解析横切行为：

1. **应用程序本地** — `apps/<name>/` 内的文件（最高优先级）
2. **工作空间共享** — `packages/shared/`（共享中间层）内的文件
3. **框架默认** — `@agent-native/core`（最低）

合并按文件名进行。如果应用程序提供的本地文件也存在于上游，则本地文件获胜。如果没有，则应用工作区共享版本。如果共享也没有提供，则框架默认启动。这适用于插件、skills、actions 和 `AGENTS.md`。

```an-diagram title="三层，按文件名合并" summary="每个应用程序首先从应用程序本地解析插件、技能、操作和 AGENTS.md，然后是共享包，然后是框架默认值。"
{
  "html": "<div class=\"layer\"><div class=\"diagram-card accent\"><span class=\"diagram-pill accent\">1 &middot; App local</span><small class=\"diagram-muted\"><code>apps/&lt;name&gt;/</code> &mdash; highest priority</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">2 &middot; Workspace shared</span><small class=\"diagram-muted\"><code>packages/shared/</code> &mdash; the mid-layer</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">3 &middot; Framework default</span><small class=\"diagram-muted\"><code>@agent-native/core</code> &mdash; lowest</small></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box ok\">first match wins</div></div>",
  "css": ".layer{display:flex;flex-direction:column;align-items:center;gap:6px}.layer .diagram-card{display:flex;flex-direction:column;gap:3px;padding:12px 16px;width:320px}.layer .diagram-arrow{font-size:18px;line-height:1}.layer .diagram-box{margin-top:2px}"
}
```

当一个应用需要不同的东西时，删除本地文件：

| 要覆盖的内容 | 要在应用程序内创建的文件                           |
| ------------ | -------------------------------------------------- |
| 身份验证插件 | `apps/<name>/server/plugins/auth.ts`               |
| 代理聊天插件 | `apps/<name>/server/plugins/agent-chat.ts`         |
| 特定技能     | `apps/<name>/.agents/skills/<skill-name>/SKILL.md` |
| 特定操作     | `apps/<name>/actions/<action-name>.ts`             |
| 其他代理说明 | `apps/<name>/AGENTS.md`（与工作区一合并）          |

无需接线，无需配置。创建文件并接管。

## 编辑共享行为 {#editing-shared-behavior}

您自定义的所有横切内容都位于 `packages/shared/` 中。从 `src/server/index.ts` 导出 `authPlugin`，每个应用程序都会在下次开发重新加载时拾取它。在 `.agents/skills/` 下添加一项技能，每个应用程序的代理都会看到它。向`actions/`添加一个动作，每个应用程序的代理都可以调用它。

由于共享包是 `workspace:*` 依赖项，因此 pnpm 将其符号链接到每个应用程序的 `node_modules/` 中。您永远不会构建或发布它 - 应用程序会在构建时捆绑它们需要的任何内容。

## 运行时全局资源 {#runtime-global-resources}

使用 `packages/shared` 作为应随存储库附带的代码级默认值：插件、共享 actions、共享 React 代码、文件系统 `AGENTS.md` 和文件系统 skills。将 Dispatch 工作区资源用于管理员希望在不更改代码的情况下进行管理的运行时可编辑全局上下文。

调度资源的范围为**所有应用程序**（每个应用程序在运行时继承它们，没有复制或同步步骤）或**选定的应用程序**（为每个应用程序授予特定于应用程序的上下文）。请参阅 [Workspace](/docs/workspace#global-resources) 了解完整的资源模型表、路径约定和推荐的入门包。

## 身份验证和RBAC {#auth-and-rbac}

每个代理本机应用程序都已附带 [Better Auth](/docs/authentication) 以及框架的内置组织系统。在工作区中，您可以在每个应用程序中免费获得该功能，并由同一数据库支持。有关完整的多租户模型（组织、角色、数据隔离），请参阅 [Multi-Tenancy](/docs/multi-tenancy)。

对于特定于企业的规则（允许列表域、SSO 强制执行、额外角色检查），请从 `packages/shared/src/server/index.ts` 导出 `authPlugin`。现在，工作区中的每个应用程序都会强制执行这些规则。

活动组织自动流动：`session.orgId` → `AGENT_ORG_ID` → SQL 行范围，因此用 `org_id` 标记的数据对于其他组织甚至代理来说都是不可见的。完整模型请参见 [Security & Data Scoping](/docs/security)。

## 共享MCP服务器 {#shared-mcp}

跨工作区应用共享 MCP 服务器的推荐选项（按优先顺序排列）：

1. **调度工作区 MCP 资源** — 在 Dispatch 中的 **所有应用程序** 范围内添加 `mcp-servers/<name>.json` 资源。工作区中的每个应用程序在运行时都会继承 MCP 服务器，无需进行文件编辑或重新部署。仅当服务器特定于应用程序时才授予选定的应用程序。代币存在于 Dispatch 保险库中；从资源 JSON 和 `${keys.NAME}` 中引用它们。

2. **根 `mcp.config.json`** — 在工作区根目录中放置一个文件，工作区中的每个应用程序都会连接到相同的 MCP 服务器。各个应用程序可以使用自己的 `mcp.config.json` 进行覆盖（应用程序根获胜）。将此用于不需要每用户保管库凭据的本地/文件系统 MCP 服务器（`@modelcontextprotocol/server-filesystem`、`claude-in-chrome`、Playwright）。

3. **设置 UI（个人/组织范围）** — 对于远程 HTTP MCP 服务器，用户可以从个人或团队（组织）范围的设置 UI 添加它们 — 无需文件编辑，热重新加载到正在运行的代理中。

请参阅 [MCP Clients](/docs/mcp-clients) 了解配置架构、优先级规则和集线器设置。

## 共享环境变量 {#shared-env}

工作区根 `.env` 会自动加载到每个应用程序中。将共享密钥放在根目录中一次（`ANTHROPIC_API_KEY`、`A2A_SECRET`、`BETTER_AUTH_SECRET`、`DATABASE_URL`、`BUILDER_PRIVATE_KEY` 等），每个应用程序都会获取它们。每个应用程序覆盖进入 `apps/<name>/.env` 并在冲突时获胜。

对于运行时应用程序凭据，与手动编辑 `.env` 文件相比，更喜欢使用 DispatchVault。保管库默认为所有应用程序访问，因此每个保存的保管库密钥可供每个工作区应用程序使用，并且可以使用 `sync-vault-to-app` 推送。仅当应用程序需要显式的每密钥授权时，才将保管库切换到手动模式。

```text
my-company-platform/
├── .env                           # shared: ANTHROPIC_API_KEY=... , A2A_SECRET=... , ...
└── apps/
    └── mail/
        └── .env                   # optional overrides just for mail
```

一些入门流程是开箱即用的工作区感知型：

- **Builder `/cli-auth`**：从任何应用程序中单击“连接 Builder”会将 `BUILDER_PRIVATE_KEY` 和朋友写入 **工作区根目录** `.env`，因此每个应用程序都会立即获得浏览器访问权限。
- **环境变量设置路由** (`POST /_agent-native/env-vars`)：在工作空间内时，默认写入工作空间根 `.env`。在正文中传递 `scope: "app"` 以覆盖一个应用程序。

## 共享凭据 {#shared-credentials}

默认情况下，同一工作区中的应用程序指向同一 `DATABASE_URL`，因此框架凭证存储可以使凭证可供每个应用程序使用，而无需每个应用程序配置。直接使用 `@agent-native/core/credentials`，或者如果您的工作区需要更严格的命名约定，则在 `packages/shared` 中添加瘦助手。

## 共享设计令牌 {#design-tokens}

该框架基于 Tailwind v4。仅当工作区有真正的品牌令牌可供共享时，才将共享的 CSS 文件添加到 `packages/shared`，然后从每个应用程序的 `app/global.css` 导入它：

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

品牌颜色、版式、间距比例和任何共享组件类都可以存在于该一个 CSS 文件中。在 `packages/shared` 中更新它，每个应用程序都会在下一个版本中重新命名。

## 部署 {#deployment}

您有两个选择：**统一部署**（工作区的默认设置）或每个应用程序独立部署。

### 统一部署（推荐）

一个命令构建工作区中的每个应用程序，并将它们发送到单个源，每个应用程序一个路径：

```bash
npx @agent-native/core@latest deploy
# https://your-agents.com/mail/*       → apps/mail
# https://your-agents.com/calendar/*   → apps/calendar
# https://your-agents.com/forms/*      → apps/forms
```

每个应用程序均使用 `APP_BASE_PATH=/<name>` 和 `VITE_APP_BASE_PATH=/<name>` 构建，并通过选定的 Nitro 预设发出。 Cloudflare Pages 是默认预设，并使用 `dist/_worker.js` 和 `_routes.json` 的调度程序工作人员。 `npx @agent-native/core@latest deploy --preset netlify` 支持 Netlify；它在 `.netlify/functions-internal/<app>-server` 下发出应用程序功能，并生成重定向，使静态资产不受强制，因此 CDN 首先提供文件。 `npx @agent-native/core@latest deploy --preset vercel` 支持 Vercel；它使用 Vercel 的构建输出 API 编写根 `.vercel/output` 包。

```an-diagram title="统一部署：一个源，每个应用一个路径" summary="每个应用程序都遵循单一来源，因此登录会话和跨应用程序 A2A 是免费的。"
{
  "html": "<div class=\"deploy\"><div class=\"diagram-box accent\">your-agents.com<br><small class=\"diagram-muted\">one DNS record &middot; one cert &middot; one CDN</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"deploy-apps\"><div class=\"diagram-box\">/mail/*</div><div class=\"diagram-box\">/calendar/*</div><div class=\"diagram-box\">/forms/*</div></div><div class=\"diagram-pill ok\">shared login cookie on the apex &bull; same-origin A2A, no CORS</div></div>",
  "css": ".deploy{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.deploy .deploy-apps{display:flex;flex-direction:column;gap:8px}.deploy .diagram-arrow{font-size:24px}.deploy .diagram-pill{flex-basis:100%}"
}
```

同源\*\*才是真正的回报所在：

- **共享登录会话。** Better Auth 在顶点域上设置其 cookie，因此登录任何应用程序都会登录到每个应用程序。没有跨域SSO舞蹈。
- **零配置跨应用程序 A2A。** `@mail` 标记 `@calendar` 成为同源获取 - 兄弟之间没有 CORS，没有 JWT 签名。外部A2A仍沿用至今的JWT。
- **一条 DNS 记录，一个证书，一个 CDN 缓存。**

发布 `dist/` 输出：

```bash
wrangler pages deploy dist
```

对于 Netlify：

```bash
npx @agent-native/core@latest deploy --preset netlify --build-only
```

对于 Vercel Git 部署，将构建命令设置为：

```bash
npx @agent-native/core@latest deploy --preset vercel --build-only
```

### 公共应用路由

工作区应用程序默认为内部应用程序。对于具有仅登录管理页面的公共网站，设置公共受众并保护该应用程序的 `package.json` 中的管理前缀：

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

对于大多数带有一些公共页面的内部应用程序，请保留受众内部和列表页面前缀：

```json
{
  "agent-native": {
    "workspaceApp": {
      "publicPaths": ["/", "/share"]
    }
  }
}
```

这些设置仅影响只读页面导航。框架工具、代理聊天、A2A、保管库访问和任意 API 保持身份验证，除非应用程序显式声明带有 `createAuthPlugin({ publicPaths: [...] })` 的公共前缀。

### 每个应用独立部署

更喜欢每个应用程序在自己的域中（`mail.company.com`、`calendar.company.com`）？工作区中的每个应用程序仍然是独立可部署的 - `cd apps/mail && npx @agent-native/core@latest build` 的行为与独立脚手架完全相同。然后，跨应用程序 A2A 通过具有共享 `A2A_SECRET` 的标准 JWT 签名路径。单独部署的应用程序之间的跨域 SSO 由以 Dispatch 作为中心的身份联合处理 - 请参阅 [Cross-App SSO](/docs/cross-app-sso)；统一的单源部署避免了需要它。

### 共享数据库、共享凭证

无论您选择什么，都将每个应用程序指向相同的 `DATABASE_URL` 以获得开箱即用的跨应用程序状态：一组用户帐户、一组组织、一组共享设置。如果每个应用程序都有自己的数据库，那么工作区模式仍然有效 - 您只是失去了共享状态的故事。

共享包本身永远不会独立部署。这是一个 `workspace:*` 依赖项，pnpm 符号链接到每个应用程序的 `node_modules/`，因此每个应用程序在构建时透明地捆绑它需要的任何内容。

## 超出范围（目前） {#out-of-scope}

工作区图案故意变窄。它故意不处理一些事情：

- **加密凭证保管库。**首选调度保管库来获取运行时应用程序凭证（请参阅 [Shared environment variables](#shared-env)）。非保管库回退路径（直接写入框架 `settings` 表的共享凭证）现在将它们存储为纯文本，因此当您依赖它时，请负责任地轮换。
- **将共享代码发布到私有npm。**共享包仅限`workspace:*`；通过私有注册表进行多存储库共享是可行的，但无法搭建。
- **固定组件库。** `packages/shared` 是您放置共享组件的位置。该框架不会强制 shadcn/ui 或任何其他系统进入该插槽。

## 另请参阅 {#see-also}

- [Workspace](/docs/workspace) - 工作区中每个应用共享的自定义层（`AGENTS.md`、`LEARNINGS.md`、个人内存、skills、自定义代理）。
- [Workspace Governance](/docs/workspace-management) — 分支、CODEOWNERS、一个存储库中多个应用的 PR 审核。
- [Multi-Tenancy](/docs/multi-tenancy) — 组织、角色和每个组织的数据隔离。
- [Cross-App SSO](/docs/cross-app-sso) — 用于单独域部署的身份联合。
- [Dispatch](/docs/dispatch) - 运行时控制平面，通常位于多应用工作区中，作为机密库、集成目录和审批中心。
