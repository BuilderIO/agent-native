---
title: "可观察性"
description: "代理跟踪、评估、反馈、A/B 实验和内置仪表板 - 全部为零配置。"
---

# 代理可观察性

每个代理本机应用程序都具有开箱即用的可观察性。跟踪、自动评估、用户反馈和 A/B 实验可在零配置下运行 - 所有数据都存储在应用自己的 SQL 数据库中。

此页面涵盖*代理质量*指标：存储在数据库中的跟踪、成本、评估和反馈。对于*product*分析（您的应用程序的事件流向PostHog/Mixpanel/Amplitude），请参阅[Tracking](/docs/tracking)。

## 三样东西叫做“评估”/“可观察性”——我想要哪一个？ {#which}

这三个页面很容易混淆。根据您要问的问题进行选择：

| 页面                                                   | 它回答的问题                           | 当它运行时                       | 关注      |
| ------------------------------------------------------ | -------------------------------------- | -------------------------------- | --------- |
| **可观测性评估**（此页面，_Evals_ 选项卡）             | “我的实际生产情况如何？”               | 被动，每次运行后（LLM-判断采样） | 质量      |
| **[CI Eval Gate](/docs/evals)** (`*.eval.ts`)          | “代理在此固定输入上执行正确的操作吗？” | 主动、确定性、CI/部署门          | 质量      |
| **[Observational Memory](/docs/observational-memory)** | “这条长线是否便宜且位于窗户内？”       | 长线程上的后台压缩               | 成本/环境 |

可观察性和 CI 评估门都对质量进行评分，但两端不同——对实际流量进行被动事后评分，与对固定输入进行主动通过/失败检查。观察记忆与质量无关；这与代币成本和上下文窗口压力有关。

## 自动捕获的内容 {#captured}

当用户发送消息时，框架会自动记录：

- **令牌使用** — 输入、输出、缓存读取、缓存写入
- **成本** — 根据代币数量和模型定价计算
- **延迟** — 每次工具调用的总持续时间和时间
- **工具调用** — 调用了哪些 actions、成功/错误状态、持续时间
- **自动评估** - 每次运行后计算 5 个质量分数

无需更改代码。仪器透明地挂接到 `production-agent.ts`。

```an-diagram title="每次运行都会为循环提供动力" summary="一次代理运行会产生跟踪、自动评分和反馈挂钩 - 所有这些都存储在应用程序自己的 SQL 中并显示在仪表板上。实验将流量分配给配置变体。"
{
  "html": "<div class=\"obs-loop\"><div class=\"diagram-node\">代理运行<br><small class=\"diagram-muted\">production-agent.ts</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">自动捕获</span><small class=\"diagram-muted\">tokens &middot; cost &middot; latency &middot; tool calls</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">Traces &amp; spans</div><div class=\"diagram-box\">Evals (5 scorers + LLM judge)</div><div class=\"diagram-box\">Feedback &amp; frustration index</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node ok\">Dashboard<br><small class=\"diagram-muted\">scoped to the signed-in user</small></div></div>",
  "css": ".obs-loop{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.obs-loop .diagram-col{display:flex;flex-direction:column;gap:8px}.obs-loop .diagram-arrow{font-size:22px;line-height:1}.obs-loop .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## 仪表板 {#dashboard}

将仪表板添加到具有单个路由的任何模板：

```tsx
// app/routes/observability.tsx
import { ObservabilityDashboard } from "@agent-native/core/client";

