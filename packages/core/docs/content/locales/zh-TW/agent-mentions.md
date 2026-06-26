---
title: "代理提及"
description: "使用@提及在聊天中標記自訂代理、連線的代理和檔案。"
---

# 代理提及

在聊天編輯器中鍵入 `@` 以提及自訂代理、連線的代理、檔案和資源。

## 概述 {#overview}

`@` 提及系統將聊天編輯器連線到更廣泛的代理生態系統。當您鍵入 `@` 時，會出現一個快顯視窗，列出可用的自訂代理、連線的代理、程式碼庫檔案和資源。

這是您透過單一聊天協調多代理工作流程的方式。要求您本機的 `@design` 代理評論布局，`@analytics` 從另一個應用程式中擷取最新資料，主要代理可以將兩者合併到一個對話中。

## 提及代理 {#mentioning-agents}

要在聊天編輯器中提及代理：

1. 輸入 `@` 開啟提及快顯視窗
2. 瀏覽或搜尋可用代理清單
3. 選取一個代理 - 它在您的訊息中顯示為標籤
4. 傳送訊息 - 伺服器解析提及並將該代理的回應包含在對話脈絡中

有兩條代理路徑：

- **自訂代理** — `agents/*.md` 中的本機工作區代理設定檔案。它們使用代理設定檔案的指令和可選模型覆蓋在目前應用程式/執行時內執行。
- **連線的代理** — 遠端 A2A 對等點。這些是透過 [A2A protocol](/docs/a2a-protocol) 呼叫的。

在這兩種情況下，您的主要代理都會看到回應並可以引用或建置它。

```an-diagram title="@提及路由的位置" summary="伺服器按型別拆分每個提及：自訂代理在本機執行，連線的代理透過 A2A - 兩個回應都折疊回主代理的脈絡中。"
{
  "html": "<div class=\"diagram-mention\"><div class=\"diagram-node\">@-mention<br><small class=\"diagram-muted\">in the composer</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">伺服器解析</span><small class=\"diagram-muted\">extract refs by type</small></div><div class=\"diagram-col\"><div class=\"row\"><span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</span><div class=\"diagram-box\">自訂代理<br><small class=\"diagram-muted\">agents/*.md &middot; runs local</small></div></div><div class=\"row\"><span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</span><div class=\"diagram-box\">已連線代理<br><small class=\"diagram-muted\">A2A peer &middot; remote call</small></div></div></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box diagram-accent\">&lt;agent-response&gt;<br><small class=\"diagram-muted\">injected into main agent</small></div></div>",
  "css": ".diagram-mention{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-mention .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-mention .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-mention .row{display:flex;align-items:center;gap:8px}.diagram-mention .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 它是如何工作的 {#how-it-works}

當傳送包含 `@` 提及的訊息時，伺服器上會發生以下情況：

1. 伺服器從訊息中擷取提及引用
2. 對於每個提到的代理：
   - 自訂代理按照其設定檔案說明在本機執行
   - 透過 A2A 呼叫連線的代理
3. 代理的回應被包裝在 `<agent-response>` XML 塊中並注入到對話脈絡中
4. 主代理處理豐富的訊息，檢視使用者的文字和提到的代理的回應

主代理在其脈絡中看到的內容：

```text
User: Draft an email with the latest signup numbers. @analytics

<agent-response agent="analytics">
Last week's signups: 1,247 total
  - Organic: 623
  - Paid: 412
  - Referral: 212
