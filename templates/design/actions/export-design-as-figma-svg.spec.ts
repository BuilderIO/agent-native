/**
 * export-design-as-figma-svg.spec.ts
 *
 * Covers the DB-shaped branch logic (missing designId/fileId, file not
 * found, wrong file type, chromium-unavailable fallback, success shape) with
 * a mocked drizzle chain and a mocked `renderDesignToFigmaSvg`. The actual
 * render path (real headless Chromium producing real geometry) requires a
 * live browser and DB-backed design_files row — not exercised here, same
 * split as `take-design-screenshot.spec.ts` (see that file's docblock) and
 * `design-to-figma-svg.spec.ts`.
 */

import { describe, expect, it, vi } from "vitest";

import { buildCodeLayerProjection } from "../shared/code-layer.js";

const mockRow = {
  id: "file_1",
  designId: "design_1",
  filename: "index.html",
  fileType: "html",
  content: "<div>hi</div>",
};

/** Matches the `source` triple `resolveFigmaSvgNodeSelector` builds from `file`/`designId`. */
const MOCK_SOURCE = {
  kind: "design-file" as const,
  designId: "design_1",
  fileId: "file_1",
  filename: "index.html",
};

function chainable(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => Promise.resolve(rows));
  return chain;
}

let fileRows: unknown[] = [mockRow];
let designRows: unknown[] = [{ title: "My Screen" }];

vi.mock("@agent-native/core/collab", () => ({
  hasCollabState: vi.fn().mockResolvedValue(false),
  getText: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => ({ kind: "access-filter" }),
  registerShareableResource: vi.fn(),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => {
    let call = 0;
    return {
      select: vi.fn(() => {
        call += 1;
        return call === 1 ? chainable(fileRows) : chainable(designRows);
      }),
    };
  },
  schema: {
    designFiles: { id: "id", designId: "designId", filename: "filename" },
    designs: { id: "id", title: "title" },
    designShares: {},
  },
}));

vi.mock("../server/lib/design-export.js", () => ({
  trySaveExportFile: vi.fn().mockResolvedValue({ filePath: "/tmp/out.svg" }),
}));

const renderDesignToFigmaSvg = vi.fn();
const { MockFigmaSvgRootSelectorNotFoundError } = vi.hoisted(() => {
  class MockFigmaSvgRootSelectorNotFoundError extends Error {
    constructor(rootSelector: string) {
      super(`No element matched rootSelector "${rootSelector}"`);
      this.name = "FigmaSvgRootSelectorNotFoundError";
    }
  }
  return { MockFigmaSvgRootSelectorNotFoundError };
});
vi.mock("../server/lib/design-to-figma-svg.js", () => ({
  renderDesignToFigmaSvg: (...args: unknown[]) =>
    renderDesignToFigmaSvg(...args),
  safeFigmaSvgFilename: (title?: string | null) =>
    `${title ?? "design"}-figma-123.svg`,
  FigmaSvgRootSelectorNotFoundError: MockFigmaSvgRootSelectorNotFoundError,
  isMissingRootSelectorError: (err: unknown) =>
    err instanceof MockFigmaSvgRootSelectorNotFoundError,
}));

vi.mock("../server/lib/playwright-runtime.js", () => ({
  isMissingBrowserError: (err: unknown) =>
    /no chromium/i.test(err instanceof Error ? err.message : String(err)),
}));

import action, {
  chromiumUnavailableReason,
  figmaSvgNodeSelector,
} from "./export-design-as-figma-svg.js";

describe("figmaSvgNodeSelector", () => {
  it("escapes quotes, slashes, and newlines in runtime node ids", () => {
    expect(figmaSvgNodeSelector('a"b\\c\nd')).toBe(
      '[data-agent-native-node-id="a\\"b\\\\c\\a d"]',
    );
  });
});

