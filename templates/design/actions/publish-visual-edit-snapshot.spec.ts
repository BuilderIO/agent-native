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

  return {
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
      updatedAt: "designVisualEditSnapshots.updatedAt",
    },
    assertAccess: vi.fn(),
    getDb: vi.fn(() => ({
      insert: vi.fn(() => insertChain),
      select: vi.fn(() => selectChain),
    })),
    insertChain,
    selectChain,
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

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ conditions })),
  eq: vi.fn((left, right) => ({ left, right })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: {
    designFiles: mocks.designFiles,
    designVisualEditSnapshots: mocks.designVisualEditSnapshots,
  },
}));

import publishSnapshotAction from "./publish-visual-edit-snapshot.js";

const designId = "design_localhost";
const fileId = "screen_home";
const routeUrl = "http://localhost:5173/";
const snapshotHtml =
  "<!doctype html><html><head><title>Home</title></head><body><main>Home</main></body></html>";
const design = {
  id: designId,
  visibility: "public",
  data: JSON.stringify({
    sourceType: "localhost",
    screenMetadata: {
      [fileId]: {
        sourceType: "localhost",
        url: routeUrl,
      },
    },
  }),
};
const file = {
  id: fileId,
  content: routeUrl,
  fileType: "html",
};

describe("publish visual-edit fallback snapshot", () => {
  beforeEach(() => {
    file.content = routeUrl;
    mocks.assertAccess.mockReset();
    mocks.assertAccess.mockResolvedValue({ role: "owner", resource: design });
    mocks.getDb.mockClear();
    mocks.selectChain.limit.mockReset();
    mocks.selectChain.limit.mockResolvedValue([file]);
    mocks.insertChain.values.mockReset();
    mocks.insertChain.values.mockReturnValue(mocks.insertChain);
    mocks.insertChain.onConflictDoUpdate.mockReset();
    mocks.insertChain.onConflictDoUpdate.mockResolvedValue(undefined);
  });

  it("is an editor-only visual-edit mutation with bounded full-screen HTML", () => {
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
    expect(
      runtimeConfig.schema.safeParse({
        designId,
        fileId,
        html: snapshotHtml,
      }).success,
    ).toBe(true);
    expect(
      runtimeConfig.schema.safeParse({
        designId,
        fileId,
        html: snapshotHtml,
        previewToken: "ignored-extra-input",
      }).success,
    ).toBe(false);
  });

  it("checks editor access and stores the snapshot without replacing the live route", async () => {
    const originalDesignData = design.data;

    await expect(
      publishSnapshotAction.run(
        { designId, fileId, html: snapshotHtml },
        { caller: "frontend", requestHeaders: new Headers() },
      ),
    ).resolves.toEqual({ designId, fileId, published: true });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      designId,
      "editor",
    );
    expect(mocks.insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        designId,
        fileId,
        visibility: "public",
      }),
    );
    expect(mocks.insertChain.values.mock.calls[0]?.[0].html).toContain(
      "<main>Home</main>",
    );
    expect(mocks.insertChain.onConflictDoUpdate.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        target: [
          "designVisualEditSnapshots.designId",
          "designVisualEditSnapshots.fileId",
        ],
        set: expect.objectContaining({
          html: expect.stringContaining("<main>Home</main>"),
        }),
      }),
    );
    expect(file.content).toBe(routeUrl);
    expect(design.data).toBe(originalDesignData);
    expect(JSON.parse(design.data).screenMetadata[fileId]).toMatchObject({
      url: routeUrl,
    });
  });

  it("stores only an inert snapshot and recognizes screens through their bridge URL", async () => {
    const originalData = design.data;
    design.data = JSON.stringify({
      sourceType: "localhost",
      screenMetadata: {
        [fileId]: { bridgeUrl: "http://localhost:7331" },
      },
    });

    await expect(
      publishSnapshotAction.run(
        {
          designId,
          fileId,
          html: `<html><head><style>main { color: red }</style></head><body><main onclick="evil()"><script>top.alert('evil')</script><a href="javascript:evil()">Home</a><img src="http://localhost:5173/private.png"><img src="https://cdn.example.test/screen.png"></main></body></html>`,
        },
        { caller: "frontend", requestHeaders: new Headers() },
      ),
    ).resolves.toMatchObject({ published: true });

    const publishedHtml = mocks.insertChain.values.mock.calls.at(-1)?.[0].html;
    expect(publishedHtml).not.toContain("<script");
    expect(publishedHtml).not.toContain("<style");
    expect(publishedHtml).not.toContain("onclick");
    expect(publishedHtml).not.toContain("href=");
    expect(publishedHtml).not.toContain("localhost:5173");
    expect(publishedHtml).toContain("https://cdn.example.test/screen.png");
    expect(design.data).not.toContain("<script");
    design.data = originalData;
  });

  it("rejects public viewer writes even while the file still stores its route URL", async () => {
    mocks.assertAccess.mockRejectedValue(new Error("Requires editor role"));

    await expect(
      publishSnapshotAction.run(
        { designId, fileId, html: snapshotHtml },
        { caller: "frontend", requestHeaders: new Headers() },
      ),
    ).rejects.toThrow(/Requires editor role/);
    expect(file.content).toBe(routeUrl);
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      designId,
      "editor",
    );
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.insertChain.values).not.toHaveBeenCalled();
  });

  it("rejects files outside the design and non-HTML files", async () => {
    mocks.selectChain.limit.mockResolvedValueOnce([]);
    await expect(
      publishSnapshotAction.run(
        { designId, fileId, html: snapshotHtml },
        { caller: "frontend", requestHeaders: new Headers() },
      ),
    ).rejects.toThrow(/does not belong to this design/);

    mocks.selectChain.limit.mockResolvedValueOnce([
      { ...file, fileType: "css" },
    ]);
    await expect(
      publishSnapshotAction.run(
        { designId, fileId, html: snapshotHtml },
        { caller: "frontend", requestHeaders: new Headers() },
      ),
    ).rejects.toThrow(/only be published for HTML screens/);
    expect(mocks.insertChain.values).not.toHaveBeenCalled();
  });

  it("refuses non-Localhost or malformed screen metadata before collaboration writes", async () => {
    const originalData = design.data;
    design.data = JSON.stringify({
      screenMetadata: { [fileId]: { sourceType: "fusion", url: routeUrl } },
    });
    await expect(
      publishSnapshotAction.run(
        { designId, fileId, html: snapshotHtml },
        { caller: "frontend", requestHeaders: new Headers() },
      ),
    ).rejects.toThrow(/Only Localhost screens/);

    design.data = "{";
    await expect(
      publishSnapshotAction.run(
        { designId, fileId, html: snapshotHtml },
        { caller: "frontend", requestHeaders: new Headers() },
      ),
    ).rejects.toThrow(/Design data is malformed/);
    design.data = originalData;
    expect(mocks.insertChain.values).not.toHaveBeenCalled();
  });

  it("rejects malformed, NUL-containing, or oversized HTML", async () => {
    await expect(
      publishSnapshotAction.run(
        { designId, fileId, html: "<html><body><main></body></html>" },
        { caller: "frontend", requestHeaders: new Headers() },
      ),
    ).rejects.toThrow(/HTML is malformed/);
    await expect(
      publishSnapshotAction.run(
        { designId, fileId, html: `${snapshotHtml}\u0000` },
        { caller: "frontend", requestHeaders: new Headers() },
      ),
    ).rejects.toThrow(/HTML is malformed or exceeds/);
    await expect(
      publishSnapshotAction.run(
        { designId, fileId, html: "   " },
        { caller: "frontend", requestHeaders: new Headers() },
      ),
    ).rejects.toThrow(/HTML is malformed or exceeds/);
    await expect(
      publishSnapshotAction.run(
        { designId, fileId, html: routeUrl },
        { caller: "frontend", requestHeaders: new Headers() },
      ),
    ).rejects.toThrow(/HTML is malformed or exceeds/);
    await expect(
      publishSnapshotAction.run(
        { designId, fileId, html: "x".repeat(1024 * 1024 + 1) },
        { caller: "frontend", requestHeaders: new Headers() },
      ),
    ).rejects.toThrow(/HTML is malformed or exceeds/);
    await expect(
      publishSnapshotAction.run(
        {
          designId,
          fileId,
          html: `<p>${"é".repeat(524_300)}</p>`,
        },
        { caller: "frontend", requestHeaders: new Headers() },
      ),
    ).rejects.toThrow(/HTML is malformed or exceeds/);
    expect(mocks.insertChain.values).not.toHaveBeenCalled();
  });
});
