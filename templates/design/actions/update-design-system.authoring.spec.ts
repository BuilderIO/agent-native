vi.mock("@agent-native/core/server/builder-dsi-access", () => ({
  assertBuilderDsiAccess: vi.fn(async () => ({
    status: "ready",
    eligible: true,
  })),
  getBuilderDsiAccess: vi.fn(async () => ({ status: "ready", eligible: true })),
}));
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  update: vi.fn(),
  where: vi.fn(),
}));
vi.mock("@agent-native/core/sharing", () => ({ assertAccess: mocks.access }));
vi.mock("@agent-native/core/tracking", () => ({ track: vi.fn() }));
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ update: mocks.update }),
  schema: { designSystems: { id: "id" } },
}));
import { createDesignSystemAuthoringService } from "@agent-native/core/server/design-system-authoring";

import update from "./update-design-system.js";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.where.mockReturnValue({ returning: async () => [{ id: "native" }] });
  mocks.update.mockReturnValue({ set: () => ({ where: mocks.where }) });
});

describe("legacy write boundary for native systems", () => {
  it("rejects content replacement and guidance bypass but allows a title edit without changing artifacts", async () => {
    const row = {
      id: "native",
      title: "Original",
      data: '{"colors":{"primary":"#123456"}}',
    };
    const service = createDesignSystemAuthoringService({
      ownerApp: "design",
      read: async () => ({ row: { ...row }, canEdit: true }),
      insert: async () => {},
      compareAndSwap: async (_previous, data) => {
        row.data = data;
        return true;
      },
    });
    await service.resume(row.id);
    const original = row.data;
    mocks.access.mockResolvedValue({ role: "owner", resource: row });
    for (const fields of [
      { data: "{}" },
      { assets: "[]" },
      { customInstructions: "unversioned" },
      { description: "unversioned guidance" },
    ]) {
      await expect(update.run({ id: row.id, ...fields })).rejects.toMatchObject(
        {
          errorCode: "design_system_target_revision_required",
          statusCode: 409,
        },
      );
    }
    expect(mocks.update).not.toHaveBeenCalled();
    await expect(
      update.run({ id: row.id, title: "New title" }),
    ).resolves.toMatchObject({ updated: true });
    expect(row.data).toBe(original);
  });
});
