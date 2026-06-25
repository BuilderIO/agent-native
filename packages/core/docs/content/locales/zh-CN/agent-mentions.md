---
title: "代理提及"
description: "使用@提及在聊天中标记自定义代理、连接的代理和文件。"
---

# 代理提及

在聊天编辑器中键入 `@` 以提及自定义代理、连接的代理、文件和资源。

## 概述 {#overview}

`@` 提及系统将聊天编辑器连接到更广泛的代理生态系统。当您键入 `@` 时，会出现一个弹出窗口，列出可用的自定义代理、连接的代理、代码库文件和资源。

这是您通过单个聊天协调多代理工作流程的方式。要求您当地的 `@design` 代理评论布局，`@analytics` 从另一个应用程序中提取最新数据，主要代理可以将两者合并到一个对话中。

## 提及代理 {#mentioning-agents}

要在聊天编辑器中提及代理：

1. 输入 `@` 打开提及弹出窗口
2. 浏览或搜索可用代理列表
3. 选择一个代理 - 它在您的消息中显示为标签
4. 发送消息 - 服务器解析提及并将该代理的响应包含在对话上下文中

有两条代理路径：

- **自定义代理** — `agents/*.md` 中的本地工作区代理配置文件。它们使用代理配置文件的指令和可选模型覆盖在当前应用程序/运行时内运行。
- **连接的代理** — 远程 A2A 对等点。这些是通过 [A2A protocol](/docs/a2a-protocol) 调用的。

在这两种情况下，您的主要代理都会看到响应并可以引用或构建它。

```an-diagram title="@提及路由的位置" summary="服务器按类型拆分每个提及：自定义代理在本地运行，连接的代理通过 A2A - 两个响应都折叠回主代理的上下文中。"
{
  "html": "<div class=\"diagram-mention\"><div class=\"diagram-node\">@-mention<br><small class=\"diagram-muted\">in the composer</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">服务器解析</span><small class=\"diagram-muted\">extract refs by type</small></div><div class=\"diagram-col\"><div class=\"row\"><span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</span><div class=\"diagram-box\">自定义代理<br><small class=\"diagram-muted\">agents/*.md &middot; runs local</small></div></div><div class=\"row\"><span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</span><div class=\"diagram-box\">已连接代理<br><small class=\"diagram-muted\">A2A peer &middot; remote call</small></div></div></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box diagram-accent\">&lt;agent-response&gt;<br><small class=\"diagram-muted\">injected into main agent</small></div></div>",
  "css": ".diagram-mention{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-mention .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-mention .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-mention .row{display:flex;align-items:center;gap:8px}.diagram-mention .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 它是如何工作的 {#how-it-works}

当发送包含 `@` 提及的消息时，服务器上会发生以下情况：

1. 服务器从消息中提取提及引用
2. 对于每个提到的代理：
   - 自定义代理按照其配置文件说明在本地运行
   - 通过 A2A 调用连接的代理
3. 代理的响应被包装在 `<agent-response>` XML 块中并注入到对话上下文中
4. 主代理处理丰富的消息，查看用户的文本和提到的代理的响应

主代理在其上下文中看到的内容：

```text
User: Draft an email with the latest signup numbers. @analytics

<agent-response agent="analytics">
Last week's signups: 1,247 total
  - Organic: 623
  - Paid: 412
  - Referral: 212
