import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectChain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  selectChain.from.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);

  const insertChain = {
    values: vi.fn(),
    onConflictDoUpdate: vi.fn(),
  };
  insertChain.values.mockReturnValue(insertChain);
  insertChain.onConflictDoUpdate.mockResolvedValue(undefined);

  const updateChain = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  };
  updateChain.set.mockReturnValue(updateChain);
  updateChain.where.mockReturnValue(updateChain);
  updateChain.returning.mockResolvedValue([]);

  return {
    designVisualEditPending: {
      designId: "pending.designId",
      pendingEditCount: "pending.pendingEditCount",
      status: "pending.status",
      prompt: "pending.prompt",
      revision: "pending.revision",
      updatedAt: "pending.updatedAt",
    },
    designs: {},
    getDb: vi.fn(() => ({
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => updateChain),
      select: vi.fn(() => selectChain),
    })),
    insertChain,
    updateChain,
    isSameOrigin: vi.fn(),
    assertAccess: vi.fn(),
    selectChain,
  };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
  fail: (message: string) => {
    throw new Error(message);
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ conditions })),
  eq: vi.fn((left, right) => ({ left, right })),
  sql: vi.fn((...parts) => ({ parts })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: {
    designVisualEditPending: mocks.designVisualEditPending,
    designs: mocks.designs,
  },
}));

vi.mock("./visual-edit-browser-request.js", () => ({
  isSameOriginVisualEditBrowserRequest: mocks.isSameOrigin,
}));

import acknowledgePendingAction from "./acknowledge-visual-edit-pending.js";
import getPendingAction from "./get-visual-edit-pending.js";
import publishPendingAction from "./publish-visual-edit-pending.js";

const design = {
  id: "design_public",
  ownerEmail: "owner@example.com",
  orgId: null,
  visibility: "public",
};

