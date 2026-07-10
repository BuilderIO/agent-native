import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeProviderApiRequest: vi.fn(),
  getRequestUserEmail: vi.fn(),
  saveImportedDesignFiles: vi.fn(),
  resolveImportDesignId: vi.fn(),
  ssrfSafeFetch: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: mocks.ssrfSafeFetch,
}));

vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: mocks.uploadFile,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("../server/lib/provider-api.js", () => ({
  executeProviderApiRequest: mocks.executeProviderApiRequest,
}));

vi.mock("../server/lib/import-design-files.js", () => ({
  normalizeImportedHtmlDocument: vi.fn(
    (content: string, label: string) =>
      `<!doctype html><html><head><!-- ${label} --></head><body>${content}</body></html>`,
  ),
  resolveImportDesignId: mocks.resolveImportDesignId,
  saveImportedDesignFiles: mocks.saveImportedDesignFiles,
}));

import action from "./import-figma-clipboard.js";

function jsonEnvelope(json: unknown) {
  return { response: { ok: true, status: 200, json } };
}

const FILE_KEY = "abcDEF12345";

const CLIPBOARD_HTML_HERO = [
  '<meta charset="utf-8">',
  '<span data-metadata="(figmeta)ZmFrZQ==(/figmeta)"></span>',
  "<div><h1>Hero</h1><p>Welcome aboard</p></div>",
].join("");

const CLIPBOARD_HTML_UNMATCHED = [
  '<span data-metadata="(figmeta)ZmFrZQ==(/figmeta)"></span>',
  "<div><h1>Totally unrelated copy</h1><p>Nothing here matches anything</p></div>",
].join("");

const CLIPBOARD_HTML_CURRENT_BINARY_ONLY = [
  '<meta charset="utf-8">',
  '<span data-metadata="<!--(figmeta)ZmFrZQ==(/figmeta)-->"></span>',
  '<span data-buffer="<!--(figma)ZmFrZS1iaW5hcnk=(/figma)-->"></span>',
].join("");

const HERO_NODE_DOCUMENT = {
  id: "1:1",
  name: "Hero",
  type: "FRAME",
  absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 50 },
  fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
  children: [],
};

function structureWithFrames(
  frames: Array<{ id: string; name: string; texts?: string[] }>,
) {
  return jsonEnvelope({
    document: {
      children: [
        {
          id: "page-1",
          children: frames.map((frame) => ({
            id: frame.id,
            name: frame.name,
            children: (frame.texts ?? []).map((characters, index) => ({
              id: `${frame.id}-text-${index}`,
              type: "TEXT",
              characters,
            })),
          })),
        },
      ],
    },
  });
}

