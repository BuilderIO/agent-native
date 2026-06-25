---
title: "自动化"
description: "具有自然语言条件的事件触发和计划自动化"
---

# 自动化

**自动化**是一条规则：_当 X 发生时，执行 Y_ — 用自然语言描述。代理执行指令，因此自动化可以访问代理可以在交互式聊天中使用的每个操作、工具和 MCP 服务器。

自动化通过 `web-request` 工具使用**事件触发器**、**自然语言条件**和**出站 HTTP** 扩展 [recurring jobs](/docs/recurring-jobs)。它们使用与重复作业相同的 `jobs/<name>.md` 文件格式、存储和“创建三种方式”工作流程 - 请参阅 [Recurring Jobs](/docs/recurring-jobs#job-file) 了解共享格式。本页面仅涵盖事件驱动自动化的新增内容。

```an-diagram title="当X发生时，做Y" summary="总线上触发事件，可选的自然语言条件对其进行门控，代理运行具有完整工具访问权限的自动化主体。"
{
  "html": "<div class=\"auto-flow\"><div class=\"diagram-card\"><span class=\"diagram-pill\">Event</span><small class=\"diagram-muted\"><code>calendar.booking.created</code></small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">Condition</span><small class=\"diagram-muted\">Haiku checks: &ldquo;email ends with @builder.io&rdquo;</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card accent\"><span class=\"diagram-pill accent\">代理运行 body</span><small class=\"diagram-muted\">actions &middot; web-request &middot; MCP &middot; sub-agents</small></div></div>",
  "css": ".auto-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.auto-flow .diagram-card{display:flex;flex-direction:column;gap:4px;padding:14px 16px;min-width:180px}.auto-flow .diagram-arrow{font-size:22px}"
}
```

## 两种触发器类型 {#trigger-types}

| 类型       | 触发时                            | 关键字段           |
| ---------- | --------------------------------- | ------------------ |
| `schedule` | cron 表达式匹配（与重复作业相同） | `schedule`（cron） |
| `event`    | 框架事件总线上发出匹配的事件      | `event`（姓名）    |

事件触发器可以包含 `condition`——Haiku 在调度之前根据事件负载评估的自然语言字符串。如果条件不匹配，则自动跳过自动化。

## 创建自动化 {#creating}

### 通过询问代理

> “当有人使用 @builder.io 电子邮件预订会议时，请通过 Slack 向我发送消息。”

代理发现可用事件，确认计划，并为您编写自动化。

### 来自设置UI

自动化出现在设置面板中。用户可以在那里查看、启用/禁用和删除它们。

第三条路径 - 通过 `resourcePut` 手动写入 `jobs/<name>.md` 文件 - 与 [recurring jobs](/docs/recurring-jobs#creating) 的工作方式完全相同。对于事件驱动的自动化，您可以将下面的事件触发 frontmatter 添加到同一文件中。事件触发作业设置 `schedule: ""` 并提供 `triggerType: event`、`event` 名称和可选的 `condition`：

```an-annotated-code title="事件触发的自动化"
{
  "filename": "jobs/slack-on-builder-booking.md",
  "language": "markdown",
  "code": "---\nschedule: \"\"\nenabled: true\ntriggerType: event\nevent: calendar.booking.created\ncondition: \"attendee email ends with @builder.io\"\nmode: agentic\ndomain: calendar\nrunAs: creator\n---\nSend a Slack message to #sales with the booking details.\nUse the web-request tool to POST to ${keys.SLACK_WEBHOOK}.",
  "annotations": [
    { "lines": "2", "label": "没有计划任务", "note": "Event triggers set `schedule` to `\"\"` — the cron field stays empty." },
    { "lines": "4-5", "label": "触发器", "note": "`triggerType: event` 加上 `event` 名称将此自动化订阅到总线。" },
    { "lines": "6", "label": "门", "note": "可选的自然语言 `condition`，由 Haiku 在调度之前根据有效负载进行评估。" },
    { "lines": "12", "label": "服务器端秘密", "note": "`${keys.SLACK_WEBHOOK}` is resolved server-side — the raw value never enters the agent's context." }
  ]
}
```

## 自动化前沿 {#frontmatter}

自动化共享 [recurring-jobs frontmatter table](/docs/recurring-jobs#frontmatter) 中的每个字段。这些附加字段控制事件触发器、条件和执行模式：

| 字段          | 类型                             | 默认         | 描述                                                                                                                   |
| ------------- | -------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `triggerType` | `"schedule"` \| `"event"`        | `"schedule"` | 自动化如何启动                                                                                                         |
| `event`       | 字符串                           | _（可选）_   | 要订阅的事件名称（仅限事件触发器）                                                                                     |
| `condition`   | 字符串                           | _（可选）_   | 在调度之前评估自然语言条件                                                                                             |
| `mode`        | `"agentic"` \| `"deterministic"` | `"agentic"`  | 完整的代理循环。 （`"deterministic"` 已保留，但尚未实现 - 设置它的自动化将被跳过。对所有当前自动化使用 `"agentic"`。） |
| `domain`      | 字符串                           | _（可选）_   | 分组标签（邮件、日历、剪辑等）                                                                                         |

对于事件触发器，`schedule`为`""`（空）；对于计划触发器，它带有 cron 表达式。调度程序还写入与调度程序相同的托管 `lastRun` / `lastStatus` / `lastError` 字段，以及当条件评估为 false 时的 `"skipped"` 状态。

## 事件总线 {#event-bus}

集成在模块加载时注册事件。总线根据 [Standard Schema](https://standardschema.dev) 定义验证有效负载并将其分派给订阅者。

### 内置事件 {#built-in-events}

| 活动                   | 来源                                       |
| ---------------------- | ------------------------------------------ |
| `test.event.fired`     | 手动/`manage-automations` action=fire-test |
| `agent.turn.completed` | 代理聊天                                   |
| `calendar.*`           | 日历集成                                   |
| `clip.*`               | 剪辑集成                                   |
| `mail.*`               | 邮件集成                                   |

从代理中使用 `action=list-events` 调用 `manage-automations`，以查看所有已注册事件以及当前模板的描述和负载模式。

### 发出自定义事件 {#emitting-events}

在服务器插件中注册事件类型，然后从 actions 或 webhook 处理程序发出它：

```ts
import { registerEvent, emit } from "@agent-native/core/event-bus";
import { z } from "zod";

