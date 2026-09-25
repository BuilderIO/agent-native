// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  beginSignOut: vi.fn(),
  completeSignOut: vi.fn(),
  notifySessionInvalidated: vi.fn(),
  useOrg: vi.fn(),
  useSession: vi.fn(),
  useDemoModeStatus: vi.fn(),
}));

vi.mock("react-router", () => ({
  Link: ({
    to,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...props} />
  ),
  useNavigate: () => mocks.navigate,
}));

vi.mock("./hooks.js", () => {
  const idleMutation = () => ({
    error: null,
    isPending: false,
    mutateAsync: vi.fn(),
  });

  return {
    useAcceptInvitation: idleMutation,
    useCreateOrg: idleMutation,
    useInviteMember: idleMutation,
    useJoinByDomain: idleMutation,
    useOrg: mocks.useOrg,
    useSwitchOrg: idleMutation,
  };
});

vi.mock("../use-session.js", () => ({
  beginSignOut: mocks.beginSignOut,
  completeSignOut: mocks.completeSignOut,
  notifySessionInvalidated: mocks.notifySessionInvalidated,
  useSession: mocks.useSession,
}));

vi.mock("../use-demo-mode-status.js", () => ({
  useDemoModeStatus: mocks.useDemoModeStatus,
}));

vi.mock("../i18n.js", () => ({
  useT: () => (key: string, options?: { defaultValue?: string }) => {
    const messages: Record<string, string> = {
      "contextXray.provenance.tools": "Tools",
      "settings.profileMenuItem": "Profile",
      "settings.profileTitle": "Account",
    };
    return messages[key] ?? options?.defaultValue ?? key;
  },
}));

import { OrgSwitcher } from "./OrgSwitcher.js";

