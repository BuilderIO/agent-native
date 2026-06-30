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
  exportDeckAsPptx,
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

  it("passes custom aspect-ratio dimensions to the native exporter", async () => {
    await exportDeckAsPptx("Square Deck", [{ id: "slide-1" }], "1:1");

    const [, options] = mocks.exportToPptx.mock.calls[0];
    expect(options).toMatchObject({
      height: 10,
      width: 10,
    });
  });
});

describe("addSpeakerNotesToPptxBlob", () => {
  it("patches speaker notes into the generated PPTX package", async () => {
    const blob = await buildMinimalPptxBlob(1);

    const patched = await addSpeakerNotesToPptxBlob(blob, [
      { id: "slide-1", notes: "Line <one>\nLine two" },
    ]);

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
    expect(presentationXml).toContain("<p:notesSz");
  });
});