export default function ObservabilityPage() {
  return (
    <div className="min-h-screen bg-background p-6">
      <ObservabilityDashboard />
    </div>
  );
}
```

所有数据的范围仅限于登录用户；今天没有跨用户管理视图。

仪表板有 5 个选项卡：

| 选项卡   | 它显示了什么                                                 |
| -------- | ------------------------------------------------------------ |
| **概述** | 关键指标 - 运行、成本、延迟、工具成功率、满意度、评估分数    |
| **对话** | 跟踪列表，可深入到各个范围（agent_run、llm_call、tool_call） |
| **评估** | 按标准自动评估分数、随时间变化的趋势                         |
| **实验** | 带有状态徽章的 A/B 测试列表、带有置信区间的变量结果          |
| **反馈** | 赞成/反对、类别细分、挫败感分数                              |

## 用户反馈 {#feedback}

### 明确反馈

“竖起大拇指”/“竖起大拇指”按钮在聊天 UI 中的每条代理消息上呈现内联。拇指朝下会打开一个类别弹出窗口（不准确、没有帮助、工具错误、太慢）。这会自动连接到 `AssistantChat.tsx`。

### 隐性反馈（挫败指数）

框架根据对话信号计算挫败指数（0-100）：

| 信号     | 重量 | 它检测到什么           |
| -------- | ---- | ---------------------- |
| 改写     | 30%  | 用户重复类似的消息     |
| 重试模式 | 20%  | “再试一次”，“不，错了” |
| 放弃     | 20%  | 会话在响应后不久结束   |
| 情绪     | 15%  | 负面语言模式           |
| 长度趋势 | 15%  | 消息长度减少           |

分数解释：0-20 = 健康，20-40 = 摩擦，40-60 = 不满意，60+ = 中断的训练。

## 自动评估 {#evals}

每次代理运行后都会运行五个确定性记分器：

| 标准                | 它测量什么                              | 分数范围 |
| ------------------- | --------------------------------------- | -------- |
| `tool_success_rate` | 没有错误的工具调用百分比                | 0-1      |
| `step_efficiency`   | 对使用工具的运行进行过多的 LLM 迭代惩罚 | 0-1      |
| `latency_score`     | 根据 10 秒/工具基线进行归一化           | 0-1      |
| `cost_efficiency`   | 根据成本基线标准化                      | 0-1      |
| `error_recovery`    | 代理是否从工具错误中恢复？              | 0 或 1   |

### LLM作为法官（可选）

通过设置 `evalSampleRate` 启用基于采样 LLM 的评估：

```ts
import { putSetting } from "@agent-native/core/settings";

await putSetting("observability-config", {
  enabled: true,
  evalSampleRate: 0.05, // 5% of runs
});
```

自定义标准使用自然语言规则：

```ts
const criteria = {
  name: "helpfulness",
  description: "Was the response helpful and complete?",
  rubric: "0.0 = unhelpful, 0.5 = partially helpful, 1.0 = fully resolved",
};
```

## A/B 实验 {#experiments}

测试不同的型号、温度或代理配置：

```ts
// Create via API
POST /_agent-native/observability/experiments
{
  "name": "model-a-vs-b",
  "variants": [
    { "id": "control", "weight": 50, "config": { "model": "<your-model-id>" } },
    { "id": "treatment", "weight": 50, "config": { "model": "<other-model-id>" } }
  ],
  "metrics": ["cost", "latency", "satisfaction"]
}