</agent-response>
```

然後，主代理可以在其回應中自然地使用這些資料 - 例如，將這些數字合併到電子郵件草稿中。

```an-callout
{
  "tone": "info",
  "body": "Mentioned-agent output arrives as an `<agent-response agent=\"…\">` block in the **main agent's** context — not as separate chat bubbles. The main agent decides how to weave it into the reply."
}
```

## 新增代理 {#adding-agents}

可以透過多種機制提及代理：

- **自訂工作區代理** — 在“工作區”分頁中建立代理設定檔案為 `agents/*.md`
- **自動發現** - 框架自動發現在已知連接埠或設定的 URL 上執行的連線代理
- **遠端清單** — 新增連線代理清單為 `remote-agents/*.json`

### 自訂工作區代理

自訂代理是儲存在工作區中的 Markdown 檔案：

```markdown
---
name: Design
description: Reviews layouts, product UX, and visual direction.
model: inherit
---

You are a focused design agent.
```

請參閱 [Workspace — Custom Agents](/docs/workspace#custom-agents) 了解完整格式（包括 `tools`、`delegate-default` 和模型覆蓋）。

您可以使用以下方法從“工作區”分頁建立它們：

- `Create Agent` -> `Describe It`
- `Create Agent` -> `Fill Form`

### 連線代理清單

遠端 A2A 代理仍然使用 JSON 清單：

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

## 對於開發者：擴充功能提及 {#extending-mentions}

範本可以註冊自訂提及提供者，以新增代理和檔案之外的特定於域的可提及專案。提及提供者實現了 `MentionProvider` 介面：

```an-annotated-code title="自訂 MentionProvider"
{
  "filename": "server/mentions/contacts.ts",
  "language": "ts",
  "code": "import type { MentionProvider } from \"@agent-native/core/server\";\n\nconst contactsProvider: MentionProvider = {\n  id: \"contacts\",\n  label: \"Contacts\",\n\n  // 搜尋 for mentionable items\n  async search(query: string) {\n    const contacts = await db.query.contacts.findMany({\n      where: like(contacts.name, `%${query}%`),\n      limit: 10,\n    });\n    return contacts.map((c) => ({\n      id: c.id,\n      label: c.name,\n      description: c.email,\n      type: \"contact\",\n    }));\n  },\n\n  // Resolve a mention into context for the agent\n  async resolve(id: string) {\n    const contact = await db.query.contacts.findFirst({\n      where: eq(contacts.id, id),\n    });\n    return {\n      type: \"context\",\n      text: `Contact: ${contact.name} (${contact.email})`,\n    };\n  },\n};",
  "annotations": [
    { "lines": "4-5", "label": "身分", "note": "`id` namespaces the provider; `label` is the section heading shown in the `@` popover." },
    { "lines": "8-9", "label": "search", "note": "Runs as the user types after `@`. Return up to a handful of matches as `{ id, label, description, type }`." },
    { "lines": "23-24", "label": "resolve", "note": "Called when the message is sent. Turns a picked id into `{ type: \"context\", text }` that is injected into the agent's context." }
  ]
}
```

在代理聊天外掛設定中註冊提供者：

```ts
// server/plugins/agent-chat.ts
import { createAgentChatPlugin } from "@agent-native/core/server";

export default createAgentChatPlugin({
  actions: scriptRegistry,
  systemPrompt: "You are a helpful assistant...",
  mentionProviders: { contacts: contactsProvider },
});
```

自訂提及提供者與內建代理和檔案提供者一起顯示在提及快顯視窗中。

## 引用檔案 {#referencing-files}

`@` 快顯視窗不僅限於代理。您還可以參考：

- **程式碼庫檔案** — 輸入 `@` 並搜尋檔名。檔案內容包含在代理的脈絡中，因此它可以讀取、分析或修改檔案。
- **工作空間資源** — 在“工作空間”分頁中定義的參考檔案。這些可以是資料檔案、設定或任何其他結構化內容。
- **Skills** — 輸入 `/` 來引用技能。 Skills 提供結構化指令來指導代理如何處理工作。

所有引用型別都遵循相同的模式：從快顯視窗中進行選取，傳送訊息時引用的內容將被解析並注入到代理的脈絡中。

## 子代理選取 {#sub-agent-selection}

當使用 `agent-teams` 生成子代理時，主代理還可以使用自訂代理（操作：“spawn”）。

傳遞`agent`參數以從`agents/*.md`中選取設定檔案。該設定檔案的指令將新增到委托執行中，並且其 `model` frontmatter 可以覆蓋該子代理的預設模型。
