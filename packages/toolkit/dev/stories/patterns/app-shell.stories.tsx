import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconHome, IconSettings } from "@tabler/icons-react";

import {
  AppShell,
  AppShellAgent,
  AppShellCanvas,
  SidebarToggle,
} from "../../../src/ui/base-ui/app-shell.js";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "../../../src/ui/base-ui/navigation-menu.js";
import {
  PageHeader,
  PageHeaderTitle,
} from "../../../src/ui/base-ui/page-header.js";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
} from "../../../src/ui/base-ui/sidebar.js";

const meta = {
  title: "Patterns/App Shell",
  component: AppShell,
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

function Shell({ collapsed }: { collapsed?: boolean }) {
  return (
    <div style={{ height: 560 }}>
      <AppShell defaultSidebarCollapsed={collapsed}>
        <Sidebar aria-label="App name">
          <SidebarContent>
            <NavigationMenu orientation="vertical" aria-label="App name">
              <NavigationMenuList>
                <NavigationMenuItem>
                  <NavigationMenuLink
                    leading={<IconHome />}
                    active
                    href="#home"
                  >
                    Home
                  </NavigationMenuLink>
                </NavigationMenuItem>
                <NavigationMenuItem>
                  <NavigationMenuLink
                    leading={<IconSettings />}
                    href="#settings"
                  >
                    Settings
                  </NavigationMenuLink>
                </NavigationMenuItem>
              </NavigationMenuList>
            </NavigationMenu>
          </SidebarContent>
          <SidebarFooter>
            <SidebarToggle aria-label="Sidebar" size="4" />
          </SidebarFooter>
        </Sidebar>
        <AppShellCanvas>
          <PageHeader>
            <SidebarToggle aria-label="Menu" mobileOnly />
            <PageHeaderTitle>Home</PageHeaderTitle>
          </PageHeader>
        </AppShellCanvas>
        <AppShellAgent aria-label="Agent" />
      </AppShell>
    </div>
  );
}

/** The three regions: the sidebar, the canvas, and the agent beside them. */
export const Default: StoryObj = { render: () => <Shell /> };

/** The sidebar collapsed to its icon rail. */
export const Collapsed: StoryObj = { render: () => <Shell collapsed /> };
