import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  factoryDefinitions,
  factoryGraphVersions,
} from "../server/db/schema.js";
import { defaultFactoryGraph } from "../server/factory-graph/contracts.js";

const getDbMock = vi.hoisted(() => vi.fn());
const requireWorkspaceMemberMock = vi.hoisted(() => vi.fn());
const workspaceMemberIdentityFromContextMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(() => "/factory"),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
}));

vi.mock("../server/lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: requireWorkspaceMemberMock,
  workspaceMemberIdentityFromContext: workspaceMemberIdentityFromContextMock,
}));

const graph = {
  ...defaultFactoryGraph(),
  version: 2,
  name: "Version two",
  description: "The second graph.",
};

beforeEach(() => {
  vi.clearAllMocks();
  requireWorkspaceMemberMock.mockResolvedValue({
    userEmail: "owner@example.com",
    orgId: "org-1",
  });
  workspaceMemberIdentityFromContextMock.mockReturnValue({
    userEmail: "owner@example.com",
    orgId: "org-1",
  });
});

describe("Factory graph history actions", () => {
  it("lists bounded version metadata within the active organization", async () => {
    const definition = {
      id: "product-feedback",
      graphVersion: 2,
      orgId: "org-1",
    };
    const version = {
      id: "version-2",
      factoryId: "product-feedback",
      version: 2,
      graphJson: JSON.stringify(graph),
      source: "manual",
      changeSummary: "Updated the graph.",
      createdAt: "2026-08-19T10:00:00.000Z",
      createdBy: "owner@example.com",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    };
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn((table) => {
          if (table === factoryDefinitions) {
            return {
              where: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([definition]),
              })),
            };
          }
          return {
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([version]),
              })),
            })),
          };
        }),
      })),
    });

    const { default: action } =
      await import("./list-factory-graph-versions.js");
    const result = await action.run(
      { factoryId: "product-feedback" },
      { userEmail: "owner@example.com", orgId: "org-1" },
    );

    expect(result).toMatchObject({
      factoryId: "product-feedback",
      currentVersion: 2,
      hasMore: false,
      versions: [
        {
          id: "version-2",
          version: 2,
          source: "manual",
          isCurrent: true,
        },
      ],
    });
  });

  it("loads one validated graph snapshot within the active organization", async () => {
    const definition = {
      id: "product-feedback",
      graphVersion: 2,
      orgId: "org-1",
    };
    const version = {
      id: "version-2",
      factoryId: "product-feedback",
      version: 2,
      graphJson: JSON.stringify(graph),
      source: "manual",
      changeSummary: "Updated the graph.",
      createdAt: "2026-08-19T10:00:00.000Z",
      createdBy: "owner@example.com",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    };
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn((table) => {
          if (table === factoryDefinitions) {
            return {
              where: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([definition]),
              })),
            };
          }
          return {
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([version]),
            })),
          };
        }),
      })),
    });

    const { default: action } = await import("./get-factory-graph-version.js");
    const result = await action.run(
      { factoryId: "product-feedback", versionId: "version-2" },
      { userEmail: "owner@example.com", orgId: "org-1" },
    );

    expect(result).toMatchObject({
      id: "version-2",
      version: 2,
      isCurrent: true,
      graph: { version: 2, name: "Version two" },
    });
  });

  it("rejects a stale graph save before allocating a new version", async () => {
    const definition = {
      id: "product-feedback",
      graphVersion: 3,
      orgId: "org-1",
    };
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([definition]),
          })),
        })),
      })),
      update: vi.fn(),
      insert: vi.fn(),
    };
    getDbMock.mockReturnValue({
      transaction: vi.fn(async (callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    });

    const { default: action } = await import("./save-factory-graph.js");
    await expect(
      action.run(
        {
          factoryId: "product-feedback",
          name: "Stale graph",
          description: "",
          prompt: "",
          source: "manual",
          changeSummary: "Stale save.",
          expectedGraphVersion: 2,
          graph,
        },
        { userEmail: "owner@example.com", orgId: "org-1" },
      ),
    ).rejects.toThrow("Factory changed while saving");
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("restores by appending a new version and updating the current definition atomically", async () => {
    const definition = {
      id: "product-feedback",
      name: "Current graph",
      description: "Current description",
      prompt: "Keep the current prompt.",
      graphVersion: 3,
      graphJson: JSON.stringify({ ...graph, version: 3 }),
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    };
    const version = {
      id: "version-2",
      factoryId: "product-feedback",
      version: 2,
      graphJson: JSON.stringify(graph),
      source: "manual",
      changeSummary: "Updated the graph.",
      createdAt: "2026-08-19T10:00:00.000Z",
      createdBy: "owner@example.com",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    };
    const insertValues = vi.fn().mockResolvedValue(undefined);
    const returning = vi.fn().mockResolvedValue([{ id: definition.id }]);
    const updateValues = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ returning }),
    });
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn((table) => {
          if (table === factoryDefinitions) {
            return {
              where: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([definition]),
              })),
            };
          }
          return {
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([version]),
            })),
          };
        }),
      })),
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set: updateValues })),
    };
    getDbMock.mockReturnValue({
      transaction: vi.fn(async (callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    });

    const { default: action } =
      await import("./restore-factory-graph-version.js");
    const result = await action.run(
      { factoryId: "product-feedback", versionId: "version-2" },
      { userEmail: "owner@example.com", orgId: "org-1" },
    );

    expect(result).toMatchObject({
      ok: true,
      alreadyCurrent: false,
      factoryId: "product-feedback",
      restoredFromVersion: 2,
      graphVersion: 4,
      source: "restore",
    });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        factoryId: "product-feedback",
        version: 4,
        source: "restore",
        changeSummary: "Restored version 2.",
        graphJson: expect.stringContaining('"version":4'),
      }),
    );
    expect(updateValues).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Version two",
        description: "The second graph.",
        graphVersion: 4,
        graphJson: expect.stringContaining('"version":4'),
      }),
    );
  });

  it("rejects a restore when another writer advances the current version", async () => {
    const definition = {
      id: "product-feedback",
      name: "Current graph",
      description: "Current description",
      prompt: "Keep the current prompt.",
      graphVersion: 3,
      graphJson: JSON.stringify({ ...graph, version: 3 }),
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    };
    const version = {
      id: "version-2",
      factoryId: "product-feedback",
      version: 2,
      graphJson: JSON.stringify(graph),
      source: "manual",
      changeSummary: "Updated the graph.",
      createdAt: "2026-08-19T10:00:00.000Z",
      createdBy: "owner@example.com",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    };
    const insertValues = vi.fn();
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn((table) => {
          if (table === factoryDefinitions) {
            return {
              where: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([definition]),
              })),
            };
          }
          return {
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([version]),
            })),
          };
        }),
      })),
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([]),
          })),
        })),
      })),
    };
    getDbMock.mockReturnValue({
      transaction: vi.fn(async (callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    });

    const { default: action } =
      await import("./restore-factory-graph-version.js");
    await expect(
      action.run(
        { factoryId: "product-feedback", versionId: "version-2" },
        { userEmail: "owner@example.com", orgId: "org-1" },
      ),
    ).rejects.toThrow("Factory changed while restoring");
    expect(insertValues).not.toHaveBeenCalled();
  });
});