describe("import-figma-clipboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("designer@example.com");
    mocks.ssrfSafeFetch.mockImplementation(
      async () =>
        new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
          headers: { "content-type": "image/png" },
        }),
    );
    mocks.uploadFile.mockResolvedValue({
      url: "https://assets.example.test/figma-import.png",
    });
    mocks.resolveImportDesignId.mockImplementation(
      async (id?: string) => id ?? "resolved-design-id",
    );
    mocks.saveImportedDesignFiles.mockResolvedValue({
      designId: "design-1",
      files: [{ id: "file-1", filename: "Hero.html" }],
      warnings: [],
      placedFrames: [],
      overview: true,
      urlPath: "/design/design-1",
    });
  });

  it("imports the exact REST node when its name matches the pasted visible text", async () => {
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path, query }: any) => {
        if (path === `/files/${FILE_KEY}` && query?.depth === 3) {
          return structureWithFrames([{ id: "1:1", name: "Hero" }]);
        }
        if (path === `/files/${FILE_KEY}/nodes`) {
          expect(query).toEqual({ ids: "1:1" });
          return jsonEnvelope({
            nodes: { "1:1": { document: HERO_NODE_DOCUMENT } },
          });
        }
        throw new Error(`Unexpected path ${path}`);
      },
    );

    const result = await action.run({
      figmetaFileKey: FILE_KEY,
      clipboardHtml: CLIPBOARD_HTML_HERO,
    } as any);

    expect(result.strategy).toBe("restNodes");
    expect(result.figma).toEqual({
      fileKey: FILE_KEY,
      nodeIds: ["1:1"],
      matched: [{ id: "1:1", name: "Hero", reason: "name" }],
    });
    expect(result.fidelityReport.exactCount).toBeGreaterThan(0);
    expect(mocks.saveImportedDesignFiles).toHaveBeenCalledTimes(1);
    const saveArgs = mocks.saveImportedDesignFiles.mock.calls[0]![0];
    expect(saveArgs.sourceType).toBe("figma-clipboard-rest");
    expect(saveArgs.files[0].filename).toBe("Hero.html");
  });

  it("imports exact selected node ids from a current binary-only Figma clipboard without heuristic file matching", async () => {
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path, query }: any) => {
        expect(path).toBe(`/files/${FILE_KEY}/nodes`);
        expect(query).toEqual({ ids: "1:1" });
        return jsonEnvelope({
          nodes: { "1:1": { document: HERO_NODE_DOCUMENT } },
        });
      },
    );

    const result = await action.run({
      figmetaFileKey: FILE_KEY,
      selectedNodeIds: ["1:1"],
      clipboardHtml: CLIPBOARD_HTML_CURRENT_BINARY_ONLY,
    } as any);

    expect(result.strategy).toBe("restNodes");
    expect(result.figma).toEqual({
      fileKey: FILE_KEY,
      nodeIds: ["1:1"],
      matchSource: "clipboardNodeIds",
      selectionTruncated: false,
    });
    expect(mocks.executeProviderApiRequest).toHaveBeenCalledTimes(1);
    expect(mocks.saveImportedDesignFiles).toHaveBeenCalledTimes(1);
  });

  it("reports when the client capped a large selection to the first 100 exact node ids", async () => {
    mocks.executeProviderApiRequest.mockResolvedValue(
      jsonEnvelope({ nodes: { "1:1": { document: HERO_NODE_DOCUMENT } } }),
    );

    const result = await action.run({
      figmetaFileKey: FILE_KEY,
      selectedNodeIds: ["1:1"],
      selectedNodeIdsTruncated: true,
      clipboardHtml: CLIPBOARD_HTML_CURRENT_BINARY_ONLY,
    } as any);

    expect(result.strategy).toBe("restNodes");
    expect(result.figma.selectionTruncated).toBe(true);
    expect(result.warnings).toContainEqual(expect.stringMatching(/first 100/i));
    expect(result.guidance).toMatch(/split larger selections/i);
  });

  it("splits a truncated multi-node response into smaller requests and imports every exact selection", async () => {
    const secondNode = {
      ...HERO_NODE_DOCUMENT,
      id: "1:2",
      name: "Card",
    };
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path, query }: any) => {
        expect(path).toBe(`/files/${FILE_KEY}/nodes`);
        if (query.ids === "1:1,1:2") {
          return {
            response: {
              ok: true,
              status: 200,
              truncated: true,
              size: 4 * 1024 * 1024 + 1,
            },
          };
        }
        if (query.ids === "1:1") {
          return jsonEnvelope({
            nodes: { "1:1": { document: HERO_NODE_DOCUMENT } },
          });
        }
        if (query.ids === "1:2") {
          return jsonEnvelope({ nodes: { "1:2": { document: secondNode } } });
        }
        throw new Error(`Unexpected node request ${query.ids}`);
      },
    );

    const result = await action.run({
      figmetaFileKey: FILE_KEY,
      selectedNodeIds: ["1:1", "1:2"],
      clipboardHtml: CLIPBOARD_HTML_CURRENT_BINARY_ONLY,
    } as any);

    expect(result.strategy).toBe("restNodes");
    expect(result.figma.nodeIds).toEqual(["1:1", "1:2"]);
    expect(mocks.executeProviderApiRequest).toHaveBeenCalledTimes(3);
    const saveArgs = mocks.saveImportedDesignFiles.mock.calls[0]![0];
    expect(saveArgs.files.map((file: any) => file.filename)).toEqual([
      "Hero.html",
      "Card.html",
    ]);
  });

  it("returns setup guidance instead of throwing when current Figma clipboard has no visible fallback and the token is missing", async () => {
    mocks.executeProviderApiRequest.mockRejectedValue(
      new Error("figma credential not configured. Tried: FIGMA_ACCESS_TOKEN"),
    );

    const result = await action.run({
      figmetaFileKey: FILE_KEY,
      selectedNodeIds: ["1:1"],
      clipboardHtml: CLIPBOARD_HTML_CURRENT_BINARY_ONLY,
    } as any);

    expect(result.strategy).toBe("htmlFallback");
    expect(result.files).toEqual([]);
    expect(result.figmaApiKeyMissing).toBe(true);
    expect(result.guidance).toMatch(/current figma clipboard data has no/i);
    expect(mocks.saveImportedDesignFiles).not.toHaveBeenCalled();
  });

  it("preserves the real REST error for an exact-id binary-only paste", async () => {
    mocks.executeProviderApiRequest.mockRejectedValue(
      new Error("Figma nodes request failed: upstream timeout"),
    );

    await expect(
      action.run({
        figmetaFileKey: FILE_KEY,
        selectedNodeIds: ["1:1"],
        clipboardHtml: CLIPBOARD_HTML_CURRENT_BINARY_ONLY,
      } as any),
    ).rejects.toThrow("Figma nodes request failed: upstream timeout");
    expect(mocks.saveImportedDesignFiles).not.toHaveBeenCalled();
  });

  it("preserves actionable durable-storage failures instead of claiming a clipboard fallback", async () => {
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path }: any) => {
        if (path === `/files/${FILE_KEY}/nodes`) {
          return jsonEnvelope({
            nodes: {
              "1:1": {
                document: {
                  ...HERO_NODE_DOCUMENT,
                  children: [
                    {
                      id: "1:2",
                      type: "VECTOR",
                      absoluteBoundingBox: {
                        x: 0,
                        y: 0,
                        width: 24,
                        height: 24,
                      },
                    },
                  ],
                },
              },
            },
          });
        }
        if (path === `/images/${FILE_KEY}`) {
          return jsonEnvelope({
            images: { "1:2": "https://renders.example.test/icon.png" },
          });
        }
        if (path === `/files/${FILE_KEY}/images`) {
          return jsonEnvelope({ images: {} });
        }
        throw new Error(`Unexpected path ${path}`);
      },
    );
    mocks.uploadFile.mockResolvedValueOnce(null);

    await expect(
      action.run({
        figmetaFileKey: FILE_KEY,
        selectedNodeIds: ["1:1"],
        clipboardHtml: CLIPBOARD_HTML_CURRENT_BINARY_ONLY,
      } as any),
    ).rejects.toThrow(/durable file storage/i);
    expect(mocks.saveImportedDesignFiles).not.toHaveBeenCalled();
  });

  it("falls back to the HTML preview with a key-missing hint when Figma credentials aren't configured", async () => {
    mocks.executeProviderApiRequest.mockRejectedValue(
      new Error("figma credential not configured. Tried: FIGMA_ACCESS_TOKEN"),
    );

    const result = await action.run({
      figmetaFileKey: FILE_KEY,
      clipboardHtml: CLIPBOARD_HTML_HERO,
    } as any);

    expect(result.strategy).toBe("htmlFallback");
    expect(result.figmaApiKeyMissing).toBe(true);
    expect(result.guidance).toMatch(/connect your figma access token/i);
    expect(mocks.saveImportedDesignFiles).toHaveBeenCalledTimes(1);
    expect(mocks.saveImportedDesignFiles.mock.calls[0]![0].sourceType).toBe(
      "figma-paste-html",
    );
  });

  it("falls back to the HTML preview and reports ambiguity when two frames match equally", async () => {
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path, query }: any) => {
        if (path === `/files/${FILE_KEY}` && query?.depth === 3) {
          return structureWithFrames([
            { id: "1:1", name: "Frame 1", texts: ["Hero", "Welcome aboard"] },
            { id: "1:2", name: "Frame 2", texts: ["Hero", "Welcome aboard"] },
          ]);
        }
        throw new Error(`Unexpected path ${path}`);
      },
    );

    const result = await action.run({
      figmetaFileKey: FILE_KEY,
      clipboardHtml: CLIPBOARD_HTML_HERO,
    } as any);

    expect(result.strategy).toBe("htmlFallback");
    expect(result.matchStatus).toBe("ambiguous");
    expect(result.figmaApiKeyMissing).toBe(false);
    expect(result.guidance).toMatch(/paste a frame link/i);
  });

  it("falls back to the HTML preview and reports no match when nothing overlaps", async () => {
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path, query }: any) => {
        if (path === `/files/${FILE_KEY}` && query?.depth === 3) {
          return structureWithFrames([{ id: "1:1", name: "Some Other Frame" }]);
        }
        throw new Error(`Unexpected path ${path}`);
      },
    );

    const result = await action.run({
      figmetaFileKey: FILE_KEY,
      clipboardHtml: CLIPBOARD_HTML_UNMATCHED,
    } as any);

    expect(result.strategy).toBe("htmlFallback");
    expect(result.matchStatus).toBe("none");
    expect(result.figmaApiKeyMissing).toBe(false);
  });

  it("falls back to the HTML preview on a generic (non-credential) REST error", async () => {
    mocks.executeProviderApiRequest.mockRejectedValue(
      new Error("Figma file request failed: HTTP 500"),
    );

    const result = await action.run({
      figmetaFileKey: FILE_KEY,
      clipboardHtml: CLIPBOARD_HTML_HERO,
    } as any);

    expect(result.strategy).toBe("htmlFallback");
    expect(result.figmaApiKeyMissing).toBe(false);
    expect(result.matchStatus).toBe("error");
  });

  it("never imports the exact REST nodes for an ambiguous match, even if the file structure fetch succeeded", async () => {
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path, query }: any) => {
        if (path === `/files/${FILE_KEY}` && query?.depth === 3) {
          return structureWithFrames([
            { id: "1:1", name: "Frame 1", texts: ["Hero", "Welcome aboard"] },
            { id: "1:2", name: "Frame 2", texts: ["Hero", "Welcome aboard"] },
          ]);
        }
        if (path === `/files/${FILE_KEY}/nodes`) {
          throw new Error("Should never fetch nodes for an ambiguous match");
        }
        throw new Error(`Unexpected path ${path}`);
      },
    );

    const result = await action.run({
      figmetaFileKey: FILE_KEY,
      clipboardHtml: CLIPBOARD_HTML_HERO,
    } as any);
    expect(result.strategy).toBe("htmlFallback");
  });

  it("returns guidance when an old clipboard has neither exact ids nor visible HTML", async () => {
    const result = await action.run({
      figmetaFileKey: FILE_KEY,
      clipboardHtml:
        '<span data-metadata="(figmeta)ZmFrZQ==(/figmeta)"></span>',
    } as any);
    expect(result.strategy).toBe("htmlFallback");
    expect(result.files).toEqual([]);
    expect(result.guidance).toMatch(/did not expose exact node ids/i);
  });

  it("throws for an invalid figmeta file key", async () => {
    await expect(
      action.run({
        figmetaFileKey: "x",
        clipboardHtml: CLIPBOARD_HTML_HERO,
      } as any),
    ).rejects.toThrow(/could not be parsed/i);
  });
});
