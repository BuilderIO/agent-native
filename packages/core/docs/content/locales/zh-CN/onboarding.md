---
title: "入门和 API 密钥"
description: "首次运行配置的设置清单 - API 密钥、OAuth 和提供商连接"
---

# 入职

当您第一次打开基于代理本机框架构建的应用程序时，您会看到
代理侧栏中的**设置**清单。它使首次运行配置保持关闭
到代理聊天：连接人工智能引擎，可选择将应用程序指向共享
基础设施，仅在需要时添加提供程序。

```an-diagram title="设置清单" summary="只需要连接一个AI引擎。该面板会跟踪完成情况，并在完成所需的所有操作后自动隐藏。"
{
  "html": "<div class=\"ob\"><div class=\"diagram-card\"><span class=\"diagram-pill warn\">required</span><strong>连接 AI 引擎</strong><small class=\"diagram-muted\">Connect Builder (one click) or paste an LLM key</small></div><div class=\"diagram-card\"><span class=\"diagram-pill\">optional</span><strong>Database</strong><small class=\"diagram-muted\">set <code>DATABASE_URL</code></small></div><div class=\"diagram-card\"><span class=\"diagram-pill\">optional</span><strong>Authentication</strong><small class=\"diagram-muted\">OAuth / access token</small></div><div class=\"diagram-card\"><span class=\"diagram-pill\">optional</span><strong>邮件投递</strong><small class=\"diagram-muted\">Resend / SendGrid</small></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box ok\">all required done &rarr; panel auto-hides</div></div>",
  "css": ".ob{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.ob .diagram-card{display:flex;flex-direction:column;gap:3px;padding:12px 14px}.ob .diagram-arrow{font-size:22px}"
}
```

## 对于最终用户

### 您将看到什么

- 代理聊天上方的 **设置** 面板，其中包含“连接 AI”等清单
  引擎”、“电子邮件传送”等
- 顶部的计数器（例如“1 of 4”）显示已准备好多少步。
- 当前步骤已展开；完成的步骤显示绿色勾号并停留
  打开它们即可读取。
- 所需步骤显示一个红色的**所需**小药丸。面板保持可见
  直到完成所有必需的步骤。
- 完成所需的所有操作后，面板会自动隐藏。
- 整个面板可以折叠，并带有右上角的 V 形图标，或者
  通过底部的**隐藏设置**完全隐藏。

### 如何完成每个步骤

步骤提供一种或多种**方法** - 满足相同要求的不同方法
要求。首先显示主要路径；辅助路径保持紧凑
当一个步骤有多个等效提供者时，在选择器或披露后面。

- **连接服务（一键点击）** — 例如*连接 Builder* 进行托管
  人工智能网关。单击按钮，打开一个窗口，您登录，窗口关闭，
  并且该步骤被标记为完成。没有要复制的密钥。
- **粘贴 API 密钥或填写表格** - 例如选择 LLM 提供商、数据库，
  OAuth 提供商或电子邮件提供商，粘贴值，然后单击 **保存**。
  秘密字段使用密码输入，因此该值不会显示在屏幕上。已保存
  值进入您的本地 `.env`（或工作区设置） - 请参阅
  [Security](/docs/security) 表示他们居住的地方。
- **打开链接** — 某些步骤指向登录页面或文档。点击
  **继续**并在新选项卡中完成流程。
- **询问代理** — 只需几个步骤即可提供“让代理进行设置”选项。
  点击它，客服人员会在聊天中接听，引导您完成任何操作
  外部设置（创建 OAuth 凭证等）。

### 您通常会看到的内置步骤

- **连接人工智能引擎**（必需）——唯一的强制步骤。连接
  Builder 用于一键托管网关，或打开辅助提供商密钥
  选择并粘贴您自己的 LLM 密钥。
- **数据库**（可选）- 当您想使用特定时设置 `DATABASE_URL`
  SQL 数据库连接字符串。
