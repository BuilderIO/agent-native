export interface RecoveryCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  expires: number;
}

export type RecoveryCookieHeader =
  | { kind: "header"; value: string }
  | { kind: "missing" }
  | { kind: "unreadable"; reason: "origin" | "cookie" | "limit" };

const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const COOKIE_VALUE = /^(?:\x21|[\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E])*$/;

function pathMatches(cookiePath: string, requestPath: string): boolean {
  return (
    requestPath.startsWith(cookiePath) &&
    (cookiePath.endsWith("/") ||
      requestPath[cookiePath.length] === "/" ||
      requestPath.length === cookiePath.length)
  );
}

export function recoveryCookieHeader(
  cookies: readonly RecoveryCookie[],
  trustedOrigin: URL,
  requestUrl: URL,
  nowMs = Date.now(),
  maxBytes = 8192,
): RecoveryCookieHeader {
  if (
    trustedOrigin.protocol !== "https:" ||
    trustedOrigin.username ||
    trustedOrigin.password ||
    trustedOrigin.pathname !== "/" ||
    trustedOrigin.search ||
    trustedOrigin.hash ||
    requestUrl.protocol !== "https:" ||
    requestUrl.username ||
    requestUrl.password ||
    requestUrl.origin !== trustedOrigin.origin ||
    requestUrl.search ||
    requestUrl.hash
  ) {
    return { kind: "unreadable", reason: "origin" };
  }
  if (
    !Number.isFinite(nowMs) ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0
  ) {
    return { kind: "unreadable", reason: "limit" };
  }

  const host = requestUrl.hostname.toLowerCase();
  const nowSeconds = nowMs / 1000;
  const scoped: RecoveryCookie[] = [];
  for (const cookie of cookies) {
    if (
      !cookie ||
      typeof cookie.name !== "string" ||
      typeof cookie.value !== "string" ||
      typeof cookie.domain !== "string" ||
      typeof cookie.path !== "string" ||
      typeof cookie.secure !== "boolean" ||
      typeof cookie.expires !== "number" ||
      !Number.isFinite(cookie.expires)
    ) {
      return { kind: "unreadable", reason: "cookie" };
    }
    if (!cookie.path.startsWith("/")) {
      return { kind: "unreadable", reason: "cookie" };
    }
    const domain = cookie.domain.toLowerCase();
    const normalizedDomain = domain.replace(/^\./, "");
    const domainMatches =
      host === normalizedDomain ||
      (domain.startsWith(".") && host.endsWith(`.${normalizedDomain}`));
    if (
      !domainMatches ||
      !pathMatches(cookie.path, requestUrl.pathname) ||
      (cookie.secure && requestUrl.protocol !== "https:") ||
      (cookie.expires >= 0 && cookie.expires <= nowSeconds)
    ) {
      continue;
    }
    if (!COOKIE_NAME.test(cookie.name) || !COOKIE_VALUE.test(cookie.value)) {
      return { kind: "unreadable", reason: "cookie" };
    }
    scoped.push(cookie);
  }

  if (scoped.length === 0) return { kind: "missing" };
  scoped.sort((left, right) => right.path.length - left.path.length);
  const value = scoped.map(({ name, value }) => `${name}=${value}`).join("; ");
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    return { kind: "unreadable", reason: "limit" };
  }
  return { kind: "header", value };
}
