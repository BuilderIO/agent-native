export function normalizeAppBasePath(value: string | undefined): string {
  if (!value || value === "/") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  const normalized = trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
  return normalized ? `/${normalized}` : "";
}

export function getConfiguredAppBasePath(): string {
  return normalizeAppBasePath(
    process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH,
  );
}

export function withConfiguredAppBasePath(baseUrl: string): string {
  const basePath = getConfiguredAppBasePath();
  const trimmed = baseUrl.replace(/\/$/, "");
  if (!basePath) return trimmed;

  try {
    const url = new URL(trimmed);
    const pathname = normalizeAppBasePath(url.pathname);
    if (pathname === basePath || pathname.startsWith(`${basePath}/`)) {
      return trimmed;
    }
  } catch {
    // Fall through for relative or otherwise non-URL strings.
  }

  if (trimmed.endsWith(basePath) || trimmed.includes(`${basePath}/`)) {
    return trimmed;
  }
  return `${trimmed}${basePath}`;
}
