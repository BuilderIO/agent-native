// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAIL_SIDEBAR_COLLAPSED_KEY, MailSidebar } from "./MailSidebar";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    ({
      "mail.appName": "Mail",
      "mail.views.inbox": "Inbox",
      "mail.views.unread": "Unread",
      "mail.views.labels": "Labels",
      "sidebar.collapseSidebar": "Collapse sidebar",
      "sidebar.expandSidebar": "Expand sidebar",
      "mail.toolbar.closeSidebar": "Close sidebar",
    })[key] ?? key,
  useFormatters: () => ({ formatNumber: (value: number) => String(value) }),
}));

vi.mock("@agent-native/toolkit/app/shared", async () => {
  const React = await import("react");
  const shell = await import("@agent-native/toolkit/app-shell");
  const TestLink = React.forwardRef<
    HTMLAnchorElement,
    React.AnchorHTMLAttributes<HTMLAnchorElement> & { to?: string }
  >(({ to, href, onClick, ...props }, ref) =>
    React.createElement("a", {
      ref,
      href: to ?? href,
      ...props,
      onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        onClick?.(event);
      },
    }),
  );
  return {
    AppSidebar: (props: React.ComponentProps<typeof shell.AppSidebar>) =>
      React.createElement(shell.AppSidebar, {
        linkComponent: TestLink,
        ...props,
      }),
    AppSidebarHeader: shell.AppSidebarHeader,
    AppSidebarFooter: shell.AppSidebarFooter,
    AppSidebarNavItem: shell.AppSidebarNavItem,
    AppSidebarSection: shell.AppSidebarSection,
  };
});

vi.mock("@agent-native/toolkit/app/org", () => ({
  BuilderCreditNotice: () => null,
  OrgSwitcher: () => null,
}));
vi.mock("@agent-native/toolkit/app/db-admin", () => ({
  DevDatabaseLink: () => null,
}));
vi.mock("@agent-native/toolkit/app/feedback", () => ({
  FeedbackButton: () => null,
}));

function setWindowWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  window.matchMedia = (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    return {
      matches:
        (!min || width >= Number(min[1])) && (!max || width <= Number(max[1])),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  };
}

function renderSidebar(
  overrides: Partial<ComponentProps<typeof MailSidebar>> = {},
) {
  return render(
    <MailSidebar
      view="inbox"
      queuedDraftCount={0}
      mobileOpen={false}
      onMobileOpenChange={() => {}}
      {...overrides}
    />,
  );
}

describe("MailSidebar", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(cleanup);

  it("starts open in a wide window and remembers a collapse across reloads", () => {
    setWindowWidth(1536);
    const first = renderSidebar();

    const inbox = screen.getByRole("link", { name: /Inbox/ });
    expect(inbox.textContent).toContain("Inbox");

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(window.localStorage.getItem(MAIL_SIDEBAR_COLLAPSED_KEY)).toBe(
      "true",
    );
    expect(screen.getByRole("link", { name: "Inbox" }).textContent.trim()).toBe(
      "",
    );

    first.unmount();
    renderSidebar();

    expect(
      screen.getByRole("button", { name: "Expand sidebar" }),
    ).toBeDefined();
    expect(screen.getByRole("link", { name: "Inbox" }).textContent.trim()).toBe(
      "",
    );
  });

  it("starts as icons under 1280 px until the reader picks a width", () => {
    setWindowWidth(1152);
    const first = renderSidebar();

    expect(
      screen.getByRole("button", { name: "Expand sidebar" }),
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Inbox" }).getAttribute("href"),
    ).toBe("/inbox");

    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    first.unmount();
    renderSidebar();

    expect(window.localStorage.getItem(MAIL_SIDEBAR_COLLAPSED_KEY)).toBe(
      "false",
    );
    expect(
      screen.getByRole("button", { name: "Collapse sidebar" }),
    ).toBeDefined();
  });

  it("shows labels only while expanded", () => {
    setWindowWidth(1536);
    renderSidebar({
      labels: [
        {
          id: "label-work",
          href: "/inbox?label=work",
          label: "Work",
          depth: 0,
          isActive: false,
        },
      ],
    });

    expect(screen.getByText("Labels")).toBeDefined();
    expect(screen.getByRole("link", { name: /Work/ })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(screen.queryByText("Labels")).toBeNull();
    expect(screen.queryByRole("link", { name: /Work/ })).toBeNull();
  });

  it("opens as a drawer on a phone and closes after picking a view", () => {
    setWindowWidth(390);
    window.localStorage.setItem(MAIL_SIDEBAR_COLLAPSED_KEY, "true");
    const onMobileOpenChange = vi.fn();
    const closed = renderSidebar({ onMobileOpenChange });

    expect(screen.queryByRole("dialog")).toBeNull();
    closed.unmount();

    renderSidebar({ mobileOpen: true, onMobileOpenChange });
    const drawer = screen.getByRole("dialog");

    expect(
      within(drawer).queryByRole("button", { name: "Collapse sidebar" }),
    ).toBeNull();
    const unread = within(drawer).getByRole("link", { name: /Unread/ });
    expect(unread.textContent).toContain("Unread");

    fireEvent.click(unread);

    expect(onMobileOpenChange).toHaveBeenCalledWith(false);
  });
});
