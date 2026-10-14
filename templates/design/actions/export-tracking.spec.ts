import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
  resolveAccess: vi.fn(),
  assertAccess: vi.fn(),
  dbRows: vi.fn(),
  takeDesignScreenshotRun: vi.fn(),
  buildDesignSnapshot: vi.fn(),
}));

vi.mock("@agent-native/core/tracking", () => ({ track: mocks.track }));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => undefined,
}));
vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
  assertAccess: mocks.assertAccess,
  registerShareableResource: vi.fn(),
}));
vi.mock("../server/db/index.js", () => ({
  schema: { designFiles: { designId: "design_id" }, designs: {} },
  getDb: () => ({
    select: () => ({
      from: () => ({ where: async () => mocks.dbRows() }),
    }),
  }),
}));
vi.mock("../server/lib/design-export.js", () => ({
  buildStandaloneHtml: () => "<html></html>",
  buildSvgForeignObject: () => "<svg></svg>",
  exportFilename: (title: string, ext: string) => `${title}.${ext}`,
  injectHiddenLayerExportStyle: (html: string) => html,
  trySaveExportFile: async () => ({}),
}));
vi.mock("./take-design-screenshot.js", () => ({
  default: { run: mocks.takeDesignScreenshotRun },
  getScreenshotPngData: () => undefined,
}));
vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: () => "/open",
  getAppProductionUrl: () => "https://design.example.test",
  getRequestContext: () => null,
  signShortLivedToken: () => "signed-token",
}));
vi.mock("../server/lib/coding-handoff.js", () => ({
  buildCodingHandoffPrompt: () => "prompt",
  buildHandoffZipUrl: () => "https://design.example.test/zip",
  buildRawHandoffUrl: () => "https://design.example.test/raw",
  normalizeHandoffFormat: (format?: string) => format ?? "markdown",
}));
vi.mock("../server/lib/design-snapshot.js", () => ({
  buildDesignSnapshot: mocks.buildDesignSnapshot,
}));

import exportCodingHandoff from "./export-coding-handoff.js";
import exportHtml from "./export-html.js";
import exportPdf from "./export-pdf.js";
import exportPng from "./export-png.js";
import exportSvg from "./export-svg.js";
import exportZip from "./export-zip.js";

const ctx = { caller: "frontend", userEmail: "owner@example.test" } as never;
const agentCtx = { caller: "tool", runId: "run-1" } as never;
const files = [
  { id: "f1", filename: "index.html", fileType: "html", content: "<p/>" },
];

function exportEvents() {
  return mocks.track.mock.calls.filter(([name]) => name === "design_exported");
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.resolveAccess.mockResolvedValue({
    role: "owner",
    resource: { id: "design-1", title: "Design", data: null },
  });
  mocks.assertAccess.mockResolvedValue({
    role: "owner",
    resource: { id: "design-1", title: "Design", data: null },
  });
  mocks.dbRows.mockResolvedValue(files);
  mocks.buildDesignSnapshot.mockResolvedValue({
    files,
    appliedTweaks: [],
    resolvedCssVars: {},
  });
});

const fileActions = [
  ["html", exportHtml, { id: "design-1" }],
  ["zip", exportZip, { id: "design-1" }],
  ["svg", exportSvg, { id: "design-1", width: 100, height: 100 }],
  ["coding_handoff", exportCodingHandoff, { id: "design-1" }],
] as const;

describe.each(fileActions)("export %s", (format, action, args) => {
  it("records exactly one completed server export with the caller", async () => {
    await (action.run as (a: unknown, c: unknown) => Promise<unknown>)(
      args,
      ctx,
    );

    expect(exportEvents()).toHaveLength(1);
    expect(exportEvents()[0]![1]).toMatchObject({
      output_id: "design-1",
      output_type: "design",
      export_format: format,
      render_location: "server",
      status: "completed",
      file_count: 1,
      caller: "frontend",
    });
  });

  it("records one failed export and rethrows the original error", async () => {
    const error = new Error("db down");
    mocks.dbRows.mockRejectedValue(error);
    mocks.buildDesignSnapshot.mockRejectedValue(error);

    await expect(
      (action.run as (a: unknown, c: unknown) => Promise<unknown>)(
        args,
        agentCtx,
      ),
    ).rejects.toBe(error);

    expect(exportEvents()).toHaveLength(1);
    expect(exportEvents()[0]![1]).toMatchObject({
      output_id: "design-1",
      export_format: format,
      status: "failed",
      error_type: "error",
      caller: "tool",
      run_id: "run-1",
    });
  });

  it("does not attribute a failure before access is verified", async () => {
    mocks.resolveAccess.mockResolvedValue(null);
    mocks.assertAccess.mockRejectedValue(new Error("forbidden"));

    await expect(
      (action.run as (a: unknown, c: unknown) => Promise<unknown>)(args, ctx),
    ).rejects.toThrow();

    expect(exportEvents()).toHaveLength(1);
    expect(exportEvents()[0]![1]).not.toHaveProperty("output_id");
  });

  it("still returns the export when tracking throws", async () => {
    mocks.track.mockImplementation(() => {
      throw new Error("provider down");
    });

    await expect(
      (action.run as (a: unknown, c: unknown) => Promise<unknown>)(args, ctx),
    ).resolves.toBeTruthy();
  });
});

