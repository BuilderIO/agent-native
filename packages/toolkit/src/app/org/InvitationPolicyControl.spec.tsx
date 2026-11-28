// @vitest-environment happy-dom

import type { OrgInfo } from "@agent-native/core/org/types";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/org", () => ({
  useSetOrgInvitationPolicy: () => ({
    mutate: mocks.mutate,
    isPending: mocks.isPending,
  }),
}));

import { InvitationPolicyControl } from "./InvitationPolicyControl.js";

type Mode = "admins" | "members" | "org-setting";

function org(
  role: OrgInfo["role"],
  mode: Mode,
  onlyAdminsCanInvite = false,
  invalid?: boolean,
): OrgInfo {
  return {
    role,
    memberInvitations: { mode, onlyAdminsCanInvite, invalid },
  } as OrgInfo;
}

describe("InvitationPolicyControl", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.mutate.mockReset();
    mocks.isPending = false;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (value: OrgInfo) =>
    act(() => root.render(<InvitationPolicyControl org={value} />));

  it.each(["owner", "admin"] as const)(
    "lets an %s toggle the stored policy in org-setting mode",
    (role) => {
      render(org(role, "org-setting", false));
      const toggle =
        container.querySelector<HTMLButtonElement>('[role="switch"]');
      expect(toggle?.getAttribute("aria-checked")).toBe("false");
      act(() => toggle?.click());
      expect(mocks.mutate).toHaveBeenCalledWith(true);
    },
  );

  it("reflects and turns off a stored only-admins policy", () => {
    render(org("admin", "org-setting", true));
    const toggle =
      container.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    act(() => toggle?.click());
    expect(mocks.mutate).toHaveBeenCalledWith(false);
  });

  it.each(["admins", "members"] as const)("is hidden in %s mode", (mode) => {
    render(org("owner", mode));
    expect(container.querySelector('[role="switch"]')).toBeNull();
  });

  it("is hidden from ordinary members", () => {
    render(org("member", "org-setting"));
    expect(container.querySelector('[role="switch"]')).toBeNull();
  });

  it("tells an admin the saved setting is invalid so they can repair it", () => {
    render(org("admin", "org-setting", true, true));
    expect(container.textContent).toContain(
      "agentChat.settingsOrg.invitationPolicyInvalid",
    );
  });
});
