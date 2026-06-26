---
title: "安全帶特工"
description: "將 Claude Code、Codex、Pi 和其他完整的編碼工具作為 Agent-Native 內的嵌入式代理執行，並具有自己的循環、沙箱、本機工具和可恢復的 SQL 支持的工作階段。"
search: "harness代理AgentHarness ai-sdk HarnessAgent Claude程式碼Codex Pi Cursor Mastra嵌入式編碼代理resolveAgentHarness startAgentHarnessRun可恢復工作階段沙箱主機工具"
---

# 安全特工

> **這是給誰的：** 主機作者連線完整的編碼執行時（Claude 程式碼，
> Codex, Pi) 轉換為 Agent-Native 作為代理。建置應用程式？從
> [Creating Templates](/docs/creating-templates).

線束代理是一個完整的代理執行時 - Claude 程式碼、Codex、Pi 等 -
擁有自己的循環、工作區、本機檔案工具、工作階段狀態、壓縮，
審批模型和沙箱行為。 Agent-Native 通過
**`AgentHarness`** `@agent-native/core/agent/harness` 中的基質，流式傳輸它們
將事件放入正常的紀錄中，並保留其本機工作階段，以便成為一個線程
可以暫停和恢復。

這與內置聊天代理和自帶聊天功能不同
執行時。內置代理和`AgentEngine`為一個模型往返
在`runAgentLoop`下面。一個harness不是一個`AgentEngine`提供者——它執行它的
自己的端對端循環，因此 Agent-Native 將其作為工作階段驅動，而不是單個
模型調用。

```an-diagram title="安全帶擁有它的環； Agent-Native 驅動工作階段" summary="AgentHarness 底層 creates/resumes 本機工作階段，將其事件流式傳輸到正常轉錄本中，並在輪次之間將恢復狀態保留在 SQL 中。"
{
  "html": "<div class=\"diagram-harness\"><div class=\"diagram-box\" data-rough><strong>AgentHarness substrate</strong><small class=\"diagram-muted\">@agent-native/core/agent/harness</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><strong>Native harness loop</strong><small class=\"diagram-muted\">Claude Code · Codex · Pi — own tools, sandbox, compaction</small></div><div class=\"diagram-col\"><div class=\"diagram-pill accent\">events &rarr; transcript</div><div class=\"diagram-pill ok\">resumeState &rarr; SQL session</div></div></div>",
  "css": ".diagram-harness{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-harness .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-harness .diagram-arrow{font-size:22px;line-height:1}.diagram-harness .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## 我需要哪個編碼檔案？ {#which-doc}

| 你想要……                                                 | 使用                                         |
| -------------------------------------------------------- | -------------------------------------------- |
| 使用自己的循環+工具**作為代理**執行Claude程式碼/Codex/Pi | **安全帶代理**（本頁面）                     |
| 渲染 Claude-Code/Codex 樣式 **編碼工作區 UI**            | [Agent-Native Code UI](/docs/code-agents-ui) |
| 交換執行代理的 **`run-code` 工具**的後端                 | [Adapters](/docs/sandbox-adapters)           |
| 封裝一個CLI工具（`gh`、`ffmpeg`）供代理調用              | [Adapters](/docs/sandbox-adapters)           |

相鄰表面：將您在其他地方建置的代理放在 Agent-Native 的聊天後面
UI 與 [`AgentChatRuntime`](/docs/native-chat-ui#byo-agent-runtimes)；讓一個
外部 MCP 主機通過 [External Agents](/docs/external-agents) 調用您的應用；
生成後台/子代理與 [Custom Agents & Teams](/docs/agent-teams) 一起執行。

## 內置安全帶 {#built-in}

`registerBuiltinAgentHarnesses()` 註冊由 AI SDK 支持的三個適配器
`HarnessAgent`:

| 姓名                         | 執行時       | 沙盒 | 批準 |
| ---------------------------- | ------------ | ---- | ---- |
| `ai-sdk-harness:claude-code` | Claude程式碼 | 是的 | 是的 |
| `ai-sdk-harness:codex`       | Codex        | 是的 | 沒有 |
| `ai-sdk-harness:pi`          | 圓週率       | 沒有 | 是的 |

它們的執行時包是**可選的對等依賴項**並且延遲載入，因此
從不使用安全帶的應用程式無需付費。每個適配器都帶有一個
`installPackage` 提示（例如`@ai-sdk/harness@canary
@ai-sdk/harness-codex@canary`); `resolveAgentHarness`拋出一個明確的安裝
如果缺少包，則會出現錯誤，並且 `isAgentHarnessPackageInstalled(entry)`
讓您先檢查。

`registerBuiltinAgentHarnesses()` 還註冊了 [ACP](#acp) 線束
(`acp`, `acp:gemini`, `acp:claude-code`).

## ACP代理 {#acp}

Agent-Native可以充當[ACP](https://agentclientprotocol.com)（代理用戶端
協議）**用戶端**並驅動本機編碼代理 - Gemini CLI、Claude 程式碼，
或任何符合ACP標準的代理——通過相同的基材。代理作為
本機子進程通過stdio使用換行符分隔的JSON-RPC； ACP的編輯
↔ 代理模型就是這個形狀。

此適配器的範圍是**本機編碼**。子進程繼承
父環境，因此代理重用它已有的任何本機 CLI 登入
（例如使用者主目錄中的 `gemini` 或 `claude` 驗證）。這不是一個
託管或沙盒傳輸，並且它不是聊天/A2A 傳輸 - 對於這些，
參見[Agent Surfaces](/docs/agent-surfaces)。

| 姓名              | 預設指令                                       | 可恢復\* |
| ----------------- | ---------------------------------------------- | -------- |
| `acp`             | _(通過設定提供`command`/`args`)_               | 是的     |
| `acp:gemini`      | `npx -y @google/gemini-cli --experimental-acp` | 是的     |
| `acp:claude-code` | `npx -y @zed-industries/claude-code-acp`       | 是的     |

\*當代理通告 `loadSession` 功能時恢復工作並且
否則將降級為新工作階段。

```ts
import {
  registerBuiltinAgentHarnesses,
  resolveAgentHarness,
} from "@agent-native/core/agent/harness";

