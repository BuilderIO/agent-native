---
title: "工作區治理"
description: "分支、CODEOWNERS、PR 審查以及 Dispatch 如何與 git 級治理一起處理執行時治理。"
---

# 工作區治理

> **哪個工作區檔案？** 此頁面涵蓋 **治理** - 誰在一個儲存庫中的多個應用程式中審查、核准和擁有內容。對於工作空間*是什麼*（定制層），請參閱 [Workspace](/docs/workspace)；對於部署形狀（一個單一儲存庫，許多應用程式），請參閱 [Multi-App Workspaces](/docs/multi-app-workspace)。

本指南涵蓋了執行 Agent-Native 工作區的操作方面 - 如何分支、誰審查什麼、如何設定程式碼所有權以及 Dispatch 控制平面如何適應您的治理模型。

```an-diagram title="兩個治理平面" summary="Git 管理程式碼； Dispatch 控制執行時。它們是互補的——不要將一個複製到另一個中。"
{
  "html": "<div class=\"gov\"><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Git 和 GitHub</span><strong>程式碼治理</strong><div class=\"gov-list\"><span class=\"diagram-pill\">CODEOWNERS</span><span class=\"diagram-pill\">branch protection</span><span class=\"diagram-pill\">PR 評審</span><span class=\"diagram-pill\">git log / blame</span></div></div><div class=\"diagram-pill diagram-muted\">+</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Dispatch</span><strong>Runtime governance</strong><div class=\"gov-list\"><span class=\"diagram-pill\">vault secrets &amp; grants</span><span class=\"diagram-pill\">workspace resources</span><span class=\"diagram-pill\">agent profiles</span><span class=\"diagram-pill\">approvals &amp; audit</span></div></div></div>",
  "css": ".gov{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.gov .diagram-card{display:flex;flex-direction:column;gap:8px;padding:16px 18px;flex:1;min-width:240px}.gov .gov-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}"
}
```

## 分支

### 功能分支

對所有工作使用短期功能分支：

```
main                         ← production
├── feat/mail-filters        ← single-app change
├── feat/core-oauth-refresh  ← framework change
├── fix/analytics-chart      ← targeted bug fix
└── feat/vault-encryption    ← dispatch/infra change
```

**命名約定：**

- **單一應用程式更改：** `feat/<app>-<description>` 或 `fix/<app>-<description>` — 例如`feat/mail-thread-search`、`fix/calendar-recurrence-parse`
- **框架更改：** `feat/core-<description>` 或 `fix/core-<description>` — 例如`feat/core-polling-v2`
- **調度更改：** `feat/dispatch-<description>` — 例如`feat/dispatch-vault-policies`
- **跨應用程式更改：**如果框架更改需要範本更新，請在一個分支中執行這兩項操作，以便它們以原子方式發布

保持分支短暫。長期存在的分支與主分支分離，並造成痛苦的合併——尤其是在多個團隊每天推送的單一儲存庫中。

### 非開發人員分支

