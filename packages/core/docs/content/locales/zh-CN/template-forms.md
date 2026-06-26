---
title: "表格"
description: "代理原生表单生成器 - 通过自然语言和可视化编辑器创建、编辑、发布和路由表单提交。"
---

# 表格

Forms 是一个代理原生表单构建器。描述您想要的表单，在编辑器中对其进行完善，然后发布一个公共表单，将提交内容存储在您自己的 SQL 数据库中。

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1.4px solid var(--wf-line)'><strong>Beta 注册</strong><span class='wf-pill accent'>published</span><div style='flex:1'></div><button>分享</button><button class='primary'>取消发布</button></div><div style='display:flex;gap:8px;padding:12px 16px;border-bottom:1.4px solid var(--wf-line)'><span class='wf-pill accent'>编辑</span><span class='wf-pill'>结果 187</span><span class='wf-pill'>设置</span><span class='wf-pill'>集成</span></div><div style='display:flex;flex-direction:column;gap:12px;padding:30px 78px;overflow:hidden'><h2 style='margin:0'>Beta 注册</h2><p class='wf-muted' style='margin:0'>预留即将开始的私密 beta 名额。</p><div class='wf-card'><strong>姓名</strong><input value='Ada Lovelace'/></div><div class='wf-card'><strong>工作邮箱</strong><input value='you@company.com'/></div><div class='wf-card'><strong>你的角色</strong><input value='Select...'/></div><div class='wf-card'><strong>团队规模</strong><input value='Select...'/></div></div></div>"
}
```

当您打开应用程序时，您会看到表单、当前编辑器和实时预览。代理可以根据提示创建表单、更新字段标签和选项、更改验证以及使用 UI 使用的相同 actions 连接提交目的地。

```an-diagram title="构建、发布、收集" summary="代理和可视化编辑器编辑一个 SQL-backed 表单定义。公共填写页面未经身份验证，提交内容将通过服务器端路由到您的目的地。"
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">代理提示词<br><small class=\"diagram-muted\">\"add an NPS question\"</small></div><div class=\"diagram-node\">可视化编辑器<br><small class=\"diagram-muted\">标签、校验、顺序</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">create-form · update-form</span><small class=\"diagram-muted\">字段 JSON，设置 JSON</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">forms table<br><small class=\"diagram-muted\">通过 Drizzle 使用 SQL</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">公开填写页<br><small class=\"diagram-muted\">unauthenticated</small></div><div class=\"diagram-box\">responses<br><small class=\"diagram-muted\">+ Slack / webhook / 表格</small></div></div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## 你可以用它做什么

- **以对话方式构建表单。**“创建联系表单”、“添加 NPS 分数问题”、“将电子邮件字段设为必填”。代理更新表单架构，并从 SQL 支持的状态更新预览。
- **视觉上进行微调。**当您需要直接控制时，可以从构建器 UI 编辑标签、占位符、所需状态、选项和字段顺序。
- **使用附带的字段类型。**开箱即用地支持文本、电子邮件、数字、长文本、选择、多选、复选框、单选、日期、评级和比例字段。
- **收集回复。**每次提交都存储在 SQL 中，并带有每个回复的详细信息视图和用于审核条目的仪表板。
- **路由提交。**使用内置集成将提交有效负载发送到 webhooks、Slack、Discord 或 Google 表格。
- **发布公共表单。**分享公共表单 URL 并在提交后显示感谢消息。

## 开始使用

