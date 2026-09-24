import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  LIBERATION_SANS_BOLD_BASE64,
  LIBERATION_SANS_REGULAR_BASE64,
  NOTO_NASKH_ARABIC_BASE64,
} from "./og-fonts-data.js";

/**
 * Liberation Sans is the metric-compatible libre replacement for
 * Arial/Helvetica that the OG image SVG asks for. Noto Naskh Arabic fills the
 * Arabic script gap for localized docs titles. They ship embedded as base64
 * (see {@link ./og-fonts-data.ts}) so the renderer never depends on the host's
 * system fonts — Linux serverless runtimes (Netlify/Lambda) have neither Arial,
 * Inter, nor Arabic fallback fonts.
 */
const OG_FONT_FILES = [
  {
    filename: "LiberationSans-Regular.ttf",
    base64: LIBERATION_SANS_REGULAR_BASE64,
  },
  { filename: "LiberationSans-Bold.ttf", base64: LIBERATION_SANS_BOLD_BASE64 },
  {
    filename: "NotoNaskhArabic-Variable.ttf",
    base64: NOTO_NASKH_ARABIC_BASE64,
  },
] as const;

export const OG_FONT_FAMILY = "Liberation Sans";
export const OG_ARABIC_FONT_FAMILY = "Noto Naskh Arabic";

let cachedFontFiles: string[] | null | undefined;

/**
 * Materialize the embedded OG fonts to disk and return their paths for resvg's
 * `fontFiles` option. resvg 2.x only accepts file paths (no in-memory buffers),
 * so the bytes are written once to a content-hashed tmp directory and cached
 * for the lifetime of the process. Returns `undefined` if the fonts can't be
 * written, letting the caller fall back to system fonts.
 */
export function resolveOgFontFiles(): string[] | undefined {
  if (cachedFontFiles !== undefined) return cachedFontFiles ?? undefined;

  try {
    const hash = createHash("sha256");
    const decoded = OG_FONT_FILES.map((font) => {
      const bytes = Buffer.from(font.base64, "base64");
      if (!bytes.byteLength) throw new Error(`empty font: ${font.filename}`);
      hash.update(font.filename);
      hash.update(bytes);
      return { filename: font.filename, bytes };
    });

    const fontDir = path.join(
      tmpdir(),
      `agent-native-og-fonts-${hash.digest("hex").slice(0, 16)}`,
    );
    mkdirSync(fontDir, { recursive: true });

    const fontFiles = decoded.map(({ filename, bytes }) => {
      const target = path.join(fontDir, filename);
      if (!existsSync(target)) writeFileSync(target, bytes);
      return target;
    });

    cachedFontFiles = fontFiles;
    return fontFiles;
  } catch {
    cachedFontFiles = null;
    return undefined;
  }
}