registerBuiltinAgentHarnesses();

// A built-in preset (command/args are overridable through the resolve config):
const adapter = resolveAgentHarness("acp:gemini");

// Or any ACP agent by command:
const custom = resolveAgentHarness("acp", {
  command: "gemini",
  args: ["--experimental-acp"],
});
```

協議傳輸（`@zed-industries/agent-client-protocol`）是可選的
通過`installPackage`提示延遲載入依賴，就像AI SDK一樣
安全帶。代理二進制檔案本身（`@google/gemini-cli`，
`@zed-industries/claude-code-acp`, …) 是一個單獨的外部 CLI；預設
通過 `npx` 啟動它，並且指令/參數保持可重寫，因為代理 ACP
入口標志仍在演變。

`permissionMode` 使用工具調用對應到 ACP `session/request_permission`
設定代理報告：讀取始終執行，編輯在 `allow-edits` 下執行，以及
一切有風險的提示，除非`allow-all`。批準表面正常
`approval-request` 事件。該適配器服務於 `fs/read_text_file` 和
`fs/write_text_file` 針對工作階段工作區（拒絕逃逸路徑
it) 並寫入發出 `file-change` 事件；終端方法未公布，
因此代理使用自己的 shell。

## Codex 驗證：程式碼 UI 與 Harness 沙箱 {#codex-auth}

有兩個 Codex 表面，它們的驗證方式不同：

- **Agent-Native 程式碼/桌面** 在使用者計算機上執行 `codex exec`。如果
  使用者已執行`codex login`，此本機執行重用任何ChatGPT
  通過訂閱或API金鑰驗證已安裝的Codex CLI報告
  `codex login status`.
- **`ai-sdk-harness:codex`**載入`@ai-sdk/harness-codex`，它驅動Codex
  通過 `@openai/codex-sdk` 進入線束沙箱。它不會默默地
  繼承使用者的桌面 `~/.codex` 登入名，因為沙箱可能是遠端的
  或孤立。對於可信/私人沙箱，請選取使用 `codexCliAuth: true`；
  Agent-Native 將本機 Codex CLI auth 檔案複製到沙箱中
  安全帶啟動。對於託管或共用沙箱，設定 API-key / gateway
  改為驗證。

因此，如果有人詢問哪個包帶有 Codex OAuth 路徑：用於本機編碼
工作階段，使用`@agent-native/core` /桌面加上已安裝的
`@openai/codex` CLI 和 `codex login`。對於沙盒 `ai-sdk-harness:codex`，
將登入資訊複製到沙箱時使用顯式 `codexCliAuth` 選取加入
可以接受。

```ts
const adapter = resolveAgentHarness("ai-sdk-harness:codex", {
  codexCliAuth: true,
});
```

`codexCliAuth: true` 讀取為 `CODEX_HOME/auth.json` 或 `~/.codex/auth.json`。至
指向不同的本機登入，通過
`{ codexCliAuth: { codexHome: "/path/to/.codex" } }` 或
`{ codexCliAuth: { authJsonPath: "/path/to/auth.json" } }`.

## 註冊並解析 {#register-resolve}

```ts
import {
  registerBuiltinAgentHarnesses,
  resolveAgentHarness,
} from "@agent-native/core/agent/harness";

