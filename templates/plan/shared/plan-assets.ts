
export const PLAN_ASSET_MAX_SINGLE_BYTES = 2 * 1024 * 1024;

export const PLAN_ASSET_MAX_TOTAL_BYTES = 10 * 1024 * 1024;

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export function mimeTypeFromFilename(filename: string): string | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MIME[ext] ?? null;
}
