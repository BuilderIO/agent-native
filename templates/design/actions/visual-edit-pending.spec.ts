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
    returning: vi.fn(),
  };
  insertChain.values.mockReturnValue(insertChain);
  insertChain.onConflictDoUpdate.mockReturnValue(insertChain);
  insertChain.returning.mockResolvedValue([{ revision: 2 }]);

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
      publisherId: "pending.publisherId",
      clientRevision: "pending.clientRevision",
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
    resolveAccess: vi.fn(),
    selectChain,
  };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
  fail: (message: string, options: Record<string, unknown> = {}) => {
    throw Object.assign(new Error(message), options);
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
  resolveAccess: mocks.resolveAccess,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestContext: () => ({ requestOrigin: "https://design.example.test" }),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ conditions })),
  eq: vi.fn((left, right) => ({ left, right })),
  sql: vi.fn((strings, ...values) => ({ strings: [...strings], values })),
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
const publisherId = "11111111-1111-4111-8111-111111111111";

describe("visual-edit pending handoff", () => {
  beforeEach(() => {
    mocks.isSameOrigin.mockReset();
    mocks.assertAccess.mockReset();
    mocks.assertAccess.mockResolvedValue({ role: "editor", resource: design });
    mocks.resolveAccess.mockReset();
    mocks.resolveAccess.mockResolvedValue(null);
    mocks.getDb.mockClear();
    mocks.selectChain.limit.mockReset();
    mocks.selectChain.limit.mockResolvedValue([]);
    mocks.insertChain.values.mockClear();
    mocks.insertChain.onConflictDoUpdate.mockClear();
    mocks.insertChain.returning.mockReset();
    mocks.insertChain.returning.mockResolvedValue([{ revision: 2 }]);
    mocks.updateChain.set.mockClear();
    mocks.updateChain.where.mockClear();
    mocks.updateChain.returning.mockReset();
    mocks.updateChain.returning.mockResolvedValue([]);
  });

  it("exposes a durable read tool while keeping publication browser-only", () => {
    expect(getPendingAction).toMatchObject({
      title: "Pull pending visual edits into app source",
      mcpTool: true,
      description: expect.stringContaining(
        "call this instead of asking for copy/paste",
      ),
    });
    expect(getPendingAction.description).toContain("source provenance");
    expect(getPendingAction.description).toContain(
      "Apply the prompt to connected app source",
    );
    expect(getPendingAction.description).toContain("verify the running app");
    expect(getPendingAction.description).toContain("it does not modify source");
    expect(getPendingAction.publicAgent).toMatchObject({
      expose: true,
      readOnly: true,
      requiresAuth: false,
      title: "Pull pending visual edits into app source",
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
        { designId: "design_public", publisherId, revision: 1, pending: null },
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
          publisherId,
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

  it("allows a same-origin live-canvas share collaborator to publish", async () => {
    mocks.isSameOrigin.mockReturnValue(true);
    mocks.resolveAccess.mockResolvedValueOnce({
      role: "viewer",
      resource: design,
    });

    const result = await publishPendingAction.run(
      {
        designId: "design_public",
        publisherId,
        revision: 1,
        pending: {
          designId: "design_public",
          pendingEditCount: 1,
          status: "ready",
          prompt: "Move the call to action.",
        },
      },
      {
        caller: "frontend",
        requestHeaders: new Headers({
          origin: "https://design.example.test",
          referer:
            "https://design.example.test/visual-edit/design_public?share=1",
          "sec-fetch-site": "same-origin",
        }),
      },
    );

    expect(result).toMatchObject({
      designId: "design_public",
      status: "ready",
    });
    expect(mocks.resolveAccess).toHaveBeenCalledWith("design", "design_public");
    expect(mocks.assertAccess).not.toHaveBeenCalled();
    expect(mocks.insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        designId: "design_public",
        prompt: "Move the call to action.",
        revision: 1,
        publisherId,
        clientRevision: 1,
      }),
    );
  });

  it("allows an invited private viewer to publish from the Visual Edit surface", async () => {
    mocks.isSameOrigin.mockReturnValue(true);
    mocks.resolveAccess.mockResolvedValueOnce({
      role: "viewer",
      resource: { ...design, visibility: "private" },
    });

    await expect(
      publishPendingAction.run(
        {
          designId: "design_public",
          publisherId,
          revision: 1,
          pending: {
            designId: "design_public",
            pendingEditCount: 1,
            status: "ready",
            prompt: "Adjust the heading.",
          },
        },
        {
          caller: "frontend",
          requestHeaders: new Headers({
            origin: "https://design.example.test",
            referer:
              "https://design.example.test/visual-edit/design_public?share=1",
            "sec-fetch-site": "same-origin",
          }),
        },
      ),
    ).resolves.toMatchObject({ status: "ready" });

    expect(mocks.assertAccess).not.toHaveBeenCalled();
    expect(mocks.insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Adjust the heading." }),
    );
  });

  it("limits viewer handoff clearing to the publishing browser", async () => {
    mocks.isSameOrigin.mockReturnValue(true);
    mocks.resolveAccess.mockResolvedValueOnce({
      role: "viewer",
      resource: design,
    });

    await publishPendingAction.run(
      { designId: "design_public", publisherId, revision: 2, pending: null },
      {
        caller: "frontend",
        requestHeaders: new Headers({
          origin: "https://design.example.test",
          referer:
            "https://design.example.test/visual-edit/design_public?share=1",
          "sec-fetch-site": "same-origin",
        }),
      },
    );

    expect(mocks.insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        designId: "design_public",
        pendingEditCount: 0,
        status: "empty",
        prompt: "",
        publisherId,
        clientRevision: 2,
        revision: 1,
      }),
    );
    const update = mocks.insertChain.onConflictDoUpdate.mock.calls[0]?.[0];
    const samePublisherCondition = update?.setWhere.values[0];
    expect(samePublisherCondition.strings.join(" ")).toContain(
      "= excluded.publisher_id AND",
    );
    expect(samePublisherCondition.values).toEqual([
      "pending.publisherId",
      "pending.clientRevision",
    ]);
  });

  it("rejects a second publisher instead of replacing another ready handoff", async () => {
    mocks.isSameOrigin.mockReturnValue(true);
    mocks.insertChain.returning.mockResolvedValueOnce([]);
    mocks.selectChain.limit.mockResolvedValueOnce([
      { status: "ready", publisherId: "22222222-2222-4222-8222-222222222222" },
    ]);

    await expect(
      publishPendingAction.run(
        {
          designId: "design_public",
          publisherId,
          revision: 1,
          pending: {
            designId: "design_public",
            pendingEditCount: 1,
            status: "ready",
            prompt: "Do not replace the other collaborator's edits.",
          },
        },
        { caller: "frontend", requestHeaders: new Headers() },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "visual_edit_pending_conflict",
      message: expect.stringContaining("Apply or clear those edits"),
    });

    const update = mocks.insertChain.onConflictDoUpdate.mock.calls[0]?.[0];
    const setWhere = update?.setWhere;
    expect(setWhere.strings.join(" ")).toContain("OR");
    const differentPublisherCondition = setWhere.values[1];
    expect(differentPublisherCondition.values[0].strings.join(" ")).toContain(
      "IS DISTINCT FROM excluded.publisher_id",
    );
    expect(differentPublisherCondition.values[1]).toBe("pending.status");
    expect(differentPublisherCondition.strings.join(" ")).toContain(
      "<> 'ready'",
    );
  });

  it("lets an owner clear a ready handoff published by another collaborator", async () => {
    mocks.isSameOrigin.mockReturnValue(true);
    mocks.assertAccess.mockResolvedValueOnce({
      role: "owner",
      resource: design,
    });
    mocks.insertChain.returning.mockResolvedValueOnce([{ revision: 3 }]);

    await expect(
      publishPendingAction.run(
        { designId: "design_public", publisherId, revision: 3, pending: null },
        { caller: "frontend", requestHeaders: new Headers() },
      ),
    ).resolves.toMatchObject({ status: "empty", revision: 3 });

    const update = mocks.insertChain.onConflictDoUpdate.mock.calls[0]?.[0];
    const publisherCondition = update?.setWhere.values[1];
    expect(publisherCondition.strings.join(" ")).toContain(
      "IS DISTINCT FROM excluded.publisher_id",
    );
    expect(publisherCondition.strings.join(" ")).not.toContain(
      "pending.status",
    );
    expect(mocks.selectChain.limit).not.toHaveBeenCalled();
  });

  it("does not let a non-owner clear another publisher's ready handoff", async () => {
    mocks.isSameOrigin.mockReturnValue(true);
    mocks.assertAccess.mockResolvedValue({ role: "viewer", resource: design });
    mocks.insertChain.returning.mockResolvedValueOnce([]);
    mocks.selectChain.limit.mockResolvedValueOnce([
      { status: "ready", publisherId: "22222222-2222-4222-8222-222222222222" },
    ]);

    await expect(
      publishPendingAction.run(
        { designId: "design_public", publisherId, revision: 3, pending: null },
        { caller: "frontend", requestHeaders: new Headers() },
      ),
    ).resolves.toMatchObject({ status: "stale", revision: null });

    const update = mocks.insertChain.onConflictDoUpdate.mock.calls[0]?.[0];
    const otherPublisherCondition = update?.setWhere.values[1];
    expect(otherPublisherCondition.values[0].strings.join(" ")).toContain(
      "IS DISTINCT FROM excluded.publisher_id",
    );
    expect(otherPublisherCondition.values[1]).toBe("pending.status");
    expect(mocks.selectChain.limit).toHaveBeenCalled();
  });

  it("returns an explicit stale result when a browser publication is out of order", async () => {
    mocks.isSameOrigin.mockReturnValue(true);
    mocks.insertChain.returning.mockResolvedValueOnce([]);
    mocks.selectChain.limit.mockResolvedValueOnce([
      { status: "ready", publisherId },
    ]);

    await expect(
      publishPendingAction.run(
        {
          designId: "design_public",
          publisherId,
          revision: 1,
          pending: {
            designId: "design_public",
            pendingEditCount: 1,
            status: "ready",
            prompt: "Older prompt.",
          },
        },
        { caller: "frontend", requestHeaders: new Headers() },
      ),
    ).resolves.toMatchObject({
      status: "stale",
      pendingEditCount: null,
      revision: null,
      updatedAt: null,
    });
  });

  it.each([
    [
      "the ordinary public design page",
      "https://design.example.test/design/design_public",
    ],
    [
      "another visual-edit design",
      "https://design.example.test/visual-edit/other_design",
    ],
    [
      "a cross-origin visual-edit page",
      "https://attacker.example.test/visual-edit/design_public",
    ],
  ])("rejects a public viewer referred from %s", async (_label, referer) => {
    mocks.isSameOrigin.mockReturnValue(true);
    mocks.assertAccess.mockRejectedValueOnce(
      new Error("Requires editor role on design design_public (have viewer)"),
    );

    await expect(
      publishPendingAction.run(
        {
          designId: "design_public",
          publisherId,
          revision: 1,
          pending: {
            designId: "design_public",
            pendingEditCount: 1,
            status: "ready",
            prompt: "Do not publish this.",
          },
        },
        {
          caller: "frontend",
          requestHeaders: new Headers({
            origin: "https://design.example.test",
            referer,
            "sec-fetch-site": "same-origin",
          }),
        },
      ),
    ).rejects.toThrow(/Requires editor role/);

    expect(mocks.resolveAccess).not.toHaveBeenCalled();
    expect(mocks.insertChain.values).not.toHaveBeenCalled();
  });

  it("rejects a public viewer publishing from an ordinary Visual Edit link", async () => {
    mocks.isSameOrigin.mockReturnValue(true);
    mocks.resolveAccess.mockResolvedValueOnce({
      role: "viewer",
      resource: design,
    });
    mocks.assertAccess.mockRejectedValueOnce(
      new Error("Requires editor role on design design_public (have viewer)"),
    );

    await expect(
      publishPendingAction.run(
        { designId: "design_public", publisherId, revision: 1, pending: null },
        {
          caller: "frontend",
          requestHeaders: new Headers({
            origin: "https://design.example.test",
            referer: "https://design.example.test/visual-edit/design_public",
            "sec-fetch-site": "same-origin",
          }),
        },
      ),
    ).rejects.toThrow(/Requires editor role/);

    expect(mocks.resolveAccess).toHaveBeenCalledWith("design", "design_public");
    expect(mocks.insertChain.values).not.toHaveBeenCalled();
  });

  it("preserves editor publication access for private designs", async () => {
    mocks.isSameOrigin.mockReturnValue(true);
    mocks.assertAccess.mockResolvedValueOnce({
      role: "editor",
      resource: { ...design, visibility: "private" },
    });

    await publishPendingAction.run(
      {
        designId: "design_public",
        publisherId,
        revision: 1,
        pending: {
          designId: "design_public",
          pendingEditCount: 1,
          status: "ready",
          prompt: "Update a private design.",
        },
      },
      { caller: "frontend", requestHeaders: new Headers() },
    );

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design_public",
      "editor",
    );
    expect(mocks.insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "private" }),
    );
  });

  it("rejects a private viewer on the ordinary Design route", async () => {
    mocks.isSameOrigin.mockReturnValue(true);
    mocks.resolveAccess.mockResolvedValueOnce({
      role: "viewer",
      resource: { ...design, visibility: "private" },
    });
    mocks.assertAccess.mockRejectedValueOnce(
      new Error("Requires editor role on design design_public (have viewer)"),
    );

    await expect(
      publishPendingAction.run(
        { designId: "design_public", publisherId, revision: 1, pending: null },
        {
          caller: "frontend",
          requestHeaders: new Headers({
            origin: "https://design.example.test",
            referer: "https://design.example.test/design/design_public",
            "sec-fetch-site": "same-origin",
          }),
        },
      ),
    ).rejects.toThrow(/Requires editor role/);

    expect(mocks.insertChain.values).not.toHaveBeenCalled();
  });

  it("does not grant the public browser collaborator path to WebMCP", async () => {
    mocks.isSameOrigin.mockReturnValue(true);
    mocks.assertAccess.mockRejectedValueOnce(
      new Error("Requires editor role on design design_public (have viewer)"),
    );

    await expect(
      publishPendingAction.run(
        { designId: "design_public", publisherId, revision: 1, pending: null },
        {
          caller: "webmcp",
          requestHeaders: new Headers({
            origin: "https://design.example.test",
            referer: "https://design.example.test/visual-edit/design_public",
            "sec-fetch-site": "same-origin",
          }),
        },
      ),
    ).rejects.toThrow(/Requires editor role/);

    expect(mocks.resolveAccess).not.toHaveBeenCalled();
    expect(mocks.insertChain.values).not.toHaveBeenCalled();
  });

  it("upserts a capability-scoped visual-edit handoff without exposing bridge credentials", async () => {
    mocks.isSameOrigin.mockReturnValue(true);
    const prompt = "Change the title in Clips at src/Library.tsx:42.";

    const result = await publishPendingAction.run(
      {
        designId: "design_public",
        publisherId,
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
      publisherId,
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

  it("bounds browser-local revisions to their database column range", () => {
    const parsed = publishPendingAction.schema.safeParse({
      designId: "design_public",
      publisherId,
      revision: 2_147_483_648,
      pending: null,
    });

    expect(parsed.success).toBe(false);
  });
});
