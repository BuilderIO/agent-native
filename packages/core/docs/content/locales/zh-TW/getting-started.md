---
title: "開始使用"
description: "建立代理應用，了解說明、skills 和 actions，然後觀看代理呼叫其第一個操作。"
---

# 開始使用

Agent-Native 應用程式為 AI 代理和您的 UI 提供相同的 actions、資料和
狀態。基本代理是由指導它的指令（skills 進行教學）組成的
可重複的行為，以及讓它做實際工作的 actions。

**想要一個完整的應用程式開始嗎？**克隆我們豐富的範本之一 -
[Chat](/docs/template-chat), [Mail](/docs/template-mail),
[Calendar](/docs/template-calendar), [Content](/docs/template-content),
[Analytics](/docs/template-analytics) 和 [many more](/docs/cloneable-saas) —
每個都是您自訂的全功能應用程式。

從頭開始建置？唯一的選取是您是否想要 UI —
之後的一切（編寫指令、新增 skills、定義 actions、執行
代理）無論哪種方式都是相同的。

```an-file-tree title="一個基礎 Agent-Native 代理"
{
  "entries": [
    { "path": "AGENTS.md", "note": "始終生效的指令：目的、規則、語氣以及代理能力地圖" },
    { "path": ".agents/skills/customer-research/SKILL.md", "note": "工作匹配時代理會載入的可複用 playbook" },
    { "path": "actions/summarize-week.ts", "note": "代理、UI、CLI、HTTP、MCP、A2A、jobs 和 webhooks 都能執行的型別化程式碼" }
  ]
}
```

無論您是從聊天 UI、無頭代理還是完整應用程式開始，都是如此。
UI 改變表面；指令、skills 和 actions 為代理提供
指導和行為。

## 1。建立您的應用

