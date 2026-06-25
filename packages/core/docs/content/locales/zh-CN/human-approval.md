---
title: "人在环批准"
description: "在高后果操作运行之前暂停代理 - defineAction 的 needApproval 门会发出一个approval_required 事件，人工批准，然后工具才会执行。"
---

# 人在环批准

大多数 actions 应该直接运行。其中一些操作（发送电子邮件、为卡充值、删除帐户）是面向外部且难以撤消的，您不希望代理自主执行这些操作。对于这些，`defineAction` 有一个选择加入的**批准门**：当代理尝试调用该操作时，循环会暂停，向人类显示批准/拒绝功能，并*仅*在人类批准该特定调用后才运行该操作。

> [!WARNING]
> 保持很少的批准。每个门控操作都是代理循环中的硬停止——它会中断运行并需要人工往返。仅将 `needsApproval` 用于真正后果严重、难以撤销、面向外的操作。如果您发现自己对读取或例行写入进行门控，那么您就错了。默认为**关闭**，几乎每个操作都应将其关闭。

## `needsApproval` 门 {#needs-approval}

在 `defineAction` 上设置 `needsApproval`。它接受布尔值或谓词：

```an-annotated-code title="限制一项后果性行动"
{
  "filename": "actions/send-email.ts",
  "language": "ts",
  "code": "export default defineAction({\n  description: \"Send an email via Gmail.\",\n  schema: z.object({\n    to: z.string(),\n    subject: z.string(),\n    body: z.string(),\n  }),\n  // Sending is outward-facing and hard to undo, so the agent can never send\n  // without a human approving the specific call. Drafting/queueing is\n  // unaffected — only the real send is gated.\n  needsApproval: true,\n  run: async (args) => {\n    /* ...actually send... */\n  },\n});",
  "annotations": [
    { "lines": "10", "label": "整个大门", "note": "一面旗帜。当它为真且调用未获批准时，循环会在 `run` 之前停止 - 模型本身永远不会达到副作用。" },
    { "lines": "11-13", "label": "run() is untouched", "note": "处理程序保持不变。批准是由其周围的循环强制执行的，而不是由 `run` 内的任何内容强制执行。" }
  ]
}
```

- **`needsApproval: true`** — 始终需要批准。
- **`needsApproval: (args, ctx) => boolean | Promise<boolean>`** — 仅当谓词返回 true 时才需要批准。有条件地选择门，例如仅适用于外部收件人或仅高于美元阈值：

  ```ts
  needsApproval: (args) => !args.to.endsWith("@your-company.com"),
  ```

  保持谓词纯粹且快速。 **关闭失败**：如果谓词抛出异常，框架会将其视为“需要批准”，而不是默默地运行后果严重的操作。

当 `needsApproval` 被省略时，行为是逐字节不变的——公共路径上没有额外的成本。

这对于旧版 `parameters` 样式的 actions 和基于架构的 actions，以及应用内代理、子代理、A2A 和 MCP 调用者（每个代理通过同一循环进行表面路由）的工作原理相同。

## 循环如何暂停 {#loop}

当代理调用门控操作并且此特定调用尚未获得批准时，循环不会执行 `run()`。相反，它：

1. 解析门。对于谓词，它调用`needsApproval(input, ctx)`；抛出被视为“必须批准”（失败关闭）。
2. 发出 `tool_start` 事件（以便 UI 显示呼叫），然后立即发出 **`approval_required`** 事件，然后停止转弯。该操作的副作用永远不会发生。

`approval_required` 事件包含客户端呈现可供性所需的一切：

| 字段          | 类型     | 注释                                         |
| ------------- | -------- | -------------------------------------------- |
| `tool`        | `string` | 代理尝试调用的操作名称。                     |
| `input`       | 对象     | 代理传递的参数。                             |
| `approvalKey` | `string` | **稳定密钥**客户端回显以批准*此确切的调用*。 |
| `toolCallId`  | `string` | 模型端工具调用 ID（如果可用）。              |

`approvalKey` 是根据工具名称及其输入确定性派生的，因此相同的逻辑调用始终会生成相同的密钥。模型永远不会看到或设置它 - 它纯粹是框架和人类的批准功能之间的握手。

暂停工具返回一个结果，告诉模型转动已暂停并且不再重试，因此模型不会旋转。

## 人类如何认可 {#approve}

在 `approval_required` 上，聊天 UI 在暂停的工具调用上呈现 **批准/拒绝** 提示。这是在 `AssistantChat` 中自动连接的 - 您无需根据模板构建它。

- **批准**重新发出在 `approvedToolCalls: [approvalKey]` 中携带呼叫密钥的轮次（普通的继续消息）。在重新发出的回合中，门会看到已批准的集合中的密钥，并让特定的调用正常运行。
- **Deny** 在本地消除可供性；没有重新发出任何内容，因此该操作永远不会运行。

`approvedToolCalls` 是聊天请求 (`AgentChatRequest.approvedToolCalls`) 上的字段。其中不存在的密钥将保持暂停状态 - 批准一个呼叫永远不会茫然地批准其他呼叫。因为密钥是内容寻址的，所以批准授权*使用这些参数进行调用*；如果模型稍后建议不同的发送，那就是新的密钥和新的批准。

## 端到端 {#flow}

```an-diagram title="审批中断" summary="门控调用会在 run() 触发之前暂停回合。批准重新发出携带呼叫密钥的回合；只有这样，副作用才会发生。"
{
  "html": "<div class=\"diagram-approve\"><div class=\"diagram-box\" data-rough>代理调用 send-email</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-panel warn\" data-rough><strong>Gate 为真，调用尚未批准</strong><small class=\"diagram-muted\">loop emits tool_start + approval_required { tool, input, approvalKey }</small><span class=\"diagram-pill warn\">turn pauses &mdash; run() did NOT execute</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>人在聊天中点击批准<br><small class=\"diagram-muted\">客户端用 approvedToolCalls: [approvalKey] 重新发起本轮</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-panel ok\" data-rough><span class=\"diagram-pill ok\">Gate sees the key &rarr; run() executes &rarr; email sends</span></div></div>",
  "css": ".diagram-approve{display:flex;flex-direction:column;align-items:center;gap:8px}.diagram-approve .diagram-panel{display:flex;flex-direction:column;gap:6px;align-items:center;padding:12px 16px;text-align:center}.diagram-approve .diagram-arrow{font-size:22px;line-height:1}"
}
```

在框架中此门的典型（并且故意很少）使用是邮件模板的 `send-email` 操作，该操作设置 `needsApproval: true`，以便代理可以自由起草和排队，但在没有人工批准特定发送的情况下永远无法实际发送消息。

## 相关

- [**Actions**](/docs/actions#needs-approval) — 完整的 `defineAction` 表面，包括用于验证返回值的 `outputSchema`。
- [**Security**](/docs/security) - 何时达到批准门与向模型隐藏操作。
- [**Mail template**](/docs/template-mail) — `send-email` 是参考示例。
