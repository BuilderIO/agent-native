---
title: "框架"
description: "本地开发框架、嵌入式代理面板和云框架 - AI 代理与您的应用程序一起运行的方式。"
---

# 框架

每个代理本机应用程序都与应用程序 UI 旁边的 AI 代理一起运行。 **框架**是
承载两者的包装器：它显示您的应用程序并为代理提供一个地方
聊天、运行和（在开发中）编辑代码。一共有三个框架，共享一个运行时：

- **嵌入式代理面板** - 内置于 `@agent-native/core` 的每个应用程序中。
  这是您的应用在开发和生产过程中自行呈现的侧边栏。
- **本地开发框架** - 在 iframe 中加载正在运行的应用程序的薄包装器
  并添加相同的代理面板以及旁边的集成 CLI 终端。使用过
  用于此存储库中模板的本地开发。
- **Builder.io 云框架** — 具有协作功能的托管托管框架，
  可视化编辑，并行代理运行。

无论托管哪个框架，您的应用代码都是相同的。代理说话
在每种情况下都通过相同的 actions 和应用程序状态连接到您的应用程序。

```an-diagram title="三帧，一个运行时间" summary="您的应用程序和代理面板在每一帧中都是相同的；只有它们周围的包装发生变化。"
{
  "html": "<div class=\"diagram-frames\"><div class=\"diagram-card\" data-rough><span class=\"diagram-pill accent\">嵌入面板</span><small class=\"diagram-muted\">随每个应用提供 · 开发 + 生产</small></div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill\">本地开发框架</span><small class=\"diagram-muted\">iframe 中的应用 + 面板 + CLI 终端</small></div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill\">Builder.io 云框架</span><small class=\"diagram-muted\">托管：协作 · 可视编辑 · 并行运行</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>同一 runtime<br><small class=\"diagram-muted\">你的应用 · 操作 · 应用状态</small></div></div>",
  "css": ".diagram-frames{display:flex;flex-direction:column;gap:10px;align-items:stretch}.diagram-frames .diagram-card{display:flex;flex-direction:column;gap:4px;padding:12px 16px}.diagram-frames .diagram-arrow{font-size:22px;line-height:1;align-self:center}"
}
```

## 嵌入式代理面板 {#embedded-agent}

嵌入式面板是您的应用程序呈现的代理侧边栏。它附带
`@agent-native/core` - 没有单独的软件包需要安装 - 并且是相同的
开发和生产中的组件。

- 从 `@agent-native/core/client` 导出为 `AgentPanel`，带有
  仅限生产的变体 `ProductionAgentPanel`。
- 提供完整的聊天/CLI/工作空间界面，因此座席输入保持开启
  框架中其他地方使用的共享 撰写r 堆栈。
- 每回合都会读取 `application_state.navigation`，因此它已经知道是哪个
  查看您所在的位置以及选择的内容 - 您无需重新解释“此”。

### 应用程序与代码工具模式 {#tool-modes}

面板以两种工具模式之一运行：

- **应用程序模式** - 代理只有您的应用程序自己的工具：您的 actions
  使用 `defineAction` 定义，加上导航和上下文。没有文件系统或
  外壳访问。这就是最终用户得到的。
- **代码模式** — 添加共享编码工具（`bash`、`read`、`edit`、`write`）
  以及应用程序工具之上的数据库访问，因此代理可以更改应用程序的
  自己的来源。代码请求被门控：当消息需要代码时
  (`type: "code"`)并且没有连接支持代码的框架，面板显示
  解释代码更改需要 Agent Native Desktop 或 Builder 的对话框；
  当连接框架时，请求将路由到它和代码代理
  工作时指示灯显示 (`useSendToAgentChat`)。对于规范
  编码工具列表和共享UI合约，参见
  [Agent-Native Code UI](/docs/code-agents-ui).

```an-diagram title="代码请求门控" summary="代码类型消息需要支持代码的帧。一旦连接，请求就会路由到那里；如果没有，面板会解释代码更改需要 Desktop 或 Builder。"
{
  "html": "<div class=\"diagram-gate\"><div class=\"diagram-node\" data-rough>message<br><small class=\"diagram-muted\">type: \\\"code\\\"</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough>code-capable frame connected?</div><div class=\"diagram-col\"><div class=\"diagram-pill ok\">yes &rarr; route to frame, show code-agent indicator</div><div class=\"diagram-pill warn\">no &rarr; dialog: needs Desktop or Builder</div></div></div>",
  "css": ".diagram-gate{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-gate .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-gate .diagram-arrow{font-size:22px;line-height:1}.diagram-gate .center{text-align:center}"
}
```

