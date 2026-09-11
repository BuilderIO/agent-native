import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const projectSources = [
    {
      id: "project-source-existing",
      projectId: "project-1",
      sourceId: "source-existing",
      createdAt: "2026-07-19T00:00:00.000Z",
    },
  ];
  const deleteProjectSources = vi.fn((condition: { value: unknown }) => {
    const index = projectSources.findIndex(
      (source) => source.projectId === condition.value,
    );
    if (index >= 0) projectSources.splice(index, 1);
  });

  return {
    assertAccess: vi.fn(),
    deleteProjectSources,
    getDb: vi.fn(),
    projectSources,
  };
});

vi.mock("@agent-native/core", () => ({
  defineAction: (action: unknown) => action,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: () => null,
  getRequestUserEmail: () => "owner@example.test",
}));

vi.mock("@agent-native/core/settings", () => ({
  putUserSetting: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => ({ type: "access" })),
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  inArray: (column: unknown, values: unknown[]) => ({ column, values }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: {
    brainProjects: { id: "brainProjects.id" },
    brainProjectShares: {},
    brainProjectSources: {
      projectId: "brainProjectSources.projectId",
    },
    brainSources: { id: "brainSources.id" },
    brainSourceShares: {},
  },
}));

vi.mock("../server/lib/brain.js", () => ({
  nanoid: () => "generated-id",
  nowIso: () => "2026-07-19T00:00:00.000Z",
}));

import action from "./manage-project.js";

function createDb() {
  return {
    delete: vi.fn(() => ({ where: mocks.deleteProjectSources })),
    insert: vi.fn(),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ id: "source-accessible" }]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    })),
  };
}

describe("manage-project", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectSources.splice(0, mocks.projectSources.length, {
      id: "project-source-existing",
      projectId: "project-1",
      sourceId: "source-existing",
      createdAt: "2026-07-19T00:00:00.000Z",
    });
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.getDb.mockReturnValue(createDb());
  });

  it("keeps existing membership when a replacement source is inaccessible", async () => {
    await expect(
      action.run({
        operation: "update",
        projectId: "project-1",
        sourceIds: ["source-accessible", "source-inaccessible"],
      }),
    ).rejects.toThrow("One or more Brain sources were not found");

    expect(mocks.deleteProjectSources).not.toHaveBeenCalled();
    expect(mocks.projectSources).toEqual([
      expect.objectContaining({
        projectId: "project-1",
        sourceId: "source-existing",
      }),
    ]);
  });
});
