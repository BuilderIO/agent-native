import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteAppState = vi.fn();
const mockGetCurrentOwnerEmail = vi.fn();
const mockDb = {
  select: vi.fn(),
  update: vi.fn(),
};

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ op: "eq", args }),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("@agent-native/core/org", () => ({
  orgInvitations: {
    id: "org_invitations.id",
    orgId: "org_invitations.orgId",
    email: "org_invitations.email",
  },
}));

vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => mockGetCurrentOwnerEmail(),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
}));

import action from "./decline-invite";

function setupSelect(
  rows: Array<{ id: string; orgId: string; email: string }>,
) {
  const selectBuilder = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  mockDb.select.mockReturnValue(selectBuilder);
  return selectBuilder;
}

function setupUpdate() {
  const updateBuilder = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
  mockDb.update.mockReturnValue(updateBuilder);
  return updateBuilder;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.select.mockReset();
  mockDb.update.mockReset();
  mockWriteAppState.mockResolvedValue(undefined);
});

describe("decline-invite action", () => {
  it("rejects a caller whose email does not match the invite recipient and leaves the row unchanged", async () => {
    setupSelect([
      { id: "invite_1", orgId: "org_1", email: "recipient@example.com" },
    ]);
    const updateBuilder = setupUpdate();
    mockGetCurrentOwnerEmail.mockReturnValue("attacker@example.com");

    await expect(action.run({ token: "invite_1" })).rejects.toThrow(
      "This invite was sent to a different email address.",
    );

    expect(mockDb.update).not.toHaveBeenCalled();
    expect(updateBuilder.set).not.toHaveBeenCalled();
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("allows the legitimate recipient (case/whitespace-insensitive) to decline", async () => {
    setupSelect([
      { id: "invite_1", orgId: "org_1", email: "  Recipient@Example.com  " },
    ]);
    const updateBuilder = setupUpdate();
    mockGetCurrentOwnerEmail.mockReturnValue("recipient@example.com");

    const result = await action.run({ token: "invite_1" });

    expect(updateBuilder.set).toHaveBeenCalledWith({ status: "rejected" });
    expect(mockWriteAppState).toHaveBeenCalledWith(
      "refresh-signal",
      expect.objectContaining({ ts: expect.any(Number) }),
    );
    expect(result).toEqual({ declined: true, organizationId: "org_1" });
  });

  it("returns not found without querying the caller's identity check when the invite is missing", async () => {
    setupSelect([]);
    const updateBuilder = setupUpdate();
    mockGetCurrentOwnerEmail.mockReturnValue("someone@example.com");

    const result = await action.run({ token: "missing" });

    expect(result).toEqual({ declined: false, error: "Invite not found." });
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(updateBuilder.set).not.toHaveBeenCalled();
  });
});
