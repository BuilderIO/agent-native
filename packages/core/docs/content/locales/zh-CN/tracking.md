---
title: "跟踪和分析"
description: "使用可插入提供程序进行服务器端分析 - PostHog、Mixpanel、Amplitude 或自定义 Webhook"
---

# 分析跟踪

一个功能，多个目的地。从任何服务器端代码（actions、插件、服务器路由）调用 `track()`，事件就会分发到每个注册的分析提供商。没有 SDK 依赖性，没有客户端脚本，没有阻塞。相同的 `track()` 也可在 [browser/app code](#client) 中使用，并路由至相同的提供商。

这是*product*分析——您的应用程序的事件流向PostHog/Mixpanel/Amplitude。有关存储在您自己的数据库中的*代理质量*指标（跟踪、成本、评估、反馈），请参阅 [Observability](/docs/observability)。

```ts
import { track } from "@agent-native/core/tracking";

track(
  "order.completed",
  { total: 49.99, items: 3 },
  { userId: "steve@builder.io" },
);
```

```an-diagram title="一次 track() 调用，每个提供者" summary="服务器和客户端调用者访问相同的注册表，该注册表将每个事件并行地分发给所有活动的提供者。"
{
  "html": "<div class=\"trk\"><div class=\"diagram-col\"><div class=\"diagram-node\">服务器代码<br><small class=\"diagram-muted\">actions &middot; plugins &middot; routes</small></div><div class=\"diagram-node\">浏览器代码<br><small class=\"diagram-muted\">POST /_agent-native/track</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Provider registry</span><small class=\"diagram-muted\">扇出，发送即忘</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">PostHog</div><div class=\"diagram-box\">Mixpanel</div><div class=\"diagram-box\">Amplitude</div><div class=\"diagram-box\">Webhook</div></div></div>",
  "css": ".trk{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.trk .diagram-col{display:flex;flex-direction:column;gap:8px}.trk .diagram-arrow{font-size:22px;line-height:1}.trk .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## 内置提供程序 {#built-in}

设置环境变量，提供程序会在服务器启动时自动注册。无需更改代码。

| 提供商   | 环境变量                                                                             |
| -------- | ------------------------------------------------------------------------------------ |
| PostHog  | `POSTHOG_API_KEY`（必填）、`POSTHOG_HOST`（可选，默认为`https://us.i.posthog.com`）  |
| 混合面板 | `MIXPANEL_TOKEN`                                                                     |
| 振幅     | `AMPLITUDE_API_KEY`                                                                  |
| Webhook  | `TRACKING_WEBHOOK_URL`（必需）、`TRACKING_WEBHOOK_AUTH`（可选 `Authorization` 标头） |

多个提供程序可以同时处于活动状态。每个事件都会发生在他们所有人身上。

## API {#api}

### `track(name, properties?, meta?)` {#track}

触发分析事件。扇出到所有注册的提供商。

```ts
import { track } from "@agent-native/core/tracking";

track(
  "meal.logged",
  { mealName: "Salad", calories: 350 },
  { userId: "steve@builder.io" },
);
```

### `identify(userId, traits?)` {#identify}

识别具有特征的用户。转发给支持它的提供商（PostHog、Mixpanel、Amplitude、webhook）。

```ts
import { identify } from "@agent-native/core/tracking";

identify("steve@builder.io", { plan: "pro", company: "Builder.io" });
```

需要自定义后端、提供程序注册表 API 或批处理/单例内部组件？见最后的[Advanced: custom providers & internals](#advanced)。

## 在模板中使用 track() {#templates}

从操作处理程序调用 `track()` 以记录用户或代理活动：

```ts
// actions/create-project.ts
import { defineAction } from "@agent-native/core/action";
import { track } from "@agent-native/core/tracking";
import { z } from "zod";

export default defineAction({
  description: "Create a new project.",
  schema: z.object({
    name: z.string(),
    template: z.string().optional(),
  }),
  run: async ({ name, template }, ctx) => {
    const project = await db
      .insert(projects)
      .values({ name, template })
      .returning();

    track("project.created", { name, template }, { userId: ctx.userEmail });

    return { ok: true, projectId: project[0].id };
  },
});
```

跟踪调用是“即发即忘”的 — 它们会立即返回并且永远不会阻止操作响应。

## 客户端跟踪 {#client}

`track()` 也适用于浏览器/应用程序代码。从 `@agent-native/core/client` 导入客户端孪生并以相同的方式调用它 - 它将事件发布到 `POST /_agent-native/track` 的框架路由，后者将其转发到**相同**注册的服务器端提供程序（PostHog、Mixpanel、Amplitude、webhook）。没有分析 SDK 发送到浏览器，也没有提供者密钥暴露在客户端。

```an-api title="客户追踪路线"
{
  "method": "POST",
  "path": "/_agent-native/track",
  "summary": "将浏览器事件转发到注册的服务器端提供商",
  "auth": "Session required + same-origin/CSRF marker (set automatically by the client helper). Not an open analytics relay.",
  "params": [
    { "name": "name", "in": "body", "type": "string", "required": true, "description": "Event name. Capped at 200 characters." },
    { "name": "properties", "in": "body", "type": "object", "description": "Event properties (~16KB cap). `source: \"client\"` and the active `org_id` are added server-side." }
  ],
  "description": "Identity is resolved **server-side** from the session — browser code never passes a `userId`. Fire-and-forget: never blocks the UI, never throws, swallows network errors. Oversized or malformed payloads are rejected."
}
```

```ts
import { track } from "@agent-native/core/client";

