---
title: "公关视觉回顾"
description: "GitHub 操作，在每个 PR 上运行存储库的视觉回顾技能。 LLM 编码代理读取差异，发布交互式回顾计划，显示信息检查，并发布带有内联屏幕截图的粘性 PR 评论。信息性和非阻塞。"
---

# 公关视觉回顾

PR Visual Recap 是一个 GitHub 操作，它将每个拉取请求转变为**可视化代码审查**。每次推送时，LLM 编码代理都会根据 PR 差异运行最新的捆绑 [`visual-recap`](/docs/template-plan) 技能（或者 `VISUAL_RECAP_SKILL_SOURCE=repo` 时您的存储库的提交副本），向托管计划应用程序发布结构化回顾计划，在运行时显示信息性 `Visual Recap` 检查，并更新插入**一条粘性 PR 评论**，该评论链接到交互式计划，并在评论中嵌入**内联屏幕截图**。

这不是确定性差异渲染器。该操作调用真正的编码代理（默认情况下为 Claude 代码 CLI，或 OpenAI Codex CLI），该代理读取更改，决定重要内容，并通过调用计划 MCP 工具 `create-visual-recap`（与 `/visual-recap` 斜线命令使用的工具相同）来编写概要。您将获得变化的高空模式/API/前后视图，而不是原始差异墙。

回顾是**信息性且非阻塞**。它创建一个检查行，以便审阅者可以看到生成正在进行中，但这不是必需的检查，它永远不会阻止 PR，也永远不会取代读取实际的差异。粘性评论是一种审阅辅助工具，而不是签字。

## 它的作用

每次 PR 推送时，工作流程：

1. 收集 PR 基础和头部之间的有界差异。
2. 使用 `Visual recap in progress` 创建信息性 `Visual Recap` GitHub 检查。
3. 针对该差异运行配置的编码代理。代理会读取捆绑的 `visual-recap` 技能指南（或您的存储库固定副本）并撰写回顾，并通过 `create-visual-recap` 发布。
4. 读取代理写给 `recap-url.txt` 的已发布计划 URL。
5. 在无头 Chrome 中打开 URL 并截取明暗模式下渲染的平面图。
6. 将 PNG 上传到“计划”应用上已签名的公共图像路线。
7. 在交互式回顾的链接旁边插入一条粘性公关评论，将屏幕截图**内联**嵌入到 `<picture>` 元素（通过 GitHub 的迷彩图像代理提供）。
8. 以成功、跳过或中立的方式完成 `Visual Recap` 检查。

```an-diagram title="每次 PR 推送都会发生什么" summary="有界差异为真正的编码代理提供信息，该代理编写了回顾；工作流程会对其进行屏幕截图并插入一条粘性评论。"
{
  "html": "<div class=\"diagram-recap\"><div class=\"diagram-node\">PR 推送<br><small class=\"diagram-muted\">bounded base&hellip;head diff</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">编码 Agent<br><small class=\"diagram-muted\">Claude Code / Codex 读取 diff</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">create-visual-recap</span><small class=\"diagram-muted\">publishes recap plan</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">无头 Chrome<br><small class=\"diagram-muted\">light + dark screenshots</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">一条置顶 PR 评论<br><small class=\"diagram-muted\">inline screenshot + plan link</small></div></div><div class=\"diagram-foot diagram-muted\">Plus an informational <span class=\"diagram-pill\">Visual Recap</span> check &mdash; non-blocking, never required.</div>",
  "css": ".diagram-recap{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.diagram-recap .diagram-arrow{font-size:20px;line-height:1}.diagram-recap .center{display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}.diagram-recap .diagram-foot{flex-basis:100%;margin-top:10px;font-size:13px}"
}
```

重新推送会更新相同的计划和相同的粘性评论 - 没有孤立的计划，没有垃圾评论。

## 安装

交互安装套餐时，Agent-Native CLI 询问是否添加
自动公关视觉回顾。同意写入 GitHub 操作，或添加它
随时明确：

