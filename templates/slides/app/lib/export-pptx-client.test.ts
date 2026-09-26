// @vitest-environment happy-dom
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exportToPptx: vi.fn(),
}));

vi.mock("dom-to-pptx", () => ({
  exportToPptx: mocks.exportToPptx,
}));

import {
  addSpeakerNotesToPptxBlob,
  pinTextBoxesInXml,
  retypeThemeFonts,
  usedFontFamilies,
  blankRasterResult,
  buildDeckPptxBlob,
  exportDeckAsPptx,
  gradientPaint,
  markWrappedLines,
  materializeClipPathShapes,
  materializeCompositeBorders,
  patchBulletIndentsInPptxBlob,
  pinRenderedFontFamilies,
  pptxExportScale,
  replaceInlineSvgsWithImages,
  widenInPlace,
} from "./export-pptx-client";
import { WRAP_MARK } from "./pptx-google-slides";

async function buildMinimalPptxBlob(slideCount = 1): Promise<Blob> {
  const zip = new JSZip();
  const slideIds = Array.from({ length: slideCount }, (_, i) => i + 1)
    .map((n) => `<p:sldId id="${255 + n}" r:id="rId${n + 1}"/>`)
    .join("");

  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst>${slideIds}</p:sldIdLst><p:defaultTextStyle></p:defaultTextStyle></p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/></Relationships>',
  );

  for (let i = 1; i <= slideCount; i++) {
    zip.file(`ppt/slides/slide${i}.xml`, "<p:sld/>");
    zip.file(
      `ppt/slides/_rels/slide${i}.xml.rels`,
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>',
    );
  }

  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

function setRenderedSlide(html = "Editable title") {
  document.body.innerHTML = `<div data-slide-canvas="slide-1" data-test-rect="0,0,960,540" style="width: 960px; height: 540px;"><h1>${html}</h1></div>`;
  const slideCanvas = document.querySelector<HTMLElement>(
    '[data-slide-canvas="slide-1"]',
  );
  if (!slideCanvas) throw new Error("test slide missing");
  Object.defineProperty(slideCanvas, "offsetWidth", {
    configurable: true,
    value: 960,
  });
  return slideCanvas;
}

function setSlideMarkup(markup: string) {
  document.body.innerHTML = `<div data-slide-canvas="slide-1" data-test-rect="0,0,960,540" style="width: 960px; height: 540px;">${markup}</div>`;
  const slideCanvas = document.querySelector<HTMLElement>(
    '[data-slide-canvas="slide-1"]',
  );
  if (!slideCanvas) throw new Error("test slide missing");
  Object.defineProperty(slideCanvas, "offsetWidth", {
    configurable: true,
    value: 960,
  });
  return slideCanvas;
}

function setPendingImage() {
  const slideCanvas = setRenderedSlide(
    '<img alt="Remote image" src="/remote-image.png" />',
  );
  const image = slideCanvas.querySelector<HTMLImageElement>("img");
  if (!image) throw new Error("test image missing");
  Object.defineProperties(image, {
    complete: { configurable: true, value: false },
    naturalWidth: { configurable: true, value: 0 },
  });
  return image;
}

function stubRectsFromDataAttr() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const raw = (this as HTMLElement).dataset?.testRect;
      const [x, y, width, height] = raw
        ? raw.split(",").map(Number)
        : [0, 0, 0, 0];
      return {
        bottom: y + height,
        height,
        left: x,
        right: x + width,
        toJSON: () => ({}),
        top: y,
        width,
        x,
        y,
      } as DOMRect;
    },
  );
}

