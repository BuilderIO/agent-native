
const BUILDER_PREVIEW_HOST_SUFFIXES = [
  ".fly.dev",
  ".builderio.xyz",
  ".builderio.dev",
  ".builder.codes",
  ".builder.my",
  ".builder.live",
] as const;

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLoopbackPreviewAllowed(): boolean {
  const nodeEnv =
    typeof process === "undefined" ? undefined : process.env?.NODE_ENV;
  if (nodeEnv === "production") return false;
  if (nodeEnv === "development" || nodeEnv === "test") return true;
  const viteEnv = (import.meta as { env?: { DEV?: boolean } }).env;
  return viteEnv?.DEV === true;
}

export class InvalidBuilderPreviewUrlError extends Error {
  constructor(reason: string) {
    super(`Invalid Builder preview URL: ${reason}`);
    this.name = "InvalidBuilderPreviewUrlError";
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname);
}

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

  if (url.username || url.password) {
    throw new InvalidBuilderPreviewUrlError("must not embed credentials");
  }

  const hostname = url.hostname.toLowerCase();
  if (isLoopbackHostname(hostname) && !isLoopbackPreviewAllowed()) {
    throw new InvalidBuilderPreviewUrlError(
      "loopback hosts are only allowed in development",
    );
  }
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

export function builderPreviewOrigin(raw: unknown): string {
  return parseBuilderPreviewUrl(raw).origin;
}

export function isBuilderPreviewUrl(raw: unknown): boolean {
  try {
    parseBuilderPreviewUrl(raw);
    return true;
    // coercion-ok: "does not parse" is what this predicate reports as false.
  } catch {
    return false;
  }
}
