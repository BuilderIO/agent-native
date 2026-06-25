---
title: "原生聊天 UI"
description: "操作声明的本机聊天渲染器、可重用的 DataTable/DataChart 输出，以及 BYO 代理运行时应如何连接到 Agent-Native 聊天。"
---

# 原生聊天 UI

本机聊天 UI 是第一方代理输出的应用内渲染路径。一个
操作返回结构化JSON，聊天运行时识别显式小部件
判别式，`<AssistantChat>`在
对话。您不会为
正常的应用聊天。

当用户应该检查代理所在位置的输出时，使用本机聊天 UI
已经讲过：查询结果、响应见解、设置摘要，
批准/拒绝控制，或应用程序视图的链接。使用[MCP Apps](/docs/mcp-apps)
当外部主机（例如 Claude、ChatGPT、Copilot 或 Cursor）应该渲染时
来自您的应用的内联路由。

```an-diagram title="原生渲染路径" summary="操作返回 JSON；运行时匹配显式小部件判别式或 chatUI.renderer； AssistantChat 安装真实的 React 组件。没有 iframe，没有 HTML 执行。"
{
  "html": "<div class=\"diagram-render\"><div class=\"diagram-node\">Action 运行<br><small class=\"diagram-muted\">返回结构化 JSON</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">Match</span><small class=\"diagram-muted\">explicit widget &middot; chatUI.renderer</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">&lt;AssistantChat&gt;<br><small class=\"diagram-muted\">挂载 React widget</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card col\"><div class=\"diagram-pill ok\">DataTable</div><div class=\"diagram-pill ok\">DataChart</div><div class=\"diagram-pill ok\">DataInsights</div></div></div>",
  "css": ".diagram-render{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-render .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-render .col{display:flex;flex-direction:column;gap:6px;padding:12px}.diagram-render .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 动作声明的小部件 {#action-declared-widgets}

本机路径有两个显式部分：

- `outputSchema` 验证操作的响应形状。
- `chatUI.renderer` 为验证结果选择原生 React 渲染器。

内置数据渲染器使用普通的 JSON 结果和 `widget` 加上
匹配有效负载：

| 小部件            | 所需的有效负载              | 渲染为                        |
| ----------------- | --------------------------- | ----------------------------- |
| `"data-table"`    | `table`                     | 原生的、可重用的数据表        |
| `"data-chart"`    | `chartSeries`               | 原生条形图、折线图或面积图    |
| `"data-insights"` | `table` 和/或 `chartSeries` | 带有图表/表格输出的组合洞察卡 |

服务器 actions 应从
`@agent-native/core/data-widgets`；客户端代码可以从
`@agent-native/core/client/chat` 或 `@agent-native/core/client`。

```ts
import { defineAction } from "@agent-native/core/action";
import { ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER } from "@agent-native/core/action-ui";
import {
  createDataInsightsWidgetResult,
  dataInsightsWidgetResultSchema,
} from "@agent-native/core/data-widgets";