registerBuiltinAgentHarnesses();
const adapter = resolveAgentHarness("ai-sdk-harness:codex");
```

`resolveAgentHarness(name, config?)` 返回 `AgentHarnessAdapter`。
可選的 `config` 被轉發到適配器工廠 - 用於 AI SDK 適配器
對應到 `AiSdkHarnessAdapterOptions`（`label`、`description`，
僅 `permissionMode`、`harnessOptions`、`agentOptions` 和 Codex
`codexCliAuth`）。使用`listAgentHarnesses()`枚舉註冊的內容
一個選取器。

## 跑一圈 {#run-a-turn}

`startAgentHarnessRun` 將線束工作階段橋接到共用執行管理器
生命週期。它建立（或重用）本機工作階段，保留它，流式傳輸
turn，將每個線束事件轉換為轉錄事件，並分離
回合完成時可恢復狀態。

```ts
import { startAgentHarnessRun } from "@agent-native/core/agent/harness";

const run = startAgentHarnessRun({
  runId,
  threadId,
  adapter,
  input: { prompt },
  createSession: {
    sessionId,
    resumeState, // opaque value from a previous turn, if resuming
    instructions,
    sandbox, // required for sandboxed harnesses — see Sandbox Adapters
    permissionMode: "allow-reads",
    tools, // a narrow, intentional set of host tools (see below)
  },
  ownerEmail,
  orgId,
});
```

`startAgentHarnessRun`從執行管理器返回`ActiveRun`，所以輪到
通過現有的跑步路線、成績單和取消顯示，就像
任何其他代理執行。傳遞已經建立的 `session` 而不是 `createSession`
繼續您在內存中儲存的工作階段。

## 會議和簡歷 {#sessions}

線束擁有長期存在的本機工作階段狀態。 Agent-Native 將其保留在 SQL
因此線程可以在輪流、進程和部署中生存。 `resumeState`
是**不透明** - Agent-Native 存儲它並將其返還，但從不檢查或
解釋它。

```an-diagram title="跨回合、流程和部署恢復" summary="每一輪都會將一個不透明的resumeState分離到SQL中；下一回合將其意見回饋到 createSession 而不是重播聊天紀錄。"
{
  "html": "<div class=\"diagram-resume\"><div class=\"diagram-node\" data-rough>第 N 輪<br><small class=\"diagram-muted\">streamTurn</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>detach &rarr; resumeState<br><small class=\"diagram-muted\">不透明 · SQL harness 工作階段</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\" data-rough>第 N+1 輪<br><small class=\"diagram-muted\">createSession.resumeState</small></div></div>",
  "css": ".diagram-resume{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-resume .diagram-arrow{font-size:22px;line-height:1}"
}
```

```ts
import {
  getLatestAgentHarnessSessionForThread,
  listAgentHarnessSessions,
} from "@agent-native/core/agent/harness";

