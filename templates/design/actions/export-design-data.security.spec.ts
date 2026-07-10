import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectChain = {
    from: vi.fn(),
    where: vi.fn(),
  };
  selectChain.from.mockReturnValue(selectChain);

  return {
    resolveAccess: vi.fn(),
    selectChain,
    trySaveExportFile: vi.fn().mockResolvedValue({}),
  };
});

vi.mock("@agent-native/core/sharing", () => ({
  registerShareableResource: vi.fn(),
  resolveAccess: mocks.resolveAccess,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: vi.fn(() => ({
    select: vi.fn(() => mocks.selectChain),
  })),
  schema: {
    designFiles: { designId: "designFiles.designId" },
  },
}));

vi.mock("../server/lib/design-export.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/lib/design-export.js")>();
  return {
    ...actual,
    trySaveExportFile: mocks.trySaveExportFile,
  };
});

import exportPdfAction from "./export-pdf.js";
import exportZipAction from "./export-zip.js";

describe("viewer design-data exports", () => {
  const designData = JSON.stringify({
    canvasFrames: [{ id: "home", x: 0, y: 0 }],
    screenMetadata: {
      home: {
        sourceType: "localhost",
        bridgeUrl: "http://127.0.0.1:7331",
        bridgeToken: "example-private-bridge-token",
      },
    },
  });

  beforeEach(() => {
    mocks.resolveAccess.mockReset();
    mocks.selectChain.where.mockReset();
    mocks.trySaveExportFile.mockClear();
    mocks.resolveAccess.mockResolvedValue({
      role: "viewer",
      resource: {
        id: "design_123",
        title: "Public local preview",
        description: "Shared preview",
        projectType: "prototype",
        data: designData,
      },
    });
    mocks.selectChain.where.mockResolvedValue([
      {
        id: "file_123",
        filename: "index.html",
        fileType: "html",
        content: "<!doctype html><html><body>Hello</body></html>",
      },
    ]);
  });

  it("redacts PDF preparation data without dropping render metadata", async () => {
    const result = await exportPdfAction.run({ id: "design_123" });

    expect(result.data).toContain("bridgeUrl");
    expect(result.data).not.toContain("bridgeToken");
    expect(result.data).not.toContain("example-private-bridge-token");
  });

  it("redacts the design-data metadata file inside viewer ZIP exports", async () => {
    const result = await exportZipAction.run({ id: "design_123" });
    const zip = await JSZip.loadAsync(Buffer.from(result.zipBase64, "base64"));
    const metadata = await zip
      .file("agent-native-metadata/design-data.json")
      ?.async("string");

    expect(metadata).toContain("bridgeUrl");
    expect(metadata).not.toContain("bridgeToken");
    expect(metadata).not.toContain("example-private-bridge-token");
  });

  it("omits malformed viewer metadata from ZIP exports", async () => {
    mocks.resolveAccess.mockResolvedValueOnce({
      role: "viewer",
      resource: {
        id: "design_123",
        title: "Malformed public preview",
        description: null,
        projectType: "prototype",
        data: '{"bridgeToken":"example-private-bridge-token"',
      },
    });

    const result = await exportZipAction.run({ id: "design_123" });
    const zip = await JSZip.loadAsync(Buffer.from(result.zipBase64, "base64"));

    expect(zip.file("agent-native-metadata/design-data.json")).toBeNull();
  });
});
