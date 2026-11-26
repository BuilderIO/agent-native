Use `AppShell` for an application with persistent navigation and a primary work area. Place `Sidebar` and `AppShellCanvas` directly inside it. Add `AppShellAgent` when a second panel needs its own place alongside the canvas.

Desktop rail collapse and mobile drawer visibility have separate lifecycles. Use `defaultSidebarCollapsed` for an initial desktop preference, or `sidebarCollapsed` with `onSidebarCollapsedChange` to keep it in application state. Control the mobile drawer with `sidebarOpen` and `onSidebarOpenChange`. The shell evaluates `mobileQuery` in its own window. Widening an open drawer to desktop requests a close through `onSidebarOpenChange` and moves focus to the desktop sidebar if its focused control was removed.

Place a named `SidebarToggle` in the rail and another with `mobileOnly` in the canvas header. This keeps an opener reachable when the drawer is closed. The scoped examples exercise tooltip and drawer placement when a shell has its own theme.

```tsx
import {
  AppShell,
  AppShellCanvas,
} from "@agent-native/toolkit/ui/base-ui/app-shell";

<AppShell sidebarCollapsed={collapsed} onSidebarCollapsedChange={setCollapsed}>
  {sidebar}
  <AppShellCanvas>{page}</AppShellCanvas>
</AppShell>;
```

See [Sidebar](?path=/docs/patterns-sidebar--docs) for arranging the brand, navigation and footer inside the rail.
