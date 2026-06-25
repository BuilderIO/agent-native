---
title: "路由"
description: "使用 React Router v8 为代理本机应用程序提供基于文件的路由 - 页面、动态参数和导航。"
---

# 路由

代理本机应用程序使用 **React Router v8** 以及通过来自 `@react-router/fs-routes` 的 `flatRoutes()` 的基于文件的路由。 `app/routes/` 中的每个文件都会变成 URL。模板使用点符号约定 - 点在单个文件名内分隔 URL 段。

## 基于文件的路由 {#file-based-routing}

### 文件→URL映射

| 文件                  | URL                | 注释                          |
| --------------------- | ------------------ | ----------------------------- |
| `_index.tsx`          | `/`                | 索引路线                      |
| `settings.tsx`        | `/settings`        | 简单页面                      |
| `inbox.$threadId.tsx` | `/inbox/:threadId` | 点 = `/`，`$` = 动态参数      |
| `_app.tsx`            | （无 URL 段）      | 无路径布局 - 前缀为 `_`       |
| `inbox/route.tsx`     | `/inbox`           | 文件夹形式——`route.tsx`为索引 |

为动态参数添加 `$` 前缀。以 `_` 为前缀，使其成为无路径布局路线（无 URL 段）。模板使用 `flatRoutes()` — 上面的点符号文件是主要的；嵌套文件夹形式 `inbox/route.tsx` 也适用。

```an-diagram title="无路径布局包裹页面" summary="_app.tsx 布局（无 URL 段）渲染共享 shell 一次；匹配的页面在其 <Outlet/> 内呈现，因此代理侧边栏永远不会在导航时重新安装。"
{
"html": "<div class=\"diagram-layout\" data-rough><div class=\"diagram-shell\"><span class=\"diagram-pill accent\">_app.tsx</span><small class=\"diagram-muted\">无路径布局 · 持久外壳 + Agent 侧边栏</small><div class=\"diagram-outlet\" data-rough><small class=\"diagram-muted\">&lt;Outlet/&gt; — the matched page</small><div class=\"diagram-row\"><span class=\"diagram-pill\">_index.tsx &rarr; /</span><span class=\"diagram-pill\">settings.tsx &rarr; /settings</span><span class=\"diagram-pill\">inbox.$threadId.tsx &rarr; /inbox/:threadId</span></div></div></div></div>",
"css": ".diagram-layout .diagram-shell{display:flex;flex-direction:column;gap:8px;padding:16px}.diagram-layout .diagram-outlet{display:flex;flex-direction:column;gap:8px;padding:14px;margin-top:6px}.diagram-layout .diagram-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}"
}

```

## 添加新页面 {#adding-a-page}

创建文件并导出默认组件：

```tsx
// app/routes/settings.tsx
export function meta() {
  return [{ title: "Settings" }];
}

export default function SettingsPage() {
  return <div>Settings</div>;
}
```

就是这样 - React 路由器会自动选择它，无需注册。

## 动态参数 {#dynamic-params}

```tsx
// app/routes/inbox/$threadId.tsx
import { useParams } from "react-router";

export default function ThreadPage() {
  const { threadId } = useParams();
  return <div>Thread: {threadId}</div>;
}
```

## 导航 {#navigation}

使用 `<Link>` 进行客户端导航，使用 `useNavigate()` 进行编程导航：

```tsx
import { Link, useNavigate } from "react-router";

// In JSX
<Link to="/settings">Settings</Link>;

// Programmatic
const navigate = useNavigate();
navigate(`/inbox/${threadId}`);
```

## 下一步是什么

- [**Client**](/docs/client) - 代理本机浏览器挂钩和实用程序
- [**Server**](/docs/server) — 基于文件的服务器路由和 `/_agent-native/` 命名空间