export default defineAction({
  description: "Analyze form responses.",
  readOnly: true,
  outputSchema: dataInsightsWidgetResultSchema,
  chatUI: {
    renderer: ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER,
    title: "Response insights",
  },
  run: async () =>
    createDataInsightsWidgetResult({
      title: "Response insights",
      display: {
        title: "42 responses",
        description: "Completion rate rose this week.",
        primaryAction: {
          label: "Open response insights",
          href: "/response-insights",
        },
      },
      chartSeries: {
        type: "bar",
        title: "Responses by day",
        xKey: "day",
        series: [{ key: "responses", label: "Responses" }],
        data: [
          { day: "Mon", responses: 8 },
          { day: "Tue", responses: 13 },
        ],
      },
      table: {
        title: "Top answers",
        columns: [
          { key: "answer", label: "Answer" },
          { key: "count", label: "Count", align: "right" },
        ],
        rows: [
          { answer: "Yes", count: 31 },
          { answer: "No", count: 11 },
        ],
        totalRows: 2,
      },
    }),
});
```

```an-callout
{
  "tone": "success",
  "body": "仅当操作声明 `chatUI`**或**结果携带显式已知的 `widget` 判别式时，渲染器才会接管。它从不形​​状推断任意对象，也从不从工具结果执行 HTML 或 JavaScript - 因此本机小部件不能成为注入向量。"
}
```

当用户请求图表、图形、表格、趋势或精简报告时，应用代理
应该更喜欢声明这些本机渲染器之一的操作。决赛
辅助文本应保持简短并让小部件携带数据；请勿复制
除非用户明确要求输入文本，否则将相同的行放入 Markdown 表中
导出。

当不存在域操作但代理已检索紧凑时，
真实的数据，它可以通过以下方式调用框架`render-data-widget`操作
相同的 `data-table`、`data-chart` 或 `data-insights` JSON 形状。仅此操作
验证并渲染小部件；它不是数据源，不得使用
发明占位符指标。

## 数据表输出 {#data-table}

`table` 故意简单化，以便列出、SQL、分析和设置 actions 可以
重复使用它：

```ts
{
  title?: string;
  columns: Array<{ key: string; label: string; align?: "left" | "right" }>;
  rows: Array<Record<string, unknown>>;
  totalRows?: number;
  sampledRows?: number;
  truncated?: boolean;
}
```

更喜欢稳定的列键和 JSON 安全的行值。使用`totalRows`，
当操作显示较大切片时为 `sampledRows` 和 `truncated`
结果集。

## 数据图表输出 {#data-chart}

`chartSeries` 支持座席答案中使用的常见图表形状，无需
要求每个模板提供自己的聊天渲染器：

```ts
{
  type: "bar" | "line" | "area";
  title?: string;
  xKey: string;
  series: Array<{ key: string; label: string; color?: string }>;
  data: Array<Record<string, unknown>>;
  sampled?: boolean;
}
```

保持图表数据紧凑。对于大型数据集，在操作和链接中聚合
到包含 `display.primaryAction` 或操作 `link` 元数据的完整应用视图。

## 本机小部件与 MCP 应用程序 {#native-vs-mcp-apps}

本机聊天小部件和 MCP 应用程序是互补的：

- **本机小部件**用于应用程序自己的聊天运行时。动作结果为
  JSON，框架渲染内置的React小部件。
- **MCP 应用程序**适用于外部主机。该操作声明 `mcpApp` 并且通常
  `link`，并且主机在支持时内联渲染真实的应用程序路由。
- **深层链接**仍然是通用的后备方案。使用操作 `link` 或
  `display.primaryAction`、CLI 客户端、较旧的 MCP 主机和纯文本记录
  读者可以打开完整的应用视图。

当本机小部件负载和 MCP 应用元数据都存在时，应用内
聊天更喜欢本机小部件。外部主机使用 MCP Apps 资源或
深层链接回退。

## 自定义原生渲染器 {#custom-native-renderers}

通过精确的渲染器 ID 注册特定于产品的组件，然后声明该 ID
关于行动：

```tsx
import { registerActionChatRenderer } from "@agent-native/core/client/chat";

registerActionChatRenderer({
  id: "crm.deal-card",
  renderer: "crm.deal-card",
  Component: ({ context }) => <DealCard result={context.resultJson} />,
});
```

```ts
export default defineAction({
  description: "Show a deal card.",
  outputSchema: dealCardSchema,
  chatUI: { renderer: "crm.deal-card" },
  run: async () => ({ dealId: "deal_123", amount: 42000 }),
});
```

将此用于第一方应用程序 UI。在`mcpApp`中保留跨主机iframe UI，并保留
在聊天中键入读取 actions 而不是原始 SQL 后执行任意查询。

## BYO 代理运行时 {#byo-agent-runtimes}

`AgentChatRuntime` 是聊天 shell 的自带代理合约，并且
本节是其规范参考。它允许您在其他地方构建代理
将标准化事件流式传输到 Agent-Native 的对话 UI 中，同时保持
共享作曲家、脚本渲染、工具卡、批准、本机小部件，
和周围的应用程序布局。 [Drop-in Agent](/docs/drop-in-agent#custom-chat-ui)
此处为运行时故事的教程点，以及 [Component API](/docs/components#agent-chat-ui)
列出每个连接器和适配器及其导入路径；合约本身是
如下所述。

```an-diagram title="BYO 运行时保留 Agent-Native 聊天 shell" summary="您的外部代理通过连接器传输标准化事件； Agent-Native 保留作曲家、成绩单、工具卡、批准和本机小部件。"
{
  "html": "<div class=\"diagram-byo\"><div class=\"diagram-box\" data-rough>你的代理<br><small class=\"diagram-muted\">OpenAI &middot; Claude &middot; Vercel AI &middot; AG-UI &middot; HTTP</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">connector</span><small class=\"diagram-muted\">标准化 message-* / tool-* 事件</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card col\"><div class=\"diagram-pill\">&lt;AssistantChat runtime=&hellip; /&gt;</div><small class=\"diagram-muted\">composer &middot; transcript &middot; tool cards</small><small class=\"diagram-muted\">approvals &middot; native widgets</small></div></div>",
  "css": ".diagram-byo{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-byo .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-byo .col{display:flex;flex-direction:column;gap:6px;padding:14px}.diagram-byo .diagram-arrow{font-size:22px;line-height:1}"
}
```

所有连接器均从 `@agent-native/core/client/chat` 导出（以及根
`@agent-native/core/client` 条目）。当您的代理使用通用 HTTP 运行时
可以公开返回 SSE 或 NDJSON 运行时事件的 POST 端点：

```tsx
import {
  AssistantChat,
  createHttpAgentChatRuntime,
} from "@agent-native/core/client/chat";

