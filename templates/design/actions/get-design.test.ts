import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state: {
    orgId: string;
    superOrgId: string | undefined;
    reviewResource: Record<string, unknown> | null;
    whereCondition: unknown;
  } = {
    orgId: "org-a",
    superOrgId: undefined,
    reviewResource: null,
    whereCondition: null,
  };
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
    const where = state.whereCondition as
      | {
          left?: string;
          right?: unknown;
          conditions?: Array<{ left: string; right: unknown }>;
        }
      | undefined;
    const conditions = where?.conditions ?? (where ? [where] : []);
    const scopedToId = conditions.some(
      (condition) =>
        condition.left === "designs.id" &&
        condition.right === state.reviewResource?.id,
    );
    const orgCondition = conditions.find(
      (condition) => condition.left === "designs.orgId",
    );
    return scopedToId && orgCondition?.right === state.reviewResource?.orgId
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
    getAppConfig: vi.fn(() => ({
      observability: { superOrgId: state.superOrgId },
    })),
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
  getAppConfig: () => mocks.getAppConfig(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: () => mocks.getRequestOrgId(),
  getRequestUserEmail: () => undefined,
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
    designs: {
      id: "designs.id",
      ownerEmail: "designs.ownerEmail",
      orgId: "designs.orgId",
    },
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
    mocks.getAppConfig.mockClear();
    mocks.state.orgId = "org-a";
    mocks.state.superOrgId = undefined;
    mocks.state.reviewResource = {
      id: "design_123",
      ownerEmail: "alice@example.com",
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
    mocks.selectChain.where.mockClear();
    mocks.selectChain.limit.mockClear();
    mocks.selectChain.orderBy.mockReset();
    mocks.asc.mockClear();
    mocks.and.mockClear();
    mocks.eq.mockClear();
    mocks.resolveAccess.mockImplementation(
      async (_resource: string, _id: string, options?: { orgId?: string }) => ({
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
          orgId: options?.orgId ?? "org-a",
          createdAt: "2026-06-29T00:00:00.000Z",
          updatedAt: "2026-06-29T00:00:00.000Z",
        },
      }),
    );
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

  it("allows public HTTP reads and exposes authenticated agent reads", () => {
    expect(action.requiresAuth).toBe(false);
    expect(action.publicAgent).toEqual({
      expose: true,
      readOnly: true,
      requiresAuth: true,
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
    mocks.resolveAccess.mockResolvedValueOnce(null);
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

  it.each(["owner", "editor"] as const)(
    "preserves direct %s access for a same-org review preview",
    async (role) => {
      mocks.currentRequestUserIsOrgAdmin.mockResolvedValue(true);
      mocks.resolveAccess.mockResolvedValueOnce({
        role,
        resource: mocks.state.reviewResource,
      });

      const result = await action.run({
        id: "design_123",
        reviewPreview: true,
      });

      expect(mocks.resolveAccess).toHaveBeenCalledWith("design", "design_123");
      expect(result).toMatchObject({ id: "design_123", accessRole: role });
    },
  );

  it("rejects non-admin Human Review design previews before querying", async () => {
    mocks.state.superOrgId = "org-a";

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

  it("allows only the configured super-org admin to preview another org's design", async () => {
    mocks.state.orgId = "builder-org";
    mocks.state.superOrgId = "builder-org";
    mocks.state.reviewResource!.orgId = "customer-org";
    mocks.currentRequestUserIsOrgAdmin.mockResolvedValue(true);
    mocks.track.mockClear();

    const result = await action.run({
      id: "design_123",
      reviewPreview: true,
      reviewOrgId: "customer-org",
    });

    expect(mocks.getAppConfig).toHaveBeenCalled();
    expect(mocks.currentRequestUserIsOrgAdmin).toHaveBeenCalledWith(
      "builder-org",
    );
    expect(mocks.selectChain.where).toHaveBeenCalledWith({
      conditions: [
        { left: "designs.id", right: "design_123" },
        { left: "designs.orgId", right: "customer-org" },
      ],
    });
    expect(mocks.resolveAccess).toHaveBeenCalledWith("design", "design_123", {
      userEmail: "alice@example.com",
      orgId: "customer-org",
    });
    expect(result).toMatchObject({ id: "design_123", accessRole: "viewer" });
    expect(result.files[0].content).toBe("<main>Hello</main>");
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("hides another customer's design from a super-org preview scope", async () => {
    mocks.state.orgId = "builder-org";
    mocks.state.superOrgId = "builder-org";
    mocks.state.reviewResource!.orgId = "other-customer";
    mocks.currentRequestUserIsOrgAdmin.mockResolvedValue(true);

    await expect(
      action.run({
        id: "design_123",
        reviewPreview: true,
        reviewOrgId: "customer-org",
      }),
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

  describe("design_viewed", () => {
    const frontend = (
      userEmail?: string,
      cookie?: string,
    ): Record<string, unknown> => ({
      caller: "frontend",
      ...(userEmail ? { userEmail } : {}),
      requestHeaders: new Headers(cookie ? { cookie } : {}),
    });
    const views = () =>
      mocks.track.mock.calls.filter(([name]) => name === "design_viewed");

    beforeEach(() => {
      mocks.track.mockReset();
    });

    it("fires once for an owner opening the design in the UI", async () => {
      mocks.resolveAccess.mockResolvedValueOnce({
        role: "owner",
        resource: {
          id: "view_owner",
          title: "Mine",
          data: null,
          visibility: "private",
        },
      });

      await action.run(
        { id: "view_owner" },
        frontend("owner@example.com") as never,
      );

      expect(views()).toHaveLength(1);
      const [, properties, source] = views()[0];
      expect(properties).toMatchObject({
        caller: "frontend",
        output_id: "view_owner",
        output_type: "design",
        is_owner: true,
        access_role: "owner",
        viewer_signed_in: true,
        visibility: "private",
        app_name: "design",
      });
      expect(source).toMatchObject({ userEmail: "owner@example.com" });
    });

    it.each(["tool", "mcp", "a2a", "http"])(
      "does not fire for a %s read",
      async (caller) => {
        await action.run({ id: `view_caller_${caller}` }, {
          caller,
          userEmail: "agent-user@example.com",
          requestHeaders: new Headers({ cookie: "an_aid=anon_agent" }),
        } as never);

        expect(views()).toHaveLength(0);
      },
    );

    it("does not fire without an action context", async () => {
      await action.run({ id: "view_no_ctx" });

      expect(views()).toHaveLength(0);
    });

    it("does not fire for a Human Review preview", async () => {
      mocks.currentRequestUserIsOrgAdmin.mockResolvedValue(true);

      await action.run(
        { id: "design_123", reviewPreview: true },
        frontend("admin@example.com") as never,
      );

      expect(views()).toHaveLength(0);
    });

    it("records a signed-out public view under the visitor's anonymous id", async () => {
      await action.run(
        { id: "view_public_anon" },
        frontend(undefined, "theme=dark; an_aid=anon_visitor-1") as never,
      );

      expect(views()).toHaveLength(1);
      const [, properties, source] = views()[0];
      expect(properties).toMatchObject({
        caller: "frontend",
        output_id: "view_public_anon",
        is_owner: false,
        access_role: "viewer",
        viewer_signed_in: false,
        visibility: "public",
      });
      expect(source).toEqual({ anonymousId: "anon_visitor-1" });
    });

    it("records a signed-out view with no identity when the cookie is absent", async () => {
      await action.run({ id: "view_public_none" }, frontend() as never);

      expect(views()).toHaveLength(1);
      expect(views()[0][2]).toBeUndefined();
      expect(views()[0][1]).toMatchObject({ viewer_signed_in: false });
    });

    it("fires once per viewer within the window, keyed by email or anonymous id", async () => {
      for (let i = 0; i < 3; i += 1) {
        await action.run(
          { id: "view_repeat" },
          frontend("viewer-a@example.com") as never,
        );
        await action.run(
          { id: "view_repeat" },
          frontend(undefined, "an_aid=anon_a") as never,
        );
        await action.run({ id: "view_repeat" }, frontend() as never);
      }
      await action.run(
        { id: "view_repeat" },
        frontend("viewer-b@example.com") as never,
      );
      await action.run(
        { id: "view_repeat" },
        frontend(undefined, "an_aid=anon_b") as never,
      );

      const sources = views().map(([, , source]) => source);
      expect(sources).toHaveLength(5);
      expect(sources).toEqual([
        expect.objectContaining({ userEmail: "viewer-a@example.com" }),
        { anonymousId: "anon_a" },
        undefined,
        expect.objectContaining({ userEmail: "viewer-b@example.com" }),
        { anonymousId: "anon_b" },
      ]);
    });

    it("returns the same response when tracking throws", async () => {
      const expected = await action.run({ id: "view_throws" }, {
        caller: "tool",
      } as never);
      mocks.track.mockImplementation(() => {
        throw new Error("provider down");
      });

      const result = await action.run(
        { id: "view_throws" },
        frontend("viewer@example.com", "an_aid=anon_x") as never,
      );

      expect(mocks.track).toHaveBeenCalled();
      expect(result).toEqual(expected);

      const throwingHeaders = new Headers();
      throwingHeaders.get = () => {
        throw new Error("headers unavailable");
      };
      const signedOut = await action.run({ id: "view_throws" }, {
        caller: "frontend",
        requestHeaders: throwingHeaders,
      } as never);
      expect(signedOut).toEqual(expected);
    });
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
