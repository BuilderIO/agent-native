// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AppShell,
  AppShellAgent,
  AppShellCanvas,
  SidebarToggle,
} from "./app-shell.js";
import { Badge } from "./badge.js";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "./collapsible.js";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "./navigation-menu.js";
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderTitle,
} from "./page-header.js";
import { Separator } from "./separator.js";
import {
  Sidebar,
  SidebarBrand,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "./sidebar.js";
import {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  type ToolbarProps,
  ToolbarSeparator,
} from "./toolbar.js";

let mobile = false;

beforeEach(() => {
  mobile = false;
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: mobile,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Shell(props: {
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}) {
  return (
    <AppShell
      defaultSidebarCollapsed={props.collapsed}
      onSidebarCollapsedChange={props.onCollapsedChange}
    >
      <Sidebar aria-label="Mail">
        <SidebarHeader>
          <SidebarBrand href="/" logo={<svg />} badge={<Badge>BETA</Badge>}>
            Mail
          </SidebarBrand>
        </SidebarHeader>
        <SidebarContent>
          <NavigationMenu orientation="vertical" aria-label="Mail">
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuLink leading={<svg />} active href="/inbox">
                  Inbox
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink
                  leading={<svg />}
                  trailing="3"
                  href="/drafts"
                >
                  Drafts
                </NavigationMenuLink>
              </NavigationMenuItem>
            </NavigationMenuList>
            <Separator />
            <NavigationMenuList>
              <NavigationMenuItem>
                <Collapsible>
                  <NavigationMenuLink leading={<svg />} href="/labels">
                    Labels
                  </NavigationMenuLink>
                  <CollapsibleTrigger aria-label="Show labels" />
                  <CollapsiblePanel>
                    <NavigationMenuList>
                      <NavigationMenuItem>
                        <NavigationMenuLink href="/labels/receipts">
                          Receipts
                        </NavigationMenuLink>
                      </NavigationMenuItem>
                    </NavigationMenuList>
                  </CollapsiblePanel>
                </Collapsible>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
        </SidebarContent>
        <SidebarFooter>
          <SidebarToggle aria-label="Sidebar" />
        </SidebarFooter>
      </Sidebar>
      <AppShellCanvas>
        <PageHeader>
          <SidebarToggle aria-label="Menu" />
          <PageHeaderTitle>Inbox</PageHeaderTitle>
          <PageHeaderActions>
            <button type="button">Compose</button>
          </PageHeaderActions>
        </PageHeader>
      </AppShellCanvas>
      <AppShellAgent aria-label="Agent" />
    </AppShell>
  );
}

describe("AppShell, Sidebar and PageHeader", () => {
  it("lays out the navigation, the main landmark and the agent panel", () => {
    render(<Shell />);
    const nav = screen.getByRole("navigation", { name: "Mail" });
    expect(nav.classList.contains("navigation-menu")).toBe(true);
    expect(nav.closest(".sidebar")).not.toBeNull();
    expect(
      screen.getByRole("main").classList.contains("app-shell-canvas"),
    ).toBe(true);
    expect(
      screen.getByRole("complementary", { name: "Agent" }).classList,
    ).toContain("app-shell-agent");
    const header = screen.getByRole("banner");
    expect(
      within(header).getByRole("heading", { level: 1, name: "Inbox" })
        .classList,
    ).toContain("page-header-title");
  });

  it("links the brand home with its badge", () => {
    render(<Shell />);
    const brand = screen.getByRole("link", { name: /Mail/ });
    expect(brand.getAttribute("href")).toBe("/");
    expect(brand.querySelector(".badge")?.textContent).toBe("BETA");
  });

  it("marks the current place with NavigationMenu's active link", () => {
    render(<Shell />);
    const inbox = screen.getByRole("link", { name: "Inbox" });
    expect(inbox.classList.contains("navigation-menu-link")).toBe(true);
    expect(inbox.getAttribute("aria-current")).toBe("page");
    expect(inbox.hasAttribute("data-active")).toBe(true);
    const drafts = screen.getByRole("link", { name: /Drafts/ });
    expect(drafts.getAttribute("aria-current")).toBeNull();
    expect(
      drafts.querySelector(".navigation-menu-link-trailing")?.textContent,
    ).toBe("3");
  });

  it("opens nested places from a Collapsible", async () => {
    render(<Shell />);
    expect(screen.queryByRole("link", { name: "Receipts" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show labels" }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Receipts" })).toBeTruthy(),
    );
  });

  it("collapses to a rail from the toggle, where links keep their names", () => {
    const onCollapsedChange = vi.fn();
    render(<Shell onCollapsedChange={onCollapsedChange} />);
    const toggle = screen.getByRole("button", { name: "Sidebar" });
    expect(toggle.classList.contains("icon-button")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(
      document.querySelector(".sidebar")?.hasAttribute("data-collapsed"),
    ).toBe(true);
    const inbox = screen.getByRole("link", { name: "Inbox" });
    expect(inbox.hasAttribute("data-icon-only")).toBe(true);
    expect(screen.getByRole("link", { name: /Mail/ })).toBeTruthy();
  });

  it("becomes a drawer at the mobile width, opened by the toggle", async () => {
    mobile = true;
    render(<Shell />);
    expect(screen.queryByRole("navigation", { name: "Mail" })).toBeNull();
    const toggle = screen.getByRole("button", { name: "Menu" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      fireEvent.click(toggle);
    });
    const drawer = await screen.findByRole("dialog", { name: "Mail" });
    expect(drawer.classList.contains("sidebar-drawer")).toBe(true);
    expect(
      within(drawer).getByRole("navigation", { name: "Mail" }),
    ).toBeTruthy();
  });

  it("refuses a sidebar outside an AppShell", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Sidebar />)).toThrow(/within <AppShell>/);
  });
});

describe("Toolbar part", () => {
  it("writes its size on the toolbar, size 3 by default", () => {
    const { rerender } = render(<Toolbar aria-label="Format" />);
    const toolbar = screen.getByRole("toolbar", { name: "Format" });
    expect(toolbar.dataset.size).toBe("md");
    rerender(<Toolbar aria-label="Format" size="sm" />);
    expect(toolbar.dataset.size).toBe("sm");
  });

  it("refuses a size it doesn't have instead of drawing the default", () => {
    const props = { size: "1" } as unknown as ToolbarProps;
    expect(() => render(<Toolbar {...props} />)).toThrow(
      /size="1" is not one of/,
    );
  });

  it("is one tab stop with arrow keys between its buttons", async () => {
    render(
      <Toolbar aria-label="Format">
        <ToolbarGroup>
          <ToolbarButton aria-label="Bold" />
          <ToolbarButton aria-label="Italic" />
        </ToolbarGroup>
        <ToolbarSeparator />
        <ToolbarButton aria-label="Link" />
      </Toolbar>,
    );
    const toolbar = screen.getByRole("toolbar", { name: "Format" });
    expect(toolbar.classList.contains("toolbar")).toBe(true);
    const bold = screen.getByRole("button", { name: "Bold" });
    const italic = screen.getByRole("button", { name: "Italic" });
    expect(bold.classList.contains("toolbar-button")).toBe(true);
    expect(bold.tabIndex).toBe(0);
    expect(italic.tabIndex).toBe(-1);
    act(() => bold.focus());
    fireEvent.keyDown(bold, { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(italic));
  });
});
