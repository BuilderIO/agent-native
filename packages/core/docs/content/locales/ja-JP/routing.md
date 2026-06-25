---
title: "ルーティング"
description: "React Router v8 を使用したエージェント ネイティブ アプリのファイルベースのルーティング — ページ、動的パラメータ、ナビゲーション。"
---

# ルーティング

エージェント ネイティブ アプリは、`@react-router/fs-routes` から `flatRoutes()` 経由のファイルベースのルーティングで **React Router v8** を使用します。 `app/routes/` 内のすべてのファイルは URL になります。テンプレートはドット表記規則を使用します。つまり、単一のファイル名内の URL セグメントはドットで区切られます。

## ファイルベースのルーティング {#file-based-routing}

### ファイル → URL マッピング

| ファイル              | URL                  | メモ                                            |
| --------------------- | -------------------- | ----------------------------------------------- |
| `_index.tsx`          | `/`                  | インデックスルート                              |
| `settings.tsx`        | `/settings`          | シンプルなページ                                |
| `inbox.$threadId.tsx` | `/inbox/:threadId`   | ドット = `/`、`$` = 動的パラメータ              |
| `_app.tsx`            | (URL セグメントなし) | パスレス レイアウト — `_` のプレフィックス      |
| `inbox/route.tsx`     | `/inbox`             | フォルダー形式 — `route.tsx` はインデックスです |

動的パラメータのセグメントに `$` という接頭辞を付けます。パスレス レイアウト ルート (URL セグメントなし) にするには、`_` というプレフィックスを付けます。テンプレートは `flatRoutes()` を使用します。上記のドット表記ファイルがプライマリです。ネストされたフォルダー形式 `inbox/route.tsx` も機能します。

```an-diagram title="パスレスレイアウトがページを包み込む" summary="_app.tsx レイアウト (URL セグメントなし) は、共有シェルを 1 回レンダリングします。一致したページは <Outlet/> 内でレンダリングされるため、エージェントのサイドバーがナビゲーションに再マウントされることはありません。"
{
"html": "<div class=\"diagram-layout\" data-rough><div class=\"diagram-shell\"><span class=\"diagram-pill accent\">_app.tsx</span><small class=\"diagram-muted\">パスなしレイアウト · 永続シェル + エージェントサイドバー</small><div class=\"diagram-outlet\" data-rough><small class=\"diagram-muted\">&lt;Outlet/&gt; — the matched page</small><div class=\"diagram-row\"><span class=\"diagram-pill\">_index.tsx &rarr; /</span><span class=\"diagram-pill\">settings.tsx &rarr; /settings</span><span class=\"diagram-pill\">inbox.$threadId.tsx &rarr; /inbox/:threadId</span></div></div></div></div>",
"css": ".diagram-layout .diagram-shell{display:flex;flex-direction:column;gap:8px;padding:16px}.diagram-layout .diagram-outlet{display:flex;flex-direction:column;gap:8px;padding:14px;margin-top:6px}.diagram-layout .diagram-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}"
}

```

## 新しいページを追加しています {#adding-a-page}

ファイルを作成し、デフォルトのコンポーネントをエクスポートします。

```tsx
// app/routes/settings.tsx
export function meta() {
  return [{ title: "Settings" }];
}

export default function SettingsPage() {
  return <div>Settings</div>;
}
```

それだけです。React ルーターが自動的にそれを取得します。登録は必要ありません。

## 動的パラメータ {#dynamic-params}

```tsx
// app/routes/inbox/$threadId.tsx
import { useParams } from "react-router";

export default function ThreadPage() {
  const { threadId } = useParams();
  return <div>Thread: {threadId}</div>;
}
```

## ナビゲーション {#navigation}

クライアント側のナビゲーションには `<Link>` を使用し、プログラムによるナビゲーションには `useNavigate()` を使用します。

```tsx
import { Link, useNavigate } from "react-router";

// In JSX
<Link to="/settings">Settings</Link>;

// Programmatic
const navigate = useNavigate();
navigate(`/inbox/${threadId}`);
```

## 次は何ですか

- [**Client**](/docs/client) — エージェントネイティブのブラウザフックとユーティリティ
- [**Server**](/docs/server) — ファイルベースのサーバー ルートと `/_agent-native/` 名前空間
