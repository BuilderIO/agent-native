import { z } from "zod";

export const MAX_CUSTOM_CSS_BYTES = 20 * 1024;

export const THEME_PRESETS = ["light", "dark"] as const;

/** Open fonts only. `Inter` ships with the app; the rest load from Google Fonts. */
export const THEME_FONTS = [
  "Inter",
  "Roboto",
  "Open Sans",
  "DM Sans",
  "Lora",
  "Merriweather",
  "Playfair Display",
  "Source Code Pro",
] as const;

/** `#rrggbb`, or `#rrggbbaa` for translucent borders and fills. */
export const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);

/** Uploaded-asset URL: absolute http(s) or app-relative, with nothing that could leave a CSS `url("...")`. */
export const assetUrlSchema = z
  .string()
  .max(2048)
  .regex(/^(?:https?:\/\/|\/(?!\/))[^\s"'()\\<>]+$/);

export const WIDTH_MODES = ["fixed", "full"] as const;
export const BUTTON_WIDTH_MODES = ["auto", "full", "fixed"] as const;
export const BUTTON_ALIGNS = ["left", "center", "right"] as const;
export const BACKGROUND_SIZES = ["cover", "contain"] as const;
export const BACKGROUND_ATTACHMENTS = ["fixed", "scroll"] as const;

const pixels = (min: number, max: number) =>
  z.number().int().min(min).max(max).optional();

export const formThemeSchema = z.object({
  preset: z.enum(THEME_PRESETS).optional(),
  font: z.enum(THEME_FONTS).optional(),
  background: hexColorSchema.optional(),
  text: hexColorSchema.optional(),
  buttonBackground: hexColorSchema.optional(),
  buttonText: hexColorSchema.optional(),
  accent: hexColorSchema.optional(),
  pageWidth: z.number().int().min(320).max(1200).optional(),
  baseFontSize: z.number().int().min(12).max(24).optional(),
  buttonRadius: z.number().int().min(0).max(50).optional(),
  fieldRadius: z.number().int().min(0).max(50).optional(),
  logoUrl: assetUrlSchema.optional(),
  logoWidth: pixels(16, 400),
  logoHeight: pixels(16, 400),
  logoRadius: pixels(0, 200),
  coverUrl: assetUrlSchema.optional(),
  /** Percent of the viewport height. */
  coverHeight: pixels(5, 100),
  backgroundImageUrl: assetUrlSchema.optional(),
  backgroundImageSize: z.enum(BACKGROUND_SIZES).optional(),
  backgroundImageAttachment: z.enum(BACKGROUND_ATTACHMENTS).optional(),
  inputWidthMode: z.enum(WIDTH_MODES).optional(),
  inputWidth: pixels(80, 1200),
  inputHeight: pixels(24, 120),
  inputBackground: hexColorSchema.optional(),
  inputPlaceholder: hexColorSchema.optional(),
  inputBorderColor: hexColorSchema.optional(),
  inputBorderWidth: pixels(0, 8),
  inputMarginBottom: pixels(0, 100),
  inputPaddingX: pixels(0, 60),
  buttonWidthMode: z.enum(BUTTON_WIDTH_MODES).optional(),
  buttonWidth: pixels(40, 1200),
  buttonHeight: pixels(24, 120),
  buttonAlign: z.enum(BUTTON_ALIGNS).optional(),
  buttonFontSize: pixels(10, 40),
  buttonMarginY: pixels(0, 100),
  buttonPaddingX: pixels(0, 80),
});
export type FormTheme = z.infer<typeof formThemeSchema>;

export const customCssSchema = z
  .string()
  .refine(
    (css) => new TextEncoder().encode(css).length <= MAX_CUSTOM_CSS_BYTES,
  );

export type ResolvedTheme = {
  preset: (typeof THEME_PRESETS)[number];
  font: (typeof THEME_FONTS)[number];
  background: string;
  text: string;
  buttonBackground: string;
  buttonText: string;
  accent: string;
  pageWidth: number;
  baseFontSize: number;
  buttonRadius: number;
  fieldRadius: number;
  logoUrl: string | undefined;
  logoWidth: number;
  logoHeight: number;
  logoRadius: number;
  coverUrl: string | undefined;
  coverHeight: number;
  backgroundImageUrl: string | undefined;
  backgroundImageSize: (typeof BACKGROUND_SIZES)[number];
  backgroundImageAttachment: (typeof BACKGROUND_ATTACHMENTS)[number];
  inputWidthMode: (typeof WIDTH_MODES)[number];
  inputWidth: number;
  inputHeight: number;
  inputBackground: string;
  inputPlaceholder: string;
  inputBorderColor: string;
  inputBorderWidth: number;
  inputMarginBottom: number;
  inputPaddingX: number;
  buttonWidthMode: (typeof BUTTON_WIDTH_MODES)[number];
  buttonWidth: number;
  buttonHeight: number;
  buttonAlign: (typeof BUTTON_ALIGNS)[number];
  buttonFontSize: number;
  buttonMarginY: number;
  buttonPaddingX: number;
};

const PRESET_COLORS = {
  light: {
    background: "#ffffff",
    text: "#37352f",
    buttonBackground: "#000000",
    buttonText: "#ffffff",
    accent: "#0070d7",
    inputBackground: "#ffffff",
    inputPlaceholder: "#bbbab8",
    inputBorderColor: "#3d3b3529",
  },
  dark: {
    background: "#121212",
    text: "#ececec",
    buttonBackground: "#ffffff",
    buttonText: "#000000",
    accent: "#4da3ff",
    inputBackground: "#1c1c1c",
    inputPlaceholder: "#6b6b6b",
    inputBorderColor: "#ffffff29",
  },
} as const;

export function resolveTheme(theme: FormTheme | undefined): ResolvedTheme {
  const preset = theme?.preset ?? "light";
  const colors = PRESET_COLORS[preset];
  return {
    preset,
    font: theme?.font ?? "Inter",
    background: theme?.background ?? colors.background,
    text: theme?.text ?? colors.text,
    buttonBackground: theme?.buttonBackground ?? colors.buttonBackground,
    buttonText: theme?.buttonText ?? colors.buttonText,
    accent: theme?.accent ?? colors.accent,
    pageWidth: theme?.pageWidth ?? 700,
    baseFontSize: theme?.baseFontSize ?? 16,
    buttonRadius: theme?.buttonRadius ?? 8,
    fieldRadius: theme?.fieldRadius ?? 8,
    logoUrl: theme?.logoUrl,
    logoWidth: theme?.logoWidth ?? 100,
    logoHeight: theme?.logoHeight ?? 100,
    logoRadius: theme?.logoRadius ?? 50,
    coverUrl: theme?.coverUrl,
    coverHeight: theme?.coverHeight ?? 25,
    backgroundImageUrl: theme?.backgroundImageUrl,
    backgroundImageSize: theme?.backgroundImageSize ?? "cover",
    backgroundImageAttachment: theme?.backgroundImageAttachment ?? "fixed",
    inputWidthMode: theme?.inputWidthMode ?? "fixed",
    inputWidth: theme?.inputWidth ?? 320,
    inputHeight: theme?.inputHeight ?? 36,
    inputBackground: theme?.inputBackground ?? colors.inputBackground,
    inputPlaceholder: theme?.inputPlaceholder ?? colors.inputPlaceholder,
    inputBorderColor: theme?.inputBorderColor ?? colors.inputBorderColor,
    inputBorderWidth: theme?.inputBorderWidth ?? 1,
    inputMarginBottom: theme?.inputMarginBottom ?? 10,
    inputPaddingX: theme?.inputPaddingX ?? 10,
    buttonWidthMode: theme?.buttonWidthMode ?? "auto",
    buttonWidth: theme?.buttonWidth ?? 120,
    buttonHeight: theme?.buttonHeight ?? 36,
    buttonAlign: theme?.buttonAlign ?? "left",
    buttonFontSize: theme?.buttonFontSize ?? 16,
    buttonMarginY: theme?.buttonMarginY ?? 10,
    buttonPaddingX: theme?.buttonPaddingX ?? 14,
  };
}

/** Accepts `#abc`, `abc`, `#aabbcc`, `#aabbccdd`; returns lowercase full hex or null. */
export function normalizeHex(input: string): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(input.trim());
  if (!match?.[1]) return null;
  const digits = match[1].toLowerCase();
  const full =
    digits.length === 3
      ? [...digits].map((digit) => digit + digit).join("")
      : digits;
  return `#${full}`;
}

/** `H S% L%` for the app's `hsl(var(--token))` colour tokens. */
export function hexToHslTriplet(hex: string): string {
  const red = parseInt(hex.slice(1, 3), 16) / 255;
  const green = parseInt(hex.slice(3, 5), 16) / 255;
  const blue = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  let hue = 0;
  let saturation = 0;
  if (delta > 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (max === red) hue = ((green - blue) / delta + 6) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
  }
  return `${Math.round(hue * 60)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`;
}

/**
 * Makes custom CSS safe to put inside a `<style>` element and inside one
 * wrapping rule: drops every `<` (no `</style`), and balances braces so the
 * text cannot close the wrapper and style the page outside it.
 */
export function sanitizeCss(css: string): string {
  const text = css.replace(/[<\0]/g, "");
  let out = "";
  let depth = 0;
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(index, stop);
      index = stop;
      continue;
    }
    if (char === '"' || char === "'") {
      let stop = index + 1;
      while (stop < text.length && text[stop] !== char && text[stop] !== "\n")
        stop += text[stop] === "\\" ? 2 : 1;
      if (text[stop] === char) stop += 1;
      out += text.slice(index, stop);
      index = stop;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      if (depth === 0) {
        index += 1;
        continue;
      }
      depth -= 1;
    }
    out += char;
    index += 1;
  }
  return out + "}".repeat(depth);
}

