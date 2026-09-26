/**
 * A background behind a screenshot: the picture sits on a gradient or a flat
 * colour, with a margin, rounded corners and a soft shadow — Loom's "Add a
 * background". It is painted into the copy viewers are served; the stored
 * base stays the bare screenshot, so it can be changed or removed later.
 *
 * The colours are painted into an image file, which has no theme to follow,
 * so they live in `tokens/screenshot-colors.ts`.
 */

import {
  BACKGROUND_CARD_FILL,
  BACKGROUND_CARD_SHADOW,
  BACKGROUND_GRADIENTS,
  GLOW_FADE,
} from "./tokens/screenshot-colors";

export type ScreenshotBackground =
  | { kind: "gradient"; id: string }
  | { kind: "solid"; color: string };

export {
  BACKGROUND_COLORS,
  BACKGROUND_GRADIENTS,
  type BackgroundGradient,
} from "./tokens/screenshot-colors";

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
export function backgroundPadding(size: {
  width: number;
  height: number;
}): number {
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
    glow.addColorStop(1, GLOW_FADE);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const corner = Math.round(pad * 0.2);
  const shape = new Path2D();
  shape.roundRect(pad, pad, picture.width, picture.height, corner);

  ctx.save();
  ctx.shadowColor = BACKGROUND_CARD_SHADOW;
  ctx.shadowBlur = pad * 0.6;
  ctx.shadowOffsetY = pad * 0.15;
  ctx.fillStyle = BACKGROUND_CARD_FILL;
  ctx.fill(shape);
  ctx.restore();

  ctx.save();
  ctx.clip(shape);
  ctx.drawImage(picture, pad, pad);
  ctx.restore();
  return canvas;
}
