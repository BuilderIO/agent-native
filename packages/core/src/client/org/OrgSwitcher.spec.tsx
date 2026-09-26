// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const mutation = () => ({
    error: null as Error | null,
    isPending: false,
    variables: undefined as unknown,
    mutate: vi.fn(),
    reset: vi.fn(),
  });
  type MutateOptions = { onSuccess?: () => void; onSettled?: () => void };
  const succeed = (_value: unknown, options?: MutateOptions) => {
    options?.onSuccess?.();
    options?.onSettled?.();
  };
  return {
    navigate: vi.fn(),
    beginSignOut: vi.fn(),
    completeSignOut: vi.fn(),
    notifySessionInvalidated: vi.fn(),
    useOrg: vi.fn(),
    useSession: vi.fn(),
    useDemoModeStatus: vi.fn(),
    useActionQuery: vi.fn(),
    useAvatarUrl: vi.fn(),
    switchOrg: mutation(),
    createOrg: mutation(),
    acceptInvitation: mutation(),
    joinByDomain: mutation(),
    succeed,
  };
});

vi.mock("react-router", () => ({
  Link: ({
    to,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...props} />
  ),
  useNavigate: () => mocks.navigate,
}));

vi.mock("./hooks.js", () => ({
  useAcceptInvitation: () => mocks.acceptInvitation,
  useCreateOrg: () => mocks.createOrg,
  useJoinByDomain: () => mocks.joinByDomain,
  useOrg: mocks.useOrg,
  useSwitchOrg: () => mocks.switchOrg,
}));

vi.mock("../use-session.js", () => ({
  beginSignOut: mocks.beginSignOut,
  completeSignOut: mocks.completeSignOut,
  notifySessionInvalidated: mocks.notifySessionInvalidated,
  useSession: mocks.useSession,
}));

vi.mock("../use-demo-mode-status.js", () => ({
  useDemoModeStatus: mocks.useDemoModeStatus,
}));

vi.mock("../use-action.js", () => ({
  useActionQuery: mocks.useActionQuery,
}));

vi.mock("../use-avatar.js", () => ({
  useAvatarUrl: mocks.useAvatarUrl,
}));

vi.mock("../i18n.js", async () => {
  const english = (await import("../../localization/core-messages/en-US.js"))
    .default as Record<string, string>;
  return {
    useT:
      () =>
      (key: string, options?: Record<string, unknown>): string => {
        const message =
          (key.startsWith("agentChat.")
            ? english[key.slice("agentChat.".length)]
            : undefined) ??
          (options?.defaultValue as string | undefined) ??
          key;
        return message.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
          String(options?.[name] ?? ""),
        );
      },
  };
});

import { OrgSwitcher } from "./OrgSwitcher.js";

const ownerOrg = {
  email: "owner@example.com",
  orgId: "org-1",
  orgName: "Acme",
  orgs: [
    { orgId: "org-1", orgName: "Acme", role: "owner" },
    { orgId: "org-2", orgName: "Globex", role: "member" },
  ],
  domainMatches: [],
  pendingInvitations: [],
  role: "owner",
};

