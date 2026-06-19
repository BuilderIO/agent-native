---
title: "Routing"
description: "File-based routing for agent-native apps with React Router v7 — pages, dynamic params, and navigation."
---

# Routing

Agent-native apps use **React Router v7** with file-based routing via `flatRoutes()` from `@react-router/fs-routes`. Every file in `app/routes/` becomes a URL. Templates use the dot-notation convention — dots separate URL segments inside a single filename.

## File-Based Routing {#file-based-routing}

### File → URL mapping

| File                  | URL                | Notes                                  |
| --------------------- | ------------------ | -------------------------------------- |
| `_index.tsx`          | `/`                | Index route                            |
| `settings.tsx`        | `/settings`        | Simple page                            |
| `inbox.$threadId.tsx` | `/inbox/:threadId` | Dot = `/`, `$` = dynamic param         |
| `_app.tsx`            | (no URL segment)   | Pathless layout — prefix with `_`      |
| `inbox/route.tsx`     | `/inbox`           | Folder form — `route.tsx` is the index |

Prefix a segment with `$` for a dynamic param. Prefix with `_` to make it a pathless layout route (no URL segment). Templates use `flatRoutes()` — the dot-notation file above is primary; the nested-folder form `inbox/route.tsx` also works.

## Adding a new page {#adding-a-page}

Create the file and export a default component:

```tsx
// app/routes/settings.tsx
export function meta() {
  return [{ title: "Settings" }];
}

export default function SettingsPage() {
  return <div>Settings</div>;
}
```

That's it — React Router picks it up automatically, no registration needed.

## Dynamic params {#dynamic-params}

```tsx
// app/routes/inbox/$threadId.tsx
import { useParams } from "react-router";

export default function ThreadPage() {
  const { threadId } = useParams();
  return <div>Thread: {threadId}</div>;
}
```

## Navigation {#navigation}

Use `<Link>` for client-side navigation and `useNavigate()` for programmatic navigation:

```tsx
import { Link, useNavigate } from "react-router";

// In JSX
<Link to="/settings">Settings</Link>;

// Programmatic
const navigate = useNavigate();
navigate(`/inbox/${threadId}`);
```

## What's next

- [**Client**](/docs/client) — the agent-native browser hooks and utilities
- [**Server**](/docs/server) — file-based server routes and the `/_agent-native/` namespace