```bash
npx @agent-native/core@latest skills add visual-plan --with-github-action
```

这将安装 `visual-plan` 技能（其中包括操作运行的 `visual-recap` 技能）并将 `.github/workflows/pr-visual-recap.yml` 写入您的存储库。工作流程通过 `npx @agent-native/core@latest recap <subcommand>` 调用**发布的 CLI 子命令** — 包括 `gate`、`collect-diff`、`block-reference`、`scan`、`build-prompt`、`publish`、`shot`、`comment`、`check` 和`usage` - 因此没有任何内容作为帮助程序脚本复制到您的存储库中。 `setup`和`doctor`是您本地运行的交互式助手； `gate` 是工作流程在每次回顾之前运行的安全门步骤。

然后运行引导设置帮助程序：

```bash
npx @agent-native/core@latest recap setup
npx @agent-native/core@latest recap doctor
```

`recap setup`刷新工作流程，使用`gh`设置GitHub Actions
当值可从 env 或本地计划获得时的秘密/变量
发布令牌存储，并打印任何它无法打印的确切缺失命令
设置。秘密值通过标准输入发送到 `gh`，而不是命令参数。提交
生成的工作流程文件并打开 PR 以查看其运行。

默认情况下，工作流程根据最新捆绑的内容构建其代理提示
`@agent-native/core@latest` 中的 `visual-recap` 指导，包括任何同级
技能附带的参考文件。如果您的存储库有意定制并且
固定其提交的`visual-recap`文件夹，设置存储库变量
`VISUAL_RECAP_SKILL_SOURCE=repo`.

## 后端选择

选择哪个编码代理使用 `VISUAL_RECAP_AGENT` 存储库变量运行技能：

| `VISUAL_RECAP_AGENT` | 编码剂           | 所需的 API 密钥     |
| -------------------- | ---------------- | ------------------- |
| `claude`_（默认）_   | Claude 代码 CLI  | `ANTHROPIC_API_KEY` |
| `codex`              | OpenAI Codex CLI | `OPENAI_API_KEY`    |

如果变量未设置，则操作使用 `claude`。

## 模型和推理

除了后端之外，两个存储库变量还可以调整代理的运行方式：

- **`VISUAL_RECAP_MODEL`** 固定传递给 CLI (`--model`) 的模型 — 例如 `gpt-5.5` 用于 Codex，或 Claude 模型 ID。保留其未设置以使用 CLI 自己的默认模型。
- **`VISUAL_RECAP_REASONING`** 设置推理深度：`none`、`minimal`、`low`、`medium`、`high` 或 `xhigh`。适用于Codex后端； Claude 的推理是模型驱动的，因此该变量被忽略。
- **`VISUAL_RECAP_SKILL_SOURCE`** 控制提示新鲜度：`auto`/unset 使用最新的捆绑技能指南，而 `repo` 固定到已提交的存储库本地 `visual-recap` 技能文件夹。

例如，要在 Codex 和 GPT-5.5 上以高推理运行回顾，请设置存储库变量 `VISUAL_RECAP_AGENT=codex`、`VISUAL_RECAP_MODEL=gpt-5.5` 和 `VISUAL_RECAP_REASONING=high`。

## 秘密和变量

在存储库的 **设置 → 秘密和变量 → Actions** 中设置这些内容。

### 秘密（只需两个）

| 秘密                | 目的                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `PLAN_RECAP_TOKEN`  | 由 `npx @agent-native/core@latest connect` 铸造的可撤销代币。授权发布回顾计划和截图上传。 |
| `ANTHROPIC_API_KEY` | 默认 Claude 代码后端的 LLM 密钥。                                                         |

