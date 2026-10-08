import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  GEIST_MONO_SEMIBOLD_BASE64,
  GEIST_REGULAR_BASE64,
  GEIST_SEMIBOLD_BASE64,
  LIBERATION_SANS_BOLD_BASE64,
  LIBERATION_SANS_REGULAR_BASE64,
  NOTO_NASKH_ARABIC_BASE64,
} from "./og-fonts-data.js";

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
  { filename: "Geist-Regular.ttf", base64: GEIST_REGULAR_BASE64 },
  { filename: "Geist-SemiBold.ttf", base64: GEIST_SEMIBOLD_BASE64 },
  { filename: "GeistMono-SemiBold.ttf", base64: GEIST_MONO_SEMIBOLD_BASE64 },
] as const;

export const OG_FONT_FAMILY = "Liberation Sans";
export const OG_ARABIC_FONT_FAMILY = "Noto Naskh Arabic";
export const OG_GEIST_FONT_FAMILY = "Geist";
export const OG_GEIST_MONO_FONT_FAMILY = "Geist Mono";

let cachedFontFiles: string[] | null | undefined;

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
