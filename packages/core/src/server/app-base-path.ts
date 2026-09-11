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

/**
 * SSR-aware variant of getConfiguredAppBasePath.
 *
 * In SSR builds (Vite's server-side bundle), `process.env` may not carry
 * VITE_* variables that were only statically replaced at build time. As a
 * fallback this variant also checks `import.meta.env` (available inside a
 * Vite SSR build) including `BASE_URL`, which Vite sets from the `base`
 * config option. Used by ssr-handler.ts where the Nitro server bundle is
 * built with Vite and the env may be delivered via import.meta rather than
 * process.env.
 */
export function getAppBasePathFromViteEnv(): string {
  const metaEnv = (
    import.meta as unknown as {
      env?: Record<string, string | undefined>;
    }
  ).env;
  return normalizeAppBasePath(
    process.env.VITE_APP_BASE_PATH ||
      process.env.APP_BASE_PATH ||
      metaEnv?.VITE_APP_BASE_PATH ||
      metaEnv?.APP_BASE_PATH ||
      metaEnv?.BASE_URL,
  );
}

/**
 * Strip the configured app base path prefix from a pathname.
 *
 * Returns "/" when the pathname equals the base path exactly, the suffix
 * when it starts with `${basePath}/`, or the original pathname unchanged
 * when no prefix match is found.
 */
export function stripAppBasePath(
  pathname: string,
  basePath = getConfiguredAppBasePath(),
): string {
  if (!basePath) return pathname;
  if (pathname === basePath) return "/";
  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length) || "/";
  }
  return pathname;
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
