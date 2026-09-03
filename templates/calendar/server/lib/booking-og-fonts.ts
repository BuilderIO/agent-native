import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface BookingOgFontAsset {
  asset: string;
  filename: string;
  sourcePath: string;
}

export interface BookingOgAssetStorage {
  getItem(id: string): Promise<unknown>;
  getItemRaw?(id: string): Promise<unknown>;
}

function resolveSourceFontPath(relativePath: string): string {
  try {
    const metaUrl = import.meta.url;
    if (!metaUrl.startsWith("file:")) return "";
    return fileURLToPath(new URL(relativePath, metaUrl));
  } catch {
    return "";
  }
}

export const BOOKING_OG_FONT_ASSETS: BookingOgFontAsset[] = [
  {
    asset: "server/fonts/LiberationSans-Regular.ttf",
    filename: "LiberationSans-Regular.ttf",
    get sourcePath() {
      return resolveSourceFontPath(
        "../../assets/fonts/LiberationSans-Regular.ttf",
      );
    },
  },
  {
    asset: "server/fonts/LiberationSans-Bold.ttf",
    filename: "LiberationSans-Bold.ttf",
    get sourcePath() {
      return resolveSourceFontPath(
        "../../assets/fonts/LiberationSans-Bold.ttf",
      );
    },
  },
];

let cachedFontFiles: string[] | undefined;
let cachedFontHash: string | undefined;

export function bytesFromStorageValue(value: unknown): Buffer | undefined {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  return undefined;
}

function sourceFontFiles(): string[] | undefined {
  try {
    const files = BOOKING_OG_FONT_ASSETS.map((font) => font.sourcePath);
    return files.every((fontFile) => existsSync(fontFile)) ? files : undefined;
  } catch {
    return undefined;
  }
}

async function readFontBytes(
  storage: BookingOgAssetStorage,
  asset: string,
): Promise<Buffer | undefined> {
  const raw =
    typeof storage.getItemRaw === "function"
      ? await storage.getItemRaw(asset)
      : await storage.getItem(asset);
  return bytesFromStorageValue(raw);
}

export async function loadBundledOgFontFiles(
  storage?: BookingOgAssetStorage,
  options: {
    preferSourceFiles?: boolean;
    tmpRoot?: string;
    useCache?: boolean;
  } = {},
): Promise<string[] | undefined> {
  if (options.preferSourceFiles !== false) {
    const sourceFiles = sourceFontFiles();
    if (sourceFiles) return sourceFiles;
  }

  if (!storage) return undefined;

  try {
    const fonts = [];
    const hash = createHash("sha256");
    for (const font of BOOKING_OG_FONT_ASSETS) {
      const bytes = await readFontBytes(storage, font.asset);
      if (!bytes?.byteLength) return undefined;
      fonts.push({ ...font, bytes });
      hash.update(font.asset);
      hash.update(bytes);
    }

    const fontHash = hash.digest("hex").slice(0, 16);
    if (
      options.useCache !== false &&
      cachedFontHash === fontHash &&
      cachedFontFiles
    ) {
      return cachedFontFiles;
    }

    const fontDir = path.join(
      options.tmpRoot ?? tmpdir(),
      `agent-native-calendar-og-fonts-${fontHash}`,
    );
    mkdirSync(fontDir, { recursive: true });

    const fontFiles = fonts.map((font) => {
      const target = path.join(fontDir, font.filename);
      writeFileSync(target, font.bytes);
      return target;
    });

    if (options.useCache !== false) {
      cachedFontHash = fontHash;
      cachedFontFiles = fontFiles;
    }
    return fontFiles;
  } catch {
    return undefined;
  }
}
