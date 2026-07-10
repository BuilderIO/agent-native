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

const mockRow = {
  id: "file_1",
  designId: "design_1",
  filename: "index.html",
  fileType: "html",
  content: "<div>hi</div>",
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
vi.mock("../server/lib/design-to-figma-svg.js", () => ({
  renderDesignToFigmaSvg: (...args: unknown[]) =>
    renderDesignToFigmaSvg(...args),
  safeFigmaSvgFilename: (title?: string | null) =>
    `${title ?? "design"}-figma-123.svg`,
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
  });
});
