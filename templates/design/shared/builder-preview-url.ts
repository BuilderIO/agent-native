/**
 * Validation for Builder Fusion container preview URLs. Stops the seam becoming
 * an open embed primitive pointed at an internal address. Mirrors
 * builder-internal's list (`packages/app/models/fusion.model.tsx` —
 * search `builderio.xyz`); keep the two in sync.
 */

const BUILDER_PREVIEW_HOST_SUFFIXES = [
  ".fly.dev",
  ".builderio.xyz",
  ".builderio.dev",
  ".builder.codes",
  ".builder.my",
  ".builder.live",
] as const;

/** Loopback is allowed over http so a local container works in dev. */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export class InvalidBuilderPreviewUrlError extends Error {
  constructor(reason: string) {
    super(`Invalid Builder preview URL: ${reason}`);
    this.name = "InvalidBuilderPreviewUrlError";
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname);
}

/**
 * Parse and validate a preview URL, returning its normalized form. Throws
 * rather than returning null so a rejected URL is never indistinguishable from
 * an absent one — a bad init must not quietly place zero screens and read as an
 * empty design.
 */
export function parseBuilderPreviewUrl(raw: unknown): URL {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new InvalidBuilderPreviewUrlError("must be a non-empty string");
  }

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new InvalidBuilderPreviewUrlError(`could not parse "${raw}"`);
  }

  // Credentials would be replayed by the iframe on every request.
  if (url.username || url.password) {
    throw new InvalidBuilderPreviewUrlError("must not embed credentials");
  }

  const hostname = url.hostname.toLowerCase();
  const loopback = isLoopbackHostname(hostname);

  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new InvalidBuilderPreviewUrlError(
      `must use https (got "${url.protocol}")`,
    );
  }

  if (
    !loopback &&
    !BUILDER_PREVIEW_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new InvalidBuilderPreviewUrlError(
      `host "${hostname}" is not a recognized Builder preview host`,
    );
  }

  return url;
}

/** Non-throwing form, for UI that wants to branch instead of failing. */
export function isBuilderPreviewUrl(raw: unknown): boolean {
  try {
    parseBuilderPreviewUrl(raw);
    return true;
  } catch {
    return false;
  }
}
