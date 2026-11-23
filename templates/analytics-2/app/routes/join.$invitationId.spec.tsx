// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  pending: [] as Array<Record<string, unknown>>,
  orgLoading: false,
  orgError: false,
  orgData: true,
  refetch: vi.fn(),
  roster: [] as Array<Record<string, unknown>>,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, vars?: Record<string, unknown>) =>
    `${key}${vars?.orgName ? `:${String(vars.orgName)}` : ""}${
      vars?.inviter ? `:${String(vars.inviter)}` : ""
    }`,
}));
vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({
    data: mocks.orgData
      ? { email: "invited@example.test", pendingInvitations: mocks.pending }
      : undefined,
    isLoading: mocks.orgLoading,
    isError: mocks.orgError,
    refetch: mocks.refetch,
  }),
  useOrgInvitations: () => ({ data: { invitations: mocks.roster } }),
  useAcceptInvitation: () => ({
    mutate: mocks.mutate,
    isError: false,
    error: null,
    isPending: false,
  }),
}));

import JoinWorkspaceRoute from "./join.$invitationId";
describe("join route", () => {
  let host: HTMLDivElement;
  let root: Root;

  function render(path: string) {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              element={<JoinWorkspaceRoute />}
              path="/join/:invitationId"
            />
          </Routes>
        </MemoryRouter>,
      );
    });
  }

  const joinButton = () =>
    [...host.querySelectorAll("button")].find((element) =>
      element.textContent?.includes("analytics.settings.inviteLink.join"),
    );

  beforeEach(() => {
    (
      globalThis as unknown as Record<string, unknown>
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.pending = [
      {
        id: "invite-1",
        orgId: "org-1",
        orgName: "Acme Data",
        invitedBy: "owner@example.test",
      },
    ];
    mocks.roster = [];
    mocks.orgLoading = false;
    mocks.orgError = false;
    mocks.orgData = true;
    mocks.refetch.mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
    mocks.mutate.mockClear();
  });

  it("finds the invitee's own invitation, names the workspace and accepts it", () => {
    render("/join/invite-1");
    expect(host.textContent).toContain(
      "analytics.settings.inviteLink.joinDescription:Acme Data:owner@example.test",
    );
    expect(host.textContent).not.toContain("joinNotFound");
    act(() => joinButton()?.click());
    expect(mocks.mutate).toHaveBeenCalledWith(
      "invite-1",
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("says so, and offers no join, when the signed-in account has no such invitation", () => {
    render("/join/someone-elses-invite");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "analytics.settings.inviteLink.joinNotFound",
    );
    expect(joinButton()?.hasAttribute("disabled")).toBe(true);
  });

  it("does not claim the invitation is missing while the account is still loading", () => {
    mocks.pending = [];
    mocks.orgLoading = true;
    render("/join/invite-1");
    expect(host.textContent).not.toContain("joinNotFound");
  });

  it("reports a failed workspace read and retries it instead of sitting silent with a dead button", () => {
    mocks.orgData = false;
    mocks.orgError = true;
    render("/join/invite-1");
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(
      "analytics.settings.inviteLink.joinLoadFailed",
    );
    expect(host.textContent).not.toContain("joinNotFound");
    const retry = [...host.querySelectorAll("button")].find((element) =>
      element.textContent?.includes("joinRetry"),
    );
    act(() => retry?.click());
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
