import { vi } from "vitest";

export interface InvitationFixture {
  id: string;
  email: string;
  role: string;
  createdAt: number;
  status: string;
  invitedBy: string;
}

export function invitation(id: string, email: string): InvitationFixture {
  return {
    id,
    email,
    role: "member",
    createdAt: 1,
    status: "pending",
    invitedBy: "admin@example.test",
  };
}

/** What the mocked invitations hook answers with; a test sets it before it mounts. */
export const users = {
  invitations: [] as InvitationFixture[],
  writeText: vi.fn(async (_text: string) => undefined),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  reset() {
    this.invitations = [];
    this.writeText.mockReset();
    this.writeText.mockImplementation(async () => undefined);
    this.toastSuccess.mockClear();
    this.toastError.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: this.writeText },
    });
  },
};

export const orgMock = {
  useOrgInvitations: () => ({
    data: { invitations: users.invitations },
    isPending: false,
    error: null,
    refetch: vi.fn(async () => undefined),
  }),
  useOrgMembers: () => ({
    data: { members: [], totalCount: 0, hasMore: false, nextOffset: null },
    isPending: false,
    error: null,
    refetch: vi.fn(async () => undefined),
  }),
  useOrgDeactivatedMembers: () => ({
    data: { members: [] },
    isPending: false,
    error: null,
    refetch: vi.fn(async () => undefined),
  }),
  useOrg: () => ({ data: { allowedDomain: null } }),
  useSetOrgDomain: () => ({
    mutateAsync: async () => undefined,
    isPending: false,
    error: null,
  }),
};

// The members surface is the shared page; these suites are about the app's own rows.
export const orgPageMock = {
  OrgMembersPage: () => <div data-members-page="" />,
};

export const toastMock = {
  toast: {
    success: (...args: unknown[]) => users.toastSuccess(...args),
    error: (...args: unknown[]) => users.toastError(...args),
  },
};
