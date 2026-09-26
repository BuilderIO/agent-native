// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  action: { error: null, isPending: false, mutate: vi.fn() },
  changeRole: { error: null, isPending: false, mutate: vi.fn() },
  removeMember: { error: null, isPending: false, mutate: vi.fn() },
  setOrgDomain: { error: null, isPending: false, mutate: vi.fn() },
}));

vi.mock("./hooks.js", () => ({
  useAppRoles: () => ({ data: undefined }),
  useChangeMemberRole: () => mocks.changeRole,
  useRemoveMember: () => mocks.removeMember,
  useSetAppMemberRoles: () => mocks.action,
  useSetOrgDomain: () => mocks.setOrgDomain,
}));

vi.mock("../use-action.js", () => ({
  useActionMutation: () => mocks.action,
}));

vi.mock("../i18n.js", () => ({
  useT:
    () =>
    (
      key: string,
      options?: { count?: number; name?: string; domain?: string },
    ) => {
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
      if (key === "org.appPermissions") return "App permissions";
      if (key === "org.loading") return "Loading";
      if (key === "org.newGroup") return "New group";
      if (key === "org.groups") return "Groups";
      if (key === "org.groupName") return "Group name";
      if (key === "org.deleteGroup") return "Delete group?";
      if (key === "org.deleteGroupAria") {
        return `Delete group ${options?.name ?? ""}`;
      }
      if (key === "org.cancel") return "Cancel";
      if (key === "org.delete") return "Delete";
      if (key === "org.enableDomainJoin") {
        return `Enable for @${options?.domain ?? ""}`;
      }
      return key;
    },
}));