现场演示：[forms.agent-native.com](https://forms.agent-native.com)。

1. **根据提示创建表单。**询问您想要的表单，包括
   受众以及提交后会发生什么。
2. **在编辑器中优化。**调整标签、验证、选择和顺序
   直接编辑时的视觉生成器速度更快。
3. **发布并分享。**使用受访者公开表单 URL，然后观看
   结果到达响应视图。
4. **连接目的地。**将新提交内容路由至 Slack、Discord、Google
   工作表、webhooks 或您自己的扩展点。

### 有用的提示

- “创建包含角色、团队规模和优先用例的测试版注册表单。”
- “添加必填的 NPS 问题和自由文本后续问题。”
- “将每个新回复发布到产品 Slack 频道。”
- “总结本周提交的内容并按客户细分进行分组。”
- “在不丢失路由所需字段的情况下缩短此表单。”

## 对于开发者

本文档的其余部分适用于任何分叉表单模板或扩展它的人。

### 快速入门

```bash
npx @agent-native/core@latest create my-forms --standalone --template forms
cd my-forms
pnpm install
pnpm dev
```

对于包含 Forms 和其他应用程序的工作区：

```bash
npx @agent-native/core@latest create my-platform
```

在工作区设置过程中选择您想要的表单和任何其他模板。

### 主要功能 {#key-features}

**JSON 表单定义。** 字段位于一个 `fields` JSON 列中，因此代理可以进行外科手术编辑，而无需更改每种字段类型的架构。

**公共填写页面。**受访者可以提交未经身份验证的表单，而私人设置会在数据到达浏览器之前被删除。

**服务器端目标。** Slack、Discord、Google Sheets 和 Webhook 集成存在于表单设置中并在提交后运行。

### 数据模型

所有数据通过 Drizzle ORM 存储在 SQL 中。架构：`templates/forms/server/db/schema.ts`。表单携带标准 `ownableColumns` 和匹配的框架共享表，因此它们可以插入每用户/每组织共享模型。

| 表            | 它包含什么                                                                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forms`       | 表单定义 - `title`、`description`、唯一 `slug`、`fields`（`FormField` 的 JSON 数组）、`settings`（JSON `FormSettings`）、`status`（`draft` / `published` / `closed`），以及软删除 `deleted_at` |
| `responses`   | 每行一次提交 - `form_id`、`data` (JSON `{ fieldId: value }`)、`submitted_at`、可选的 `ip` 和 `submitter_email`                                                                                 |
| `form_shares` | 框架共享每个表单将主体（用户或组织）映射到角色（查看者、编辑者、管理员）的表                                                                                                                   |

`fields` 和 `settings` JSON 形状在 `templates/forms/shared/types.ts`（`FormField`、`FormSettings`）中定义。在任何数据通过 `toPublicFormSettings` 到达公共填充页面之前，所有者私有设置（例如集成 Webhook URL 和允许的来源）都会被删除。

```an-schema title="表单数据模型" summary="三张桌子。字段和集成是表单上的 JSON 列，因此代理的编辑是外科手术补丁，而不是跨表行更改。"
{
  "entities": [
    {
      "id": "forms",
      "name": "forms",
      "note": "A form definition (ownable)",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "title", "type": "string" },
        { "name": "description", "type": "string", "nullable": true },
        { "name": "slug", "type": "string", "note": "unique; public URL" },
        { "name": "fields", "type": "json", "note": "FormField[] — 所有字段类型" },
        { "name": "settings", "type": "json", "note": "FormSettings — 集成等" },
        { "name": "status", "type": "enum", "note": "草稿|发表 |关闭" },
        { "name": "deleted_at", "type": "datetime", "nullable": true, "note": "soft delete" },
        { "name": "owner_email", "type": "string" },
        { "name": "org_id", "type": "id", "nullable": true }
      ]
    },
    {
      "id": "responses",
      "name": "responses",
      "note": "每行一次提交",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "form_id", "type": "id", "fk": "forms.id" },
        { "name": "data", "type": "json", "note": "{ fieldId: value }" },
        { "name": "submitted_at", "type": "datetime" },
        { "name": "ip", "type": "string", "nullable": true },
        { "name": "submitter_email", "type": "string", "nullable": true }
      ]
    },
    {
      "id": "form_shares",
      "name": "form_shares",
      "note": "框架份额表——每个表格的角色原则",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "form_id", "type": "id", "fk": "forms.id" },
        { "name": "principal", "type": "string", "note": "user or org" },
        { "name": "role", "type": "enum", "note": "观众|编辑|行政" }
      ]
    }
  ],
  "relations": [
    { "from": "forms", "to": "responses", "kind": "1-n", "label": "has responses" },
    { "from": "forms", "to": "form_shares", "kind": "1-n", "label": "has share grants" }
  ]
}
```

### 密钥actions

每个操作都是`templates/forms/actions/`中的一个TypeScript文件，自动挂载在`POST /_agent-native/actions/:name`：

- `create-form` — 创建一个新表单（标题、描述、字段、设置）
- `update-form` — 更新字段、设置或状态
- `get-form` — 通过 id 或 slug 检索表单
- `list-forms` — 列出可访问的表单
- `delete-form` — 软删除（设置 `deleted_at`）
- `restore-form` — 恢复软删除的表单
- `list-responses` — 列出带有可选过滤器的表单提交内容
- `export-responses` — 将响应导出为 CSV 或 JSON

### 自定义

首先向代理询问发货行为：

- “为首选联系方式添加必填单选字段。”
- “将每个新提交发布到 Slack。”先通过[Messaging](/docs/messaging)连接Slack。
- “为我们的 CRM 添加 Webhook 目标。”
- “创建一个具有 1-10 等级和长文本跟进的客户反馈表。”
- “将某些表单设为公开，其他表单仅供登录。”

如果您需要文件上传、签名或自定义字段小部件等新功能，请将它们视为模板扩展：将 SQL 形状、actions、UI 编辑器控件、公共渲染器支持和代理指令添加在一起。请参阅 [Creating Templates](/docs/creating-templates) 了解当前的构建模式。

## 下一步是什么

- [**Templates**](/docs/cloneable-saas) — 克隆自有模型
- [**Actions**](/docs/actions) — 为构建器提供动力的动作系统
- [**Messaging**](/docs/messaging) — Slack 和其他提交目的地
