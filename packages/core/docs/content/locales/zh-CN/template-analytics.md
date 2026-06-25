---
title: "分析"
description: "用简单的英语提出分析问题，获取图表和仪表板。 Amplitude、Mixpanel 和 Looker 的开源替代品。"
---

# 分析

用简单的英语提出分析问题，获取图表和仪表板。该代理连接到 BigQuery、GA4、Amplitude、内置第一方事件收集器、HubSpot、Jira 和十几个其他源，为您编写查询、验证查询，并将答案呈现为图表、表格或保存的仪表板面板。

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:500px;box-sizing:border-box'><h1 style='margin:0'>Agent-Native 模板</h1><p class='wf-muted' style='margin:0'>过去 12 周的采用率和参与度。</p><div style='display:grid;grid-template-columns:repeat(3,1fr);gap:12px'><div class='wf-card'><small class='wf-muted'>每周活跃用户</small><br/><strong>24,318</strong><br/><span class='wf-pill accent'>+12.4%</span></div><div class='wf-card'><small class='wf-muted'>新增注册</small><br/><strong>1,842</strong><br/><span class='wf-pill accent'>+8.7%</span></div><div class='wf-card'><small class='wf-muted'>MRR 收入</small><br/><strong>$48,210</strong><br/><span class='wf-pill accent'>+21.3%</span></div></div><div style='display:grid;grid-template-columns:1fr 1fr;gap:12px;flex:1'><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><strong>每周活跃用户</strong><div style='flex:1;display:flex;align-items:end;gap:8px'><div style='height:38%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:44%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:58%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:74%;flex:1;background:var(--wf-accent-soft)'></div></div></div><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><strong>收入趋势</strong><div style='flex:1;display:flex;align-items:end;gap:8px'><div style='height:32%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:48%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:63%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:80%;flex:1;background:var(--wf-accent-soft)'></div></div></div></div><div class='wf-card'><strong>按来源划分的注册</strong><br/><small class='wf-muted'>下方图表位于主图表下方。</small></div></div>"
}
```

它是 Amplitude、Mixpanel 和 Looker 的开源替代品——适合想要拥有代码、查询和数据的团队。

```an-diagram title="问题到图表" summary="代理查阅数据字典，写入 SQL，根据仓库对其进行验证，然后渲染图表或保存面板。"
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-node\">简明语言<br>question</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Agent</span><small class=\"diagram-muted\">reads data dictionary</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>写入 SQL</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill ok\">Dry-run 校验</div><small class=\"diagram-muted\">BigQuery / 来源</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">图表、表格或<br>saved panel</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:6px;align-items:center}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 你可以用它做什么

- **用简单的英语询问数据问题。**“上个月注册转化为付费的比例是多少？”或“显示过去 6 个月的每周活跃用户数”。代理选择正确的源，写入 SQL，并渲染图表。
- **使用过滤器、保存的视图和参数查询构建可重用的 SQL 仪表板**。
- **运行临时分析**，交叉引用多个数据源 - 与原始问题、说明和结果一起保存为可重新运行的调查。
- **维护指标、表和 SQL 配方的实时数据字典**，以便代理每次都使用正确的列名称（当它实际上是 `hs_is_closed` 时，不再猜测 `is_closed`）。
- **与您的团队共享仪表板** - 默认情况下是私有的，可按用户或按组织与查看者/编辑者/管理员角色共享。
- **连接到许多来源**，开箱即用：BigQuery、GA4、Mixpanel、Amplitude、PostHog、HubSpot、Jira、Apollo、Pylon、Gong、Common Room、Twitter，以及特定于应用程序的 SEO 来源。
- \*\*当工作区已连接且
  授予 Analytics 提供商。共享集成商店提供商
  身份和凭证参考； Analytics 保留特定于应用程序的来源选择，
  数据字典条目、仪表板 SQL 和分析历史记录。

## 开始使用

