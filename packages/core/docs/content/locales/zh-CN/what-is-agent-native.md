---
title: "Agent-Native是什么？"
description: "为什么大多数人工智能应用感觉是半成品，是什么让应用真正成为代理原生的，以及最终的结果是你的日常体验。"
---

# Agent-Native是什么？

原生代理是一种构建软件的方式，其中人工智能代理及其周围的产品表面是**平等的合作伙伴**。该表面可以是具有一个自定义操作的无头代理、丰富的聊天或完整的 UI。重要的是代理和人类共享相同的 actions、数据库和状态。

如果您只记得本页中的一件事，请记住这一点：当今大多数人工智能应用程序都离实用性差一步，而这一差距是目前该领域最大的错误。

## 作为一个用户是什么样的 {#what-it-looks-like}

想象一个后台工作人员、收件箱、日历、表单生成器或分析仪表板。有时还没有自定义屏幕：您运行一项操作或一项无头应用程序代理提示。有时，第一个屏幕是聊天：您询问您想要什么，代理指导设置，显示表格或图表，并打开正确的应用程序视图。有时聊天会停靠在完整应用程序的右侧。通过这些形状，您可以：

- **从实际操作开始。**一个持久操作可以从 CLI、HTTP、MCP、A2A、应用程序代理循环以及稍后的 UI 运行。
- **单击存在 UI 时通常单击的任何内容。**所有按钮、列表、仪表板、键盘快捷键 - 它们都调用代理可以调用的相同操作。
- **或者只是询问。** 在代理中输入“回复 Sara 的电子邮件，说我会在 3 点前到达”。它会打开正确的线程，起草回复，然后将其显示给您以供批准 - 就像您手动完成的一样。
- **查看它看到的内容。** 打开一封电子邮件，代理就知道是哪一封。选择一个图表，代理就知道是哪个图表。突出显示一个段落并按 Cmd+I，代理将仅对该段落执行操作。
- **观察它的工作。** 当代理执行操作（打开视图、编辑草稿、运行报告）时，UI 会实时更新。您可以随时停止它、重定向它或用鼠标接管。
- **像队友一样引导它。**提供反馈、排队另一个任务、编辑其指令、审核它昨天做了什么。它会记住，并且随着时间的推移，它会更好地适应您的工作流程。

这就是 agent-native 的设计初衷。这就是大多数产品无法实现这一目标的原因。

## 为什么大多数“人工智能应用程序”都达不到要求（阶梯原理） {#the-ladder}

大多数团队都在攀登，就像梯子一样，而且大多数人过早地停止了一级。

### 第 1 阶 — 单个 LLM 调用（反模式） {#rung-one}

文本框发送提示，AI 返回字符串，然后您显示它。也许用旋转器。用户无法纠正路线，人工智能无法采取行动，无法了解发生了什么或为什么。

您随处可见：“AI 功能”基本上是固定在 SaaS 产品上的“总结”按钮。它们在演示中看起来令人印象深刻，并在现实变得混乱时打破了这一点。那不是一个产品；而是一个产品。那是一个玩具。

### 梯级 2 — 使用工具聊天 {#rung-two}

现在人工智能可以*做事*。它有工具——“电子邮件草稿”、“搜索联系人”、“运行查询”——以及一个聊天界面，它在你面前工作，显示工具调用和结果。这就是 Claude、ChatGPT 和 Cursor 在底层的样子。

这是真正的进步。但就其本身而言，它仍然是一个聊天窗口。没有正确的 UI。没有仪表板、没有列表、没有表单、没有键盘快捷键、没有团队协作。如果人工智能感到困惑，你就会陷入重新输入的困境，而不仅仅是点击正确的按钮。非开发人员很难以这种格式完成真正的工作。

### 第 3 级 — 代理人 + UI 作为平等合伙人 {#rung-three}

这是代理原生的。您可以在代理周围添加一个真实的、功能齐全的应用程序 - 至关重要的是，代理可以执行的每个操作也是 UI 中的一个按钮，并且用户单击的每个按钮都运行代理使用的相同逻辑。一种实现，两种方式。

当您到达第 3 级时，三件事会发生变化：

