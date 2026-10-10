import { NativeHybridVectorError } from "./native-hybrid-vector";
import { validateEncodedPngViewport } from "./native-raster-encoding";

type PdfStandardFont = "helvetica" | "times" | "courier";

function standardPdfFont(family: string): PdfStandardFont {
  for (const raw of family.split(",")) {
    const name = raw
      .trim()
      .replace(/^['"]|['"]$/g, "")
      .toLowerCase();
    if (["helvetica", "arial", "sans-serif", "system-ui"].includes(name))
      return "helvetica";
    if (["times", "times new roman", "georgia", "serif"].includes(name))
      return "times";
    if (["courier", "courier new", "monospace"].includes(name))
      return "courier";
  }
  throw new NativeHybridVectorError(
    "vector-unsupported",
    "The vector PDF cannot preserve a font without an available standard fallback.",
  );
}

function normalizePdfTextFonts(root: Element): void {
  for (const text of root.querySelectorAll("text")) {
    const family = text.getAttribute("font-family");
    if (!family) continue;
    const standard = standardPdfFont(family);
    text.setAttribute("font-family", standard);
    const authoredWeight = text.getAttribute("font-weight") ?? "400";
    const numericWeight = Number(authoredWeight);
    const bold =
      authoredWeight === "bold" ||
      (Number.isFinite(numericWeight) && numericWeight >= 600);
    text.setAttribute("font-weight", bold ? "bold" : "normal");
    const spacing = Number(text.getAttribute("letter-spacing"));
    const size = Number(text.getAttribute("font-size"));
    const content = text.textContent ?? "";
    if (
      Number.isFinite(spacing) &&
      spacing !== 0 &&
      Number.isFinite(size) &&
      size > 0 &&
      content.length > 1 &&
      text.children.length <= 1
    ) {
      const context = globalThis.document
        .createElement("canvas")
        .getContext("2d");
      if (!context)
        throw new NativeHybridVectorError(
          "vector-unsupported",
          "The vector PDF cannot measure tracked text in this browser.",
        );
      context.font = `${bold ? "bold" : "normal"} ${size}px ${standard}`;
      const measuredWidth = context.measureText(content).width;
      if (!Number.isFinite(measuredWidth) || measuredWidth <= 0)
        throw new NativeHybridVectorError(
          "vector-unsupported",
          "The vector PDF cannot measure tracked text in this browser.",
        );
      const targetWidth = measuredWidth + spacing * (content.length - 1);
      if (targetWidth > 0) text.setAttribute("textLength", String(targetWidth));
    }
  }
}

function unsupportedImageError(): NativeHybridVectorError {
  return new NativeHybridVectorError(
    "vector-unsupported",
    "The vector PDF contains an image that is not embedded locally.",
  );
}

function rejectUnsupportedImage(): never {
  throw unsupportedImageError();
}

function validateStaticEmbeddedSvg(bytes: Uint8Array): void {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    rejectUnsupportedImage();
  }
  if (/<!(?:DOCTYPE|ENTITY)\b|<\?/i.test(source)) rejectUnsupportedImage();
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (
    document.documentElement.localName !== "svg" ||
    document.documentElement.namespaceURI !== "http://www.w3.org/2000/svg" ||
    document.querySelector("parsererror")
  )
    rejectUnsupportedImage();
  for (const element of [
    document.documentElement,
    ...document.querySelectorAll("*"),
  ]) {
    if (
      /^(?:script|foreignObject|iframe|object|embed|a|style|animate|animateMotion|animateTransform|set)$/i.test(
        element.localName,
      )
    )
      rejectUnsupportedImage();
    for (const attr of Array.from(element.attributes)) {
      if (/^on/i.test(attr.name) || /javascript:|@import/i.test(attr.value))
        rejectUnsupportedImage();
      const withoutLocalUrls = attr.value.replace(
        /url\(\s*(['"]?)(#[A-Za-z_][\w.:-]*)\1\s*\)/gi,
        "",
      );
      if (/url\s*\(/i.test(withoutLocalUrls)) rejectUnsupportedImage();
      if (
        /^(?:href|xlink:href)$/i.test(attr.name) &&
        !/^#[A-Za-z_][\w.:-]*$/.test(attr.value)
      )
        rejectUnsupportedImage();
    }
  }
}

function decodedEmbeddedImage(href: string): Uint8Array {
  const match =
    /^data:(image\/(?:svg\+xml|jpeg|webp|avif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      href,
    );
  if (!match || match[2]!.length % 4 !== 0 || match[2]!.length > 22_000_000)
    rejectUnsupportedImage();
  let binary: string;
  try {
    binary = atob(match[2]!);
  } catch {
    rejectUnsupportedImage();
  }
  if (btoa(binary) !== match[2]) rejectUnsupportedImage();
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength < 24 || bytes.byteLength > 16 * 1024 * 1024)
    rejectUnsupportedImage();
  if (match[1] === "image/svg+xml") validateStaticEmbeddedSvg(bytes);
  return bytes;
}

function waitForLocalImage(
  href: string,
  signal: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const timeout = setTimeout(
      () => finish(false, unsupportedImageError()),
      15_000,
    );
    const onAbort = () => finish(false, signal.reason);
    function finish(ready: boolean, reason?: unknown) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      image.onload = null;
      image.onerror = null;
      if (ready) resolve(image);
      else {
        image.src = "";
        reject(reason);
      }
    }
    image.onload = () => finish(true);
    image.onerror = () => finish(false, unsupportedImageError());
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) finish(false, signal.reason);
    else image.src = href;
  });
}

function pngDataUrl(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32_768)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
    return `data:image/png;base64,${btoa(binary)}`;
  });
}

