import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.fn();
const mockWriteAppState = vi.fn();
const mockGetCurrentOwnerEmail = vi.fn();
const mockRequireActiveOrganizationId = vi.fn();
const mockDb = {
  select: vi.fn(),
  update: vi.fn(),
};

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ op: "and", args }),
  eq: (...args: unknown[]) => ({ op: "eq", args }),
  inArray: (...args: unknown[]) => ({ op: "inArray", args }),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
  registerShareableResource: vi.fn(),
}));

vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => mockGetCurrentOwnerEmail(),
  parseSpaceIds: (raw: string | null | undefined) =>
    raw ? (JSON.parse(raw) as string[]) : [],
  requireActiveOrganizationId: () => mockRequireActiveOrganizationId(),
  sameOwnerEmail: (
    a: string | null | undefined,
    b: string | null | undefined,
  ) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase(),
}));

vi.mock("../server/db/index.js", () => {
  return {
    getDb: () => mockDb,
    schema: {
      folders: {
        id: "folders.id",
        organizationId: "folders.organizationId",
        ownerEmail: "folders.ownerEmail",
        spaceId: "folders.spaceId",
      },
      recordings: {
        id: "recordings.id",
        organizationId: "recordings.organizationId",
        folderId: "recordings.folderId",
        spaceIds: "recordings.spaceIds",
        updatedAt: "recordings.updatedAt",
      },
    },
  };
});

import action from "./move-recording";

function setupUpdate() {
  const updateBuilder = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
  mockDb.update.mockReturnValue(updateBuilder);
  return updateBuilder;
}

function setupFolderAndRecordings(
  folderRows: Array<{
    id: string;
    organizationId: string;
    ownerEmail: string;
    spaceId: string | null;
  }>,
  recordingRows: Array<{
    id: string;
    organizationId: string;
    spaceIds: string;
  }>,
) {
  const folderSelect = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(folderRows),
  };
  const recordingsSelect = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(recordingRows),
  };
  mockDb.select
    .mockReturnValueOnce(folderSelect)
    .mockReturnValueOnce(recordingsSelect);
  return { folderSelect, recordingsSelect };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.select.mockReset();
  mockDb.update.mockReset();
  mockAssertAccess.mockResolvedValue(undefined);
  mockWriteAppState.mockResolvedValue(undefined);
  mockGetCurrentOwnerEmail.mockReturnValue("owner@example.com");
  mockRequireActiveOrganizationId.mockResolvedValue("org_1");
});

describe("move-recording action", () => {
  it("moves multiple recordings to one validated personal folder", async () => {
    const updateBuilder = setupUpdate();
    setupFolderAndRecordings(
      [
        {
          id: "folder_1",
          organizationId: "org_1",
          ownerEmail: "owner@example.com",
          spaceId: null,
        },
      ],
      [
        { id: "rec_a", organizationId: "org_1", spaceIds: "[]" },
        { id: "rec_b", organizationId: "org_1", spaceIds: "[]" },
      ],
    );

    const result = await action.run({
      ids: ["rec_a", "rec_b"],
      folderId: "folder_1",
    });

    expect(mockAssertAccess).toHaveBeenCalledTimes(2);
    expect(mockAssertAccess).toHaveBeenNthCalledWith(
      1,
      "recording",
      "rec_a",
      "editor",
    );
    expect(mockAssertAccess).toHaveBeenNthCalledWith(
      2,
      "recording",
      "rec_b",
      "editor",
    );
    expect(updateBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: "folder_1" }),
    );
    expect(mockWriteAppState).toHaveBeenCalledWith(
      "refresh-signal",
      expect.objectContaining({ ts: expect.any(Number) }),
    );
    expect(result).toEqual({
      id: "rec_a",
      ids: ["rec_a", "rec_b"],
      count: 2,
      folderId: "folder_1",
    });
  });

  it("preserves the single id contract and clears folderId for root moves", async () => {
    const updateBuilder = setupUpdate();

    const result = await action.run({ id: "rec_a", folderId: null });

    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "recording",
      "rec_a",
      "editor",
    );
    expect(updateBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: null }),
    );
    expect(result).toEqual({
      id: "rec_a",
      ids: ["rec_a"],
      count: 1,
      folderId: null,
    });
  });

  it("rejects personal folders owned by another user", async () => {
    setupUpdate();
    setupFolderAndRecordings(
      [
        {
          id: "folder_1",
          organizationId: "org_1",
          ownerEmail: "other@example.com",
          spaceId: null,
        },
      ],
      [{ id: "rec_a", organizationId: "org_1", spaceIds: "[]" }],
    );

    await expect(
      action.run({ id: "rec_a", folderId: "folder_1" }),
    ).rejects.toThrow("Folder not found: folder_1");

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("rejects space folders when a recording is outside that space", async () => {
    setupUpdate();
    setupFolderAndRecordings(
      [
        {
          id: "folder_1",
          organizationId: "org_1",
          ownerEmail: "owner@example.com",
          spaceId: "space_1",
        },
      ],
      [{ id: "rec_a", organizationId: "org_1", spaceIds: "[]" }],
    );

    await expect(
      action.run({ id: "rec_a", folderId: "folder_1" }),
    ).rejects.toThrow(
      "Target folder must belong to the same organization and space as every recording.",
    );

    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