- **您停止向聊天机器人添加按钮。您向应用程序添加了代理。** 这对双方来说都是质量更高的产品。
- **代理具有真实的上下文。**它可以看到您正在查看的内容、您选择的内容以及您刚刚执行的操作。它写入 UI 读取的同一个数据库，因此它的工作会立即显示。
- **外部代理也可以使用它。**其他代理本机应用程序可以通过 [A2A protocol](/docs/a2a-protocol) 调用此 actions。 Claude代码、Codex、ChatGPT自定义MCP应用程序、光标和其他MCP主机可以将其作为[MCP server](/docs/mcp-protocol)驱动。一个应用程序，多个入口点。

这是第 3 级。这是代理本地的。

```an-diagram title="阶梯原理" summary="大多数团队停在第 1 级或第 2 级。原生代理是第 3 级——一个真实的应用程序和一个共享操作界面上的真实代理。"
{
  "html": "<div class=\"diagram-ladder\"><div class=\"diagram-card rung rung-3\"><span class=\"diagram-pill accent\">第 3 阶 · agent-native</span><strong>代理 + UI 作为平等伙伴</strong><small class=\"diagram-muted\">One action surface. Every agent tool is also a button; every button runs the same logic the agent uses.</small></div><div class=\"diagram-card rung rung-2\"><span class=\"diagram-pill\">第 2 阶</span><strong>带工具的聊天</strong><small class=\"diagram-muted\">代理可以行动，但它仍只是聊天窗口。没有仪表盘、列表或快捷键。</small></div><div class=\"diagram-card rung rung-1\"><span class=\"diagram-pill warn\">第 1 阶</span><strong>一次 LLM 调用</strong><small class=\"diagram-muted\">Prompt in, string out. Impressive in a demo; breaks the moment reality gets messy.</small></div></div>",
  "css": ".diagram-ladder{display:flex;flex-direction:column;gap:14px}.diagram-ladder .rung{display:flex;flex-direction:column;gap:6px;padding:16px 18px}.diagram-ladder .rung-2{margin-inline-end:48px}.diagram-ladder .rung-1{margin-inline-end:96px}"
}
```