**团队：使用组织服务令牌。**个人令牌与人员绑定
谁铸造了它 - 如果他们离开组织或撤销他们的代币，每个存储库都会使用
该秘密开始失败并出现 401，并且 CI 创建的计划归其所有
个人而不是团队。组织服务令牌归您所有
**组织**：它充当服务主体 (`svc-<name>@service.<orgId>`)，
在任何个人离开后仍然存在，其发布的摘要对组织可见，并且
任何组织所有者或管理员都可以列出或撤销它。创建一个（仅限组织所有者/管理员）：

```bash
npx @agent-native/core@latest connect https://plan.agent-native.com --service-token pr-recap
```

该命令在浏览器中对您进行身份验证，然后打印服务令牌
仅一次 - 将其存储为 `PLAN_RECAP_TOKEN` 秘密。稍后使用
`list-org-service-tokens` 和 `revoke-org-service-token` actions
计划应用程序。

**Solo：个人代币仍然有效。**用 `npx @agent-native/core@latest connect` 铸造它
针对您的计划应用程序。对于托管应用程序，这还会写入本地
`npx @agent-native/core@latest recap setup`可以读取的发布令牌文件：

```bash
npx @agent-native/core@latest connect https://plan.agent-native.com --client codex
npx @agent-native/core@latest recap setup
```

如果您更喜欢手动设置，请将令牌粘贴到 GitHub 密钥中。使用
像 `plan_recap_xxxxxxxxxxxxxxxx` 这样的占位符仅用于示例 - 切勿提交
真实代币。

### 可选（仅当您更改默认值时）

| 秘密/变量                | 默认                            | 当你需要的时候                                                                                                               |
| ------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`         | —                               | 秘密。与 `VISUAL_RECAP_AGENT=codex` 一起设置以使用 Codex 运行回顾。                                                          |
| `VISUAL_RECAP_AGENT`     | `claude`                        | 变量。选择编码代理后端（`claude` 或 `codex`）。                                                                              |
| `VISUAL_RECAP_MODEL`     | 每个CLI的默认值                 | 变量。固定模型 - 例如`gpt-5.5` 表示 Codex，或 Claude 型号 ID。取消设置使用 CLI 自己的默认值。                                |
| `VISUAL_RECAP_REASONING` | 每个模型的默认值                | 变量。推理深度：`none`、`minimal`、`low`、`medium`、`high` 或 `xhigh`。适用于Codex后端。                                     |
| `RECAP_CLI_VERSION`      | `latest`                        | 变量。固定工作流程安装的 `@agent-native/core` CLI 版本 - 例如`1.5.0`。参见[Version pinning](#version-pinning-copy-variant)。 |
| `PLAN_RECAP_APP_URL`     | `https://plan.agent-native.com` | 秘密。仅当在不同来源自行托管计划应用时。                                                                                     |

工作流自动检测如何调用其助手 CLI（此 monorepo 内的本地源，在其他地方发布的 `@agent-native/core`），因此无需设置 `RECAP_CLI` 变量。

## 评论内嵌截图

代理发布概要后，工作流程会在无头 Chrome 中以浅色和深色模式对渲染的计划进行屏幕截图，并将 PNG 上传到计划应用程序上已签名的公共图像路径。然后，粘性 PR 评论将这些屏幕截图**内嵌**与 `<picture>` 元素一起嵌入 - GitHub 通过其迷彩代理重新提供它们，因此审阅者可以直接在评论中看到与其 GitHub 主题匹配的预览，而无需打开任何内容。当他们想要探索、评论或注释时，完整互动计划的链接就位于其旁边。

## 分叉 PR

### 默认行为（无需执行任何操作）

主要的 `pr-visual-recap.yml` 工作流程在普通的 `pull_request` 触发器上触发，**不是** `pull_request_target`。因此，分叉 PR 运行时**无法访问存储库机密**，因此工作流程不会发现 `PLAN_RECAP_TOKEN` 并且完全无操作 - 不会发布失败，不会暴露凭据。对于来自同一存储库中的分支的 PR，自动运行 Recaps，其中机密可用。