function markImageAsLoaded(image: HTMLImageElement) {
  Object.defineProperties(image, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: 1 },
  });
  Object.defineProperty(image, "decode", {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  setRenderedSlide();
  const cssShim = (globalThis.CSS ??
    ({} as unknown as typeof CSS)) as typeof CSS & {
    escape: (s: string) => string;
  };
  Object.defineProperty(cssShim, "escape", {
    configurable: true,
    value: (s: string) => s,
  });
  Object.defineProperty(globalThis, "CSS", {
    configurable: true,
    value: cssShim,
  });
  mocks.exportToPptx.mockResolvedValue(await buildMinimalPptxBlob());
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pptx");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    () => undefined,
  );
  const realSetTimeout = window.setTimeout.bind(window);
  vi.spyOn(window, "setTimeout").mockImplementation(((
    handler: TimerHandler,
    timeout?: number,
    ...args: any[]
  ) => {
    if (timeout === 60_000) return 1;
    return realSetTimeout(handler, timeout, ...args);
  }) as typeof window.setTimeout);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("exportDeckAsPptx", () => {
  it("exports unscaled rendered slide DOM as editable native PPTX", async () => {
    const source = document.querySelector('[data-slide-canvas="slide-1"]');

    await exportDeckAsPptx("Quarterly Review", [{ id: "slide-1" }], "16:9");

    expect(mocks.exportToPptx).toHaveBeenCalledTimes(1);
    const [targets, options] = mocks.exportToPptx.mock.calls[0];
    expect(Array.isArray(targets)).toBe(true);
    const [target] = targets as HTMLElement[];
    expect(target).not.toBe(source);
    expect(target.textContent).toContain("Editable title");
    expect(target.style.width).toBe("960px");
    expect(target.style.height).toBe("540px");
    expect(target.isConnected).toBe(false);
    expect(options).toMatchObject({
      autoEmbedFonts: false,
      fileName: "Quarterly-Review.pptx",
      height: 7.5,
      skipDownload: true,
      svgAsVector: false,
      width: 13.33,
    });
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });

  it("replaces inline SVGs before passing DOM to the native exporter", async () => {
    setRenderedSlide(
      '<svg width="120" height="80" viewBox="0 0 120 80" aria-label="chart"><rect width="120" height="80" fill="#2563eb" /></svg>',
    );

    await exportDeckAsPptx("SVG Deck", [{ id: "slide-1" }], "16:9");

    const [targets] = mocks.exportToPptx.mock.calls[0];
    const [target] = targets as HTMLElement[];
    expect(target.querySelector("svg")).toBeNull();
    const image = target.querySelector("img");
    expect(image?.src).toMatch(/^data:image\/(png|svg\+xml)/);
    expect(image?.style.width).toBe("120px");
    expect(image?.style.height).toBe("80px");
  });

  it("keeps imported slide objects editable during export", async () => {
    setRenderedSlide(
      '<div class="fmd-imported-pptx" data-imported-pptx="true"><div data-pptx-element-kind="text">Editable imported title</div></div>',
    );

    await exportDeckAsPptx("Imported Deck", [{ id: "slide-1" }], "16:9");

    const [targets] = mocks.exportToPptx.mock.calls[0];
    const [target] = targets as HTMLElement[];
    expect(
      target.querySelector('[data-pptx-element-kind="text"]'),
    ).not.toBeNull();
    expect(target.textContent).toContain("Editable imported title");
  });

  it("passes custom aspect-ratio dimensions to the native exporter", async () => {
    await exportDeckAsPptx("Square Deck", [{ id: "slide-1" }], "1:1");

    const [, options] = mocks.exportToPptx.mock.calls[0];
    expect(options).toMatchObject({
      height: 10,
      width: 10,
    });
  });

  it("inserts a real space after imported-PPTX bullet marker spans so the marker and text don't run together", async () => {
    setRenderedSlide(
      '<p data-pptx-paragraph="0"><span aria-hidden="true" style="margin-right:8px;">•</span>PLG-first approach</p>',
    );

    await exportDeckAsPptx("Contents", [{ id: "slide-1" }], "16:9");

    const [targets] = mocks.exportToPptx.mock.calls[0];
    const [target] = targets as HTMLElement[];
    const paragraph = target.querySelector('p[data-pptx-paragraph="0"]');
    expect(paragraph?.textContent).toBe("• PLG-first approach");
  });

  it("keeps a single-line imported paragraph whitespace-preserving instead of collapsing it to nowrap", async () => {
    stubRectsFromDataAttr();
    setSlideMarkup(
      '<p data-pptx-paragraph="0" data-test-rect="0,0,300,24" style="white-space:pre-wrap;line-height:24px;">' +
        "<span>IMAGE </span><span>COMPOSITION</span></p>" +
        '<h1 data-test-rect="0,40,300,24" style="line-height:24px;">Generated heading</h1>',
    );

    await exportDeckAsPptx("Brand Guide", [{ id: "slide-1" }], "16:9");

    const [targets] = mocks.exportToPptx.mock.calls[0];
    const [target] = targets as HTMLElement[];
    expect(
      target.querySelector<HTMLElement>("p[data-pptx-paragraph]")?.style
        .whiteSpace,
    ).toBe("pre");
    expect(target.querySelector<HTMLElement>("h1")?.style.whiteSpace).toBe(
      "nowrap",
    );
  });

  it("does not re-anchor a cropped image to slide coordinates inside its own positioned wrapper", async () => {
    stubRectsFromDataAttr();
    setSlideMarkup(
      '<div class="fmd-pptx-image" data-slide-object-id="373" data-test-rect="313.801,142.444,150,150" ' +
        'style="position:absolute;left:313.801px;top:142.444px;width:150px;height:150px;overflow:hidden;">' +
        '<img alt="" src="data:image/png;base64,iVBORw0KGgo=" data-test-rect="313.801,142.444,150,150" ' +
        'style="display:block;position:absolute;left:0px;top:0px;width:100%;height:100%;" /></div>',
    );
    const image = document.querySelector<HTMLImageElement>("img");
    if (!image) throw new Error("test image missing");
    markImageAsLoaded(image);

    await exportDeckAsPptx("Superteam", [{ id: "slide-1" }], "16:9");

    const [targets] = mocks.exportToPptx.mock.calls[0];
    const [target] = targets as HTMLElement[];
    const exported = target.querySelector<HTMLImageElement>("img");
    expect(Number.parseFloat(exported?.style.left ?? "")).toBeCloseTo(0, 3);
    expect(Number.parseFloat(exported?.style.top ?? "")).toBeCloseTo(0, 3);
  });

  it("sizes a rotated freeform from its own box, not its rotated bounding box", async () => {
    stubRectsFromDataAttr();
    setSlideMarkup(
      '<svg data-test-rect="195.9,19.5,572.4,572.4" viewBox="0 0 405.164 405.164" ' +
        'style="position:absolute;left:279.547px;top:103.078px;width:405.164px;height:405.164px;' +
        'transform:rotate(-137.59755deg);transform-origin:center center;">' +
        '<path d="M8.9 261.8 L65.7 53.2 L127.5 120.7 Z" fill="#DA474F" /></svg>',
    );

    await exportDeckAsPptx("Infographics", [{ id: "slide-1" }], "16:9");

    const [targets] = mocks.exportToPptx.mock.calls[0];
    const [target] = targets as HTMLElement[];
    const exported = target.querySelector<HTMLImageElement>("img");
    expect(exported?.style.width).toBe("405.164px");
    expect(exported?.style.height).toBe("405.164px");
    expect(exported?.style.transform).toBe("rotate(-137.59755deg)");
    expect(decodeURIComponent(exported?.src ?? "")).not.toContain("rotate(");
  });

  it("bakes an overflow-hidden crop into the exported bitmap", async () => {
    stubRectsFromDataAttr();
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,Q1JPUA==",
    );
    setSlideMarkup(
      '<div class="fmd-pptx-image" data-test-rect="612.7,192,192.9,192.1" ' +
        'style="position:absolute;left:612.7px;top:192px;width:192.9px;height:192.1px;overflow:hidden;">' +
        '<img alt="" src="/portrait.png" data-test-rect="445,192,521.6,347.6" ' +
        'style="position:absolute;left:-167.7px;top:0px;width:521.6px;height:347.6px;" /></div>',
    );
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(
      true,
    );
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(
      5216,
    );
    vi.spyOn(
      HTMLImageElement.prototype,
      "naturalHeight",
      "get",
    ).mockReturnValue(3476);
    vi.spyOn(HTMLImageElement.prototype, "decode").mockResolvedValue(undefined);

    await exportDeckAsPptx("Soze", [{ id: "slide-1" }], "16:9");

    const [targets] = mocks.exportToPptx.mock.calls[0];
    const [target] = targets as HTMLElement[];
    const exported = target.querySelector<HTMLImageElement>("img");
    expect(exported?.style.width).toBe("192.9px");
    expect(exported?.style.height).toBe("192.1px");
    expect(exported?.src).toContain("Q1JPUA==");
    const [source, sx, sy, sw, sh] = drawImage.mock.calls[0];
    expect(source).toBe(exported);
    expect(sx).toBeCloseTo(1677, 3);
    expect(sy).toBeCloseTo(0, 3);
    expect(sw).toBe(1929);
    expect(sh).toBe(1921);
    expect(Number.parseFloat(exported?.style.left ?? "")).toBeCloseTo(0, 3);
  });
});