import { TooltipProvider } from "../components/ui/tooltip.js";
import {
  DomainSettingsSection,
  MemberRow,
  MembersTableCard,
  WorkspaceGroupsCard,
} from "./TeamPage.js";

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
            email="morgan@example.test"
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

  it("offers an explain-access popover for members with app permissions", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <MemberRow
            email="morgan@example.test"
            role="member"
            isCurrentUser={false}
            currentUserRole="owner"
            appRoles={{
              appId: "dispatch",
              roles: ["editor"],
              permissions: { approve: ["editor"] },
            }}
            appRole={[]}
            canManageAppRoles
          />
        </TooltipProvider>,
      );
    });

    expect(
      container.querySelector('[aria-label="App permissions"]'),
    ).not.toBeNull();
  });

  it("does not offer controls for the current user's own row", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <MemberRow
            email="owner@example.test"
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
            currentUserEmail="admin@example.test"
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
            onCreateGroup={vi.fn()}
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
      valueSetter?.call(search, "morgan");
      search!.dispatchEvent(new Event("input", { bubbles: true }));
      search!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onMemberSearchChange).toHaveBeenCalledWith("morgan");
  });

  it("hides the invite flow when email delivery is not configured", () => {
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
            currentUserEmail="admin@example.test"
            currentUserRole="admin"
            emailConfigured={false}
            groups={[]}
            canManageGroups={false}
            memberOffset={0}
            memberSearch=""
            activeMemberSearch=""
            hasNextPage={false}
            nextMemberOffset={null}
            onMemberPageChange={vi.fn()}
            onMemberSearchChange={vi.fn()}
            onCreateGroup={vi.fn()}
          />
        </TooltipProvider>,
      );
    });

    expect(container.textContent).not.toContain("Invite members");
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
            currentUserEmail="member@example.test"
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
            onCreateGroup={vi.fn()}
          />
        </TooltipProvider>,
      );
    });

    expect(container.textContent).toContain("No people found");
    expect(container.textContent).not.toContain("Invite members");
  });

  it("offers to create a group for selected members when none exist", () => {
    const onCreateGroup = vi.fn();

    act(() => {
      root.render(
        <TooltipProvider>
          <MembersTableCard
            members={[
              {
                email: "morgan@example.test",
                role: "member",
              },
            ]}
            totalMembers={1}
            pendingInvites={[]}
            isLoadingMembers={false}
            isFetchingMembers={false}
            membersError={null}
            onRetryMembers={vi.fn()}
            currentUserEmail="owner@example.test"
            currentUserRole="owner"
            groups={[]}
            canManageGroups
            memberOffset={0}
            memberSearch=""
            activeMemberSearch=""
            hasNextPage={false}
            nextMemberOffset={null}
            onMemberPageChange={vi.fn()}
            onMemberSearchChange={vi.fn()}
            onCreateGroup={onCreateGroup}
          />
        </TooltipProvider>,
      );
    });

    const select = container.querySelector<HTMLButtonElement>(
      '[aria-label="Select morgan@example.test"]',
    );
    expect(select).not.toBeNull();
    act(() => select?.click());

    const createButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "New group");
    expect(createButton).not.toBeUndefined();
    act(() => createButton?.click());

    expect(onCreateGroup).toHaveBeenCalledWith(["morgan@example.test"]);
  });

  it("keeps a failed group deletion open with its error visible", () => {
    mocks.action.mutate.mockImplementation((_input, options) => {
      options?.onError?.(new Error("Delete failed"));
    });

    act(() => {
      root.render(
        <WorkspaceGroupsCard
          groups={[
            {
              id: "group-1",
              orgId: "org-1",
              name: "Rev Ops",
              memberEmails: [],
              createdByEmail: "owner@example.test",
              createdAt: new Date(0).toISOString(),
              updatedAt: new Date(0).toISOString(),
            },
          ]}
          onNewGroup={vi.fn()}
          onEditGroup={vi.fn()}
        />,
      );
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Delete group Rev Ops"]')
        ?.click();
    });

    const input = document.querySelector<HTMLInputElement>(
      "#workspace-delete-group-name-group-1",
    );
    expect(input?.labels?.[0]?.textContent).toBe("Group name");
    expect(input).not.toBeNull();
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "Rev Ops");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    act(() => {
      Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === "Delete")
        ?.click();
    });

    expect(document.body.textContent).toContain("Delete failed");
    expect(
      document.querySelector("#workspace-delete-group-name-group-1"),
    ).not.toBeNull();
  });

  it("retains text-primary-foreground and excludes hover:text-inherit on solid primary button", async () => {
    await act(async () => {
      root.render(
        <WorkspaceGroupsCard
          groups={[]}
          onNewGroup={vi.fn()}
          onEditGroup={vi.fn()}
        />,
      );
    });

    const newGroupBtn = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((btn) => btn.textContent?.includes("New group"));

    expect(newGroupBtn).toBeDefined();

    const classes = newGroupBtn!.className.split(/\s+/);
    expect(classes).toContain("text-primary-foreground");
    expect(classes).not.toContain("hover:text-inherit");
  });
});

describe("DomainSettingsSection", () => {
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

  function renderSection(domain: string | null, ownerEmail: string) {
    act(() => {
      root.render(
        <TooltipProvider>
          <DomainSettingsSection domain={domain} ownerEmail={ownerEmail} />
        </TooltipProvider>,
      );
    });
  }

  it("offers a one-click enable for an eligible unset domain and calls the mutation directly", () => {
    renderSection(null, "admin@acme.com");

    const enableButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "Enable for @acme.com");
    expect(enableButton).not.toBeUndefined();

    // No free-text field ceremony: the only legal value is already known.
    expect(container.querySelector("input")).toBeNull();

    act(() => enableButton?.click());
    expect(mocks.setOrgDomain.mutate).toHaveBeenCalledWith("acme.com");
  });

  it("does not offer the one-click when the owner's own domain is a free email provider", () => {
    renderSection(null, "admin@gmail.com");

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).map((button) => button.textContent?.trim());
    expect(buttons.some((text) => text?.startsWith("Enable for"))).toBe(false);
    expect(container.querySelector("input")).toBeNull();
    expect(mocks.setOrgDomain.mutate).not.toHaveBeenCalled();
  });
});
