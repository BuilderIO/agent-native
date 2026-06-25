---
title: "迁移到 Agent-Native (/migrate)"
description: "迁移是 Agent-Native 代码工作区中的内置 /migrate 目标，而不是单独的应用程序。请参阅 Agent-Native 代码 UI 获取完整指南。"
---

# 迁移到 Agent-Native (/migrate)

迁移**不是单独的产品或模板** - 它是内置的
[Agent-Native Code](/docs/code-agents-ui) 工作空间内的 `/migrate` 目标。
它作为正常的代码会话运行，您可以恢复、附加、检查和停止。

```an-diagram title="/migrate 是一个代码会话，而不是一个单独的应用程序" summary="路径、URL 或描述进入；该运行与其他所有代码会话共享相同的存储、脚本和控件，并且可以生成可移植的档案。"
{
  "html": "<div class=\"diagram-migrate\"><div class=\"diagram-col\"><div class=\"diagram-pill\">./local-app</div><div class=\"diagram-pill\">https://example.com</div><div class=\"diagram-pill\">--describe \\\"...\\\"</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">/migrate goal</span><small class=\"diagram-muted\">同一存储 · 转录 · 运行控制</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\" data-rough>已迁移应用</div><div class=\"diagram-pill ok\">--emit dossier</div></div></div>",
  "css": ".diagram-migrate{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-migrate .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-migrate .diagram-arrow{font-size:22px;line-height:1}.diagram-migrate .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

```bash
npx @agent-native/core@latest code /migrate ./my-next-app --out ../migrated-app
npx @agent-native/core@latest code /migrate https://example.com --describe "marketing site plus dashboard"
npx @agent-native/core@latest migrate ./my-next-app --out ../migrated-app   # shortcut into the same goal
```

完整指南 - 输入形状（路径/URL/描述）、`--emit` 档案，
计划与自动模式、运行控件、凭据、桌面深层链接以及
`@agent-native/migrate` 包导出 — 位于
[Agent-Native Code UI → Migrating to Agent-Native](/docs/code-agents-ui#migrate).

> [!NOTE]
> 旧版隐藏的 `migration` 详细信息应用程序已被删除。使用代码
> 工作区、桌面代码选项卡或发出的达析报告作为受支持
> 表面。