describe("export-pdf", () => {
  it("records preparing render data, never a PDF export", async () => {
    await (exportPdf.run as (a: unknown, c: unknown) => Promise<unknown>)(
      { id: "design-1" },
      ctx,
    );

    expect(exportEvents()).toEqual([]);
    const prepared = mocks.track.mock.calls.filter(
      ([name]) => name === "design_export_prepared",
    );
    expect(prepared).toHaveLength(1);
    expect(prepared[0]![1]).toMatchObject({
      output_id: "design-1",
      export_format: "pdf",
      file_count: 1,
      caller: "frontend",
    });
  });

  it("records nothing when it cannot read the design", async () => {
    const error = new Error("db down");
    mocks.dbRows.mockRejectedValue(error);

    await expect(
      (exportPdf.run as (a: unknown, c: unknown) => Promise<unknown>)(
        { id: "design-1" },
        ctx,
      ),
    ).rejects.toBe(error);
    expect(mocks.track).not.toHaveBeenCalled();
  });
});

describe("export png", () => {
  const screenshot = {
    ok: true,
    designId: "design-1",
    fileId: "file-1",
    filename: "index.html",
    capturedAt: "2026-10-13T00:00:00.000Z",
    screenshots: [
      {
        viewport: { label: "desktop", widthPx: 1440, heightPx: 900 },
        url: "https://files.example.test/screen.png",
        bytes: 1,
        diagnostics: {},
      },
    ],
  };

  it("records exactly one completed export", async () => {
    mocks.takeDesignScreenshotRun.mockResolvedValue(screenshot);

    await exportPng.run({ designId: "design-1", filename: "index.html" }, ctx);

    expect(exportEvents()).toHaveLength(1);
    expect(exportEvents()[0]![1]).toMatchObject({
      output_id: "design-1",
      file_id: "file-1",
      export_format: "png",
      render_location: "server",
      status: "completed",
    });
  });

  it("records one failed export when no renderer is available", async () => {
    mocks.takeDesignScreenshotRun.mockResolvedValue({
      ok: false,
      reason: "no chromium",
    });

    const result = await exportPng.run(
      { designId: "design-1", filename: "index.html" },
      ctx,
    );

    expect(result).toEqual({ ok: false, reason: "no chromium" });
    expect(exportEvents()).toHaveLength(1);
    expect(exportEvents()[0]![1]).toMatchObject({
      export_format: "png",
      status: "failed",
      error_type: "chromium_unavailable",
      output_id: "design-1",
    });

    mocks.track.mockClear();
    await exportPng.run({ fileId: "file-1", filename: "index.html" }, ctx);
    expect(exportEvents()).toHaveLength(1);
    expect(exportEvents()[0]![1]).not.toHaveProperty("output_id");

    // With a fileId the screenshot looks the file up by that id alone, so
    // the passed design id was never checked against it.
    mocks.track.mockClear();
    await exportPng.run(
      { designId: "design-other", fileId: "file-1", filename: "index.html" },
      ctx,
    );
    expect(exportEvents()).toHaveLength(1);
    expect(exportEvents()[0]![1]).not.toHaveProperty("output_id");
  });

  it("records one failed export with the contract error code, then rethrows", async () => {
    mocks.takeDesignScreenshotRun.mockResolvedValue({
      ...screenshot,
      screenshots: [{ ...screenshot.screenshots[0], url: undefined }],
    });

    await expect(
      exportPng.run({ designId: "design-1", filename: "index.html" }, ctx),
    ).rejects.toThrow(/file storage/);

    expect(exportEvents()).toHaveLength(1);
    expect(exportEvents()[0]![1]).toMatchObject({
      output_id: "design-1",
      status: "failed",
      error_type: "file_storage_not_configured",
    });
  });
});
