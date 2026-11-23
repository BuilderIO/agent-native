// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invitations: [] as Array<Record<string, unknown>>,
  invitationsPending: false,
  invitationsError: null as Error | null,
  invitationsMissingData: false,
  refetchInvitations: vi.fn(async () => undefined),
  members: [] as Array<Record<string, unknown>>,
  membersPending: false,
  membersError: null as Error | null,
  membersMissingData: false,
  refetchMembers: vi.fn(async () => undefined),
  deactivatedMembers: [] as Array<Record<string, unknown>>,
  groups: [] as Array<Record<string, unknown>>,
  writeText: vi.fn(async () => undefined),
  allowedDomain: "example.test" as string | null,
  setDomain: vi.fn(async (_domain: string | null) => undefined),
  setDomainError: null as Error | null,
}));

const copy: Record<string, string> = {
  "analytics.settings.users.description": "List of users in your workspace.",
  "analytics.settings.users.adminDescription": "Manage users in your workspace.",
  "analytics.settings.users.memberDetails.title": "Member details",
  "analytics.settings.users.memberDetails.loading": "Loading members…",
  "analytics.settings.users.memberDetails.loadError":
    "Could not load workspace members.",
  "analytics.settings.users.memberDetails.empty": "No workspace members yet.",
  "analytics.settings.users.memberDetails.columnMember": "Member",
  "analytics.settings.users.memberDetails.columnRole": "Role",
  "analytics.settings.users.memberDetails.columnGroups": "Groups",
  "analytics.settings.users.memberDetails.columnLastActive": "Last active",
  "analytics.settings.users.memberDetails.columnStatus": "Status",
  "analytics.settings.users.memberDetails.roleOwner": "Owner",
  "analytics.settings.users.memberDetails.roleAdmin": "Admin",
  "analytics.settings.users.memberDetails.roleMember": "Member",
  "analytics.settings.users.memberDetails.ownersCount": "{{count}} Owners",
  "analytics.settings.users.memberDetails.adminsCount": "{{count}} Admins",
  "analytics.settings.users.memberDetails.membersCount": "{{count}} Members",
  "analytics.settings.users.memberDetails.invitedCount": "{{count}} Invited",
  "analytics.settings.users.memberDetails.deactivatedCount":
    "{{count}} Deactivated",
  "analytics.settings.users.memberDetails.statusActive": "Active",
  "analytics.settings.users.memberDetails.statusInvited": "Invited",
  "analytics.settings.users.memberDetails.statusDeactivated": "Deactivated",
  "analytics.settings.users.memberDetails.lastActiveToday": "Today",
  "analytics.settings.users.memberDetails.lastActiveYesterday": "Yesterday",
  "analytics.settings.users.memberDetails.lastActiveNever": "Never",
  "analytics.settings.inviteLink.title": "Invite link",
  "analytics.settings.inviteLink.description":
    "Share a link that opens the workspace invitation for the person you invited.",
  "analytics.settings.inviteLink.empty":
    "No pending invitations. Invite someone to get a link.",
  "analytics.settings.inviteLink.loading": "Loading invitations…",
  "analytics.settings.inviteLink.loadError":
    "Could not load pending invitations.",
  "analytics.settings.inviteLink.copy": "Copy link",
  "analytics.settings.inviteLink.copied": "Invite link copied",
  "analytics.settings.allowedDomain.title": "Allowed email domain",
  "analytics.settings.allowedDomain.placeholder": "example.com",
  "analytics.settings.allowedDomain.saveFailed":
    "Could not save the allowed email domain.",
  "analytics.settings.inviteLink.copyFailed":
    "The invite link could not be copied.",
  "analytics.organizationCatalog.retry": "Retry",
};

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (name: string) =>
    name === "list-workspace-user-groups"
      ? { data: mocks.groups, isPending: false, error: null, refetch: vi.fn() }
      : { data: undefined, isPending: false, error: null, refetch: vi.fn() },
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useOptionalLocale: () => null,
  useT: () => (key: string, vars?: Record<string, unknown>) =>
    (copy[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
      String(vars?.[name] ?? ""),
    ),
}));
vi.mock("@agent-native/core/client/org", () => ({
  useOrgInvitations: () => ({
    data: mocks.invitationsMissingData
      ? undefined
      : { invitations: mocks.invitations },
    isPending: mocks.invitationsPending,
    error: mocks.invitationsError,
    refetch: mocks.refetchInvitations,
  }),
  useOrgMembers: () => ({
    data: mocks.membersMissingData
      ? undefined
      : {
          members: mocks.members,
          totalCount: mocks.members.length,
          hasMore: false,
          nextOffset: null,
        },
    isPending: mocks.membersPending,
    error: mocks.membersError,
    refetch: mocks.refetchMembers,
  }),
  useOrgDeactivatedMembers: () => ({
    data: { members: mocks.deactivatedMembers },
    isPending: false,
    error: null,
    refetch: vi.fn(async () => undefined),
  }),
  useOrg: () => ({ data: { allowedDomain: mocks.allowedDomain } }),
  useSetOrgDomain: () => ({
    mutateAsync: mocks.setDomain,
    isPending: false,
    error: mocks.setDomainError,
  }),
}));
// The members surface itself is the shared page; this suite is about the link.
vi.mock("@agent-native/toolkit/app/org", () => ({
  OrgMembersPage: () => <div data-members-page="" />,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("./RoleRequests", () => ({
  RoleRequestControl: () => (
    <div data-role-request-control="">Request admin access</div>
  ),
  RoleRequestQueue: () => <div>Role requests</div>,
}));

import {
  AnalyticsUsersPage,
  InviteLinks,
  inviteLinkFor,
} from "./AnalyticsUsersPage";

/**
 * Row 153: a reader asked for invite links. The invitations the members surface
 * already lists carry the id the accept endpoint takes, so an admin can copy that
 * as a URL instead of only sending mail.
 */
describe("invite links", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as unknown as Record<string, unknown>
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.invitations = [
      {
        id: "invite-1",
        email: "invited@example.test",
        role: "member",
        createdAt: 1,
        status: "pending",
        invitedBy: "admin@example.test",
      },
    ];
    mocks.invitationsPending = false;
    mocks.invitationsError = null;
    mocks.invitationsMissingData = false;
    mocks.refetchInvitations.mockClear();
    mocks.members = [
      {
        email: "owner@example.test",
        name: "Workspace Owner",
        role: "owner",
        joinedAt: 1,
        lastActiveAt: Date.now() - 60_000,
      },
      {
        email: "analyst@example.test",
        name: "Data Analyst",
        role: "member",
        joinedAt: 2,
        lastActiveAt: null,
      },
    ];
    mocks.membersPending = false;
    mocks.membersError = null;
    mocks.membersMissingData = false;
    mocks.refetchMembers.mockClear();
    mocks.deactivatedMembers = [
      {
        email: "former@example.test",
        role: "member",
        deactivatedAt: 3,
      },
    ];
    mocks.groups = [
      {
        id: "grp-1",
        orgId: "org-1",
        name: "Analytics Core",
        memberEmails: ["owner@example.test", "analyst@example.test"],
        createdByEmail: "owner@example.test",
        createdAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-01T00:00:00.000Z",
      },
    ];
    mocks.setDomainError = null;
    mocks.writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: mocks.writeText },
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  it("shows admin panels only to admins while keeping the member list and role request flow available", () => {
    act(() => root.render(<AnalyticsUsersPage isAdmin={false} />));
    expect(host.textContent).toContain("List of users in your workspace.");
    expect(host.querySelector("[data-members-page]")).not.toBeNull();
    expect(host.querySelector("[data-role-request-control]")).not.toBeNull();
    expect(host.textContent).toContain("Request admin access");
    expect(host.textContent).not.toContain("Invite link");
    expect(host.textContent).not.toContain("Role requests");

    act(() => root.render(<AnalyticsUsersPage isAdmin />));
    expect(host.textContent).toContain("Manage users in your workspace.");
    expect(host.textContent).not.toContain("List of users in your workspace.");
    expect(host.textContent).toContain("Invite link");
    expect(host.textContent).toContain("Role requests");
    expect(host.querySelector("[data-role-request-control]")).toBeNull();
  });

  it("builds the join link from the invitation id", () => {
    expect(inviteLinkFor("invite-1", "https://example.test")).toBe(
      "https://example.test/join/invite-1",
    );
    expect(inviteLinkFor("a b", "https://example.test/")).toBe(
      "https://example.test/join/a%20b",
    );
  });

  // A host that serves the app at a path answers the bare /join/<id> with 404:
  // labs serves /analytics-2/join/<id> and root /join/xyz is 404, so the pasted
  // link has to carry the mount path. The root-mount cases above stay as they are.
  it("keeps the app mount path in the join link", () => {
    expect(
      inviteLinkFor("invite-1", "https://labs.example.test", "/analytics-2"),
    ).toBe("https://labs.example.test/analytics-2/join/invite-1");
    expect(
      inviteLinkFor("a b", "https://labs.example.test/", "/analytics-2/"),
    ).toBe("https://labs.example.test/analytics-2/join/a%20b");
  });

  it("adds no mount when the app is served at the host root", () => {
    expect(inviteLinkFor("invite-1", "https://example.test", "")).toBe(
      "https://example.test/join/invite-1",
    );
  });

  it("shows one row per pending invitation, with its link and a copy control", () => {
    act(() => {
      root.render(<InviteLinks />);
    });
    const row = host.querySelector("[data-invite-link='invite-1']");
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("invited@example.test");
    expect(row?.textContent).toContain("/join/invite-1");
    expect(row?.textContent).toContain("Copy link");
  });

  it("copies the link to the clipboard", async () => {
    act(() => {
      root.render(<InviteLinks />);
    });
    const button = [...host.querySelectorAll("button")].find((element) =>
      element.textContent?.includes("Copy link"),
    );
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
    expect(mocks.writeText).toHaveBeenCalledWith(
      expect.stringContaining("/join/invite-1"),
    );
  });

  it("says there is nothing to share when no invitation is pending", () => {
    mocks.invitations = [];
    act(() => {
      root.render(<InviteLinks />);
    });
    expect(host.textContent).toContain(
      "No pending invitations. Invite someone to get a link.",
    );
  });

  it("shows the allowed email domain beside the invite links", () => {
    act(() => {
      root.render(<InviteLinks />);
    });
    expect(host.textContent).toContain("Allowed email domain");
    const input = host.querySelector<HTMLInputElement>(
      "input[placeholder='example.com']",
    );
    expect(input?.value).toBe("example.test");
  });

  it("shows loading state while pending invitations are loading instead of empty copy", () => {
    mocks.invitations = [];
    mocks.invitationsPending = true;
    mocks.invitationsMissingData = true;
    act(() => {
      root.render(<InviteLinks />);
    });
    expect(host.textContent).toContain("Loading invitations…");
    expect(host.textContent).not.toContain(
      "No pending invitations. Invite someone to get a link.",
    );
  });

  it("shows an error alert with retry when pending invitations fail to load or refresh", () => {
    mocks.invitationsError = new Error("Invitations unavailable");
    act(() => {
      root.render(<InviteLinks />);
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not load pending invitations.",
    );
    expect(host.querySelector("[data-invite-link='invite-1']")).toBeNull();
    expect(host.textContent).not.toContain(
      "No pending invitations. Invite someone to get a link.",
    );
    const retry = [...host.querySelectorAll("button")].find((element) =>
      element.textContent?.includes("Retry"),
    );
    expect(retry).toBeDefined();
    act(() => {
      retry?.click();
    });
    expect(mocks.refetchInvitations).toHaveBeenCalledTimes(1);
  });

  it("surfaces allowed email domain save failures", () => {
    mocks.setDomainError = new Error("Domain already claimed");
    act(() => {
      root.render(<InviteLinks />);
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Domain already claimed",
    );
  });

  it("shows member details with role counts, groups, last active, and status", () => {
    act(() => {
      root.render(<AnalyticsUsersPage isAdmin={false} />);
    });
    const section = host.querySelector("[data-member-details]");
    expect(section).not.toBeNull();
    expect(
      host.querySelector('[data-role-count="owner"]')?.textContent,
    ).toContain("1 Owners");
    expect(
      host.querySelector('[data-role-count="admin"]')?.textContent,
    ).toContain("0 Admins");
    expect(
      host.querySelector('[data-role-count="member"]')?.textContent,
    ).toContain("1 Members");

    const ownerRow = host.querySelector(
      '[data-member-detail="owner@example.test"]',
    );
    expect(ownerRow?.textContent).toContain("Workspace Owner");
    expect(ownerRow?.textContent).toContain("Analytics Core");
    expect(ownerRow?.textContent).toContain("Today");
    expect(
      ownerRow?.querySelector('[data-member-status="active"]')?.textContent,
    ).toBe("Active");

    const analystRow = host.querySelector(
      '[data-member-detail="analyst@example.test"]',
    );
    expect(analystRow?.textContent).toContain("Never");

    const invitedRow = host.querySelector(
      '[data-member-detail="invited@example.test"]',
    );
    expect(
      invitedRow?.querySelector('[data-member-status="invited"]')?.textContent,
    ).toBe("Invited");

    const deactivatedRow = host.querySelector(
      '[data-member-detail="former@example.test"]',
    );
    expect(
      deactivatedRow?.querySelector('[data-member-status="deactivated"]')
        ?.textContent,
    ).toBe("Deactivated");
  });

  it("shows loading and retryable error states for member details", () => {
    mocks.membersPending = true;
    mocks.membersMissingData = true;
    act(() => {
      root.render(<AnalyticsUsersPage isAdmin={false} />);
    });
    expect(host.textContent).toContain("Loading members…");
    expect(host.textContent).not.toContain("No workspace members yet.");

    mocks.membersPending = false;
    mocks.membersError = new Error("Members unavailable");
    act(() => {
      root.render(<AnalyticsUsersPage isAdmin={false} />);
    });
    expect(
      host.querySelector('[data-member-details] [role="alert"]')?.textContent,
    ).toContain("Could not load workspace members.");
    const retry = [
      ...host.querySelectorAll<HTMLButtonElement>(
        "[data-member-details] button",
      ),
    ].find((element) => element.textContent?.includes("Retry"));
    expect(retry).toBeDefined();
    act(() => {
      retry?.click();
    });
    expect(mocks.refetchMembers).toHaveBeenCalledTimes(1);
  });
});
