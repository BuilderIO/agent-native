---
title: "工作区治理"
description: "分支、CODEOWNERS、PR 审查以及 Dispatch 如何与 git 级治理一起处理运行时治理。"
---

# 工作区治理

> **哪个工作区文档？** 此页面涵盖 **治理** - 谁在一个存储库中的多个应用程序中审查、批准和拥有内容。对于工作空间*是什么*（定制层），请参阅 [Workspace](/docs/workspace)；对于部署形状（一个单一存储库，许多应用程序），请参阅 [Multi-App Workspaces](/docs/multi-app-workspace)。

本指南涵盖了运行代理本机工作区的操作方面 - 如何分支、谁审查什么、如何设置代码所有权以及 Dispatch 控制平面如何适应您的治理模型。

```an-diagram title="两个治理平面" summary="Git 管理代码； Dispatch 控制运行时。它们是互补的——不要将一个复制到另一个中。"
{
  "html": "<div class=\"gov\"><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Git 和 GitHub</span><strong>代码治理</strong><div class=\"gov-list\"><span class=\"diagram-pill\">CODEOWNERS</span><span class=\"diagram-pill\">branch protection</span><span class=\"diagram-pill\">PR 评审</span><span class=\"diagram-pill\">git log / blame</span></div></div><div class=\"diagram-pill diagram-muted\">+</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Dispatch</span><strong>Runtime governance</strong><div class=\"gov-list\"><span class=\"diagram-pill\">vault secrets &amp; grants</span><span class=\"diagram-pill\">workspace resources</span><span class=\"diagram-pill\">agent profiles</span><span class=\"diagram-pill\">approvals &amp; audit</span></div></div></div>",
  "css": ".gov{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.gov .diagram-card{display:flex;flex-direction:column;gap:8px;padding:16px 18px;flex:1;min-width:240px}.gov .gov-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}"
}
```

## 分支

### 功能分支

对所有工作使用短期功能分支：

```
main                         ← production
├── feat/mail-filters        ← single-app change
├── feat/core-oauth-refresh  ← framework change
├── fix/analytics-chart      ← targeted bug fix
└── feat/vault-encryption    ← dispatch/infra change
```

**命名约定：**

- **单个应用程序更改：** `feat/<app>-<description>` 或 `fix/<app>-<description>` — 例如`feat/mail-thread-search`、`fix/calendar-recurrence-parse`
- **框架更改：** `feat/core-<description>` 或 `fix/core-<description>` — 例如`feat/core-polling-v2`
- **调度更改：** `feat/dispatch-<description>` — 例如`feat/dispatch-vault-policies`
- **跨应用程序更改：**如果框架更改需要模板更新，请在一个分支中执行这两项操作，以便它们以原子方式发布

保持分支短暂。长期存在的分支与主分支分离，并造成痛苦的合并——尤其是在多个团队每天推送的单一存储库中。

### 非开发人员分支