describe("OrgSwitcher", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.useOrg.mockReset();
    mocks.beginSignOut.mockReset();
    mocks.completeSignOut.mockReset();
    mocks.notifySessionInvalidated.mockReset();
    mocks.useSession.mockReset();
    mocks.useDemoModeStatus.mockReset();
    mocks.navigate.mockReset();
    mocks.useSession.mockReturnValue({ session: null, isLoading: false });
    mocks.useDemoModeStatus.mockReturnValue({
      enabled: false,
      forced: false,
      isLoading: false,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(ui: React.ReactElement) {
    act(() => {
      root.render(ui);
    });
  }

  it("renders a disabled loading placeholder while organization data loads", () => {
    mocks.useOrg.mockReturnValue({ data: undefined, isLoading: true });

    render(<OrgSwitcher />);

    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute("aria-label")).toBe("Loading organization");
    expect(button?.className).toContain("animate-pulse");
  });

  it("keeps the compact trigger shape while organization data loads", () => {
    mocks.useOrg.mockReturnValue({ data: undefined, isLoading: true });

    render(<OrgSwitcher compact />);

    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button?.className).toContain("justify-center");
    expect(button?.querySelector("span")?.className).toContain("size-3.5");
  });

  it("still renders a labelled trigger in compact mode", () => {
    // A collapsed sidebar rail used to drop the switcher entirely, which left
    // no way to reach another workspace or the "Join your team" list.
    mocks.useOrg.mockReturnValue({
      data: {
        email: "brent@builder.io",
        orgId: "personal",
        orgName: "Brent's workspace",
        orgs: [
          { orgId: "personal", orgName: "Brent's workspace", role: "owner" },
        ],
        domainMatches: [{ orgId: "builder_io", orgName: "Builder.io" }],
        pendingInvitations: [],
        role: "owner",
      },
      isLoading: false,
    });

    render(<OrgSwitcher compact />);

    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-label")).toBe("Brent's workspace");
    expect(button?.textContent).toBe("");
    // Rail neighbours use the shared tooltip; a native `title` reads as a
    // missing tooltip next to them.
    expect(button?.getAttribute("title")).toBeNull();
    // The tooltip and the popover both target this one button. Anything
    // rendered between the popover trigger and the button eats the click.
    expect(button?.getAttribute("aria-haspopup")).toBe("dialog");
    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.textContent).toContain("Organization settings");

    act(() => {
      button?.focus();
    });
    expect(
      Array.from(document.querySelectorAll('[role="tooltip"]')).map(
        (node) => node.textContent,
      ),
    ).toContain("Brent's workspace");
  });

  it("renders app utility links in the account menu", () => {
    mocks.useOrg.mockReturnValue({
      data: {
        email: "owner@example.com",
        orgId: "org-1",
        orgName: "Acme",
        orgs: [{ orgId: "org-1", orgName: "Acme", role: "owner" }],
        domainMatches: [],
        pendingInvitations: [],
        role: "owner",
      },
      isLoading: false,
    });

    render(
      <OrgSwitcher
        utilityLinks={[
          {
            id: "browser-extension",
            label: "Browser extension",
            href: "https://example.com/extension",
            external: true,
          },
          {
            id: "desktop-download",
            label: "Desktop app",
            href: "/download",
          },
        ]}
      />,
    );

    act(() => {
      container.querySelector<HTMLButtonElement>("button")!.click();
    });

    const utilityLinks = Array.from(
      document.body.querySelectorAll<HTMLAnchorElement>("a"),
    );
    const extensionLink = utilityLinks.find(
      (link) => link.textContent?.trim() === "Browser extension",
    );
    const desktopLink = utilityLinks.find(
      (link) => link.textContent?.trim() === "Desktop app",
    );

    expect(extensionLink?.getAttribute("href")).toBe(
      "https://example.com/extension",
    );
    expect(extensionLink?.getAttribute("target")).toBe("_blank");
    expect(extensionLink?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(desktopLink?.getAttribute("href")).toBe("/download");
  });

  it("keeps account menu actions grouped by purpose", () => {
    mocks.useOrg.mockReturnValue({
      data: {
        email: "owner@example.com",
        orgId: "org-1",
        orgName: "Acme",
        orgs: [{ orgId: "org-1", orgName: "Acme", role: "owner" }],
        domainMatches: [],
        pendingInvitations: [],
        role: "owner",
      },
      isLoading: false,
    });

    render(
      <OrgSwitcher
        utilityLinks={[
          {
            id: "desktop-download",
            label: "Desktop app",
            href: "/download",
          },
        ]}
      />,
    );

    act(() => {
      container.querySelector<HTMLButtonElement>("button")!.click();
    });

    const sectionLabels = Array.from(document.body.querySelectorAll("div"))
      .filter((element) => element.className.includes("uppercase"))
      .map((element) => element.textContent?.trim())
      .filter((label): label is string => Boolean(label));
    expect(sectionLabels).toEqual(["Organizations", "Account", "Tools"]);

    const menuButtons = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).map((button) => button.textContent?.trim() ?? "");
    const actionOrder = [
      "Invite member",
      "Organization settings",
      "Create organization",
    ].map((label) => menuButtons.findIndex((text) => text.includes(label)));
    expect(actionOrder[0]).toBeGreaterThanOrEqual(0);
    expect(actionOrder[1]).toBeGreaterThan(actionOrder[0]);
    expect(actionOrder[2]).toBeGreaterThan(actionOrder[1]);
  });

  it("does not offer invitations when email delivery is unavailable", () => {
    mocks.useOrg.mockReturnValue({
      data: {
        email: "owner@example.com",
        orgId: "org-1",
        orgName: "Acme",
        orgs: [{ orgId: "org-1", orgName: "Acme", role: "owner" }],
        domainMatches: [],
        pendingInvitations: [],
        role: "owner",
        emailConfigured: false,
      },
      isLoading: false,
    });

    render(<OrgSwitcher />);
    act(() => {
      container.querySelector<HTMLButtonElement>("button")!.click();
    });

    expect(document.body.textContent).not.toContain("Invite member");
  });

  it("keeps workspace resources and agent management in Settings", () => {
    mocks.useOrg.mockReturnValue({
      data: {
        email: "owner@example.com",
        orgId: "org-1",
        orgName: "Acme",
        orgs: [{ orgId: "org-1", orgName: "Acme", role: "owner" }],
        domainMatches: [],
        pendingInvitations: [],
        role: "owner",
      },
      isLoading: false,
    });

    render(<OrgSwitcher />);
    act(() => {
      container.querySelector<HTMLButtonElement>("button")!.click();
    });

    expect(document.body.textContent).not.toContain("Workspace");
    expect(document.body.textContent).not.toContain("Apps");
    expect(document.body.textContent).not.toContain("Manage agent");
    expect(document.body.textContent).toContain("Profile");
  });

  it("makes demo mode visible and removes the redacted email from sign out", () => {
    mocks.useDemoModeStatus.mockReturnValue({
      enabled: true,
      forced: false,
      isLoading: false,
    });
    mocks.useOrg.mockReturnValue({
      data: {
        email: "anonymous@builder.io",
        orgId: "org-1",
        orgName: "Acme",
        role: "owner",
        orgs: [{ orgId: "org-1", orgName: "Acme" }],
        pendingInvitations: [],
        domainMatches: [],
      },
      isLoading: false,
    });

    render(<OrgSwitcher />);

    const trigger = container.querySelector<HTMLButtonElement>("button");
    expect(trigger?.getAttribute("aria-label")).toBe("Acme, Demo mode");
    expect(trigger?.textContent).toContain("Demo mode");

    act(() => {
      trigger!.click();
    });

    expect(document.body.textContent).toContain("Demo mode is on");
    expect(document.body.textContent).toContain(
      "Your account and permissions are unchanged.",
    );
    expect(document.body.textContent).not.toContain("anonymous@builder.io");
  });

  it("opens organization settings in the settings page tab", () => {
    const openPanel = vi.fn();
    const openSettings = vi.fn();
    window.addEventListener("agent-panel:open", openPanel);
    window.addEventListener("agent-panel:open-settings", openSettings);
    mocks.useOrg.mockReturnValue({
      data: {
        email: "owner@example.com",
        orgId: "org-1",
        orgName: "Acme",
        role: "owner",
        orgs: [{ orgId: "org-1", orgName: "Acme" }],
        pendingInvitations: [],
        domainMatches: [],
      },
      isLoading: false,
    });

    render(<OrgSwitcher />);

    const trigger = container.querySelector<HTMLButtonElement>("button");
    expect(trigger).not.toBeNull();

    act(() => {
      trigger!.click();
    });

    const settingsButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Organization settings"));
    expect(settingsButton).not.toBeNull();

    act(() => {
      settingsButton!.click();
    });

    expect(mocks.navigate).toHaveBeenCalledWith("/settings/organization");
    expect(openPanel).not.toHaveBeenCalled();
    expect(openSettings).not.toHaveBeenCalled();

    window.removeEventListener("agent-panel:open", openPanel);
    window.removeEventListener("agent-panel:open-settings", openSettings);
  });

  it("opens the shared profile settings section", () => {
    mocks.useOrg.mockReturnValue({
      data: {
        email: "owner@example.com",
        orgId: "org-1",
        orgName: "Acme",
        role: "owner",
        orgs: [{ orgId: "org-1", orgName: "Acme" }],
        pendingInvitations: [],
        domainMatches: [],
      },
      isLoading: false,
    });

    render(<OrgSwitcher />);
    act(() => {
      container.querySelector<HTMLButtonElement>("button")!.click();
    });

    const profileButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Profile"));
    expect(profileButton).not.toBeNull();

    act(() => {
      profileButton!.click();
    });

    expect(mocks.navigate).toHaveBeenCalledWith("/settings/account");
  });

  it("reloads after a failed sign out without returning to sign-in", async () => {
    const originalLocation = window.location;
    const reload = vi.fn();
    const replace = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        pathname: "/library",
        search: "",
        hash: "",
        origin: "https://clips.example.com",
        href: "https://clips.example.com/library",
        host: "clips.example.com",
        reload,
        replace,
      },
    });
    const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    mocks.useOrg.mockReturnValue({
      data: {
        email: "owner@example.com",
        orgId: "org-1",
        orgName: "Acme",
        role: "owner",
        orgs: [{ orgId: "org-1", orgName: "Acme" }],
        pendingInvitations: [],
        domainMatches: [],
      },
      isLoading: false,
    });

    try {
      render(<OrgSwitcher />);
      act(() => {
        container.querySelector<HTMLButtonElement>("button")!.click();
      });
      const signOut = Array.from(
        document.body.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent?.includes("Sign out"));
      expect(signOut).not.toBeNull();

      await act(async () => {
        signOut!.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(fetchMock).toHaveBeenCalledWith("/_agent-native/auth/logout", {
        method: "POST",
        credentials: "include",
        signal: expect.any(AbortSignal),
      });
      expect(mocks.beginSignOut).toHaveBeenCalledOnce();
      expect(mocks.completeSignOut).not.toHaveBeenCalled();
      expect(mocks.notifySessionInvalidated).not.toHaveBeenCalled();
      expect(reload).toHaveBeenCalledOnce();
      expect(replace).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        "Sign-out request returned an error",
        503,
      );
    } finally {
      warn.mockRestore();
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    }
  });
});
