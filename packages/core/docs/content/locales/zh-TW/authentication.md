---
title: "驗證"
description: "與電子郵件/密碼、社交提供者、組織和 MCP 持有者憑證更好的驗證整合。"
---

# 驗證

Agent-Native 應用程式使用 [Better Auth](https://better-auth.com) 進行帳戶優先設計的驗證。使用者在第一次存取時建立一個帳戶，並從第一天起就獲得真實身分。

## 概述 {#overview}

Auth 是透過 auth 伺服器外掛中的 `autoMountAuth(app)` 自動設定的。共有三種模式：

- **預設：**使用電子郵件/密碼+社交提供者進行更好的驗證。首次存取時顯示的入門頁面。
- **遠端 MCP OAuth：** 適用於 MCP 主機的標準 OAuth 2.1，例如 Claude 程式碼和 ChatGPT 連線器。
- **自訂：**透過 `getSession` 回調帶來您自己的驗證。

```an-diagram title="三種方式，一次會議" summary="瀏覽器訪客、程式化 MCP 用戶端和自訂提供者都解析為下游作用域讀取的同一 AuthSession。"
{
  "html": "<div class=\"auth-modes\"><div class=\"diagram-col\"><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Default</span><strong>Better Auth</strong><small class=\"diagram-muted\">email/password &middot; Google &middot; GitHub</small></div><div class=\"diagram-card\"><span class=\"diagram-pill\">Remote MCP OAuth</span><strong>OAuth 2.1 + PKCE</strong><small class=\"diagram-muted\">Claude Code、ChatGPT 連線器</small></div><div class=\"diagram-card\"><span class=\"diagram-pill\">Custom</span><strong>getSession callback</strong><small class=\"diagram-muted\">Clerk &middot; Auth0 &middot; Firebase</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill ok\">AuthSession</span><small class=\"diagram-muted\">email &middot; orgId &middot; orgRole</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">Request context &amp; data scoping</div></div>",
  "css": ".auth-modes{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.auth-modes .diagram-col{display:flex;flex-direction:column;gap:10px}.auth-modes .diagram-card{display:flex;flex-direction:column;gap:4px;padding:10px 12px}.auth-modes .diagram-arrow{font-size:22px;line-height:1}.auth-modes .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

瀏覽器流程在任何地方都是相同的更好的驗證流程 - **沒有開發驗證繞過**，並且 `getSession()` 永遠不會退回到 `local@localhost` 哨兵。環境之間的變化是註冊摩擦，而不是登入牆：

| 環境              | 首次載入行為                                           | 電子郵件驗證                               |
| ----------------- | ------------------------------------------------------ | ------------------------------------------ |
| **本機開發**      | 自動建立一次性開發帳戶並讓您登入（無登入牆）           | 預設跳過（當沒有電子郵件提供者時）         |
| **品質檢查/預覽** | 正常註冊，但可以跳過驗證，因此測試人員無需等待電子郵件 | 使用 `AUTH_SKIP_EMAIL_VERIFICATION=1` 跳過 |
| **正式環境**      | 正常更好的驗證註冊/登入                                | 必需（設定電子郵件提供者時）               |

一些標誌對此進行了調整；完整詳細資訊位於 [Environment Variables](#environment-variables) 表中：

- `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT=1` — 使用本機開發中的普通註冊頁面而不是自動開發帳戶。
- `AUTH_DISABLED=true` — 完全跳過登入/註冊，並以一個共用使用者身分執行每個請求（僅限本機開發/預覽/示範，切勿與真實使用者一起進行正式環境）。
- `AUTH_MODE=local` — 僅影響 CLI/代理身分（開發使用者 `pnpm action` 執行時的身分）；它**不是**瀏覽器登入繞過。

```an-callout
{
  "tone": "warning",
  "body": "`AUTH_DISABLED=true` runs **every request as one shared user**. Use it only for local dev, previews, or demos — never in production with real users, where it would expose all data to anyone."
}
```

## 更好的驗證（預設） {#better-auth}

預設情況下，Better Auth 支援驗證。它提供：

- 電子郵件/密碼註冊和登入
- 社交提供者（Google、GitHub 和 35 多個其他提供者）
- 具有角色和邀請的組織
- 用於 API 和 A2A 存取的 JWT 權杖
- 對程式化用戶端的不記名權杖支援

Better Auth 路由安裝在 `/_agent-native/auth/ba/*`。此框架還提供向後相容的端點：

- `GET /_agent-native/auth/session` — 取得目前工作階段
- `POST /_agent-native/auth/login` — 電子郵件/密碼登入
- `POST /_agent-native/auth/register` — 建立帳戶
- `POST /_agent-native/auth/logout` — 退出

## Cookie 領域 {#cookie-realms}

工作階段 cookie 的領域遵循部署形狀，因此共用的應用程式
資料庫/來源共用登入和不保持隔離的應用：

| 部署形狀                                 | Cookie 領域                                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 獨立應用                                 | 透過 slug（`APP_NAME`，或本機開發中的包名稱）隔離每個應用程式；正式環境中穩定的 `an` 前綴                        |
| 工作區模式（`AGENT_NATIVE_WORKSPACE=1`） | 一個共用領域 - 工作區應用程式共用來源和資料庫                                                                    |
| 自訂同資料庫子域                         | 選取與 `COOKIE_DOMAIN` 共用 Cookie                                                                               |
| 第一方託管 (`*.agent-native.com`)        | 每個應用程式的獨立命名空間（每個應用程式都有自己的驗證資料庫）；預設情況下忽略 `COOKIE_DOMAIN=.agent-native.com` |

第一方託管應用程式都有自己的驗證資料庫，因此可以跨應用程式登入
透過 [Cross-App SSO](/docs/cross-app-sso) 而不是共用 cookie。
這些部署必須提供 `APP_NAME` 或可派生應用 URL（`APP_URL`、`URL`，
`DEPLOY_PRIME_URL`，或`DEPLOY_URL`）；否則啟動失敗而不是下降
返回共用的 `an_session` 名稱。有意共用一個驗證資料庫
跨子域，將 `AGENT_NATIVE_SHARE_COOKIE_DOMAIN=1` 並排設定
`COOKIE_DOMAIN`.

## 品質檢查帳戶 {#qa-accounts}

本機開發和測試預設跳過註冊電子郵件驗證，因此您
可以建立真實的電子郵件/密碼帳戶，而無需等待收件箱。強制
在測試該流程時進行本機驗證，設定 `AUTH_SKIP_EMAIL_VERIFICATION=0`。

對於測試人員需要真實帳戶但不應等待的託管 QA 環境
在電子郵件傳送時，設定：

```bash
AUTH_SKIP_EMAIL_VERIFICATION=1
```

設定此標誌後，電子郵件/密碼註冊不需要電子郵件
驗證和註冊驗證電子郵件未傳送。僅將其用於品質檢查
或預覽環境，並使用 `+qa` 地址命名測試帳戶
(`name+qa@example.com`)，因此很容易識別。

## 社交提供者 {#social-providers}

設定環境變數以啟用社交登入。 Better Auth 自動偵測它們：

```bash
# GoogleOAuth
GOOGLE_SIGN_IN_CLIENT_ID=your-low-scope-sign-in-client-id
GOOGLE_SIGN_IN_CLIENT_SECRET=your-low-scope-sign-in-client-secret

# 向後相容的回退以及範本的提供者 OAuth 憑證
# 連線到 Google APIs，例如 Gmail 或行事曆。
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret

# GitHub OAuth
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
```

使用 `createGoogleAuthPlugin()` 的範本顯示“使用 Google 登入”頁面。 GoogleOAuth 回呼自動處理本機應用的行動深度連結。

普通情況下優先選取 `GOOGLE_SIGN_IN_CLIENT_ID` / `GOOGLE_SIGN_IN_CLIENT_SECRET`
應用程式登入。該用戶端應該僅請求身分範圍。保留
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 適用於需要的產品整合
Google API 範圍，或作為部署未拆分時的舊後備
還沒有。郵件和行事曆樣式的應用程式應該使用自己的提供者 OAuth 用戶端，因此
高範圍同意螢幕不會影響通用應用登入。

### OAuth 狀態簽名 {#oauth-state-secret}

在正式環境中將 `OAUTH_STATE_SECRET` 設定為隨機的 32+ 字符值，以便 OAuth 狀態信封（Google、Atlassian、Zoom）使用獨立於任何第三方機密的專用金鑰進行 HMAC 簽名。請參閱 [Security — OAuth State Signing](/docs/security#oauth-state) 了解完整的要求和威脅模型。

## 組織 {#organizations}

此框架提供了內建的組織系統。這是框架自己的 `org/` 模組（由 `organizations` 和 `org_members` 表支援），而不是 Better Auth 的組織外掛，該外掛故意未註冊。每個應用程式都支援：

- 建立組織
- 邀請具有角色的成員（`owner`、`admin`、`member`）
- 切換活動組織
- 透過 `org_id` 列確定每個組織的資料範圍

活動組織在工作階段中被跟蹤為 `session.orgId`，切換組織會更改使用者和代理看到的資料。資料作用域本身發生在堆堆疊的更下方——有關完整的 `session.orgId → AGENT_ORG_ID → SQL` 管道和存取防護，請參閱 [Security & Data Scoping](/docs/security#data-scoping)。 [Multi-Tenancy](/docs/multi-tenancy) 檔案涵蓋了組織管理層面。

## 靜態 MCP 不記名權杖 {#access-tokens}

`ACCESS_TOKEN` 和 `ACCESS_TOKENS` 不是瀏覽器驗證，並且不會將應用程式設為私人。它們僅保留為無法使用 OAuth 流的 MCP/連線用戶端的靜態承載憑證。

```bash
# 單一代幣
ACCESS_TOKEN=my-secret-token

# 多個代幣
ACCESS_TOKENS=token1,token2,token3
```

設定這些變數永遠不會為訪客呈現權杖登入頁面。 Web 登入保留在 Better Auth 或您的自訂 `getSession` 提供者上。

## 遠端 MCP OAuth {#remote-mcp-oauth}

每個應用程式的 MCP 端點都可以充當標準受保護的 MCP 資源。支援 OAuth 的用戶端只能設定遠端 MCP URL：

```text
https://mail.agent-native.com/_agent-native/mcp
```

未經驗證的 MCP 請求返回指向 `/.well-known/oauth-protected-resource` 的 `WWW-Authenticate` 質詢。然後，用戶端發現應用程式的 OAuth 中繼資料，動態註冊公開用戶端，開啟應用程式的授權頁面，並與 PKCE 交換授權程式碼以取得存取和重新整理權杖。

```an-diagram title="遠端 MCP OAuth 握手" summary="具有 OAuth 功能的用戶端僅從 MCP URL 引導 — 質詢、發現、動態註冊，然後是 PKCE 程式碼交換。"
{
  "html": "<div class=\"mcp-flow\"><div class=\"diagram-node\">1 &middot; MCP request<br><small class=\"diagram-muted\">no token</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node warn\">2 &middot; 401 challenge<br><small class=\"diagram-muted\">WWW-Authenticate</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">3 &middot; Discover metadata<br><small class=\"diagram-muted\">.well-known</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">4 &middot; Register client<br><small class=\"diagram-muted\">動態、公開</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">5 &middot; Authorize + PKCE<br><small class=\"diagram-muted\">code exchange</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node ok\">6 &middot; Access + refresh<br><small class=\"diagram-muted\">audience-bound</small></div></div>",
  "css": ".mcp-flow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.mcp-flow .diagram-node{display:flex;flex-direction:column;gap:2px;padding:8px 12px}.mcp-flow .diagram-arrow{font-size:20px;line-height:1}"
}
```

設定時存取權杖使用 `A2A_SECRET` 進行簽名，否則使用 `BETTER_AUTH_SECRET` 進行簽名。它們攜帶簽名的使用者/組織身分和 `mcp:read`、`mcp:write` 和/或 `mcp:apps` 範圍，並且受眾綁定到確切的 MCP 資源 URL。重新整理權杖僅儲存為雜湊值並在每次重新整理時輪換。工具呼叫和 MCP Apps 資源讀取在與登入使用者相同的請求脈絡中執行；嵌入式 MCP 應用程式 iframe 永遠不會接收原始 OAuth 權杖。

`npx @agent-native/core@latest connect <url> --client claude-code` 為此標準流程寫入僅 URL 的 MCP 條目。對於無法執行遠端 MCP OAuth 的用戶端，請使用“連線”頁面或 `npx @agent-native/core@latest connect --token <token>` 回退來寫入顯式不記名權杖條目。

## 自帶驗證 {#byoa}

傳遞自訂 `getSession` 回調以使用任何驗證提供者（Clerk、Auth0、Firebase 等）：

```ts
// server/plugins/auth.ts
import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  getSession: async (event) => {
    // Your custom auth logic here
    const session = await myAuthProvider.verify(event);
    if (!session) return null;
    return { email: session.email };
  },
  publicPaths: ["/api/webhooks"],
});
```

## 公開工作區應用 {#public-workspace-apps}

工作區應用程式預設為內部應用程式。讓匿名訪客載入公開
站點同時將管理頁面保留在驗證之後，在
`apps/<id>/package.json`:

```json
{
  "agent-native": {
    "workspaceApp": {
      "audience": "public",
      "protectedPaths": ["/admin"]
    }
  }
}
```

對於相反的形狀，保留預設的內部受眾並僅公開
特定公開頁面：

```json
{
  "agent-native": {
    "workspaceApp": {
      "publicPaths": ["/", "/share"]
    }
  }
}
```

`publicPaths`和`protectedPaths`使用前綴匹配，所以`"/admin"`也
覆蓋 `"/admin/users"`。這些設定僅開啟頁面導覽。框架
路由（`/_agent-native/*`）和自訂 API 路由（`/api/*`）仍然需要驗證
除非應用明確新增這些前綴
`createAuthPlugin({ publicPaths: [...] })`.

## 工作階段 API {#session-api}

`getSession(event)` 返回的工作階段物件具有以下形狀：

```ts
interface AuthSession {
  email: string; // User's email (primary identifier)
  userId?: string; // Better Auth user ID
  token?: string; // Session token
  name?: string; // Display name from the auth provider, when available
  image?: string; // Profile image from the auth provider, when available
  orgId?: string; // Active organization ID
  orgRole?: string; // Role in active org (owner/admin/member)
}
```

在用戶端上，使用 `useSession()` 掛鉤：

```ts
import { useSession } from "@agent-native/core/client";

function MyComponent() {
  const { session, isLoading } = useSession();
  if (isLoading) return <p>Loading...</p>;
  if (!session) return <p>Not signed in</p>;
  return <p>Hello, {session.email}</p>;
}
```

## 登入並傳回 URL {#sign-in-return-url}

具有**公開頁面**（共用連結、嵌入、行銷頁面）的範本通常需要一個頁面內 CTA 來要求匿名檢視者登入並將他們帶回到他們所在的頁面。此框架為此提供了一個入口點：

```
/_agent-native/sign-in?return=<same-origin-path>
```

當匿名檢視者點選此 URL 時，將提供框架的登入頁面。成功登入（任何流程 - 權杖、電子郵件/密碼或 GoogleOAuth）後，檢視者將 302 轉至 `return`。

`return` 參數被驗證為**同來源路徑**。網路路徑引用 (`//evil.com/...`)、絕對 URL、`data:` / `javascript:` 方案和嵌入式控制字符都回退到 `/`。驗證的路徑是從 URL 解析器重建的，而不是從輸入中回顯。

**來自 React 元件：**

```tsx
import { Button } from "@/components/ui/button";

function SignInCta() {
  const onClick = () => {
    const ret = window.location.pathname + window.location.search;
    window.location.href =
      "/_agent-native/sign-in?return=" + encodeURIComponent(ret);
  };
  return <Button onClick={onClick}>Sign in</Button>;
}
```

### 已新增書簽的私人路徑

當匿名使用者直接導覽到 `/dashboard` 等私人路徑時，框架已經在該 URL 處提供登入頁面 - 成功登入後，頁面重新載入並且使用者登陸 `/dashboard`。無需特殊處理；這適用於權杖、電子郵件/密碼、**和** GoogleOAuth。

### 幕後花絮：GoogleOAuth

兩個流（顯式 `/_agent-native/sign-in` 入口點和書簽路徑情況）都將傳回 URL 對話串穿過 OAuth 狀態。該狀態是 HMAC 簽名的，因此在運輸過程中無法偽造。在回調中，返回的 URL 在重新導向之前被重新驗證為同來源 - 因此泄漏的簽名金鑰仍然無法轉換為開放重新導向預言機。

如果您的範本直接包裝 `/_agent-native/google/auth-url`（例如郵件和行事曆範本這樣做，以擴大範圍），則接受 `?return=<path>` 查詢並透過 `encodeOAuthState` 的選項物件形式轉發它：

```ts
const returnUrl = getQuery(event).return;
const state = encodeOAuthState({
  redirectUri,
  desktop,
  returnUrl: typeof returnUrl === "string" ? returnUrl : undefined,
});
```

預設的 `/_agent-native/google/auth-url` 路由會自動執行此操作 - 僅當您的範本需要自訂 OAuth 處理時才覆蓋。

## 環境變數 {#environment-variables}

| 變數                                    | 目的                                                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                    | 更好的驗證簽名金鑰（如果未設定，則自動生成）                                                                         |
| `AUTH_SKIP_EMAIL_VERIFICATION`          | 在 QA/預覽環境中設定為 `1`，讓電子郵件/密碼註冊無需驗證即可繼續進行；預設情況下跳過本機開發/測試                     |
| `AUTH_DISABLED`                         | 設定為`true`或`1`跳過登入/註冊；所有請求都作為一個共用使用者執行（僅限本機開發/預覽 - 不適用於真實使用者的正式環境） |
| `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT` | 設定為 `1` 以在新的開發資料庫上停用本機主機自動登入                                                                  |
| `AUTH_MODE`                             | `local` 僅解析 CLI/代理身分（開發使用者 `pnpm action` 作為其執行）；絕不繞過瀏覽器登入                               |
| `COOKIE_DOMAIN`                         | 選取跨同一資料庫子域共用工作階段 Cookie（請參閱 [Cookie Realms](#cookie-realms)）                                    |
| `AGENT_NATIVE_WORKSPACE`                | `1` 在工作區模式下執行 - 跨工作區應用的一個共用工作階段領域                                                          |
| `AGENT_NATIVE_SHARE_COOKIE_DOMAIN`      | 使用 `COOKIE_DOMAIN` 設定以跨第一方子域共用一個驗證資料庫                                                            |
| `OAUTH_STATE_SECRET`                    | 用於 OAuth 狀態包絡的專用 HMAC 金鑰（請參閱 [Security — OAuth State Signing](/docs/security#oauth-state)）           |
| `GOOGLE_SIGN_IN_CLIENT_ID`              | 用於應用登入的首選低範圍 GoogleOAuth 用戶端 ID                                                                       |
| `GOOGLE_SIGN_IN_CLIENT_SECRET`          | 用於應用登入的首選低範圍 GoogleOAuth 金鑰                                                                            |
| `GOOGLE_CLIENT_ID`                      | 舊版 Google 登入回退以及用於 Google API 整合的提供者 OAuth 用戶端 ID                                                 |
| `GOOGLE_CLIENT_SECRET`                  | 舊版 Google 登入回退以及 Google API 整合的提供者 OAuth 金鑰                                                          |
| `GITHUB_CLIENT_ID`                      | 啟用GitHub OAuth                                                                                                     |
| `GITHUB_CLIENT_SECRET`                  | GitHub OAuth 秘密                                                                                                    |
| `ACCESS_TOKEN`                          | MCP/連線用戶端的靜態承載回退；不是瀏覽器驗證                                                                         |
| `ACCESS_TOKENS`                         | MCP/connect 用戶端的逗號分隔靜態承載回退；不是瀏覽器驗證                                                             |
| `A2A_SECRET`                            | JWT 簽名的 A2A 跨應用驗證的共用金鑰，以及 MCP OAuth 存取權杖簽名（如果存在）                                         |
