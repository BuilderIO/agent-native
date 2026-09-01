import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listTables: vi.fn(),
  listDbAdminConnections: vi.fn(),
  requireDbAdminContextFromRequest: vi.fn(),
  withDbAdminConnectionRuntime: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("@agent-native/core/db-admin", () => ({
  listTables: mocks.listTables,
}));
vi.mock("../server/lib/db-admin-connections", () => ({
  listDbAdminConnections: mocks.listDbAdminConnections,
  requireDbAdminContextFromRequest: mocks.requireDbAdminContextFromRequest,
  withDbAdminConnectionRuntime: mocks.withDbAdminConnectionRuntime,
}));

const action = (await import("./list-connected-database-tables")).default;

beforeEach(() => {
  mocks.listTables.mockReset();
  mocks.listDbAdminConnections.mockReset();
  mocks.requireDbAdminContextFromRequest.mockReset();
  mocks.withDbAdminConnectionRuntime.mockReset();
  mocks.requireDbAdminContextFromRequest.mockResolvedValue({
    userEmail: "owner@example.com",
    orgId: "org-1",
    role: "owner",
  });
  mocks.listDbAdminConnections.mockResolvedValue([
    {
      id: "clips",
      name: "Clips",
      appId: "clips",
      appUrl: "https://clips.example.test",
    },
  ]);
  mocks.withDbAdminConnectionRuntime.mockImplementation(
    async (_ctx, _id, callback) => callback({ dialect: "postgres" }),
  );
  mocks.listTables.mockResolvedValue({
    dialect: "postgres",
    tables: [{ name: "clips", type: "table", rowCount: 2 }],
  });
});

describe("list-connected-database-tables", () => {
  it("returns table metadata without secret fields", async () => {
    await expect(action.run({}, {} as never)).resolves.toEqual({
      connections: [
        {
          id: "clips",
          name: "Clips",
          appId: "clips",
          appUrl: "https://clips.example.test",
          dialect: "postgres",
          tables: [{ name: "clips", type: "table", rowCount: 2 }],
        },
      ],
    });
    expect(mocks.withDbAdminConnectionRuntime).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown requested connection", async () => {
    await expect(
      action.run({ connectionIds: ["missing"] }, {} as never),
    ).rejects.toThrow("Connected database not found: missing");
    expect(mocks.withDbAdminConnectionRuntime).not.toHaveBeenCalled();
  });
});
