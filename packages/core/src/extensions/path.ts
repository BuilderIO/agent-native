export const EXTENSION_SLUG_MAX_LENGTH = 60;

export function extensionNameToSlug(
  name: string | null | undefined,
  maxLength = EXTENSION_SLUG_MAX_LENGTH,
): string {
  const normalized = String(name ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const limit = Math.max(1, Math.floor(maxLength));
  const sliced = normalized.slice(0, limit).replace(/-+$/g, "");
  if (normalized.length > limit) {
    const lastDash = sliced.lastIndexOf("-");
    if (lastDash > 0) return sliced.slice(0, lastDash);
  }
  return sliced || "extension";
}

export function extensionPath(id: string, name?: string | null): string {
  const encodedId = encodeURIComponent(id);
  if (name === undefined) return `/extensions/${encodedId}`;
  return `/extensions/${encodedId}/${extensionNameToSlug(name)}`;
}

export function extensionIdFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/extensions\/([^/?#]+)/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function isExtensionPathname(pathname: string, id: string): boolean {
  return extensionIdFromPathname(pathname) === id;
}