describe("pptxExportScale", () => {
  it("matches dom-to-pptx's own fit-to-slide scale for a 16:9 deck", () => {
    const scale = pptxExportScale({
      width: 960,
      height: 540,
      pptxInches: { w: 13.33, h: 7.5 },
    });
    expect(scale).toBeCloseTo(1.3333, 3);
  });

  it("matches dom-to-pptx's own fit-to-slide scale for a 1:1 deck", () => {
    const scale = pptxExportScale({
      width: 1080,
      height: 1080,
      pptxInches: { w: 10, h: 10 },
    });
    expect(scale).toBeCloseTo(0.8889, 3);
  });
});

describe("waitForImagesToSettle", () => {
  it("continues after a remote image exceeds the bounded wait", async () => {
    const realSetTimeout = globalThis.setTimeout.bind(globalThis);
    vi.useFakeTimers();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    setPendingImage();

    const exportPromise = buildDeckPptxBlob(
      "Remote Image Deck",
      [{ id: "slide-1" }],
      "16:9",
    );
    const settled = Promise.race([
      exportPromise.then(() => true),
      new Promise<boolean>((resolve) =>
        realSetTimeout(() => resolve(false), 250),
      ),
    ]);

    await vi.runAllTimersAsync();
    vi.useRealTimers();

    expect(await settled).toBe(true);
    await exportPromise;
    expect(mocks.exportToPptx).toHaveBeenCalledTimes(1);
  });

  it("rechecks completion after attaching load listeners", async () => {
    const realSetTimeout = globalThis.setTimeout.bind(globalThis);
    vi.useFakeTimers();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const image = setPendingImage();
    const nativeAddEventListener = image.addEventListener.bind(image);
    vi.spyOn(image, "addEventListener").mockImplementation(
      (type, listener, options) => {
        nativeAddEventListener(type, listener, options);
        if (type === "load") markImageAsLoaded(image);
      },
    );

    const exportPromise = buildDeckPptxBlob(
      "Race Deck",
      [{ id: "slide-1" }],
      "16:9",
    );
    const settled = Promise.race([
      exportPromise.then(() => true),
      new Promise<boolean>((resolve) =>
        realSetTimeout(() => resolve(false), 250),
      ),
    ]);

    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();

    expect(await settled).toBe(true);
    await exportPromise;
    expect(mocks.exportToPptx).toHaveBeenCalledTimes(1);
  });

  it("warns with the image src when an image fails to load instead of shipping a silent blank shape", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const slideCanvas = setRenderedSlide(
      '<img alt="Broken image" src="/broken-image.png" />',
    );
    const image = slideCanvas.querySelector<HTMLImageElement>("img");
    if (!image) throw new Error("test image missing");
    Object.defineProperties(image, {
      complete: { configurable: true, value: false },
      naturalWidth: { configurable: true, value: 0 },
    });
    const nativeAddEventListener = image.addEventListener.bind(image);
    vi.spyOn(image, "addEventListener").mockImplementation(
      (type, listener, options) => {
        nativeAddEventListener(type, listener, options);
        if (type === "error") {
          Object.defineProperties(image, {
            complete: { configurable: true, value: true },
            naturalWidth: { configurable: true, value: 0 },
          });
          (listener as EventListener)(new Event("error"));
        }
      },
    );

    await exportDeckAsPptx("Broken Image Deck", [{ id: "slide-1" }], "16:9");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("/broken-image.png"),
    );
  });
});

