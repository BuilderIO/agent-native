import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  const fileQuery = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  fileQuery.from.mockReturnValue(fileQuery);
  fileQuery.where.mockReturnValue(fileQuery);
  const designQuery = { from: vi.fn(), where: vi.fn(), limit: vi.fn() };
  designQuery.from.mockReturnValue(designQuery);
  designQuery.where.mockReturnValue(designQuery);
  const select = vi.fn((selection) => {
    if (
      selection?.data === "designs.data" ||
      selection?.liveCollaborationEnabled === "designs.enabled"
    ) {
      return designQuery;
    }
    return selection?.content === "files.content" ? fileQuery : query;
  });

  return {
    files: {
      id: "files.id",
      designId: "files.designId",
      content: "files.content",
      fileType: "files.fileType",
    },
    designs: {
      id: "designs.id",
      data: "designs.data",
      liveCollaborationEnabled: "designs.enabled",
    },
    snapshots: {
      designId: "snapshots.designId",
      fileId: "snapshots.fileId",
      html: "snapshots.html",
      blobHandle: "snapshots.blobHandle",
      updatedAt: "snapshots.updatedAt",
      captureRevision: "snapshots.captureRevision",
      publishedRevision: "snapshots.publishedRevision",
    },
    assertAccess: vi.fn(),
    assertLocalhostScreenMetadata: vi.fn(),
    readPrivateBlob: vi.fn(),
    select,
    blob: {
      id: "opaque-example-handle",
      provider: "test-private-provider",
      opaque: true,
      encrypted: true,
    },
    getDb: vi.fn(() => ({ select })),
    query,
    fileQuery,
    designQuery,
    design: {
      liveCollaborationEnabled: true,
      data: JSON.stringify({
        sourceType: "localhost",
        screenMetadata: {
          "screen-one": {
            sourceType: "localhost",
            url: "http://localhost:5173/",
          },
        },
      }),
    },
  };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
  fail: (message: string, options?: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  },
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));
vi.mock("@agent-native/core/private-blob", () => ({
  readPrivateBlob: mocks.readPrivateBlob,
}));
vi.mock("../server/lib/visual-edit-snapshot-blobs.js", () => ({
  parseVisualEditSnapshotBlobHandle: (value: string) => JSON.parse(value),
}));
vi.mock("./publish-visual-edit-snapshot.js", () => ({
  assertLocalhostScreenMetadata: mocks.assertLocalhostScreenMetadata,
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ conditions })),
  eq: vi.fn((left, right) => ({ left, right })),
}));
vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: {
    designFiles: mocks.files,
    designs: mocks.designs,
    designVisualEditSnapshots: mocks.snapshots,
  },
}));
vi.mock("../server/source-workspace.js", () => ({
  withDesignSourceReadTransaction: vi.fn(
    (
      _designId: string,
      callback: (tx: { select: typeof mocks.select }) => unknown,
    ) => callback({ select: mocks.select }),
  ),
}));

import getSnapshotAction from "./get-visual-edit-snapshot.js";