describe("chromiumUnavailableReason", () => {
  it("names export-svg/export-html as the fallback", () => {
    const reason = chromiumUnavailableReason(new Error("no chromium binary"));
    expect(reason).toContain("export-svg");
    expect(reason).toContain("export-html");
    expect(reason).toContain("no chromium binary");
  });
});

describe("export-design-as-figma-svg schema defaults", () => {
  it("defaults filename to index.html and embedImages to true", () => {
    const parsed = action.schema.parse({ designId: "design_1" });
    expect(parsed.filename).toBe("index.html");
    expect(parsed.embedImages).toBe(true);
  });
});

describe("export-design-as-figma-svg action.run", () => {
  it("throws when neither designId nor fileId is provided", async () => {
    await expect(action.run({} as never, {} as never)).rejects.toThrow(
      /designId or fileId is required/,
    );
  });

  it("throws a 404 when no matching design file is found", async () => {
    fileRows = [];
    await expect(
      action.run(
        { designId: "design_1", filename: "index.html" } as never,
        {} as never,
      ),
    ).rejects.toThrow(/Design file not found/);
    fileRows = [mockRow];
  });

  it("rejects a non-HTML file type", async () => {
    fileRows = [{ ...mockRow, fileType: "css" }];
    await expect(
      action.run(
        { designId: "design_1", filename: "index.html" } as never,
        {} as never,
      ),
    ).rejects.toThrow(/only supports HTML files/);
    fileRows = [mockRow];
  });

  it("returns ok:false with a fallback reason when Chromium is unavailable", async () => {
    renderDesignToFigmaSvg.mockRejectedValueOnce(
      new Error("no chromium binary"),
    );
    const result = (await action.run(
      { designId: "design_1", filename: "index.html" } as never,
      {} as never,
    )) as { ok: boolean; reason?: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("export-svg");
  });

  it("re-throws a non-Chromium render error", async () => {
    renderDesignToFigmaSvg.mockRejectedValueOnce(new Error("boom"));
    await expect(
      action.run(
        { designId: "design_1", filename: "index.html" } as never,
        {} as never,
      ),
    ).rejects.toThrow(/boom/);
  });

  it("returns the svg, report, and filename on success", async () => {
    fileRows = [
      {
        ...mockRow,
        content: '<div data-agent-native-node-id="node_1">hi</div>',
      },
    ];
    renderDesignToFigmaSvg.mockResolvedValueOnce({
      svg: "<svg></svg>",
      report: {
        vectorized: ["root"],
        approximated: [],
        rasterized: [],
        omitted: [],
        warnings: [],
        vectorizedTextCaveat: "...",
      },
    });
    const result = (await action.run(
      {
        designId: "design_1",
        filename: "index.html",
        nodeId: "node_1",
      } as never,
      {} as never,
    )) as {
      ok: boolean;
      svg: string;
      filename: string;
      report: { vectorized: string[] };
      filePath?: string;
    };
    expect(result.ok).toBe(true);
    expect(result.svg).toBe("<svg></svg>");
    expect(result.filename).toBe("My Screen-figma-123.svg");
    expect(result.report.vectorized).toEqual(["root"]);
    expect(result.filePath).toBe("/tmp/out.svg");
    expect(renderDesignToFigmaSvg).toHaveBeenCalledWith(
      expect.objectContaining({
        rootSelector: '[data-agent-native-node-id="node_1"]',
      }),
    );
    fileRows = [mockRow];
  });

  it("resolves a live-DOM code-layer id (no persisted attribute) to the node's own selector path instead of 500ing", async () => {
    const content = '<div class="outer"><p class="target">Target</p></div>';
    const projection = buildCodeLayerProjection(content, {
      source: MOCK_SOURCE,
    });
    const targetNode = projection.nodes.find((n) => n.tag === "p");
    expect(targetNode).toBeTruthy();
    expect(targetNode!.dataAttributes["data-agent-native-node-id"]).toBe(
      undefined,
    );

    fileRows = [{ ...mockRow, content }];
    renderDesignToFigmaSvg.mockResolvedValueOnce({
      svg: "<svg></svg>",
      report: {
        vectorized: [],
        approximated: [],
        rasterized: [],
        omitted: [],
        warnings: [],
        vectorizedTextCaveat: "...",
      },
    });
    await action.run(
      {
        designId: "design_1",
        filename: "index.html",
        nodeId: targetNode!.id, // the live-DOM "html:<hash>" id, not a persisted attribute
      } as never,
      {} as never,
    );
    expect(renderDesignToFigmaSvg).toHaveBeenCalledWith(
      expect.objectContaining({ rootSelector: targetNode!.path }),
    );
    fileRows = [mockRow];
  });

  it("fails soft (whole-screen export + report warning) instead of 500ing on an unresolvable nodeId", async () => {
    fileRows = [{ ...mockRow, content: "<div>hi</div>" }];
    renderDesignToFigmaSvg.mockResolvedValueOnce({
      svg: "<svg></svg>",
      report: {
        vectorized: ["root"],
        approximated: [],
        rasterized: [],
        omitted: [],
        warnings: [],
        vectorizedTextCaveat: "...",
      },
    });
    const result = (await action.run(
      {
        designId: "design_1",
        filename: "index.html",
        nodeId: "html:stale-live-dom-id",
      } as never,
      {} as never,
    )) as { ok: boolean; report: { warnings: string[] } };
    expect(result.ok).toBe(true);
    expect(renderDesignToFigmaSvg).toHaveBeenCalledWith(
      expect.objectContaining({ rootSelector: null }),
    );
    expect(
      result.report.warnings.some((w) => w.includes("html:stale-live-dom-id")),
    ).toBe(true);
    fileRows = [mockRow];
  });

  it("retries the whole screen (never 500s) when the resolved selector still misses at render time", async () => {
    fileRows = [
      {
        ...mockRow,
        content: '<div data-agent-native-node-id="node_1">hi</div>',
      },
    ];
    renderDesignToFigmaSvg
      .mockRejectedValueOnce(
        new MockFigmaSvgRootSelectorNotFoundError(
          '[data-agent-native-node-id="node_1"]',
        ),
      )
      .mockResolvedValueOnce({
        svg: "<svg></svg>",
        report: {
          vectorized: ["root"],
          approximated: [],
          rasterized: [],
          omitted: [],
          warnings: [],
          vectorizedTextCaveat: "...",
        },
      });
    const callsBefore = renderDesignToFigmaSvg.mock.calls.length;
    const result = (await action.run(
      {
        designId: "design_1",
        filename: "index.html",
        nodeId: "node_1",
      } as never,
      {} as never,
    )) as { ok: boolean; report: { warnings: string[] } };
    expect(result.ok).toBe(true);
    expect(renderDesignToFigmaSvg.mock.calls.length - callsBefore).toBe(2);
    expect(renderDesignToFigmaSvg).toHaveBeenLastCalledWith(
      expect.objectContaining({ rootSelector: null }),
    );
    expect(result.report.warnings.some((w) => w.includes("node_1"))).toBe(true);
    fileRows = [mockRow];
  });

  it("prefers the design's saved canvas-frame width/height over the 1440x1200 default", async () => {
    designRows = [
      {
        title: "My Screen",
        data: JSON.stringify({
          canvasFrames: { file_1: { width: 400, height: 300 } },
        }),
      },
    ];
    renderDesignToFigmaSvg.mockResolvedValueOnce({
      svg: "<svg></svg>",
      report: {
        vectorized: ["root"],
        approximated: [],
        rasterized: [],
        omitted: [],
        warnings: [],
        vectorizedTextCaveat: "...",
      },
    });
    await action.run(
      { designId: "design_1", filename: "index.html" } as never,
      {} as never,
    );
    expect(renderDesignToFigmaSvg).toHaveBeenCalledWith(
      expect.objectContaining({ width: 400, height: 300 }),
    );
    designRows = [{ title: "My Screen" }];
  });
});
