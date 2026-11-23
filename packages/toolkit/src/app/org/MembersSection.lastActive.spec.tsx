// @vitest-environment happy-dom

import { TooltipProvider } from "@agent-native/toolkit/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ error: null, isPending: false, mutate: vi.fn() }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => (key === "org.you" ? "You" : key),
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({ data: null }),
  useOrgMembers: () => ({ data: null }),
  useOrgInvitations: () => ({ data: null }),
  useChangeMemberRole: () => ({
    error: null,
    isPending: false,
    mutate: vi.fn(),
  }),
  useRemoveMember: () => ({ error: null, isPending: false, mutate: vi.fn() }),
  useAppRoles: () => ({ data: null }),
  useSetAppMemberRoles: () => ({
    error: null,
    isPending: false,
    mutate: vi.fn(),
  }),
  ORG_MEMBER_PAGE_SIZE: 25,
}));

vi.mock("./GroupsSection.js", () => ({
  WorkspaceGroupEditor: () => null,
  useWorkspaceGroupEditor: () => null,
  useWorkspaceUserGroups: () => ({ data: [] }),
}));

import { MemberRow, memberLastActiveLabel } from "./MembersSection.js";

/**
 * The reference's member table lists when each member was last active (it sorts
 * by name, email, role and last active). These rules hold without a server.
 */
describe("members row last active", () => {
  it("labels today, yesterday and older activity", () => {
    const now = new Date("2026-05-20T18:00:00Z").getTime();
    const day = 24 * 60 * 60 * 1000;
    expect(memberLastActiveLabel(now - 60_000, now)).toBe("Today");
    expect(memberLastActiveLabel(now - day - 60_000, now)).toBe("Yesterday");
    expect(memberLastActiveLabel(now - 40 * day, now)).toBe("Apr 10, 2026");
  });

  it("says nothing for a member that was never seen active", () => {
    expect(memberLastActiveLabel(null)).toBeNull();
    expect(memberLastActiveLabel(undefined)).toBeNull();
    expect(memberLastActiveLabel(Number.NaN)).toBeNull();
  });

  it("renders the label inside the member row", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <MemberRow
              email="member@example.test"
              role="member"
              name="QA member"
              lastActiveAt={Date.now() - 60_000}
              isCurrentUser={false}
              currentUserRole="admin"
            />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    const node = container.querySelector(
      '[data-rid="settings.users.member.last-active"]',
    );
    expect(node?.textContent).toBe("Last active Today");
    act(() => root.unmount());
    container.remove();
  });

  it("keeps the row clean for a member without activity", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <MemberRow
              email="quiet@example.test"
              role="member"
              name="Quiet member"
              lastActiveAt={null}
              isCurrentUser={false}
              currentUserRole="admin"
            />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    expect(
      container.querySelector('[data-rid="settings.users.member.last-active"]'),
    ).toBeNull();
    act(() => root.unmount());
    container.remove();
  });
});
