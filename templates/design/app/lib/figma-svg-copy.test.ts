// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

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

function liveDocumentFixture() {
  document.body.innerHTML = `
    <main data-agent-native-node-id="screen" data-agent-native-layer-name="Screen"
      style="width: 320px; height: 240px; background: rgb(255, 255, 255)">
      <button data-agent-native-node-id="cta" style="box-sizing: border-box; width: 120px; height: 40px; padding: 8px 20px; background: rgb(0, 100, 255); color: white; box-shadow: rgba(0, 0, 0, 0.25) 0px 12px 28px 0px">Continue</button>
    </main>`;
  const screen = document.querySelector("main")!;
  const button = document.querySelector("button")!;
  vi.spyOn(screen, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 320,
    bottom: 240,
    width: 320,
    height: 240,
    toJSON: () => ({}),
  });
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
    x: 24,
    y: 32,
    left: 24,
    top: 32,
    right: 144,
    bottom: 72,
    width: 120,
    height: 40,
    toJSON: () => ({}),
  });
  return { button, document, screen };
}

describe("buildFigmaSvgFromLiveDocument", () => {
  it("uses live computed layout and emits editable SVG primitives without foreignObject", () => {
    const { document, screen } = liveDocumentFixture();
    const result = buildFigmaSvgFromLiveDocument({
      document,
      root: screen,
      width: 390,
      height: 844,
      title: "Checkout",
    });

    expect(result.svg).toContain('viewBox="0 0 390 844"');
    expect(result.svg).toContain('<rect id="cta"');
    expect(result.svg).toContain('x="44"');
    expect(result.svg).toContain('flood-color="rgb(0, 0, 0)"');
    expect(result.svg).toContain('flood-opacity="0.25"');
    expect(result.svg).not.toContain('flood-color="0px"');
    expect(result.svg).toContain(">Continue</text>");
    expect(result.svg).not.toContain("foreignObject");
    expect(result.report).toMatchObject({ source: "live-dom" });
  });

  it("scopes a copy to the selected node id", () => {
    const { document } = liveDocumentFixture();
    const result = buildFigmaSvgFromLiveDocument({ document }, "cta");

    expect(result.svg).toContain('id="cta"');
    expect(result.svg).not.toContain('id="screen"');
  });

  it("fails closed when a requested live node no longer exists", () => {
    const { document } = liveDocumentFixture();
    expect(() =>
      buildFigmaSvgFromLiveDocument({ document }, "deleted-layer"),
    ).toThrow(/no longer exists/);
  });

  it("turns a live CSS gradient into an SVG gradient definition", () => {
    const { document, screen } = liveDocumentFixture();
    (screen as HTMLElement).style.backgroundImage =
      "linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)";
    const result = buildFigmaSvgFromLiveDocument({ document, root: screen });

    expect(result.svg).toContain("<linearGradient");
    expect(result.svg).toContain('fill="url(#gradient-');
  });

  it("preserves browser-measured text wrapping with editable tspan lines", () => {
    const { button, document, screen } = liveDocumentFixture();
    button.textContent = "Editable design, round tripped.";
    const realCreateRange = document.createRange.bind(document);
    let start = 0;
    vi.spyOn(document, "createRange").mockImplementation(() => {
      const range = realCreateRange();
      Object.defineProperties(range, {
        setStart: {
          value: (_node: Node, offset: number) => {
            start = offset;
          },
        },
        setEnd: { value: () => undefined },
        getBoundingClientRect: {
          value: () => {
            const secondLine = start >= 17;
            const lineOffset = secondLine ? start - 17 : start;
            const left = 44 + lineOffset * 6;
            const top = secondLine ? 52 : 32;
            return {
              x: left,
              y: top,
              left,
              top,
              right: left + 6,
              bottom: top + 16,
              width: 6,
              height: 16,
              toJSON: () => ({}),
            };
          },
        },
      });
      return range;
    });

    const result = buildFigmaSvgFromLiveDocument({ document, root: screen });

    expect(result.svg).toContain(
      '<tspan x="44" y="48">Editable design,</tspan>',
    );
    expect(result.svg).toContain('<tspan x="44" y="68">round tripped.</tspan>');
  });

  it("preserves native SVG child geometry while sanitizing scripts", () => {
    const { document, screen } = liveDocumentFixture();
    screen.innerHTML = `<svg data-agent-native-node-id="logo" width="40" height="30"><rect x="3" y="4" width="20" height="10"/><script>bad()</script></svg>`;
    const svg = screen.querySelector("svg")!;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 12,
      left: 10,
      top: 12,
      right: 50,
      bottom: 42,
      width: 40,
      height: 30,
      toJSON: () => ({}),
    });

    const result = buildFigmaSvgFromLiveDocument({ document, root: screen });
    expect(result.svg).toContain('<rect x="3" y="4" width="20" height="10"');
    expect(result.svg).not.toContain("<script");
  });

  it("reports unsupported transform, background, clip, and overflow behavior", () => {
    const { button, document, screen } = liveDocumentFixture();
    (button as HTMLElement).style.transform = "rotate(10deg)";
    (button as HTMLElement).style.backgroundImage =
      'url("https://example.com/background.png")';
    (button as HTMLElement).style.clipPath = "circle(40%)";
    (button as HTMLElement).style.overflow = "hidden";
    const result = buildFigmaSvgFromLiveDocument({ document, root: screen });
    const report = result.report as {
      approximated: Array<{ note: string }>;
      warnings: string[];
    };
    const notes = report.approximated.map((item) => item.note).join("\n");
    expect(notes).toMatch(/transform/);
    expect(notes).toMatch(/background image/);
    expect(notes).toMatch(/clip-path/);
    expect(notes).toMatch(/Overflow clipping/);
    expect(report.approximated.length).toBeGreaterThanOrEqual(4);
    expect(report.warnings).not.toHaveLength(0);
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
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 80,
      width: 100,
      height: 80,
      toJSON: () => ({}),
    });
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
      '<rect id="cta"',
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
