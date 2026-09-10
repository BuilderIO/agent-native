import { ForbiddenError, ROLE_RANK } from "@agent-native/core/sharing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const txDeleteChain = { where: vi.fn() };
  const txUpdateChain = { set: vi.fn(), where: vi.fn() };
  txUpdateChain.set.mockReturnValue(txUpdateChain);

  const tx = {
    delete: vi.fn(() => txDeleteChain),
    update: vi.fn(() => txUpdateChain),
  };

  return {
    tx,
    txDeleteChain,
    txUpdateChain,
    db: { transaction: vi.fn(async (callback: any) => callback(tx)) },
    assertAccess: vi.fn(),
  };
});

vi.mock("@agent-native/core/sharing", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@agent-native/core/sharing")>();
  return { ...original, assertAccess: mocks.assertAccess };
});

vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...original,
    eq: (left: unknown, right: unknown) => ({ left, right }),
  };
});

vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.db,
  schema: {
    designs: {
      designSystemId: "designs.designSystemId",
      updatedAt: "designs.updatedAt",
    },
    designSystemShares: { resourceId: "designSystemShares.resourceId" },
    designSystems: { id: "designSystems.id" },
  },
}));

import {
  DESIGN_SYSTEM_MANAGE_ROLE,
  canManageDesignSystemRole,
} from "../server/lib/design-system-access.js";
import action from "./delete-design-system.js";

describe("delete-design-system", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertAccess.mockReset();
    mocks.assertAccess.mockResolvedValue({
      role: "owner",
      resource: { id: "ds_shared" },
    });
  });

  // The Design Systems page renders its Delete menu item and bulk-delete
  // checkbox from the `canManage` flag list-design-systems reports. Enforcing
  // a stricter role here hands every shared admin a button that 403s.
  it("enforces exactly the role the UI reports as manageable", async () => {
    await action.run({ id: "ds_shared" });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design-system",
      "ds_shared",
      DESIGN_SYSTEM_MANAGE_ROLE,
    );

    const enforcedRole = mocks.assertAccess.mock.calls[0][2] as
      | "owner"
      | "admin"
      | "editor"
      | "commenter"
      | "viewer";
    expect(canManageDesignSystemRole(enforcedRole)).toBe(true);
  });

  it("lets a non-owner admin delete a shared design system", async () => {
    // Mirrors assertAccess's own rank comparison against the caller's role.
    mocks.assertAccess.mockImplementation(
      async (type: string, id: string, minRole: "owner" | "admin") => {
        const callerRole = "admin";
        if (ROLE_RANK[callerRole] < ROLE_RANK[minRole]) {
          throw new ForbiddenError(
            `Requires ${minRole} role on ${type} ${id} (have ${callerRole})`,
          );
        }
        return { role: callerRole, resource: { id } };
      },
    );

    await expect(action.run({ id: "ds_shared" })).resolves.toEqual({
      id: "ds_shared",
      deleted: true,
    });
    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
  });

  it("still refuses a viewer", async () => {
    mocks.assertAccess.mockRejectedValue(new ForbiddenError("No access"));

    await expect(action.run({ id: "ds_shared" })).rejects.toThrow(
      ForbiddenError,
    );
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("unlinks designs and drops share rows in one transaction", async () => {
    await action.run({ id: "ds_shared" });

    expect(mocks.txUpdateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ designSystemId: null }),
    );
    expect(mocks.tx.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: "designSystemShares.resourceId",
      }),
    );
    expect(mocks.tx.delete).toHaveBeenCalledWith(
      expect.objectContaining({ id: "designSystems.id" }),
    );
  });
});
