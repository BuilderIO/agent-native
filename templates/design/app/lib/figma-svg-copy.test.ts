// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildFigmaSvgFromLiveDocument,
  canCopyFigmaSvgToClipboard,
  copyDesignAsFigmaSvg,
  exportDesignAsFigmaSvg,
  FigmaSvgCopyError,
  prepareLiveFigmaSvgSnapshotFrame,
  sanitizeLiveFigmaSvgSnapshotHtml,
  type FigmaSvgCopyEnvironment,
  type FigmaSvgExportActionResult,
} from "./figma-svg-copy";

// `background-image: none` is what every real browser computes for an element
// with no background image; happy-dom answers "initial", which the shared
// pipeline (correctly) reports as an unrecognized paint layer. Say it out loud
// in the fixture rather than teaching the exporter about a test-only value.
const NO_BG_IMAGE = "background-image: none";

function rect(x: number, y: number, width: number, height: number) {
  return {
    x,
    y,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

function liveDocumentFixture() {
  document.body.innerHTML = `
    <main data-agent-native-node-id="screen" data-agent-native-layer-name="Screen"
      style="width: 320px; height: 240px; background-color: rgb(255, 255, 255); ${NO_BG_IMAGE}">
      <button data-agent-native-node-id="cta" style="box-sizing: border-box; width: 120px; height: 40px; padding: 8px 20px; background-color: rgb(0, 100, 255); ${NO_BG_IMAGE}; color: white; box-shadow: rgba(0, 0, 0, 0.25) 0px 12px 28px 0px">Continue</button>
    </main>`;
  const screen = document.querySelector("main")!;
  const button = document.querySelector("button")!;
  vi.spyOn(screen, "getBoundingClientRect").mockReturnValue(
    rect(0, 0, 320, 240),
  );
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue(
    rect(24, 32, 120, 40),
  );
  return { button, document, screen };
}

/**
 * The shared DOM walk measures real text with `Range.getClientRects()`, which
 * happy-dom always answers with an empty list — the same reason the server's
 * walk is exercised by the Playwright fidelity harness rather than by vitest.
 * Stand in a deterministic monospace layout so the text path (line splitting,
 * baselines, `text-transform`) is still covered here.
 */
const CHAR_WIDTH = 6;
const LINE_HEIGHT = 20;

function stubMeasuredText(
  charsPerLine: number,
  origin = { left: 44, top: 32 },
) {
  vi.spyOn(Range.prototype, "getClientRects").mockImplementation(
    function (this: Range) {
      const node = this.startContainer;
      if (node.nodeType !== Node.TEXT_NODE) return [] as unknown as DOMRectList;
      const text = node.textContent ?? "";
      const to = Math.min(this.endOffset, text.length);
      const rects: DOMRect[] = [];
      for (let offset = this.startOffset; offset < to; offset += 1) {
        const top =
          origin.top + Math.floor(offset / charsPerLine) * LINE_HEIGHT;
        const left = origin.left + (offset % charsPerLine) * CHAR_WIDTH;
        const previous = rects[rects.length - 1];
        if (previous && previous.top === top) {
          rects[rects.length - 1] = rect(
            previous.left,
            top,
            left + CHAR_WIDTH - previous.left,
            LINE_HEIGHT,
          );
        } else {
          rects.push(rect(left, top, CHAR_WIDTH, LINE_HEIGHT));
        }
      }
      return rects as unknown as DOMRectList;
    },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildFigmaSvgFromLiveDocument", () => {
  it("uses live computed layout and emits editable SVG primitives without foreignObject", () => {
    stubMeasuredText(64);
    const { document, screen } = liveDocumentFixture();
    const result = buildFigmaSvgFromLiveDocument({
      document,
      root: screen,
      width: 390,
      height: 844,
      title: "Checkout",
    });

    expect(result.svg).toContain('viewBox="0 0 390 844"');
    expect(result.svg).toContain("<title>Checkout</title>");
    // Button box: origin-relative x/y straight off the live rects.
    expect(result.svg).toContain(
      '<rect x="24" y="32" width="120" height="40" fill="rgb(0, 100, 255)"/>',
    );
    expect(result.svg).toContain("<text ");
    expect(result.svg).toContain(">Continue</tspan>");
    expect(result.svg).not.toContain("foreignObject");
    expect(result.report).toMatchObject({ source: "live-dom" });
  });

  it("splits an rgba() shadow into a premultiplied color and its own opacity", () => {
    const { document, screen } = liveDocumentFixture();
    const result = buildFigmaSvgFromLiveDocument({ document, root: screen });

    // The old client emitted feDropShadow with the raw CSS color; the shared
    // pipeline paints real shadow geometry with the alpha split off, which is
    // what Figma imports as an editable drop shadow.
    expect(result.svg).toContain('fill="rgb(0, 0, 0)" fill-opacity="0.25"');
    expect(result.svg).toContain("<feGaussianBlur");
    expect(result.svg).not.toContain('flood-color="0px"');
  });

  it("scopes a copy to the selected node id", () => {
    const { document } = liveDocumentFixture();
    const result = buildFigmaSvgFromLiveDocument({ document }, "cta");
    const report = result.report as { vectorized: string[] };

    expect(report.vectorized).toContain("cta");
    expect(report.vectorized).not.toContain("Screen");
    // Scoping re-origins the scene on the selected node.
    expect(result.svg).toContain('viewBox="0 0 120 40"');
    expect(result.svg).toContain('<rect x="0" y="0" width="120" height="40"');
  });

  it("fails closed when a requested live node no longer exists", () => {
    const { document } = liveDocumentFixture();
    expect(() =>
      buildFigmaSvgFromLiveDocument({ document }, "deleted-layer"),
    ).toThrow(/no longer exists/);
  });

  it("turns a live CSS gradient into a user-space SVG gradient definition", () => {
    const { document, screen } = liveDocumentFixture();
    (screen as HTMLElement).style.backgroundImage =
      "linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)";
    const result = buildFigmaSvgFromLiveDocument({ document, root: screen });

    expect(result.svg).toContain("<linearGradient");
    // A box-relative gradient renders as a flat band once the box is away from
    // the origin; userSpaceOnUse endpoints are the server-path fix this client
    // never had.
    expect(result.svg).toContain('gradientUnits="userSpaceOnUse"');
    expect(result.svg).toContain('fill="url(#');
  });

  it("premultiplies a transparent gradient stop instead of fading through black", () => {
    const { document, screen } = liveDocumentFixture();
    (screen as HTMLElement).style.backgroundImage =
      "linear-gradient(90deg, rgb(255, 0, 0) 0%, rgba(0, 0, 0, 0) 100%)";
    const result = buildFigmaSvgFromLiveDocument({ document, root: screen });

    expect(result.svg).toContain(
      '<stop offset="100%" stop-color="rgb(255, 0, 0)" stop-opacity="0"/>',
    );
  });

  it("exports the glyphs CSS actually paints, not the source text", () => {
    stubMeasuredText(64);
    const { button, document, screen } = liveDocumentFixture();
    (button as HTMLElement).style.textTransform = "uppercase";
    const result = buildFigmaSvgFromLiveDocument({ document, root: screen });

    expect(result.svg).toContain(">CONTINUE</tspan>");
    expect(result.svg).not.toContain(">Continue</tspan>");
  });

  it("preserves browser-measured text wrapping as separate baselines", () => {
    const { button, document, screen } = liveDocumentFixture();
    button.textContent = "Editable design, round tripped.";
    stubMeasuredText(17);

    const result = buildFigmaSvgFromLiveDocument({ document, root: screen });
    const tspans = Array.from(
      result.svg.matchAll(/<tspan[^>]*y="([\d.]+)"[^>]*>([^<]*)<\/tspan>/g),
    ).map((match) => ({ y: Number(match[1]), text: match[2] }));

    expect(tspans.map((line) => line.text)).toEqual([
      "Editable design,",
      "round tripped.",
    ]);
    expect(tspans[1]!.y - tspans[0]!.y).toBe(LINE_HEIGHT);
  });

  it("passes an inline SVG icon through as vector art while stripping scripts", () => {
    const { document, screen } = liveDocumentFixture();
    screen.innerHTML = `<svg data-agent-native-node-id="logo" width="40" height="30" viewBox="0 0 40 30"><rect x="3" y="4" width="20" height="10" onclick="bad()"/><script>bad()</script></svg>`;
    const svg = screen.querySelector("svg")!;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue(
      rect(10, 12, 40, 30),
    );

    const result = buildFigmaSvgFromLiveDocument({ document, root: screen });

    expect(result.svg).toContain('<svg x="10" y="12" width="40" height="30"');
    expect(result.svg).toContain('viewBox="0 0 40 30"');
    expect(result.svg).toContain('<rect x="3" y="4" width="20" height="10"');
    expect(result.svg).not.toContain("<script");
    expect(result.svg).not.toContain("onclick");
    expect((result.report as { vectorized: string[] }).vectorized).toContain(
      "logo",
    );
  });

  it("warns instead of shipping an empty image when a node cannot be rasterized", () => {
    const { document, screen } = liveDocumentFixture();
    screen.innerHTML = `<canvas data-agent-native-node-id="chart" width="100" height="80"></canvas>`;
    const canvas = screen.querySelector("canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(
      rect(0, 0, 100, 80),
    );

    const result = buildFigmaSvgFromLiveDocument({ document, root: screen });
    const report = result.report as {
      rasterized: Array<{ node: string; reason: string }>;
      warnings: string[];
    };

    expect(report.rasterized.map((item) => item.node)).toContain("chart");
    // The server screenshots these; a browser tab cannot, so it must say so
    // rather than emit an <image> pointing at nothing.
    expect(report.warnings.join(" ")).toMatch(/could not be rasterized/i);
  });
});

describe("live snapshot isolation", () => {
  const malicious = `<!doctype html><html><body onload="window.__snapshotAttack=1">
    <script>window.__snapshotAttack=2</script>
    <img src="x" onerror="window.__snapshotAttack=3">
    <iframe srcdoc="<script>window.parent.__snapshotAttack=4</script>"></iframe>
    <object data="javascript:window.__snapshotAttack=5"></object>
    <a href="javascript:window.__snapshotAttack=6">bad</a>
    <button formaction="javascript:window.__snapshotAttack=7" autofocus>go</button>
  </body></html>`;

  it("strips scripts, frames, active attributes, and javascript URLs while adding CSP", () => {
    const sanitized = sanitizeLiveFigmaSvgSnapshotHtml(malicious);
    expect(sanitized).toContain("Content-Security-Policy");
    expect(sanitized).toContain("default-src 'none'");
    expect(sanitized).not.toMatch(
      /<script|<iframe|<object|\sonload=|\sonerror=|\ssrcdoc=|javascript:|\sautofocus/i,
    );
  });

  it("uses a readable same-origin sandbox without script permission", async () => {
    (window as Window & { __snapshotAttack?: number }).__snapshotAttack = 0;
    const iframe = document.createElement("iframe");
    prepareLiveFigmaSvgSnapshotFrame(iframe, {
      html: malicious,
      width: 320,
      height: 240,
    });
    expect(iframe.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-scripts");
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(iframe.srcdoc).not.toMatch(/<script|<iframe|onerror=|onload=/i);
    document.body.appendChild(iframe);
    await Promise.resolve();
    expect(
      (window as Window & { __snapshotAttack?: number }).__snapshotAttack,
    ).toBe(0);
    iframe.remove();
    delete (window as Window & { __snapshotAttack?: number }).__snapshotAttack;
  });
});

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
  it("reports and removes a remote image that cannot be safely embedded", async () => {
    const { document, screen } = liveDocumentFixture();
    screen.innerHTML = `<img data-agent-native-node-id="hero" src="https://example.com/expiring.png">`;
    const image = screen.querySelector("img")!;
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(
      rect(0, 0, 100, 80),
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("blocked")));
    try {
      const result = await exportDesignAsFigmaSvg(
        { fileId: "file_1" },
        { liveSource: { document, root: screen } },
      );
      const report = result.report as {
        omitted: Array<{ reason: string }>;
        warnings: string[];
      };
      expect(result.svg).not.toContain("expiring.png");
      expect(
        report.omitted.some((item) => /safely embedded/.test(item.reason)),
      ).toBe(true);
      expect(report.warnings.join(" ")).toMatch(/remote images were omitted/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("prefers the live iframe DOM and never calls the Chromium action", async () => {
    const { document, screen } = liveDocumentFixture();
    const callExportAction = vi.fn();
    const { environment, constructed } = clipboardEnvironment({
      callExportAction,
    });
    environment.liveSource = { document, root: screen, title: "Live" };

    await copyDesignAsFigmaSvg({ designId: "design_1" }, environment);

    expect(callExportAction).not.toHaveBeenCalled();
    expect(await (await constructed[0]!["text/plain"]).text()).toContain(
      '<rect x="24" y="32" width="120" height="40" fill="rgb(0, 100, 255)"/>',
    );
  });

  it("merges a liveSource-only override with the real browser clipboard", async () => {
    const { document, screen } = liveDocumentFixture();
    const write = vi.fn(async () => undefined);
    class BrowserClipboardItem {
      constructor(readonly items: Record<string, Blob | Promise<Blob>>) {}
    }
    vi.stubGlobal("navigator", { clipboard: { write } });
    vi.stubGlobal("ClipboardItem", BrowserClipboardItem);
    try {
      await copyDesignAsFigmaSvg(
        { fileId: "file_1" },
        { liveSource: { document, root: screen } },
      );
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

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

  it("falls back to the action when the supplied live document is detached", async () => {
    const callExportAction = vi.fn(async () => ({
      ok: true,
      svg: "<svg><path/></svg>",
      filename: "fallback.svg",
      report: {},
    }));
    const result = await exportDesignAsFigmaSvg(
      { fileId: "file_1" },
      {
        liveSource: { document: {} as Document },
        callExportAction,
      },
    );

    expect(callExportAction).toHaveBeenCalledWith({ fileId: "file_1" });
    expect(result.filename).toBe("fallback.svg");
  });
});
