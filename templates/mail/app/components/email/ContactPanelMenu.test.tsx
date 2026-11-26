// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  copy: {
    "mail.contactPanel.addToPanel": "Add to this panel",
    "mail.contactPanel.builtIn": "Built in",
    "mail.contactPanel.connections": "Connections",
    "mail.contactPanel.yourWidgets": "Your widgets",
    "mail.contactPanel.notes": "Notes",
    "mail.contactPanel.attachments": "Attachments",
    "mail.contactPanel.recent": "Recent",
    "mail.contactPanel.buildYourOwn": "Build your own…",
    "mail.contactPanel.buildYourOwnTitle": "Build your own",
    "mail.contactPanel.back": "Back",
    "mail.contactPanel.widgetSees":
      "A widget sees this person's name and email and the conversation you have open.",
    "mail.contactPanel.widgetDoes":
      "It can show your Mail data, call other services with keys you save, and keep its own notes.",
    "mail.contactPanel.exampleDeals":
      "Show this person's open deals from Salesforce",
    "mail.contactPanel.exampleLinks":
      "Link to this person's company website and LinkedIn page",
    "extensions.buildNewWidget": "Build a new widget",
  } as Record<string, string>,
  install: vi.fn(),
  uninstall: vi.fn(),
  setWidget: vi.fn(),
  sendToAgentChat: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, params?: Record<string, string>) =>
    key === "mail.contactPanel.examplePrompt"
      ? `Build for ${params?.slotId}: ${params?.idea}`
      : key === "extensions.createWidgetPrompt"
        ? `New widget for ${params?.slotId}`
        : (mocks.copy[key] ?? key),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: mocks.sendToAgentChat,
}));

vi.mock("@agent-native/toolkit/app/extensions", () => ({
  useSlotExtensions: () => ({
    data: [
      {
        extensionId: "deal-stage",
        name: "Deal stage",
        description: "",
        icon: null,
        config: null,
      },
      {
        extensionId: "company-links",
        name: "Company links",
        description: "",
        icon: null,
        config: null,
      },
    ],
    isPending: false,
    isError: false,
  }),
  useSlotInstalls: () => ({
    data: [{ installId: "install-1", extensionId: "deal-stage" }],
    isPending: false,
    isError: false,
  }),
  useSlotInstallActions: () => ({
    install: mocks.install,
    uninstall: mocks.uninstall,
  }),
}));

vi.mock("@/hooks/use-contact-panel", () => ({
  useContactPanelWidgets: () => ({
    widgets: { notes: true, attachments: false, recent: true },
    loaded: true,
    setWidget: mocks.setWidget,
  }),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { ContactPanelMenu } from "./ContactPanelMenu";

function renderMenu(onOpenChange = vi.fn()) {
  render(
    <ContactPanelMenu
      open
      onOpenChange={onOpenChange}
      connections={<p>HubSpot row</p>}
    />,
  );
  return { onOpenChange };
}

function switchNamed(name: string) {
  return screen.getByRole("switch", { name });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ContactPanelMenu", () => {
  it("lists built-ins, connections, the user's widgets and a way to build one", () => {
    renderMenu();

    expect(switchNamed("Notes").getAttribute("aria-checked")).toBe("true");
    expect(switchNamed("Attachments").getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(switchNamed("Recent").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("HubSpot row")).not.toBeNull();
    expect(switchNamed("Deal stage").getAttribute("aria-checked")).toBe("true");
    expect(switchNamed("Company links").getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(
      screen.getByRole("button", { name: "Build your own…" }),
    ).not.toBeNull();
  });

  it("saves a built-in switch as a setting", () => {
    renderMenu();

    fireEvent.click(switchNamed("Attachments"));
    fireEvent.click(switchNamed("Notes"));

    expect(mocks.setWidget).toHaveBeenNthCalledWith(1, "attachments", true);
    expect(mocks.setWidget).toHaveBeenNthCalledWith(2, "notes", false);
  });

  it("adds and removes the user's own widgets", () => {
    renderMenu();

    fireEvent.click(switchNamed("Company links"));
    fireEvent.click(switchNamed("Deal stage"));

    expect(mocks.install).toHaveBeenCalledWith(
      expect.objectContaining({ extensionId: "company-links" }),
    );
    expect(mocks.uninstall).toHaveBeenCalledWith("deal-stage");
  });

  it("explains what a widget can use and opens chat with an example to edit", () => {
    const { onOpenChange } = renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "Build your own…" }));

    expect(
      screen.getByText(
        "A widget sees this person's name and email and the conversation you have open.",
      ),
    ).not.toBeNull();
    expect(
      screen.getByText(
        "It can show your Mail data, call other services with keys you save, and keep its own notes.",
      ),
    ).not.toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Show this person's open deals from Salesforce",
      }),
    );

    expect(mocks.sendToAgentChat).toHaveBeenCalledWith({
      message:
        "Build for mail.contact-sidebar.bottom: Show this person's open deals from Salesforce",
      submit: false,
      openSidebar: true,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("starts a blank widget request from the build view", () => {
    renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "Build your own…" }));
    fireEvent.click(screen.getByRole("button", { name: "Build a new widget" }));

    expect(mocks.sendToAgentChat).toHaveBeenCalledWith({
      message: "New widget for mail.contact-sidebar.bottom",
      submit: false,
      openSidebar: true,
    });
  });
});
