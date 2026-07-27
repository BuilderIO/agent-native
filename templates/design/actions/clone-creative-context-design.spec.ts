import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  readAppState: vi.fn(),
  nativeCreativeArtifactFromMetadata: vi.fn(),
  reassembleNativeCreativeArtifact: vi.fn(),
  recordGenerationCreativeContext: vi.fn(),
  createContextPack: vi.fn(),
  getCreativeContextItem: vi.fn(),
  getCreativeContextItemByExternalId: vi.fn(),
  resolveImportDesignId: vi.fn(),
  saveImportedDesignFiles: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
}));

vi.mock("@agent-native/creative-context", () => ({
  nativeCreativeArtifactFromMetadata: mocks.nativeCreativeArtifactFromMetadata,
  reassembleNativeCreativeArtifact: mocks.reassembleNativeCreativeArtifact,
}));

vi.mock("@agent-native/creative-context/server", () => ({
  recordGenerationCreativeContext: mocks.recordGenerationCreativeContext,
}));

vi.mock("@agent-native/creative-context/store", () => ({
  createContextPack: mocks.createContextPack,
  getCreativeContextItem: mocks.getCreativeContextItem,
  getCreativeContextItemByExternalId: mocks.getCreativeContextItemByExternalId,
}));

vi.mock("../server/lib/import-design-files.js", () => ({
  resolveImportDesignId: mocks.resolveImportDesignId,
  saveImportedDesignFiles: mocks.saveImportedDesignFiles,
}));

import action from "./clone-creative-context-design.js";

describe("clone-creative-context-design", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readAppState.mockResolvedValue({ contextMode: "auto" });
    mocks.resolveImportDesignId.mockResolvedValue("design-1");
    mocks.assertAccess.mockResolvedValue({ role: "editor" });
    mocks.getCreativeContextItem.mockResolvedValue({
      item: {
        id: "item-root",
        sourceId: "source-1",
        externalId: "file:1:1",
        title: "Hero frame",
      },
      version: {
        id: "version-root",
        sourceVersion: "42",
        metadata: { nativeArtifact: {} },
      },
    });
    mocks.nativeCreativeArtifactFromMetadata.mockReturnValue({
      schemaVersion: 1,
      app: "design",
      format: "design-html",
      rootExternalId: "file:1:1",
      fidelityReport: {
        exact: { count: 4 },
        approximated: { count: 0, reasons: [] },
        imageFallback: { count: 0, reasons: [] },
      },
    });
    mocks.reassembleNativeCreativeArtifact.mockResolvedValue({
      html: "<!doctype html><html><head></head><body><div>Exact clone</div></body></html>",
      artifact: {
        sourceBounds: { x: 0, y: 0, width: 1440, height: 900 },
        fidelityReport: {
          exact: { count: 4 },
          approximated: { count: 0, reasons: [] },
          imageFallback: { count: 0, reasons: [] },
        },
      },
      evidence: [
        { itemId: "item-root", itemVersionId: "version-root" },
        { itemId: "item-child", itemVersionId: "version-child" },
      ],
    });
    mocks.createContextPack.mockResolvedValue({ id: "pack-1", members: [] });
    mocks.saveImportedDesignFiles.mockResolvedValue({
      designId: "design-1",
      files: [{ id: "design-file-1", filename: "Hero-frame.html" }],
      warnings: [],
      placedFrames: [],
      overview: true,
      urlPath: "/design/design-1",
    });
  });

  it("saves immutable native code directly and records exact-reuse provenance", async () => {
    const result = await action.run({
      itemId: "item-root",
      itemVersionId: "version-root",
      designId: "design-1",
    });

    expect(mocks.getCreativeContextItem).toHaveBeenCalledWith(
      "item-root",
      "version-root",
    );
    expect(mocks.reassembleNativeCreativeArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        app: "design",
        format: "design-html",
        resolveChild: mocks.getCreativeContextItemByExternalId,
      }),
    );
    expect(mocks.saveImportedDesignFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        designId: "design-1",
        sourceType: "creative-context-clone",
        preserveExactContent: true,
        files: [
          expect.objectContaining({
            content:
              "<!doctype html><html><head></head><body><div>Exact clone</div></body></html>",
            preferredFrame: expect.objectContaining({
              width: 1440,
              height: 900,
            }),
          }),
        ],
      }),
    );
    expect(mocks.recordGenerationCreativeContext).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId: "design-file-1",
        contextMode: "pinned",
        contextPackId: "pack-1",
        reuseLabels: expect.arrayContaining([
          expect.objectContaining({
            itemVersionId: "version-root",
            influence: "reused",
          }),
          expect.objectContaining({
            itemVersionId: "version-child",
            influence: "reused",
          }),
        ]),
      }),
      { artifactAccess: { resourceType: "design", resourceId: "design-1" } },
    );
    expect(result).toMatchObject({
      reusedWithoutRegeneration: true,
      contextPackId: "pack-1",
    });
  });

  it("checks design edit access before reading library code", async () => {
    mocks.assertAccess.mockRejectedValue(new Error("No access"));
    await expect(
      action.run({
        itemId: "item-root",
        itemVersionId: "version-root",
        designId: "private-design",
      }),
    ).rejects.toThrow("No access");
    expect(mocks.getCreativeContextItem).not.toHaveBeenCalled();
  });

  it("enforces the global context opt-out before resolving a design", async () => {
    mocks.readAppState.mockResolvedValue({ contextMode: "off" });

    await expect(
      action.run({
        itemId: "item-root",
        itemVersionId: "version-root",
        designId: "design-1",
      }),
    ).rejects.toThrow("Creative Context is off");
    expect(mocks.resolveImportDesignId).not.toHaveBeenCalled();
    expect(mocks.getCreativeContextItem).not.toHaveBeenCalled();
  });

  it("does not save when native reassembly rejects tampered code", async () => {
    mocks.reassembleNativeCreativeArtifact.mockRejectedValue(
      new Error("Native creative artifact contains executable HTML/CSS."),
    );

    await expect(
      action.run({
        itemId: "item-root",
        itemVersionId: "version-root",
        designId: "design-1",
      }),
    ).rejects.toThrow("contains executable HTML/CSS");
    expect(mocks.saveImportedDesignFiles).not.toHaveBeenCalled();
    expect(mocks.createContextPack).not.toHaveBeenCalled();
  });
});