const runtime = createHttpAgentChatRuntime({
  id: "external:mastra",
  label: "Mastra",
  endpoint: "/api/mastra/chat",
  headers: async () => ({
    Authorization: `Bearer ${await getAgentToken()}`,
  }),
});

export function SupportChat() {
  return <AssistantChat runtime={runtime} threadId="support" />;
}
```

如果您的端点已传输通用代理协议，请使用匹配的
连接器并跳过编写自定义映射器：

```ts
import {
  createAgUiChatRuntime,
  createClaudeAgentChatRuntime,
  createOpenAIAgentsChatRuntime,
  createOpenAIResponsesChatRuntime,
  createVercelAiChatRuntime,
} from "@agent-native/core/client/chat";

const openAiAgentsRuntime = createOpenAIAgentsChatRuntime({
  endpoint: "/api/openai-agents/chat",
});

const openAiResponsesRuntime = createOpenAIResponsesChatRuntime({
  endpoint: "/api/openai-responses/chat",
});

const claudeAgentRuntime = createClaudeAgentChatRuntime({
  endpoint: "/api/claude-agent/chat",
});

const vercelAiRuntime = createVercelAiChatRuntime({
  endpoint: "/api/vercel-ai/chat",
});

const agUiRuntime = createAgUiChatRuntime({
  endpoint: "/api/ag-ui/chat",
});
```

端点可以直接传输标准化事件形状：

```text
data: {"type":"message-start","message":{"id":"m1","role":"assistant","content":[]}}
data: {"type":"message-delta","messageId":"m1","delta":{"type":"text","text":"Hello"}}
data: {"type":"tool-start","toolCall":{"id":"t1","name":"query","input":{"q":"forms"}}}
data: {"type":"tool-done","toolCallId":"t1","toolName":"query","status":"completed","resultText":"34 rows"}
data: {"type":"done","reason":"complete"}
```

对于非常简单的代理，接受 JSON 响应 `{ "text": "..." }` 并且
转换为单个助理消息。对于更丰富的代理，请流式传输
`message-*`, `tool-*`, `approval-request`, `status`, `artifact`, `file`,
`usage`、`error` 和 `done` 事件。工具结果可以携带`mcpApp`或
`chatUI` 元数据，因此操作声明的本机小部件仍然会在没有
iframe。

当您希望内置 Agent-Native 传输作为运行时对象时，请使用：

```ts
import { createAgentNativeChatRuntime } from "@agent-native/core/client/chat";

const runtime = createAgentNativeChatRuntime({
  threadId: "forms-chat",
  mode: "act",
});
```

仅在需要完整时才使用`<AssistantChat createAdapter={...} />`
assist-ui 适配器控件。当您的产品时单独使用`PromptComposer`
拥有整个外部转录本并且只想要 Agent-Native 的作曲家
字段。

OpenAI、AG-UI、Claude Agent SDK 和 Vercel AI SDK 流可以使用标准
连接器助手。 ACP 保留编码代理/编辑器互操作性，而不是
最终用户的通用应用程序聊天运行时。此处未声明支持 A2UI；
如果它成熟，它应该适应这个相同的显式运行时/小部件契约。

## 相关文档 {#related-docs}

- [Actions](/docs/actions) — 定义返回本机小部件数据的操作。
- [Agent Surfaces](/docs/agent-surfaces) — 决定您是否需要无头、聊天、边车或完整应用程序。
- [Drop-in Agent](/docs/drop-in-agent) — 安装标准聊天运行时的教程。
- [Component API](/docs/components) — 用于聊天层、运行时和工具渲染器的每次导出 API 映射。
- [MCP Apps](/docs/mcp-apps) — 用于外部 MCP 主机的内联 UI。
- [Key Concepts](/docs/key-concepts#protocols) — 协议状态和定位。
