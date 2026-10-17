export function isLoopbackBuilderRequestHost(
  host: string | undefined,
): boolean {
  if (!host) return false;
  try {
    const hostname = new URL(`http://${host}`).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
    // coercion-ok: malformed hosts are never treated as loopback.
  } catch {
    return false;
  }
}

export function isTrustedBuilderRequestHost(host: string | undefined): boolean {
  if (!host) return false;
  try {
    const hostname = new URL(`http://${host}`).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname === "builderio.xyz" ||
      hostname.endsWith(".builderio.xyz") ||
      hostname === "builderio.dev" ||
      hostname.endsWith(".builderio.dev") ||
      hostname === "builder.codes" ||
      hostname.endsWith(".builder.codes") ||
      hostname === "builder.io" ||
      hostname.endsWith(".builder.io") ||
      hostname === "builder.my" ||
      hostname.endsWith(".builder.my") ||
      hostname === "builder.cloud" ||
      hostname.endsWith(".builder.cloud")
    );
    // coercion-ok: malformed hosts are never trusted as Builder origins.
  } catch {
    return false;
  }
}

/**
 * The public origin Builder's preview tunnel serves this container from. The
 * tunnel reaches the container over plain-HTTP loopback, so request headers
 * never carry this origin; only the container environment does.
 */
export function firstPublicBuilderPreviewOriginFromEnv(): string | null {
  for (const key of [
    "FUSION_ENV_ORIGIN",
    "VITE_FUSION_ENV_ORIGIN",
    "BUILDER_PREVIEW_URL",
    "VITE_BUILDER_PREVIEW_URL",
  ]) {
    const raw = process.env[key]; // config-ok: Fusion injects preview markers outside app configuration.
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      if (isLoopbackBuilderRequestHost(url.host)) continue;
      if (!isTrustedBuilderRequestHost(url.host)) continue;
      return url.origin;
      // coercion-ok: a malformed env value is skipped, not trusted as an origin.
    } catch {
      continue;
    }
  }
  return null;
}
