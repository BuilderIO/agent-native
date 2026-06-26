---
title: "路由"
description: "使用 React Router v8 為 Agent-Native 應用程式提供基於檔案的路由 - 頁面、動態參數和導覽。"
---

# 路由

Agent-Native 應用程式使用 **React Router v8** 以及透過來自 `@react-router/fs-routes` 的 `flatRoutes()` 的基於檔案的路由。 `app/routes/` 中的每個檔案都會變成 URL。範本使用點符號約定 - 點在單一檔名內分隔 URL 段。

## 基於檔案的路由 {#file-based-routing}

### 檔案→URL 對應

| 檔案                  | URL                | 註解                          |
| --------------------- | ------------------ | ----------------------------- |
| `_index.tsx`          | `/`                | 索引路由                      |
| `settings.tsx`        | `/settings`        | 簡單頁面                      |
| `inbox.$threadId.tsx` | `/inbox/:threadId` | 點 = `/`，`$` = 動態參數      |
| `_app.tsx`            | （無 URL 段）      | 無路徑布局 - 前綴為 `_`       |
| `inbox/route.tsx`     | `/inbox`           | 資料夾形式——`route.tsx`為索引 |

為動態參數新增 `$` 前綴。以 `_` 為前綴，使其成為無路徑布局路由（無 URL 段）。範本使用 `flatRoutes()` — 上面的點符號檔案是主要的；嵌套資料夾形式 `inbox/route.tsx` 也適用。

```an-diagram title="無路徑布局包裹頁面" summary="_app.tsx 布局（無 URL 段）渲染共用 shell 一次；匹配的頁面在其 <Outlet/> 內呈現，因此代理側邊欄永遠不會在導覽時重新安裝。"
{
"html": "<div class=\"diagram-layout\" data-rough><div class=\"diagram-shell\"><span class=\"diagram-pill accent\">_app.tsx</span><small class=\"diagram-muted\">無路徑布局 · 持久外殼 + Agent 側邊欄</small><div class=\"diagram-outlet\" data-rough><small class=\"diagram-muted\">&lt;Outlet/&gt; — the matched page</small><div class=\"diagram-row\"><span class=\"diagram-pill\">_index.tsx &rarr; /</span><span class=\"diagram-pill\">settings.tsx &rarr; /settings</span><span class=\"diagram-pill\">inbox.$threadId.tsx &rarr; /inbox/:threadId</span></div></div></div></div>",
"css": ".diagram-layout .diagram-shell{display:flex;flex-direction:column;gap:8px;padding:16px}.diagram-layout .diagram-outlet{display:flex;flex-direction:column;gap:8px;padding:14px;margin-top:6px}.diagram-layout .diagram-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}"
}

```

## 新增新頁面 {#adding-a-page}

建立檔案並匯出預設元件：

```tsx
// app/routes/settings.tsx
export function meta() {
  return [{ title: "Settings" }];
}

export default function SettingsPage() {
  return <div>Settings</div>;
}
```

就是這樣 - React 路由器會自動選取它，無需註冊。

## 動態參數 {#dynamic-params}

```tsx
// app/routes/inbox/$threadId.tsx
import { useParams } from "react-router";

export default function ThreadPage() {
  const { threadId } = useParams();
  return <div>Thread: {threadId}</div>;
}
```

## 導覽 {#navigation}

使用 `<Link>` 進行用戶端導覽，使用 `useNavigate()` 進行程式化導覽：

```tsx
import { Link, useNavigate } from "react-router";

// In JSX
<Link to="/settings">Settings</Link>;

// Programmatic
const navigate = useNavigate();
navigate(`/inbox/${threadId}`);
```

## 下一步是什麼

- [**Client**](/docs/client) - Agent-Native 瀏覽器掛鉤和實用程式
- [**Server**](/docs/server) — 基於檔案的伺服器路由和 `/_agent-native/` 命名空間