export type CssVars = Record<string, string>;

export function themeVars(theme: FormTheme): CssVars {
  const resolved = resolveTheme(theme);
  const text = hexToHslTriplet(resolved.text);
  const background = hexToHslTriplet(resolved.background);
  const accent = hexToHslTriplet(resolved.accent);
  const scale = resolved.baseFontSize / 16;
  return {
    "--background": background,
    "--card": background,
    "--popover": background,
    "--foreground": text,
    "--card-foreground": text,
    "--popover-foreground": text,
    "--muted-foreground": `${text} / 0.6`,
    "--muted": `${text} / 0.06`,
    "--accent": `${text} / 0.06`,
    "--accent-foreground": text,
    "--border": `${text} / 0.09`,
    "--input": `${text} / 0.16`,
    "--forms-required-dot": `${text} / 0.14`,
    "--primary": accent,
    "--ring": accent,
    "--fs-button-bg": resolved.buttonBackground,
    "--fs-button-text": resolved.buttonText,
    "--fs-button-radius": `${resolved.buttonRadius}px`,
    "--fs-field-radius": `${resolved.fieldRadius}px`,
    "--fs-page-width": `${resolved.pageWidth / scale}px`,
    "--fs-scale": String(scale),
  };
}

const FONT_STACKS: Record<(typeof THEME_FONTS)[number], string> = {
  Inter: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
  Roboto: "Roboto, ui-sans-serif, system-ui, sans-serif",
  "Open Sans": '"Open Sans", ui-sans-serif, system-ui, sans-serif',
  "DM Sans": '"DM Sans", ui-sans-serif, system-ui, sans-serif',
  Lora: "Lora, ui-serif, Georgia, serif",
  Merriweather: "Merriweather, ui-serif, Georgia, serif",
  "Playfair Display": '"Playfair Display", ui-serif, Georgia, serif',
  "Source Code Pro": '"Source Code Pro", ui-monospace, monospace',
};

