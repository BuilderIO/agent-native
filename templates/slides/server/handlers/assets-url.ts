function normalizeBasePath(value: string | undefined): string {
  if (!value || value === "/") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

export function uploadedAssetUrlForBasePath(
  filename: string,
  basePath: string | undefined,
): string {
  return `${normalizeBasePath(basePath)}/uploads/${filename}`;
}
