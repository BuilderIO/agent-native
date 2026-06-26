import type {
  BrandKitData,
  BrandKitDefaults,
} from "@agent-native/core/brand-kit";
import {
  extractFigBrandKit,
  looksLikeFigFile,
  type FigBrandKitPreview,
} from "@agent-native/core/brand-kit/fig";

import type { DesignSystemData } from "../../shared/api.js";

export const MAX_FIG_BYTES = 200 * 1024 * 1024;

export interface SlidesFigDesignSystemResult {
  ok: true;
  suggestedTitle: string;
  data: DesignSystemData;
  customInstructions: string;
  preview: FigBrandKitPreview;
  format: "kiwi" | "zip";
  version: number | null;
}

function titleFromFilename(filename: string | undefined): string {
  return (
    (filename || "Imported brand")
      .replace(/\.fig$/i, "")
      .replace(/[-_]+/g, " ")
      .trim() || "Imported brand"
  );
}

export function withSlidesDesignSystemDefaults(
  partial: Partial<BrandKitData> & { defaults?: BrandKitDefaults },
): DesignSystemData {
  const inferredDefaults = partial.defaults;
  const dark = inferredDefaults?.background === "dark";
  const colors = {
    primary: "#609FF8",
    secondary: "#4ADE80",
    accent: "#00E5FF",
    background: dark ? "#000000" : "#FFFFFF",
    surface: dark ? "#0a0a0a" : "#F8FAFC",
    text: dark ? "#ffffff" : "#0F172A",
    textMuted: dark ? "rgba(255,255,255,0.55)" : "#64748B",
    ...partial.colors,
  };

  return {
    colors,
    typography: {
      headingFont: "Poppins",
      bodyFont: "Poppins",
      headingWeight: "900",
      bodyWeight: "400",
      headingSizes: { h1: "64px", h2: "40px", h3: "28px" },
      ...partial.typography,
    },
    spacing: {
      slidePadding:
        partial.spacing?.slidePadding ??
        partial.spacing?.pagePadding ??
        "80px 110px",
      elementGap: partial.spacing?.elementGap ?? "20px",
    },
    borders: { radius: "12px", accentWidth: "4px", ...partial.borders },
    slideDefaults: {
      background: colors.background,
      labelStyle: inferredDefaults?.labelStyle ?? "uppercase",
    },
    logos: partial.logos ?? [],
    ...(partial.imageStyle ? { imageStyle: partial.imageStyle } : {}),
    ...(partial.customCSS ? { customCSS: partial.customCSS } : {}),
    ...(partial.notes ? { notes: partial.notes } : {}),
  };
}

export function parseSlidesFigDesignSystem(args: {
  data: Uint8Array;
  filename?: string;
}): SlidesFigDesignSystemResult {
  if (args.data.length > MAX_FIG_BYTES) {
    throw new Error(
      `File too large (max ${Math.round(MAX_FIG_BYTES / 1024 / 1024)} MB).`,
    );
  }
  if (!looksLikeFigFile(args.data)) {
    throw new Error("That doesn't look like a Figma .fig file.");
  }

  const extracted = extractFigBrandKit(args.data);
  const data = withSlidesDesignSystemDefaults(extracted.data);
  if (extracted.preview.thumbnailDataUrl) {
    data.imageStyle = {
      referenceUrls: [extracted.preview.thumbnailDataUrl],
      styleDescription: data.imageStyle?.styleDescription ?? "",
    };
  }

  return {
    ok: true,
    suggestedTitle: titleFromFilename(args.filename),
    data,
    customInstructions: extracted.customInstructions,
    preview: extracted.preview,
    format: extracted.format,
    version: extracted.version,
  };
}