// Register the event type (once, at module load)
registerEvent({
  name: "order.completed",
  description: "A customer completed an order",
  payloadSchema: z.object({
    orderId: z.string(),
    customerEmail: z.string(),
    total: z.number(),
  }),
  example: {
    orderId: "ord_123",
    customerEmail: "jane@example.com",
    total: 49.99,
  },
});

// Emit the event (from an action, webhook handler, etc.)
emit(
  "order.completed",
  {
    orderId: "ord_123",
    customerEmail: "jane@example.com",
    total: 49.99,
  },
  { owner: "steve@builder.io" },
);
```

自动化触发的发出元数据范围中的 `owner` - 仅评估同一用户拥有的自动化（或共享自动化）。

## 条件 {#conditions}

条件是 Claude Haiku 针对事件负载评估的自然语言字符串。这是一个是/否分类，而不是生成任务。

- **空或缺失条件** = 无条件（始终触发）。
- 结果通过 5 分钟 TTL 和 500 个条目的 LRU 缓存进行记忆（条件 + 负载的 SHA-256）。
- 有效负载在发送到 Haiku 之前被截断为 4000 个字符。
- 在 API 失败时，条件评估为 `false`（安全默认值 - 跳过自动化）。

条件示例：

- `"attendee email ends with @builder.io"`
- `"the order total is greater than $100"`
- `"the message contains the word 'urgent'"`

## 网络请求工具 {#web-request}

自动化使用 `web-request` 工具进行出站 HTTP。它支持 URL、标头和正文中的 `${keys.NAME}` 占位符：

```
POST to ${keys.SLACK_WEBHOOK}

Headers: {"Authorization": "Bearer ${keys.API_TOKEN}"}