并不是每个需要进行更改的人都对 git 感到满意。 [Builder.io](https://www.builder.io) 支持可视化分支模型，可映射到底层的 git 分支 - 对于内容和副本更改、布局调整、设计迭代以及无需开发环境的 A/B 测试非常有用。

## 代码所有权

代码治理由存储库根目录中的几个文件配置：

```an-file-tree title="repo 中的治理配置"
{
  "entries": [
    { "path": ".github/CODEOWNERS", "note": "按变更路径自动分配 reviewers" },
    { "path": ".github/labeler.yml", "note": "按 app 自动给 PR 加标签" },
    { "path": "pnpm-workspace.yaml", "note": "Workspace 级别：宽范围 review" },
    { "path": "package.json", "note": "Workspace 级别：平台团队负责" }
  ]
}
```

GitHub 的 CODEOWNERS 文件会根据更改的文件自动将审阅者分配给 PR。在存储库根目录创建 `.github/CODEOWNERS`：

```
# Framework core — affects every app; platform team reviews all changes
packages/core/                     @your-org/platform-team

# 调度控制平面——秘密、集成、工作空间资源
templates/dispatch/                @your-org/platform-team

# 每个应用程序所有权 - 每个团队都会审查自己的应用程序
templates/mail/                    @your-org/mail-team
templates/analytics/               @your-org/analytics-team
templates/calendar/                @your-org/calendar-team
# ... add an entry per app

# 工作区级别配置 - 广泛审查，因为它影响每个人
.github/                           @your-org/platform-team
package.json                       @your-org/platform-team
pnpm-workspace.yaml                @your-org/platform-team
```

关键提示：使用 GitHub 团队 (`@org/team`)，而不是个人。框架和调度更改应始终需要平台审查。请参阅 [GitHub CODEOWNERS docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) 了解 glob 语法和多所有者模式。

要启用所需的审查：设置 → 分支 → `main` 的分支保护 → **在合并之前需要拉取请求** → **需要代码所有者的审查**。

## 公关标签

通过应用使用 `.github/labeler.yml` 自动标记 PR（摘录）：

```yaml
app:mail:
  - changed-files:
      - any-glob-to-any-file: templates/mail/**
app:analytics:
  - changed-files:
      - any-glob-to-any-file: templates/analytics/**
core:
  - changed-files:
      - any-glob-to-any-file: packages/core/**
```

然后添加 [actions/labeler](https://github.com/actions/labeler) 操作 - 请参阅该存储库的 README 以了解完整的工作流程 YAML。打开或更新 PR 时，标签会自动应用。

## 公关审核指南

| 更改类型                              | 谁评论                          | 要注意什么                                          |
| ------------------------------------- | ------------------------------- | --------------------------------------------------- |
| **仅限应用程序** (`templates/<app>/`) | 拥有应用团队                    | 域正确性、操作模式                                  |
| **框架**（`packages/core/`）          | 平台团队 + 一个受影响的应用团队 | 重大变更、性能、向后兼容性                          |
| **架构迁移**                          | 平台团队+高级工程师             | 数据安全、方言不可知论（SQLite + Postgres）         |
| **Actions**                           | 所属团队                        | Actions 都是代理工具 AND HTTP 端点 - 从两个角度回顾 |
| **跨应用 A2A**                        | 两个应用团队                    | 如果更改A2A接口，调用者需要知道                     |
| **调度库/资源**                       | 平台团队                        | 秘密访问、授予范围、谁获得什么                      |

### 并发代理工作

代理本机工作区通常有多个 AI 代理同时在同一分支上工作。这是设计使然——代理共享一个分支并独立推送。

```an-callout
{ "tone": "warning", "body": "**The later commit wins.** Two agents touching the same file won't conflict at commit time — the conflict surfaces at review. Run `pnpm run prep` (typecheck + test + format) before pushing, and don't revert changes you didn't make unless they're clearly broken." }
```

在此环境中审核 PR 时：

- **不要恢复您未进行的更改**除非它们明显损坏
- **文件可能会被同一 PR 中的多个代理修改** - 这是正常的
- **在推送之前运行 `pnpm run prep`**（类型检查 + 测试 + 格式）以捕获代理更改之间的集成问题
- **如果两个代理接触同一个文件，**较晚的提交获胜。冲突在审查时出现，而不是在提交时出现
- **修复 PR 中任何代码中的错误，**无论是哪个代理编写的。 PR 会作为一个整体进行审核。

## 调度作为治理

[Dispatch](/docs/dispatch) 应用程序是工作区的运行时控制平面。它通过运行时治理补充了 git 级治理：

| 关注             | Git 和 GitHub           | 调度                                      |
| ---------------- | ----------------------- | ----------------------------------------- |
| 谁可以更改代码   | CODEOWNERS，分支保护    | —                                         |
| 谁可以访问机密   | —                       | 保险柜政策、拨款、请求工作流程            |
| 代理遵循哪些指示 | —                       | 全局工作区资源（AGENTS.md、说明、skills） |
| 共享哪些代理     | —                       | 工作区代理配置文件                        |
| 集成库存         | —                       | 工作区连接和集成目录                      |
| 运行时变更批准   | —                       | 调度审批流程                              |
| 审计跟踪         | `git log` / `git blame` | Vault审核+调度审核日志                    |
| 消息传递和路由   | —                       | Slack / Telegram 集成                     |

**Git 处理代码治理。 Dispatch 处理运行时治理。** 不要尝试在 Dispatch 内复制 git 工作流程，反之亦然。

Dispatch 管理：保管库机密、可重用工作区连接、工作区资源（skills、说明、代理配置文件、MCP 服务器）、批准和审核日志。公共应用路由配置（`workspaceApp.audience` / `publicPaths` / `protectedPaths`）请参见[Multi-App Workspaces — Public app routes](/docs/multi-app-workspace#deployment)。

资源模型和规范路径请参见[Workspace — Global resources](/docs/workspace#global-resources)。

## 设置清单

对于新工作区，运行 `npx @agent-native/core@latest create` 后：

**Git 和 GitHub:**

- [ ] 创建具有每个应用团队所有权的 `.github/CODEOWNERS`
- [ ] 在 `main` 上启用分支保护并进行必要的代码所有者审核
- [ ] 添加 `.github/labeler.yml` 以通过应用自动标记 PR
- [ ] 为每个应用和平台团队创建 GitHub 团队

**调度：**

- [ ] 将共享机密添加到保管库（API 密钥、OAuth 凭证等）
- [ ] 保留默认的所有应用保管库策略或切换到手动按应用授予
- [ ] 同步保管库机密以将其推送到应用程序
- [ ] 为共享提供商帐户注册可重用工作区连接，然后
      仅在需要时授予 Brain、Analytics、Mail 或 Dispatch 等应用程序
      该帐户
- [ ] 通过资源页面添加工作区范围的 skills、护栏说明和品牌/公司参考资源。请参阅 [Workspace](/docs/workspace#global-resources) 了解完整的资源模型表和推荐的入门包。
- [ ] 配置审批策略和审批人电子邮件
- [ ] 设置 SendGrid（`SENDGRID_API_KEY`、`SENDGRID_FROM_EMAIL`）以获取管理员通知
- [ ] 连接 Slack 或 Telegram 以进行工作区消息传递
- [ ] 配置共享 MCP 服务器 — 在 Dispatch 中添加 `mcp-servers/<name>.json` 工作区资源以用于所有应用程序或选定应用程序授权；使用 `mcp.config.json` 或 [MCP hub mode](/docs/mcp-clients#hub) 进行较低级别的部署
