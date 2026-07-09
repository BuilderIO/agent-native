// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useOrg: vi.fn(),
}));

vi.mock("react-router", () => ({
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

vi.mock("./workspace-app-links.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./workspace-app-links.js")>();
  return {
    ...actual,
    useOrgSwitcherAppLinks: () => ({
      apps: [],
      dispatchAllAppsHref: "/dispatch/apps",
      dispatchHref: "/dispatch",
      isLoading: false,
      isWorkspace: false,
    }),
  };
});

import { OrgSwitcher } from "./OrgSwitcher.js";

describe("OrgSwitcher", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.useOrg.mockReset();
    mocks.navigate.mockReset();
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

  it("renders a disabled loading placeholder when reserveSpace is enabled", () => {
    mocks.useOrg.mockReturnValue({ data: undefined, isLoading: true });

    render(<OrgSwitcher reserveSpace />);

    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute("aria-label")).toBe("Loading organization");
    expect(button?.className).toContain("animate-pulse");
  });

  it("does not render while loading unless reserveSpace is enabled", () => {
    mocks.useOrg.mockReturnValue({ data: undefined, isLoading: true });

    render(<OrgSwitcher />);

    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toBe("");
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

    expect(mocks.navigate).toHaveBeenCalledWith("/settings#organization");
    expect(openPanel).not.toHaveBeenCalled();
    expect(openSettings).not.toHaveBeenCalled();

    window.removeEventListener("agent-panel:open", openPanel);
    window.removeEventListener("agent-panel:open-settings", openSettings);
  });
});
