import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectChain = {
    from: vi.fn(),
    where: vi.fn(),
    for: vi.fn(),
    limit: vi.fn(),
  };
  selectChain.from.mockImplementation((table: unknown) => {
    mocks.currentTable = table;
    return selectChain;
  });
  selectChain.where.mockReturnValue(selectChain);
  selectChain.for.mockReturnValue(selectChain);

  const updateChain = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  };
  updateChain.set.mockReturnValue(updateChain);
  updateChain.where.mockReturnValue(updateChain);

  const transaction = {
    select: vi.fn(() => selectChain),
    update: vi.fn(() => updateChain),
  };

  const blob = {
    id: "opaque-example-handle",
    provider: "test-private-provider",
    opaque: true,
    encrypted: true,
  };

  return {
    designs: {
      id: "designs.id",
      data: "designs.data",
      visibility: "designs.visibility",
      ownerEmail: "designs.ownerEmail",
      orgId: "designs.orgId",
    },
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      content: "designFiles.content",
      fileType: "designFiles.fileType",
    },
    designVisualEditSnapshots: {
      designId: "designVisualEditSnapshots.designId",
      fileId: "designVisualEditSnapshots.fileId",
      html: "designVisualEditSnapshots.html",
      blobHandle: "designVisualEditSnapshots.blobHandle",
      captureRevision: "designVisualEditSnapshots.captureRevision",
      publishedRevision: "designVisualEditSnapshots.publishedRevision",
      updatedAt: "designVisualEditSnapshots.updatedAt",
    },
    assertAccess: vi.fn(),
    putPrivateBlob: vi.fn(),
    deleteVisualEditSnapshotBlobs: vi.fn(),
    queueVisualEditSnapshotBlobCleanupInTransaction: vi.fn(),
    sql: vi.fn((chunks: TemplateStringsArray, ...values: unknown[]) => ({
      chunks: [...chunks],
      values,
    })),
    getDb: vi.fn(() => ({
      select: vi.fn(() => selectChain),
      transaction: vi.fn(
        async (callback: (tx: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    })),
    blob,
    currentTable: null as unknown,
    snapshotRow: {
      blobHandle: null as string | null,
      captureRevision: 7n,
      publishedRevision: 0n,
    },
    selectChain,
    transaction,
    updateChain,
  };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
  fail: (message: string, options?: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  },
}));

vi.mock("@agent-native/core/private-blob", () => ({
  putPrivateBlob: mocks.putPrivateBlob,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ conditions })),
  eq: vi.fn((left, right) => ({ left, right })),
  sql: mocks.sql,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: {
    designs: mocks.designs,
    designFiles: mocks.designFiles,
    designVisualEditSnapshots: mocks.designVisualEditSnapshots,
  },
}));
vi.mock("../server/source-workspace.js", () => ({
  withDesignSourceMutationTransaction: vi.fn(
    (_designId: string, callback: (tx: typeof mocks.transaction) => unknown) =>
      mocks.getDb().transaction(callback),
  ),
}));
vi.mock("../server/lib/visual-edit-snapshot-blobs.js", () => ({
  deleteVisualEditSnapshotBlobs: mocks.deleteVisualEditSnapshotBlobs,
  queueVisualEditSnapshotBlobCleanupInTransaction:
    mocks.queueVisualEditSnapshotBlobCleanupInTransaction,
}));

import { sanitizeVisualEditSnapshotHtml } from "../shared/visual-edit-snapshot.js";
import publishSnapshotAction from "./publish-visual-edit-snapshot.js";

const designId = "design_localhost";
const fileId = "screen_home";
const reservationToken = "7";
const routeUrl = "http://localhost:5173/";
const snapshotHtml =
  "<!doctype html><html><head><title>Home</title></head><body><main>Home</main></body></html>";
const design = {
  id: designId,
  ownerEmail: "owner@example.test",
  orgId: null,
  visibility: "public",
  data: JSON.stringify({
    sourceType: "localhost",
    screenMetadata: {
      [fileId]: { sourceType: "localhost", url: routeUrl },
    },
  }),
};
const file = { id: fileId, content: routeUrl, fileType: "html" };

function input(html = snapshotHtml) {
  return { designId, fileId, reservationToken, html };
}