“代码模式”是代理功能切换 - 与环境开发模式不同
（`NODE_ENV` / Vite）。客户端钩子是`useCodeMode()`。 （参见
[Compatibility notes](#compatibility) 用于向后兼容别名。）

在本地开发框架中，设置齿轮在这些模式之间切换。切换
关闭代码模式隐藏框架自己的侧边栏并显示应用程序的应用内代理
侧边栏位于 iframe 内，因此您可以准确预览最终用户所看到的内容。

## 集成终端和CLI切换 {#cli-terminal}

正在开发中，面板包括一个嵌入式终端（`AgentTerminal`，也
来自 `@agent-native/core/client`），由 PTY 服务器支持。你可以运行一个真正的
在应用程序旁边编码 CLI 并在它们之间切换；终端重新启动
与选定的 CLI。

支持的 CLI 来自核心 CLI 注册表
(`packages/core/src/terminal/cli-registry.ts`)。仅允许这些命令
生成 - PTY 服务器根据注册表验证请求的命令
允许列表以防止注入：

| CLI        | 命令       | 安装包                      |
| ---------- | ---------- | --------------------------- |
| Claude代码 | `claude`   | `@anthropic-ai/claude-code` |
| Builder.io | `builder`  | （内置）                    |
| Codex      | `codex`    | `@openai/codex`             |
| 双子座CLI  | `gemini`   | `@google/gemini-cli`        |
| 开放代码   | `opencode` | `opencode-ai`               |

如果在 `PATH` 上找不到所选的 CLI，终端将回退到运行它
通过 `npx --yes <install-package>@latest`（存在安装包的地方）。
默认命令是`claude`。随时从代理面板设置切换 CLI
时间。

## Builder.io云框 {#cloud-frame}

[Builder.io](https://www.builder.io) 提供托管框架
相同的应用程序和相同的代理面板，在云端：

- 实时协作 - 多个用户可以同时观看和互动。
- 可视化编辑、角色和权限。
- 并行代理执行以加快迭代速度。
- 适合团队使用，每个人共享一个托管环境。

来自嵌入式面板的代码请求以相同的方式路由到 Builder 框架
它们路由到本地开发框架，因此上面的 dev-vs-prod 行为是
两者一致。

## 运行时 APIs {#runtime-apis}

这些随 `@agent-native/core` 一起提供，是您的应用用来与
代理，无论哪个框架托管它：

1. **发送消息** — `sendToAgentChat()` 向代理发送消息。
   `useSendToAgentChat()` 钩子用描述的代码请求门控包装它
   并返回一个 `codeRequiredDialog` 元素进行渲染。参见
   [Drop-in Agent](/docs/drop-in-agent) 的完整用法和选项。
2. **生成状态** - `useAgentChatGenerating()` 跟踪代理何时
   正在运行，因此 UI 可以显示进度，而无需直接轮询代理。
3. **轮询同步** - 数据库支持的同步在代理时保持 UI 缓存最新
   更改数据或应用程序状态。
4. **操作系统** - `pnpm action <name>` 分派到相同的可调用
   actions 代理作为工具调用，因此代理能做的任何事情，您都可以
   脚本。

## 运行它 {#running}

嵌入式代理面板是每个应用程序的一部分 - 搭建一个模板，它是
已经在那里：

```bash
npx @agent-native/core@latest create my-app --template mail --standalone
cd my-app
pnpm dev
```

本地开发框架（框架存储库中的私有 `@agent-native/frame` 包）是未发布到 npm 的内部工具包。它将活动应用程序的开发服务器加载到 iframe 中，并在其旁边安装嵌入式面板，通过 `app` 查询参数选择应用程序。集成CLI终端需要Agent Native Desktop，提供终端所需的本地代码和PTY访问；如果没有它，面板将显示聊天界面并提示您打开桌面以使用 CLI。

## 兼容性说明 {#compatibility}

“代码模式”概念以前被称为“开发模式”，因此有一些向后兼容
名称仍然存在。您可以忽略这些，除非您正在维护旧的集成
代码：

- 底层 `AGENT_MODE` 环境变量，`/_agent-native/agent-chat/mode`
  端点（其负载密钥仍然是`devMode`），以及`agent-chat.mode`
  设置键未更改。
- `useDevMode()` 仍然是 `useCodeMode()` 的已弃用别名。