您需要 [Node.js 22+](https://nodejs.org) 和 [pnpm](https://pnpm.io)。

在沒有標誌的情況下執行 `create`，它會詢問您要如何開始（完整的範本，
聊天，或無頭）先於其他：

```bash
npx @agent-native/core@latest create my-app
```

或者傳遞一個標誌來跳過提示：

**想要 UI？** 從聊天範本開始。您將獲得一名工作代理以及
可自訂的聊天 UI，您新增的每個操作都會自動顯示在其中：

```bash
npx @agent-native/core@latest create my-app --template chat
```

**只是無頭原語？**開始無頭 - 相同的 actions 和代理
迴圈，無 UI shell：

```bash
npx @agent-native/core@latest create my-agent --headless
```

然後從您建立的資料夾安裝：

```bash
cd my-agent # 或 my-app（如果您選取聊天範本）
pnpm install
```

從現在開始，兩者是相同的。

## 2。新增操作

操作是您的代理（以及您的 UI）可以呼叫的一項操作。兩個腳手架
附帶此範例：

```an-annotated-code title="你的第一個 action"
{
  "filename": "actions/hello.ts",
  "language": "ts",
  "code": "import { defineAction } from \"@agent-native/core/action\";\nimport { z } from \"zod\";\n\nexport default defineAction({\n  description: \"從本機代理問好。\",\n  schema: z.object({\n    name: z.string().default(\"world\"),\n  }),\n  http: { method: \"GET\" },\n  readOnly: true,\n  run: async ({ name }) => {\n    return { message: `Hello, ${name}!` };\n  },\n});",
  "annotations": [
    { "lines": "5", "label": "工具描述", "note": "代理會讀取 `description`，判斷何時把它作為工具呼叫。" },
    { "lines": "6-8", "label": "型別化契約", "note": "一個 zod `schema` 會校驗來自每個入口的輸入：代理、UI、HTTP、MCP 和 A2A。" },
    { "lines": "9", "label": "HTTP 動詞", "note": "將此操作接入自動掛載的 HTTP 端點。" },
    { "lines": "10", "label": "唯讀", "note": "`readOnly` 表示該操作無需核准即可安全呼叫，並且可作為查詢快取。" },
    { "lines": "11-13", "label": "單一實現", "note": "`run` 主體是所有介面都會執行的唯一真實來源。" }
  ]
}
```

將 `hello` 替換為您域中的第一個實際操作。您定義一次；
每個表面都會吸收它。

使用 `AGENTS.md` 作為每回合都適用的指導。使用技能時
代理需要可重用的工作流程或域過程。在以下情況下使用操作
代理需要一種型別化、可測試的方式來讀取資料、寫入資料、呼叫 API 或
執行核准。

## 3。執行它

直接呼叫操作：

```bash
pnpm action hello --name Steve
```

或請代理為您致電：

```bash
pnpm agent "Call the hello action for Steve and explain what happened."
```

如果您從聊天範本開始，請執行該應用並在
瀏覽器 - 它已經可以呼叫您定義的每個操作：

```bash
pnpm dev
```

現在可以透過聊天 UI、CLI、HTTP、MCP、A2A 存取該操作
計畫作業和 webhooks。定義一次，從任何地方呼叫。

```an-diagram title="一個動作，每個表面" summary="單一 defineAction 檔案扇出到每個消費者，無需額外接線。"
{
  "html": "<div class=\"diagram-fan\"><div class=\"diagram-box\" data-rough>defineAction</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-surfaces\"><span class=\"diagram-pill\">聊天介面</span><span class=\"diagram-pill\">CLI</span><span class=\"diagram-pill\">HTTP</span><span class=\"diagram-pill\">MCP</span><span class=\"diagram-pill\">A2A</span><span class=\"diagram-pill\">計畫工作</span><span class=\"diagram-pill\">Webhooks</span></div></div>",
  "css": ".diagram-fan{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-fan .diagram-surfaces{display:flex;flex-wrap:wrap;gap:8px;max-width:420px}.diagram-fan .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 狀態是內建的

無頭並不意味著無狀態。 Actions，工作階段，應用程式狀態，對話串，
執行歷史紀錄和憑證均位於 SQL 中。本機地址為 SQLite
`data/app.db`；在正式環境中您設定 `DATABASE_URL`。請參閱
[Deployment](/docs/deployment).

```an-callout
{
  "tone": "info",
  "body": "**Headless 仍然是一個真正的應用程式。**應用程式代理迴圈在 SQL 中保留工作階段、對話串、執行、設定和憑證 - 它不是無狀態提示。您可以稍後新增 UI，而無需更改操作或狀態。"
}
```

## 自訂 UI

如果您從聊天範本開始，則可以編輯 UI。聊天本身
是基於 `<AgentChatSurface>` 元件建置的一條小路由：

```tsx
// app/routes/_index.tsx
import { AgentChatSurface } from "@agent-native/core/client";

export default function ChatRoute() {
  return <AgentChatSurface mode="page" className="h-full" />;
}
```

- **`app/routes/_index.tsx`** — 聊天頁面。更改建議，空
  狀態和布局。
- **`app/root.tsx`** — 應用程式外殼。在週圍新增您自己的路由和螢幕
  代理。
- 使用 `<AgentSidebar>` 將代理放入任何螢幕，從 a 手動操作它
  使用 `sendToAgentChat()` 按鈕，或直接使用
  `useActionMutation()`.

請參閱 [Drop-in Agent](/docs/drop-in-agent) 了解完整的元件集，並且
[Native 聊天介面](/docs/native-chat-ui) 將操作結果呈現為表格，
圖表和打字卡片而不是純文字。

**開始無頭，稍後想要 UI？** 聊天範本*是* UI 入口 -
它的`app/`層（React Router + Vite）正是無頭腳手架
省略。最幹淨的舉動是從聊天開始（或重新搭建支架）
範本；您的 `actions/`、代理和 SQL 狀態保持不變。請參閱
[Agent Surfaces](/docs/agent-surfaces) 代表其間的每個表面。

## 專案結構

```text
my-app/
  actions/         # 代理可呼叫的操作
  app/             # React 前端（僅 UI 範本；無頭模式會省略）
  server/          # Nitro API 伺服器（路由、外掛）
  AGENTS.md        # 始終生效的代理指令
  .agents/         # 代理可按需引入的技能
  data/app.db      # 未設定 DATABASE_URL 時的本機 SQLite 狀態
```

## 下一步去哪裡

- **[Key Concepts](/docs/key-concepts)** — 核心架構：SQL、actions，
  同步和脈絡感知。
- **[Actions](/docs/actions)** — 完整操作 API：架構、HTTP、驗證和
  核准。
- **[Agent Surfaces](/docs/agent-surfaces)** — 無頭、聊天、嵌入式 sidecar，
  和完整的應用程式。
- **[Drop-in Agent](/docs/drop-in-agent)** — 將代理聊天新增到任何 React 應用程式。
- **[Deployment](/docs/deployment)** — 將您的應用放在您自己的域中。
- **[FAQ](/docs/faq)** — 設定和產品問題。
