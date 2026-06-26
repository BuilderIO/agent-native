---
title: "公開代理網路"
description: "使公開路由可爬行、可讀、可引用，並可選取由代理呼叫 - robots.txt、llms.txt、markdown 鏡像、JSON-LD 和公開 MCP 表面。"
---

# 公開代理網路

公開代理網路使公開 Agent-Native 路由易於代理抓取、閱讀、引用和呼叫。目標不是公開每個應用程式端點。目標是為已經公開的頁面發布一個幹淨的公開介面，同時將私人資料和工具存取保留在顯式控制之下。

檔案站點是參考實現。今天發貨：

- `/robots.txt` 的爬蟲策略預設允許檢索但不允許訓練。
- 當來源檔案公開它時，`/sitemap.xml` 具有絕對規範的 URL 和 `lastmod`。
- `/llms.txt` 和 `/llms-full.txt` 用於代理友好的內容發現。
- Markdown 鏡像，例如 `/docs/getting-started.md`。
- 正式環境建置後公開檔案頁面的 `Accept: text/markdown` 回應。
- JSON-LD 用於基礎組織、網站和頁面中繼資料。
- 審核 CLI (`npx @agent-native/core@latest audit-agent-web`)，檢查上述所有內容。

設定 `publicMcp: true` 還會將選取加入的 actions 公開為公開 MCP 端點，允許外部代理直接呼叫它們（請參閱 [MCP Protocol](/docs/mcp-protocol)）。

```an-diagram title="公開路由發布什麼" summary="一條公開路由呈扇形展開，形成對代理友好的代表。讀取路由與呼叫工具是分開的——工具存取保持選取加入。"
{
  "html": "<div class=\"diagram-web\"><div class=\"diagram-box\" data-rough>公開路由<br><small class=\"diagram-muted\">derived from route access settings</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-grid\"><span class=\"diagram-pill\">robots.txt</span><span class=\"diagram-pill\">sitemap.xml</span><span class=\"diagram-pill\">llms.txt</span><span class=\"diagram-pill\">.md mirror</span><span class=\"diagram-pill\">JSON-LD</span><span class=\"diagram-pill\">text/markdown</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col gate\"><span class=\"diagram-pill warn\">工具保持私人</span><small class=\"diagram-muted\">publicMcp + publicAgent.expose required</small></div></div>",
  "css": ".diagram-web{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-web .diagram-arrow{font-size:22px;line-height:1}.diagram-web .diagram-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.diagram-web .gate{display:flex;flex-direction:column;gap:4px;align-items:flex-start}"
}
```

## 設定 {#config}

在現有工作區應用設定下新增 `agentWeb`（在應用的 `package.json` 中的 `agent-native` 鍵下 — 或等效的 `workspace.agentWeb`、`agentWeb` 或 `root.agentWeb`）。公開路由清單仍然來源於應用程式的路由存取設定； `agentWeb` 控制公開表面如何呈現給代理。

```json
{
  "agent-native": {
    "workspaceApp": {
      "audience": "public",
      "protectedPaths": ["/admin/*"],
      "agentWeb": {
        "discoverable": true,
        "markdownTwins": true,
        "llmsTxt": true,
        "jsonLd": true,
        "publicAgentCard": true,
        "publicMcp": false,
        "crawlerPolicy": "discoverable-no-training",
        "crawlers": {
          "training": "disallow",
          "search": "allow",
          "userTriggered": "allow",
          "codingAgents": "allow",
          "autonomousAgents": "allow"
        }
      }
    }
  }
}
```

對於大多數應用程式，請保留預設值。如果應用有公開路由，則預設開啟`discoverable`。預設的爬蟲策略是“可發現，不可訓練”：允許搜尋、使用者觸發檢索、編碼代理、自主瀏覽代理；不允許訓練爬蟲。

## 路由真相來源 {#route-source}

代理 Web 發現遵循路由存取模型：

- 公開應用程式公開除 `protectedPaths` 之外的所有路由。
- 內部應用僅公開 `publicPaths`。
- 代理可以讀取公開共用和表單頁面。
- 提交的私人資料、經過驗證的儀表板和使用者/組織狀態永遠不會僅僅因為附近的頁面是公開的而包含在內。

