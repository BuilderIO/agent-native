---
title: "多租戶"
description: "每個 Agent-Native 應用程式都是開箱即用的多租戶 - 組織、團隊成員、角色和每個組織的資料隔離，且零設定。"
---

# 多租戶

每個 Agent-Native 應用程式都是開箱即用的多租戶。組織、團隊成員、基於角色的存取和每個組織的資料隔離均內建於框架中，零設定。

## 您免費獲得的東西 {#free}

新的 `npx @agent-native/core@latest create` 腳手架已附帶：

- **使用者註冊和登入** — 參見 [Authentication](/docs/authentication)。
- **組織** — 使用者建立組織並透過電子郵件邀請成員。每個組織都是一個完全隔離的租戶。
- **角色** — 每個成員都是 `owner`、`admin` 或 `member`； actions可以檢視角色是否授權。
- **組織切換** — 工作階段跟蹤活動組織 (`session.orgId`)，切換它會更改使用者和代理看到的資料。
- **每組織資料隔離** — 每個查詢都會自動限定到活動組織。

如果您正在評估 CRM、專案跟蹤器、支援收件箱或任何團隊工具的原生代理，那麼多租戶基礎已經存在。所有第一方範本都是多租戶的 - 請參閱 [Cloneable SaaS templates](/docs/cloneable-saas) 取得清單。

```an-diagram title="組織成員資格和隔離" summary="使用者以 owner/admin/member 身分加入組織。每個可擁有的行都帶有擁有它的租戶的 org_id ，並且沒有行跨越邊界泄漏。"
{
  "html": "<div class=\"mt-grid\"><div class=\"diagram-card\"><span class=\"diagram-pill accent\">組織 A</span><small class=\"diagram-muted\">members: alice (owner), bob (member)</small><div class=\"diagram-box\">rows where org_id = A</div></div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">組織 B</span><small class=\"diagram-muted\">members: carol (owner)</small><div class=\"diagram-box\">rows where org_id = B</div></div></div><div class=\"mt-wall\" aria-hidden=\"true\"><span class=\"diagram-pill warn\">no cross-org reads</span></div>",
  "css": ".mt-grid{display:flex;gap:16px;flex-wrap:wrap}.mt-grid .diagram-card{display:flex;flex-direction:column;gap:8px;padding:14px 16px;flex:1;min-width:200px}.mt-wall{display:flex;justify-content:center;margin-top:12px}"
}
```

## 組織切換者 UI {#org-switcher}

組織切換者和成員 UI 在每個範本中呈現，無需額外程式碼。他們在 `/_agent-native/org/*` 下驅動核心組織 REST 路由（建立組織、切換組織、列出/邀請/刪除成員、更改角色、設定允許的電子郵件域）。使用者從切換器中選取活動組織；成員面板處理邀請和角色變更。

這是框架自己的`org/`模組，而不是Better Auth的組織外掛（故意不註冊）。完整的組織管理介面——`createOrganization`、REST 路由和範本編寫的 `defineAction` 包裝器（如 `invite-member`）——紀錄在 [Authentication → Organizations](/docs/authentication#organizations) 中。

## 隔離的工作原理 {#isolation}

租戶資料由 `org_id` 列（由 `ownableColumns()` 新增）隔離，框架自動將每個查詢範圍限定為活動組織：`session.orgId → AGENT_ORG_ID → SQL`。當使用者切換組織時，UI、actions 和代理都只能看到該組織的資料 - 代理無法存取使用者不是其成員的組織的資料。

```an-diagram title="從工作階段到作用域 SQL" summary="工作階段中的活動組織變為 AGENT_ORG_ID，框架將其折疊到每個查詢的 WHERE 子句中。"
{
  "html": "<div class=\"mt-pipe\"><div class=\"diagram-node\">session.orgId<br><small class=\"diagram-muted\">active org on session</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">AGENT_ORG_ID<br><small class=\"diagram-muted\">request context</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">SQL row scoping<br><small class=\"diagram-muted\">WHERE owner_email = ? AND org_id = ?</small></div></div>",
  "css": ".mt-pipe{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.mt-pipe .diagram-node{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.mt-pipe .diagram-arrow{font-size:22px;line-height:1}"
}
```

這與用於每使用者範圍的管道相同。對於 SQL 層級的機制、`ownableColumns()` 合約和 `accessFilter` / `resolveAccess` / `assertAccess` 防護，請參閱 [Security → Data Scoping](/docs/security#data-scoping) — 範圍界定管道的單一事實來源。

## 相關檔案 {#related}

- [Authentication](/docs/authentication#organizations) — 工作階段、社交提供者和組織管理介面
- [Security → Data Scoping](/docs/security#data-scoping) - SQL 級隔離、`ownableColumns()` 合約和存取防護
- [Multi-App Workspace](/docs/multi-app-workspace) — 在具有共用驗證和 RBAC 的單一儲存庫中託管多個 Agent-Native 應用程式