describe("addSpeakerNotesToPptxBlob", () => {
  it("patches speaker notes into the generated PPTX package", async () => {
    const blob = await buildMinimalPptxBlob(1);

    const patched = await addSpeakerNotesToPptxBlob(
      blob,
      [{ id: "slide-1", notes: "Line <one>\nLine two" }],
      { w: 13.33, h: 7.5 },
    );

    const zip = await JSZip.loadAsync(patched);
    const notesXml = await zip
      .file("ppt/notesSlides/notesSlide1.xml")
      ?.async("string");
    const slideRels = await zip
      .file("ppt/slides/_rels/slide1.xml.rels")
      ?.async("string");
    const presentationXml = await zip
      .file("ppt/presentation.xml")
      ?.async("string");

    expect(notesXml).toContain("Line &lt;one&gt;");
    expect(notesXml).toContain("Line two");
    expect(slideRels).toContain("relationships/notesSlide");
    expect(slideRels).toContain("../notesSlides/notesSlide1.xml");
    expect(presentationXml).toContain("<p:notesMasterIdLst>");
    expect(presentationXml).toContain(
      '<p:notesSz cx="6858000" cy="12188952"/>',
    );
  });

  it("sizes the notes page from the deck's actual aspect ratio, not a fixed 16:9 constant", async () => {
    const blob = await buildMinimalPptxBlob(1);

    const patched = await addSpeakerNotesToPptxBlob(
      blob,
      [{ id: "slide-1", notes: "Square deck notes" }],
      { w: 10, h: 10 },
    );

    const zip = await JSZip.loadAsync(patched);
    const presentationXml = await zip
      .file("ppt/presentation.xml")
      ?.async("string");

    expect(presentationXml).toContain('<p:notesSz cx="9144000" cy="9144000"/>');
  });
});

describe("patchBulletIndentsInPptxBlob", () => {
  it("preserves the measured gap between bullet markers and text", async () => {
    const blob = await buildMinimalPptxBlob(1);
    const zip = await JSZip.loadAsync(blob);
    zip.file(
      "ppt/slides/slide1.xml",
      '<p:sld><p:sp><p:txBody><a:p><a:pPr marL="0" indent="0"><a:buChar char="•"/></a:pPr><a:r><a:t>Bullet</a:t></a:r></a:p></p:txBody></p:sp></p:sld>',
    );
    const slideBlob = await zip.generateAsync({ type: "blob" });

    const patched = await patchBulletIndentsInPptxBlob(slideBlob, [[19.8]]);
    const patchedZip = await JSZip.loadAsync(patched);
    const slideXml = await patchedZip
      .file("ppt/slides/slide1.xml")
      ?.async("string");

    expect(slideXml).toContain('marL="251460" indent="-251460"');
  });
});