const declarations = (entries: [string, string | number | undefined][]) =>
  entries
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}:${value}`)
    .join(";");

/**
 * Rules for the Inputs and Buttons sections. Only keys the author changed are
 * emitted, so an untouched form keeps the stock look. Every value is a
 * schema-validated number, enum or colour.
 */
export function themeRules(theme: FormTheme): string {
  const r = resolveTheme(theme);
  const set = <K extends keyof FormTheme>(key: K) => theme[key] !== undefined;
  const px = (key: keyof FormTheme, value: number) =>
    set(key) ? `${value}px` : undefined;
  const rules: string[] = [];
  const rule = (
    selector: string,
    entries: [string, string | number | undefined][],
  ) => {
    const body = declarations(entries);
    if (body) rules.push(`.forms-surface ${selector}{${body}}`);
  };

  const fixedWidth = r.inputWidthMode === "fixed";
  rule(":is(input,select).forms-input", [
    ["height", px("inputHeight", r.inputHeight)],
    [
      "width",
      set("inputWidthMode") || set("inputWidth")
        ? fixedWidth
          ? `${r.inputWidth}px`
          : "100%"
        : undefined,
    ],
  ]);
  rule(":is(input,select,textarea).forms-input", [
    [
      "background-color",
      set("inputBackground") ? r.inputBackground : undefined,
    ],
    ["margin-bottom", px("inputMarginBottom", r.inputMarginBottom)],
    ["padding-inline", px("inputPaddingX", r.inputPaddingX)],
  ]);
  rule(
    ":is(input,select,textarea).forms-input:not([aria-invalid=true],:focus-visible)",
    [
      [
        "box-shadow",
        set("inputBorderColor") || set("inputBorderWidth")
          ? `0 1px 1px 0 rgba(0,0,0,.12),0 0 0 ${r.inputBorderWidth}px ${r.inputBorderColor},0 2px 5px 0 rgba(61,59,53,.08)`
          : undefined,
      ],
    ],
  );
  rule("label.forms-input", [
    [
      "background-color",
      set("inputBackground") ? r.inputBackground : undefined,
    ],
  ]);
  if (set("inputPlaceholder"))
    rule(".forms-input::placeholder", [["color", r.inputPlaceholder]]);

  rule(".forms-button", [
    ["height", px("buttonHeight", r.buttonHeight)],
    ["font-size", px("buttonFontSize", r.buttonFontSize)],
    ["padding-inline", px("buttonPaddingX", r.buttonPaddingX)],
  ]);
  if (set("buttonWidthMode") || set("buttonWidth")) {
    const width = {
      auto: undefined,
      full: "100%",
      fixed: `${r.buttonWidth}px`,
    }[r.buttonWidthMode];
    rule(".forms-button:last-child", [["width", width]]);
    if (r.buttonWidthMode === "full")
      rule(".forms-actions>div", [["flex", "1"]]);
  }
  rule(".forms-actions", [
    ["margin-block", px("buttonMarginY", r.buttonMarginY)],
    [
      "justify-content",
      set("buttonAlign")
        ? { left: "flex-start", center: "center", right: "flex-end" }[
            r.buttonAlign
          ]
        : undefined,
    ],
    ["display", set("buttonAlign") ? "flex" : undefined],
  ]);
  return rules.join("\n");
}

export const fontStack = (font: (typeof THEME_FONTS)[number]) =>
  FONT_STACKS[font];

export const googleFontHref = (font: (typeof THEME_FONTS)[number]) =>
  `https://fonts.googleapis.com/css2?family=${font.replace(/ /g, "+")}:wght@400;600;800&display=swap`;
