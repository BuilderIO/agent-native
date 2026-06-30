import { type AspectRatio, getAspectRatioDims } from "./aspect-ratios";
import {
  findSlideExportSource,
  preloadImagesWithCors,
} from "./export-pdf-client";

interface PptxExportSlide {
  id: string;
  notes?: string;
}

function safePptxName(title: string) {
  const safeName = title.replace(/[^a-zA-Z0-9]/g, "-") || "deck";
  return `${safeName}.pptx`;
}

function stripDataUrlPrefix(dataUrl: string) {
  return dataUrl.replace(/^data:/, "");
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function exportDeckAsPptx(
  deckTitle: string,
  slides: PptxExportSlide[],
  aspectRatio?: AspectRatio,
): Promise<void> {
  const [{ domToJpeg }, PptxGenModule] = await Promise.all([
    import("modern-screenshot"),
    import("pptxgenjs"),
  ]);

  if (typeof document !== "undefined" && document.fonts?.ready) {
    await document.fonts.ready;
  }

  const dims = getAspectRatioDims(aspectRatio);
  const PptxGenJS = PptxGenModule.default;
  const pptx = new PptxGenJS();

  if (
    Math.abs(dims.pptxInches.w - 13.33) < 0.01 &&
    Math.abs(dims.pptxInches.h - 7.5) < 0.01
  ) {
    pptx.layout = "LAYOUT_WIDE";
  } else {
    pptx.defineLayout({
      name: "AGENT_NATIVE_EXPORT",
      width: dims.pptxInches.w,
      height: dims.pptxInches.h,
    });
    pptx.layout = "AGENT_NATIVE_EXPORT";
  }

  pptx.author = "Agent Native Slides";
  pptx.title = deckTitle;

  for (let i = 0; i < slides.length; i++) {
    const exportSlide = slides[i];
    const source = findSlideExportSource(exportSlide.id, i, slides.length);

    await preloadImagesWithCors(source);

    const dataUrl = await domToJpeg(source, {
      width: dims.width,
      height: dims.height,
      scale: 2,
      backgroundColor: "#000000",
      quality: 0.92,
      fetch: {
        requestInit: { cache: "no-cache", mode: "cors", credentials: "omit" },
      },
    });

    const slide = pptx.addSlide();
    slide.background = { color: "000000" };
    slide.addImage({
      data: stripDataUrlPrefix(dataUrl),
      x: 0,
      y: 0,
      w: dims.pptxInches.w,
      h: dims.pptxInches.h,
    });

    if (exportSlide.notes) {
      slide.addNotes(exportSlide.notes);
    }
  }

  const blob = (await pptx.write({
    outputType: "blob",
    compression: true,
  })) as Blob;
  triggerBlobDownload(blob, safePptxName(deckTitle));
}
