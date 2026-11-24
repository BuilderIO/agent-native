import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconHome, IconSettings } from "@tabler/icons-react";
import { useId } from "react";
import { expect, waitFor, within } from "storybook/test";

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
import guide from "./app-shell.docs.md?raw";

const meta = {
  title: "Patterns/App Shell",
  component: AppShell,
  parameters: {
    docs: { description: { component: guide } },
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

function Shell({
  collapsed,
  mobileQuery,
}: {
  collapsed?: boolean;
  mobileQuery?: string;
}) {
  return (
    <div style={{ height: 560 }}>
      <AppShell defaultSidebarCollapsed={collapsed} mobileQuery={mobileQuery}>
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
            <SidebarToggle aria-label="Sidebar" size="md" />
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

export const ScopedRailTooltip: StoryObj = {
  render: () => <Shell collapsed mobileQuery="not all" />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const link = canvas.getByRole("link", { name: "Home" });
    await userEvent.tab();
    link.focus();
    const stage = canvasElement.querySelector("[data-storybook-stage]");
    await waitFor(() =>
      expect(stage?.querySelector(".tooltip-popup")).toHaveTextContent("Home"),
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(stage?.querySelector(".tooltip-popup[data-open]")).toBeNull(),
    );
    await expect(link).toHaveFocus();
  },
};

export const ScopedMobileDrawer: StoryObj = {
  render: () => <Shell mobileQuery="all" />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const menu = canvas.getByRole("button", { name: "Menu" });
    menu.focus();
    await userEvent.keyboard("{Enter}");
    const stage = canvasElement.querySelector<HTMLElement>(
      "[data-storybook-stage]",
    );
    if (!stage) throw new Error("Missing themed story stage");
    const dialog = await within(stage).findByRole("dialog", {
      name: "App name",
    });
    await waitFor(() =>
      expect(dialog.contains(dialog.ownerDocument.activeElement)).toBe(true),
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(menu).toHaveFocus());
    await expect(menu).toHaveAttribute("aria-expanded", "false");
  },
};

export const LabelledDrawer: StoryObj = {
  render: function LabelledDrawer() {
    const title = useId();
    return (
      <AppShell mobileQuery="all">
        <Sidebar render={<nav aria-labelledby={title} />}>
          <SidebarContent>
            <h2 id={title}>Project navigation</h2>
            <a href="#layers">Layers</a>
          </SidebarContent>
        </Sidebar>
        <AppShellCanvas>
          <SidebarToggle aria-label="Open navigation" mobileOnly />
        </AppShellCanvas>
      </AppShell>
    );
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Open navigation" });
    await userEvent.click(trigger);
    const document = within(canvasElement.ownerDocument.body);
    const dialog = await document.findByRole("dialog", {
      name: "Project navigation",
    });
    await expect(
      within(dialog).getByRole("navigation", { name: "Project navigation" }),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};
