// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  action: { error: null, isPending: false, mutate: vi.fn() },
  changeRole: { error: null, isPending: false, mutate: vi.fn() },
  removeMember: { error: null, isPending: false, mutate: vi.fn() },
}));

vi.mock("./hooks.js", () => ({
  useAppRoles: () => ({ data: undefined }),
  useChangeMemberRole: () => mocks.changeRole,
  useRemoveMember: () => mocks.removeMember,
}));

vi.mock("../use-action.js", () => ({
  useActionMutation: () => mocks.action,
}));

vi.mock("../i18n.js", () => ({
  useT: () => (key: string, options?: { count?: number }) => {
    if (key === "org.admin") return "Admin";
    if (key === "org.member") return "Member";
    if (key === "org.members") return "Members";
    if (key === "org.memberCount") return `${options?.count ?? 0} members`;
    if (key === "org.changeRole") return "Change role";
    if (key === "org.removeMember") return "Remove member";
    if (key === "org.searchPeople") return "Search people";
    if (key === "org.noPeopleFound") return "No people found";
    if (key === "org.noMembers") return "No members";
    if (key === "org.inviteMembers") return "Invite members";
    return key;
  },
}));

import { TooltipProvider } from "../components/ui/tooltip.js";
import { MemberRow, MembersTableCard } from "./TeamPage.js";

describe("MemberRow organization controls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function renderRow(
    currentUserRole: "owner" | "admin",
    role: "admin" | "member",
  ) {
    act(() => {
      root.render(
        <TooltipProvider>
          <MemberRow
            email="liam@builder.io"
            role={role}
            isCurrentUser={false}
            currentUserRole={currentUserRole}
          />
        </TooltipProvider>,
      );
    });
  }

  it("lets an admin remove an ordinary member without offering role changes", () => {
    renderRow("admin", "member");

    expect(
      container.querySelector('[aria-label="Remove member"]'),
    ).not.toBeNull();
    expect(container.querySelector('[aria-label="Change role"]')).toBeNull();
  });

  it("does not offer an admin controls for another admin", () => {
    renderRow("admin", "admin");

    expect(container.querySelector('[aria-label="Remove member"]')).toBeNull();
    expect(container.querySelector('[aria-label="Change role"]')).toBeNull();
  });

  it("offers the owner both controls for non-owner members", () => {
    renderRow("owner", "admin");

    expect(
      container.querySelector('[aria-label="Remove member"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Change role"]'),
    ).not.toBeNull();
  });

  it("does not offer controls for the current user's own row", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <MemberRow
            email="owner@builder.io"
            role="owner"
            isCurrentUser
            currentUserRole="owner"
          />
        </TooltipProvider>,
      );
    });

    expect(container.querySelector('[aria-label="Remove member"]')).toBeNull();
    expect(container.querySelector('[aria-label="Change role"]')).toBeNull();
  });

  it("renders searchable member controls together for an admin", () => {
    const onMemberSearchChange = vi.fn();

    act(() => {
      root.render(
        <TooltipProvider>
          <MembersTableCard
            members={[]}
            totalMembers={148}
            pendingInvites={[]}
            isLoadingMembers={false}
            isFetchingMembers={false}
            membersError={null}
            onRetryMembers={vi.fn()}
            currentUserEmail="admin@builder.io"
            currentUserRole="admin"
            groups={[]}
            canManageGroups={false}
            memberOffset={0}
            memberSearch=""
            activeMemberSearch=""
            hasNextPage={false}
            nextMemberOffset={null}
            onMemberPageChange={vi.fn()}
            onMemberSearchChange={onMemberSearchChange}
          />
        </TooltipProvider>,
      );
    });

    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search people"]',
    );
    expect(search).not.toBeNull();
    expect(container.textContent).toContain("Invite members");

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(search, "liam");
      search!.dispatchEvent(new Event("input", { bubbles: true }));
      search!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onMemberSearchChange).toHaveBeenCalledWith("liam");
  });

  it("uses a search-specific empty state", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <MembersTableCard
            members={[]}
            totalMembers={0}
            pendingInvites={[]}
            isLoadingMembers={false}
            isFetchingMembers={false}
            membersError={null}
            onRetryMembers={vi.fn()}
            currentUserEmail="member@builder.io"
            currentUserRole="member"
            groups={[]}
            canManageGroups={false}
            memberOffset={0}
            memberSearch="nobody"
            activeMemberSearch="nobody"
            hasNextPage={false}
            nextMemberOffset={null}
            onMemberPageChange={vi.fn()}
            onMemberSearchChange={vi.fn()}
          />
        </TooltipProvider>,
      );
    });

    expect(container.textContent).toContain("No people found");
    expect(container.textContent).not.toContain("Invite members");
  });
});