- **身份验证**（可选）- 内置电子邮件/密码帐户的工作方式
  默认。仅当您需要这些路径时才添加 OAuth 或访问令牌登录。
- **电子邮件传送**（可选）- 在部署之前用于密码重置很有用，
  团队邀请和共享通知。使用您已经使用的提供商；
  本地开发可以在没有它的情况下运行。

模板可以在这些之上添加自己的步骤 - 例如CRM 模板可能
添加“连接 Gmail”，文档模板可能会添加“选择默认工作区”。请参阅
[Authentication](/docs/authentication) 用于登录设置详细信息。

### 回到清单

如果您点击**隐藏设置**，该浏览器会话的面板就会消失。
尚未完成的所需步骤将在下次加载时再次出现。一次
所需的一切都已完成，面板会自动隐藏 - 什么也没有
剩下要做的事。

## 对于开发者

如果您正在构建模板，则需要注册入门步骤，以便它们显示在
用户的侧边栏清单。框架处理渲染、完成
跟踪和解雇 - 您只需声明步骤是什么以及如何进行
满意。

系统是**自动安装**的。模板不需要连接任何东西即可获取
四个内置步骤（LLM、数据库、身份验证、电子邮件）。添加特定于应用程序的
steps (Gmail, Slack, Notion, etc.), call `registerOnboardingStep()` from a
服务器插件。

### 自动安装路线

所有路线均位于 `/_agent-native/onboarding/` 下：

| 路线                                                | 目的                      |
| --------------------------------------------------- | ------------------------- |
| `GET /_agent-native/onboarding/steps`               | 列出步骤及完成状态        |
| `POST /_agent-native/onboarding/steps/:id/complete` | 标记步骤完成（覆盖）      |
| `POST /_agent-native/onboarding/dismiss`            | 关闭入门横幅              |
| `POST /_agent-native/onboarding/reopen`             | 明确解雇（重新显示面板）  |
| `GET /_agent-native/onboarding/dismissed`           | 读取解雇+ allComplete标志 |

```an-api title="列出入职步骤"
{
  "method": "GET",
  "path": "/_agent-native/onboarding/steps",
  "summary": "列出所有已注册的步骤及其完成状态",
  "description": "Drives the sidebar checklist — returns each step's id, title, methods, required flag, and whether `isComplete` currently passes.",
  "responses": [
    { "status": "200", "description": "Array of steps with completion status for the current user/app." }
  ]
}
```

### 从模板添加步骤

```an-annotated-code title="注册自定义入门步骤"
{
  "filename": "server/plugins/my-onboarding.ts",
  "language": "ts",
  "code": "import { defineNitroPlugin } from \"@agent-native/core/server\";\nimport { registerOnboardingStep } from \"@agent-native/core/onboarding\";\nimport { listOAuthAccounts } from \"@agent-native/core/oauth-tokens\";\n\nexport default defineNitroPlugin(() => {\n  registerOnboardingStep({\n    id: \"gmail\",\n    order: 100,\n    title: \"Connect Gmail\",\n    description: \"Grant read/send access so the agent can work with email.\",\n    methods: [\n      {\n        id: \"oauth\",\n        kind: \"link\",\n        primary: true,\n        label: \"Sign in with Google\",\n        payload: { url: \"/_agent-native/google/auth-url?scope=mail\", external: false },\n      },\n      {\n        id: \"delegate\",\n        kind: \"agent-task\",\n        label: \"Let the agent set it up\",\n        badge: \"beta\",\n        payload: { prompt: \"Walk me through connecting Gmail. Set env vars as needed.\" },\n      },\n    ],\n    isComplete: async () => {\n      const accounts = await listOAuthAccounts(\"google\");\n      return accounts.length > 0;\n    },\n  });\n});",
  "annotations": [
    { "lines": "5", "label": "自动安装", "note": "从 Nitro 插件注册 - 该框架处理渲染、完成跟踪和解除。" },
    { "lines": "7", "label": "稳定ID", "note": "默认加载后使用相同的 `id` 重新注册会覆盖内置步骤。" },
    { "lines": "12-19", "label": "主要方法", "note": "`primary: true` marks the big CTA. `kind: \"link\"` sends the user into the OAuth flow." },
    { "lines": "20-26", "label": "委托路径", "note": "`kind: \"agent-task\"` hands the setup to the agent chat with a prompt." },
    { "lines": "28-31", "label": "竣工检查", "note": "`isComplete` 在服务器端运行。 OAuth 令牌位于 `oauth_tokens` 存储中 - 检查它，而不是 `process.env.GMAIL_REFRESH_TOKEN`。" }
  ]
}
```

### 在入职检查中检查工作区连接

构建与外部服务（例如 Slack、Google Workspace、GitHub 或 HubSpot）交互的模板时，您应该检查工作区是否已连接并授予该提供商与您的应用的连接。当存在中央托管连接时，这可以防止用户在本地环境变量中复制凭据（例如 API 密钥或刷新令牌）。

您可以使用连接目录 APIs 在 `isComplete` 回调中检查连接准备情况：

```ts
import { listWorkspaceConnectionProviderCatalogForApp } from "@agent-native/core/workspace-connections";

