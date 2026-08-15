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
  document.body.innerHTML = `<div data-slide-canvas="slide-1" style="width: 960px; height: 540px;"><h1>${html}</h1></div>`;
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
