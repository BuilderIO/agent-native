import { z } from "zod";

/** The largest picture a capture hands over, before base64. */
export const DESIGN_SCREEN_CAPTURE_MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** The widths a screen can be captured at, as Design's exports allow. */
export const DESIGN_SCREEN_CAPTURE_MIN_WIDTH = 200;
export const DESIGN_SCREEN_CAPTURE_MAX_WIDTH = 3840;

const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._-]+$/, "Use the id from the screen's copied link.");

const httpUrlSchema = z
  .string()
  .max(4096)
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
    );
  }, "Expected an http(s) URL.");

const visibilitySchema = z.enum(["private", "org", "public"]);

const fingerprintSchema = z.string().regex(/^[a-f0-9]{12}$/);

const widthSchema = z
  .number()
  .int()
  .min(DESIGN_SCREEN_CAPTURE_MIN_WIDTH)
  .max(DESIGN_SCREEN_CAPTURE_MAX_WIDTH);

export const designScreenCaptureRequestSchema = z.object({
  designId: idSchema.describe("Design id, from the screen's copied link."),
  screenId: idSchema.describe(
    "Screen id, the `screen` parameter of the screen's copied link.",
  ),
  width: widthSchema
    .optional()
    .describe(
      "Width in pixels to render the screen at. Omit for the screen's own frame width.",
    ),
});
export type DesignScreenCaptureRequest = z.infer<
  typeof designScreenCaptureRequestSchema
>;

/** The design and screen a picture shows, as both apps keep them. */
export const designScreenSourceSchema = z.object({
  design: z.object({
    id: idSchema,
    title: z.string().max(300),
    url: httpUrlSchema,
    visibility: visibilitySchema,
  }),
  screen: z.object({
    id: idSchema,
    name: z.string().max(300),
    width: widthSchema,
    fingerprint: fingerprintSchema,
    url: httpUrlSchema,
  }),
});
export type DesignScreenSource = z.infer<typeof designScreenSourceSchema>;

export const designScreenCaptureSchema = designScreenSourceSchema.extend({
  openComments: z.number().int().min(0),
  image: z.object({
    mimeType: z.literal("image/png"),
    data: z
      .string()
      .min(1)
      .max(Math.ceil(DESIGN_SCREEN_CAPTURE_MAX_IMAGE_BYTES / 3) * 4),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
  }),
  capturedAt: z.string().datetime(),
});
export type DesignScreenCapture = z.infer<typeof designScreenCaptureSchema>;

export const designScreenStatusRequestSchema = z.object({
  designId: idSchema.describe("Design id."),
  screenIds: z
    .array(idSchema)
    .max(50)
    .default([])
    .describe("Screens to report on; empty for the design's sharing only."),
});
export type DesignScreenStatusRequest = z.infer<
  typeof designScreenStatusRequestSchema
>;

export const designScreenStatusSchema = z.object({
  design: z.object({
    id: idSchema,
    title: z.string().max(300),
    visibility: visibilitySchema,
  }),
  screens: z
    .array(
      z.object({
        id: idSchema,
        fingerprint: fingerprintSchema.nullable(),
        openComments: z.number().int().min(0),
      }),
    )
    .max(50),
});
export type DesignScreenStatus = z.infer<typeof designScreenStatusSchema>;

/** What a pasted Design link names: one screen, or the whole board. */
export type DesignScreenLink =
  | { kind: "screen"; designId: string; screenId: string }
  | { kind: "board"; designId: string };

/**
 * Reads a screen's copied link (Copy link on a screen in Design):
 * `<design>/design/<id>?screen=<screenId>`. A link with no screen names the
 * whole board. Returns null for anything else. `origins` are the Design
 * origins this deployment trusts; the link may carry an app base path such
 * as `/design`.
 */
export function parseDesignScreenLink(
  value: string,
  origins: readonly string[],
): DesignScreenLink | null {
  const text = value.trim();
  if (!text || /\s/.test(text) || !URL.canParse(text)) return null;
  const url = new URL(text);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const trusted = origins.some((origin) => {
    if (!URL.canParse(origin)) return false;
    return new URL(origin).origin === url.origin;
  });
  if (!trusted) return null;
  const match = /(?:^|\/)design\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) return null;
  const [, rawDesignId = ""] = match;
  let designId: string;
  try {
    designId = decodeURIComponent(rawDesignId);
    // coercion-ok: a malformed escape isn't a screen link, and null is this parser's "not a screen link"
  } catch {
    return null;
  }
  if (!idSchema.safeParse(designId).success) return null;
  const screenId = url.searchParams.get("screen");
  if (screenId === null || screenId === "") {
    return { kind: "board", designId };
  }
  const parsed = designScreenCaptureRequestSchema.safeParse({
    designId,
    screenId,
  });
  return parsed.success
    ? {
        kind: "screen",
        designId: parsed.data.designId,
        screenId: parsed.data.screenId,
      }
    : null;
}

/** The link that opens one screen of a design in Design. */
export function designScreenUrl(
  appUrl: string,
  designId: string,
  screenId: string,
): string {
  const url = new URL(
    `${appUrl.replace(/\/+$/, "")}/design/${encodeURIComponent(designId)}`,
  );
  url.searchParams.set("screen", screenId);
  return url.toString();
}