這使混合應用程式保持自然。表單應用程式可以公開公開表單頁面並保持提交的私密性。內容應用程式可以公開已發布的帖子並保持編輯者的私密性。檔案網站可以公開除管理工具之外的所有內容。

## 公開頁面不是公開工具 {#public-tools}

公開頁面存取和公開工具存取是分開的。路由僅公開意味著代理可以將該路由讀取為 HTML、Markdown、站點地圖條目、llms 條目和結構化資料。

```an-callout
{
  "tone": "warning",
  "body": "**A public page is not a public tool.** Making a route crawlable never exposes an action. Tool access requires an explicit `publicAgent.expose` opt-in on the action *and* `publicMcp: true` on the app."
}
```

要透過公開代理協議公開操作，該操作必須選取加入：

```an-annotated-code title="在公開表面上選取一項安全行動"
{
  "filename": "actions/search-docs.ts",
  "language": "ts",
  "code": "export default defineAction({\n  description: \"搜尋 published docs\",\n  readOnly: true,\n  publicAgent: {\n    expose: true,\n    readOnly: true,\n    requiresAuth: false,\n    isConsequential: false,\n    title: \"搜尋 published docs\",\n  },\n  run: async (args) => {\n    // ...\n  },\n});",
  "annotations": [
    { "lines": "4", "label": "明確選取加入", "note": "Without `publicAgent.expose === true`, the action never appears on any public agent surface — no matter how public its routes are." },
    { "lines": "5-7", "label": "自我描述安全性", "note": "將其標記為唯讀，聲明它是否需要驗證，並標記它是否是重要的。除非策略明確允許，否則公開 MCP 排除 consequential/write 操作。" }
  ]
}
```

`agentWeb.publicMcp` 預設情況下保持 `false`。啟用公開 MCP 時，伺服器應僅公開 actions 和 `publicAgent.expose === true`，並且仍應排除後續或寫入 actions，除非操作和驗證策略明確允許它們。

## 建置時檔案 {#build-time}

`@agent-native/core/agent-web` 中的框架實用程式從一頁面清單生成通用檔案：

```ts
import {
  buildAgentWebStaticFiles,
  normalizeAgentWebConfig,
} from "@agent-native/core/agent-web";

const config = normalizeAgentWebConfig(
  { crawlerPolicy: "discoverable-no-training" },
  { hasPublicRoutes: true },
);

const files = buildAgentWebStaticFiles({
  siteName: "My Agent-Native App",
  siteUrl: "https://example.com",
  description: "Public docs for my app.",
  config,
  pages: [
    {
      path: "/docs",
      title: "Docs",
      description: "Start here.",
      markdown: "# 檔案\n\n從這裡開始。\n",
      markdownPath: "/docs/getting-started.md",
      lastmod: new Date(),
    },
  ],
});
```

Vite 應用可以在正式環境建置期間使用 `@agent-native/core/vite` 中的 `createAgentWebVitePlugin` 將這些檔案寫入 `public`、`dist`、`dist/client`、`dist/server/public` 或 `build/client`。

## 審核網站 {#audit}

對已部署站點或本機正式環境伺服器使用 CLI 審核：

```bash
npx @agent-native/core@latest audit-agent-web --url https://www.agent-native.com
```

審核檢查：

- SSR-可見HTML。
- 規範 URL。
- JSON-LD。
- `robots.txt` 政策和絕對站點地圖 URL。
- 絕對站點地圖條目。
- `/llms.txt` 和 `/llms-full.txt`。
- Markdown 鏡子。
- `Accept: text/markdown`.
- 公開代理檢索使用者代理不會出現意外的 401/403 阻塞。

如果缺少所需的公開表面，審核將以非零值退出。

## 下一步是什麼

- [**Actions**](/docs/actions) — 如何選取 actions 加入公開代理協議
- [**MCP Protocol**](/docs/mcp-protocol) — `publicMcp: true` 啟用的 MCP 表面
- [**Deployment**](/docs/deployment) - 這些靜態檔案在建置期間寫入的位置
