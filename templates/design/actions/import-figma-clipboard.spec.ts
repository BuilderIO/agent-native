import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeProviderApiRequest: vi.fn(),
  saveImportedDesignFiles: vi.fn(),
  resolveImportDesignId: vi.fn(),
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
          expect(query).toEqual({ ids: "1:1", geometry: "paths" });
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

  it("throws when the clipboard has no visible HTML at all", async () => {
    await expect(
      action.run({
        figmetaFileKey: FILE_KEY,
        clipboardHtml:
          '<span data-metadata="(figmeta)ZmFrZQ==(/figmeta)"></span>',
      } as any),
    ).rejects.toThrow(/no visible html/i);
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
