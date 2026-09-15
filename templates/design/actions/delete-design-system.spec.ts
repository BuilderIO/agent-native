import { ForbiddenError, ROLE_RANK } from "@agent-native/core/sharing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const designsTable = {
    id: "designs.id",
    designSystemId: "designs.designSystemId",
    updatedAt: "designs.updatedAt",
  };
  const designTemplatesTable = {
    id: "designTemplates.id",
    designSystemId: "designTemplates.designSystemId",
    updatedAt: "designTemplates.updatedAt",
  };
  const designSystemsTable = {
    id: "designSystems.id",
    ownerEmail: "designSystems.ownerEmail",
    orgId: "designSystems.orgId",
    updatedAt: "designSystems.updatedAt",
  };
  const designSystemSharesTable = {
    resourceId: "designSystemShares.resourceId",
  };

  const state = {
    linkedDesignRows: [] as Array<{ id: string }>,
    linkedTemplateRows: [] as Array<{ id: string }>,
    promotionCandidateRows: [] as Array<{ id: string }>,
    resolvedAccess: new Map<string, { role: string } | null>(),
  };

  const designsSelectChain = {
    where: vi.fn(() => Promise.resolve(state.linkedDesignRows)),
  };
  const designTemplatesSelectChain = {
    where: vi.fn(() => Promise.resolve(state.linkedTemplateRows)),
  };
  const dbFromRouter = {
    from: vi.fn((table: unknown) => {
      if (table === designsTable) return designsSelectChain;
      if (table === designTemplatesTable) return designTemplatesSelectChain;
      throw new Error("unexpected table passed to db.select().from()");
    }),
  };

  const promotionSelectChain = {
    from: vi.fn(() => promotionSelectChain),
    where: vi.fn(() => promotionSelectChain),
    orderBy: vi.fn(() => promotionSelectChain),
    limit: vi.fn(() => Promise.resolve(state.promotionCandidateRows)),
  };

  const txDeleteChain = { where: vi.fn() };
  const txUpdateChain = { set: vi.fn(), where: vi.fn() };
  txUpdateChain.set.mockReturnValue(txUpdateChain);

  const tx = {
    delete: vi.fn(() => txDeleteChain),
    update: vi.fn(() => txUpdateChain),
    select: vi.fn(() => promotionSelectChain),
  };

  const dbUpdateChain = { set: vi.fn(), where: vi.fn() };
  dbUpdateChain.set.mockReturnValue(dbUpdateChain);

  const db = {
    select: vi.fn(() => dbFromRouter),
    update: vi.fn(() => dbUpdateChain),
    transaction: vi.fn(async (callback: (tx: typeof tx) => unknown) =>
      callback(tx),
    ),
  };

  const resolveAccess = vi.fn(
    async (type: string, id: string) =>
      state.resolvedAccess.get(`${type}:${id}`) ?? null,
  );

  return {
    state,
    designsTable,
    designTemplatesTable,
    designSystemsTable,
    designSystemSharesTable,
    designsSelectChain,
    designTemplatesSelectChain,
    promotionSelectChain,
    tx,
    txDeleteChain,
    txUpdateChain,
    db,
    dbUpdateChain,
    assertAccess: vi.fn(),
    resolveAccess,
  };
});

vi.mock("@agent-native/core/sharing", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@agent-native/core/sharing")>();
  return {
    ...original,
    assertAccess: mocks.assertAccess,
    resolveAccess: mocks.resolveAccess,
  };
});

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: () => null,
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...original,
    and: (...values: unknown[]) => ({ and: values }),
    desc: (value: unknown) => ({ desc: value }),
    isNull: (value: unknown) => ({ isNull: value }),
    eq: (left: unknown, right: unknown) => ({ left, right }),
  };
});

vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.db,
  schema: {
    designs: mocks.designsTable,
    designTemplates: mocks.designTemplatesTable,
    designSystemShares: mocks.designSystemSharesTable,
    designSystems: mocks.designSystemsTable,
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
    mocks.state.linkedDesignRows = [];
    mocks.state.linkedTemplateRows = [];
    mocks.state.promotionCandidateRows = [];
    mocks.state.resolvedAccess = new Map();
    mocks.assertAccess.mockReset();
    mocks.assertAccess.mockResolvedValue({
      role: "owner",
      resource: {
        id: "ds_shared",
        ownerEmail: "owner@example.com",
        orgId: null,
        isDefault: false,
      },
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
        return {
          role: callerRole,
          resource: {
            id,
            ownerEmail: "owner@example.com",
            orgId: null,
            isDefault: false,
          },
        };
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

  it("drops share rows and the design-system row in one transaction", async () => {
    await action.run({ id: "ds_shared" });

    expect(mocks.tx.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: "designSystemShares.resourceId",
      }),
    );
    expect(mocks.tx.delete).toHaveBeenCalledWith(
      expect.objectContaining({ id: "designSystems.id" }),
    );
  });

  // A shared admin's write access to the design system does not extend to
  // every design that happens to reference it — those belong to whoever
  // owns them. Only designs the caller can actually edit get unlinked.
  it("unlinks designs the caller can edit and skips the rest", async () => {
    mocks.state.linkedDesignRows = [{ id: "design-1" }, { id: "design-2" }];
    mocks.state.resolvedAccess.set("design:design-1", { role: "editor" });
    mocks.state.resolvedAccess.set("design:design-2", { role: "viewer" });

    const result = await action.run({ id: "ds_shared" });

    expect(mocks.resolveAccess).toHaveBeenCalledWith("design", "design-1");
    expect(mocks.resolveAccess).toHaveBeenCalledWith("design", "design-2");
    expect(mocks.dbUpdateChain.set).toHaveBeenCalledTimes(1);
    expect(mocks.dbUpdateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ designSystemId: null }),
    );
    expect(result).toMatchObject({
      id: "ds_shared",
      deleted: true,
      designsSkippedForAccess: ["design-2"],
    });
  });

  it("unlinks saved templates the caller manages and skips the rest", async () => {
    mocks.state.linkedTemplateRows = [{ id: "tmpl-1" }, { id: "tmpl-2" }];
    mocks.state.resolvedAccess.set("design-template:tmpl-1", { role: "admin" });
    mocks.state.resolvedAccess.set("design-template:tmpl-2", {
      role: "editor",
    });

    const result = await action.run({ id: "ds_shared" });

    expect(result).toMatchObject({
      id: "ds_shared",
      deleted: true,
      templatesSkippedForAccess: ["tmpl-2"],
    });
  });

  it("promotes another of the owner's design systems when the deleted one was their default", async () => {
    mocks.assertAccess.mockResolvedValue({
      role: "owner",
      resource: {
        id: "ds_shared",
        ownerEmail: "owner@example.com",
        orgId: null,
        isDefault: true,
      },
    });
    mocks.state.promotionCandidateRows = [{ id: "ds_next" }];

    await action.run({ id: "ds_shared" });

    expect(mocks.tx.select).toHaveBeenCalled();
    expect(mocks.txUpdateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ isDefault: true }),
    );
    expect(mocks.txUpdateChain.where).toHaveBeenCalledWith(
      expect.objectContaining({ left: "designSystems.id", right: "ds_next" }),
    );
  });

  it("does not touch other design systems when the deleted one was not the default", async () => {
    await action.run({ id: "ds_shared" });

    expect(mocks.tx.select).not.toHaveBeenCalled();
  });
});
