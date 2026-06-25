---
title: "日历"
description: "由代理支持的日历，具有 Google Calendar 同步和 Calendly 风格的预订链接。通过简单的英语安排、查找时段并管理可用性。"
---

# 日历

代理驱动的日历应用程序。连接您的 Google Calendar，客服人员就可以读取您的日程安排、查找空闲时段、创建活动并管理 Calendly 风格的预订链接 - 全部采用简单的英语。它用您拥有的一个应用程序取代了 Google Calendar + Calendly 组合。

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;min-height:530px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1.4px solid var(--wf-line)'><button>Week</button><button>Today</button><button>‹</button><button>›</button><div style='flex:1'></div><strong>2026 年 5 月 3-9 日</strong><div style='flex:1'></div><button class='primary'>新事件</button></div><div style='display:grid;grid-template-columns:56px repeat(7,minmax(0,1fr));grid-template-rows:36px repeat(5,72px);gap:7px;padding:14px;flex:1'><div></div><strong>周日 3</strong><strong>周一 4</strong><strong>周二 5</strong><strong>周三 6</strong><strong>周四 7</strong><strong>周五 8</strong><strong>周六 9</strong><small class='wf-muted'>7 AM</small><div class='wf-box' style='opacity:.45'></div><div></div><div></div><div></div><div></div><div></div><div></div><small class='wf-muted'>9 AM</small><div class='wf-box'>全员会</div><div class='wf-box'>工程站会</div><div class='wf-box'>工程站会</div><div class='wf-box'>工程站会</div><div></div><div class='wf-box'>Planning</div><div></div><small class='wf-muted'>11 AM</small><div class='wf-box'>设计审核</div><div></div><div class='wf-box'>设计评审</div><div class='wf-box'>Roadmap</div><div class='wf-box'>周五演示</div><div></div><div></div><small class='wf-muted'>1 PM</small><div></div><div class='wf-box'>1:1</div><div class='wf-box'>专注时段</div><div></div><div></div><div class='wf-box'>全员会</div><div></div><small class='wf-muted'>3 PM</small><div></div><div></div><div></div><div class='wf-box'>越级会议</div><div></div><div></div><div></div></div></div>"
}
```

当您打开应用程序时，活动日历视图是主表面。客服人员仍然知道您正在查看哪一天、哪一周或哪一天的活动，因此您可以说“安排在这一天与 Alex 进行 30 分钟的通话”，而无需说明所有内容。

```an-diagram title="调度请求如何流动" summary="无论您单击日历还是询问客服人员，相同的操作都会从 Google Calendar 实时读取并写回同一视图。"
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">你点击<br><small class=\"diagram-muted\">拖拽、工具栏、快捷键</small></div><div class=\"diagram-node\">你向代理请求<br><small class=\"diagram-muted\">\"find a 1-hour slot next week\"</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Actions</span><small class=\"diagram-muted\">list-events · check-availability · create-event</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">Google Calendar<br><small class=\"diagram-muted\">实时、多账户</small></div><div class=\"diagram-box\">SQL<br><small class=\"diagram-muted\">预约 · 可用时间</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-box\">日历视图实时更新</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## 你可以用它做什么

- **在日、周或月视图中查看您真实的 Google Calendar**，并叠加多个帐户。
- **订阅 ICS 源**（HR 休息时间、会议安排、团队日历）- 只读，混合到同一视图中。
- **通过时区支持设置每周可用性** - 代理在查找空闲时段时使用此功能。
- **在 `/book/{slug}` 上创建公共预订链接**，用于“15 分钟介绍”或“30 分钟演示”等内容。配置持续时间、自定义字段以及要使用的会议工具。
- **向工作人员询问任何与日程相关的事情**：“周四下午我有空吗？” “下周找一个 1 小时的时段，并在上面加上‘与 Alex 一起制定计划’。” “暂停我的演示预订链接。”
- **与队友分享预订链接**，以便他们也可以管理它们。

## 开始使用