这也意味着您可以在秘密存在之前\*\*合并工作流文件：在没有配置令牌的情况下，每次运行都是安静的无操作，直到您设置秘密为止。 `gate` 步骤还会自动跳过草稿 PR 和机器人编写的 PR，因此默认情况下不会运行触发器回顾。

### 选择加入标签门控分叉工作流程

如果您想生成分叉 PR 的摘要，可以使用第二个工作流程文件：`.github/workflows/pr-visual-recap-fork.yml`。它使用 `pull_request_target`（使用基本存储库机密运行），但从不签出或执行分叉代码。具有 GitHub 作者关联 `OWNER`、`MEMBER` 或 `COLLABORATOR` 的可信分叉作者会自动运行。外部分叉 PR 需要在 recap 代理运行之前通过新的 `recap` 标签事件明确的**每头维护者选择加入**。

要安装它，请将文件从 [BuilderIO/agent-native](https://github.com/BuilderIO/agent-native/blob/main/.github/workflows/pr-visual-recap-fork.yml) 与现有的 `pr-visual-recap.yml` 一起复制到存储库的 `.github/workflows/` 目录中。相同的秘密（`PLAN_RECAP_TOKEN`、`ANTHROPIC_API_KEY`）适用。

```an-diagram title="分叉 PR 同意门" summary="默认情况下，分叉 PR 没有任何秘密；受信任的作者自动运行，外部贡献者需要新的维护者回顾标签。"
{
  "html": "<div class=\"diagram-fork\"><div class=\"diagram-node\">Fork PR 已打开<br><small class=\"diagram-muted\">main workflow has no secrets</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill ok\">可信作者</span><small class=\"diagram-muted\">OWNER、MEMBER 或 COLLABORATOR 自动运行</small></div><div class=\"diagram-card\"><span class=\"diagram-pill warn\">外部贡献者</span><small class=\"diagram-muted\">维护者审核 diff 后再应用 <code>recap</code></small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\">门禁检查<br><small class=\"diagram-muted\">fork PR? &amp; trusted or fresh label?</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box ok\">回顾运行<br><small class=\"diagram-muted\">仅基础 repo 代码 · fork diff 作为文本输入</small></div></div>",
  "css": ".diagram-fork{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.diagram-fork .diagram-arrow{font-size:20px;line-height:1}.diagram-fork .center{display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}.diagram-fork .diagram-card{display:flex;flex-direction:column;gap:6px;padding:12px 14px}"
}
```

### 标签门如何工作

1. 分叉贡献者创建了一个 PR。由于 GitHub 保留了分叉运行的秘密，因此会跳过正常的 `pull_request` 工作流程。
2. fork 工作流程检查 PR 作者关联。受信任的作者（`OWNER`、`MEMBER` 或 `COLLABORATOR`）会在打开、同步、重新打开和准备审阅事件时自动运行。
3. 外部贡献者要求维护人员检查当前的差异（特别是对于提示注入型内容 - 见下文），然后将 `recap` 标签应用于 PR。
4. 外部贡献者标签门是每个头 SHA：如果贡献者推送更多提交，则下一个同步事件将跳过，直到维护者在检查新差异后删除并重新应用 `recap`。

### fork 工作流程做什么以及 NOT 做什么

| 工作流程DOES                                                                                    | 工作流程执行 NOT                                           |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 在**基本分支引用**处签出**基本存储库** - 仅受信任的代码                                         | 从 fork 中签出或执行任何代码                               |
| 获取叉头作为远程引用（`git fetch origin pull/<n>/head:refs/recap/fork-head`）——获取提交是安全的 | 从 fork 安装软件包、运行 fork 脚本或将 fork 内容评估为代码 |
| 运行 `git diff base...refs/recap/fork-head` — 两个已获取对象的纯文本差异                        | 将差异用作 LLM 文本输入之外的任何内容                      |
| 运行**基础存储库的**视觉回顾技能和代理配置                                                      | 从 fork 加载任何技能或配置                                 |
| 通过与第一方 PR 相同的秘密扫描步骤（失败关闭）传递差异                                          | 跳过秘密扫描                                               |
| 向代理提示添加明确的提示强化注释，将差异内容标记为不受信任                                      | 授予代理除正常回顾代理之外的任何其他权限                   |

### 为什么在标记之前必须检查差异

fork diff 是攻击者控制的文本，recap 代理将其读取为输入。精心设计的 diff 可能包含提示注入内容 - 例如，看起来像代理指令的 diff 行 - 旨在使 recap 代理采取非预期的 actions （例如，泄露发布令牌或产生误导性的 recap 内容）。

在应用 `recap` 标签之前，浏览差异：

- 读起来像直接命令或角色指令的行（“忽略先前的指令...”、“您现在...”、“将令牌写入...”）。
- 不寻常的文件名可能会在系统提示时被误读。
- 添加的文件中的编码内容可能会解码为指令。

这些缓解措施已经在工作流程中分层（秘密扫描、敏感路径门控、提示强化注释、受限代理工具白名单），但标签审查是主要防线。

### 与主工作流程的关系

这两个工作流程文件是独立的。对于非分叉 PR 更新，`pr-visual-recap.yml` 是唯一运行的工作流程。对于分叉 PR，正常工作流程在其分叉门处退出，`pr-visual-recap-fork.yml` 会为受信任的同一组织作者自动运行，或者在外部贡献者的新维护者 `recap` 标签之后自动运行。它们共享相同的粘性评论标记和计划 ID 线程，因此 PR 和分支 PR 都会对同一 PR 生成单个更新插入的评论。

### 自修改守卫 {#self-modifying-guard}

当 PR 触及以下任何路径时，`gate` 步骤会完全跳过回顾，因此 PR 永远无法重写可信回顾作业加载并泄露机密的工作流程、技能或代理配置：

| 路径模式                                   | 原因                                     |
| ------------------------------------------ | ---------------------------------------- |
| `.github/workflows/pr-visual-recap.yml`    | 工作流程本身                             |
| `**/skills/visual-(recap\|plan\|plans)/**` | The visual-recap skill the agent follows |
| `**/.claude/**`                            | 运行程序加载的代理设置                   |
| `**/CLAUDE.md`                             | 运行程序加载的代理指令                   |
| `**/AGENTS.md`                             | 运行程序加载的代理指令                   |
| `**/.mcp.json`                             | 运行器加载的MCP服务器配置                |

在 `BuilderIO/agent-native` monorepo 中，工作流程从受信任的基本分支源而不是 PR 头源运行回顾 CLI。这使得正常的包更改（包括 `packages/core/**`）可以进行回顾，而无需执行 PR 修改的 CLI 代码。

## 本地文件隐私模式

GitHub 操作专为托管、可共享的 PR 审核而设计。如果你想要一个
回顾而不将回顾内容发送到 Agent-Native 计划数据库，运行
相同的帮助程序在本地文件模式下本地流动：

```bash
npx @agent-native/core@latest recap collect-diff --base main --head HEAD --out recap.diff --stat recap.stat
npx @agent-native/core@latest recap scan --diff recap.diff
npx @agent-native/core@latest recap build-prompt --pr 123 --diff recap.diff --stat recap.stat --local-files --local-dir plans/pr-123-visual-recap
```

将生成的 `recap-prompt.md` 交给您的编码代理。在本地文件模式
提示指示代理写入 `plans/pr-123-visual-recap/plan.mdx`
加上可选的视觉文件，然后运行：

```bash
npx @agent-native/core@latest plan local serve --dir plans/pr-123-visual-recap --kind recap --open
```

返回的 URL 打开托管计划 UI，同时浏览器读取回顾 MDX
来自本地主机桥。回顾内容未写入托管计划
数据库，URL仅适用于运行网桥的机器。如果你运行
本地计划应用程序具有相同的 `PLAN_LOCAL_DIR`，
`/local-plans/pr-123-visual-recap` 路线也有效。回购支持的文件夹可以
以 `/local-plans/pr-123-visual-recap?path=plans%2Fpr-123-visual-recap` 的形式打开。
此模式禁用托管的粘性 PR 评论、内嵌屏幕截图上传，
使用附件和浏览器评论，直到您明确发布为止。

## 它是信息性的，而不是门

概述是在正常 PR 流程之上的复习辅助工具：

- 它显示 `Visual Recap` 检查行以提高可见性，但它**不是必需的检查**并且永远不会阻止合并。
- 生成或发布失败会中立地完成，并显示为解释性粘性注释，而不是不相关代码上的红色 X。
- 回顾及其屏幕截图**并不意味着差异已被审查**。审阅者仍然需要阅读实际更改的行。

## 版本固定（复制变体） {#version-pinning-copy-variant}

默认情况下，复制变体工作流程在运行时安装 `@agent-native/core@latest`，因此每次回顾运行都会自动选择最新的 CLI。如果您的 CI 需要可重现的工具，请设置 **`RECAP_CLI_VERSION`** 存储库变量来固定已安装的版本：

1. 转到您的存储库的**设置 → 秘密和变量 → Actions → 变量**。
2. 创建一个名为 `RECAP_CLI_VERSION` 的变量，其值类似于 `1.5.0`。

该变量是可选的。保持未设置（或将其设置为 `latest`）以跟踪最新版本。

对于可重用调用程序变体，请使用 `cli-version` 输入（请参阅可重用部分中的 [Version pinning](#version-pinning)）。

## 秘密扫描白名单

在发布回顾之前，工作流程运行 `npx @agent-native/core@latest recap scan` 以检测差异中可能的秘密。任何其 diff 与已知秘密模式匹配的 PR 都会被阻止并带有解释性注释 - 不会发布摘要，并且不会将 diff 内容发送到编码代理。

在极少数情况下，存储库具有故意的测试装置或表面上类似于秘密模式的非秘密字符串（例如，测试文件中的装置密钥）。要抑制误报，请在存储库的根目录中创建 `.github/recap-scan-allowlist`。

### 格式

每个非空白、非注释行都是一个 **文字子字符串** 或 **`/regex/flags`** 模式：

```
# 以 # 开头的行是注释。

# 文字子字符串 — 允许包含该字符串的任何 diff 行。
sk-test-fixture1234567890abcdef

# Regex pattern — written as /pattern/flags (JS syntax).
/^.STRIPE_KEY=sk-test-/i

# 又一个字面意思。
EXAMPLE_API_KEY=placeholder-value
```

规则：

- 当一行包含文字或整行与正则表达式匹配时，该行将被**抑制**（允许）。
- 文件是**失败关闭**：如果不存在，则不应用任何抑制 - 扫描器的行为与以前一样。
- 空文件相当于没有文件。
- 格式错误的正则表达式行被视为文字字符串。

白名单仅由秘密扫描门查阅。它不会影响编码代理可以读取的内容 - 如果门通过，代理无论如何都会收到完整的差异。

## 采用可重复使用的工作流程

### 为什么使用可重用变体？

默认安装程序将完整的约 360 行工作流程 YAML 复制到您的存储库中（**复制**选项）。对于气隙存储库或需要审核每一行运行内容的存储库来说，这是正确的选择。缺点是错误修复和改进永远不会到达您的手中 - 您需要在每次发布后手动重新运行 `npx @agent-native/core@latest recap setup`。

**可重用**选项改为编写一个精简的约 20 行调用程序。它通过`uses:`委托给`BuilderIO/agent-native/.github/workflows/pr-visual-recap-reusable.yml`。当工作流程运行时，每个调用者都会自动获取最新逻辑，无需本地更新。

|                        | 复制（默认）                | 可重复使用                       |
| ---------------------- | --------------------------- | -------------------------------- |
| 存储库中的工作流程大小 | ~360 行                     | ~20 行                           |
| 自动修复               | 否 — 重新运行 `recap setup` | 是                               |
| 气隙/完全可审计性      | 是                          | 否                               |
| 可固定到特定版本       | 仅通过本地编辑              | 是 - 将 `@v1.2.3` 设置为 `uses:` |

### 调用者片段

这是`npx @agent-native/core@latest recap setup --reusable`写的（或者你可以手动粘贴）：

```yaml
name: PR Visual Recap

# 瘦调用者 — 完整的工作流逻辑位于 BuilderIO/agent-native 中。
# 修复和改进会在每次运行时自动到达此存储库。
# 要固定特定版本以实现可重复性，请将 '@main' 替换为
# 标签或 SHA、e.g。 '@<x2/>' 或 '@abc1234'。

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review, closed]

jobs:
  visual-recap:
    permissions:
      actions: write
      contents: read
      checks: write
      issues: write
      pull-requests: write
    uses: BuilderIO/agent-native/.github/workflows/pr-visual-recap-reusable.yml@main
    secrets:
      PLAN_RECAP_TOKEN: ${{ secrets.PLAN_RECAP_TOKEN }}
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      PLAN_RECAP_APP_URL: ${{ secrets.PLAN_RECAP_APP_URL }}
    with:
      agent: ${{ vars.VISUAL_RECAP_AGENT || 'claude' }}
      model: ${{ vars.VISUAL_RECAP_MODEL || '' }}
      reasoning: ${{ vars.VISUAL_RECAP_REASONING || '' }}
      skill-source: ${{ vars.VISUAL_RECAP_SKILL_SOURCE || 'auto' }}
      # cli-version: "latest"  # pin to a specific @agent-native/core version
```

适用 [Secrets and variables](#secrets-and-variables) 中描述的相同秘密和变量 - 在存储库设置中以与复制变体相同的方式设置它们。

### 通过CLI安装

```bash
# 编写瘦调用者而不是完整副本：
npx @agent-native/core@latest recap setup --reusable

# 或者使用固定参考来实现可重复性：
npx @agent-native/core@latest recap setup --reusable --ref v1.2.3
```

两种变体都将工作流程写入 `.github/workflows/pr-visual-recap.yml`。如果现有工作流程已存在且有所不同，则该命令会拒绝并告诉您传递 `--force` 进行覆盖。

写入后，照常运行 `npx @agent-native/core@latest recap doctor` 以确认机密已配置。

### 版本固定

默认情况下，调用者引用 `@main`，它始终使用可重用工作流程的最新发布版本。对于需要可重现 CI 的生产存储库，请固定到标签或 SHA：

```yaml
uses: BuilderIO/agent-native/.github/workflows/pr-visual-recap-reusable.yml@v1.2.3
```

`cli-version` 输入控制工作流程中运行的 `@agent-native/core` CLI 版本 - 将其保留在 `"latest"` 以跟踪最新版本，或将其固定到版本字符串（例如 `"1.5.0"`）以实现完全可重复性。

### workflow_call事件上下文

`workflow_call` 工作流程继承**调用者的**事件上下文。可重用工作流程使用 `github.event.pull_request.*` 表达式来读取 PR 编号、头 SHA、基础 SHA、合并时间戳和 PR 元数据 - 仅当调用者在 `pull_request` 上触发时，这些才能正常工作。上面的调用者代码片段已经包含正确的事件类型。包含 `closed` 事件，因此合并的 PR 回顾可以用 `merged_at` 标记，并在以后作为已发布的工作进行搜索。

不要在 `workflow_dispatch` 或 `push` 上触发调用者 - 这些事件不携带 `pull_request` 负载，并且门将跳过“无 pull_request 负载”的回顾。

## 相关

- [Visual Plans](/docs/template-plan) — `/visual-plan` 和 `/visual-recap` skills、托管计划连接器以及此操作发布到的交互式审核界面。
- [Skills](/docs/skills-guide) — 将代理本机 skills 安装到您的编码代理中。
