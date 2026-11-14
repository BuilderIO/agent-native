function bodyFontFamily(body: HTMLElement | null): string {
  return body ? getComputedStyle(body).fontFamily : "sans-serif";
}

const measuredTextWidths = new Map<string, number>();
let measurementCanvas: HTMLCanvasElement | null = null;
let measurementDocument: Document | undefined;

export function fitAxisLabelToWidth(
  label: string,
  maxWidth: number,
  measureText: (text: string) => number,
): string {
  if (
    !Number.isFinite(maxWidth) ||
    maxWidth <= 0 ||
    measureText(label) <= maxWidth
  ) {
    return label;
  }

  const suffix = "…";
  if (measureText(suffix) > maxWidth) return "";

  const characters = Array.from(label);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = `${characters.slice(0, middle).join("")}${suffix}`;
    if (measureText(candidate) <= maxWidth) low = middle;
    else high = middle - 1;
  }

  return `${characters.slice(0, low).join("")}${suffix}`;
}

export function fitAxisLabelToPixelWidth(
  label: string,
  maxWidth: number | undefined,
  fontSize: number,
): string {
  if (maxWidth === undefined || !Number.isFinite(maxWidth) || maxWidth <= 0) {
    return label;
  }
  if (typeof document === "undefined") return label;

  if (measurementDocument !== document) {
    measurementDocument = document;
    measurementCanvas = null;
    measuredTextWidths.clear();
  }
  measurementCanvas ??= document.createElement("canvas");
  const context = measurementCanvas.getContext("2d");
  if (!context) return label;

  const fontFamily = bodyFontFamily(document.body);
  context.font = `${fontSize}px ${fontFamily || "sans-serif"}`;
  const font = context.font;
  const measureText = (text: string) => {
    const key = `${font}\u0000${text}`;
    const cachedWidth = measuredTextWidths.get(key);
    if (cachedWidth !== undefined) return cachedWidth;

    const width = context.measureText(text).width;
    if (measuredTextWidths.size >= 4096) measuredTextWidths.clear();
    measuredTextWidths.set(key, width);
    return width;
  };

  return fitAxisLabelToWidth(label, maxWidth, measureText);
}