async function pdfCompatibleImage(
  href: string,
  signal: AbortSignal,
): Promise<string> {
  decodedEmbeddedImage(href);
  const image = await waitForLocalImage(href, signal);
  const { naturalWidth: width, naturalHeight: height } = image;
  if (
    width < 1 ||
    height < 1 ||
    width > 4096 ||
    height > 4096 ||
    width * height > 8_300_000
  )
    rejectUnsupportedImage();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) rejectUnsupportedImage();
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(
      () => finish(false, unsupportedImageError()),
      15_000,
    );
    const onAbort = () => finish(false, signal.reason);
    function finish(ready: boolean, reason?: unknown, result?: Blob | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      if (!ready) reject(reason);
      else if (result) resolve(result);
      else reject(unsupportedImageError());
    }
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) finish(false, signal.reason);
    else
      canvas.toBlob((result) => finish(true, undefined, result), "image/png");
  });
  await validateEncodedPngViewport(blob, { width, height });
  if (signal.aborted) throw signal.reason;
  return pngDataUrl(blob);
}

export async function renderNativeHybridPdf(args: {
  svg: string;
  width: number;
  height: number;
  signal: AbortSignal;
}): Promise<Blob> {
  if (
    !Number.isFinite(args.width) ||
    !Number.isFinite(args.height) ||
    args.width <= 0 ||
    args.height <= 0 ||
    args.width > 4096 ||
    args.height > 4096 ||
    args.width * args.height > 8_388_608
  )
    throw new NativeHybridVectorError(
      "vector-unsupported",
      "The vector PDF viewport exceeds the export limits.",
    );
  if (args.signal.aborted) throw args.signal.reason;
  const document = new DOMParser().parseFromString(args.svg, "image/svg+xml");
  const root = document.documentElement;
  if (
    root.localName !== "svg" ||
    root.namespaceURI !== "http://www.w3.org/2000/svg" ||
    document.getElementsByTagName("parsererror").length
  )
    throw new NativeHybridVectorError(
      "svg-invalid",
      "The hybrid SVG cannot be converted to a PDF.",
    );
  const converted = new Map<string, string>();
  for (const image of document.querySelectorAll("image")) {
    const href = image.getAttribute("href") ?? "";
    if (/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(href)) continue;
    const cached = converted.get(href);
    const png = cached ?? (await pdfCompatibleImage(href, args.signal));
    converted.set(href, png);
    image.setAttribute("href", png);
  }
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([
    import("jspdf"),
    import("svg2pdf.js/dist/svg2pdf.es.js"),
  ]);
  if (args.signal.aborted) throw args.signal.reason;
  const pdf = new jsPDF({
    orientation: args.width >= args.height ? "landscape" : "portrait",
    unit: "pt",
    format: [args.width, args.height],
    compress: false,
  });
  normalizePdfTextFonts(root);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => rejectWaiting(args.signal.reason);
  let rejectWaiting: (reason: unknown) => void = () => {};
  try {
    await Promise.race([
      svg2pdf(root, pdf, {
        x: 0,
        y: 0,
        width: args.width,
        height: args.height,
        loadImages: /^data:image\/png;base64,/,
        loadExternalStyleSheets: false,
      }),
      new Promise<never>((_resolve, reject) => {
        rejectWaiting = reject;
        args.signal.addEventListener("abort", onAbort, { once: true });
        timeout = setTimeout(
          () =>
            reject(
              new NativeHybridVectorError(
                "vector-unsupported",
                "Vector PDF conversion timed out.",
              ),
            ),
          45_000,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    args.signal.removeEventListener("abort", onAbort);
  }
  if (args.signal.aborted) throw args.signal.reason;
  const blob = pdf.output("blob");
  const header = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  if (
    blob.type !== "application/pdf" ||
    blob.size < 100 ||
    blob.size > 32_000_000 ||
    String.fromCharCode(...header) !== "%PDF-"
  )
    throw new NativeHybridVectorError(
      "vector-unsupported",
      "The browser did not produce a valid vector PDF.",
    );
  return blob;
}
