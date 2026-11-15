// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const mutation = () => ({
    error: null as Error | null,
    isPending: false,
    variables: undefined as unknown,
    mutate: vi.fn(),
    reset: vi.fn(),
    onPersisted: undefined as ((orgId: string | null) => void) | undefined,
  });
  type MutateOptions = {
    onError?: () => void;
    onSuccess?: () => void;
    onSettled?: () => void;
  };
  const succeed = (_value: unknown, options?: MutateOptions) => {
    options?.onSuccess?.();
    options?.onSettled?.();
  };
  return {
    navigate: vi.fn(),
    useOrg: vi.fn(),

    // The workspace menu header reads the member count through this hook. It is a vi.fn so a test
    // can give it a REAL React hook (below): a mock that calls no hook hides a hook-order bug.
    useOrgMembers: vi.fn(),
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

vi.mock("@agent-native/core/client/org", () => ({
  useAcceptInvitation: () => mocks.acceptInvitation,
  useCreateOrg: () => mocks.createOrg,
  useJoinByDomain: () => mocks.joinByDomain,
  useOrg: mocks.useOrg,
  // The workspace menu header reads the member count through this hook.
  useOrgMembers: (...args: unknown[]) => mocks.useOrgMembers(...args),
  useSwitchOrg: (options?: {
    onPersisted?: (orgId: string | null) => void;
  }) => {
    mocks.switchOrg.onPersisted = options?.onPersisted;
    return mocks.switchOrg;
  },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: mocks.useActionQuery,
  useAvatarUrl: mocks.useAvatarUrl,
  useDemoModeStatus: mocks.useDemoModeStatus,
  useSession: mocks.useSession,
}));

vi.mock("@agent-native/core/client/i18n", async () => {
  const english = (await import("../i18n/catalogs/en-US.js")).default as Record<
    string,
    string
  >;
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

import { BuilderCreditNotice, OrgSwitcher } from "./OrgSwitcher.js";

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

describe("OrgSwitcher app-owned menu visibility", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.useOrg.mockReset();
    mocks.useSession.mockReset();
    mocks.useDemoModeStatus.mockReset();
    mocks.navigate.mockReset();
    mocks.useActionQuery.mockReset();
    mocks.useAvatarUrl.mockReset();
    mocks.useOrgMembers.mockReset();
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
      mutation.onPersisted = undefined;
    }
    mocks.useSession.mockReturnValue({
      session: { email: "owner@example.com", name: "Session Name" },
      isLoading: false,
    });
    mocks.useActionQuery.mockReturnValue({
      data: { email: "owner@example.com", name: "Olivia Owner" },
    });
    mocks.useAvatarUrl.mockReturnValue(null);
    mocks.useOrgMembers.mockImplementation(() => {
      // A real hook, so a hook called below this component's early returns changes the count React
      // sees between renders exactly as it did on the served build.
      React.useState(0);
      return { data: { totalCount: 3 }, isLoading: false };
    });
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

  function creditNotice() {
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label*="Builder credits"]',
    );
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

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    "honors create=%s and usage=%s suppression without hiding workspace access",
    (hideCreateOrganization, hideUsage) => {
      mocks.useOrg.mockReturnValue({ data: ownerOrg, isLoading: false });
      render(
        <OrgSwitcher
          hideCreateOrganization={hideCreateOrganization}
          hideUsage={hideUsage}
        />,
      );
      openMenu();
      const labels = menuItemLabels();
      expect(labels.includes("Create organization")).toBe(
        !hideCreateOrganization,
      );
      expect(labels.includes("Usage")).toBe(!hideUsage);
      expect(labels).toContain("Acme");
      expect(labels).toContain("Globex");
      expect(labels).toContain("Log out");
      expect(labels.some((label) => label.startsWith("Settings"))).toBe(true);
      expect(mocks.createOrg.mutate).not.toHaveBeenCalled();
    },
  );

  it("calls the same hooks before and after the org loads", () => {
    // The workspace menu's member count is a hook. When it sat below this component's early
    // returns, the render that had an org called one more hook than the loading render, and React
    // failed the whole app with "Rendered more hooks than during the previous render" (served
    // 4e691cd29f: every route showed the crash screen).
    mocks.useOrg.mockReturnValue({
      data: undefined,
      isLoading: true,
      dataUpdatedAt: 0,
    });
    render(<OrgSwitcher />);
    mocks.useOrg.mockReturnValue({
      data: ownerOrg,
      isLoading: false,
      dataUpdatedAt: 1,
    });
    expect(() => render(<OrgSwitcher />)).not.toThrow();
    expect(container.querySelector("button")).not.toBeNull();
  });
});
