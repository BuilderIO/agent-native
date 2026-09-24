/**
 * A background behind a screenshot: the picture sits on a gradient or a flat
 * colour, with a margin, rounded corners and a soft shadow — Loom's "Add a
 * background". It is painted into the copy viewers are served; the stored
 * base stays the bare screenshot, so it can be changed or removed later.
 *
 * Colours here are painted into an image file, which has no theme to follow.
 */

export type ScreenshotBackground =
  | { kind: "gradient"; id: string }
  | { kind: "solid"; color: string };

export interface BackgroundGradient {
  id: string;
  /** Top-left to bottom-right. */
  stops: readonly string[];
  /** A soft glow laid over the gradient, which is what keeps it from looking flat. */
  glow: string;
}

// guard:allow-raw-color — painted into the image, not styling.
export const BACKGROUND_GRADIENTS: readonly BackgroundGradient[] = [
  { id: "indigo", stops: ["#5b5ef0", "#6b4fd8", "#9b4a8f"], glow: "rgba(120, 130, 255, 0.55)" },
  { id: "peach", stops: ["#f7d9a6", "#f39a73", "#e06a6a"], glow: "rgba(255, 230, 200, 0.6)" },
  { id: "sunset", stops: ["#6c5ce7", "#f08a5d", "#f6c453"], glow: "rgba(255, 170, 90, 0.55)" },
  { id: "forest", stops: ["#5aa38c", "#2f6d6a", "#2b2f7a"], glow: "rgba(150, 210, 180, 0.45)" },
  { id: "plum", stops: ["#c0507a", "#8e44ad", "#4b3fa8"], glow: "rgba(230, 110, 160, 0.4)" },
  { id: "citrus", stops: ["#f07a52", "#f5c04a", "#8d82f0"], glow: "rgba(255, 210, 110, 0.5)" },
  { id: "sky", stops: ["#3a6fe0", "#9ad2e0", "#b8b8f0"], glow: "rgba(200, 235, 245, 0.55)" },
  { id: "lagoon", stops: ["#3f8f6e", "#3a78b0", "#8fc7c0"], glow: "rgba(160, 220, 210, 0.45)" },
  { id: "night", stops: ["#2b2f86", "#4a3aa8", "#8a4c8c"], glow: "rgba(110, 90, 220, 0.45)" },
];

// guard:allow-raw-color — painted into the image, not styling.
export const BACKGROUND_COLORS: readonly string[] = [
  "#3b82f6",
  "#3a97b8",
  "#6a9a3a",
  "#b08a2e",
  "#c0579c",
  "#c0443a",
  "#d9702e",
  "#7b8496",
  "#111111",
  "#ffffff",
];

/** Read a background back from `editsJson`, or null for none or nonsense. */
export function parseBackground(raw: unknown): ScreenshotBackground | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === "gradient" && typeof r.id === "string") {
    return BACKGROUND_GRADIENTS.some((g) => g.id === r.id)
      ? { kind: "gradient", id: r.id }
      : null;
  }
  if (
    r.kind === "solid" &&
    typeof r.color === "string" &&
    /^#[0-9a-f]{6}$/i.test(r.color)
  ) {
    return { kind: "solid", color: r.color };
  }
  return null;
}

/** The margin around the picture, in its own pixels. */
export function backgroundPadding(size: { width: number; height: number }): number {
  return Math.round(Math.max(size.width, size.height) * 0.06);
}

/** A CSS rendering of a background, for the picker's tiles. */
export function backgroundCss(background: ScreenshotBackground): string {
  if (background.kind === "solid") return background.color;
  const gradient =
    BACKGROUND_GRADIENTS.find((g) => g.id === background.id) ??
    BACKGROUND_GRADIENTS[0];
  return `radial-gradient(circle at 30% 25%, ${gradient.glow}, transparent 55%), linear-gradient(135deg, ${gradient.stops.join(", ")})`;
}

/**
 * The picture on its background: a bigger canvas with the gradient or colour,
 * and the picture in the middle with rounded corners and a shadow.
 */
export function composeOnBackground(
  picture: HTMLCanvasElement,
  background: ScreenshotBackground,
): HTMLCanvasElement {
  const pad = backgroundPadding(picture);
  const canvas = document.createElement("canvas");
  canvas.width = picture.width + pad * 2;
  canvas.height = picture.height + pad * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not edit the image.");

  if (background.kind === "solid") {
    ctx.fillStyle = background.color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    const gradient =
      BACKGROUND_GRADIENTS.find((g) => g.id === background.id) ??
      BACKGROUND_GRADIENTS[0];
    const linear = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.stops.forEach((stop, index) =>
      linear.addColorStop(index / Math.max(1, gradient.stops.length - 1), stop),
    );
    ctx.fillStyle = linear;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const radius = Math.max(canvas.width, canvas.height) * 0.55;
    const glow = ctx.createRadialGradient(
      canvas.width * 0.3,
      canvas.height * 0.25,
      0,
      canvas.width * 0.3,
      canvas.height * 0.25,
      radius,
    );
    glow.addColorStop(0, gradient.glow);
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const corner = Math.round(pad * 0.2);
  const shape = new Path2D();
  shape.roundRect(pad, pad, picture.width, picture.height, corner);

  ctx.save();
  ctx.shadowColor = "rgba(15, 23, 42, 0.35)";
  ctx.shadowBlur = pad * 0.6;
  ctx.shadowOffsetY = pad * 0.15;
  ctx.fillStyle = "#ffffff";
  ctx.fill(shape);
  ctx.restore();

  ctx.save();
  ctx.clip(shape);
  ctx.drawImage(picture, pad, pad);
  ctx.restore();
  return canvas;
}
