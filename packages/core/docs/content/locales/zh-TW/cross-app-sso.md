---
title: "跨應用 SSO"
description: "使用 Dispatch 作為身分授權，透過身分聯合在每個託管 Agent-Native 應用程式中登入一次 - 每個應用程式選取加入，可透過單一環境變數進行逆轉。"
---

# 跨應用 SSO

`*.agent-native.com` 上的每個託管應用程式都使用其**自己的獨立使用者儲存**執行自己的部署。 `mail.agent-native.com`和`calendar.agent-native.com`不共用資料庫、工作階段表或cookie域。因此，“登入一次，使用每個應用程式”不能是共用 cookie — 它必須是**身分聯合**，其中 [Dispatch](/docs/dispatch) 充當工作區的身分授權機構。

這與 [A2A](/docs/a2a-protocol) 和 [External Agents](/docs/external-agents) 已經使用的信任原語相同 - 在請求邊界驗證的 `A2A_SECRET` 簽名的 JWT - 應用於人工登入路徑，而不是代理到代理的呼叫。

> **統一部署與每個域部署。** 如果您在一個來源（`your-agents.com/mail`、`your-agents.com/calendar`）託管所有應用程式，您已經透過單一 cookie 域獲得共用登入 - 無需聯合。僅當應用程式在不同的域上執行時，才需要跨應用程式 SSO。參見[Multi-App Workspaces — Unified deploy](/docs/multi-app-workspace#deployment)。

## 什麼以及為什麼 {#what-why}

每個應用程式的使用者儲存意味著瀏覽器 cookie 沒有一個可以被每個應用程式信任的地方。相反，聯合模型將一個應用程式命名為 **Dispatch** 作為身分授權機構。任何其他應用程式都可以委托“這個人是誰？”要調度，取回使用者已驗證電子郵件的短暫簽名斷言，然後**透過電子郵件將其連結到其自己的本機帳戶**。

連結規則故意狹窄和附加：

- **現有同一電子郵件使用者→連結。**本機帳戶與經過驗證的電子郵件匹配並按原樣重複使用。它**永遠不會被修改、重新命名或刪除** - 聯合層只會讀取它並為其建立一個工作階段。
- **新電子郵件 → 建立。** 為該經過驗證的電子郵件建立一個新的本機帳戶，然後建立一個正常的本機工作階段。

這使得部署安全，即使它會導致人們退出。 **預計會登出。** 當應用程式開啟此功能時，現有工作階段將結束，並且使用者透過 Dispatch 重新進行驗證。但他們總是重新登入**同一個電子郵件匹配帳戶，所有資料都完好無損**，因為身分行只會*新增到* — 永遠不會被銷毀、重新命名或重新指向。

## 它是如何工作的 {#how-it-works}

該流程是標準授權 → 簽名權杖 → 回調重新導向，其中電子郵件是唯一跨越信任邊界的內容。

```an-diagram title="身分聯合流程" summary="Dispatch 對人員進行驗證，並返回一件事的短暫簽名斷言 - 經過驗證的電子郵件。該應用程式透過電子郵件連結並建立自己的本機工作階段。"
{
  "html": "<div class=\"diagram-sso\"><div class=\"diagram-card\" data-rough><strong>用戶端應用</strong><small class=\"diagram-muted\">own user store</small></div><div class=\"diagram-step\"><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><span class=\"diagram-pill\">authorize</span></div><div class=\"diagram-card\" data-rough><strong>Dispatch</strong><small class=\"diagram-muted\">identity authority</small><span class=\"diagram-pill accent\">authenticates human</span></div><div class=\"diagram-step\"><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><span class=\"diagram-pill accent\">302 + signed JWT</span></div><div class=\"diagram-card\" data-rough><strong>應用回調</strong><small class=\"diagram-muted\">verify signature · scope:identity · exp &le; 2 min</small><span class=\"diagram-pill ok\">透過信箱即時關聯</span><span class=\"diagram-pill ok\">mint local session</span></div></div>",
  "css": ".diagram-sso{display:flex;align-items:stretch;gap:12px;flex-wrap:wrap}.diagram-sso .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;min-width:150px}.diagram-sso .diagram-step{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}.diagram-sso .diagram-arrow{font-size:22px;line-height:1}"
}
```

1. **應用程式→調度（授權）。**應用程式將使用者傳送到身分授權機構：

   ```
   GET https://dispatch.agent-native.com/_agent-native/identity/authorize
       ?app=<requesting-app>
       &redirect_uri=<app-callback-url>
       &狀態=<csrf-state>
   ```

   ``an-api title="身分授權端點"
{
  “方法”：“GET”，
  “路徑”：“/_agent-native/identity/authorize”，
  “summary”：“Dispatch（身分授權）對人員進行驗證並使用簽名的身分權杖重新導向回來”，
  "auth": "調度工作階段（如果沒有則互動式登入）",
  “參數”：[
    { "name": "app", "in": "query", "type": "string", "required": true, "description": "請求的應用程式識別碼。" },
    { "name": "redirect_uri", "in": "query", "type": "string", "required": true, "description": "應用程式回調 URL。根據嚴格的允許清單進行驗證（預設為 `\*.agent-native.com`或 localhost）。" },
    { "name": "state", "in": "query", "type": "string", "required": true, "description": "CSRF 狀態在重新導向上回顯。" }
  ],
  “回應”：[
    { "status": "302", "description": "重新導向到`redirect_uri`，攜帶短暫的 `A2A_SECRET` 簽名身分 JWT（`scope: \"identity\"`、`exp`≤ 2 分鐘）加上原始`state`。" },
    { "status": "400", "description": "`redirect_uri`未通過允許清單驗證（跨來源、方案相關`//host` 或未列出的後綴）。" }
   ]
   }

   ```

   ```

2. **Dispatch 對人員進行驗證。** 如果使用者已有 Dispatch 工作階段，則這是透明的。如果沒有，Dispatch 將顯示其自己的正常登入資訊（電子郵件/密碼、Google 等 — 請參閱 [Authentication](/docs/authentication)）。 Dispatch 只是一個一般的 Agent-Native 應用程式；它沒有執行特殊的驗證模式。

3. **調度→應用程式（簽名身分權杖）。**調度根據嚴格的允許清單驗證`redirect_uri`，並302重新導向回應用程式的`redirect_uri`，攜帶短暫的**`A2A_SECRET`簽名身分 JWT**。權杖的聲明故意最小化：

   | 聲明         | 含義                                        |
   | ------------ | ------------------------------------------- |
   | `sub`        | 身分機構的穩定使用者ID                      |
   | `email`      | 使用者的**已驗證**電子郵件 - 唯一的加入金鑰 |
   | `name`       | 顯示名稱（非權威，僅適用於 UI）             |
   | `org_domain` | 工作空間/組織域（如果存在）                 |
   | `scope`      | 始終為 `"identity"` — 此權杖僅授權登入      |
   | `exp`        | **≤ 2 分鐘** 距問題                         |

4. **應用程式透過電子郵件驗證和 JIT 連結。**應用程式使用自己的 `A2A_SECRET` 驗證權杖簽名，檢查 `scope: "identity"` 和 `exp`，然後嚴格透過經過驗證的電子郵件執行**即時連結**：
   - 如果具有該電子郵件地址的本機使用者存在 → 不加修改地重新使用它。
   - 如果沒有 → 為該電子郵件建立本機使用者。

5. **應用程式建立一個普通的本機工作階段。**從這裡開始，使用者在該應用程式自己的商店中擁有一個普通的本機工作階段 - 每個現有的存取檢查、組織範圍和操作防護都與以前完全相同。聯邦只發生在前門。

### 選取加入 {#opt-in}

應用**僅**在其部署中設定此環境變數時參與：

```bash
AGENT_NATIVE_IDENTITY_HUB_URL=https://dispatch.agent-native.com
```

- **設定** → 應用程式顯示執行上述流程的**“使用 Agent-Native 登入”**選項。直接本機登入（電子郵件/密碼、Google）仍然可以與它一起使用。
- **取消設定（預設）** → **零行為改變。** 應用程式的驗證與之前完全相同；聯合程式碼路徑處於休眠狀態。沒有架構更改，也沒有任何需要遷移的內容，因此開啟或關閉變數在任何時候都是完全可逆的。

## 安全 {#security}

整個模型依賴於一些故意的小保證：

- **短暫的簽名權杖。**身分斷言是 `A2A_SECRET` 簽名的 JWT，具有 **≤ 2 分鐘** 到期時間和 `scope: "identity"`。它授權單次登入，並且不能長時間重播或重新用於 API/A2A 存取。
- **嚴格的 `redirect_uri` 允許清單。** 預設情況下，調度僅重新導向到 `*.agent-native.com` 或本機主機。任意、方案相關 (`//host`) 和跨域重新導向目標都會被拒絕，因此權限無法轉變為開放重新導向或權杖滲透預言機。
- **從經過驗證的權杖僅透過電子郵件加入。** 跨越信任邊界的*唯一*事物是簽名權杖中經過驗證的電子郵件。該應用程式不接受來自線路的使用者 ID、角色、組織成員資格或任何特權狀態 - 它從匹配的帳戶在本機派生所有內容。
- **僅新增身分寫入。**連結可以不受影響地重複使用現有的同一電子郵件帳戶，也可以插入一個新帳戶。此路徑上不會發生任何身分行的更新、重新命名、重新指向或刪除。
- **預設情況下關閉。**如果取消設定 `AGENT_NATIVE_IDENTITY_HUB_URL`，則整個功能將處於惰性狀態。

```an-callout
{
  "tone": "success",
  "body": "**啟用安全，恢復安全。**身分寫入**僅可新增**- 現有的同一電子郵件帳戶將不受影響地重複使用，而新電子郵件只需插入新行。沒有架構更改，也沒有任何需要遷移的內容，因此每個應用程式都可以隨時完全可逆地開啟或關閉 `AGENT_NATIVE_IDENTITY_HUB_URL`。"
}
```

即時連結是完全基於經過驗證的電子郵件的單一決策：

```an-diagram title="JIT-link 決定" summary="連結以經過驗證的電子郵件為關鍵，並且僅是附加的 - 現有帳戶不變地重複使用，新電子郵件建立新的本機使用者。"
{
  "html": "<div class=\"diagram-jit\"><div class=\"diagram-node\" data-rough>已驗證信箱<br><small class=\"diagram-muted\">來自已簽名身分 JWT</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-branch\"><div class=\"diagram-box\" data-rough>Local user exists?<span class=\"diagram-pill ok\">yes &rarr; reuse unchanged</span><span class=\"diagram-pill accent\">no &rarr; create local user</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>簽發普通本機工作階段</div></div></div>",
  "css": ".diagram-jit{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-jit .diagram-node{display:flex;flex-direction:column;gap:4px;padding:12px 14px}.diagram-jit .diagram-branch{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-jit .diagram-box{display:flex;flex-direction:column;gap:6px;padding:12px 14px}.diagram-jit .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 自託管 {#self-hosting}

任何 Dispatch 部署都可以充當身分中心 - 您不限於 `dispatch.agent-native.com`。在每個用戶端應用程式上設定 `AGENT_NATIVE_IDENTITY_HUB_URL` 以指向您的 Dispatch 執行個體：

```bash
AGENT_NATIVE_IDENTITY_HUB_URL=https://dispatch.yourcompany.com
```

**重新導向允許清單。** 集線器（調度）在發出權杖之前驗證授權端點上的 `redirect_uri`。允許名單在`templates/dispatch/server/lib/identity-sso.ts`中設定：

- **預設值：** 僅 `*.agent-native.com` 和 localhost（`DEFAULT_ALLOWED_HOST_SUFFIXES` 常量）。
- **擴充功能它：**在 Dispatch 部署上設定 `IDENTITY_SSO_ALLOWED_HOST_SUFFIXES` 環境變數，並使用逗號分隔的其他主機後綴清單：

  ```bash
  # 除預設值外還允許 yourcompany.com 子域
  IDENTITY_SSO_ALLOWED_HOST_SUFFIXES=".yourcompany.com,.staging.yourcompany.com"
  ```

  每個條目都被標準化為點前綴後綴 (`.yourcompany.com`)，因此後綴檢查既足夠又最不容易發生 — 無需按應用程式清單保持同步。與所有內容匹配的條目（空或只是 `.`）將被過濾掉。

- 無論 `IDENTITY_SSO_ALLOWED_HOST_SUFFIXES` 為何，**Localhost** 始終允許本機開發用戶端應用程式。

如果沒有 `IDENTITY_SSO_ALLOWED_HOST_SUFFIXES`，自託管 Dispatch 只能向 `*.agent-native.com` 上的應用程式頒發權杖。在 Dispatch 部署上設定環境變數以解鎖其他域。

## 金絲雀推出執行手冊 {#canary-rollout}

切換和回滾是**每個應用程式部署的單一環境變數**。一次推出一個應用程式，驗證，然後擴充功能。不要同時在每個應用程式上設定變數。

**1。部署程式碼——沒有行為改變。**
使用 `AGENT_NATIVE_IDENTITY_HUB_URL` **將版本發布到每個應用程式**到處都未設定\*\*。確認正常登入在幾個應用程式上仍然有效。

**2。一次在 ONE 應用程式上啟用金絲雀。**
僅在一次部署上設定：

```bash
AGENT_NATIVE_IDENTITY_HUB_URL=https://dispatch.agent-native.com
```

保留所有其他應用程式的環境未設定。重新部署/重新啟動，以便它取得變數。

**3。驗證金絲雀（清單）。**

- 登出應用程式。
- 登入螢幕現在顯示**“使用 Agent-Native 登入”**。點選它。
- 您將進入 **Dispatch** 並完成登入（如果已經登入，則直接透過）。
- 您將被重新導向**返回應用程式並登入** — 並且它是您之前擁有的**相同的現有帳戶**（同一電子郵件），而不是新帳戶。
- **應用資料完好無損** — 您的現有紀錄、設定和組織範圍與原來完全相同。
- **現有的直接登入仍然有效** - 電子郵件/密碼和 Google 登入繼續與 SSO 一起使用。

如果任何檢查失敗，請直接進入步驟 4（回滾）——這是即時且資料安全的。

**4。逐個應用程式展開。**
驗證一個應用程式後，對下一個應用程式重複步驟 2-3 - 一次在一個部署上設定 `AGENT_NATIVE_IDENTITY_HUB_URL`。切勿批量啟用。

**5。回滾 = 取消設定該應用程式部署上的環境變數。**
要恢復任何應用程式，**從該應用程式的環境中刪除 `AGENT_NATIVE_IDENTITY_HUB_URL` 並重新部署/重新啟動它。**應用程式立即返回到其之前的驗證行為。 **沒有資料更改可以復原** - 僅新增了識別行，取消設定變數只會使聯合路徑再次休眠。每個應用的割接和回滾都是獨立且可逆的。

> 啟用每個應用程式時，Rollout 會將使用者登出（他們透過 Dispatch 重新進行驗證），但他們始終會重新登入到**相同的電子郵件匹配帳戶，並且資料完好無損**，因為身分行永遠不會被銷毀或重新命名 - 只是新增。

## 相關 {#related}

- [Authentication](/docs/authentication) — 本機驗證模式、工作階段、組織、`A2A_SECRET` 環境變數。
- [A2A Protocol](/docs/a2a-protocol) — 已簽名的 JWT，它重用的邊界驗證信任模型。
- [External Agents](/docs/external-agents) — 應用於代理連線和深層連結的相同 `A2A_SECRET` 簽名身分模式。
- [Dispatch](/docs/dispatch) — 工作區身分授權和路由中心。
- [Security & Data Scoping](/docs/security) - 僅附加資料寫入和每個帳戶範圍。
- [Multi-App Workspaces](/docs/multi-app-workspace) — 統一的單來源部署，完全避免跨域 SSO。
