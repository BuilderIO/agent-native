import { z } from "zod";

export const BUILTIN_SLIDE_DESIGN_FONTS = [
  "Arial",
  "Courier New",
  "Georgia",
  "Helvetica",
  "system-ui",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
] as const;

export const SLIDE_FONT_VARIANT_PATTERN =
  /^(?:regular|italic|(?:100|200|300|400|500|600|700|800|900)(?:italic)?)$/;

export function isSafeSlideFontFamily(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(value)
  );
}

export function isBuiltinSlideDesignFont(
  value: string,
): value is (typeof BUILTIN_SLIDE_DESIGN_FONTS)[number] {
  return (BUILTIN_SLIDE_DESIGN_FONTS as readonly string[]).includes(value);
}

export const slideDesignTokensSchema = z.object({
  background: z.string().regex(/^#[0-9a-f]{6}$/i),
  text: z.string().regex(/^#[0-9a-f]{6}$/i),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i),
  displayFont: z
    .string()
    .max(80)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/),
  displayFontAssetId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,200}$/)
    .optional(),
  bodyFont: z
    .string()
    .max(80)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/),
  bodyFontAssetId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,200}$/)
    .optional(),
  heroScale: z.number().min(0.5).max(2),
  bodyScale: z.number().min(0.5).max(2),
  radius: z.number().min(0).max(48),
});

export type SlideDesignTokens = z.infer<typeof slideDesignTokensSchema>;

export type SlideFontAsset = {
  assetId: string;
  family: string;
  variant: string;
  mimeType: string;
  url: string;
};

export const DEFAULT_SLIDE_DESIGN_TOKENS: SlideDesignTokens = {
  background: "#ffffff",
  text: "#111827",
  accent: "#2563eb",
  displayFont: "Arial",
  bodyFont: "Arial",
  heroScale: 1,
  bodyScale: 1,
  radius: 12,
};

export function readSlideDesignTokens(
  data: Record<string, unknown>,
): SlideDesignTokens {
  if (!Object.hasOwn(data, "designTokens")) {
    return { ...DEFAULT_SLIDE_DESIGN_TOKENS };
  }
  const parsed = slideDesignTokensSchema.safeParse(data.designTokens);
  if (!parsed.success) {
    throw Object.assign(new Error("Deck design tokens are invalid."), {
      statusCode: 409,
      errorCode: "invalid_deck_design_tokens",
      details: parsed.error.flatten(),
    });
  }
  return parsed.data;
}
