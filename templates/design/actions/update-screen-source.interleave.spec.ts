import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const schema = {
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      fileType: "designFiles.fileType",
      content: "designFiles.content",
      createdAt: "designFiles.createdAt",
      updatedAt: "designFiles.updatedAt",
    },
    designs: { id: "designs.id", data: "designs.data" },
    designLocalhostConnections: {
      id: "connections.id",
      ownerEmail: "connections.ownerEmail",
      orgId: "connections.orgId",
      updatedAt: "connections.updatedAt",
    },
  };
  const file = {
    id: "file_1",
    designId: "design_1",
    filename: "localhost-home.html",
    fileType: "html",
    content: "http://localhost:5173/",
    createdAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
  };
  const connection = {
    id: "connection_1",
    devServerUrl: "http://localhost:5173",
    bridgeUrl: "http://127.0.0.1:7331",
    previewToken: "preview-token",
  };
  const designData = {
    screenMetadata: {
      file_1: {
        sourceType: "localhost",
        url: "http://localhost:5173/",
        previewUrl: "http://localhost:5173/",
        path: "/",
        connectionId: "connection_1",
      },
    },
    localhostScreens: {},
  };
  const fileQuery = { from: vi.fn(), where: vi.fn() };
  const designQuery = { from: vi.fn(), where: vi.fn() };
  const connectionQuery = { from: vi.fn(), where: vi.fn() };
  const db = { select: vi.fn() };

  fileQuery.from.mockReturnValue(fileQuery);
  fileQuery.where.mockReturnValue({ limit: vi.fn().mockResolvedValue([file]) });
  designQuery.from.mockReturnValue(designQuery);
  designQuery.where.mockReturnValue({
    limit: vi.fn().mockResolvedValue([{ data: JSON.stringify(designData) }]),
  });
  connectionQuery.from.mockReturnValue(connectionQuery);
  connectionQuery.where.mockReturnValue({
    orderBy: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue([connection]),
    }),
  });
  db.select.mockImplementation((projection?: Record<string, unknown>) => ({
    from: (table: unknown) => {
      if (projection && "data" in projection) return designQuery;
      if (table === schema.designLocalhostConnections) return connectionQuery;
      return fileQuery;
    },
  }));

  return {
    schema,
    file,
    connection,
    designData,
    db,
    assertAccess: vi.fn().mockResolvedValue(undefined),
    snapshotDesignBeforeAgentEdit: vi.fn().mockResolvedValue(undefined),
    resolveLocalhostConnectionScope: vi
      .fn()
      .mockResolvedValue({ ownerEmail: "user@example.com", orgId: "org_1" }),
    readLiveSourceFile: vi.fn(),
    writeInlineSourceFile: vi.fn(),
    mutateDesignData: vi.fn(),
    and: vi.fn((...parts: unknown[]) => ({ parts })),
    desc: vi.fn((value: unknown) => value),
    eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
    isNull: vi.fn((value: unknown) => ({ isNull: value })),
  };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));
vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  desc: mocks.desc,
  eq: mocks.eq,
  isNull: mocks.isNull,
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.db,
  schema: mocks.schema,
}));
vi.mock("../server/lib/design-data-mutation.js", () => ({
  mutateDesignData: mocks.mutateDesignData,
}));
vi.mock("../server/lib/design-versions.js", () => ({
  snapshotDesignBeforeAgentEdit: mocks.snapshotDesignBeforeAgentEdit,
}));
vi.mock("../server/lib/localhost-connection.js", () => ({
  localhostBridgeRequestError: (operation: string) =>
    new Error(`bridge ${operation} failed`),
  resolveLocalhostConnectionScope: mocks.resolveLocalhostConnectionScope,
}));
vi.mock("../server/source-workspace.js", () => ({
  readLiveSourceFile: mocks.readLiveSourceFile,
  writeInlineSourceFile: mocks.writeInlineSourceFile,
}));
vi.mock("./add-localhost-screens.js", () => ({
  pathFromUrl: (_baseUrl: string, url: string) => new URL(url).pathname,
  routeUrl: (baseUrl: string, args: { url?: string; path?: string }) =>
    new URL(args.url ?? args.path ?? "/", baseUrl).toString(),
}));

import action from "./update-screen-source.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readLiveSourceFile.mockResolvedValue({
    content: mocks.file.content,
    versionHash: "live-base-hash",
    language: "html",
  });
  mocks.writeInlineSourceFile.mockResolvedValue({
    versionHash: "live-next-hash",
    changed: true,
    updatedAt: "2026-09-11T00:00:01.000Z",
  });
  mocks.mutateDesignData.mockImplementation(
    async ({
      mutate,
      isApplied,
    }: {
      mutate: (data: Record<string, unknown>) => Record<string, unknown>;
      isApplied: (data: Record<string, unknown>) => boolean;
    }) => {
      const next = mutate(mocks.designData);
      expect(isApplied(next)).toBe(true);
      return { data: next, updatedAt: "2026-09-11T00:00:01.000Z" };
    },
  );
});

describe("update-screen-source source version guard", () => {
  it("passes the live source hash so a concurrent source edit rejects before metadata changes", async () => {
    mocks.writeInlineSourceFile.mockRejectedValue(
      new Error(
        "Source file changed since it was read. Re-read the file and retry.",
      ),
    );

    await expect(
      action.run({
        designId: "design_1",
        fileId: "file_1",
        sourceType: "url",
        path: "/plans",
      }),
    ).rejects.toThrow(/Source file changed/);

    expect(mocks.writeInlineSourceFile).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersionHash: "live-base-hash",
        content: "http://localhost:5173/plans",
      }),
    );
    expect(mocks.mutateDesignData).not.toHaveBeenCalled();
  });
});