</agent-response>
```

然后，主代理可以在其响应中自然地使用这些数据 - 例如，将这些数字合并到电子邮件草稿中。

```an-callout
{
  "tone": "info",
  "body": "Mentioned-agent output arrives as an `<agent-response agent=\"…\">` block in the **main agent's** context — not as separate chat bubbles. The main agent decides how to weave it into the reply."
}
```

## 添加代理 {#adding-agents}

可以通过多种机制提及代理：

- **自定义工作区代理** — 在“工作区”选项卡中创建代理配置文件为 `agents/*.md`
- **自动发现** - 框架自动发现在已知端口或配置的 URL 上运行的连接代理
- **远程清单** — 添加连接代理清单为 `remote-agents/*.json`

### 自定义工作区代理

自定义代理是存储在工作区中的 Markdown 文件：

```markdown
---
name: Design
description: Reviews layouts, product UX, and visual direction.
model: inherit
---

You are a focused design agent.
```

请参阅 [Workspace — Custom Agents](/docs/workspace#custom-agents) 了解完整格式（包括 `tools`、`delegate-default` 和模型覆盖）。

您可以使用以下方法从“工作区”选项卡创建它们：

- `Create Agent` -> `Describe It`
- `Create Agent` -> `Fill Form`

### 连接代理清单

远程 A2A 代理仍然使用 JSON 清单：

```json
// remote-agents/analytics.json
{
  "name": "Analytics Agent",
  "url": "https://analytics.example.com",
  "apiKey": "env:ANALYTICS_A2A_KEY",
  "description": "Runs analytics queries and returns data",
  "skills": ["run-query", "generate-chart"]
}
```

---

## 对于开发者：扩展提及 {#extending-mentions}

模板可以注册自定义提及提供程序，以添加代理和文件之外的特定于域的可提及项目。提及提供者实现了 `MentionProvider` 接口：

```an-annotated-code title="自定义 MentionProvider"
{
  "filename": "server/mentions/contacts.ts",
  "language": "ts",
  "code": "import type { MentionProvider } from \"@agent-native/core/server\";\n\nconst contactsProvider: MentionProvider = {\n  id: \"contacts\",\n  label: \"Contacts\",\n\n  // 搜索 for mentionable items\n  async search(query: string) {\n    const contacts = await db.query.contacts.findMany({\n      where: like(contacts.name, `%${query}%`),\n      limit: 10,\n    });\n    return contacts.map((c) => ({\n      id: c.id,\n      label: c.name,\n      description: c.email,\n      type: \"contact\",\n    }));\n  },\n\n  // Resolve a mention into context for the agent\n  async resolve(id: string) {\n    const contact = await db.query.contacts.findFirst({\n      where: eq(contacts.id, id),\n    });\n    return {\n      type: \"context\",\n      text: `Contact: ${contact.name} (${contact.email})`,\n    };\n  },\n};",
  "annotations": [
    { "lines": "4-5", "label": "身份", "note": "`id` namespaces the provider; `label` is the section heading shown in the `@` popover." },
    { "lines": "8-9", "label": "search", "note": "Runs as the user types after `@`. Return up to a handful of matches as `{ id, label, description, type }`." },
    { "lines": "23-24", "label": "resolve", "note": "Called when the message is sent. Turns a picked id into `{ type: \"context\", text }` that is injected into the agent's context." }
  ]
}
```

在代理聊天插件配置中注册提供商：

```ts
// server/plugins/agent-chat.ts
import { createAgentChatPlugin } from "@agent-native/core/server";

export default createAgentChatPlugin({
  actions: scriptRegistry,
  systemPrompt: "You are a helpful assistant...",
  mentionProviders: { contacts: contactsProvider },
});
```

自定义提及提供程序与内置代理和文件提供程序一起显示在提及弹出窗口中。

## 引用文件 {#referencing-files}

`@` 弹出窗口不仅限于代理。您还可以参考：

- **代码库文件** — 输入 `@` 并搜索文件名。文件内容包含在代理的上下文中，因此它可以读取、分析或修改文件。
- **工作空间资源** — 在“工作空间”选项卡中定义的参考文件。这些可以是数据文件、配置或任何其他结构化内容。
- **Skills** — 输入 `/` 来引用技能。 Skills 提供结构化指令来指导代理如何处理任务。

所有引用类型都遵循相同的模式：从弹出窗口中进行选择，发送消息时引用的内容将被解析并注入到代理的上下文中。

## 子代理选择 {#sub-agent-selection}

当使用 `agent-teams` 生成子代理时，主代理还可以使用自定义代理（操作：“spawn”）。

传递`agent`参数以从`agents/*.md`中选择配置文件。该配置文件的指令将添加到委托运行中，并且其 `model` frontmatter 可以覆盖该子代理的默认模型。