请参阅 [Key Concepts — Protocols](/docs/key-concepts#protocols)，了解所有这些如何挂在同一操作定义上。

## 为什么每个代理都需要 UI {#why-every-agent-needs-a-ui}

即使代理完成了所有繁重的工作，人类仍然需要：

- **看看它在做什么** - 进度、中间输出、它触及了什么
- **引导它** — 提供反馈、中断、对下一个任务进行排队
- **管理它** - 编辑其指令、skills、内存、计划作业、连接的帐户
- **检查其工作**——审查草稿、审核历史记录、回滚错误
- **分享其输出** - 仪表板、报告、表单、发送给队友的链接

至少，“代理的 UI”是一个可观察性和管理仪表板。最多，它是一个完整的 SaaS 应用程序，其中嵌入了代理作为副驾驶。两端都算作原生代理，并且表面可以从一端增长而无需重写。

您不必预先选择形状。代理可以无头运行，坐在丰富的聊天后面，或者住在围绕同一操作界面的完整应用程序中 - 请参阅 [Agent Surfaces](/docs/agent-surfaces) 了解具体形状和 API。

## 为什么每个应用都受益于代理 {#why-every-app-benefits-from-an-agent}

另一面也同样重要。现有的 SaaS 产品总是遇到同样的问题：80% 的产品你需要的效果很好，而 20% 的产品你就是无法改变。添加聊天侧边栏很少能解决这个问题——聊天通常无法真正\_做\_UI 可以做的事情。

代理本机翻转了这一点。由于应用程序中的每个操作都定义一次，并作为按钮和代理工具公开，因此代理可以执行按钮可以执行的所有操作（甚至更多），而无需维护单独的“AI 世界”。自然语言与点击一起成为一流的输入。

这个论点不是“代理取代 UI”。它是“**代理属于应用程序内部，顶部有 UI，作为平等的合作伙伴**。”即使代理是产品的应用程序仍然需要 UI 供人类监督、配置和引导 - 请参阅 [Agent Surfaces — Headless](/docs/agent-surfaces#headless)。

## 代理+UI奇偶校验 {#agent-ui-parity}

这是定义原则。

> **来自 UI** — 单击按钮、填写表格、导航视图。 UI写入数据库；代理看到结果。
>
> **来自代理** — 自然语言，其他代理通过 A2A、Slack、Telegram。代理写入数据库； UI 自动更新。

```an-diagram title="一套系统，两种方式" summary="代理和 UI 写入相同的操作和相同的数据库。无论一个人做什么，另一个人都会看到。"
{
  "html": "<div class=\"diagram-parity\"><div class=\"diagram-col\"><div class=\"diagram-node\">Human<br><small class=\"diagram-muted\">点击、表单、快捷键</small></div><div class=\"diagram-node\">Agent<br><small class=\"diagram-muted\">自然语言 · A2A · Slack</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Actions</span><small class=\"diagram-muted\">defined once</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">SQL 数据库</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-box\">界面实时更新</div></div>",
  "css": ".diagram-parity{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-parity .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-parity .diagram-arrow{font-size:22px;line-height:1}.diagram-parity .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

当代理创建电子邮件草稿时，它会显示在 UI 中。当您单击“发送”时，代理就知道它已发送。没有单独的“代理世界”和“UI 世界”——它是一个系统。请参阅 [Key Concepts](/docs/key-concepts) 了解实现此功能的架构。

## 通常为电动工具保留定制 {#workspace-customization}

像 Claude Code 这样的工具之所以如此强大，并不是因为模型，而是**定制层**：每个项目的指令、skills、内存、子代理、连接的服务。您可以根据您的代码库、您的偏好、您的团队来塑造代理。

Agent-native 为每个用户提供相同的自定义层 - 无需离开应用程序。每个应用程序都附带一个个人**工作区**，您（或团队中的任何人）可以：

- 编辑每个代理都会读取的团队范围规则
- 让代理在您更正时自动记住偏好
- 将可重用的操作指南编写为 `/slash` 命令
- 为特定任务保留自定义子代理（使用 `@mentions` 调用）
- 安排作业在 cron 上运行（例如“每周一早上，总结上周”）
- 通过每用户 MCP 服务器连接外部服务（Gmail、Stripe、Slack、内部 API）

不同之处：它全部存储在数据库中，而不是文件系统中。没有需要启动的开发环境，每个用户没有容器。每个用户都可以获得自己的完整工作空间 - 个人内存、个人联系、个人 skills - 基本上免费，因为它是表中的所有行。这就是 Claude 代码级灵活性在真正的多租户 SaaS 产品中可行的原因。

请参阅 [Workspace](/docs/workspace) 了解完整概念。

## 有何不同 {#what-makes-it-different}

| 方法                              | 描述                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| **搭载人工智能的传统应用**        | 人工智能是事后的想法。仅限于自动完成、摘要或聊天侧边栏，实际上无法在应用程序中执行任何操作。      |
| **纯聊天/代理界面**               | 强大但难以接近。没有仪表板，没有工作流程，没有持久性。非开发人员无法有效使用它们。                |
| **Claude 代码 / Codex 用于 SaaS** | 非常适合开发者在自己的机器上使用。不会转化为多租户 SaaS — 开发盒上每个用户一个代码库无法扩展。    |
| **代理本机应用**                  | 代理人是一等公民。它共享相同的数据库、相同的状态，并且可以执行 UI 可以执行的所有操作 - 反之亦然。 |

## 整个团队的发展 {#whole-team-development}

Agent-native 不仅仅适合开发人员。由于代理可以编辑应用程序自己的代码，因此开发应用程序不再是仅限开发人员的活动：

- **设计师**通过代理直接在运行的应用程序中更新设计
- **产品经理**通过描述来添加功能和更新流程
- **QA** 测试应用并要求代理修复损坏的内容
- **团队中的任何人**通过自然语言做出贡献

愿景：减少交接，一个人完成小团队的工作。

## 分叉并自定义 {#fork-and-customize}

代理本机应用程序遵循分叉和自定义模型。您从**模板**开始 - 日历、内容、幻灯片、分析、邮件、剪辑、设计、表单、调度 - 并将其变成您的。每一个都是一个完整的、可工作的 SaaS 产品，您可以批量分叉，而不是一个空白的脚手架：

1. 在[agent-native.com/templates](/templates)上选择模板
2. 立即将其用作托管应用程序（例如 mail.agent-native.com）
3. 当您想要自定义时分叉它 - “连接我们的 Stripe 帐户”、“添加同类图表”
4. 代理修改代码以满足您的需求
5. 将您的分叉部署到您自己的域 - 或留在agent-native.com

因为它是*您的*应用程序，而不是共享基础设施，所以代理可以安全地改进代码。您的应用程序会随着您的使用而不断改进。完整故事请参见 [Templates](/docs/cloneable-saas)。

尚未准备好分叉整个模板？您还可以通过向已使用的编码代理添加**技能**来尝试代理原生 - 使用 `npx @agent-native/core@latest skills add visual-plan` 安装计划技能。请参阅 [Skills Guide](/docs/skills-guide#app-backed-skills)。

## 可组合代理 {#composable-agents}

代理本机应用程序可以相互通信。在邮件应用程序内部，您可以标记分析代理以查询数据并将结果包含在草稿电子邮件中。代理会发现其他可用代理，在彼此之间移交工作，并在您已经所在的 UI 中显示结果。

这由 [A2A](/docs/a2a-protocol) 和 [MCP](/docs/mcp-protocol) 提供支持 - 相同的定义，多个表面 - 但作为用户，您所需要知道的是“我可以向我的任何应用程序寻求任何他们可以做的事情的帮助。”

## 这在代码中是什么样的？ {#what-does-it-look-like-in-code}

如果您正在构建或扩展代理本机应用程序，那么中心模式如下：应用程序中的每个操作都是一个**操作** - 定义一次，可供代理和 UI 使用。

```an-annotated-code title="一个动作，定义一次"
{
  "filename": "actions/reply-to-email.ts",
  "language": "ts",
  "code": "import { defineAction } from \"@agent-native/core/action\";\nimport { z } from \"zod\";\n\nexport default defineAction({\n  description: \"Reply to an email thread\",\n  schema: z.object({ emailId: z.string(), body: z.string() }),\n  run: async ({ emailId, body }) => {\n    // db and schema come from your app's server/db setup\n    await db.insert(schema.replies).values({ emailId, body });\n  },\n});",
  "annotations": [
    { "lines": "5", "label": "工具表面", "note": "`description` 是代理读取的内容，以决定何时将其调用为工具。" },
    { "lines": "6", "label": "类型化契约", "note": "一个 zod `schema` 会验证来自**每个**界面的输入：代理、UI、HTTP、MCP 和 A2A。" },
    { "lines": "7-10", "label": "一次实施", "note": "`run` 主体是唯一的事实来源。 UI 按钮和代理工具都执行此操作。" }
  ]
}
```

```tsx
// In any React component — same action, called from a button
const { mutate } = useActionMutation("reply-to-email");

<Button onClick={() => mutate({ emailId, body: "Thanks!" })}>
  Send Reply
</Button>;
```

```tsx
// And the agent panel mounted anywhere in your app
import { AgentSidebar } from "@agent-native/core/client";

<AgentSidebar />;
```

一个操作，多个表面：代理将其称为工具，UI 将其称为类型安全突变，[native chat](/docs/native-chat-ui) 可以呈现显式小部件结果，外部代理通过 [A2A](/docs/a2a-protocol) 访问它，MCP 主机通过应用程序的 [MCP server](/docs/mcp-protocol) 调用它，可选地使用 MCP 应用程序 UI 资源和标准远程 MCP OAuth由框架处理。完整参考请参见 [Actions](/docs/actions)。

## 下一步是什么 {#whats-next}

- [**Getting Started**](/docs/getting-started) — 从一个操作开始，选择一个模板，或安装一项技能
- [**Agent Surfaces**](/docs/agent-surfaces) — 选择无头、丰富的聊天、嵌入式边车或完整应用
- [**Key Concepts**](/docs/key-concepts) — 架构：SQL、actions、轮询同步、上下文感知、可移植性
- [**Templates**](/docs/cloneable-saas) — 模板作为您拥有的完整产品
- [**Workspace**](/docs/workspace) - 由 SQL 支持的每用户自定义层（skills、内存、指令、MCP），而不是文件
- [**Dispatch**](/docs/dispatch) — 工作区控制平面：秘密库、Slack/电子邮件收件箱、跨应用委派
- [**Extensions**](/docs/extensions) - 代理立即创建的沙盒迷你应用程序，无需更改代码
- [**Drop-in Agent**](/docs/drop-in-agent) — 将 `<AgentPanel>` 安装到任何 React 应用中