// Start the experiment
PUT /_agent-native/observability/experiments/:id
{ "status": "running" }
```

使用您的引擎接受的真实模型标识符来代替 `<your-model-id>` / `<other-model-id>`（模型名称经常更改 - 检查您的提供商/引擎的当前 ID）。代理循环自动解析用户的变体并应用配置覆盖。分配使用一致的散列——同一用户总是得到相同的变体。

```an-diagram title="一致哈希变体分配" summary="每个用户散列到一个稳定的变体，循环应用该变体的配置覆盖，并且结果以置信区间汇总每个变体。"
{
  "html": "<div class=\"exp\"><div class=\"diagram-node\">用户 ID<br><small class=\"diagram-muted\">consistent hash</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-card\"><span class=\"diagram-pill\">control &middot; 50%</span><small class=\"diagram-muted\">配置覆盖 A</small></div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">treatment &middot; 50%</span><small class=\"diagram-muted\">配置覆盖 B</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">结果 per variant<br><small class=\"diagram-muted\">cost &middot; latency &middot; satisfaction</small></div></div>",
  "css": ".exp{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.exp .diagram-col{display:flex;flex-direction:column;gap:8px}.exp .diagram-card{display:flex;flex-direction:column;gap:2px;padding:8px 12px}.exp .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 配置 {#config}

所有设置都存储在 `observability-config` 密钥中：

```ts
{
  enabled: true,           // Master switch
  capturePrompts: false,   // Store prompt content in traces
  captureToolArgs: false,  // Store action input arguments
  captureToolResults: false, // Store action results
  evalSampleRate: 0,       // 0-1, fraction of runs to LLM-judge
  exporters: []            // OTLP export targets
}
```

```an-callout
{
  "tone": "info",
  "body": "Content is **redacted by default** — only token counts, costs, and timing are stored. `capturePrompts`, `captureToolArgs`, and `captureToolResults` are opt-in; turn them on only when you need prompt/argument content for debugging."
}
```

## API端点 {#api}

全部自动安装在`/_agent-native/observability/`：

| 方法 | 路径                       | 目的                      |
| ---- | -------------------------- | ------------------------- |
| GET  | `/`                        | 统计概览                  |
| GET  | `/traces`                  | 列出跟踪摘要              |
| GET  | `/traces/:runId`           | 跟踪详细信息（摘要+跨度） |
| GET  | `/traces/:runId/evals`     | 运行评估                  |
| POST | `/feedback`                | 提交反馈                  |
| GET  | `/feedback`                | 列出反馈                  |
| GET  | `/feedback/stats`          | 反馈聚合                  |
| GET  | `/satisfaction`            | 满意度分数                |
| GET  | `/evals/stats`             | 评估统计                  |
| POST | `/experiments`             | 创建实验                  |
| GET  | `/experiments`             | 列出实验                  |
| GET  | `/experiments/:id`         | 获取实验详细信息          |
| PUT  | `/experiments/:id`         | 更新实验                  |
| POST | `/experiments/:id/results` | 计算结果                  |
| GET  | `/experiments/:id/results` | 获取结果                  |

所有端点均支持`?since=N`（毫秒时间戳）和`?limit=N`查询参数。

## 导出到外部平台 {#export}

将跟踪发送到 Langfuse、Datadog、Grafana 或任何 OTel 兼容后端：

```ts
await putSetting("observability-config", {
  enabled: true,
  exporters: [
    {
      type: "otlp",
      endpoint: "https://cloud.langfuse.com/api/public/otel",
      headers: { Authorization: "Bearer sk-..." },
    },
  ],
});
```

该框架发出与 OpenTelemetry GenAI 规范兼容的 `gen_ai.*` 语义约定范围。

## OpenTelemetry 跨度 {#otel}

与上面的 `exporters` 配置（将内部跟踪发送到 OTLP 端点）不同，代理循环还可以为每次运行、模型调用和工具调用发出**实时 OpenTelemetry 范围**，因此已经运行 OTel 收集器的主机可以看到代理活动以及其分布式跟踪的其余部分。

该层是**可选且默认情况下无操作**：

- `@opentelemetry/api` 是**可选依赖项**。如果未安装，帮助程序将降级为静默无操作 - 这里不会将任何内容放入代理循环中。
- 即使 api 包存在，它也会提供默认的无操作跟踪器。只有当**主机注册了 `TracerProvider`**（通过 `@opentelemetry/sdk-node` 或类似的）时，跨度才变得真实。该框架故意**不**依赖于繁重的 SDK/exporter 包或本身注册提供程序 - 检测是由嵌入应用程序选择加入的。

因此，当您未连接 OTel 时，成本是每次调用都会读取几次缓存的属性。要打开它，请安装 api 包和 SDK，并在服务器启动时注册提供程序，就像任何其他 Node 服务一样。

代理循环发出三种跨度类型：

| 跨度        | 何时             | 属性                                                              |
| ----------- | ---------------- | ----------------------------------------------------------------- |
| `agent.run` | 每个代理运行一次 | `agent.run_id`, `agent.thread_id`, `agent.user_id`, `agent.model` |
| `tool.call` | 每次操作调用一次 | `tool.name`，加上成功/错误状态                                    |
| `llm.call`  | 每个模型调用     | 计时+正常/错误状态                                                |

跨度以 OK/ERROR 状态完成，并记录失败时的错误消息。零/哨兵属性值被修剪，因此跨度不会因噪音而混乱。该 OTel 层纯粹是对内部 `agent_trace_spans` / `agent_trace_summaries` 表的补充，这些表为上面的仪表板提供支持 - 两者都是由相同的运行事件生成的。

## 错误报告（Sentry） {#sentry}

配置 DSN 时，转义 Nitro 路由处理程序的服务器端错误将报告给 Sentry。如果没有它，SDK 会默默地无操作，因此可以安全地在开发中保留环境变量未设置。浏览器和服务器事件可以去同一个Sentry项目；仅当您希望所有权、数量、配额或警报路由的操作分离时，才将它们拆分为单独的项目。

| 表面               | SDK               | 环境变量                                                      | 注释                                                  |
| ------------------ | ----------------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| 浏览器/SPA         | `@sentry/browser` | `VITE_SENTRY_CLIENT_DSN`、`SENTRY_CLIENT_DSN` 或 `SENTRY_DSN` | 捕获客户端中未处理的错误和路由更改面包屑。            |
| Nitro服务器        | `@sentry/node`    | `SENTRY_SERVER_DSN`或`SENTRY_DSN`                             | 捕获 5xx 响应和 Nitro 生命周期错误。每个请求的用户。  |
| `agent-native` CLI | `@sentry/node`    | _硬编码_                                                      | 来自已发布的 CLI 二进制文件的崩溃报告；用户不可配置。 |

### 服务器端配置 {#sentry-config}

在部署环境（Netlify 仪表板、Cloudflare 机密等）中设置 `SENTRY_SERVER_DSN` 或共享 `SENTRY_DSN`。该框架自动安装 Nitro 插件：

1. 启动时调用 `Sentry.init` 一次（幂等 - 可以安全地从多个插件调用）。
2. 通过 `getSession(event)` 对每个 API/框架请求解析用户，并将 `id` / `email` / `username` 加上 `orgId` 标签附加到 Sentry 的每个请求隔离范围。跳过静态资产路径以避免额外的数据库命中。
3. 使用可搜索的 `route`、`method` 和 `userAgent` 标签捕获每个框架路由 5xx。

可选旋钮：

- `SENTRY_SERVER_TRACES_SAMPLE_RATE`（浮点 `0`–`1`）— 选择加入性能跟踪。默认为 `0`（仅限错误）。无效值限制为 `0`。
- `AGENT_NATIVE_RELEASE` — 覆盖 `release` 标签。默认为 `agent-native-server@<core-version>`。

### 模板

每个模板都会自动继承它——无需导入任何内容。对于 SSR 应用程序，当 `SENTRY_CLIENT_DSN`、`VITE_SENTRY_CLIENT_DSN` 或共享 `SENTRY_DSN` 在运行时可用时，服务器会注入一个小型浏览器配置脚本，因此浏览器捕获不限于 Vite 构建时环境。想要自定义行为的模板（额外标签、每个模板不同的 DSN、硬禁用 Sentry）可以通过从 `server/plugins/sentry.ts` 导出自己的插件来覆盖：

```ts
// server/plugins/sentry.ts
import { createSentryPlugin } from "@agent-native/core/server";
export default createSentryPlugin();
```

CLI 的硬编码 DSN 是有意为之的 - 发布的二进制文件需要通知家庭崩溃，无论运行它的环境如何。服务器模块从不硬编码 DSN，因为它在客户环境中运行，操作员决定错误是否应该到达 Sentry。

### 隐私和 PII {#privacy}

服务器和 CLI 都使用 `sendDefaultPii: false` 和剥离的 `beforeSend` 钩子进行初始化：

- `request.headers.authorization`, `cookie`, `set-cookie`, `proxy-authorization`
- `request.cookies`
- `user.ip_address`（未经同意自动收集）
- `contexts.runtime_env`（进程环境快照）
- 顶级异常类型为 `ValidationError` 的任何事件（被视为预期的用户输入拒绝，而不是错误）。

通过 `setUser({ id, email, username })` 显式设置的身份字段将被保留。

## 下一步是什么

- [**Tracking**](/docs/tracking) - 针对您的应用自身事件的产品分析（PostHog、Mixpanel、Amplitude）
- [**Actions**](/docs/actions) - 在跟踪中显示为工具调用的操作
- [**Security**](/docs/security) — 数据范围和凭证处理