並不是每個需要進行更改的人都對 git 感到滿意。 [Builder.io](https://www.builder.io) 支援視覺化分支模型，可對應到底層的 git 分支 - 對於內容和副本更改、布局調整、設計迭代以及無需開發環境的 A/B 測試非常有用。

## 程式碼所有權

程式碼治理由儲存庫根目錄中的幾個檔案設定：

```an-file-tree title="repo 中的治理設定"
{
  "entries": [
    { "path": ".github/CODEOWNERS", "note": "按變更路徑自動分配 reviewers" },
    { "path": ".github/labeler.yml", "note": "按 app 自動給 PR 加標籤" },
    { "path": "pnpm-workspace.yaml", "note": "Workspace 層級：寬範圍 review" },
    { "path": "package.json", "note": "Workspace 層級：平台團隊負責" }
  ]
}
```

GitHub 的 CODEOWNERS 檔案會根據更改的檔案自動將審閱者分配給 PR。在儲存庫根目錄建立 `.github/CODEOWNERS`：

```
# Framework core — affects every app; platform team reviews all changes
packages/core/                     @your-org/platform-team

# 調度控制平面——秘密、整合、工作空間資源
templates/dispatch/                @your-org/platform-team

# 每個應用程式所有權 - 每個團隊都會審查自己的應用程式
templates/mail/                    @your-org/mail-team
templates/analytics/               @your-org/analytics-team
templates/calendar/                @your-org/calendar-team
# ... add an entry per app

# 工作區層級設定 - 廣泛審查，因為它影響每個人
.github/                           @your-org/platform-team
package.json                       @your-org/platform-team
pnpm-workspace.yaml                @your-org/platform-team
```

關鍵提示：使用 GitHub 團隊 (`@org/team`)，而不是個人。框架和調度更改應始終需要平台審查。請參閱 [GitHub CODEOWNERS docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) 了解 glob 語法和多所有者模式。

要啟用所需的審查：設定 → 分支 → `main` 的分支保護 → **在合併之前需要 pull request** → **需要程式碼所有者的審查**。

## PR 標籤

透過應用使用 `.github/labeler.yml` 自動標記 PR（摘錄）：

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

然後新增 [actions/labeler](https://github.com/actions/labeler) 操作 - 請參閱該儲存庫的 README 以了解完整的工作流程 YAML。開啟或更新 PR 時，標籤會自動應用。

## PR 審核指南

| 更改型別                              | 誰評論                          | 要注意什麼                                          |
| ------------------------------------- | ------------------------------- | --------------------------------------------------- |
| **僅限應用程式** (`templates/<app>/`) | 擁有應用團隊                    | 域正確性、操作模式                                  |
| **框架**（`packages/core/`）          | 平台團隊 + 一個受影響的應用團隊 | 重大變更、性能、向後相容性                          |
| **架構遷移**                          | 平台團隊+進階工程師             | 資料安全、方言不可知論（SQLite + Postgres）         |
| **Actions**                           | 所屬團隊                        | Actions 都是代理工具 AND HTTP 端點 - 從兩個角度回顧 |
| **跨應用 A2A**                        | 兩個應用團隊                    | 如果更改 A2A 介面，呼叫者需要知道                   |
| **調度庫/資源**                       | 平台團隊                        | 秘密存取、授予範圍、誰獲得什麼                      |

### 並發代理工作

Agent-Native 工作區通常有多個 AI 代理同時在同一分支上工作。這是設計使然——代理共用一個分支並獨立推送。

```an-callout
{ "tone": "warning", "body": "**The later commit wins.** Two agents touching the same file won't conflict at commit time — the conflict surfaces at review. Run `pnpm run prep` (typecheck + test + format) before pushing, and don't revert changes you didn't make unless they're clearly broken." }
```

在此環境中審核 PR 時：

- **不要恢復您未進行的更改**除非它們明顯損壞
- **檔案可能會被同一 PR 中的多個代理修改** - 這是正常的
- **在推送之前執行 `pnpm run prep`**（型別檢查 + 測試 + 格式）以捕獲代理更改之間的整合問題
- **如果兩個代理接觸同一個檔案，**較晚的提交獲勝。衝突在審查時出現，而不是在提交時出現
- **修復 PR 中任何程式碼中的錯誤，**無論是哪個代理編寫的。 PR 會作為一個整體進行審核。

## 調度作為治理

[Dispatch](/docs/dispatch) 應用程式是工作區的執行時控制平面。它透過執行時治理補充了 git 級治理：

| 關注             | Git 和 GitHub           | 調度                                      |
| ---------------- | ----------------------- | ----------------------------------------- |
| 誰可以更改程式碼 | CODEOWNERS，分支保護    | —                                         |
| 誰可以存取機密   | —                       | 保險櫃政策、撥款、請求工作流程            |
| 代理遵循哪些指示 | —                       | 全域工作區資源（AGENTS.md、說明、skills） |
| 共用哪些代理     | —                       | 工作區代理設定檔案                        |
| 整合庫存         | —                       | 工作區連線和整合目錄                      |
| 執行時變更核准   | —                       | 調度核准流程                              |
| 審計跟蹤         | `git log` / `git blame` | Vault審核+調度審核記錄                    |
| 訊息傳遞和路由   | —                       | Slack / Telegram 整合                     |

**Git 處理程式碼治理。 Dispatch 處理執行時治理。** 不要嘗試在 Dispatch 內複製 git 工作流程，反之亦然。

Dispatch 管理：保管庫機密、可重用工作區連線、工作區資源（skills、說明、代理設定檔案、MCP 伺服器）、核准和審核記錄。公開應用路由設定（`workspaceApp.audience` / `publicPaths` / `protectedPaths`）請參見[Multi-App Workspaces — Public app routes](/docs/multi-app-workspace#deployment)。

資源模型和規範路徑請參見[Workspace — Global resources](/docs/workspace#global-resources)。

## 設定清單

對於新工作區，執行 `npx @agent-native/core@latest create` 後：

**Git 和 GitHub:**

- [ ] 建立具有每個應用團隊所有權的 `.github/CODEOWNERS`
- [ ] 在 `main` 上啟用分支保護並進行必要的程式碼所有者審核
- [ ] 新增 `.github/labeler.yml` 以透過應用自動標記 PR
- [ ] 為每個應用和平台團隊建立 GitHub 團隊

**調度：**

- [ ] 將共用機密新增到保管庫（API 金鑰、OAuth 憑證等）
- [ ] 保留預設的所有應用保管庫策略或切換到手動按應用授予
- [ ] 同步保管庫機密以將其推送到應用程式
- [ ] 為共用提供者帳戶註冊可重用工作區連線，然後
      僅在需要時授予 Brain、Analytics、Mail 或 Dispatch 等應用程式
      該帳戶
- [ ] 透過資源頁面新增工作區範圍的 skills、護欄說明和品牌/公司參考資源。請參閱 [Workspace](/docs/workspace#global-resources) 了解完整的資源模型表和推薦的入門包。
- [ ] 設定核准策略和核准人電子郵件
- [ ] 設定 SendGrid（`SENDGRID_API_KEY`、`SENDGRID_FROM_EMAIL`）以取得管理員通知
- [ ] 連線 Slack 或 Telegram 以進行工作區訊息傳遞
- [ ] 設定共用 MCP 伺服器 — 在 Dispatch 中新增 `mcp-servers/<name>.json` 工作區資源以用於所有應用程式或選定應用程式授權；使用 `mcp.config.json` 或 [MCP hub mode](/docs/mcp-clients#hub) 進行較低階別的部署
