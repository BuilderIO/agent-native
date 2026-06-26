---
title: "跟蹤和分析"
description: "使用可插入提供者進行伺服器端分析 - PostHog、Mixpanel、Amplitude 或自訂 Webhook"
---

# 分析跟蹤

一個功能，多個目的地。從任何伺服器端程式碼（actions、外掛、伺服器路由）呼叫 `track()`，事件就會分發到每個註冊的分析提供者。沒有 SDK 依賴性，沒有用戶端指令碼，沒有阻塞。相同的 `track()` 也可在 [browser/app code](#client) 中使用，並路由至相同的提供者。

這是*product*分析——您的應用程式的事件流向PostHog/Mixpanel/Amplitude。有關儲存在您自己的資料庫中的*代理品質*指標（跟蹤、成本、評估、意見回饋），請參閱 [Observability](/docs/observability)。

```ts
import { track } from "@agent-native/core/tracking";

track(
  "order.completed",
  { total: 49.99, items: 3 },
  { userId: "steve@builder.io" },
);
```

```an-diagram title="一次 track() 呼叫，每個提供者" summary="伺服器和用戶端呼叫者存取相同的註冊表，該註冊表將每個事件並行地分發給所有活動的提供者。"
{
  "html": "<div class=\"trk\"><div class=\"diagram-col\"><div class=\"diagram-node\">伺服器程式碼<br><small class=\"diagram-muted\">actions &middot; plugins &middot; routes</small></div><div class=\"diagram-node\">瀏覽器程式碼<br><small class=\"diagram-muted\">POST /_agent-native/track</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Provider registry</span><small class=\"diagram-muted\">扇出，傳送即忘</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">PostHog</div><div class=\"diagram-box\">Mixpanel</div><div class=\"diagram-box\">Amplitude</div><div class=\"diagram-box\">Webhook</div></div></div>",
  "css": ".trk{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.trk .diagram-col{display:flex;flex-direction:column;gap:8px}.trk .diagram-arrow{font-size:22px;line-height:1}.trk .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## 內建提供者 {#built-in}

設定環境變數，提供者會在伺服器啟動時自動註冊。無需更改程式碼。

| 提供者   | 環境變數                                                                             |
| -------- | ------------------------------------------------------------------------------------ |
| PostHog  | `POSTHOG_API_KEY`（必填）、`POSTHOG_HOST`（可選，預設為`https://us.i.posthog.com`）  |
| 混合面板 | `MIXPANEL_TOKEN`                                                                     |
| 振幅     | `AMPLITUDE_API_KEY`                                                                  |
| Webhook  | `TRACKING_WEBHOOK_URL`（必需）、`TRACKING_WEBHOOK_AUTH`（可選 `Authorization` 標頭） |

多個提供者可以同時處於活動狀態。每個事件都會發生在他們所有人身上。

## API {#api}

### `track(name, properties?, meta?)` {#track}

觸發分析事件。扇出到所有註冊的提供者。

```ts
import { track } from "@agent-native/core/tracking";

track(
  "meal.logged",
  { mealName: "Salad", calories: 350 },
  { userId: "steve@builder.io" },
);
```

### `identify(userId, traits?)` {#identify}

識別具有特徵的使用者。轉發給支援它的提供者（PostHog、Mixpanel、Amplitude、webhook）。

```ts
import { identify } from "@agent-native/core/tracking";

identify("steve@builder.io", { plan: "pro", company: "Builder.io" });
```

需要自訂後端、提供者註冊表 API 或批處理/單例內部元件？見最後的[Advanced: custom providers & internals](#advanced)。

## 在範本中使用 track() {#templates}

從操作處理常式呼叫 `track()` 以紀錄使用者或代理活動：

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

跟蹤呼叫是“即發即忘”的 — 它們會立即返回並且永遠不會阻止操作回應。

## 用戶端跟蹤 {#client}

`track()` 也適用於瀏覽器/應用程式的程式碼。從 `@agent-native/core/client` 匯入用戶端對應函式並以相同的方式呼叫它 - 它將事件發布到 `POST /_agent-native/track` 的框架路由，後者將其轉發到**相同**註冊的伺服器端提供者（PostHog、Mixpanel、Amplitude、webhook）。沒有分析 SDK 傳送到瀏覽器，也沒有提供者金鑰暴露在用戶端。

```an-api title="客戶追蹤路由"
{
  "method": "POST",
  "path": "/_agent-native/track",
  "summary": "將瀏覽器事件轉發到註冊的伺服器端提供者",
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

與 [server `track()`](#track) 的主要區別：

- **無身分參數。** 該事件在伺服器端歸因於登入使用者（以及活動組織，如 `properties` 中的 `org_id`）。瀏覽器程式碼永遠不會傳遞 `userId`。
- **`source: "client"`** 新增到每個事件的屬性中，以便您可以區分用戶端發起的事件和伺服器事件。
- **一勞永逸。**它永遠不會阻塞 UI，永遠不會拋出並吞掉網路錯誤。
- **經過驗證，僅限第一方。** 該路由需要工作階段和同來源/CSRF 標記（由幫助程式自動設定），因此它不能用作開放分析中繼。 `name` 的上限為 200 個字符，`properties` 的上限為 ~16KB；過大或格式錯誤的有效負載將被拒絕。

這與框架的內部瀏覽器遙測（`trackEvent()` /自動頁面瀏覽量 - 請參閱下面的 [Browser defaults](#browser-defaults)）不同，後者為 Agent Native 自己的產品分析提供支援。將 `track()` 用於您的應用自己的分析事件，這些事件應到達您設定的提供者。

## 進階：自訂提供者和內部結構 {#advanced}

大多數應用程式只需要 `track()` / `identify()` 和內建提供者。表面的其餘部分 - 註冊自訂提供者、`TrackingProvider` 介面、批處理內部結構以及框架自己的瀏覽器遙測 - 如下。

<details>
<summary><strong>Provider-registry API、介面、內部結構和瀏覽器預設值</strong></summary>

### `registerTrackingProvider(provider)` {#register}

為任何分析後端註冊自訂提供者。

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

重新整理所有提供者。在行程退出之前呼叫以確保傳送待處理事件。

```ts
import { flushTracking } from "@agent-native/core/tracking";

await flushTracking();
```

### `unregisterTrackingProvider(name)` {#unregister}

按名稱刪除提供者。如果找到並刪除了提供者，則返回 `true`。

### `listTrackingProviders()` {#list}

返回所有已註冊提供者的名稱。

### TrackingProvider 介面 {#provider-interface}

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

僅需要 `name` 和 `track`。 `identify` 和 `flush` 是可選的 - 如果您的後端支援使用者身分和批量交付，請實現它們。

### 它是如何工作的 {#internals}

- **批處理 HTTP** — 內建提供者將事件排隊並每 10 秒或累積 50 個事件時重新整理（以先到者為準）。這可以最大限度地減少出站請求，而不會丟失資料。
- **無 SDK 依賴項** — 所有內建提供者都使用原始 `fetch()`。沒有 PostHog SDK，沒有 Mixpanel SDK，沒有 Amplitude SDK。保持框架輕量級。
- **盡力交付** - 捕獲並紀錄提供者錯誤。失敗的分析整合絕不會導致呼叫者當機或阻止請求處理。
- **全域單例** - 註冊表在 `globalThis` 上使用 `Symbol.for` 金鑰，因此多個 ESM 圖形執行個體（開發模式 Vite + Nitro、符號連結）共用一個提供者集。

### 瀏覽器預設值 {#browser-defaults}

這涵蓋了框架自己的內部遙測——主要與框架貢獻者和進階範本作者相關。

範本根在啟動時呼叫 `configureTracking()` 一次。當應用程式可以解析它時，使用 `trackEvent()` 傳送的瀏覽器事件會自動包含應用程式/範本脈絡以及目前的 LLM 連線：

- `llm_connection` — 標準化提供者標籤，例如 `builder`、`anthropic`、`openai`、`google` 或 `none`
- `llm_engine` — 引擎 ID，例如 `builder` 或 `ai-sdk:openai`
- `llm_model` — 已知時選取/預設的模型
- `llm_connection_source` — `app_secrets`、`settings` 或 `env`
- `llm_connection_configured` — LLM 連線是否可用

此框架還跟蹤來自 Connect Builder CTA 的 `builder connect clicked`，伺服器端 Builder 連線路由跟蹤已啟動/成功/失敗的生命週期事件。 `configureTracking()`由框架自動呼叫；您不需要在自己的範本程式碼中呼叫它。

</details>

## 下一步是什麼

- [**Actions**](/docs/actions) — 大多數跟蹤呼叫的發起位置
- [**Server Plugins**](/docs/server) - `registerBuiltinProviders()` 在啟動時在 core-routes 外掛中執行
- [**Secrets**](/docs/security) — 管理用於跟蹤提供者的 API 金鑰
