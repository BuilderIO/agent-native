import type { Cookie, CookiesGetFilter } from "electron";

type CookieStore = {
  get: (filter: CookiesGetFilter) => Promise<Cookie[]>;
};

type SessionWithCookies = {
  cookies?: CookieStore | null;
};

function cookieDomainMatches(cookie: Cookie, hostname: string): boolean {
  const domain = (cookie.domain ?? "").replace(/^\./, "").toLowerCase();
  return Boolean(
    domain &&
    (hostname === domain ||
      (!cookie.hostOnly && hostname.endsWith(`.${domain}`))),
  );
}

function cookiePathMatches(cookie: Cookie, pathname: string): boolean {
  const cookiePath = cookie.path || "/";
  if (cookiePath === "/") return true;
  return (
    pathname === cookiePath ||
    (cookiePath.endsWith("/")
      ? pathname.startsWith(cookiePath)
      : pathname.startsWith(`${cookiePath}/`))
  );
}

function cookieMatchesUrl(cookie: Cookie, target: URL): boolean {
  return (
    cookieDomainMatches(cookie, target.hostname.toLowerCase()) &&
    cookiePathMatches(cookie, target.pathname || "/") &&
    (!cookie.secure || target.protocol === "https:")
  );
}

/**
 * Build a Cookie header without Electron's URL-filtered cookie lookup.
 * Chromium can omit Partitioned cookies when that filter lacks the current
 * network partition, so read the store first and apply the request boundary
 * locally instead.
 */
export function cookieHeaderForUrl(cookies: Cookie[], rawUrl: string): string {
  const target = new URL(rawUrl);
  if (target.protocol !== "http:" && target.protocol !== "https:") return "";
  return cookies
    .filter((cookie) => cookieMatchesUrl(cookie, target))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

export async function readCookieHeaderForUrl(
  session: SessionWithCookies,
  rawUrl: string,
): Promise<string> {
  if (!session.cookies) return "";
  return cookieHeaderForUrl(await session.cookies.get({}), rawUrl);
}