describe("get visual-edit fallback snapshot", () => {
  beforeEach(() => {
    mocks.assertAccess.mockReset();
    mocks.assertAccess.mockResolvedValue({
      role: "viewer",
      resource: mocks.design,
    });
    mocks.assertLocalhostScreenMetadata.mockReset();
    mocks.readPrivateBlob.mockReset();
    mocks.readPrivateBlob.mockResolvedValue({
      data: new TextEncoder().encode("<html><body>Shared</body></html>"),
    });
    mocks.select.mockClear();
    mocks.getDb.mockClear();
    mocks.query.limit.mockReset();
    mocks.fileQuery.limit.mockReset();
    mocks.fileQuery.limit.mockResolvedValue([
      { content: "http://localhost:5173/", fileType: "html" },
    ]);
    mocks.designQuery.limit.mockResolvedValue([mocks.design]);
    mocks.query.limit.mockResolvedValue([]);
  });

  it("requires design viewer access and scopes the snapshot to its screen", async () => {
    const result = {
      html: "",
      blobHandle: JSON.stringify(mocks.blob),
      updatedAt: "2026-09-24T00:00:00.000Z",
      captureRevision: 4n,
      publishedRevision: 3n,
    };
    mocks.query.limit.mockResolvedValue([result]);

    await expect(
      getSnapshotAction.run(
        { designId: "design-one", fileId: "screen-one" },
        { caller: "frontend" },
      ),
    ).resolves.toEqual({
      designId: "design-one",
      fileId: "screen-one",
      html: "<html><body>Shared</body></html>",
      updatedAt: result.updatedAt,
      captureRevision: "4",
      publishedRevision: "3",
      unchanged: false,
    });
    expect(mocks.readPrivateBlob).toHaveBeenCalledWith(mocks.blob);
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design-one",
      "viewer",
    );
    expect(mocks.query.where).toHaveBeenCalledWith({
      conditions: [
        { left: "snapshots.designId", right: "design-one" },
        { left: "snapshots.fileId", right: "screen-one" },
      ],
    });
    expect(mocks.assertLocalhostScreenMetadata).toHaveBeenCalledWith(
      mocks.design.data,
      "screen-one",
      "http://localhost:5173/",
    );
  });

  it("returns an empty fallback without reading stored snapshots when collaboration is off", async () => {
    mocks.design.liveCollaborationEnabled = false;

    await expect(
      getSnapshotAction.run(
        { designId: "design-one", fileId: "screen-one" },
        { caller: "frontend" },
      ),
    ).resolves.toEqual({
      designId: "design-one",
      fileId: "screen-one",
      html: null,
      updatedAt: null,
      captureRevision: "0",
      publishedRevision: null,
      unchanged: false,
    });
    expect(mocks.readPrivateBlob).not.toHaveBeenCalled();
    mocks.design.liveCollaborationEnabled = true;
  });

  it("refuses a stale or non-Localhost screen before returning a saved fallback", async () => {
    mocks.fileQuery.limit.mockResolvedValueOnce([]);
    await expect(
      getSnapshotAction.run(
        { designId: "design-one", fileId: "screen-one" },
        { caller: "frontend" },
      ),
    ).rejects.toMatchObject({
      errorCode: "visual_edit_snapshot_file_mismatch",
    });
    expect(mocks.query.limit).not.toHaveBeenCalled();

    mocks.fileQuery.limit.mockResolvedValueOnce([
      { content: "http://localhost:5173/", fileType: "html" },
    ]);
    mocks.assertLocalhostScreenMetadata.mockImplementationOnce(() => {
      throw new Error(
        "Only Localhost screens can publish a visual-edit snapshot.",
      );
    });
    await expect(
      getSnapshotAction.run(
        { designId: "design-one", fileId: "screen-one" },
        { caller: "frontend" },
      ),
    ).rejects.toThrow(/Only Localhost screens/);
    expect(mocks.query.limit).not.toHaveBeenCalled();
  });

  it("omits the HTML body when the viewer already has the latest snapshot", async () => {
    const unchangedRow = {
      updatedAt: "2026-09-24T00:00:00.000Z",
      captureRevision: 4n,
      publishedRevision: 3n,
    };
    Object.defineProperties(unchangedRow, {
      html: {
        get() {
          throw new Error("unchanged snapshot HTML should not be selected");
        },
      },
      blobHandle: {
        get() {
          throw new Error(
            "unchanged snapshot blob handle should not be selected",
          );
        },
      },
    });
    mocks.query.limit.mockResolvedValue([unchangedRow]);

    await expect(
      getSnapshotAction.run(
        {
          designId: "design-one",
          fileId: "screen-one",
          knownPublishedRevision: "3",
        },
        { caller: "frontend" },
      ),
    ).resolves.toEqual({
      designId: "design-one",
      fileId: "screen-one",
      html: null,
      updatedAt: "2026-09-24T00:00:00.000Z",
      captureRevision: "4",
      publishedRevision: "3",
      unchanged: true,
    });
    expect(mocks.select).toHaveBeenCalledTimes(3);
    expect(mocks.select).toHaveBeenCalledWith({
      html: "snapshots.html",
      blobHandle: "snapshots.blobHandle",
      updatedAt: "snapshots.updatedAt",
      captureRevision: "snapshots.captureRevision",
      publishedRevision: "snapshots.publishedRevision",
    });
    expect(mocks.readPrivateBlob).not.toHaveBeenCalled();
  });

  it("keeps legacy timestamp polling working when no revision is sent", async () => {
    mocks.query.limit.mockResolvedValue([
      {
        updatedAt: "2026-09-24T00:00:00.000Z",
        captureRevision: 4n,
        publishedRevision: 3n,
      },
    ]);

    await expect(
      getSnapshotAction.run(
        {
          designId: "design-one",
          fileId: "screen-one",
          knownUpdatedAt: "2026-09-24T00:00:00.000Z",
        },
        { caller: "frontend" },
      ),
    ).resolves.toEqual({
      designId: "design-one",
      fileId: "screen-one",
      html: null,
      updatedAt: "2026-09-24T00:00:00.000Z",
      captureRevision: "4",
      publishedRevision: "3",
      unchanged: true,
    });
    expect(mocks.select).toHaveBeenCalledTimes(3);
  });

  it("fetches a new revision even when its timestamp matches the cached one", async () => {
    mocks.query.limit.mockResolvedValue([
      {
        html: "<html><body>New revision</body></html>",
        blobHandle: null,
        updatedAt: "2026-09-24T00:00:00.000Z",
        captureRevision: 5n,
        publishedRevision: 4n,
      },
    ]);

    await expect(
      getSnapshotAction.run(
        {
          designId: "design-one",
          fileId: "screen-one",
          knownUpdatedAt: "2026-09-24T00:00:00.000Z",
          knownPublishedRevision: "3",
        },
        { caller: "frontend" },
      ),
    ).resolves.toEqual({
      designId: "design-one",
      fileId: "screen-one",
      html: "<html><body>New revision</body></html>",
      updatedAt: "2026-09-24T00:00:00.000Z",
      captureRevision: "5",
      publishedRevision: "4",
      unchanged: false,
    });
  });

  it("keeps pre-blob snapshots readable until the owner publishes again", async () => {
    mocks.query.limit.mockResolvedValue([
      {
        html: "<html><body>Legacy</body></html>",
        blobHandle: null,
        updatedAt: "2026-09-24T00:00:00.000Z",
        captureRevision: 3n,
        publishedRevision: 2n,
      },
    ]);

    await expect(
      getSnapshotAction.run(
        { designId: "design-one", fileId: "screen-one" },
        { caller: "frontend" },
      ),
    ).resolves.toEqual({
      designId: "design-one",
      fileId: "screen-one",
      html: "<html><body>Legacy</body></html>",
      updatedAt: "2026-09-24T00:00:00.000Z",
      captureRevision: "3",
      publishedRevision: "2",
      unchanged: false,
    });
    expect(mocks.readPrivateBlob).not.toHaveBeenCalled();
  });

  it("keeps a retired snapshot empty while returning its published revision", async () => {
    mocks.query.limit
      .mockResolvedValueOnce([
        {
          updatedAt: "2026-09-24T00:00:00.000Z",
          captureRevision: 6n,
          publishedRevision: 5n,
        },
      ])
      .mockResolvedValueOnce([
        {
          html: "",
          blobHandle: null,
          updatedAt: "2026-09-24T00:00:00.000Z",
          captureRevision: 6n,
          publishedRevision: 5n,
        },
      ]);

    await expect(
      getSnapshotAction.run(
        { designId: "design-one", fileId: "screen-one" },
        { caller: "frontend" },
      ),
    ).resolves.toEqual({
      designId: "design-one",
      fileId: "screen-one",
      html: null,
      updatedAt: null,
      captureRevision: "6",
      publishedRevision: "5",
      unchanged: false,
    });
    expect(mocks.readPrivateBlob).not.toHaveBeenCalled();
  });

  it("returns an explicit empty value when the owner has not published a snapshot", async () => {
    mocks.query.limit.mockResolvedValue([]);

    await expect(
      getSnapshotAction.run(
        { designId: "design-one", fileId: "screen-one" },
        { caller: "frontend" },
      ),
    ).resolves.toEqual({
      designId: "design-one",
      fileId: "screen-one",
      html: null,
      updatedAt: null,
      captureRevision: "0",
      publishedRevision: null,
      unchanged: false,
    });
  });
});
