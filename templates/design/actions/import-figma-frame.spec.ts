import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeProviderApiRequest: vi.fn(),
  saveImportedDesignFiles: vi.fn(),
}));

vi.mock("../server/lib/provider-api.js", () => ({
  executeProviderApiRequest: mocks.executeProviderApiRequest,
}));

vi.mock("../server/lib/import-design-files.js", () => ({
  normalizeImportedHtmlDocument: vi.fn(
    (content: string, label: string) =>
      `<!doctype html><html><head><!-- ${label} --></head><body>${content}</body></html>`,
  ),
  saveImportedDesignFiles: mocks.saveImportedDesignFiles,
}));

import action from "./import-figma-frame.js";

function jsonEnvelope(json: unknown) {
  return { response: { ok: true, status: 200, json } };
}

function errorEnvelope(status: number, text: string) {
  return { response: { ok: false, status, statusText: "Error", text } };
}

const SIMPLE_FRAME = {
  document: {
    id: "1:2",
    name: "Hero",
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
    fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
    children: [],
  },
};

describe("import-figma-frame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveImportedDesignFiles.mockResolvedValue({
      designId: "design-1",
      files: [{ id: "file-1", filename: "Hero.html" }],
      warnings: [],
      placedFrames: [],
      overview: true,
      urlPath: "/design/design-1",
    });
  });

  it("imports a frame from a figmaUrl with an explicit node-id", async () => {
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path, query }: any) => {
        expect(path).toBe("/files/abcDEF12345/nodes");
        expect(query).toEqual({ ids: "1:2", geometry: "paths" });
        return jsonEnvelope({ nodes: { "1:2": SIMPLE_FRAME } });
      },
    );

    const result = await action.run({
      figmaUrl: "https://www.figma.com/design/abcDEF12345/App?node-id=1-2",
      asNewScreen: true,
    } as any);

    expect(result.figma).toEqual({
      fileKey: "abcDEF12345",
      nodeId: "1:2",
      nodeName: "Hero",
    });
    expect(mocks.saveImportedDesignFiles).toHaveBeenCalledTimes(1);
    const saveArgs = mocks.saveImportedDesignFiles.mock.calls[0]![0];
    expect(saveArgs.sourceType).toBe("figma-import");
    expect(saveArgs.files[0].filename).toBe("Hero.html");
    expect(saveArgs.files[0].content).toContain(
      "background-color: rgba(255, 255, 255, 1)",
    );
    expect(saveArgs.files[0].preferredFrame).toEqual({
      title: "Hero",
      width: 200,
      height: 100,
    });
    expect(result.fidelityReport.exactCount).toBeGreaterThan(0);
  });

  it("resolves /branch/:branchKey/ to the branch key for the nodes request", async () => {
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path }: any) => {
        if (path === "/files/branchKey456/nodes") {
          return jsonEnvelope({ nodes: { "1:2": SIMPLE_FRAME } });
        }
        throw new Error(`Unexpected path ${path}`);
      },
    );

    await action.run({
      figmaUrl:
        "https://www.figma.com/design/parentKey123/App/branch/branchKey456/App-Branch?node-id=1-2",
    } as any);

    expect(mocks.executeProviderApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/files/branchKey456/nodes" }),
    );
  });

  it("falls back to the first top-level frame when no node-id is given", async () => {
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path, query }: any) => {
        if (path === "/files/abcDEF12345" && query?.depth === 2) {
          return jsonEnvelope({
            document: {
              children: [
                {
                  id: "page-1",
                  children: [{ id: "9:9", name: "First Frame" }],
                },
              ],
            },
          });
        }
        if (path === "/files/abcDEF12345/nodes") {
          expect(query).toEqual({ ids: "9:9", geometry: "paths" });
          return jsonEnvelope({
            nodes: {
              "9:9": { document: { ...SIMPLE_FRAME.document, id: "9:9" } },
            },
          });
        }
        throw new Error(`Unexpected path ${path}`);
      },
    );

    const result = await action.run({ fileKey: "abcDEF12345" } as any);
    expect(result.figma.nodeId).toBe("9:9");
  });

  it("throws a clear error when the requested node is not found", async () => {
    mocks.executeProviderApiRequest.mockImplementation(async () =>
      jsonEnvelope({ nodes: {} }),
    );

    await expect(
      action.run({ fileKey: "abcDEF12345", nodeId: "1:2" } as any),
    ).rejects.toThrow(/not found/);
  });

  it("throws when the provider request fails", async () => {
    mocks.executeProviderApiRequest.mockImplementation(async () =>
      errorEnvelope(401, "Invalid token"),
    );

    await expect(
      action.run({ fileKey: "abcDEF12345", nodeId: "1:2" } as any),
    ).rejects.toThrow(/Invalid token/);
  });

  it("rejects asNewScreen: false as not yet supported", async () => {
    await expect(
      action.run({
        fileKey: "abcDEF12345",
        nodeId: "1:2",
        asNewScreen: false,
      } as any),
    ).rejects.toThrow(/not supported yet/);
    expect(mocks.executeProviderApiRequest).not.toHaveBeenCalled();
  });

  it("fetches PNG fallbacks for unsupported node types and reports them", async () => {
    const frameWithVector = {
      document: {
        id: "1:2",
        name: "Hero",
        type: "FRAME",
        absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
        children: [
          {
            id: "1:3",
            name: "Icon",
            type: "VECTOR",
            absoluteBoundingBox: { x: 10, y: 10, width: 24, height: 24 },
          },
        ],
      },
    };
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path, query }: any) => {
        if (path === "/files/abcDEF12345/nodes") {
          return jsonEnvelope({ nodes: { "1:2": frameWithVector } });
        }
        if (path === "/images/abcDEF12345") {
          expect(query).toEqual({ ids: "1:3", format: "png", scale: 2 });
          return jsonEnvelope({
            images: { "1:3": "https://figma-renders.example.com/1-3.png" },
          });
        }
        if (path === "/files/abcDEF12345/images") {
          return jsonEnvelope({ images: {} });
        }
        throw new Error(`Unexpected path ${path}`);
      },
    );

    const result = await action.run({
      fileKey: "abcDEF12345",
      nodeId: "1:2",
    } as any);
    expect(result.fidelityReport.imageFallbacks).toHaveLength(1);
    expect(result.fidelityReport.imageFallbacks[0].nodeId).toBe("1:3");
    const saveArgs = mocks.saveImportedDesignFiles.mock.calls[0]![0];
    expect(saveArgs.files[0].content).toContain(
      "https://figma-renders.example.com/1-3.png",
    );
  });
});