// e.g. inside a click handler or effect
track("checkout.completed", { total: 49.99, items: 3 });
```

与 [server `track()`](#track) 的主要区别：

- **无身份参数。** 该事件在服务器端归因于登录用户（以及活动组织，如 `properties` 中的 `org_id`）。浏览器代码永远不会传递 `userId`。
- **`source: "client"`** 添加到每个事件的属性中，以便您可以区分客户端发起的事件和服务器事件。
- **一劳永逸。**它永远不会阻塞 UI，永远不会抛出并吞掉网络错误。
- **经过身份验证，仅限第一方。** 该路由需要会话和同源/CSRF 标记（由帮助程序自动设置），因此它不能用作开放分析中继。 `name` 的上限为 200 个字符，`properties` 的上限为 ~16KB；过大或格式错误的有效负载将被拒绝。

这与框架的内部浏览器遥测（`trackEvent()` /自动页面浏览量 - 请参阅下面的 [Browser defaults](#browser-defaults)）不同，后者为 Agent Native 自己的产品分析提供支持。将 `track()` 用于您的应用自己的分析事件，这些事件应到达您配置的提供商。

## 高级：自定义提供程序和内部结构 {#advanced}

大多数应用程序只需要 `track()` / `identify()` 和内置提供程序。表面的其余部分 - 注册自定义提供程序、`TrackingProvider` 接口、批处理内部结构以及框架自己的浏览器遥测 - 如下。

<details>
<summary><strong>Provider-registry API、界面、内部结构和浏览器默认值</strong></summary>

### `registerTrackingProvider(provider)` {#register}

为任何分析后端注册自定义提供商。

```ts
import { registerTrackingProvider } from "@agent-native/core/tracking";

registerTrackingProvider({
  name: "my-analytics",
  track(event) {
    // Send event to your backend
    fetch("https://analytics.example.com/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    }).catch(() => {});
  },
  identify(userId, traits) {
    // Optional — link user identity to future events
  },
  flush() {
    // Optional — called on graceful shutdown
  },
});
```

### `flushTracking()` {#flush}

刷新所有提供者。在进程退出之前调用以确保发送待处理事件。

```ts
import { flushTracking } from "@agent-native/core/tracking";

await flushTracking();
```

### `unregisterTrackingProvider(name)` {#unregister}

按名称删除提供商。如果找到并删除了提供者，则返回 `true`。

### `listTrackingProviders()` {#list}

返回所有已注册提供商的名称。

### TrackingProvider 接口 {#provider-interface}

```ts
interface TrackingProvider {
  name: string;
  track(event: TrackingEvent): void | Promise<void>;
  identify?(
    userId: string,
    traits?: Record<string, unknown>,
  ): void | Promise<void>;
  flush?(): void | Promise<void>;
}

interface TrackingEvent {
  name: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
  userId?: string;
}
```

仅需要 `name` 和 `track`。 `identify` 和 `flush` 是可选的 - 如果您的后端支持用户身份和批量交付，请实现它们。

### 它是如何工作的 {#internals}

- **批处理 HTTP** — 内置提供程序将事件排队并每 10 秒或累积 50 个事件时刷新（以先到者为准）。这可以最大限度地减少出站请求，而不会丢失数据。
- **无 SDK 依赖项** — 所有内置提供程序都使用原始 `fetch()`。没有 PostHog SDK，没有 Mixpanel SDK，没有 Amplitude SDK。保持框架轻量级。
- **尽力交付** - 捕获并记录提供者错误。失败的分析集成绝不会导致调用者崩溃或阻止请求处理。
- **全局单例** - 注册表在 `globalThis` 上使用 `Symbol.for` 密钥，因此多个 ESM 图形实例（开发模式 Vite + Nitro、符号链接）共享一个提供程序集。

### 浏览器默认值 {#browser-defaults}

这涵盖了框架自己的内部遥测——主要与框架贡献者和高级模板作者相关。

模板根在启动时调用 `configureTracking()` 一次。当应用程序可以解析它时，使用 `trackEvent()` 发送的浏览器事件会自动包含应用程序/模板上下文以及当前的 LLM 连接：

- `llm_connection` — 标准化提供商标签，例如 `builder`、`anthropic`、`openai`、`google` 或 `none`
- `llm_engine` — 引擎 ID，例如 `builder` 或 `ai-sdk:openai`
- `llm_model` — 已知时选择/默认的模型
- `llm_connection_source` — `app_secrets`、`settings` 或 `env`
- `llm_connection_configured` — LLM 连接是否可用

该框架还跟踪来自 Connect Builder CTA 的 `builder connect clicked`，服务器端 Builder 连接路由跟踪已启动/成功/失败的生命周期事件。 `configureTracking()`由框架自动调用；您不需要在自己的模板代码中调用它。

</details>

## 下一步是什么

- [**Actions**](/docs/actions) — 大多数跟踪调用的发起位置
- [**Server Plugins**](/docs/server) - `registerBuiltinProviders()` 在启动时在 core-routes 插件中运行
- [**Secrets**](/docs/security) — 管理用于跟踪提供商的 API 密钥
