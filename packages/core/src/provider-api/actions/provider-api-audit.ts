const REDACTED = "[redacted]";

const CREDENTIAL_NAME =
  /^(?:api[-_]?key|access[-_]?token|auth(?:orization)?|bearer|credential|password|secret|signature|sig|token|x-amz-credential|x-amz-signature)$/i;

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function looksLikeCredentialValue(segment: string): boolean {
  const value = decodePathSegment(segment);
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
    return true;
  }
  if (
    /^(?:sk|pk|rk|ghp|github_pat|xox[baprs]|ya29|AIza)[-_][A-Za-z0-9_-]+$/i.test(
      value,
    )
  ) {
    return true;
  }
  return value.length >= 32 && /^[A-Za-z0-9._~-]+$/.test(value);
}

function sanitizePathname(pathname: string): string {
  let redactNext = false;
  return pathname
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      const decoded = decodePathSegment(segment);
      if (redactNext) {
        redactNext = false;
        return REDACTED;
      }

      const assignment = decoded.match(/^([^=:]+)([=:])(.+)$/);
      if (assignment && CREDENTIAL_NAME.test(assignment[1]!)) {
        return `${assignment[1]}${assignment[2]}${REDACTED}`;
      }
      if (CREDENTIAL_NAME.test(decoded)) {
        redactNext = true;
        return segment;
      }
      return looksLikeCredentialValue(segment) ? REDACTED : segment;
    })
    .join("/");
}

function sanitizeQuery(search: string): string {
  if (!search) return "";
  const redacted = Array.from(new URLSearchParams(search).keys(), (key) => {
    const safeKey = encodeURIComponent(key.slice(0, 100));
    return `${safeKey}=${REDACTED}`;
  });
  return redacted.length > 0 ? `?${redacted.join("&")}` : "";
}

export function sanitizeProviderApiAuditPath(path: unknown): string {
  const raw = String(path ?? "");
  const withoutFragment = raw.split("#", 1)[0] ?? "";

  try {
    const url = new URL(withoutFragment);
    return `${url.protocol}//${url.host}${sanitizePathname(url.pathname)}${sanitizeQuery(url.search)}`;
  } catch {
    const queryIndex = withoutFragment.indexOf("?");
    const pathname =
      queryIndex >= 0 ? withoutFragment.slice(0, queryIndex) : withoutFragment;
    const search = queryIndex >= 0 ? withoutFragment.slice(queryIndex + 1) : "";
    return `${sanitizePathname(pathname)}${sanitizeQuery(search)}`;
  }
}

export function buildProviderApiAuditSummary(args: {
  method?: unknown;
  provider?: unknown;
  path?: unknown;
}): string {
  const method = String(args.method || "GET").toUpperCase();
  const provider = String(args.provider ?? "");
  const path = sanitizeProviderApiAuditPath(args.path);
  return `${method} ${provider} ${path}`.slice(0, 200);
}
