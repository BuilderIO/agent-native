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
  buildDeckPptxBlob,
  exportDeckAsPptx,
  materializeClipPathShapes,
  patchBulletIndentsInPptxBlob,
  pptxExportScale,
} from "./export-pptx-client";

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

/** `setRenderedSlide` wraps its argument in an <h1>; imported-slide markup needs to sit directly on the canvas. */
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

/**
 * happy-dom has no layout, so every getBoundingClientRect is 0x0 and the
 * geometry passes under test never see an element. Give the fixture a fake
 * layout: `data-test-rect="x,y,w,h"`, read identically on the source DOM and
 * on the export clone (which is a deep copy, i.e. already in place).
 */
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
      autoEmbedFonts: true,
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
    // dom-to-pptx extracts one text run per inline node and trims each one
    // under a collapsing white-space mode, so the space that only exists at
    // the boundary between two <span> runs ("IMAGE " + "COMPOSITION") is the
    // thing that disappears. `pre` stops wrapping without collapsing.
    // Measured on creative-circus slide 8: exported runs were
    // ["IMAGE","COMPOSITION"], now ["IMAGE ","COMPOSITION"].
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
    // Markup that never preserved whitespace keeps the plain no-wrap flag.
    expect(target.querySelector<HTMLElement>("h1")?.style.whiteSpace).toBe(
      "nowrap",
    );
  });

  it("does not re-anchor a cropped image to slide coordinates inside its own positioned wrapper", async () => {
    // A cropped imported image is position:absolute inside the equally
    // absolute .fmd-pptx-image wrapper. Writing the slide-space left/top onto
    // it added the wrapper's offset a second time: superteam slide 32 tiles
    // measured at x=313.8/406.1 exported at 627.6/812.1, off the canvas.
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
    // infog1 slide 5: each ring-segment arrow is a 405.164px square at
    // rotate(-137.6deg), whose axis-aligned bounding box measures 572.4px.
    // getBoundingClientRect reports that box, and the rotation is carried onto
    // the <img>, so measuring it here applied the angle twice and shipped the
    // arrows 1.41x oversized — one of them over the slide title.
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
    // ...and the angle stays out of the bitmap it is applied to. Serializing
    // it into the standalone SVG rotated the drawing inside its own viewport
    // instead: measured on that arrow, 0 painted pixels of 16,313.
    expect(decodeURIComponent(exported?.src ?? "")).not.toContain("rotate(");
  });

  it("bakes an overflow-hidden crop into the exported bitmap", async () => {
    // soze slide 2: a PPTX srcRect crop is a 521.6x347.6px <img> hanging out
    // of a 192.9x192.1px overflow-hidden wrapper. dom-to-pptx exports the
    // image's own box and never sees the clip, so the portrait shipped at
    // 2.7x, covering the body text.
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
    // The export clone carries its own <img>, so the decoded state has to be
    // on the prototype rather than on the source element.
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
    // Source window in natural pixels: the wrapper starts 167.7px into the
    // image, at 10 natural px per CSS px.
    const [source, sx, sy, sw, sh] = drawImage.mock.calls[0];
    expect(source).toBe(exported);
    expect(sx).toBeCloseTo(1677, 3);
    expect(sy).toBeCloseTo(0, 3);
    expect(sw).toBe(1929);
    expect(sh).toBe(1921);
    // ...and the shrunk image lands on the wrapper it used to overflow.
    expect(Number.parseFloat(exported?.style.left ?? "")).toBeCloseTo(0, 3);
  });
});

describe("pptxExportScale", () => {
  it("matches dom-to-pptx's own fit-to-slide scale for a 16:9 deck", () => {
    // 960x540 px canvas into a 13.33x7.5in slide: dom-to-pptx's own
    // `processSlide` computes this same ~1.333 factor and applies it to
    // every measurement it takes, including bullet indents.
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

describe("pptxExportScale", () => {
  it("matches dom-to-pptx's own fit-to-slide scale for a 16:9 deck", () => {
    // 960x540 px canvas into a 13.33x7.5in slide: dom-to-pptx's own
    // `processSlide` computes this same ~1.333 factor and applies it to
    // every measurement it takes, including bullet indents.
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
          // The browser marks `complete = true` even after a failed load.
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
    // 16:9 (13.33x7.5in) slide -> portrait notes page, cx/cy swapped.
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

    // The clipped div is replaced, not wrapped: leaving it behind ships the
    // rectangle underneath the silhouette.
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
