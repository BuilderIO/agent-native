Use `Sidebar` inside `AppShell` when several destinations should remain reachable across views. Compose `SidebarHeader` for the workspace switcher or brand, `SidebarContent` for navigation and `SidebarFooter` for persistent account or rail actions. The header and footer stay separate from the scrolling list of destinations.

Build destination lists with `NavigationMenu` and `NavigationMenuLink`. Give links real destinations, supply the active state from the current route, and keep an accessible name when only the leading icon is visible. Use named menu triggers for actions on a destination, such as opening a folder menu.

Use `aria-labelledby` to name the sidebar from a visible heading, or supply `aria-label` directly. The mobile dialog uses the same name. [Drawer with a visible heading](?path=/story/patterns-app-shell--labelled-drawer)

The shell owns collapse and drawer state. A `SidebarToggle` can sit in the footer on desktop and in the page header on mobile. Compare Expanded and Collapsed to check that the same destinations and commands remain identifiable in both presentations.

```tsx
import type { ReactNode } from "react";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
} from "@agent-native/toolkit/ui/base-ui/sidebar";

export function WorkspaceSidebar({
  workspaceSwitcher,
  children,
  accountMenu,
}: {
  workspaceSwitcher: ReactNode;
  children: ReactNode;
  accountMenu: ReactNode;
}) {
  return (
    <Sidebar aria-label="Workspace">
      <SidebarHeader>{workspaceSwitcher}</SidebarHeader>
      <SidebarContent>{children}</SidebarContent>
      <SidebarFooter>{accountMenu}</SidebarFooter>
    </Sidebar>
  );
}
```

See [Navigation Menu](?path=/docs/components-navigation-menu--docs) for rendering active destinations and nested lists.