describe("visual-edit pending handoff", () => {
  beforeEach(() => {
    mocks.isSameOrigin.mockReset();
    mocks.assertAccess.mockReset();
    mocks.assertAccess.mockResolvedValue({ role: "editor", resource: design });
    mocks.getDb.mockClear();
    mocks.selectChain.limit.mockReset();
    mocks.insertChain.values.mockClear();
    mocks.insertChain.onConflictDoUpdate.mockClear();
    mocks.updateChain.set.mockClear();
    mocks.updateChain.where.mockClear();
    mocks.updateChain.returning.mockReset();
    mocks.updateChain.returning.mockResolvedValue([]);
  });

  it("exposes a durable read tool while keeping publication browser-only", () => {
    expect(getPendingAction.mcpTool).toBe(true);
    expect(getPendingAction.publicAgent).toMatchObject({
      expose: true,
      readOnly: true,
      requiresAuth: false,
      title: "Pull visual edits from Design",
    });
    expect(getPendingAction.capabilityScopes).toEqual(["visual-edit"]);
    expect(acknowledgePendingAction).toMatchObject({
      mcpTool: true,
      agentTool: false,
      capabilityScopes: ["visual-edit"],
      publicAgent: {
        expose: true,
        title: "Mark visual edits applied",
      },
    });
    expect(publishPendingAction).toMatchObject({
      agentTool: false,
      mcpTool: false,
      requiresAuth: false,
      capabilityScopes: ["visual-edit"],
    });
  });

  it("rejects publication that did not come from the Design page", async () => {
    mocks.isSameOrigin.mockReturnValue(false);

    await expect(
      publishPendingAction.run(
        { designId: "design_public", revision: 1, pending: null },
        { caller: "frontend", requestHeaders: new Headers() },
      ),
    ).rejects.toThrow(/same-origin Design page/);
    expect(mocks.assertAccess).not.toHaveBeenCalled();
  });

  it("rejects a plain public viewer before publishing a handoff", async () => {
    mocks.isSameOrigin.mockReturnValue(true);
    mocks.assertAccess.mockRejectedValueOnce(
      new Error("Requires editor role on design design_public (have viewer)"),
    );

    await expect(
      publishPendingAction.run(
        {
          designId: "design_public",
          revision: 1,
          pending: {
            designId: "design_public",
            pendingEditCount: 1,
            status: "ready",
            prompt: "Forged handoff",
          },
        },
        { caller: "frontend", requestHeaders: new Headers() },
      ),
    ).rejects.toThrow(/Requires editor role/);
    expect(mocks.insertChain.values).not.toHaveBeenCalled();
  });

  it("upserts a capability-scoped visual-edit handoff without exposing bridge credentials", async () => {
    mocks.isSameOrigin.mockReturnValue(true);
    const prompt = "Change the title in Clips at src/Library.tsx:42.";

    const result = await publishPendingAction.run(
      {
        designId: "design_public",
        revision: 1,
        pending: {
          designId: "design_public",
          pendingEditCount: 2,
          status: "ready",
          prompt,
        },
      },
      { caller: "frontend", requestHeaders: new Headers() },
    );

    expect(result).toMatchObject({
      designId: "design_public",
      pendingEditCount: 2,
      status: "ready",
    });
    expect(mocks.insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        designId: "design_public",
        pendingEditCount: 2,
        status: "ready",
        prompt,
        ownerEmail: "owner@example.com",
        orgId: null,
        visibility: "public",
      }),
    );
    expect(mocks.insertChain.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "pending.designId",
        set: expect.objectContaining({ prompt, pendingEditCount: 2 }),
      }),
    );
  });

  it("returns an empty result until the page publishes a ready handoff", async () => {
    mocks.selectChain.limit.mockResolvedValueOnce([]);
    await expect(
      getPendingAction.run({ designId: "design_public" }),
    ).resolves.toMatchObject({
      designId: "design_public",
      pendingEditCount: 0,
      status: "empty",
      prompt: "",
    });

    mocks.selectChain.limit.mockResolvedValueOnce([
      {
        pendingEditCount: 1,
        status: "ready",
        prompt: "Move the CTA to the right.",
        revision: 1,
        updatedAt: "2026-09-23T12:00:00.000Z",
      },
    ]);
    await expect(
      getPendingAction.run({ designId: "design_public" }),
    ).resolves.toMatchObject({
      designId: "design_public",
      pendingEditCount: 1,
      status: "ready",
      prompt: "Move the CTA to the right.",
    });
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design_public",
      "editor",
    );
  });

  it("acknowledges only the exact applied handoff revision", async () => {
    mocks.updateChain.returning.mockResolvedValueOnce([
      { designId: "design_public" },
    ]);

    await expect(
      acknowledgePendingAction.run({ designId: "design_public", revision: 7 }),
    ).resolves.toMatchObject({
      designId: "design_public",
      revision: 7,
      status: "empty",
      pendingEditCount: 0,
    });
    expect(mocks.updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingEditCount: 0,
        status: "empty",
        prompt: "",
      }),
    );
  });

  it("rejects a plain public viewer from acknowledging a handoff", async () => {
    mocks.assertAccess.mockRejectedValueOnce(
      new Error("Requires editor role on design design_public (have viewer)"),
    );

    await expect(
      acknowledgePendingAction.run({ designId: "design_public", revision: 7 }),
    ).rejects.toThrow(/Requires editor role/);
    expect(mocks.updateChain.set).not.toHaveBeenCalled();
  });

  it("does not let a public viewer read the coding-agent handoff", async () => {
    mocks.assertAccess.mockRejectedValueOnce(
      new Error("Requires editor role on design design_public (have viewer)"),
    );

    await expect(
      getPendingAction.run({ designId: "design_public" }),
    ).rejects.toThrow(/Requires editor role/);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("bounds the durable prompt to a single handoff-sized payload", () => {
    const parsed = publishPendingAction.schema.safeParse({
      designId: "design_public",
      revision: 1,
      pending: {
        designId: "design_public",
        pendingEditCount: 1,
        status: "ready",
        prompt: "x".repeat(64 * 1024 + 1),
      },
    });

    expect(parsed.success).toBe(false);
    expect(getPendingAction.maxResultChars).toBe(64 * 1024);
  });
});
