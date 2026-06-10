import {
  defineEventHandler,
  readMultipartFormData,
  setResponseStatus,
} from "h3";
import { getSession } from "@agent-native/core/server";
import {
  extractFigBrandKit,
  looksLikeFigFile,
} from "@agent-native/core/brand-kit/fig";
import type { DesignSystemData } from "../../shared/api.js";

// .fig files can be large (the document is a kiwi-compressed canvas). Cap to
// keep memory bounded — typical brand files are well under this.
const MAX_FIG_BYTES = 200 * 1024 * 1024;

/** Fill any tokens the extractor couldn't determine with sane defaults, so the
 * resulting design system is a complete, usable DesignSystemData. */
function withDefaults(partial: Partial<DesignSystemData>): DesignSystemData {
  const dark = partial.defaults?.background === "dark";
  return {
    colors: {
      primary: "#0F172A",
      secondary: "#1E293B",
      accent: "#2684FF",
      background: dark ? "#0B1220" : "#FFFFFF",
      surface: dark ? "#111827" : "#F8FAFC",
      text: dark ? "#F8FAFC" : "#0F172A",
      textMuted: dark ? "#94A3B8" : "#64748B",
      ...partial.colors,
    },
    typography: {
      headingFont: "Sora",
      bodyFont: "Inter",
      headingWeight: "700",
      bodyWeight: "400",
      headingSizes: { h1: "48px", h2: "32px", h3: "24px" },
      ...partial.typography,
    },
    spacing: { pagePadding: "32px", elementGap: "16px", ...partial.spacing },
    borders: { radius: "12px", accentWidth: "2px", ...partial.borders },
    defaults: {
      background: partial.defaults?.background ?? "light",
      labelStyle: partial.defaults?.labelStyle ?? "none",
    },
    logos: partial.logos ?? [],
    ...(partial.imageStyle ? { imageStyle: partial.imageStyle } : {}),
    ...(partial.customCSS ? { customCSS: partial.customCSS } : {}),
    ...(partial.notes ? { notes: partial.notes } : {}),
  };
}

/**
 * Parse-only endpoint: accepts a `.fig` upload (multipart field `file`),
 * decodes it, and returns the deeply-extracted brand profile (tokens, signature
 * gradients, and a synthesized brand-character brief) for preview. It does NOT
 * persist — the client reviews/edits, then calls the `create-design-system`
 * action on confirm (which owns ownership/scoping). This mirrors Claude
 * Design's upload → parse → preview → approve flow.
 */
export const importFigmaSystem = defineEventHandler(async (event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  let parts;
  try {
    parts = await readMultipartFormData(event);
  } catch {
    setResponseStatus(event, 413);
    return { error: "Upload too large or malformed." };
  }
  const part = parts?.find(
    (p) => (p.name === "file" || p.name === "fig") && p.data,
  );
  if (!part) {
    setResponseStatus(event, 400);
    return {
      error: "No .fig file uploaded (expected multipart field 'file').",
    };
  }
  if (part.data.length > MAX_FIG_BYTES) {
    setResponseStatus(event, 413);
    return {
      error: `File too large (max ${Math.round(MAX_FIG_BYTES / 1024 / 1024)} MB).`,
    };
  }

  // Validate it actually looks like a .fig: a zip archive (PK) or fig-kiwi.
  if (!looksLikeFigFile(part.data)) {
    setResponseStatus(event, 400);
    return { error: "That doesn't look like a Figma .fig file." };
  }

  let extracted;
  try {
    extracted = extractFigBrandKit(part.data);
  } catch (e) {
    setResponseStatus(event, 422);
    return {
      error: `Could not decode the .fig file: ${
        e instanceof Error ? e.message : "unknown error"
      }`,
    };
  }

  const thumbnailDataUrl = extracted.preview.thumbnailDataUrl;
  const data = withDefaults(extracted.data as Partial<DesignSystemData>);
  // Attach the file thumbnail as a brand reference image for the generator.
  if (thumbnailDataUrl) {
    data.imageStyle = {
      referenceUrls: [thumbnailDataUrl],
      styleDescription: data.imageStyle?.styleDescription ?? "",
    };
  }

  const suggestedTitle =
    (part.filename || "Imported brand")
      .replace(/\.fig$/i, "")
      .replace(/[-_]+/g, " ")
      .trim() || "Imported brand";

  return {
    ok: true,
    suggestedTitle,
    data,
    customInstructions: extracted.customInstructions,
    preview: extracted.preview,
  };
});
