import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readPrivateBlob: vi.fn(),
  resolveReference: vi.fn(),
  createDesign: vi.fn(),
  saveFiles: vi.fn(),
  mutateDesignData: vi.fn(),
}));

vi.mock("@agent-native/core/private-blob", () => ({
  readPrivateBlob: mocks.readPrivateBlob,
}));
vi.mock("@agent-native/creative-context/server", () => ({
  resolveNativeContextCloneReference: mocks.resolveReference,
}));
vi.mock("../server/lib/design-data-mutation.js", () => ({
  mutateDesignData: mocks.mutateDesignData,
}));
vi.mock("../server/lib/import-design-files.js", () => ({
  saveImportedDesignFiles: mocks.saveFiles,
}));
vi.mock("./create-design.js", () => ({ default: { run: mocks.createDesign } }));

import action from "./clone-creative-context-design-native.js";

describe("clone-creative-context-design-native", () => {
  const payload = JSON.stringify({
    designId: "design-1",
    designData: JSON.stringify({ theme: "approved", canvasFrames: {} }),
    files: [
      {
        filename: "index.html",
        fileType: "html",
        content: "<!doctype html><div>Exact design</div>",
      },
    ],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveReference.mockResolvedValue({
      publishedItemVersionId: "version-1",
      cloneHandle: { key: "private" },
    });
    mocks.readPrivateBlob.mockResolvedValue({
      data: Buffer.from(payload),
      metadata: {
        appId: "design",
        resourceType: "design",
        resourceId: "design-1",
        contentHash: createHash("sha256").update(payload).digest("hex"),
      },
    });
    mocks.createDesign.mockResolvedValue({
      id: "design-copy",
      title: "Context design",
    });
    mocks.saveFiles.mockResolvedValue({
      designId: "design-copy",
      files: [{ id: "file-copy", filename: "index.html" }],
      urlPath: "/design/design-copy",
    });
    mocks.mutateDesignData.mockResolvedValue(undefined);
  });

  it("restores exact native files through Design's owning persistence path", async () => {
    const result = await action.run({
      contextId: "context-1",
      artifactKey: "design:design:design-1",
      resourceId: "design-1",
    });
    expect(mocks.saveFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        designId: "design-copy",
        preserveExactContent: true,
        files: [
          expect.objectContaining({
            content: "<!doctype html><div>Exact design</div>",
          }),
        ],
      }),
    );
    expect(mocks.mutateDesignData).toHaveBeenCalled();
    expect(result).toMatchObject({
      designId: "design-copy",
      clonedExactVersion: "version-1",
    });
    expect(result).not.toHaveProperty("cloneHandle");
  });
});