describe("materializeClipPathShapes", () => {
  function clipped(clipPath: string, inner = "") {
    const element = document.createElement("div");
    element.setAttribute(
      "style",
      `position:absolute;width:192px;height:108px;background-color:rgb(18, 52, 86);clip-path:${clipPath};`,
    );
    element.innerHTML = inner;
    const root = document.createElement("div");
    root.appendChild(element);
    document.body.appendChild(root);
    return root;
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("redraws a freeform clip as a real path, since dom-to-pptx exports the box", () => {
    const root = clipped("path('M0 0 L96 0 L0 54 Z')");

    materializeClipPathShapes(root);

    expect(root.querySelector("div")).toBeNull();
    const svg = root.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 192 108");
    expect(svg?.querySelector("path")?.getAttribute("d")).toBe(
      "M0 0 L96 0 L0 54 Z",
    );
    expect(svg?.querySelector("path")?.getAttribute("fill")).toBe(
      "rgb(18, 52, 86)",
    );
  });

  it("traces a polygon clip through the same path, in the element's pixels", () => {
    const root = clipped("polygon(0% 0%, 100% 0%, 50% 100%)");

    materializeClipPathShapes(root);

    expect(root.querySelector("svg > path")?.getAttribute("d")).toBe(
      "M0 0 L192 0 L96 108 Z",
    );
  });

  it("keeps the freeform's stroke overlay, which 211 of 212 world-map shapes carry", () => {
    const root = clipped(
      "path('M0 0 L96 54 Z')",
      `<svg viewBox="0 0 192 108"><path d="M0 0 L96 54" fill="none" stroke="#ff0000" stroke-width="2" /></svg>`,
    );

    materializeClipPathShapes(root);

    const paths = root.querySelectorAll("svg > path");
    expect(paths).toHaveLength(2);
    expect(paths[0]?.getAttribute("fill")).toBe("rgb(18, 52, 86)");
    expect(paths[1]?.getAttribute("stroke")).toBe("#ff0000");
  });

  it("leaves a clipped container's children as their own exported objects", () => {
    const root = clipped("path('M0 0 L96 54 Z')", "<div>a</div><div>b</div>");

    materializeClipPathShapes(root);

    expect(root.querySelector("svg")).toBeNull();
  });

  it("leaves an unclipped element alone", () => {
    const element = document.createElement("div");
    element.setAttribute(
      "style",
      "width:192px;height:108px;background:#123456;",
    );
    const root = document.createElement("div");
    root.appendChild(element);
    document.body.appendChild(root);

    materializeClipPathShapes(root);

    expect(root.querySelector("svg")).toBeNull();
    expect(root.querySelector("div")).toBe(element);
  });
});

describe("gradientPaint", () => {
  it("fills a gradient shape with a paint server, not the transparent background-color", () => {
    const element = document.createElement("div");
    element.setAttribute(
      "style",
      "position:absolute;width:192px;height:108px;background-image:linear-gradient(315deg, #038DAF 0%, #038DAF 26%, #57308B 62%, #57308B 100%);clip-path:path('M0 0 L96 0 L0 54 Z');",
    );
    const root = document.createElement("div");
    root.appendChild(element);
    document.body.appendChild(root);

    materializeClipPathShapes(root);

    const fill = root.querySelector("svg > path")?.getAttribute("fill");
    expect(fill).toMatch(/^url\(#/);
    const stops = root.querySelectorAll("svg > defs > linearGradient > stop");
    expect(stops).toHaveLength(4);
    expect(stops[0]?.getAttribute("stop-color")).toBe("#038DAF");
    expect(stops[3]?.getAttribute("offset")).toBe("100%");
    document.body.innerHTML = "";
  });

  it("places the gradient line the way CSS measures it", () => {
    const toRight = gradientPaint(
      "linear-gradient(to right, #000000, #ffffff)",
      200,
      100,
      "g",
    );
    expect(toRight?.getAttribute("x1")).toBe("0");
    expect(toRight?.getAttribute("x2")).toBe("200");
    expect(toRight?.getAttribute("y1")).toBe("50");
    expect(toRight?.getAttribute("y2")).toBe("50");

    const implicit = gradientPaint(
      "linear-gradient(rgb(1, 2, 3), rgb(4, 5, 6), rgb(7, 8, 9))",
      200,
      100,
      "g",
    );
    expect(implicit?.getAttribute("y1")).toBe("0");
    expect(implicit?.getAttribute("y2")).toBe("100");
    expect(
      Array.from(implicit?.children ?? []).map((stop) =>
        stop.getAttribute("offset"),
      ),
    ).toEqual(["0%", "50%", "100%"]);
  });

  it("paints canyon slide 13's freeform, which shipped as a blank PNG", () => {
    const element = document.createElement("div");
    element.setAttribute(
      "style",
      "position: absolute; left: 3.631px; top: 133.58px; width: 191.887px; height: 166.037px; transform: rotate(145.47675deg);background: radial-gradient(circle at 0% 0%, #038DAF2d 0%, #038DAF2d 17%, #57308B38 62%, #57308B38 100%);clip-path: path('m143.6 14c-31.1-18.5-79.3-16.9-103-5.4-23.8 11.5-45.5 37.2-39.6 74.4 5.8 37.2 39.5 76.8 57.5 82 18 5.2 36.2-8.6 50.4-50.9 14.1-42.3 76.3 6.2 82.1-10.5 5.8-16.7-16.4-71-47.4-89.6z');",
    );
    const root = document.createElement("div");
    root.appendChild(element);
    document.body.appendChild(root);

    materializeClipPathShapes(root);

    const path = root.querySelector("svg > path");
    const gradient = root.querySelector("svg > defs > radialGradient");
    expect(path?.getAttribute("fill")).toBe(`url(#${gradient?.id})`);
    expect(gradient?.children).toHaveLength(4);
    document.body.innerHTML = "";
  });

  it("sizes a radial to its farthest corner and keeps its stop alpha", () => {
    const gradient = gradientPaint(
      "radial-gradient(circle at 0% 0%, #038DAF2d 0%, #038DAF2d 17%, #57308B38 62%, #57308B38 100%)",
      192,
      166,
      "g",
    );

    expect(gradient?.tagName).toBe("radialGradient");
    expect(gradient?.getAttribute("cx")).toBe("0");
    expect(gradient?.getAttribute("cy")).toBe("0");
    expect(Number(gradient?.getAttribute("r"))).toBeCloseTo(
      Math.hypot(192, 166),
      2,
    );
    const first = gradient?.children[0];
    expect(first?.getAttribute("stop-color")).toBe("#038DAF");
    expect(first?.getAttribute("stop-opacity")).toBe("0.176");
  });

  it("declines a direction it cannot place instead of inventing one", () => {
    for (const value of [
      "linear-gradient(to bottom right, #000000, #ffffff)",
      "linear-gradient(0.25turn, #000000, #ffffff)",
      "radial-gradient(farthest-side at 10px 20px, #000000, #ffffff)",
      "radial-gradient(circle at left top, #000000, #ffffff)",
      "none",
    ]) {
      expect(gradientPaint(value, 200, 100, "g")).toBeUndefined();
    }
  });
});

describe("blank shape rasters", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  function stubRasterizer(alphaPerPixel: number) {
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((
      tag: string,
      ...rest: unknown[]
    ) => {
      const element = realCreateElement(tag, ...(rest as []));
      if (tag === "canvas") {
        const canvas = element as HTMLCanvasElement;
        canvas.getContext = (() => ({
          drawImage: () => {},
          getImageData: () => ({
            data: new Uint8ClampedArray([0, 0, 0, alphaPerPixel]),
          }),
        })) as never;
        canvas.toDataURL = () => "data:image/png;base64,iVBORw0KGgo=";
      }
      return element;
    }) as typeof document.createElement);
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
  }

  function shapeRoot() {
    const root = document.createElement("div");
    root.innerHTML = `<svg width="384" height="332" viewBox="0 0 384 332"><path d="M0 0 L384 0 L0 332 Z" fill="url(#missing)" /></svg>`;
    document.body.appendChild(root);
    return root;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("reports a shape that rasterized to nothing instead of shipping the blank", async () => {
    stubRasterizer(0);
    const root = shapeRoot();

    const blanks = await replaceInlineSvgsWithImages(root, 13);

    expect(blanks).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("slide 13 shape 1 rasterized empty"),
    );
  });

  it("says nothing about a shape that actually painted", async () => {
    stubRasterizer(255);
    const root = shapeRoot();

    const blanks = await replaceInlineSvgsWithImages(root, 13);

    expect(blanks).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("treats an unreadable canvas as unknown, not as a blank render", () => {
    expect(blankRasterResult(undefined)).toBeUndefined();
    expect(blankRasterResult(new Uint8ClampedArray())).toBeUndefined();
    expect(blankRasterResult(new Uint8ClampedArray([0, 0, 0, 0]))).toBe(true);
    expect(blankRasterResult(new Uint8ClampedArray([255, 255, 255, 255]))).toBe(
      false,
    );
  });
});

describe("pinTextBoxesForImport", () => {
  it("replaces every wrap=none with wrap=square", () => {
    const xml = pinTextBoxesInXml(
      '<a:bodyPr wrap="none" lIns="0" rtlCol="0" anchor="t"><a:spAutoFit/></a:bodyPr>' +
        '<a:bodyPr wrap="none" lIns="0"/>',
    );
    expect(xml).not.toContain('wrap="none"');
    expect(xml.match(/wrap="square"/g)).toHaveLength(2);
  });

  it("turns autofit off so the receiving app cannot re-grow the measured box", () => {
    const xml = pinTextBoxesInXml("<a:bodyPr><a:spAutoFit/></a:bodyPr>");
    expect(xml).toContain("<a:noAutofit/>");
    expect(xml).not.toContain("spAutoFit");
  });

  it("leaves a body that already wraps alone", () => {
    const original = '<a:bodyPr wrap="square" lIns="0"/>';
    expect(pinTextBoxesInXml(original)).toBe(original);
  });

  it("does not corrupt a wrap attribute belonging to some other element", () => {
    const xml = pinTextBoxesInXml('<a:other wrap="none"/>');
    expect(xml).toBe('<a:other wrap="none"/>');
  });
});

describe("usedFontFamilies", () => {
  it("orders families by how much text each one sets, so the theme font is the deck's own", () => {
    const root = document.createElement("div");
    root.innerHTML =
      `<p style="font-family: Geist">${"a".repeat(200)}</p>` +
      `<p style="font-family: Poppins">short</p>`;
    document.body.appendChild(root);

    expect(usedFontFamilies([root])[0]).toBe("Geist");
    root.remove();
  });

  it("reports the first family of each text element's stack", () => {
    const root = document.createElement("div");
    root.innerHTML =
      `<h1 style="font-family: 'Geist', Inter, sans-serif">Title</h1>` +
      `<p style="font-family: 'Geist Mono', monospace">01</p>`;
    document.body.appendChild(root);

    const families = usedFontFamilies([root]);
    expect(families).toContain("Geist");
    expect(families).toContain("Geist Mono");
    root.remove();
  });

  it("does not let a <style> block's CSS outweigh the deck's visible text", () => {
    const root = document.createElement("div");
    root.innerHTML =
      `<style style="font-family: Poppins">${"/*x*/".repeat(400)}</style>` +
      `<p style="font-family: Geist">visible copy</p>`;
    document.body.appendChild(root);

    expect(usedFontFamilies([root])[0]).toBe("Geist");
    root.remove();
  });

  it("skips generic families, which name no font to embed", () => {
    const root = document.createElement("div");
    root.innerHTML = `<p style="font-family: monospace">code</p>`;
    document.body.appendChild(root);

    expect(usedFontFamilies([root])).not.toContain("monospace");
    root.remove();
  });

  it("ignores elements with no text to paint", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div style="font-family: Nothing"></div>`;
    document.body.appendChild(root);

    expect(usedFontFamilies([root])).not.toContain("Nothing");
    root.remove();
  });
});

describe("retypeThemeFonts", () => {
  it("points the theme's major and minor latin faces at the deck's family", () => {
    const xml = retypeThemeFonts(
      '<a:majorFont><a:latin typeface="Calibri Light" panose="020F0302"/></a:majorFont>' +
        '<a:minorFont><a:latin typeface="Calibri" panose="020F0502"/></a:minorFont>',
      "Geist",
    );
    expect(xml).not.toContain("Calibri");
    expect(xml.match(/typeface="Geist"/g)).toHaveLength(2);
    expect(xml).toContain('panose="020F0302"');
  });

  it("escapes a family name that would otherwise break the attribute", () => {
    const xml = retypeThemeFonts(
      '<a:minorFont><a:latin typeface="Calibri"/></a:minorFont>',
      'Ampersand & "Quote"',
    );
    expect(xml).toContain('typeface="Ampersand &amp; &quot;Quote&quot;"');
  });

  it("leaves east-asian and complex-script faces alone", () => {
    const original = '<a:minorFont><a:ea typeface="MS Gothic"/></a:minorFont>';
    expect(retypeThemeFonts(original, "Geist")).toBe(original);
  });
});

describe("pinRenderedFontFamilies", () => {
  it("is a no-op in happy-dom, where the canvas probe cannot distinguish fonts", () => {
    const root = document.createElement("div");
    root.innerHTML = '<p style="font-family: sans-serif;">Some text</p>';
    document.body.appendChild(root);
    const paragraph = root.querySelector("p")!;

    expect(() => pinRenderedFontFamilies(root, "google-slides")).not.toThrow();

    expect(paragraph.style.fontFamily).toBe("sans-serif");
    root.remove();
  });
});

describe("markWrappedLines", () => {
  it("inserts a wrap mark immediately before the text that starts a new line", () => {
    document.body.innerHTML = "<div><p>alpha beta gamma</p></div>";
    const root = document.querySelector<HTMLElement>("div")!;
    vi.spyOn(Range.prototype, "getClientRects").mockImplementation(
      function (this: Range) {
        const top = this.startOffset < 11 ? 0 : 24;
        return [
          { bottom: top + 20, height: 20, top, width: 8 },
        ] as unknown as DOMRectList;
      },
    );

    const count = markWrappedLines(root);

    expect(count).toBe(1);
    expect(root.querySelector("p")?.textContent).toBe(
      `alpha beta ${WRAP_MARK}gamma`,
    );
  });

  it("does not mark a line that starts after an explicit <br>", () => {
    document.body.innerHTML = "<div><p>alpha<br>beta</p></div>";
    const root = document.querySelector<HTMLElement>("div")!;
    vi.spyOn(Range.prototype, "getClientRects").mockImplementation(
      function (this: Range) {
        const top = (this.startContainer as Text).data === "beta" ? 24 : 0;
        return [
          { bottom: top + 20, height: 20, top, width: 8 },
        ] as unknown as DOMRectList;
      },
    );

    const count = markWrappedLines(root);

    expect(count).toBe(0);
    expect(root.querySelector("p")?.textContent).toBe("alphabeta");
  });

  it("skips text inside an aria-hidden subtree even when it looks wrapped", () => {
    document.body.innerHTML =
      '<div><p aria-hidden="true">alpha beta gamma</p></div>';
    const root = document.querySelector<HTMLElement>("div")!;
    vi.spyOn(Range.prototype, "getClientRects").mockImplementation(
      function (this: Range) {
        const top = this.startOffset < 11 ? 0 : 24;
        return [
          { bottom: top + 20, height: 20, top, width: 8 },
        ] as unknown as DOMRectList;
      },
    );

    const count = markWrappedLines(root);

    expect(count).toBe(0);
    expect(root.querySelector("p")?.textContent).toBe("alpha beta gamma");
  });

  it("marks a wrap after a tall inline run whose glyphs reach below the next line's centres", () => {
    document.body.innerHTML = "<div><p>BIG small next</p></div>";
    const root = document.querySelector<HTMLElement>("div")!;
    vi.spyOn(Range.prototype, "getClientRects").mockImplementation(
      function (this: Range) {
        const offset = this.startOffset;
        const rect =
          offset < 3
            ? { top: 0, height: 60, left: offset * 30 }
            : offset < 10
              ? { top: 44, height: 12, left: 60 + offset * 8 }
              : { top: 50, height: 12, left: (offset - 10) * 8 };
        return [
          { ...rect, bottom: rect.top + rect.height, width: 8 },
        ] as unknown as DOMRectList;
      },
    );

    const count = markWrappedLines(root);

    expect(count).toBe(1);
    expect(root.querySelector("p")?.textContent).toBe(
      `BIG small ${WRAP_MARK}next`,
    );
  });

  it("marks a wrap after a tall inline run in right-to-left text, where the next line starts on the right", () => {
    document.body.innerHTML =
      '<div><p style="direction: rtl">BIG small next</p></div>';
    const root = document.querySelector<HTMLElement>("div")!;
    vi.spyOn(Range.prototype, "getClientRects").mockImplementation(
      function (this: Range) {
        const offset = this.startOffset;
        const rect =
          offset < 3
            ? { top: 0, height: 60, left: 400 - offset * 30 }
            : offset < 10
              ? { top: 44, height: 12, left: 300 - offset * 8 }
              : { top: 50, height: 12, left: 400 - (offset - 10) * 8 };
        return [
          {
            ...rect,
            bottom: rect.top + rect.height,
            right: rect.left + 8,
            width: 8,
          },
        ] as unknown as DOMRectList;
      },
    );

    const count = markWrappedLines(root);

    expect(count).toBe(1);
    expect(root.querySelector("p")?.textContent).toBe(
      `BIG small ${WRAP_MARK}next`,
    );
  });
});

describe("widenInPlace", () => {
  it.each([
    ["ltr", "start", "10px", "-10px"],
    ["ltr", "end", "-10px", "10px"],
    ["rtl", "start", "-10px", "10px"],
    ["rtl", "end", "10px", "-10px"],
  ])(
    "keeps the aligned edge fixed for %s text aligned to %s",
    (direction, textAlign, marginLeft, marginRight) => {
      document.body.innerHTML = `<p style="direction: ${direction}; text-align: ${textAlign}; margin-left: 10px; margin-right: 10px">Label</p>`;
      const element = document.querySelector<HTMLElement>("p")!;
      vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
        width: 100,
      } as DOMRect);

      widenInPlace(element, 120);

      expect(element.style.marginLeft).toBe(marginLeft);
      expect(element.style.marginRight).toBe(marginRight);
    },
  );

  it("moves a box back to its aligned edge when pinning its margins shifts it, as a grid item's auto margins do", () => {
    document.body.innerHTML =
      '<p style="text-align: left; margin-left: 0px; margin-right: 0px">Label</p>';
    const element = document.querySelector<HTMLElement>("p")!;
    vi.spyOn(element, "getBoundingClientRect")
      .mockReturnValueOnce({ left: 170, width: 60 } as DOMRect)
      .mockReturnValueOnce({ left: 0, width: 80 } as DOMRect);

    widenInPlace(element, 80);

    expect(element.style.marginLeft).toBe("170px");
    expect(element.style.marginRight).toBe("-190px");
  });
});

describe("materializeCompositeBorders", () => {
  const barsOf = (element: HTMLElement) =>
    Array.from(element.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.style.position === "absolute",
    );

  it("redraws a one-sided rule as a box and moves its width into the padding", () => {
    document.body.innerHTML =
      '<div><p style="padding-bottom: 12px; border-bottom-width: 1px; border-bottom-style: solid; border-bottom-color: rgb(255, 0, 0)">Row</p></div>';
    const root = document.querySelector<HTMLElement>("div")!;
    const row = root.querySelector<HTMLElement>("p")!;

    materializeCompositeBorders(root);

    expect(row.style.getPropertyValue("border-bottom-width")).toMatch(
      /^0(px)?$/,
    );
    expect(row.style.getPropertyValue("padding-bottom")).toBe("13px");
    const [bar] = barsOf(row);
    expect(bar.style.height).toBe("1px");
    expect(bar.style.backgroundColor).toBe("rgb(255, 0, 0)");
    expect(bar.style.getPropertyValue("bottom")).toMatch(/^0(px)?$/);
  });

  it("leaves a uniform border alone, which already exports as a line", () => {
    document.body.innerHTML =
      '<div><p style="border-top-width: 1px; border-right-width: 1px; border-bottom-width: 1px; border-left-width: 1px; border-top-style: solid; border-right-style: solid; border-bottom-style: solid; border-left-style: solid; border-top-color: rgb(0, 0, 255); border-right-color: rgb(0, 0, 255); border-bottom-color: rgb(0, 0, 255); border-left-color: rgb(0, 0, 255)">Card</p></div>';
    const root = document.querySelector<HTMLElement>("div")!;
    const card = root.querySelector<HTMLElement>("p")!;

    materializeCompositeBorders(root);

    expect(barsOf(card)).toHaveLength(0);
    expect(card.style.getPropertyValue("border-bottom-width")).toBe("1px");
  });

  it("leaves a dashed rule alone rather than redrawing it solid", () => {
    document.body.innerHTML =
      '<div><p style="border-bottom-width: 1px; border-bottom-style: dashed; border-bottom-color: rgb(255, 0, 0)">Row</p></div>';
    const root = document.querySelector<HTMLElement>("div")!;
    const row = root.querySelector<HTMLElement>("p")!;

    materializeCompositeBorders(root);

    expect(barsOf(row)).toHaveLength(0);
    expect(row.style.getPropertyValue("border-bottom-width")).toBe("1px");
  });

  it("leaves a rounded box alone, whose corners a straight bar cannot follow", () => {
    document.body.innerHTML =
      '<div><p style="border-bottom-width: 1px; border-bottom-style: solid; border-bottom-color: rgb(255, 0, 0); border-top-left-radius: 8px">Card</p></div>';
    const root = document.querySelector<HTMLElement>("div")!;
    const card = root.querySelector<HTMLElement>("p")!;

    materializeCompositeBorders(root);

    expect(barsOf(card)).toHaveLength(0);
    expect(card.style.getPropertyValue("border-bottom-width")).toBe("1px");
  });

  it("leaves adjacent sides that differ alone, since CSS mitres that corner", () => {
    document.body.innerHTML =
      '<div><p style="border-top-width: 2px; border-top-style: solid; border-top-color: rgb(255, 0, 0); border-left-width: 1px; border-left-style: solid; border-left-color: rgb(0, 0, 255)">Card</p></div>';
    const root = document.querySelector<HTMLElement>("div")!;
    const card = root.querySelector<HTMLElement>("p")!;

    materializeCompositeBorders(root);

    expect(barsOf(card)).toHaveLength(0);
    expect(card.style.getPropertyValue("border-top-width")).toBe("2px");
  });

  it("leaves a box holding positioned children alone, since their anchors follow its padding box", () => {
    document.body.innerHTML =
      '<div><p style="position: relative; border-bottom-width: 1px; border-bottom-style: solid; border-bottom-color: rgb(255, 0, 0)"><span style="position: absolute; right: 0px">Pinned</span></p></div>';
    const root = document.querySelector<HTMLElement>("div")!;
    const row = root.querySelector<HTMLElement>("p")!;

    materializeCompositeBorders(root);

    expect(row.style.getPropertyValue("border-bottom-width")).toBe("1px");
    expect(row.querySelector("div")).toBeNull();
  });

  it("redraws a rule on the export root, which its own query does not return", () => {
    document.body.innerHTML =
      '<div style="position: relative; border-top-width: 2px; border-top-style: solid; border-top-color: rgb(0, 255, 0)"><p>Slide</p></div>';
    const root = document.querySelector<HTMLElement>("div")!;

    materializeCompositeBorders(root);

    expect(root.style.getPropertyValue("border-top-width")).toMatch(/^0(px)?$/);
    expect(root.style.getPropertyValue("padding-top")).toBe("2px");
    const [bar] = barsOf(root);
    expect(bar.style.height).toBe("2px");
    expect(bar.style.backgroundColor).toBe("rgb(0, 255, 0)");
  });
});