Body: {"text": "New booking from ${attendeeEmail}"}
```

在代理发出工具调用后，占位符在**服务器端**解析 - 原始秘密值永远不会进入代理的上下文。

### 参数 {#web-request-params}

| 参数         | 类型   | 默认  | 描述                                               |
| ------------ | ------ | ----- | -------------------------------------------------- |
| `url`        | 字符串 | —     | 完整的URL。可能包含 `${keys.NAME}` 引用。          |
| `method`     | 字符串 | `GET` | HTTP 方法（GET、POST、PUT、PATCH、DELETE、HEAD）。 |
| `headers`    | 字符串 | `{}`  | JSON 标头对象。可能包含 `${keys.NAME}`。           |
| `body`       | 字符串 | —     | 请求正文。可能包含 `${keys.NAME}`。                |
| `timeout_ms` | 数字   | 15000 | 超时（以毫秒为单位）（最大 30000）。               |

## 按键 {#keys}

密钥是由用户或代理创建的用于自动化使用的临时秘密（例如 `SLACK_WEBHOOK`、`HUBSPOT_API_KEY`）。它们与注册机密 (`registerRequiredSecret`) 的不同之处在于它们没有模板定义的元数据或入门步骤。

- 通过设置 UI 或 `/_agent-native/secrets/adhoc` API 创建。
- 每个密钥都可以有一个 **URL 白名单**，用于限制密钥可以发送到哪些来源（来源级别匹配）。
- 原始值永远不会暴露给 AI - 只有 `${keys.NAME}` 占位符出现在代理的上下文中。
- 分辨率从用户范围回退到工作区范围，因此用户可以覆盖共享密钥。

## 代理工具 {#agent-tools}

所有自动化操作均通过带有 `action` 参数的单个 `manage-automations` 工具访问：

| 行动          | 目的                                                 |
| ------------- | ---------------------------------------------------- |
| `list-events` | 发现所有已注册事件及其描述和负载模式                 |
| `list`        | 列出所有自动化的状态；按域或启用过滤                 |
| `define`      | 创建新的自动化（名称、触发器类型、事件、条件、正文） |
| `update`      | 更新现有自动化（已启用、条件、正文）                 |
| `delete`      | 删除自动化（始终先与用户确认）                       |
| `fire-test`   | 发出 `test.event.fired` 事件来验证自动化             |

附加工具：`web-request` — 出站 HTTP 替换为 `${keys.NAME}`。

## API端点 {#api}

| 端点                                   | 方法   | 描述                         |
| -------------------------------------- | ------ | ---------------------------- |
| `/_agent-native/automations`           | GET    | 列出所有自动化（已解析）     |
| `/_agent-native/automations/fire-test` | POST   | 发出 `test.event.fired` 事件 |
| `/_agent-native/secrets/adhoc`         | GET    | 列出临时键（无值）           |
| `/_agent-native/secrets/adhoc`         | POST   | 创建或更新临时密钥           |
| `/_agent-native/secrets/adhoc/:name`   | DELETE | 删除临时密钥                 |

```an-api title="触发测试事件"
{
  "method": "POST",
  "path": "/_agent-native/automations/fire-test",
  "summary": "发出 test.event.fired 事件以验证事件触发的自动化",
  "description": "Confirm an automation's wiring and condition without waiting for a real provider event. Equivalent to the `manage-automations` action `fire-test`.",
  "responses": [
    { "status": "200", "description": "Event emitted; matching automations are dispatched through the normal condition + ownership path." }
  ]
}
```

## 调度如何运作 {#dispatch}

```an-diagram title="调度路径" summary="从触发事件到完成代理运行，由所有权范围和自然语言条件控制。"
{
  "html": "<div class=\"disp\"><div class=\"diagram-box accent\">event fired on the bus</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">match</span><small class=\"diagram-muted\">load enabled automations subscribed to this event name</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">scope</span><small class=\"diagram-muted\">keep only those owned by the event's owner (or shared)</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill warn\">condition</span><small class=\"diagram-muted\">Haiku yes/no on the payload &mdash; false &rarr; <code>skipped</code></small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card accent\"><span class=\"diagram-pill accent\">run</span><small class=\"diagram-muted\"><code>runAgentLoop</code> body 作为提示、payload 作为上下文，5 分钟超时</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card ok\"><span class=\"diagram-pill ok\">record</span><small class=\"diagram-muted\">write <code>lastRun</code> / <code>lastStatus</code> / <code>lastError</code></small></div></div>",
  "css": ".disp{display:flex;flex-direction:column;gap:6px;max-width:540px}.disp .diagram-card{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.disp .diagram-box{align-self:flex-start}.disp .diagram-arrow{font-size:18px;align-self:center}"
}
```

## 示例 {#example}

**用户：**“当有人使用 @builder.io 电子邮件预订时，请在 Slack 中给我发消息。”

**代理流程：**

1. 使用 `action=list-events` 调用 `manage-automations` — 找到 `calendar.booking.created`。
2. 与用户确认计划。
3. 使用 `action=define` 调用 `manage-automations`：
   - `name`: `slack-on-builder-booking`
   - `trigger_type`: `event`
   - `event`: `calendar.booking.created`
   - `condition`: `attendee email ends with @builder.io`
   - `mode`: `agentic`
   - `domain`: `calendar`
   - `body`: `Send a Slack message to #sales with the booking details. Use the web-request tool to POST to ${keys.SLACK_WEBHOOK}.`
4. 自动化保存为 `jobs/slack-on-builder-booking.md` 并立即开始监听。

## 更多示例 {#more-examples}

### 当计划被评论时通过 webhook 通知

询问计划代理：_“当有人对计划添加人工评论时，POST a
向我的 webhook 发出通知。"_

```yaml
---
triggerType: event
event: plan.commented
condition: "resolutionTarget is human or resolutionTarget is null"
mode: agentic
domain: plan
enabled: true
---

POST to ${keys.NOTIFY_WEBHOOK} with a JSON body:
{"title": "<plan title>", "excerpt": "<comment excerpt>", "author": "<author email or null>", "url": "<app base url + path>"}
```

将 `NOTIFY_WEBHOOK` 设置为任何 HTTP 端点 - Slack 传入 Webhook，通用
通知服务，或自定义接收器。 `web-request`工具解决
`${keys.NOTIFY_WEBHOOK}` 服务器端；原始的 URL 永远不会出现在代理的
上下文。见[Visual Plans — Events and notifications](/docs/template-plan#events)
完整的 `plan.commented` 有效负载参考和所有四个计划事件。

## 下一步是什么

- [**Recurring Jobs**](/docs/recurring-jobs) - 计划触发的自动化重用相同的计划程序
- [**Actions**](/docs/actions) - 自动化可以通过代理循环调用任何注册的操作
- [**Security**](/docs/security) - 输入验证和秘密处理
- [**Visual Plans — Events**](/docs/template-plan#events) - 计划事件参考和自动化秘诀