现场演示：[analytics.agent-native.com](https://analytics.agent-native.com)。

首次打开应用程序时：

1. 使用 Google 登录。
2. 从侧边栏打开**数据源**页面。
3. 每个来源都有一个演练 - 连接您需要的来源（从一个开始，例如 BigQuery、GA4、Amplitude 或第一方跟踪）。
4. 与代理打开新的聊天并提出问题：“上周我们获得了多少注册？”

第一个问题足以确认连接是否有效。从那里，要求代理“将其另存为仪表板”或“为我们的关键指标构建 4 面板概述仪表板。”

### 有用的提示

- “构建一个仪表板，显示过去 6 个月的每周活跃用户。”
- “上个月注册转化为付费的比例是多少？”
- “将按计划比较收入的图表添加到此仪表板。”
- “重新排序此仪表板上的面板，使 MRR 指标排在第一位。”
- “分析第一季度我们已结束的丢失交易并保存分析。”
- “使用本月的数据重新运行客户流失分析。”
- “在数据字典中记录此指标。”

代理始终知道您在查看什么 - 当前仪表板、过滤器、视图 - 因此您可以直接说出“此仪表板”或“那个面板”。

## 需要知道的三件事

该应用程序具有三个主要界面，您将在其中花费时间：

- **SQL 仪表板** — 带有过滤器和保存视图的可重复使用面板。最适合您定期检查的指标。
- **临时分析** — 从多个来源进行的长篇调查，并保存重新运行说明。最适合您可能想重新审视的一次性问题。
- **数据字典** — 指标、表、列和 SQL 配方的规范目录。代理在写入任何 SQL 之前会查阅它，因此它使用真实的仓库列名称，并了解“排除内部电子邮件”等警告。

通过询问代理来播种字典：“导入我们的 dbt 定义”或“从我们的 Notion 手册中提取指标”，它就会完成工作。

## 对于开发者

本文档的其余部分适用于任何派生 Analytics 模板或扩展它的人。

### 快速入门

从 CLI 创建新的 Analytics 应用：

```bash
npx @agent-native/core@latest create my-analytics --standalone --template analytics
```

本地开发：

```bash
cd my-analytics
pnpm install
pnpm dev
```

CLI 打印本地开发 URL。使用 Google 登录，然后打开 **数据源** 页面以连接 BigQuery、GA4、第一方跟踪、HubSpot、Jira 等。

### 主要功能

**提出问题，获取图表。**代理选择数据源，写入并验证 SQL，然后呈现图表、表格、指标或保存的面板。

**仪表板和调查。**可重复使用的仪表板保留 SQL 面板、过滤器、保存的视图和共享；临时分析通过重新运行指令保存更长的结果。

**实时数据字典。**指标定义、所有者、源表和已知警告在写入查询之前为代理提供真实的仓库词汇。

**广泛的连接器表面。** BigQuery、GA4、产品分析、CRM、支持、社区、GitHub/Jira、SEO 和第一方 `/track` 事件均来自代理可以调用的 actions。

### 与代理合作

代理始终知道您在看什么。当前屏幕状态作为 `<current-screen>` 块注入到每条消息中 - 它包含活动视图、打开的仪表板或分析以及任何选定的过滤器。

代理的系统提示符会获取注入的 `<data-dictionary>` 块，其中包含活动组织的已批准指标条目。当您请求仪表板时，代理首先查阅字典并逐字使用记录的 `table` / `columns` / `queryTemplate` - 它不会猜测列名称。

**它自动具有的上下文：**

- **当前视图** — `overview`、`adhoc`（使用 `dashboardId`）、`analyses`（使用 `analysisId`）、`data-dictionary`、`data-sources` 或 `settings`。
- **活动组织** — 范围所有查询和写入。
- **批准的字典条目** - 用于活动工作区。

**仪表板编辑。** 代理使用 `update-dashboard` 操作来编辑仪表板。它支持两种模式：

- `ops` — JSON-用于外科编辑的指针补丁（移动面板、替换一个 SQL 字符串、删除过滤器）。
- `config` — 完全替换仪表板配置。

在保存仪表板之前，每个 BigQuery 面板的 SQL 都会针对仓库进行试运行。如果列错误，则保存会被拒绝，并出现 BigQuery 错误 - 代理会修复 SQL 并重试，而不是保留损坏的面板。

### 连接数据源

打开 **数据源** 页面 (`/data-sources`) 以连接提供商。每个
源代码公开了一个环境密钥列表、一个演练和一个 **测试连接** 按钮。
当 Analytics 在工作区中运行时，`data-source-status` 也会报告
为 `appId=analytics` 授予可重用工作区连接，以便代理可以
请求应用程序授权，而不是同一提供商密钥的另一个副本。
对于可重用的提供程序（例如 Slack、HubSpot、Notion 和 GitHub），数据
源UI直接显示共享集成状态：通过工作区准备就绪，
需要授权、需要凭据或本地凭据。

可重用工作区集成是共享提供程序的运行时方向：
该框架存储提供商身份、帐户元数据、凭证引用和
每个应用程序授予一次； Analytics 存储数据源解释、来源
事实选择、指标定义、仪表板和分析。

凭证通过框架的settings/env层存储——git中没有秘密。制作要求：

| 变量                                     | 目的                               |
| ---------------------------------------- | ---------------------------------- |
| `DATABASE_URL`                           | 持久SQL连接URL                     |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | 身份验证                           |
| `GOOGLE_SIGN_IN_CLIENT_ID` / `_SECRET`   | 首选 Google 登录客户端 (OAuth 2.0) |
| `GOOGLE_CLIENT_ID` / `_SECRET`           | 旧版登录回退/Google API 集成客户端 |
| `BIGQUERY_PROJECT_ID`                    | BigQuery 项目                      |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON`    | BigQuery 服务帐户 JSON             |
| `ANTHROPIC_API_KEY`                      | 代理聊天                           |

特定于提供商的密钥（HubSpot、Jira、Gong、Pylon 等）记录在数据源页面上每个源的演练中。如果您添加需要 API 密钥的新操作，它将通过模板的入门注册在该页面上显示为新源。

注意：用于 Google 登录的 BigQuery OAuth 凭据是**单独的**
来自 BigQuery 服务帐号 JSON 的凭据。在
GCP 控制台 → API 和服务 → 凭证 → OAuth 客户端 ID，并首选
`GOOGLE_SIGN_IN_CLIENT_ID` / `GOOGLE_SIGN_IN_CLIENT_SECRET` 环境名称是这样的
低范围登录客户端与 Google API 集成客户端保持分离。

### 数据模型

核心表（参见`templates/analytics/server/db/schema.ts`）：

```an-schema title="分析数据模型" summary="Dashboards and analyses are the resources; views, shares, and a query cache hang off them. Org tables come from @agent-native/core/org."
{
  "entities": [
    {
      "id": "dashboards",
      "name": "dashboards",
      "note": "资源管理器和 SQL 仪表板",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "kind", "type": "text", "note": "\"explorer\" or \"sql\"" },
        { "name": "config", "type": "text", "note": "JSON 匹配 SqlDashboardConfig" }
      ]
    },
    {
      "id": "dashboard_views",
      "name": "dashboard_views",
      "note": "每个仪表板保存的过滤器预设",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "dashboard_id", "type": "text", "fk": "dashboards.id" }
      ]
    },
    {
      "id": "analyses",
      "name": "analyses",
      "note": "可重新运行的临时调查",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "question", "type": "text" },
        { "name": "instructions", "type": "text", "note": "重新运行步骤" },
        { "name": "dataSources", "type": "text", "note": "接触的来源" },
        { "name": "resultMarkdown", "type": "text" },
        { "name": "resultData", "type": "text", "nullable": true }
      ]
    },
    {
      "id": "bigquery_cache",
      "name": "bigquery_cache",
      "note": "结果缓存由 SQL 哈希键控",
      "fields": [
        { "name": "sql_hash", "type": "text", "pk": true },
        { "name": "bytes_processed", "type": "integer" }
      ]
    }
  ],
  "relations": [
    { "from": "dashboards", "to": "dashboard_views", "kind": "1-n", "label": "saved views" }
  ]
}
```

加上 `@agent-native/core/org` 提供的每个资源共享表（`dashboard_shares`、`analysis_shares`）和组织表（`organizations`、`org_members`、`org_invitations`）。数据字典位于框架的 `settings` 表中的作用域键下。

- **`dashboards`** — Explorer 和 SQL 仪表板。 `kind`为`"explorer"`或`"sql"`； `config` 是与 `SqlDashboardConfig` 匹配的 JSON Blob。
- **`dashboard_shares`** — 每个资源份额授予（主体、角色）。
- **`dashboard_views`** — 每个仪表板保存的过滤器预设。
- **`analyses`** — 使用 `question`、`instructions`、`dataSources`、`resultMarkdown` 和可选的 `resultData` 进行临时调查。
- **`analysis_shares`** — 用于分析的每个资源份额授予。
- **`bigquery_cache`** — 由 SQL 哈希键控的查询结果缓存，并进行字节处理记账。

加上`@agent-native/core/org`提供的组织表（`organizations`、`org_members`、`org_invitations`）。

数据字典位于框架的 `settings` 表中，位于作用域键下；查看 `list-data-dictionary` 和 `save-data-dictionary-entry` actions 的完整形状。

### 自定义它

Analytics 模板旨在进行分叉和扩展。一切都存在于 `templates/analytics/` 中：

- **`AGENTS.md`** — 代理的顶级指南。记录视图、actions 和工作流程。
- **`actions/`** — 每个代理可调用的操作。添加新文件以添加新操作。值得注意的：
  - `update-dashboard.ts` - 仪表板编辑（操作 + 完全替换）
  - `save-analysis.ts` / `list-analyses.ts` - 特别分析
  - `save-data-dictionary-entry.ts` / `list-data-dictionary.ts` — 字典
  - `bigquery.ts` — 原始 BigQuery 执行
  - `view-screen.ts` / `navigate.ts` — 情境感知
- **`app/routes/`** — 基于文件的路由。每个路由都是 `app/pages/` 中页面的薄包装。
- **`app/pages/adhoc/sql-dashboard/`** — SQL 仪表板渲染器、面板编辑器、过滤器栏、保存的视图。
- **`app/pages/analyses/`** — 分析列表和详细视图。
- **`app/pages/DataSources.tsx`** — 数据源载入 UI。
- **`app/pages/DataDictionary.tsx`** — 词典浏览器和编辑器。
- **`.agents/skills/`** — 模式指导代理按需读取：
  - `dashboard-management` — 存储、范围分辨率、仪表板配置形状
  - `data-querying` — 要访问哪个脚本，过滤模式
  - `adhoc-analysis` — 跨源调查的工作流程
  - `data-querying`, `real-time-sync`, `frontend-design`, `storing-data`, `self-modifying-code`
- **`.builder/skills/<provider>/SKILL.md`** — 特定于提供商的问题（BigQuery、HubSpot、Jira、GA4 等）。查询前请先阅读；当您学到新东西时更新。
- **`server/db/schema.ts`** - 用于仪表板、共享、视图、分析、BigQuery 缓存的 Drizzle 架构。
- **`server/lib/dashboards-store.ts`** — 仪表板读/写，具有范围解析和旧版 KV 迁移。
- **`server/lib/bigquery.ts`** — BigQuery 客户端、空运行验证器、缓存逻辑。

要添加新数据源，请在 `actions/` 中放置一个脚本，该脚本调用提供程序并通过 `output()` 帮助程序返回结果。它立即可供代理使用，并且可以在仪表板面板内使用（如果您通过服务器处理程序公开结果）。

要添加新的图表类型，请在`app/pages/adhoc/sql-dashboard/types.ts`中扩展`ChartType`联合，在`SqlChartCard.tsx`中进行处理，代理可以在任何面板中使用它。

有关扩展模板的更广泛模式，请参阅 [Skills guide](/docs/skills-guide) 和 [Actions](/docs/actions)。
