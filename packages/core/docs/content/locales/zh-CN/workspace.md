---
title: "工作区"
description: "Claude - 每个用户的代码级自定义 - skills、内存、指令、自定义代理、计划作业、MCP 服务器 - 由 SQL 支持，而不是文件系统。"
---

# 工作区

> **哪个工作区文档？** 此页面涵盖 **自定义层** — 工作区*是什么*。对于部署形状（一个单一存储库，许多应用程序），请参阅 [Multi-App Workspaces](/docs/multi-app-workspace)；有关治理（谁审查、批准和拥有什么），请参阅 [Workspace Governance](/docs/workspace-management)。

每个代理本机应用程序都附带一个**工作区**：使代理成为您的自定义层。它包含团队指令 (`AGENTS.md`)、共享学习内容 (`LEARNINGS.md`)、个人结构化内存 (`memory/MEMORY.md`)、代理按需拉入的 skills、自定义子代理、计划作业和连接的 MCP 服务器 — 您期望从 Claude 代码 / Codex 设置获得的一切。

变化：**它是 SQL 行，而不是文件系统文件。**每个用户都将自己的工作区存储在数据库中。没有要启动的开发盒，没有每个用户的容器，没有要安装的文件。多租户 SaaS 可以为每个用户提供基本上免费的完全可定制的代理，因为所有这些都是行——个人内存、个人 MCP 服务器、个人 skills、个人子代理——并且共享代码库同时托管所有这些。

```an-diagram title="Claude-Code 工作区，但存储在 SQL 中" summary="相同的定制层——指令、技能、内存、代理、作业、MCP——除了每个文件都是共享多租户数据库中的一行。"
{
  "html": "<div class=\"ws-map\"><div class=\"diagram-card cc\"><span class=\"diagram-pill warn\">Claude Code / Codex</span><small class=\"diagram-muted\">~/.claude/ on a local disk</small><div class=\"ws-files\"><span class=\"diagram-box\">CLAUDE.md</span><span class=\"diagram-box\">skills/</span><span class=\"diagram-box\">memory</span><span class=\"diagram-box\">mcp.json</span></div><small class=\"diagram-muted\">one codebase per developer</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card an\"><span class=\"diagram-pill accent\">Agent-native 工作区</span><small class=\"diagram-muted\">rows in one SQL 数据库</small><div class=\"ws-rows\"><span class=\"diagram-pill\">AGENTS.md</span><span class=\"diagram-pill\">skills/&hellip;</span><span class=\"diagram-pill\">memory/&hellip;</span><span class=\"diagram-pill\">mcp-servers/&hellip;</span></div><small class=\"diagram-muted\">一个代码库，多用户，有作用域 <code>u:&lt;email&gt;:&hellip;</code></small></div></div>",
  "css": ".ws-map{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.ws-map .diagram-card{display:flex;flex-direction:column;gap:8px;padding:16px 18px;flex:1;min-width:220px}.ws-map .ws-files,.ws-map .ws-rows{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0}.ws-map .diagram-arrow{font-size:24px}"
}
```

| Claude代码/Codex              | 代理本机工作区                          |
| ----------------------------- | --------------------------------------- |
| 本地磁盘上的文件              | 共享 SQL 数据库中的行                   |
| 每个开发人员一个代码库        | 一个代码库，多个用户                    |
| 需要开发盒或容器              | 在任何无服务器/边缘主机上运行           |
| `~/.claude/` 定制             | 按用户自定义，范围为 `u:<email>:…`      |
| 每个项目 `CLAUDE.md` / skills | 每个应用 `AGENTS.md` + 工作区内存资源   |
| JSON 文件中的 MCP 配置        | JSON 中的 MCP 配置*或*设置 UI，每个范围 |

相同的功能。不同的经济。请参阅 [Templates](/docs/cloneable-saas) 了解为什么这对 SaaS 很重要。

## 概述 {#overview}

资源具有三个运行时范围：

- **个人** — 范围仅限于单个用户（他们的电子邮件）。适合偏好设置、注释和每个用户的上下文。
- **共享/组织** — 对应用程序或组织中的所有用户可见。适合应用/团队说明、skills 和共享配置。
- **工作空间** — 继承了从调度资源管理的全局默认值。适合公司事实、定位、品牌指南、全球护栏、工作区范围的 skills 和共享 MCP 服务器。应用程序在运行时读取这些；它们不会复制到每个应用程序中。