现场演示：[calendar.agent-native.com](https://calendar.agent-native.com)。

首次打开应用程序时：

1. 点击“**设置**”。
2. 点击 **连接 Google Calendar** 并批准。
3. （可选）如果您想要叠加个人 + 工作，请连接更多 Google 帐户。
4. 打开主视图 - 将加载您的真实日历。

要创建您的第一个预订链接：

1. 点击侧边栏中的**预订链接**。
2. 点击**新预订链接**，设置标题和持续时间。
3. 分享公开的 URL - 访问者从您的可用插槽中进行选择。

或者直接询问客服人员：“创建一个带有姓名字段的 15 分钟介绍预订链接。”

### 有用的提示

- “今天我的日历上有什么？”
- “周四下午我有空 30 分钟吗？”
- “下周找一个 1 小时的时段，并添加“与 Alex 一起制定计划”。”
- “将此活动重新安排到周五下午 2 点。” （选择事件时）
- “切换到日视图并跳转到下周一。”
- “在 15 分钟时创建一个名为“15 分钟介绍”的预订链接，并带有注释字段。”
- “暂停我的‘30 分钟演示’预订链接。”
- “周五下午我有空。”
- “本月我有哪些关于‘发布’的会议？”

代理将实时查询 Google Calendar 的任何时间表问题 - 它永远不会猜测。

## 对于开发者

本文档的其余部分适用于任何派生日历模板或扩展它的人。

### 快速入门

使用日历模板创建新工作区：

```bash
npx @agent-native/core@latest create my-app --standalone --template calendar
cd my-app
pnpm install
pnpm dev
```

打开 `http://localhost:8082`（默认日历开发端口）。

要在开发中连接 Google Calendar，请打开“设置”视图，粘贴 [Google Cloud Console](https://console.cloud.google.com/) 中的 `GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET`，然后单击“连接 Google Calendar”。 OAuth 重定向 URI 在开发中是 `http://localhost:8082/_agent-native/google/callback`。令牌存储在`oauth_tokens` SQL表中并自动刷新。

### 主要功能

**实时日历视图。**日、周和月视图直接从连接的 Google 帐户读取，可选的只读 ICS Feed 分层到同一时间表中。

**可用性和空闲时段搜索。**每周可用性规则、时区支持和现有事件都提供 UI 和代理使用的相同可用性操作。

**预订链接。**公共 `/book/{slug}` 页面收集姓名、电子邮件、自定义字段、会议首选项和取消/重新安排令牌。

**可共享管理。**预订链接默认是私有的，但可以通过共享actions的框架与团队成员共享。

**内嵌活动预览。**客服人员可以在聊天中嵌入紧凑的活动卡，其中包含标题、时间、地点、与会者和跳回按钮。

### 与代理合作

代理看到您正在查看的内容。当前日历视图、所选日期和所选事件作为 `current-screen` 块包含在每条消息中，因此您可以说“此事件”或“今天”，它会正确解析。

在幕后，代理会调用 actions，如 `list-events`、`check-availability`、`create-event`、`navigate` 和 `update-availability`。由于事件存在于 Google Calendar 中，因此代理始终查询 API 而不是猜测 - 如果不先运行脚本，它不会返回空结果。

### 数据模型

在`templates/calendar/server/db/schema.ts`中定义。仅非事件数据存储在本地：

- `bookings` — 从公共预订页面确认的预约。存储姓名、电子邮件、开始、结束、副标题、可选注释、自定义字段响应、会议链接、用于公共管理的 `cancelToken` URL 以及 `confirmed` 或 `cancelled` 状态。
- `booking_links` — Calendly 样式链接定义。 Slug、标题、描述、主要 `duration`、可选 `durations` 列表、`customFields`、`conferencing`、`color` 和 `isActive` 标志。使用框架的`ownableColumns`，因此适用共享系统。
- `booking_slug_redirects` - 重命名链接时会记住旧的 slugs，以便现有的公共 URL 继续工作。
- `booking_link_shares` — 分享预订链接的赠款。

```an-schema title="日历数据模型" summary="仅非事件数据存储在本地 - 事件实时存储在 Google 日历中。预订链接使用 ownableColumns，因此共享系统适用。"
{
  "entities": [
    {
      "id": "booking_links",
      "name": "booking_links",
      "note": "Calendly-style link definitions (ownable)",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "slug", "type": "string", "note": "public page at /book/{slug}" },
        { "name": "title", "type": "string" },
        { "name": "description", "type": "string", "nullable": true },
        { "name": "duration", "type": "int", "note": "primary duration in minutes" },
        { "name": "durations", "type": "json", "nullable": true, "note": "alternative durations" },
        { "name": "customFields", "type": "json", "nullable": true },
        { "name": "conferencing", "type": "string", "note": "Google Meet / Zoom / 自定义" },
        { "name": "color", "type": "string", "nullable": true },
        { "name": "isActive", "type": "bool", "note": "pause without deleting" }
      ]
    },
    {
      "id": "bookings",
      "name": "bookings",
      "note": "从公共预订页面确认的预约",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "slug", "type": "string", "fk": "booking_links.slug" },
        { "name": "name", "type": "string" },
        { "name": "email", "type": "string" },
        { "name": "start", "type": "datetime" },
        { "name": "end", "type": "datetime" },
        { "name": "notes", "type": "string", "nullable": true },
        { "name": "customFields", "type": "json", "nullable": true, "note": "custom field responses" },
        { "name": "meetingLink", "type": "string", "nullable": true },
        { "name": "cancelToken", "type": "string", "note": "powers /booking/manage/{token}" },
        { "name": "status", "type": "enum", "note": "确认 |取消" }
      ]
    },
    {
      "id": "booking_slug_redirects",
      "name": "booking_slug_redirects",
      "note": "链接重命名后保持旧的公共 URLs 正常工作",
      "fields": [
        { "name": "oldSlug", "type": "string", "pk": true },
        { "name": "linkId", "type": "id", "fk": "booking_links.id" }
      ]
    },
    {
      "id": "booking_link_shares",
      "name": "booking_link_shares",
      "note": "分享预订链接赠款",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "linkId", "type": "id", "fk": "booking_links.id" },
        { "name": "principal", "type": "string", "note": "user or org" },
        { "name": "role", "type": "enum", "note": "观众|编辑|行政" }
      ]
    }
  ],
  "relations": [
    { "from": "booking_links", "to": "bookings", "kind": "1-n", "label": "has bookings" },
    { "from": "booking_links", "to": "booking_slug_redirects", "kind": "1-n", "label": "has old slugs" },
    { "from": "booking_links", "to": "booking_link_shares", "kind": "1-n", "label": "has share grants" }
  ]
}
```

可用性规则和每用户配置位于设置表中，由 `calendar-availability` 键入。 Google OAuth 代币位于框架 `oauth_tokens` 表中。临时 UI 状态（当前视图、日期、选定事件）位于 `navigation` 键下的 `application_state` 中。

### 自定义

应用程序的每个部分都是可编辑的源代码。从这里开始：

- `templates/calendar/actions/` — 每个代理可调用的操作。添加包含 `defineAction` 的新文件，以向代理和前端公开新功能。关键文件：`check-availability.ts`、`create-event.ts`、`list-events.ts`、`create-booking-link.ts`、`update-availability.ts`、`add-external-calendar.ts`、`navigate.ts`、`view-screen.ts`。
- `templates/calendar/app/routes/` — UI。 `_app._index.tsx`是日历，`_app.availability.tsx`是日程编辑器，`_app.booking-links._index.tsx`和`_app.booking-links.$id.tsx`管理预订链接，`_app.bookings.tsx`列出预订，`_app.settings.tsx`是设置，`book.$slug.tsx`加`meet.$username.$slug.tsx`是公共预订页面。
- `templates/calendar/server/db/schema.ts` — 添加带有 Drizzle 的列或表。保持代码与方言无关，以便模板在 SQLite、Postgres、Turso、D1 和 Neon 上运行。
- `templates/calendar/AGENTS.md` — 代理指令。当您向代理教授新功能或约定时更新此内容。
- `templates/calendar/.agents/skills/` — 代理遵循的详细模式。相关skills：`event-management`、`availability-booking`、`real-time-sync`、`storing-data`、`delegate-to-agent`、`frontend-design`。
- `templates/calendar/shared/api.ts` — 服务器和客户端使用的共享 TypeScript 类型（`AvailabilityConfig`、`BookingLink`、`ExternalCalendar` 等）。

如果您添加功能，请记住更新所有四个区域：UI、操作、技能或 AGENTS.md 条目，以及代理需要查看的任何应用程序状态。这就是使代理和 UI 保持平等的原因。
