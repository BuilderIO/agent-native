import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state: {
    orgId: string;
    reviewResource: Record<string, unknown> | null;
    whereCondition: unknown;
  } = { orgId: "org-a", reviewResource: null, whereCondition: null };
  const selectChain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    orderBy: vi.fn(),
  };
  const select = vi.fn(() => selectChain);
  selectChain.from.mockReturnValue(selectChain);
  selectChain.where.mockImplementation((condition) => {
    state.whereCondition = condition;
    return selectChain;
  });
  selectChain.limit.mockImplementation(async () => {
    const conditions = (
      state.whereCondition as {
        conditions?: Array<{ left: string; right: unknown }>;
      }
    )?.conditions;
    const scopedToId = conditions?.some(
      (condition) =>
        condition.left === "designs.id" &&
        condition.right === state.reviewResource?.id,
    );
    const scopedToOrg = conditions?.some(
      (condition) =>
        condition.left === "designs.orgId" && condition.right === state.orgId,
    );
    return scopedToId &&
      scopedToOrg &&
      state.reviewResource?.orgId === state.orgId
      ? [state.reviewResource]
      : [];
  });

  return {
    asc: vi.fn((column) => ({ asc: column })),
    and: vi.fn((...conditions) => ({ conditions })),
    eq: vi.fn((left, right) => ({ left, right })),
    getDb: vi.fn(() => ({ select })),
    resolveAccess: vi.fn(),
    currentRequestUserIsOrgAdmin: vi.fn(),
    getRequestOrgId: vi.fn(() => state.orgId),
    state,
    select,
    selectChain,
    track: vi.fn(),
    getDesignSystemRun: vi.fn(async ({ id }: { id: string }) => ({
      id,
      title: "Acme",
      agentContext: "Use --brand-accent: #123456.",
    })),
  };
});

vi.mock("@agent-native/core/tracking", () => ({ track: mocks.track }));

vi.mock("@agent-native/core/sharing", () => ({
  registerShareableResource: vi.fn(),
  resolveAccess: mocks.resolveAccess,
}));

vi.mock("@agent-native/core/server", () => ({
  currentRequestUserIsOrgAdmin: (...args: unknown[]) =>
    mocks.currentRequestUserIsOrgAdmin(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: () => mocks.getRequestOrgId(),
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  asc: mocks.asc,
  eq: mocks.eq,
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: {
    designs: { id: "designs.id", orgId: "designs.orgId" },
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      fileType: "designFiles.fileType",
      content: "designFiles.content",
      createdAt: "designFiles.createdAt",
      updatedAt: "designFiles.updatedAt",
    },
  },
}));

vi.mock("./get-design-system.js", () => ({
  default: { run: mocks.getDesignSystemRun },
}));

import { designDataForAccessRole } from "../server/lib/design-data-access.js";
import action from "./get-design.js";

