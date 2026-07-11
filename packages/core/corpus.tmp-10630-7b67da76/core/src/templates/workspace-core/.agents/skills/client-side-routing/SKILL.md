---
name: client-side-routing
description: >-
  How to add routes without remounting the app shell. Use when adding a new
  route, fixing agent sidebar reloads on navigation, or choosing between
  `root.tsx` layout and pathless `_app.tsx` layout patterns.
scope: dev
metadata:
  internal: true
---

# Client-Side Routing

## Rule

All templates are single-page apps using React Router. **Navigation must not remount the app shell.** The agent sidebar, document tree, and any other persistent chrome must survive route changes.

## Why

If the shell unmounts on every navigation, the agent chat reconnects/reloads, destroying in-progress work and hammering the backend.

## Hard Rule

**The app shell (AgentSidebar + any top-level navigation) must be mounted ONCE, above the `<Outlet />`.** Never wrap each page in its own `<AppLayout>` / `<Layout>`. React sees a different component at the outlet position on each nav and unmounts the entire subtree.

## Two Correct Patterns

### 1. All routes need the shell

Mount `<AppLayout>` in `root.tsx` around `<Outlet />`:

```tsx
// app/root.tsx
<AppLayout>
  <Outlet />
</AppLayout>
```

### 2. Mix of protected and public routes

Use a React Router **pathless layout route**:

```
app/routes/
  _app.tsx                  # renders <AppLayout><Outlet /></AppLayout>
  _app._index.tsx           # / → under AppLayout
  _app.settings.tsx         # /settings → under AppLayout
  _app.team.tsx             # /team → under AppLayout
  book.$slug.tsx            # /book/:slug → no layout (public)
  f.$.tsx                   # /f/* → no layout (public form filler)
```

The `_` prefix on `_app.tsx` makes it a **pathless** parent — it contributes the layout but no URL segment. Route files prefixed with `_app.` nest under it and share the layout instance across navigations.

## Anti-Pattern

```tsx
// ❌ BAD — each route wraps its own Layout, causing full remount on every nav
export default function Settings() {
  return (
    <AppLayout>
      <SettingsContent />
    </AppLayout>
  );
}
```

If a page needs per-route data (e.g. sidebar highlighting the active document), derive it inside the layout from `useParams()` / `useLocation()` — don't pass it as a prop through every route file.

## Chat-First Routes

If `/` is a full-page chat such as `AgentChatHome`, keep the app shell mounted
around it when possible so `AgentSidebar` URL sync and route warmup stay active.
If the chat route intentionally lives outside the shell, add a tiny app-owned
prewarm for the routes agents commonly open from that chat. In local dev,
React Router can update the address bar before a cold Vite route chunk commits,
which makes navigation look broken even when the URL is correct.

## Adding a New Route

- **Pattern #1** (AppLayout in `root.tsx`): just render page content — nothing else.
- **Pattern #2** (pathless `_app.tsx`): name the file `_app.<segment>.tsx` for authed routes, or bare `<segment>.tsx` for public routes.

## Related Skills

- `adding-a-feature` — The four-area checklist referencing route layout patterns
- `context-awareness` — Navigation state written on every route change