// Inside registerOnboardingStep:
isComplete: async () => {
  // Check if a managed workspace connection exists and is ready
  const catalog = await listWorkspaceConnectionProviderCatalogForApp({
    appId: "mail",
    templateUse: "mail",
    provider: "gmail",
  });
  const connection = catalog.providers[0];

  if (
    connection?.readiness.status === "ready" &&
    connection.workspaceConnection.grantState === "granted"
  ) {
    return true;
  }

  // Fall back to local environment variable check
  return !!process.env.GMAIL_REFRESH_TOKEN;
};
```

请参阅 [Workspace Connections](/docs/workspace-connections) 文档，了解连接提供程序目录方法的完整列表。

### 方法种类

| 种类               | 有效负载                                              | 用于                                   |
| ------------------ | ----------------------------------------------------- | -------------------------------------- |
| `link`             | `{ url, external? }`                                  | 将用户发送到 OAuth 流程或文档页面      |
| `form`             | `{ fields, writeScope? }`                             | 收集环境变量（密钥、秘密、URL）        |
| `builder-cli-auth` | `{ scope: "llm" \| "browser" \| "image-generation" }` | Connect Builder (unlocks shared infra) |
| `agent-task`       | `{ prompt }`                                          | 向客服聊天发送提示进行处理             |

`primary: true` 标志将方法标记为其步骤的大 CTA。
当设置路径应该可见时，使用 `badge: "soon"` 和 `disabled: true`
在可用之前。

### 内置步骤

| ID         | 必填 | 描述                                 |
| ---------- | ---- | ------------------------------------ |
| `llm`      | 是的 | Builder 连接或提供商 LLM 密钥        |
| `database` | 没有 | 默认数据库或任何SQL `DATABASE_URL`   |
| `auth`     | 没有 | 内置帐户，可选 OAuth 或访问令牌      |
| `email`    | 不   | 重新发送或 SendGrid 用于交易电子邮件 |

任何这些都可以通过在之后使用相同的 `id` 重新注册来覆盖
默认加载。

### 客户端使用

面板已位于 `<AgentPanel>` 内部。要构建自定义布局：

```tsx
import {
  OnboardingPanel,
  OnboardingBanner,
  useOnboarding,
} from "@agent-native/core/client/onboarding";

function MySidebar() {
  const { allComplete, dismissed, currentStepId } = useOnboarding();
  if (allComplete || dismissed) return <Chat />;
  return (
    <>
      <OnboardingPanel />
      <Chat />
    </>
  );
}
```

有关步骤值存储位置以及如何处理机密的背景信息，
参见 [Security](/docs/security)。对于最终用户消息传递接触点（邀请，
密码重置）取决于**电子邮件传送**步骤，请参阅
[Messaging](/docs/messaging).
