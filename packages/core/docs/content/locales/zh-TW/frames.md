---
title: "框架"
description: "本機開發框架、嵌入式代理面板和雲端框架 - AI 代理與您的應用程式一起執行的方式。"
---

# 框架

每個 Agent-Native 應用程式都與應用程式 UI 旁邊的 AI 代理一起執行。 **框架**是
承載兩者的包裝器：它顯示您的應用程式並為代理提供一個地方
聊天、執行和（在開發中）編輯程式碼。一共有三個框架，共用一個執行時：

- **嵌入式代理面板** - 內建於 `@agent-native/core` 的每個應用程式中。
  這是您的應用在開發和正式環境過程中自行呈現的側邊欄。
- **本機開發框架** - 在 iframe 中載入正在執行的應用程式的薄包裝器
  並新增相同的代理面板以及旁邊的整合 CLI 終端。使用過
  用於此儲存庫中範本的本機開發。
- **Builder.io 雲端框架** — 具有協作功能的託管託管框架，
  視覺化編輯，並行代理執行。

無論託管哪個框架，您的應用程式碼都是相同的。代理說話
在每種情況下都透過相同的 actions 和應用程式狀態連線到您的應用程式。

```an-diagram title="三幀，一個執行時間" summary="您的應用程式和代理面板在每一幀中都是相同的；只有它們週圍的包裝發生變化。"
{
  "html": "<div class=\"diagram-frames\"><div class=\"diagram-card\" data-rough><span class=\"diagram-pill accent\">嵌入面板</span><small class=\"diagram-muted\">隨每個應用提供 · 開發 + 正式環境</small></div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill\">本機開發框架</span><small class=\"diagram-muted\">iframe 中的應用 + 面板 + CLI 終端</small></div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill\">Builder.io 雲端框架</span><small class=\"diagram-muted\">託管：協作 · 可視編輯 · 並行執行</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>同一 runtime<br><small class=\"diagram-muted\">你的應用 · 操作 · 應用狀態</small></div></div>",
  "css": ".diagram-frames{display:flex;flex-direction:column;gap:10px;align-items:stretch}.diagram-frames .diagram-card{display:flex;flex-direction:column;gap:4px;padding:12px 16px}.diagram-frames .diagram-arrow{font-size:22px;line-height:1;align-self:center}"
}
```

## 嵌入式代理面板 {#embedded-agent}

嵌入式面板是您的應用程式呈現的代理側邊欄。它附帶
`@agent-native/core` - 沒有單獨的套件需要安裝 - 並且是相同的
開發和正式環境中的元件。

- 從 `@agent-native/core/client` 匯出為 `AgentPanel`，帶有
  僅限正式環境的變體 `ProductionAgentPanel`。
- 提供完整的聊天/CLI/工作空間介面，因此座席輸入保持開啟
  框架中其他地方使用的共用 撰寫r 堆堆疊。
- 每回合都會讀取 `application_state.navigation`，因此它已經知道是哪個
  檢視您所在的位置以及選取的內容 - 您無需重新解釋“此”。

### 應用程式與程式碼工具模式 {#tool-modes}

面板以兩種工具模式之一執行：

- **應用程式模式** - 代理只有您的應用程式自己的工具：您的 actions
  使用 `defineAction` 定義，加上導覽和脈絡。沒有檔案系統或
  外殼存取。這就是最終使用者得到的。
- **程式碼模式** — 新增共用編碼工具（`bash`、`read`、`edit`、`write`）
  以及應用程式工具之上的資料庫存取，因此代理可以更改應用程式的
  自己的來源。程式碼請求被門控：當訊息需要程式碼時
  (`type: "code"`)並且沒有連線支援程式碼的框架，面板顯示
  解釋程式碼更改需要 Agent Native Desktop 或 Builder 的對話框；
  當連線框架時，請求將路由到它和程式碼代理
  工作時指示燈顯示 (`useSendToAgentChat`)。對於規範
  編碼工具清單和共用 UI 合約，參見
  [Agent-Native Code UI](/docs/code-agents-ui).

```an-diagram title="程式碼請求門控" summary="程式碼型別訊息需要支援程式碼的幀。一旦連線，請求就會路由到那裡；如果沒有，面板會解釋程式碼更改需要 Desktop 或 Builder。"
{
  "html": "<div class=\"diagram-gate\"><div class=\"diagram-node\" data-rough>message<br><small class=\"diagram-muted\">type: \\\"code\\\"</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough>code-capable frame connected?</div><div class=\"diagram-col\"><div class=\"diagram-pill ok\">yes &rarr; route to frame, show code-agent indicator</div><div class=\"diagram-pill warn\">no &rarr; dialog: needs Desktop or Builder</div></div></div>",
  "css": ".diagram-gate{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-gate .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-gate .diagram-arrow{font-size:22px;line-height:1}.diagram-gate .center{text-align:center}"
}
```