describe("OrgSwitcher (account menu)", () => {
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
    mocks.useActionQuery.mockReset();
    mocks.useAvatarUrl.mockReset();
    for (const mutation of [
      mocks.switchOrg,
      mocks.createOrg,
      mocks.acceptInvitation,
      mocks.joinByDomain,
    ]) {
      mutation.error = null;
      mutation.isPending = false;
      mutation.variables = undefined;
      mutation.mutate.mockReset();
      mutation.mutate.mockImplementation(mocks.succeed);
      mutation.reset.mockReset();
    }
    mocks.useSession.mockReturnValue({
      session: { email: "owner@example.com", name: "Session Name" },
      isLoading: false,
    });
    mocks.useActionQuery.mockReturnValue({
      data: { email: "owner@example.com", name: "Olivia Owner" },
    });
    mocks.useAvatarUrl.mockReturnValue(null);
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
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  function render(ui: React.ReactElement) {
    act(() => {
      root.render(ui);
    });
  }

  function trigger() {
    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button).not.toBeNull();
    return button!;
  }

  function openMenu() {
    const button = trigger();
    act(() => {
      button.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
          cancelable: true,
        }),
      );
    });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    return document.body.querySelector<HTMLElement>('[role="menu"]')!;
  }

  function menuItems() {
    return Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    );
  }

  function menuItemLabels() {
    return menuItems().map((item) => item.textContent?.trim() ?? "");
  }

  function findItem(label: string) {
    const item = menuItems().find((element) =>
      element.textContent?.includes(label),
    );
    expect(item, `menu item "${label}"`).toBeDefined();
    return item!;
  }

  async function select(label: string) {
    const item = findItem(label);
    await act(async () => {
      item.click();
      await Promise.resolve();
    });
  }

  it("renders a disabled loading placeholder while organization data loads", () => {
    mocks.useOrg.mockReturnValue({ data: undefined, isLoading: true });

    render(<OrgSwitcher />);

    const button = trigger();
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-label")).toBe("Loading account");
    expect(button.className).toContain("animate-pulse");
    expect(button.querySelector(".rounded-full")).not.toBeNull();
  });

  it("keeps the compact trigger shape while organization data loads", () => {
    mocks.useOrg.mockReturnValue({ data: undefined, isLoading: true });

    render(<OrgSwitcher compact />);

    const button = trigger();
    expect(button.className).toContain("justify-center");
    expect(button.querySelector("span")?.className).toContain("rounded-full");
  });

  it("shows the avatar, profile name, and organization on the trigger", () => {
    mocks.useOrg.mockReturnValue({ data: ownerOrg, isLoading: false });

    render(<OrgSwitcher />);

    const button = trigger();
    expect(button.getAttribute("aria-label")).toBe("Olivia Owner, Acme");
    expect(button.textContent).toContain("OO");
    expect(button.textContent).toContain("Olivia Owner");
    expect(button.textContent).toContain("Acme");
    expect(mocks.useAvatarUrl).toHaveBeenCalledWith("owner@example.com");
  });

  it("falls back to the session name, then the email, for the trigger name", () => {
    mocks.useOrg.mockReturnValue({ data: ownerOrg, isLoading: false });
    mocks.useActionQuery.mockReturnValue({ data: undefined });

    render(<OrgSwitcher />);
    expect(trigger().textContent).toContain("Session Name");

    mocks.useSession.mockReturnValue({ session: null, isLoading: false });
    render(<OrgSwitcher />);
    expect(trigger().textContent).toContain("Owner");
  });

  it("shows Personal when the user has no active organization", () => {
    mocks.useOrg.mockReturnValue({
      data: {
        ...ownerOrg,
        orgId: null,
        orgName: null,
        role: null,
        orgs: [],
      },
      isLoading: false,
    });

    render(<OrgSwitcher />);

    expect(trigger().getAttribute("aria-label")).toBe("Olivia Owner, Personal");
    openMenu();
    const personal = findItem("Personal");
    expect(personal.querySelector("svg.tabler-icon-check")).not.toBeNull();
  });

  it("keeps the compact trigger to the avatar, with name and org in the tooltip", () => {
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
    mocks.useActionQuery.mockReturnValue({ data: { name: "Brent Locks" } });

    render(<OrgSwitcher compact />);

    const button = trigger();
    expect(button.getAttribute("aria-label")).toBe(
      "Brent Locks, Brent's workspace",
    );
    expect(button.textContent).toBe("BL");
    // Rail neighbours use the shared tooltip; a native `title` reads as a
    // missing tooltip next to them.
    expect(button.getAttribute("title")).toBeNull();
    // The tooltip and the menu both target this one button. Anything
    // rendered between the menu trigger and the button eats the click.
    expect(button.getAttribute("aria-haspopup")).toBe("menu");

    act(() => {
      button.focus();
    });
    const tooltip = Array.from(
      document.querySelectorAll('[role="tooltip"]'),
    ).map((node) => node.textContent);
    expect(tooltip.join(" ")).toContain("Brent Locks");
    expect(tooltip.join(" ")).toContain("Brent's workspace");

    openMenu();
    expect(menuItemLabels().some((label) => label.includes("Builder.io"))).toBe(
      true,
    );
  });

  it.each(["owner", "member"])(
    "orders the menu as email, organizations, Settings, Usage, Log out (%s)",
    (role) => {
      mocks.useOrg.mockReturnValue({
        data: { ...ownerOrg, role, emailConfigured: true },
        isLoading: false,
      });

      render(<OrgSwitcher />);
      const menu = openMenu();

      expect(menu.getAttribute("aria-label")).toBe("Account");
      const header = menu.firstElementChild;
      expect(header?.textContent).toBe("owner@example.com");
      expect(header?.getAttribute("role")).not.toBe("menuitem");

      const labels = menuItemLabels();
      expect(labels).toEqual([
        "Acme",
        "Globex",
        "Personal",
        "Create organization",
        expect.stringMatching(/^Settings(⌘,|Ctrl\+,)$/),
        "Usage",
        "Log out",
      ]);
      expect(findItem("Acme").querySelector("svg.tabler-icon-check")).not.toBe(
        null,
      );
      expect(
        findItem("Globex").querySelector("svg.tabler-icon-check"),
      ).toBeNull();

      const text = document.body.textContent ?? "";
      for (const removed of [
        "Invite member",
        "Organization settings",
        "Profile",
        "Tools",
        "Get apps and extensions",
        "Sign out",
      ]) {
        expect(text).not.toContain(removed);
      }
      expect(menu.querySelectorAll('[role="separator"]').length).toBe(2);
    },
  );

  it("opens Settings on the account page and Usage from the menu", async () => {
    mocks.useOrg.mockReturnValue({ data: ownerOrg, isLoading: false });

    render(<OrgSwitcher settingsPath="/settings/organization" />);
    openMenu();
    await select("Settings");
    expect(mocks.navigate).toHaveBeenCalledWith("/settings/account");

    openMenu();
    await select("Usage");
    expect(mocks.navigate).toHaveBeenLastCalledWith("/settings/usage");
  });

  it("switches organizations and closes on success", async () => {
    mocks.useOrg.mockReturnValue({ data: ownerOrg, isLoading: false });

    render(<OrgSwitcher />);
    openMenu();
    await select("Globex");

    expect(mocks.switchOrg.mutate).toHaveBeenCalledWith(
      "org-2",
      expect.any(Object),
    );
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("switches to Personal from an organization", async () => {
    mocks.useOrg.mockReturnValue({ data: ownerOrg, isLoading: false });

    render(<OrgSwitcher />);
    openMenu();
    expect(
      findItem("Personal").querySelector("svg.tabler-icon-check"),
    ).toBeNull();
    await select("Personal");

    expect(mocks.switchOrg.mutate).toHaveBeenCalledWith(
      null,
      expect.any(Object),
    );
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("shows a spinner on the row being switched to", () => {
    mocks.useOrg.mockReturnValue({ data: ownerOrg, isLoading: false });
    mocks.switchOrg.isPending = true;
    mocks.switchOrg.variables = null;

    render(<OrgSwitcher />);
    openMenu();

    const personal = findItem("Personal");
    expect(personal.querySelector("svg.animate-spin")).not.toBeNull();
    expect(findItem("Globex").querySelector("svg.animate-spin")).toBeNull();
    expect(findItem("Globex").hasAttribute("data-disabled")).toBe(true);
  });

  it("keeps the current organization selection a no-op", async () => {
    mocks.useOrg.mockReturnValue({ data: ownerOrg, isLoading: false });

    render(<OrgSwitcher />);
    openMenu();
    await select("Acme");

    expect(mocks.switchOrg.mutate).not.toHaveBeenCalled();
  });

  it("accepts invitations and joins domain matches from the menu", async () => {
    mocks.useOrg.mockReturnValue({
      data: {
        ...ownerOrg,
        pendingInvitations: [
          { id: "inv-1", orgId: "org-3", orgName: "Initech" },
        ],
        domainMatches: [{ orgId: "org-4", orgName: "Umbrella" }],
      },
      isLoading: false,
    });

    render(<OrgSwitcher />);
    openMenu();

    const text = document.body.textContent ?? "";
    expect(text).toContain("Invitations");
    expect(text).toContain("Join your team");
    const labels = menuItemLabels();
    const initech = labels.findIndex((label) => label.includes("Initech"));
    const umbrella = labels.findIndex((label) => label.includes("Umbrella"));
    const create = labels.indexOf("Create organization");
    expect(initech).toBeGreaterThan(labels.indexOf("Globex"));
    expect(umbrella).toBeGreaterThan(initech);
    expect(create).toBeGreaterThan(umbrella);

    await select("Initech");
    expect(mocks.acceptInvitation.mutate).toHaveBeenCalledWith(
      "inv-1",
      expect.any(Object),
    );

    openMenu();
    await select("Umbrella");
    expect(mocks.joinByDomain.mutate).toHaveBeenCalledWith(
      "org-4",
      expect.any(Object),
    );
  });

  it("creates an organization from a dialog", async () => {
    mocks.useOrg.mockReturnValue({ data: ownerOrg, isLoading: false });

    render(<OrgSwitcher />);
    openMenu();
    await select("Create organization");

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const input = dialog!.querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "New Co");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = dialog!.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(mocks.createOrg.mutate).toHaveBeenCalledWith(
      "New Co",
      expect.any(Object),
    );
  });

  it("hides Get apps and extensions unless the app passes utility links", () => {
    mocks.useOrg.mockReturnValue({ data: ownerOrg, isLoading: false });

    render(<OrgSwitcher utilityLinks={[]} />);
    openMenu();

    expect(document.body.textContent).not.toContain("Get apps and extensions");
  });

  it("drills in to the app's downloads with a back row", async () => {
    mocks.useOrg.mockReturnValue({ data: ownerOrg, isLoading: false });

    render(
      <OrgSwitcher
        utilityLinks={[
          {
            id: "chrome-extension",
            label: "Chrome extension",
            href: "https://example.com/extension",
            external: true,
          },
          {
            id: "desktop-app",
            label: "Get desktop app",
            href: "/download",
          },
        ]}
      />,
    );
    openMenu();

    const labels = menuItemLabels();
    expect(labels.indexOf("Get apps and extensions")).toBe(
      labels.indexOf("Usage") + 1,
    );
    expect(document.body.textContent).not.toContain("Chrome extension");

    await select("Get apps and extensions");

    expect(menuItemLabels()).toEqual([
      "Get apps and extensions",
      "Chrome extension",
      "Get desktop app",
    ]);
    const back = menuItems()[0]!;
    expect(back.getAttribute("aria-label")).toBe("Back");
    expect(document.activeElement).toBe(back);

    const links = Array.from(
      document.body.querySelectorAll<HTMLAnchorElement>("a"),
    );
    const extension = links.find(
      (link) => link.textContent?.trim() === "Chrome extension",
    );
    const desktop = links.find(
      (link) => link.textContent?.trim() === "Get desktop app",
    );
    expect(extension?.getAttribute("href")).toBe(
      "https://example.com/extension",
    );
    expect(extension?.getAttribute("target")).toBe("_blank");
    expect(extension?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(extension?.querySelector("svg.tabler-icon-arrow-up-right")).not.toBe(
      null,
    );
    expect(desktop?.getAttribute("href")).toBe("/download");
    expect(desktop?.getAttribute("target")).toBeNull();

    await act(async () => {
      back.click();
      await Promise.resolve();
    });
    expect(menuItemLabels()).toContain("Log out");
  });

  it("keeps the menu open and shows a failed switch", () => {
    mocks.useOrg.mockReturnValue({ data: ownerOrg, isLoading: false });
    mocks.switchOrg.error = new Error(
      "You are not a member of that organization",
    );

    render(<OrgSwitcher />);
    openMenu();

    expect(
      document.body.querySelector('[role="menu"] [role="alert"]')?.textContent,
    ).toBe("You are not a member of that organization");
  });

  it("makes demo mode visible and hides the redacted email", () => {
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
    mocks.useSession.mockReturnValue({
      session: { email: "anonymous@builder.io", name: "Olivia Owner" },
      isLoading: false,
    });

    render(<OrgSwitcher />);

    const button = trigger();
    expect(button.getAttribute("aria-label")).toBe(
      "Olivia Owner, Acme, Demo mode",
    );
    expect(button.textContent).toContain("Demo mode");

    openMenu();

    expect(document.body.textContent).toContain("Demo mode is on");
    expect(document.body.textContent).toContain(
      "Your account and permissions are unchanged.",
    );
    expect(menuItemLabels()).toContain("Turn off demo mode");
    expect(document.body.textContent).not.toContain("anonymous@builder.io");
  });

  it("reloads after a failed log out without returning to sign-in", async () => {
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
    mocks.useOrg.mockReturnValue({ data: ownerOrg, isLoading: false });

    try {
      render(<OrgSwitcher />);
      openMenu();

      await act(async () => {
        findItem("Log out").click();
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
