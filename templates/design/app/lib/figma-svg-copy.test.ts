import { describe, expect, it, vi } from "vitest";

import {
  canCopyFigmaSvgToClipboard,
  copyDesignAsFigmaSvg,
  FigmaSvgCopyError,
  type FigmaSvgCopyEnvironment,
  type FigmaSvgExportActionResult,
} from "./figma-svg-copy";

function clipboardEnvironment(options?: {
  write?: (items: ClipboardItem[]) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
  withClipboardItem?: boolean;
  callExportAction?: (params: unknown) => Promise<FigmaSvgExportActionResult>;
}) {
  const constructed: Array<Record<string, Blob | Promise<Blob>>> = [];
  class FakeClipboardItem {
    static supports() {
      return true;
    }

    constructor(items: Record<string, Blob | Promise<Blob>>) {
      constructed.push(items);
    }
  }
  const write = vi.fn(options?.write ?? (async () => undefined));
  const writeText = options?.writeText ? vi.fn(options.writeText) : undefined;
  const environment = {
    clipboard: { write, writeText },
    ClipboardItem:
      options?.withClipboardItem === false ? null : FakeClipboardItem,
    callExportAction:
      options?.callExportAction ??
      (async () => ({
        ok: true,
        svg: "<svg><rect/></svg>",
        filename: "screen-figma-123.svg",
        report: { vectorized: ["root"] },
      })),
  } as unknown as FigmaSvgCopyEnvironment;
  return { constructed, write, writeText, environment };
}

describe("canCopyFigmaSvgToClipboard", () => {
  it("is true when clipboard.write is available", () => {
    const { environment } = clipboardEnvironment();
    expect(canCopyFigmaSvgToClipboard(environment)).toBe(true);
  });

  it("is true when only writeText is available (no ClipboardItem support)", () => {
    expect(
      canCopyFigmaSvgToClipboard({
        clipboard: { writeText: vi.fn() },
      } as never),
    ).toBe(true);
  });

  it("is false when neither write nor writeText is available", () => {
    expect(canCopyFigmaSvgToClipboard({ clipboard: {} } as never)).toBe(false);
    expect(canCopyFigmaSvgToClipboard({ clipboard: null } as never)).toBe(
      false,
    );
  });
});

describe("copyDesignAsFigmaSvg", () => {
  it("writes BOTH text/plain (the proven Figma-paste MIME) and image/svg+xml representations", async () => {
    const { constructed, environment, write } = clipboardEnvironment();

    const result = await copyDesignAsFigmaSvg(
      { designId: "design_1" },
      environment,
    );

    expect(write).toHaveBeenCalledTimes(1);
    expect(constructed).toHaveLength(1);
    const item = constructed[0]!;
    const textBlob = await item["text/plain"];
    const svgBlob = await item["image/svg+xml"];
    expect(textBlob).toBeInstanceOf(Blob);
    expect(textBlob.type).toBe("text/plain");
    expect(svgBlob).toBeInstanceOf(Blob);
    expect(svgBlob.type).toBe("image/svg+xml");
    expect(await textBlob.text()).toBe("<svg><rect/></svg>");
    expect(result.filename).toBe("screen-figma-123.svg");
    expect(result.report).toEqual({ vectorized: ["root"] });
  });

  it("falls back to writeText (still text/plain SVG markup) when ClipboardItem is unavailable", async () => {
    const { environment, writeText, write } = clipboardEnvironment({
      withClipboardItem: false,
      writeText: async () => undefined,
    });

    await copyDesignAsFigmaSvg({ designId: "design_1" }, environment);

    expect(write).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith("<svg><rect/></svg>");
  });

  it("starts clipboard.write before a slow server export resolves", async () => {
    let resolveExport!: (result: FigmaSvgExportActionResult) => void;
    const callExportAction = vi.fn(
      () =>
        new Promise<FigmaSvgExportActionResult>((resolve) => {
          resolveExport = resolve;
        }),
    );
    const { environment, write } = clipboardEnvironment({ callExportAction });

    const operation = copyDesignAsFigmaSvg(
      { designId: "design_1" },
      environment,
    );
    expect(write).toHaveBeenCalledTimes(1);

    resolveExport({
      ok: true,
      svg: "<svg><rect/></svg>",
      filename: "slow.svg",
      report: {},
    });
    await expect(operation).resolves.toMatchObject({ filename: "slow.svg" });
  });

  it("does not advertise write-only clipboard support without ClipboardItem", () => {
    expect(
      canCopyFigmaSvgToClipboard({
        clipboard: { write: vi.fn() },
        ClipboardItem: null,
      } as never),
    ).toBe(false);
  });

  it("throws 'unsupported' before calling the export action when the clipboard API is missing", async () => {
    const callExportAction = vi.fn();
    await expect(
      copyDesignAsFigmaSvg({ designId: "design_1" }, {
        clipboard: null,
        callExportAction,
      } as never),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(callExportAction).not.toHaveBeenCalled();
  });

  it("wraps a chromium-unavailable export action response as 'render-failed'", async () => {
    const { environment } = clipboardEnvironment({
      callExportAction: async () => ({
        ok: false,
        reason: "A headless Chromium browser is not available...",
      }),
    });

    const promise = copyDesignAsFigmaSvg({ designId: "design_1" }, environment);
    await expect(promise).rejects.toBeInstanceOf(FigmaSvgCopyError);
    await expect(promise).rejects.toMatchObject({ code: "render-failed" });
  });

  it("classifies a clipboard permission failure without hiding the cause", async () => {
    const permissionError = new DOMException("denied", "NotAllowedError");
    const { environment } = clipboardEnvironment({
      write: async () => {
        throw permissionError;
      },
    });

    const promise = copyDesignAsFigmaSvg({ designId: "design_1" }, environment);
    await expect(promise).rejects.toBeInstanceOf(FigmaSvgCopyError);
    await expect(promise).rejects.toMatchObject({ code: "blocked" });
  });

  it("passes designId/fileId/nodeId/embedImages through to the export action", async () => {
    const callExportAction = vi.fn(async () => ({
      ok: true,
      svg: "<svg/>",
      filename: "x.svg",
      report: {},
    }));
    const { environment } = clipboardEnvironment({ callExportAction });

    await copyDesignAsFigmaSvg(
      { designId: "design_1", nodeId: "node_1", embedImages: false },
      environment,
    );

    expect(callExportAction).toHaveBeenCalledWith({
      designId: "design_1",
      nodeId: "node_1",
      embedImages: false,
    });
  });
});