应用内工作区面板显示所有三个范围。个人和共享/组织资源可以在那里编辑。工作区范围的资源在应用面板中是只读的，并通过 Dispatch 进行集中编辑，因此每个应用都可以看到相同的规范文件，而无需同步步骤。

控制代理如何使用每个资源的规范路径：

| 运行时资源           | 路径                                  | 代理如何使用它                       |
| -------------------- | ------------------------------------- | ------------------------------------ |
| 护栏说明             | `AGENTS.md`或`instructions/<slug>.md` | 在每个收到它的应用程序中加载每个回合 |
| 全局skills           | `skills/<slug>/SKILL.md`              | 列为工作区 skills 并按需阅读         |
| 品牌/公司资源        | `context/<slug>.md`                   | 每回合都编入索引，相关时阅读         |
| 自定义代理配置文件   | `agents/<slug>.md`                    | 可作为可重复使用的本地代理配置文件   |
| 共享 HTTP MCP 服务器 | `mcp-servers/<slug>.json`             | 加载到授权应用的MCP工具注册表        |

这些路径适用于所有三个范围 - 工作空间、组织/应用程序和个人。当同一路径存在于多个级别时，后面的范围获胜。

```an-diagram title="三个范围，一个有效文件" summary="运行时在读取时解析跨工作区、应用程序和个人范围的相同路径 - 最具体的范围获胜。"
{
  "html": "<div class=\"ws-stack\"><div class=\"diagram-card\"><span class=\"diagram-pill\">Workspace</span><small class=\"diagram-muted\">来自 Dispatch 的公司级默认值</small><code>context/brand.md</code></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">组织 / 应用</span><small class=\"diagram-muted\">team override for one app</small><code>context/brand.md</code></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Personal</span><small class=\"diagram-muted\">per-user override &mdash; wins</small><code>context/brand.md</code></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box ok\">Effective <code>context/brand.md</code></div></div>",
  "css": ".ws-stack{display:flex;flex-direction:column;align-items:flex-start;gap:8px}.ws-stack .diagram-card{display:flex;flex-direction:column;gap:4px;padding:12px 16px;min-width:280px}.ws-stack .diagram-arrow{font-size:20px;align-self:center}.ws-stack code{font-size:.85em}.ws-stack .diagram-box{align-self:center;margin-top:4px}"
}
```

## 入门：1 分钟演练 {#getting-started}

在 60 秒内更改代理的行为方式。

1. 打开 **工作空间** 选项卡 → **共享** → `AGENTS.md`（使用 `+` 创建它 → **文件** 如果缺少）。
2. 添加一条规则，例如：

   ```降价
   ## 语气

   要简洁。以答案开头。
   ```

3. 保存，切换到**聊天**，询问任何问题 - 客服人员立即遵循新规则。

```an-callout
{ "tone": "info", "body": "无需重新启动，无需重新部署。 `AGENTS.md` 在每个回合开始时都会被读取，因此您现在保存的编辑会更改代理在下一条消息中的行为。" }
```

**后续步骤（当您需要时）：**

- **Skills** (`+` → **技能**) — 在与 `/skill-name` 聊天时调用的重点操作方法文件。
- **代理** (`+` → **代理**) — 使用 `@agent-name` 调用的可重用子代理角色。
- **计划任务** (`+` → **计划任务**) — 在 cron 上运行的提示。有关计划和触发器，请参阅 [Recurring Jobs](/docs/recurring-jobs)。
- **内存** - 共享 `LEARNINGS.md` 和个人 `memory/MEMORY.md` 在对话中保持持久上下文可用。

## 全局资源和规范路径 {#global-resources}

工作区范围的资源通过 Dispatch 的 **资源** 页面进行管理，并在运行时由应用程序继承 - 无需复制或同步步骤。 Dispatch 支持两种授予范围：

- **所有应用程序** — 工作区中的每个应用程序继承的全局资源。大多数公司、品牌、角色、定位、消息传递和护栏上下文应该是**所有应用**。
- **选定的应用程序** — 授予特定应用程序用于特定于应用程序的上下文或工具的资源。谨慎使用这些。

