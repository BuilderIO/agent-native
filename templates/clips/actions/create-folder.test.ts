import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteAppState = vi.fn();
const mockGetCurrentOwnerEmail = vi.fn();
const mockOwnerEmailMatches = vi.fn();
const mockRequireOrganizationAccess = vi.fn();
const mockNanoid = vi.fn();
const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
};

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => mockGetCurrentOwnerEmail(),
  nanoid: () => mockNanoid(),
  ownerEmailMatches: (...args: unknown[]) => mockOwnerEmailMatches(...args),
  requireOrganizationAccess: (...args: unknown[]) =>
    mockRequireOrganizationAccess(...args),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    folders: {
      id: "folders.id",
      organizationId: "folders.organizationId",
      ownerEmail: "folders.ownerEmail",
      spaceId: "folders.spaceId",
      parentId: "folders.parentId",
      position: "folders.position",
      name: "folders.name",
      createdAt: "folders.createdAt",
    },
    spaces: {
      id: "spaces.id",
      organizationId: "spaces.organizationId",
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ op: "and", args }),
  eq: (...args: unknown[]) => ({ op: "eq", args }),
  isNull: (...args: unknown[]) => ({ op: "isNull", args }),
  sql: () => ({ raw: "sql" }),
}));

import action from "./create-folder";

function setupInsert() {
  const insertBuilder = {
    values: vi.fn().mockResolvedValue(undefined),
  };
  mockDb.insert.mockReturnValue(insertBuilder);
  return insertBuilder;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.select.mockReset();
  mockDb.insert.mockReset();
  mockOwnerEmailMatches.mockReset();
  mockWriteAppState.mockResolvedValue(undefined);
  mockGetCurrentOwnerEmail.mockReturnValue("owner@example.com");
  mockRequireOrganizationAccess.mockResolvedValue({ organizationId: "org_1" });
  mockNanoid.mockReturnValue("folder_1");
});

describe("create-folder action", () => {
  it("does not create a child under another user's personal parent", async () => {
    const insertBuilder = setupInsert();
    const ownerPredicate = { kind: "owner-email-match" };
    mockOwnerEmailMatches.mockReturnValue(ownerPredicate);
    const parentSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockImplementation((condition) => {
        expect(condition).toMatchObject({
          op: "and",
          args: expect.arrayContaining([ownerPredicate]),
        });
        return parentSelect;
      }),
      limit: vi.fn().mockResolvedValue([]),
    };
    mockDb.select.mockReturnValueOnce(parentSelect);

    await expect(
      action.run({
        name: "Nested folder",
        parentId: "another-users-parent",
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(mockOwnerEmailMatches).toHaveBeenCalledWith(
      "folders.ownerEmail",
      "owner@example.com",
    );
    expect(insertBuilder.values).not.toHaveBeenCalled();
  });

  it("creates a nested folder under a space parent owned by another user", async () => {
    const insertBuilder = setupInsert();
    const parentSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValue([{ id: "parent_1", spaceId: "space_1" }]),
    };
    const siblingSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ max: 0 }]),
    };
    const maxSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ max: 0 }]),
    };
    mockDb.select
      .mockReturnValueOnce(parentSelect)
      .mockReturnValueOnce(siblingSelect)
      .mockReturnValueOnce(maxSelect);

    const result = await action.run({
      name: "Nested folder",
      spaceId: "space_1",
      parentId: "parent_1",
    });

    expect(result).toMatchObject({
      id: "folder_1",
      organizationId: "org_1",
      parentId: "parent_1",
      spaceId: "space_1",
      ownerEmail: "owner@example.com",
      name: "Nested folder",
      position: 1,
    });
    expect(insertBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        parentId: "parent_1",
        spaceId: "space_1",
        ownerEmail: "owner@example.com",
      }),
    );
    expect(mockWriteAppState).toHaveBeenCalledWith(
      "refresh-signal",
      expect.objectContaining({ ts: expect.any(Number) }),
    );
  });

  it("creates a nested personal-library folder under the caller's own parent (e.g. an agent-created folder)", async () => {
    // Slack thread 1786709106161379: creating a subfolder under a parent
    // folder the agent created 500'd. The parent-not-found branch was already
    // fixed to return a typed 404, but the success path — a caller nesting
    // under their OWN personal-library (non-space) parent, which is exactly
    // Manish's repro — had no coverage at all.
    const insertBuilder = setupInsert();
    const ownerPredicate = { kind: "owner-email-match" };
    mockOwnerEmailMatches.mockReturnValue(ownerPredicate);
    const parentSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockImplementation((condition) => {
        // The parent lookup must scope to the caller's own folders when
        // there's no space — otherwise this fix could silently regress into
        // letting anyone nest under anyone's personal folders.
        expect(condition).toMatchObject({
          op: "and",
          args: expect.arrayContaining([ownerPredicate]),
        });
        return parentSelect;
      }),
      limit: vi.fn().mockResolvedValue([{ id: "parent_1", spaceId: null }]),
    };
    // No spaceId in this call, so the space-existence check select is
    // skipped — only the parent lookup and the max-position query run.
    const maxSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ max: -1 }]),
    };
    mockDb.select.mockReturnValueOnce(parentSelect).mockReturnValueOnce(maxSelect);

    const result = await action.run({
      name: "Nested folder",
      parentId: "parent_1",
    });

    expect(result).toMatchObject({
      id: "folder_1",
      parentId: "parent_1",
      spaceId: null,
      ownerEmail: "owner@example.com",
      position: 0,
    });
    expect(insertBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: "parent_1", spaceId: null }),
    );
  });

  it("returns a typed not-found error when the parent folder is missing", async () => {
    setupInsert();
    const parentSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const siblingSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ max: -1 }]),
    };
    const maxSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ max: -1 }]),
    };
    mockDb.select
      .mockReturnValueOnce(parentSelect)
      .mockReturnValueOnce(siblingSelect)
      .mockReturnValueOnce(maxSelect);

    await expect(
      action.run({
        name: "Nested folder",
        parentId: "missing_parent",
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});