“程式碼模式”是代理功能切換 - 與環境開發模式不同
（`NODE_ENV` / Vite）。用戶端鉤子是`useCodeMode()`。 （參見
[Compatibility notes](#compatibility) 用於向後相容別名。）

在本機開發框架中，設定齒輪在這些模式之間切換。切換
關閉程式碼模式隱藏框架自己的側邊欄並顯示應用程式的應用內代理
側邊欄位於 iframe 內，因此您可以準確預覽最終使用者所看到的內容。

## 整合終端和 CLI 切換 {#cli-terminal}

正在開發中，面板包括一個嵌入式終端（`AgentTerminal`，也
來自 `@agent-native/core/client`），由 PTY 伺服器支援。你可以執行一個真正的
在應用程式旁邊編碼 CLI 並在它們之間切換；終端重新啟動
與選定的 CLI。

支援的 CLI 來自核心 CLI 註冊表
(`packages/core/src/terminal/cli-registry.ts`)。僅允許這些指令
生成 - PTY 伺服器根據註冊表驗證請求的指令
允許清單以防止注入：

| CLI           | 指令       | 安裝包                      |
| ------------- | ---------- | --------------------------- |
| Claude 程式碼 | `claude`   | `@anthropic-ai/claude-code` |
| Builder.io    | `builder`  | （內建）                    |
| Codex         | `codex`    | `@openai/codex`             |
| 雙子座 CLI    | `gemini`   | `@google/gemini-cli`        |
| 開放程式碼    | `opencode` | `opencode-ai`               |

如果在 `PATH` 上找不到所選的 CLI，終端將回退到執行它
透過 `npx --yes <install-package>@latest`（存在安裝包的地方）。
預設指令是`claude`。隨時從代理面板設定切換 CLI
時間。

## Builder.io 雲端框 {#cloud-frame}

[Builder.io](https://www.builder.io) 提供託管框架
相同的應用程式和相同的代理面板，在雲端端：

- 即時協作 - 多個使用者可以同時觀看和互動。
- 視覺化編輯、角色和權限。
- 並行代理執行以加快迭代速度。
- 適合團隊使用，每個人共用一個託管環境。

來自嵌入式面板的程式碼請求以相同的方式路由到 Builder 框架
它們路由到本機開發框架，因此上面的 dev-vs-prod 行為是
兩者一致。

## 執行時 APIs {#runtime-apis}

這些隨 `@agent-native/core` 一起提供，是您的應用用來與
代理，無論哪個框架託管它：

1. **傳送訊息** — `sendToAgentChat()` 向代理傳送訊息。
   `useSendToAgentChat()` 鉤子用描述的程式碼請求門控包裝它
   並返回一個 `codeRequiredDialog` 元素進行渲染。參見
   [Drop-in Agent](/docs/drop-in-agent) 的完整用法和選項。
2. **生成狀態** - `useAgentChatGenerating()` 跟蹤代理何時
   正在執行，因此 UI 可以顯示進度，而無需直接輪詢代理。
3. **輪詢同步** - 資料庫支援的同步在代理時保持 UI 快取最新
   更改資料或應用程式狀態。
4. **操作系統** - `pnpm action <name>` 分派到相同的可呼叫
   actions 代理作為工具呼叫，因此代理能做的任何事情，您都可以
   指令碼。

## 執行它 {#running}

嵌入式代理面板是每個應用程式的一部分 - 搭建一個範本，它是
已經在那裡：

```bash
npx @agent-native/core@latest create my-app --template mail --standalone
cd my-app
pnpm dev
```

本機開發框架（框架儲存庫中的私人 `@agent-native/frame` 包）是未發布到 npm 的內部工具包。它將活動應用程式的開發伺服器載入到 iframe 中，並在其旁邊安裝嵌入式面板，透過 `app` 查詢參數選取應用程式。整合 CLI 終端需要 Agent Native Desktop，提供終端所需的本機程式碼和PTY存取；如果沒有它，面板將顯示聊天介面並提示您開啟桌面以使用 CLI。

## 相容性說明 {#compatibility}

“程式碼模式”概念以前被稱為“開發模式”，因此有一些向後相容
名稱仍然存在。您可以忽略這些，除非您正在維護舊的整合
程式碼：

- 底層 `AGENT_MODE` 環境變數，`/_agent-native/agent-chat/mode`
  端點（其負載金鑰仍然是`devMode`），以及`agent-chat.mode`
  設定鍵未更改。
- `useDevMode()` 仍然是 `useCodeMode()` 的已棄用別名。