describe("publish visual-edit fallback snapshot", () => {
  beforeEach(() => {
    file.content = routeUrl;
    mocks.assertAccess.mockReset();
    mocks.assertAccess.mockResolvedValue({ role: "owner", resource: design });
    mocks.putPrivateBlob.mockReset();
    mocks.putPrivateBlob.mockResolvedValue(mocks.blob);
    mocks.deleteVisualEditSnapshotBlobs.mockReset();
    mocks.deleteVisualEditSnapshotBlobs.mockResolvedValue(undefined);
    mocks.queueVisualEditSnapshotBlobCleanupInTransaction.mockReset();
    mocks.queueVisualEditSnapshotBlobCleanupInTransaction.mockResolvedValue(
      undefined,
    );
    mocks.getDb.mockClear();
    mocks.currentTable = null;
    mocks.snapshotRow = {
      blobHandle: null,
      captureRevision: 7n,
      publishedRevision: 0n,
    };
    mocks.selectChain.limit.mockReset();
    mocks.selectChain.limit.mockImplementation(() => {
      if (mocks.currentTable === mocks.designs) {
        return Promise.resolve([design]);
      }
      if (mocks.currentTable === mocks.designFiles) {
        return Promise.resolve([file]);
      }
      return Promise.resolve([mocks.snapshotRow]);
    });
    mocks.updateChain.set.mockClear();
    mocks.updateChain.where.mockClear();
    mocks.updateChain.returning.mockReset();
    mocks.updateChain.returning.mockResolvedValue([
      { blobHandle: JSON.stringify(mocks.blob) },
    ]);
  });

  it("requires editor access and a server-issued token", () => {
    const runtimeConfig = publishSnapshotAction as unknown as {
      schema: { safeParse: (value: unknown) => { success: boolean } };
    };
    expect(publishSnapshotAction).toMatchObject({
      requiresAuth: true,
      agentTool: false,
      mcpTool: false,
      capabilityScopes: ["visual-edit"],
      maxBodyBytes: expect.any(Number),
    });
    expect(runtimeConfig.schema.safeParse(input()).success).toBe(true);
    expect(
      runtimeConfig.schema.safeParse({
        designId,
        fileId,
        html: snapshotHtml,
      }).success,
    ).toBe(false);
    expect(
      runtimeConfig.schema.safeParse({ ...input(), previewToken: "extra" })
        .success,
    ).toBe(false);
  });

  it("stores sanitized HTML in private blob storage and only its opaque handle in SQL", async () => {
    const originalData = design.data;
    await expect(
      publishSnapshotAction.run(input(), {
        caller: "frontend",
        requestHeaders: new Headers(),
      }),
    ).resolves.toEqual({ designId, fileId, published: true });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      designId,
      "editor",
    );
    expect(mocks.putPrivateBlob).toHaveBeenCalledWith({
      data: Buffer.from(sanitizeVisualEditSnapshotHtml(snapshotHtml), "utf8"),
      filename: "visual-edit-screen.html",
      mimeType: "text/html",
      ownerEmail: "owner@example.test",
    });
    expect(mocks.updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        blobHandle: JSON.stringify(mocks.blob),
        html: "",
        publishedRevision: 7n,
        visibility: "public",
      }),
    );
    const conditions = mocks.updateChain.where.mock.calls[0]?.[0].conditions;
    expect(conditions).toContainEqual({
      left: "designVisualEditSnapshots.captureRevision",
      right: 7n,
    });
    expect(mocks.sql).toHaveBeenCalledWith(
      ["", " < ", ""],
      "designVisualEditSnapshots.publishedRevision",
      7n,
    );
    expect(file.content).toBe(routeUrl);
    expect(design.data).toBe(originalData);
  });

  it("stores only inert sanitized HTML through the private blob API", async () => {
    const originalData = design.data;
    design.data = JSON.stringify({
      sourceType: "localhost",
      screenMetadata: { [fileId]: { bridgeUrl: "http://localhost:7331" } },
    });

    await expect(
      publishSnapshotAction.run(
        input(
          `<html><head><style>main { color: red }</style></head><body><main onclick="evil()"><script>top.alert('evil')</script><a href="javascript:evil()">Home</a><img src="http://localhost:5173/private.png"><img src="https://cdn.example.test/screen.png"><img src="data:image/png;base64,AAAA"></main></body></html>`,
        ),
        { caller: "frontend", requestHeaders: new Headers() },
      ),
    ).resolves.toMatchObject({ published: true });

    const publishedHtml = Buffer.from(
      mocks.putPrivateBlob.mock.calls.at(-1)?.[0].data,
    ).toString("utf8");
    expect(publishedHtml).not.toContain("<script");
    expect(publishedHtml).not.toContain("<style");
    expect(publishedHtml).not.toContain("onclick");
    expect(publishedHtml).not.toContain("href=");
    expect(publishedHtml).not.toContain("localhost:5173");
    expect(publishedHtml).not.toContain("https://cdn.example.test/screen.png");
    expect(publishedHtml).toContain('src="data:image/png;base64,AAAA"');
    expect(design.data).not.toContain("<script");
    design.data = originalData;
  });

  it("returns stale when another capture reserved later and deletes the unused blob", async () => {
    mocks.updateChain.returning.mockResolvedValueOnce([]);

    await expect(
      publishSnapshotAction.run(input(), {
        caller: "frontend",
        requestHeaders: new Headers(),
      }),
    ).resolves.toEqual({ designId, fileId, published: false });

    expect(mocks.deleteVisualEditSnapshotBlobs).toHaveBeenCalledWith([
      JSON.stringify(mocks.blob),
    ]);
  });

  it("deletes the previous private blob after replacing its snapshot", async () => {
    const oldBlob = {
      id: "older-opaque-example",
      provider: "test-private-provider",
      opaque: true,
      encrypted: true,
    };
    mocks.snapshotRow = {
      blobHandle: JSON.stringify(oldBlob),
      captureRevision: 7n,
      publishedRevision: 0n,
    };

    await expect(
      publishSnapshotAction.run(input(), {
        caller: "frontend",
        requestHeaders: new Headers(),
      }),
    ).resolves.toMatchObject({ published: true });

    expect(
      mocks.queueVisualEditSnapshotBlobCleanupInTransaction,
    ).toHaveBeenCalledWith(mocks.transaction, [JSON.stringify(oldBlob)]);
    expect(mocks.deleteVisualEditSnapshotBlobs).toHaveBeenCalledWith([
      JSON.stringify(oldBlob),
    ]);
  });

  it("fails closed when private blob storage is unavailable", async () => {
    mocks.putPrivateBlob.mockResolvedValueOnce(null);

    await expect(
      publishSnapshotAction.run(input(), {
        caller: "frontend",
        requestHeaders: new Headers(),
      }),
    ).rejects.toMatchObject({
      errorCode: "visual_edit_snapshot_storage_unavailable",
    });
    expect(mocks.updateChain.set).not.toHaveBeenCalled();
  });

  it("rejects viewer writes, foreign files, and non-Localhost screens", async () => {
    mocks.assertAccess.mockRejectedValue(new Error("Requires editor role"));
    await expect(
      publishSnapshotAction.run(input(), {
        caller: "frontend",
        requestHeaders: new Headers(),
      }),
    ).rejects.toThrow(/Requires editor role/);
    expect(mocks.getDb).not.toHaveBeenCalled();

    mocks.assertAccess.mockResolvedValue({ role: "owner", resource: design });
    mocks.selectChain.limit.mockResolvedValueOnce([]);
    await expect(
      publishSnapshotAction.run(input(), {
        caller: "frontend",
        requestHeaders: new Headers(),
      }),
    ).rejects.toThrow(/does not belong to this design/);

    const originalData = design.data;
    design.data = JSON.stringify({
      screenMetadata: { [fileId]: { sourceType: "fusion", url: routeUrl } },
    });
    await expect(
      publishSnapshotAction.run(input(), {
        caller: "frontend",
        requestHeaders: new Headers(),
      }),
    ).rejects.toThrow(/Only Localhost screens/);
    design.data = originalData;
    expect(mocks.putPrivateBlob).not.toHaveBeenCalled();
  });

  it("rejects malformed or oversized HTML and out-of-range reservations", async () => {
    for (const html of [
      "<html><body><main></body></html>",
      `${snapshotHtml}\u0000`,
      "   ",
      routeUrl,
      "x".repeat(1024 * 1024 + 1),
      `<p>${"é".repeat(524_300)}</p>`,
    ]) {
      await expect(
        publishSnapshotAction.run(input(html), {
          caller: "frontend",
          requestHeaders: new Headers(),
        }),
      ).rejects.toThrow(/HTML is malformed/);
    }
    await expect(
      publishSnapshotAction.run(
        { ...input(), reservationToken: "9223372036854775808" },
        { caller: "frontend", requestHeaders: new Headers() },
      ),
    ).rejects.toMatchObject({
      errorCode: "invalid_visual_edit_snapshot_reservation",
    });
    expect(mocks.putPrivateBlob).not.toHaveBeenCalled();
  });
});
