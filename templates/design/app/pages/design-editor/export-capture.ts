/**
 * Editor-chrome overlays that editor-chrome.bridge.ts appends inside the preview
 * iframe (the selection outline + resize handles, hover highlight, marquee,
 * spacing/measurement guides, and badges). They live in the iframe DOM, so image
 * exports must strip them from the clone — otherwise a download captures the
 * editor's selection outline instead of just the design. Keep this in sync with
 * the data-agent-native-* markers set in editor-chrome.bridge.ts.
 */
export const EDITOR_CHROME_OVERLAY_SELECTOR = [
  "[data-agent-native-edit-overlay]",
  "[data-agent-native-edit-handle]",
  "[data-agent-native-edge-handle]",
  "[data-agent-native-rotate-handle]",
  "[data-agent-native-transform-badge]",
  "[data-agent-native-spacing-badge]",
  "[data-agent-native-spacing-overlay]",
  "[data-agent-native-spacing-line]",
  "[data-agent-native-spacing-region]",
  "[data-agent-native-insertion-guide]",
  "[data-agent-native-measurement-overlay]",
  "[data-agent-native-editor-chrome-style]",
].join(",");

export interface ExportCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function buildStaticForeignObjectSvg(args: {
  documentWidth: number;
  documentHeight: number;
  cropRect?: ExportCropRect | null;
  scale: number;
  safeTitle: string;
  serializedHtml: string;
}): string {
  const viewX = args.cropRect?.x ?? 0;
  const viewY = args.cropRect?.y ?? 0;
  const viewWidth = args.cropRect?.width ?? args.documentWidth;
  const viewHeight = args.cropRect?.height ?? args.documentHeight;
  // Keep the foreignObject in full-document coordinates. A non-zero viewBox
  // then clips the selected region without rebasing the DOM and breaking its
  // absolute/sticky/ancestor layout. The foreignObject must cover that viewBox.
  const foreignWidth = Math.max(args.documentWidth, viewX + viewWidth);
  const foreignHeight = Math.max(args.documentHeight, viewY + viewHeight);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${viewWidth * args.scale}" height="${viewHeight * args.scale}" viewBox="${viewX} ${viewY} ${viewWidth} ${viewHeight}" role="img" aria-label="${args.safeTitle}">
  <title>${args.safeTitle}</title>
  <foreignObject x="0" y="0" width="${foreignWidth}" height="${foreignHeight}">
${args.serializedHtml}
  </foreignObject>
</svg>`;
}

const MAX_EXPORT_SCALE = 4;
const MAX_EXPORT_CANVAS_SIDE = 16_384;
const MAX_EXPORT_CANVAS_PIXELS = 64 * 1024 * 1024;

/**
 * A PDF page is rasterized once, then stretched to fill an exact physical
 * page size (see `createSinglePageRasterPdf`). Unlike a PNG/JPG/WEBP export
 * — where "1x" means "one raster pixel per CSS pixel" and is a reasonable
 * default for on-screen use — a 1x capture embedded at a fixed physical page
 * size (US Letter, A4, ad unit dimensions treated as inches) is only ~96
 * DPI, which reads as visibly blurry once printed or zoomed in a PDF viewer.
 * Enforce a print-quality floor for the PDF export path specifically,
 * regardless of the export panel's general-purpose default scale (1x).
 * Still respects an explicit higher user-selected scale (3x/4x).
 */
export const PDF_MIN_PRINT_RASTER_SCALE = 2;

/**
 * Resolve a crisp raster scale without asking the browser to allocate a canvas
 * it cannot reliably encode. The quick Share -> PNG path has no visible scale
 * picker, so use 2x there even on a 1x desktop display; explicit inspector
 * export settings still win. Large artboards are reduced only as much as
 * required by conservative cross-browser canvas limits.
 */
export function resolveRasterExportScale(args: {
  width: number;
  height: number;
  requestedScale?: number | null;
  devicePixelRatio?: number | null;
}): number {
  const width = Math.max(1, Number.isFinite(args.width) ? args.width : 1);
  const height = Math.max(1, Number.isFinite(args.height) ? args.height : 1);
  const requested =
    args.requestedScale ?? Math.max(2, args.devicePixelRatio ?? 1);
  const normalized = Math.max(
    0.1,
    Math.min(MAX_EXPORT_SCALE, Number.isFinite(requested) ? requested : 2),
  );
  const sideLimit = Math.min(
    MAX_EXPORT_CANVAS_SIDE / width,
    MAX_EXPORT_CANVAS_SIDE / height,
  );
  const areaLimit = Math.sqrt(
    MAX_EXPORT_CANVAS_PIXELS / Math.max(1, width * height),
  );
  // Do not clamp back up to 0.1 after applying the safety limits: a gigantic
  // imported canvas can require a smaller scale to stay within the same hard
  // side/pixel budget. The one-pixel floor only prevents a zero-size canvas.
  const bounded = Math.min(normalized, sideLimit, areaLimit);
  return Math.max(1 / Math.max(width, height), bounded);
}

/**
 * Runtime HTML frameworks allow attribute syntaxes (`@click`, `:class`,
 * `x-bind:class`) which are legal in HTML but not legal XML QNames. A static
 * foreignObject snapshot has already resolved those directives and removes
 * scripts, so retaining the executable attributes adds no visual information
 * and can make the entire SVG unparsable. Remove framework directives plus any
 * other unbound/invalid XML attribute name from the CLONE only.
 */
export function stripNonStaticXmlAttributes(root: Element): void {
  root
    .querySelectorAll(
      "script,iframe,object,embed,base,meta[http-equiv],foreignObject,animate,set",
    )
    .forEach((element) => element.remove());
  const elements = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name;
      const frameworkDirective =
        name.startsWith("@") ||
        name.startsWith(":") ||
        /^x-(?:data|init|show|cloak|if|for|transition|on|bind|model|text|html|ref|teleport|id|effect|ignore)(?:$|[.:])/i.test(
          name,
        );
      const standardNamespaceAttribute =
        /^(?:xmlns:xlink|xlink:href|xml:lang|xml:space)$/i.test(name);
      const xmlSafeName =
        standardNamespaceAttribute || /^[A-Za-z_][A-Za-z0-9._-]*$/.test(name);
      const inlineHandler = /^on/i.test(name);
      const urlAttribute =
        /^(?:href|src|action|formaction|poster|xlink:href)$/i.test(name);
      const value = attribute.value.trim();
      const activeUrl =
        urlAttribute &&
        (/^(?:javascript|vbscript):/i.test(value) ||
          (/^data:/i.test(value) &&
            !/^data:image\/(?:png|jpeg|webp|gif|avif);base64,/i.test(value)));
      const activeStyle =
        name.toLowerCase() === "style" &&
        /(?:javascript|vbscript|data\s*:\s*text\/html)/i.test(value);
      if (
        frameworkDirective ||
        !xmlSafeName ||
        inlineHandler ||
        activeUrl ||
        activeStyle
      ) {
        element.removeAttribute(name);
      }
    }
  }
}

/**
 * Wait for a preview document to actually look like the design before it is
 * rasterized/serialized for export (PNG, SVG, PDF, Copy as PNG all funnel
 * through this). Generated screens load Tailwind/Alpine from a CDN and
 * Google Fonts via `<link>` — right after the iframe's `srcdoc` is set (a
 * fresh generation, a screen switch, or just a fast click), there is a real
 * window where the document has rendered with ZERO applied CSS: no
 * utility classes, no @font-face, plain browser defaults. A capture taken in
 * that window produces exactly the field-reported "low quality / broken
 * layout" PNG — not a rendering-fidelity issue, a readiness race. See
 * `export-capture.readiness.spec.ts`.
 *
 * Two bounded waits, in order:
 *  1. `document.fonts.ready` — resolves once every requested font has
 *     finished loading (or failed), so text uses its real family/metrics
 *     instead of a fallback that reflows the layout after capture.
 *  2. Stylesheet-rule-count stabilization — `fonts.ready` only tracks fonts
 *     that have already been *requested* by active CSS; a CDN stylesheet
 *     that hasn't been injected yet hasn't requested anything. Poll the
 *     total CSSOM rule count across `document.styleSheets` until it holds
 *     steady for several consecutive animation frames AND a minimum settle
 *     time has passed. Tailwind's CDN JIT runtime compiles utility rules
 *     incrementally in more than one pass, so the rule count can plateau
 *     briefly between waves; a too-short stability check fires during one of
 *     those false plateaus and lets a capture through with layout-critical
 *     rules (flex/grid/absolute positioning) still missing even though
 *     color/text rules already landed — a subtler, worse bug than doing
 *     nothing, since some styling shows up so nothing looks obviously broken
 *     at a glance. The settle floor is skipped entirely for a document with
 *     no async style source (no `<link rel=stylesheet>`, no `<script src>`,
 *     no CDN Tailwind `<style type="text/tailwindcss">`), since a plain
 *     inline-only document cannot gain more CSS later.
 *
 * Both waits are bounded by `timeoutMs` so a design with an intentionally
 * empty stylesheet, a blocked font host, or a slow network never hangs an
 * export indefinitely — worst case, export proceeds with whatever rendered.
 */
export async function waitForExportReady(
  doc: Document,
  options?: { timeoutMs?: number },
): Promise<void> {
  const view = doc.defaultView;
  if (!view) return;
  const timeoutMs = options?.timeoutMs ?? 4000;
  const MIN_STABLE_FRAMES = 6;
  // A plain document with no async style source cannot gain CSS later. Avoid
  // imposing the CDN-oriented settle floor on every simple export while
  // retaining it for Tailwind/script/stylesheet-backed previews.
  const minSettleMs = doc.querySelector(
    'link[rel~="stylesheet"],script[src],style[type="text/tailwindcss"]',
  )
    ? 600
    : 0;
  const start =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const now = () =>
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const remaining = () => Math.max(0, timeoutMs - (now() - start));

  try {
    const fontsReady = doc.fonts?.ready;
    if (fontsReady) {
      await Promise.race([
        fontsReady,
        new Promise<void>((resolve) => view.setTimeout(resolve, remaining())),
      ]);
    }
  } catch {
    // Font loading can reject (network failure); proceed with fallback fonts
    // rather than block the export.
  }

  const ruleCount = (): number => {
    let total = 0;
    for (const sheet of Array.from(doc.styleSheets)) {
      try {
        total += sheet.cssRules?.length ?? 0;
      } catch {
        // Cross-origin stylesheets throw on cssRules access; their mere
        // presence in styleSheets still counts as "loaded".
        total += 1;
      }
    }
    return total;
  };

  let lastCount = -1;
  let stableFrames = 0;
  while (
    remaining() > 0 &&
    (stableFrames < MIN_STABLE_FRAMES || now() - start < minSettleMs)
  ) {
    const current = ruleCount();
    stableFrames = current === lastCount ? stableFrames + 1 : 0;
    lastCount = current;
    await new Promise<void>((resolve) => {
      const raf = view.requestAnimationFrame;
      if (typeof raf === "function") raf.call(view, () => resolve());
      else view.setTimeout(resolve, 16);
    });
  }
}

/** Build a real, fixed-artboard PDF rather than returning export instructions. */
export async function createSinglePageRasterPdf(args: {
  dataUrl: string;
  width: number;
  height: number;
}): Promise<Blob> {
  const width = Math.max(1, args.width);
  const height = Math.max(1, args.height);
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({
    orientation: width > height ? "landscape" : "portrait",
    unit: "px",
    format: [width, height],
    compress: true,
    hotfixes: ["px_scaling"],
  });
  pdf.addImage(args.dataUrl, "PNG", 0, 0, width, height, undefined, "FAST");
  return pdf.output("blob");
}

export interface RasterPdfPage {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Build a multi-page PDF, one page per rasterized screen, each sized to its
 * own artboard dimensions (a US Letter one-pager and a 1080x1080 social
 * screen can coexist as separate pages, each at its own physical size).
 * Reuses the same `px_scaling` hotfix as `createSinglePageRasterPdf` so every
 * page's physical size matches its authored pixel dimensions exactly.
 */
export async function createMultiPageRasterPdf(
  pages: readonly RasterPdfPage[],
): Promise<Blob> {
  if (pages.length === 0) {
    throw new Error("createMultiPageRasterPdf requires at least one page");
  }
  const { jsPDF } = await import("jspdf");
  const dims = pages.map((page) => ({
    width: Math.max(1, page.width),
    height: Math.max(1, page.height),
  }));
  const pdf = new jsPDF({
    orientation: dims[0].width > dims[0].height ? "landscape" : "portrait",
    unit: "px",
    format: [dims[0].width, dims[0].height],
    compress: true,
    hotfixes: ["px_scaling"],
  });
  pages.forEach((page, index) => {
    const { width, height } = dims[index];
    if (index > 0) {
      pdf.addPage([width, height], width > height ? "landscape" : "portrait");
    }
    pdf.addImage(page.dataUrl, "PNG", 0, 0, width, height, undefined, "FAST");
  });
  return pdf.output("blob");
}

/** Return the smallest document-space rectangle containing every valid item. */
export function unionExportCropRects(
  rects: readonly ExportCropRect[],
): ExportCropRect | null {
  const valid = rects.filter(
    (rect) =>
      Number.isFinite(rect.x) &&
      Number.isFinite(rect.y) &&
      Number.isFinite(rect.width) &&
      Number.isFinite(rect.height) &&
      rect.width > 0 &&
      rect.height > 0,
  );
  if (valid.length === 0) return null;
  const left = Math.min(...valid.map((rect) => rect.x));
  const top = Math.min(...valid.map((rect) => rect.y));
  const right = Math.max(...valid.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...valid.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export interface ExportCompositeFrame extends ExportCropRect {
  rotation?: number;
}

/**
 * Resolve the world-space bounds of selected screen frames, including rotation,
 * so a multi-frame clipboard image preserves the same spacing as the canvas.
 */
export function getExportCompositeBounds(
  frames: readonly ExportCompositeFrame[],
): ExportCropRect | null {
  return unionExportCropRects(
    frames.flatMap((frame) => {
      if (frame.width <= 0 || frame.height <= 0) return [];
      const radians = ((frame.rotation ?? 0) * Math.PI) / 180;
      if (radians === 0) return [frame];
      const centerX = frame.x + frame.width / 2;
      const centerY = frame.y + frame.height / 2;
      const cosine = Math.cos(radians);
      const sine = Math.sin(radians);
      const corners = [
        [-frame.width / 2, -frame.height / 2],
        [frame.width / 2, -frame.height / 2],
        [frame.width / 2, frame.height / 2],
        [-frame.width / 2, frame.height / 2],
      ].map(([x, y]) => ({
        x: centerX + x * cosine - y * sine,
        y: centerY + x * sine + y * cosine,
      }));
      const left = Math.min(...corners.map((corner) => corner.x));
      const top = Math.min(...corners.map((corner) => corner.y));
      const right = Math.max(...corners.map((corner) => corner.x));
      const bottom = Math.max(...corners.map((corner) => corner.y));
      return [{ x: left, y: top, width: right - left, height: bottom - top }];
    }),
  );
}

/**
 * Map a document-space rect onto pixel coordinates within a rendered canvas of
 * the given size, clamped to stay inside the canvas. `scale` must match the
 * scale passed to html2canvas. Returns null when the crop would be empty or
 * lands fully outside the canvas, so callers can fall back to the full render.
 */
export function computeExportCropBox(
  sourceWidth: number,
  sourceHeight: number,
  rect: { x: number; y: number; width: number; height: number },
  scale: number,
): { sx: number; sy: number; sw: number; sh: number } | null {
  const sx = Math.max(0, Math.round(rect.x * scale));
  const sy = Math.max(0, Math.round(rect.y * scale));
  const right = Math.min(
    sourceWidth,
    Math.round((rect.x + rect.width) * scale),
  );
  const bottom = Math.min(
    sourceHeight,
    Math.round((rect.y + rect.height) * scale),
  );
  const sw = right - sx;
  const sh = bottom - sy;
  if (sw <= 0 || sh <= 0) return null;
  return { sx, sy, sw, sh };
}