describe("get-design", () => {
  beforeEach(() => {
    mocks.resolveAccess.mockReset();
    mocks.currentRequestUserIsOrgAdmin.mockReset();
    mocks.currentRequestUserIsOrgAdmin.mockResolvedValue(false);
    mocks.state.orgId = "org-a";
    mocks.state.reviewResource = {
      id: "design_123",
      title: "Org design",
      description: "Same org preview",
      projectType: "prototype",
      designSystemId: null,
      data: JSON.stringify({ canvasFrames: [] }),
      visibility: "private",
      orgId: "org-a",
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:00:00.000Z",
    };
    mocks.state.whereCondition = null;
    mocks.select.mockClear();
    mocks.selectChain.limit.mockClear();
    mocks.selectChain.orderBy.mockReset();
    mocks.asc.mockClear();
    mocks.and.mockClear();
    mocks.eq.mockClear();
    mocks.resolveAccess.mockResolvedValue({
      role: "viewer",
      resource: {
        id: "design_123",
        title: "Public checkout",
        description: "Shared preview",
        projectType: "prototype",
        designSystemId: null,
        data: JSON.stringify({
          canvasFrames: [],
          screenMetadata: {
            file_123: {
              sourceType: "localhost",
              bridgeUrl: "http://127.0.0.1:7331",
              previewToken: "example-read-only-preview-token",
              bridgeToken: "example-private-bridge-token",
            },
          },
        }),
        visibility: "public",
        createdAt: "2026-06-29T00:00:00.000Z",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
    });
    mocks.selectChain.orderBy.mockResolvedValue([
      {
        id: "file_123",
        filename: "index.html",
        fileType: "html",
        content: "<main>Hello</main>",
        createdAt: "2026-06-29T00:00:00.000Z",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
    ]);
  });

  it("exposes a signed-out public read-only surface", () => {
    expect(action.requiresAuth).toBe(false);
    expect(action.publicAgent).toEqual({
      expose: true,
      readOnly: true,
      requiresAuth: false,
    });
  });

  it("returns design files for a public viewer", async () => {
    const result = await action.run({ id: "design_123" });

    expect(mocks.resolveAccess).toHaveBeenCalledWith("design", "design_123");
    expect(result).toMatchObject({
      id: "design_123",
      visibility: "public",
      accessRole: "viewer",
      files: [
        expect.objectContaining({
          filename: "index.html",
          fileType: "html",
        }),
      ],
    });
    expect(result.data).toContain("bridgeUrl");
    expect(result.data).not.toContain("bridgeToken");
    expect(result.data).not.toContain("previewToken");
    expect(result.data).not.toContain("example-private-bridge-token");
  });

  it("allows an org admin to read a same-org design for Human Review", async () => {
    mocks.currentRequestUserIsOrgAdmin.mockResolvedValue(true);
    mocks.track.mockClear();

    const result = await action.run({ id: "design_123", reviewPreview: true });

    expect(mocks.currentRequestUserIsOrgAdmin).toHaveBeenCalledWith("org-a");
    expect(mocks.and).toHaveBeenCalledWith(
      { left: "designs.id", right: "design_123" },
      { left: "designs.orgId", right: "org-a" },
    );
    expect(result).toMatchObject({ id: "design_123", accessRole: "viewer" });
    expect(result.files[0].content).toBe("<main>Hello</main>");
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("rejects non-admin Human Review design previews before querying", async () => {
    await expect(
      action.run({ id: "design_123", reviewPreview: true }),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("hides another org's design from Human Review previews", async () => {
    mocks.currentRequestUserIsOrgAdmin.mockResolvedValue(true);
    mocks.state.reviewResource!.orgId = "org-b";

    await expect(
      action.run({ id: "design_123", reviewPreview: true }),
    ).rejects.toMatchObject({ message: "Design not found.", statusCode: 404 });
  });

  it("includes readable linked design-system context", async () => {
    mocks.resolveAccess.mockResolvedValueOnce({
      role: "viewer",
      resource: {
        id: "design_123",
        title: "Public checkout",
        description: "Shared preview",
        projectType: "prototype",
        designSystemId: "system-7",
        data: JSON.stringify({ canvasFrames: [] }),
        visibility: "public",
        createdAt: "2026-06-29T00:00:00.000Z",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
    });

    const result = await action.run({ id: "design_123" });

    expect(mocks.getDesignSystemRun).toHaveBeenCalledWith(
      expect.objectContaining({ compact: "true" }),
    );
    expect(result.designSystem).toMatchObject({
      status: "available",
      scope: "summary",
      id: "system-7",
      agentContext: "Use --brand-accent: #123456.",
      next: expect.any(String),
    });
  });

  it("returns files in a stable order so a design lays itself out the same way twice", async () => {
    await action.run({ id: "design_123" });

    expect(mocks.selectChain.orderBy).toHaveBeenCalledWith(
      { asc: "designFiles.createdAt" },
      { asc: "designFiles.id" },
    );
  });

  it("can list file metadata without fetching file content", async () => {
    const result = await action.run({
      id: "design_123",
      includeFileContent: false,
    });

    expect(mocks.select).toHaveBeenCalledWith({
      id: "designFiles.id",
      filename: "designFiles.filename",
      fileType: "designFiles.fileType",
      createdAt: "designFiles.createdAt",
      updatedAt: "designFiles.updatedAt",
    });
    expect(result.files).toEqual([
      expect.objectContaining({
        id: "file_123",
        filename: "index.html",
        fileType: "html",
      }),
    ]);
    expect(result.files[0]).not.toHaveProperty("content");
  });

  it("scopes a file read to the requested design and file IDs", async () => {
    await action.run({ id: "design_123", fileId: "file_123" });

    expect(mocks.and).toHaveBeenCalledWith(
      { left: "designFiles.designId", right: "design_123" },
      { left: "designFiles.id", right: "file_123" },
    );
  });

  it("tracks one view per signed-in viewer across repeated reads", async () => {
    mocks.track.mockClear();
    const ctx = { userEmail: "viewer-a@example.com" } as never;
    await action.run({ id: "design_views" }, ctx);
    await action.run({ id: "design_views" }, ctx);
    await action.run({ id: "design_views" }, {
      userEmail: "viewer-b@example.com",
    } as never);
    await action.run({ id: "design_views" });
    await action.run({ id: "design_views" });

    const views = mocks.track.mock.calls.filter(
      ([name]) => name === "design_viewed",
    );
    expect(views).toHaveLength(4);
  });

  it("returns an explicit not-found error for a deleted or inaccessible design", async () => {
    mocks.resolveAccess.mockResolvedValueOnce(null);

    await expect(action.run({ id: "missing-design" })).rejects.toMatchObject({
      message: "Design not found",
      statusCode: 404,
    });
  });

  it("returns only the read-only preview token to an editor", async () => {
    mocks.resolveAccess.mockResolvedValueOnce({
      role: "editor",
      resource: {
        id: "design_123",
        title: "Local checkout",
        data: JSON.stringify({
          screenMetadata: {
            file_123: {
              previewToken: "example-read-only-preview-token",
              bridgeToken: "example-private-bridge-token",
            },
          },
        }),
        visibility: "private",
      },
    });

    const result = await action.run({ id: "design_123" });

    expect(result.data).toContain("example-read-only-preview-token");
    expect(result.data).not.toContain("example-private-bridge-token");
    expect(result.data).not.toContain("bridgeToken");
  });

  it("redacts bridge tokens from object-shaped viewer data too", () => {
    expect(
      designDataForAccessRole(
        {
          bridgeToken: "top-secret",
          nested: [{ bridgeToken: "nested-secret", routeId: "route-home" }],
        },
        "viewer",
      ),
    ).toEqual({ nested: [{ routeId: "route-home" }] });
  });

  it("fails closed instead of returning malformed persisted viewer data", () => {
    expect(
      designDataForAccessRole(
        '{"screenMetadata":{"file_123":{"bridgeToken":"example-private-bridge-token"}}',
        "viewer",
      ),
    ).toBeNull();
  });
});