const last = await getLatestAgentHarnessSessionForThread(threadId);
// Feed last?.resumeState into createSession.resumeState on the next turn.
```

商店還公開了`saveAgentHarnessSession`、`updateAgentHarnessSession`，
`getAgentHarnessSession`, `getAgentHarnessSessionByRunId`,
`markAgentHarnessSessionStopped` 和 `ensureAgentHarnessSessionTables`。
`startAgentHarnessRun` 為您調用儲存/更新/停止路徑；伸手去夠他們
僅直接在自訂主機中。

## 託管工具和權限 {#host-tools}

線束帶有自己的本機工具（讀取、編輯、寫入、shell 等），因此
您**不**將檔案編輯重新公開為主機工具。僅通過**狹窄，
當您通過 `createSession.tools` 有意設定** Agent-Native actions
希望該工具能夠實現特定的應用操作 - 並保留 `defineAction`
驗證、請求上下文、超時、截斷和唯讀元資料完好無損
你知道。

`permissionMode` 控制安全帶在未經批準的情況下可以執行的操作：

| 模式          | 含義                                      |
| ------------- | ----------------------------------------- |
| `allow-reads` | 預設。讀取執行；編輯和有風險的actions提示 |
| `allow-edits` | 讀取和編輯執行；其他有風險actions提示     |
| `allow-all`   | 無審批門控                                |

當線束暫停等待批準時，它會發出 `approval-request` 事件，並且
工作階段標記為 `idle`，並紀錄待批準，因此 UI 可以
將其浮出水面並根據使用者的決定繼續。請參閱
[Human Approval](/docs/human-approval) 為批準表面。

## 活動 {#events}

線束工作階段流式傳輸 `AgentHarnessEvent` 值，其中 Agent-Native
轉換為標準 `AgentChatEvent` 流
`agentHarnessEventToAgentChatEvents`。事件聯盟覆蓋`text-delta`，
`thinking-delta`、`activity`、`tool-start`、`tool-done`（可攜帶
`mcpApp` 原生小部件的負載）、`approval-request`、`file-change`，
`compaction`、`usage`、`error` 和 `done`。因為工具結果流經
相同的翻譯，動作聲明的本機小部件仍然呈現 - 請參閱
[Native 聊天介面](/docs/native-chat-ui).

## 後台執行和UI {#background-runs}

Harness 將專案執行到共用的 `BackgroundAgentRun` 形狀中
`createAgentHarnessBackgroundAgentController()` 並可通過
現有執行路線為`goalId=agent-harness`。這意味著長期執行的 Claude
程式碼或 Codex 工作階段出現在相同的後台執行和轉錄表面中
作為代理團隊和其他適配器，使用 `listAgentHarnessBackgroundRuns`，
`listAgentHarnessBackgroundTranscriptEvents`、`getAgentHarnessBackgroundRun` 和
`stopAgentHarnessBackgroundRun` 可用於自訂主機。

## 自訂適配器 {#custom-adapters}

要包裝不是內置函數之一的執行時，請實現
`AgentHarnessAdapter` 並註冊它。適配器聲明其功能並且
建立工作階段；工作階段公開 `streamTurn` 和可選的 `continueTurn`，
`approve`、`detach`、`stop` 和 `destroy`。

```ts
import {
  registerAgentHarness,
  type AgentHarnessAdapter,
} from "@agent-native/core/agent/harness";

const myHarness: AgentHarnessAdapter = {
  name: "acme:my-coder",
  label: "Acme Coder",
  description: "Runs the Acme coding agent.",
  installPackage: "@acme/coder",
  capabilities: {
    sandbox: true,
    resumable: true,
    approvals: true,
    hostTools: true,
    fileEvents: true,
  },
  async createSession(opts) {
    // Build your native session and adapt it to AgentHarnessSession.
    return createAcmeSession(opts);
  },
};

registerAgentHarness({
  name: myHarness.name,
  label: myHarness.label,
  description: myHarness.description,
  installPackage: myHarness.installPackage,
  capabilities: myHarness.capabilities,
  create: () => myHarness,
});
```

通過 `createSession` 中的動態匯入和一個
`installPackage` 提示。對於橋支持的編碼線束，需要真正的
沙箱/工作區提供程序，而不是在中執行任意編碼代理
主機進程 - 請參閱 [Sandbox Adapters](/docs/sandbox-adapters)。 AI SDK適配器
（`createAiSdkHarnessAdapter`，由 `@ai-sdk/harness` 的 `HarnessAgent` 支持）是
此合約的一個實現，而不是公開抽象。

## 不要 {#donts}

- 請勿將 Claude 程式碼、Codex、光標、Mastra 或 Pi 新增為 `AgentEngine`。他們
  擁有自己的循環；在 `AgentEngine.stream()` 下執行一個雙執行循環
  並丟失工作階段生命週期語義。
- 不要每回合將完整的 Agent-Native 聊天歷史紀錄重播到安全帶中。簡歷
  使用 `resumeState` 的線束工作階段。
- 不要將`resumeState`存儲在`application_state`中。它屬於安全帶
  工作階段 SQL 表。
- 預設情況下，不要將每個應用操作公開給每個線束工作階段。遞給它
  小型、專用工具集。

## 相關檔案 {#related-docs}

- [Native 聊天介面](/docs/native-chat-ui) — 將您自己的代理置於 UI 與 `AgentChatRuntime` 的聊天後面。
- [Agent Surfaces](/docs/agent-surfaces) — 選取無頭、聊天、邊車或完整應用。
- [Agent-Native Code UI](/docs/code-agents-ui) — 可重用的編碼工作區表面。
- [Custom Agents & Teams](/docs/agent-teams) — 後台執行和子代理委派。
- [Sandbox Adapters](/docs/sandbox-adapters) — 用於編碼工具的可插入執行後端。
- [Human Approval](/docs/human-approval) — 批準表面線束執行使用。