路径决定代理如何使用资源（请参阅上面 [Overview](#overview) 中的表）。这是核心角色、定位、消息传递、公司事实、品牌指南、支持政策、共享 skills 或共享 HTTP MCP 工具的正确之家，许多应用都应该从中受益。

适用于新工作区的有用入门包：

```text
context/company.md              # 公司的业务、ICP、产品、链接
context/brand.md                # 声音、视觉识别、拼写、禁止使用
context/messaging.md            # 定位、价值支柱、证据点、反对意见
instructions/guardrails.md      # 合规、升级和批准规则
skills/company-voice/SKILL.md   # on-demand guidance for customer-facing writing
agents/<slug>.md                # reusable custom agent profiles
```

保持 `context/` 文件真实且易于浏览。将每回合都必须适用的规则放入 `instructions/guardrails.md` 中。当代理需要故意转换或审查公司声音的副本时，请使用`skills/company-voice/SKILL.md`。

要覆盖一个应用或团队的全局默认值，请在该应用中使用相同的路径创建共享/组织资源。要为一个人覆盖它，请创建具有相同路径的个人资源。不要将工作区文件复制到每个应用程序中；运行时解析读取时的堆栈：

```text
workspace context/brand.md
-> shared/app context/brand.md
-> personal context/brand.md
```

保持 `context/` 文件简短且真实——代理可以浏览的一些要点：

```text
<!-- context/brand.md -->

# 品牌

- Voice: direct, warm, concrete
- Use: "workspace", "agent", "team"
- Avoid: unsupported superlatives and vague AI claims
```

## 工作区面板 {#workspace-panel}

代理面板包括一个 **工作区** 选项卡以及聊天和 CLI。它显示了所有资源的文件夹组织树、任何文本文件的内联编辑器（Markdown、JSON、YAML、纯文本）以及 `+` 菜单的类型化创建流程（文件、Skills、代理、计划任务）。用户可以浏览继承的工作区默认设置并创建/编辑/删除个人或组织资源。

当您打开资源时，编辑器会显示带有 `workspace default -> organization/app override -> personal override` 堆栈的 **有效上下文** 条带，以便您可以查看继承的内容以及覆盖为何处于活动状态。 Dispatch 从控制平面端显示相同的模型：在 **Resources** 页面上使用 **Effective in app**，或在应用程序卡的 **Context** 对话框中的资源行上展开 **Stack**。

启用 Dispatch 审批策略后，创建、更新或删除 **所有应用** 资源会将审批请求排队，而不是立即应用。创建/编辑/删除对话框在保存之前显示影响预览。

单击工作区工具栏中的 `?` 图标可随时跳回这些文档。

## 代理如何使用资源 {#how-the-agent-uses-resources}

内置应用程序代理使用统一的 `resources` 工具管理资源：使用 `action: "list"`、`"read"`、`"effective"`、`"write"`、`"promote"` 或 `"delete"`。外部CLI/代码代理可以使用等效的`pnpm action resource-*`命令。

在每次对话开始时，代理会自动读取：

### AGENTS.md 及说明 {#agents-md}

`AGENTS.md` 是默认播种的指令资源，并按顺序从工作区、共享/组织和个人范围每次加载 - 工作区用于公司范围的默认设置，共享/应用程序用于团队规则，个人用于每个用户的首选项。 `instructions/` 下的文件是单独的护栏文件，也适用于每个回合（合规规则、升级政策、品牌声音）并遵循相同的优先级。正常的聊天和集成触发的运行都会在响应之前加载它们。

```text
AGENTS.md
instructions/customer-support-guardrails.md
instructions/legal-review-policy.md
```

### 参考资源 {#reference-resources}

可重复使用的公司背景位于 `context/` 下（角色、定位、产品事实、品牌指南、竞争说明）。当任务可能依赖于它时，代理会看到这些索引并使用 `resources` 工具 (`action: "read"`) 读取相关文件；使用 `action: "effective"` 查看工作区默认值是否被应用或用户覆盖。

### 内存 {#memory}

工作区有两个当前内存表面：

- `LEARNINGS.md` 在**共享**范围内，用于项目范围的约定、更正和持久的团队知识。
- `memory/MEMORY.md` 位于有关当前用户的结构化内存的**个人**范围内。

资源系统还播种个人 `LEARNINGS.md` 以与旧工作区兼容，但聊天预加载路径是共享的 `LEARNINGS.md` 加上个人 `memory/MEMORY.md`。

**保存什么。**当您纠正代理（“始终使用 X 而不是 Y”）、共享偏好（“我更喜欢简洁的答案”）或揭示上下文（“我的团队将此称为“调度层””）时，代理会捕获该学习内容，因此不会重复错误或重新询问。项目范围内的学习内容在共享的 `LEARNINGS.md` 中；用户特定内存位于 `memory/` 下。 `capture-learnings` 技能说明了何时以及如何进行。

**适合的地方。**

| 表面               | 范围        | 作者                               | 阅读时间                     |
| ------------------ | ----------- | ---------------------------------- | ---------------------------- |
| `AGENTS.md`        | 共享        | 根据要求提供人类/代理              | 每个回合                     |
| `LEARNINGS.md`     | 共享        | 根据要求提供人类/代理              | 每回合（仅限共享副本）       |
| `memory/MEMORY.md` | 个人        | 特工/人类                          | 每个回合                     |
| `instructions/…`   | 共享        | 根据要求提供人类/代理              | 每个回合                     |
| `skills/…`         | 共享        | 根据要求提供人类/代理              | 按需（`/slash` 命令）        |
| `context/…`        | 共享        | 根据要求提供人类/代理              | 每回合都编入索引，相关时阅读 |
| `mcp-servers/…`    | 工作区/共享 | 人类通过 Dispatch 或应用程序工作区 | MCP配置刷新                  |

用户可以直接在“工作空间”选项卡中编辑这些内存文件 - 它们是常规资源。删除代理出错的行，将个人偏好保留在 `memory/MEMORY.md` 中，或将团队范围的规则推广到 `AGENTS.md` 中。

这些表面中的每一个 - `AGENTS.md`、skills、内存、自定义代理、MCP 服务器 - 都是相同的底层资源形状：`path` + `scope` + `content`，以相同的方式寻址和解析。

```an-schema title="工作区资源模型" summary="一种资源形状支持每个工作区文件。运行时按路径和范围对其进行键控，并解析读取时的有效值。"
{
  "entities": [
    {
      "id": "resource",
      "name": "workspace resource",
      "note": "用户工作区中的单个文件 - 说明、技能、内存、代理、MCP 配置或作业。",
      "fields": [
        { "name": "path", "type": "string", "note": "Canonical path, e.g. AGENTS.md, skills/<slug>/SKILL.md" },
        { "name": "scope", "type": "workspace | shared | personal", "note": "该行位于哪一层" },
        { "name": "owner", "type": "string", "nullable": true, "note": "u:<email> for personal scope" },
        { "name": "content", "type": "text", "note": "Markdown / JSON / YAML 正文" }
      ]
    }
  ]
}
```

## Skills {#skills}

Skills 是 `skills/` 路径（最好是 `skills/<name>/SKILL.md`）下的 Markdown 资源文件，为代理提供按需领域知识，在与 `/skill-name` 聊天时调用。从“工作空间”选项卡添加它们，或者在“代码”模式下从 `.agents/skills/` 添加它们。

请参阅 [Skills Guide](/docs/skills-guide) — 技能格式、范围、发现和创作的单一来源。

## 自定义代理 {#custom-agents}

自定义代理是可重用的本地子代理配置文件，存储为 `agents/*.md` 下的 Markdown 资源。这是自定义代理格式的规范主页。

当您想要一个具有自己的名称、描述、模型首选项和指令集的集中委托时，请使用它们。与 skills 不同，自定义代理不是被动指导 - 它们是主代理可以通过 `@` 提及或在子代理生成期间选择它们来调用的操作角色。

### 代理格式 {#agent-format}

自定义代理使用 YAML frontmatter 加上 Markdown 指令：

```an-annotated-code title="自定义代理配置文件"
{
  "filename": "agents/design.md",
  "language": "markdown",
  "code": "---\nname: Design\ndescription: >-\n  Reviews layouts, interaction patterns, and product UX decisions.\nmodel: inherit\ntools: inherit\ndelegate-default: false\n---\n\n# 角色\n\n您是一名专注的设计代理。\n\n##职责\n\n-审查布局和交互流程\n-提出更强的视觉方向\n-简洁且有主见",
  "annotations": [
    { "lines": "2", "label": "@mention handle", "note": "`name` 是 `@` 下拉列表中显示的内容，也是主代理委托的内容。" },
    { "lines": "3-4", "label": "何时委托", "note": "`description` 是协调器读取的内容，以确定此配置文件适合任务。" },
    { "lines": "5", "label": "型号", "note": "`inherit` 重用主代理的模型。仅当配置文件明确需要不同的配置文件时才覆盖。" },
    { "lines": "6", "note": "`tools: inherit` 目前 - 该字段是为未来的每代理工具策略保留的。" }
  ]
}
```

推荐约定：

- 将定制代理存储在`agents/<slug>.md`
- 使用 `model: inherit` 除非配置文件明确需要不同的模型
- 暂时保留`tools: inherit`；该字段是为未来的工具策略保留的

### 远程代理与自定义代理 {#remote-vs-custom-agents}

工作区中有两种代理类型：

- **自定义代理** — `agents/*.md` 中的本地配置文件，在当前应用/运行时内执行
- **连接的代理** — 由 `remote-agents/*.json` 中的清单描述的远程 A2A 对等点（仍可识别旧版 `agents/*.json` 清单）

在一个应用程序内使用自定义代理进行委派。当您需要通过 A2A 调用另一个应用程序时，请使用连接的代理。

## @标记 {#at-tagging}

在聊天输入中键入 `@` 以引用工作区项目。光标处会出现一个下拉列表，显示匹配的代理和文件。使用箭头键进行导航并使用 Enter 进行选择。所选项目在输入中显示为内联芯片。

当您发送消息时，**文件/资源**作为代理可以读取的引用进行传递，**自定义代理**使用其配置文件指令在本地运行，并且**连接的代理**通过 A2A 进行调用。

## / 斜线命令 {#slash-commands}

在行首键入 `/` 以调用技能。下拉列表显示可用的 skills 及其名称和描述；选择一个会添加一个内联芯片，并在发送消息时将其内容作为上下文包含在内。如果未配置 skills，则下拉列表链接到这些文档。

## 代码与应用程序模式 {#dev-vs-prod}

资源系统在两种模式下的工作方式相同。不同之处在于可用于 `@` 标记和 `/` 命令的其他源：

| 功能           | 代码模式                                        | 应用模式                           |
| -------------- | ----------------------------------------------- | ---------------------------------- |
| @标记          | 代码库文件 + 工作区资源 + 自定义代理 + 连接代理 | 工作区资源 + 自定义代理 + 连接代理 |
| /斜线命令      | .agents/skills/ + 资源 skills                   | 仅资源skills                       |
| 代理文件访问   | 文件系统+资源                                   | 仅限资源                           |
| 工作区面板     | 完全访问权限                                    | 完全访问权限                       |
| AGENTS.md/内存 | 可用                                            | 可用                               |

## 工作区连接 {#workspace-connections}

工作区连接允许应用程序共享相同的提供商帐户（Slack、GitHub、HubSpot 等），而无需重复凭据。连接在 SQL 中记录提供者身份、帐户标签、状态、范围、应用程序授权和凭据引用。秘密保留在凭证存储中；连接仅指向凭证密钥名称，例如 `SLACK_BOT_TOKEN`。

请参阅 [Workspace Connections](/docs/workspace-connections) 了解快速入门、connection/grant/credentialRef API 以及具体的 Slack、HubSpot 和 GitHub 示例。

---

# 参考

## 资源API {#resource-api}

可以通过服务器代码、actions 或 REST API 管理资源。

### 服务器API {#server-api}

自动安装REST端点：

| 方法     | 端点                                          | 描述                 |
| -------- | --------------------------------------------- | -------------------- |
| `GET`    | `/_agent-native/resources?scope=all`          | 列出资源             |
| `GET`    | `/_agent-native/resources?scope=workspace`    | 列出继承的工作区资源 |
| `GET`    | `/_agent-native/resources/tree?scope=all`     | 获取文件夹树         |
| `GET`    | `/_agent-native/resources/effective?path=...` | 显示有效继承堆栈     |
| `POST`   | `/_agent-native/resources`                    | 创建资源             |
| `GET`    | `/_agent-native/resources/:id`                | 获取包含内容的资源   |
| `PUT`    | `/_agent-native/resources/:id`                | 更新资源             |
| `DELETE` | `/_agent-native/resources/:id`                | 删除资源             |
| `POST`   | `/_agent-native/resources/upload`             | 上传文件作为资源     |

### 动作API {#script-api}

代理使用这些内置的 actions。您也可以从您自己的 actions 中调用它们：

```bash
# 列出所有资源
pnpm action resource-list --scope all

# 阅读资源
pnpm action resource-read --path "skills/my-skill/SKILL.md"

# 读取由 Dispatch 管理的继承工作区上下文
pnpm action resource-read --scope workspace --path "context/brand.md"

# Show workspace -> organization/app -> personal precedence for a path
pnpm action resource-effective --path "context/brand.md"

# 写一个资源
pnpm action resource-write --path "notes/meeting.md" --content "# 会议记录...”

# 删除资源
pnpm action resource-delete --path "notes/old.md"
```
